-- CLS Employee Leave Application & Medical Claims System
-- Draft production schema for Supabase.
-- Use Supabase Auth for users, Vercel server functions for privileged admin/email actions,
-- and Row Level Security for direct client access.

create type public.cls_role as enum ('employee', 'manager', 'admin');
create type public.request_status as enum ('pending', 'approved', 'rejected');
create type public.claim_type as enum ('medical', 'general');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  email text not null unique,
  role public.cls_role not null default 'employee',
  manager_id uuid references public.profiles(id),
  service_start_date date not null default current_date,
  starting_leave_entitlement numeric(5, 2) not null default 0,
  annual_leave_entitlement numeric(5, 2) not null default 0,
  carried_forward_leave numeric(5, 2) not null default 0,
  leave_entitlement numeric(5, 2) not null default 0,
  leave_policy_year integer not null default (extract(year from current_date)::integer),
  leave_rollover_at timestamptz,
  leave_service_accrual_at timestamptz,
  medical_claim_limit numeric(12, 2) not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint no_self_manager check (id is distinct from manager_id)
);

create table public.public_holidays (
  holiday_date date primary key,
  holiday text not null,
  observed boolean not null default false,
  observed_for date references public.public_holidays(holiday_date),
  source text not null default 'MOM Singapore Public Holidays via data.gov.sg',
  synced_at timestamptz not null default now()
);

create table public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles(id) on delete cascade,
  manager_id uuid not null references public.profiles(id),
  leave_type text not null,
  leave_year integer not null,
  start_date date not null,
  end_date date not null,
  days numeric(5, 2) not null check (days > 0),
  excluded_dates jsonb not null default '[]'::jsonb,
  reason text,
  status public.request_status not null default 'pending',
  decision_note text,
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint leave_dates_order check (start_date <= end_date)
);

create table public.claims (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles(id) on delete cascade,
  manager_id uuid not null references public.profiles(id),
  claim_type public.claim_type not null,
  claim_date date not null,
  category text not null,
  provider text not null,
  amount numeric(12, 2) not null check (amount > 0),
  receipt_ref text,
  receipt_file_path text not null,
  receipt_original_name text not null,
  receipt_mime_type text,
  receipt_size_bytes integer check (receipt_size_bytes >= 0),
  description text not null,
  status public.request_status not null default 'pending',
  decision_note text,
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.email_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  recipient_email text not null,
  subject text not null,
  body text not null,
  notification_type text not null,
  related_id uuid,
  delivered_at timestamptz,
  created_at timestamptz not null default now()
);

insert into storage.buckets (id, name, public)
values ('claim-receipts', 'claim-receipts', false)
on conflict (id) do nothing;

alter table public.profiles enable row level security;
alter table public.public_holidays enable row level security;
alter table public.leave_requests enable row level security;
alter table public.claims enable row level security;
alter table public.email_notifications enable row level security;

create policy "profiles_select_own_manager_or_admin"
on public.profiles
for select
to authenticated
using (
  id = (select auth.uid())
  or manager_id = (select auth.uid())
  or (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
);

create policy "profiles_admin_insert"
on public.profiles
for insert
to authenticated
with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

create policy "profiles_admin_update"
on public.profiles
for update
to authenticated
using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

create policy "public_holidays_select_authenticated"
on public.public_holidays
for select
to authenticated
using (true);

create policy "leave_select_participant_or_admin"
on public.leave_requests
for select
to authenticated
using (
  employee_id = (select auth.uid())
  or manager_id = (select auth.uid())
  or (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
);

create policy "leave_employee_insert_own"
on public.leave_requests
for insert
to authenticated
with check (
  employee_id = (select auth.uid())
  and manager_id = (
    select manager_id
    from public.profiles
    where id = (select auth.uid())
  )
);

create policy "leave_manager_or_admin_update"
on public.leave_requests
for update
to authenticated
using (
  manager_id = (select auth.uid())
  or (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
)
with check (
  manager_id = (select auth.uid())
  or (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
);

create policy "claims_select_participant_or_admin"
on public.claims
for select
to authenticated
using (
  employee_id = (select auth.uid())
  or manager_id = (select auth.uid())
  or (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
);

create policy "claims_employee_insert_own"
on public.claims
for insert
to authenticated
with check (
  employee_id = (select auth.uid())
  and manager_id = (
    select manager_id
    from public.profiles
    where id = (select auth.uid())
  )
);

create policy "claims_manager_or_admin_update"
on public.claims
for update
to authenticated
using (
  manager_id = (select auth.uid())
  or (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
)
with check (
  manager_id = (select auth.uid())
  or (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
);

create policy "email_select_recipient_or_admin"
on public.email_notifications
for select
to authenticated
using (
  recipient_id = (select auth.uid())
  or (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
);

-- Insert email_notifications from trusted server code only.
-- Do not expose Supabase service role keys to browser clients.
