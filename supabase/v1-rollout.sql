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
  medical_leave_entitlement numeric(6, 2) not null default 14,
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
