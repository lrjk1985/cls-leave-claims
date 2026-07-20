-- CLS Leave & Claims v2 entitlement foundation.
-- Run this additive rollout before deploying application code that reads these tables.

alter table public.cls_users
  add column if not exists work_schedule jsonb not null default '[1,2,3,4,5]'::jsonb,
  add column if not exists medical_leave_entitlement_override numeric(7, 2);

update public.cls_users
set work_schedule = '[1,2,3,4,5]'::jsonb
where work_schedule is null;

create table if not exists public.cls_leave_entitlements (
  id text primary key,
  employee_id text not null references public.cls_users(id) on delete cascade,
  leave_type text not null,
  period_kind text not null check (period_kind in ('annual', 'event', 'continuous')),
  period_year integer,
  event_date date,
  valid_from date not null,
  valid_until date,
  base_days numeric(7, 2) not null check (base_days >= 0),
  override_days numeric(7, 2) check (override_days >= 0),
  eligibility_verified boolean not null default false,
  eligibility_verified_by text references public.cls_users(id),
  eligibility_verified_at timestamptz,
  work_schedule_snapshot jsonb,
  child_birth_date date,
  active boolean not null default true,
  created_by text references public.cls_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cls_leave_entitlements_dates_order check (valid_until is null or valid_from <= valid_until),
  constraint cls_leave_entitlements_period_shape check (
    (period_kind = 'annual' and period_year is not null)
    or (period_kind = 'event' and event_date is not null)
    or period_kind = 'continuous'
  )
);

create table if not exists public.cls_leave_entitlement_adjustments (
  id text primary key,
  entitlement_id text not null references public.cls_leave_entitlements(id) on delete cascade,
  actor_id text references public.cls_users(id),
  days numeric(7, 2) not null,
  reason text not null check (length(trim(reason)) > 0),
  created_at timestamptz not null default now()
);

create table if not exists public.cls_leave_policy_settings (
  leave_type text primary key,
  enforcement_enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by text references public.cls_users(id)
);

alter table public.cls_leave_requests
  add column if not exists entitlement_id text,
  add column if not exists counting_method text not null default 'scheduled_working_days',
  add column if not exists work_schedule_snapshot jsonb,
  add column if not exists supporting_document jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'cls_leave_requests_entitlement_fk'
      and conrelid = 'public.cls_leave_requests'::regclass
  ) then
    alter table public.cls_leave_requests
      add constraint cls_leave_requests_entitlement_fk
      foreign key (entitlement_id)
      references public.cls_leave_entitlements(id);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'cls_leave_requests_counting_method_check'
      and conrelid = 'public.cls_leave_requests'::regclass
  ) then
    alter table public.cls_leave_requests
      add constraint cls_leave_requests_counting_method_check
      check (counting_method in ('scheduled_working_days', 'calendar_days', 'uncapped_scheduled_days'));
  end if;
end
$$;

create unique index if not exists cls_entitlements_annual_active_idx
  on public.cls_leave_entitlements(employee_id, leave_type, period_year)
  where period_kind = 'annual' and active;

create index if not exists cls_entitlements_employee_type_idx
  on public.cls_leave_entitlements(employee_id, leave_type, active);

create index if not exists cls_entitlements_validity_idx
  on public.cls_leave_entitlements(valid_from, valid_until);

create index if not exists cls_entitlement_adjustments_entitlement_idx
  on public.cls_leave_entitlement_adjustments(entitlement_id, created_at desc);

create index if not exists cls_leave_requests_entitlement_idx
  on public.cls_leave_requests(entitlement_id, status);

alter table public.cls_leave_entitlements enable row level security;
alter table public.cls_leave_entitlement_adjustments enable row level security;
alter table public.cls_leave_policy_settings enable row level security;

grant usage on schema public to service_role;

revoke all on table
  public.cls_leave_entitlements,
  public.cls_leave_entitlement_adjustments,
  public.cls_leave_policy_settings
from anon, authenticated;

grant select, insert, update, delete on table
  public.cls_leave_entitlements,
  public.cls_leave_entitlement_adjustments,
  public.cls_leave_policy_settings
to service_role;

insert into public.cls_leave_policy_settings (leave_type, enforcement_enabled)
values
  ('Medical Leave', false),
  ('Hospitalization Leave', false),
  ('Compassionate Leave', false),
  ('Paternity Leave', false),
  ('Maternity Leave', false),
  ('Childcare Leave', false),
  ('National Service Leave', false)
on conflict (leave_type) do nothing;

create or replace function public.cls_assert_leave_entitlement()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_enforcement_enabled boolean := false;
  v_service_start date;
  v_medical_override numeric(7, 2);
  v_service_months integer;
  v_outpatient_cap numeric(7, 2);
  v_combined_cap numeric(7, 2);
  v_grant_cap numeric(7, 2);
  v_outpatient_reserved numeric(9, 2) := 0;
  v_combined_reserved numeric(9, 2) := 0;
  v_entitlement_employee text;
  v_entitlement_type text;
  v_entitlement_active boolean;
  v_entitlement_verified boolean;
  v_entitlement_from date;
  v_entitlement_until date;
  v_entitlement_cap numeric(9, 2);
  v_entitlement_reserved numeric(9, 2) := 0;
begin
  select enforcement_enabled
  into v_enforcement_enabled
  from public.cls_leave_policy_settings
  where leave_type = new.type;

  if not coalesce(v_enforcement_enabled, false)
    or new.status not in ('pending', 'approved') then
    return new;
  end if;

  if new.type in ('Medical Leave', 'Hospitalization Leave') then
    select service_start_date, medical_leave_entitlement_override
    into v_service_start, v_medical_override
    from public.cls_users
    where id = new.employee_id
    for update;

    if not found then
      raise exception using
        errcode = 'P0001',
        message = 'CLS_LEAVE_CAP: employee was not found';
    end if;

    v_service_months := greatest(
      0,
      extract(year from age(new.start_date, v_service_start))::integer * 12
        + extract(month from age(new.start_date, v_service_start))::integer
    );

    if v_service_months < 3 then
      v_outpatient_cap := 0;
      v_combined_cap := 0;
    elsif v_service_months = 3 then
      v_outpatient_cap := 5;
      v_combined_cap := 15;
    elsif v_service_months = 4 then
      v_outpatient_cap := 8;
      v_combined_cap := 30;
    elsif v_service_months = 5 then
      v_outpatient_cap := 11;
      v_combined_cap := 45;
    else
      v_outpatient_cap := 14;
      v_combined_cap := 60;
    end if;

    if v_medical_override is not null then
      v_outpatient_cap := v_medical_override;
    end if;

    select coalesce(override_days, base_days)
    into v_grant_cap
    from public.cls_leave_entitlements
    where employee_id = new.employee_id
      and leave_type = 'Hospitalization Leave'
      and period_kind = 'annual'
      and period_year = new.leave_year
      and active
      and valid_from <= new.start_date
      and (valid_until is null or valid_until >= new.end_date)
    for update;

    if found then
      v_combined_cap := v_grant_cap;
    end if;

    select
      coalesce(sum(days) filter (where type = 'Medical Leave'), 0),
      coalesce(sum(days) filter (where type in ('Medical Leave', 'Hospitalization Leave')), 0)
    into v_outpatient_reserved, v_combined_reserved
    from public.cls_leave_requests
    where employee_id = new.employee_id
      and leave_year = new.leave_year
      and status in ('pending', 'approved')
      and id is distinct from new.id;

    if new.type = 'Medical Leave' then
      v_outpatient_reserved := v_outpatient_reserved + new.days;
    end if;
    v_combined_reserved := v_combined_reserved + new.days;

    if new.type = 'Medical Leave' and v_outpatient_reserved > v_outpatient_cap then
      raise exception using
        errcode = 'P0001',
        message = format(
          'CLS_LEAVE_CAP: outpatient Medical Leave cap exceeded (%s of %s days)',
          v_outpatient_reserved,
          v_outpatient_cap
        );
    end if;

    if v_combined_reserved > v_combined_cap then
      raise exception using
        errcode = 'P0001',
        message = format(
          'CLS_LEAVE_CAP: combined Medical and Hospitalization cap exceeded (%s of %s days)',
          v_combined_reserved,
          v_combined_cap
        );
    end if;

    return new;
  end if;

  if new.type = 'National Service Leave' then
    return new;
  end if;

  if new.entitlement_id is null then
    raise exception using
      errcode = 'P0001',
      message = 'CLS_LEAVE_CAP: an active leave entitlement is required';
  end if;

  select
    employee_id,
    leave_type,
    active,
    eligibility_verified,
    valid_from,
    valid_until,
    coalesce(override_days, base_days)
  into
    v_entitlement_employee,
    v_entitlement_type,
    v_entitlement_active,
    v_entitlement_verified,
    v_entitlement_from,
    v_entitlement_until,
    v_entitlement_cap
  from public.cls_leave_entitlements
  where id = new.entitlement_id
  for update;

  if not found
    or v_entitlement_employee <> new.employee_id
    or v_entitlement_type <> new.type
    or not v_entitlement_active
    or new.start_date < v_entitlement_from
    or (v_entitlement_until is not null and new.end_date > v_entitlement_until) then
    raise exception using
      errcode = 'P0001',
      message = 'CLS_LEAVE_CAP: linked leave entitlement is invalid or inactive';
  end if;

  if new.type in ('Paternity Leave', 'Maternity Leave', 'Childcare Leave')
    and not v_entitlement_verified then
    raise exception using
      errcode = 'P0001',
      message = 'CLS_LEAVE_CAP: linked leave entitlement eligibility is not verified';
  end if;

  if new.type = 'Maternity Leave' then
    if new.start_date <> v_entitlement_from
      or v_entitlement_until is null
      or new.end_date <> v_entitlement_until then
      raise exception using
        errcode = 'P0001',
        message = 'CLS_LEAVE_CAP: Maternity Leave request must match the approved grant period';
    end if;

    select count(*)
    into v_entitlement_reserved
    from public.cls_leave_requests
    where entitlement_id = new.entitlement_id
      and status in ('pending', 'approved')
      and id is distinct from new.id;

    if v_entitlement_reserved > 0 then
      raise exception using
        errcode = 'P0001',
        message = 'CLS_LEAVE_CAP: Maternity Leave entitlement already has an active request';
    end if;
  end if;

  select
    v_entitlement_cap
      + coalesce((
        select sum(days)
        from public.cls_leave_entitlement_adjustments
        where entitlement_id = new.entitlement_id
      ), 0),
    coalesce(sum(days), 0)
  into v_entitlement_cap, v_entitlement_reserved
  from public.cls_leave_requests
  where entitlement_id = new.entitlement_id
    and status in ('pending', 'approved')
    and id is distinct from new.id;

  v_entitlement_reserved := v_entitlement_reserved + new.days;
  if v_entitlement_reserved > v_entitlement_cap then
    raise exception using
      errcode = 'P0001',
      message = format(
        'CLS_LEAVE_CAP: %s entitlement exceeded (%s of %s days)',
        new.type,
        v_entitlement_reserved,
        v_entitlement_cap
      );
  end if;

  return new;
end;
$$;

revoke all on function public.cls_assert_leave_entitlement() from public, anon, authenticated;
grant execute on function public.cls_assert_leave_entitlement() to service_role;

drop trigger if exists cls_leave_entitlement_guard on public.cls_leave_requests;
create trigger cls_leave_entitlement_guard
before insert or update on public.cls_leave_requests
for each row execute function public.cls_assert_leave_entitlement();
