begin;

alter table public.cls_leave_requests
  add column if not exists day_portion text not null default 'full';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'cls_leave_requests_day_portion_check'
      and conrelid = 'public.cls_leave_requests'::regclass
  ) then
    alter table public.cls_leave_requests
      add constraint cls_leave_requests_day_portion_check
      check (day_portion in ('full', 'morning', 'afternoon'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'cls_leave_requests_half_day_single_date_check'
      and conrelid = 'public.cls_leave_requests'::regclass
  ) then
    alter table public.cls_leave_requests
      add constraint cls_leave_requests_half_day_single_date_check
      check (day_portion = 'full' or start_date = end_date);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'cls_leave_requests_half_day_days_check'
      and conrelid = 'public.cls_leave_requests'::regclass
  ) then
    alter table public.cls_leave_requests
      add constraint cls_leave_requests_half_day_days_check
      check (day_portion = 'full' or days = 0.5);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'cls_leave_requests_half_day_type_check'
      and conrelid = 'public.cls_leave_requests'::regclass
  ) then
    alter table public.cls_leave_requests
      add constraint cls_leave_requests_half_day_type_check
      check (
        day_portion = 'full'
        or type in (
          'Annual Leave',
          'Urgent Leave',
          'Medical Leave',
          'Off-in-Lieu Leave',
          'Unpaid Leave'
        )
      );
  end if;
end $$;

create table if not exists public.cls_off_in_lieu_awards (
  id text primary key,
  employee_id text not null references public.cls_users(id) on delete cascade,
  days numeric(7,2) not null,
  award_date date not null,
  expires_on date not null,
  reason text not null,
  awarded_by text not null references public.cls_users(id),
  revoked_at timestamptz,
  revoked_by text references public.cls_users(id),
  revocation_reason text,
  created_at timestamptz not null default now(),
  constraint cls_off_in_lieu_awards_days_check
    check (days > 0 and days * 2 = trunc(days * 2)),
  constraint cls_off_in_lieu_awards_expiry_check
    check (
      expires_on = case
        when extract(month from award_date) = 2 and extract(day from award_date) = 29
          then make_date(extract(year from award_date)::integer + 1, 3, 1)
        else (award_date + interval '1 year')::date
      end
    ),
  constraint cls_off_in_lieu_awards_reason_check
    check (btrim(reason) <> ''),
  constraint cls_off_in_lieu_awards_revocation_check
    check (
      (revoked_at is null and revoked_by is null and revocation_reason is null)
      or (
        revoked_at is not null
        and revoked_by is not null
        and btrim(coalesce(revocation_reason, '')) <> ''
      )
    )
);

create table if not exists public.cls_off_in_lieu_allocations (
  id text primary key,
  leave_request_id text not null
    references public.cls_leave_requests(id) on delete cascade,
  award_id text not null references public.cls_off_in_lieu_awards(id),
  leave_date date not null,
  days numeric(7,2) not null,
  created_at timestamptz not null default now(),
  constraint cls_off_in_lieu_allocations_days_check
    check (days > 0 and days * 2 = trunc(days * 2)),
  constraint cls_off_in_lieu_allocations_unique
    unique (leave_request_id, award_id, leave_date)
);

create index if not exists cls_off_in_lieu_awards_employee_expiry_idx
  on public.cls_off_in_lieu_awards (employee_id, expires_on, award_date)
  where revoked_at is null;

create index if not exists cls_off_in_lieu_allocations_award_date_idx
  on public.cls_off_in_lieu_allocations (award_id, leave_date);

create index if not exists cls_off_in_lieu_allocations_request_idx
  on public.cls_off_in_lieu_allocations (leave_request_id);

alter table public.cls_off_in_lieu_awards enable row level security;
alter table public.cls_off_in_lieu_allocations enable row level security;

revoke all on table public.cls_off_in_lieu_awards from anon, authenticated;
revoke all on table public.cls_off_in_lieu_allocations from anon, authenticated;
grant select, insert, update, delete on table public.cls_off_in_lieu_awards to service_role;
grant select, insert, update, delete on table public.cls_off_in_lieu_allocations to service_role;

create or replace function public.cls_allocate_off_in_lieu()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_leave_date date;
  v_required numeric(7,2);
  v_remaining numeric(7,2);
  v_reserved numeric(7,2);
  v_available numeric(7,2);
  v_allocate numeric(7,2);
  v_generated_total numeric(7,2) := 0;
  v_award record;
begin
  if new.type <> 'Off-in-Lieu Leave'
     or new.status not in ('pending', 'approved') then
    return new;
  end if;

  if new.work_schedule_snapshot is null
     or jsonb_typeof(new.work_schedule_snapshot) <> 'array' then
    raise exception using
      errcode = 'P0001',
      message = 'CLS_OIL_CAP: a valid work schedule is required';
  end if;

  for v_leave_date in
    select candidate::date
    from generate_series(new.start_date, new.end_date, interval '1 day') candidate
    where exists (
      select 1
      from jsonb_array_elements_text(new.work_schedule_snapshot) weekday
      where weekday::integer = extract(isodow from candidate)::integer
    )
    and not exists (
      select 1
      from jsonb_array_elements(coalesce(new.excluded_dates, '[]'::jsonb)) excluded
      where excluded ->> 'date' = candidate::date::text
    )
    order by candidate
  loop
    v_required := case
      when new.day_portion in ('morning', 'afternoon') then 0.5
      else 1
    end;
    v_generated_total := v_generated_total + v_required;
    v_remaining := v_required;

    for v_award in
      select award.id, award.days
      from public.cls_off_in_lieu_awards award
      where award.employee_id = new.employee_id
        and award.revoked_at is null
        and award.award_date <= v_leave_date
        and v_leave_date < award.expires_on
      order by award.expires_on, award.award_date, award.created_at, award.id
      for update
    loop
      select coalesce(sum(allocation.days), 0)
      into v_reserved
      from public.cls_off_in_lieu_allocations allocation
      join public.cls_leave_requests request
        on request.id = allocation.leave_request_id
      where allocation.award_id = v_award.id
        and request.status in ('pending', 'approved');

      v_available := greatest(v_award.days - v_reserved, 0);
      v_allocate := least(v_available, v_remaining);

      if v_allocate > 0 then
        insert into public.cls_off_in_lieu_allocations (
          id,
          leave_request_id,
          award_id,
          leave_date,
          days
        ) values (
          'oilalloc_' || md5(new.id || ':' || v_award.id || ':' || v_leave_date::text),
          new.id,
          v_award.id,
          v_leave_date,
          v_allocate
        );

        v_remaining := v_remaining - v_allocate;
      end if;

      exit when v_remaining = 0;
    end loop;

    if v_remaining > 0 then
      raise exception using
        errcode = 'P0001',
        message = format(
          'CLS_OIL_CAP: insufficient Off-in-Lieu balance for %s',
          v_leave_date
        );
    end if;
  end loop;

  if v_generated_total <> new.days then
    raise exception using
      errcode = 'P0001',
      message = format(
        'CLS_OIL_CAP: requested days (%s) do not match eligible leave days (%s)',
        new.days,
        v_generated_total
      );
  end if;

  return new;
end;
$$;

revoke all on function public.cls_allocate_off_in_lieu() from public, anon, authenticated;
grant execute on function public.cls_allocate_off_in_lieu() to service_role;

drop trigger if exists cls_allocate_off_in_lieu_trigger
  on public.cls_leave_requests;

create trigger cls_allocate_off_in_lieu_trigger
after insert on public.cls_leave_requests
for each row execute function public.cls_allocate_off_in_lieu();

commit;
