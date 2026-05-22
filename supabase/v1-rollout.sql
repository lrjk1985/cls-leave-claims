-- CLS Leave & Claims v1 production rollout.
-- The current app keeps a local JSON file during development and stores the same
-- application state in this Supabase table in production.

create table if not exists public.cls_app_state (
  key text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.cls_app_state enable row level security;

grant all on table public.cls_app_state to service_role;

create or replace function public.set_cls_app_state_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_cls_app_state_updated_at on public.cls_app_state;

create trigger set_cls_app_state_updated_at
before update on public.cls_app_state
for each row
execute function public.set_cls_app_state_updated_at();

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

-- Receipt files are accessed only by trusted server-side code with the Supabase
-- service role key. Do not expose that key in browser code or commit it to Git.
