-- CLS Leave & Claims v1 production rollout.
-- Production now stores app data in normalized Supabase tables instead of one
-- large cls_app_state JSON record. The browser never receives Supabase keys;
-- Vercel server functions use the service role key to access these tables.

create table if not exists public.cls_users (
  id text primary key,
  name text not null,
  email text not null unique,
  role text not null check (role in ('admin', 'manager', 'employee')),
  manager_id text references public.cls_users(id),
  claim_approver_id text references public.cls_users(id),
  service_start_date date not null,
  starting_leave_entitlement numeric(6, 2) not null default 0,
  annual_leave_entitlement numeric(6, 2) not null default 0,
  carried_forward_leave numeric(6, 2) not null default 0,
  birthday_leave_entitlement numeric(6, 2) not null default 0,
  unlimited_annual_leave boolean not null default false,
  leave_policy_year integer not null,
  leave_entitlement numeric(6, 2) not null default 0,
  leave_rollover_at timestamptz,
  leave_service_accrual_at timestamptz,
  medical_claim_limit numeric(12, 2) not null default 0,
  medical_claim_balance_adjustment numeric(12, 2) not null default 0,
  medical_claim_balance_adjustment_year integer,
  medical_leave_entitlement numeric(6, 2) not null default 14,
  medical_leave_balance_adjustment numeric(6, 2) not null default 0,
  medical_leave_balance_adjustment_year integer,
  active boolean not null default true,
  password_salt text not null,
  password_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cls_users_no_self_manager check (id is distinct from manager_id),
  constraint cls_users_no_self_claim_approver check (id is distinct from claim_approver_id)
);

alter table public.cls_users
  add column if not exists unlimited_annual_leave boolean not null default false;

alter table public.cls_users
  add column if not exists medical_leave_balance_adjustment numeric(6, 2) not null default 0,
  add column if not exists medical_leave_balance_adjustment_year integer;

alter table public.cls_users
  add column if not exists medical_claim_balance_adjustment numeric(12, 2) not null default 0,
  add column if not exists medical_claim_balance_adjustment_year integer;

create table if not exists public.cls_leave_requests (
  id text primary key,
  employee_id text not null references public.cls_users(id) on delete cascade,
  manager_id text not null references public.cls_users(id),
  type text not null,
  start_date date not null,
  end_date date not null,
  days numeric(6, 2) not null check (days > 0),
  leave_year integer not null,
  excluded_dates jsonb not null default '[]'::jsonb,
  reason text not null default '',
  medical_certificate jsonb,
  status text not null check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  decision_note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by text references public.cls_users(id),
  cancellation_note text not null default '',
  cancelled_at timestamptz,
  cancelled_by text references public.cls_users(id),
  constraint cls_leave_requests_dates_order check (start_date <= end_date)
);

create table if not exists public.cls_leave_adjustments (
  id text primary key,
  employee_id text not null references public.cls_users(id) on delete cascade,
  actor_id text references public.cls_users(id),
  year integer not null,
  days numeric(6, 2) not null,
  reason text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.cls_claims (
  id text primary key,
  employee_id text not null references public.cls_users(id) on delete cascade,
  manager_id text not null references public.cls_users(id),
  claim_type text not null check (claim_type in ('medical', 'general')),
  claim_date date not null,
  category text not null,
  provider text not null,
  amount numeric(12, 2) not null check (amount > 0),
  receipt_ref text not null default '',
  receipt jsonb,
  client_submission_id text,
  description text not null,
  status text not null check (status in ('pending', 'approved', 'rejected')),
  decision_note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by text references public.cls_users(id)
);

create table if not exists public.cls_emails (
  id text primary key,
  recipient_id text not null references public.cls_users(id) on delete cascade,
  to_address text not null default '',
  subject text not null,
  body text not null,
  type text not null,
  related_id text,
  created_at timestamptz not null default now(),
  delivered boolean not null default false,
  delivered_at timestamptz,
  delivery_error text,
  provider_id text
);

create table if not exists public.cls_audit_events (
  id text primary key,
  created_at timestamptz not null default now(),
  actor_id text references public.cls_users(id),
  actor_name text not null default 'System',
  actor_email text not null default '',
  actor_role text not null default 'system',
  action text not null,
  summary text not null default '',
  affected_user_id text references public.cls_users(id),
  affected_user_name text not null default '',
  related_type text,
  related_id text,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.cls_sessions (
  token text primary key,
  user_id text not null references public.cls_users(id) on delete cascade,
  expires_at bigint not null,
  created_at timestamptz not null default now()
);

create index if not exists cls_users_manager_idx on public.cls_users(manager_id);
create index if not exists cls_users_claim_approver_idx on public.cls_users(claim_approver_id);
create index if not exists cls_leave_employee_year_idx on public.cls_leave_requests(employee_id, leave_year);
create index if not exists cls_leave_manager_status_idx on public.cls_leave_requests(manager_id, status);
create index if not exists cls_leave_status_created_idx on public.cls_leave_requests(status, created_at desc);
create index if not exists cls_claim_employee_type_idx on public.cls_claims(employee_id, claim_type);
create index if not exists cls_claim_manager_status_idx on public.cls_claims(manager_id, status);
create index if not exists cls_claim_status_created_idx on public.cls_claims(status, created_at desc);
create index if not exists cls_adjustments_employee_year_idx on public.cls_leave_adjustments(employee_id, year);
create index if not exists cls_emails_recipient_created_idx on public.cls_emails(recipient_id, created_at desc);
create index if not exists cls_audit_created_idx on public.cls_audit_events(created_at desc);
create index if not exists cls_audit_affected_user_idx on public.cls_audit_events(affected_user_id);
create index if not exists cls_sessions_user_idx on public.cls_sessions(user_id);

alter table public.cls_users enable row level security;
alter table public.cls_leave_requests enable row level security;
alter table public.cls_leave_adjustments enable row level security;
alter table public.cls_claims enable row level security;
alter table public.cls_emails enable row level security;
alter table public.cls_audit_events enable row level security;
alter table public.cls_sessions enable row level security;

grant usage on schema public to service_role;

revoke all on table
  public.cls_users,
  public.cls_leave_requests,
  public.cls_leave_adjustments,
  public.cls_claims,
  public.cls_emails,
  public.cls_audit_events,
  public.cls_sessions
from anon, authenticated;

grant select, insert, update, delete on table
  public.cls_users,
  public.cls_leave_requests,
  public.cls_leave_adjustments,
  public.cls_claims,
  public.cls_emails,
  public.cls_audit_events,
  public.cls_sessions
to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'claim-receipts',
  'claim-receipts',
  false,
  5000000,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do update
set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Receipt and Medical Certificate files are accessed only by trusted server-side
-- code with the Supabase service role key. Do not expose that key in browser code
-- or commit it to Git.

-- Leave entitlement enforcement (verified V2 clean-install parity)
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
