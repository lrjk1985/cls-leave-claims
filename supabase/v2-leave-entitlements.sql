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
