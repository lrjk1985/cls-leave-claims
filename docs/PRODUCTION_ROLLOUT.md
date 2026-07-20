# CLS Production Rollout Notes

This build uses a local JSON data store on a developer machine. In production, application data is stored in dedicated Supabase tables, receipt uploads go to Supabase Storage, email is delivered through Resend, and Vercel hosts the web app plus a daily maintenance schedule.

## Recommended Production Shape

1. Vercel hosts the app and server routes.
2. Supabase Postgres stores V1 data in dedicated tables, not one app-state JSON record.
3. Supabase Storage stores private claim receipt uploads.
4. Server-side Vercel routes perform privileged admin actions, receipt access checks, and send real emails through Resend.
5. Browser code never receives the Supabase service role key or Resend API key.

## Supabase

Apply `supabase/v1-rollout.sql` to create the V1 production tables and private `claim-receipts` bucket. The tables use Row Level Security, are granted only to `service_role`, and are accessed only by Vercel server functions. The receipt bucket is configured for PDF, JPG, PNG, WebP, HEIC, and HEIF uploads up to 5 MB.

The V1 tables are:

- `cls_users`
- `cls_leave_requests`
- `cls_leave_adjustments`
- `cls_claims`
- `cls_emails`
- `cls_audit_events`
- `cls_sessions`

The leave-entitlement upgrade is stored separately in `supabase/v2-leave-entitlements.sql`. It is additive and leaves every enforcement setting disabled. Existing databases must apply V1 first, then V2. Do not apply V2 directly to production until it has passed the staging sequence below.

V2 adds:

- `cls_leave_entitlements`
- `cls_leave_entitlement_adjustments`
- `cls_leave_policy_settings`
- Work-schedule and medical override columns on `cls_users`
- Entitlement, counting, schedule-snapshot, and supporting-document columns on `cls_leave_requests`
- An atomic database trigger that prevents concurrent requests from exceeding an enabled cap

The new tables use RLS, explicitly revoke browser roles, and grant only `service_role`. Explicit grants are required for reliable Data API access on current Supabase projects.

The app expects these Vercel environment variables:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_RECEIPT_BUCKET` optional, defaults to `claim-receipts`
- `SUPABASE_DATA_MODE` optional. Leave unset for the new table-based mode. Set to `legacy_state` only if you temporarily need the old `cls_app_state` JSON mode.

Keep the service role key server-side only. Do not expose it in browser code or commit it to Git.

Because the current data is test data, the recommended launch path is to apply the rollout SQL, deploy the app, sign in with the initial admin account, and create real employees from Admin. No test-data migration is required.

## Public Holiday Updates

The app syncs Singapore public holidays from MOM's consolidated data.gov.sg dataset and caches the result locally. Leave applications exclude Saturdays, Sundays, gazetted public holidays, and the next working day when a public holiday falls on Sunday.

Production uses the Vercel Cron Job in `vercel.json`, which calls `GET /api/cron/daily-maintenance` every day at 12:05 AM Singapore time. This keeps public holidays refreshed without relying on a yearly manual update.

## Receipt Storage

Claim receipts remain capped at 5 MB per upload. Admins can see approximate active receipt storage in the app Overview. Daily maintenance deletes only receipt files older than 5 years; the claim history remains in the system with the receipt marked as removed by retention policy.

## Leave Year Rollover

The app applies leave rollover and service-anniversary leave checks automatically when it loads data. Production also calls `GET /api/cron/daily-maintenance` daily through Vercel Cron.

Policy implemented locally:

- Each employee has a service start date and an initial annual leave days value.
- The initial annual leave days value is treated as the employee's current annual leave amount during setup.
- Personnel must serve a full year before receiving any future extra service day.
- Future automatic service increases add from the configured amount after setup, without backfilling historical years.
- Automatic service increases are capped at 18 annual base days, unless Admin has manually set a higher annual leave amount.
- Any leave left from the ending year is carried forward and added to the new year's allotment.
- The carry-forward amount is not included in the 18-day service entitlement cap.
- January 1 rollover keeps the carry-forward logic separate from service-anniversary accrual.

Vercel cron schedules use UTC, so `5 16 * * *` in `vercel.json` runs at 12:05 AM Singapore time.

## Vercel

The `api/[...path].js` adapter allows the existing API to run as a Vercel Function. Static files are served from `public/`.

Required Vercel environment variables:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_DATA_MODE` optional; leave unset for table-based production
- `RESEND_API_KEY`
- `EMAIL_FROM`
- `APP_URL`
- `CRON_SECRET`
- `INITIAL_ADMIN_EMAIL`
- `INITIAL_ADMIN_PASSWORD`
- `INITIAL_ADMIN_NAME` optional

## Email

Local emails are written to the outbox. Production sends these events through Resend when `RESEND_API_KEY` is present:

- Leave application submitted -> email assigned direct report / approver
- Leave application approved or not approved -> email employee
- Medical or general claim submitted -> email assigned direct report / approver
- Medical or general claim approved or not approved -> email employee
- New employee created -> email employee with account instructions
- Leave submitted and approved emails can include `.ics` calendar attachments so recipients can add leave periods to Microsoft 365 calendar.

## Before Launch

- Confirm CLS leave policies, public holidays, half-day handling, and carry-forward rules.
- Confirm medical claim limits, reset periods, and whether pending claims should reserve the employee's medical balance.
- Apply `supabase/v1-rollout.sql`.
- Run Supabase security advisors after the migration is applied.
- Configure and verify the production Resend sender domain.
- Set a strong `INITIAL_ADMIN_PASSWORD` before first production login.

## Leave Entitlement Rollout

Run this sequence on a disposable Supabase branch or staging project first. Never print, paste into browser code, or commit the service-role key.

1. Back up `cls_users`, `cls_leave_requests`, and `cls_leave_adjustments` from the Supabase dashboard.
2. Record baseline counts:

```sql
select 'cls_users' as table_name, count(*) as row_count from public.cls_users
union all
select 'cls_leave_requests', count(*) from public.cls_leave_requests
union all
select 'cls_leave_adjustments', count(*) from public.cls_leave_adjustments;
```

3. Run `supabase/v2-leave-entitlements.sql` in the staging SQL Editor.
4. Confirm the new columns and tables:

```sql
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'cls_leave_entitlements',
    'cls_leave_entitlement_adjustments',
    'cls_leave_policy_settings'
  )
order by table_name;

select table_name, column_name
from information_schema.columns
where table_schema = 'public'
  and (
    (table_name = 'cls_users' and column_name in ('work_schedule', 'medical_leave_entitlement_override'))
    or
    (table_name = 'cls_leave_requests' and column_name in (
      'entitlement_id', 'counting_method', 'work_schedule_snapshot', 'supporting_document'
    ))
  )
order by table_name, column_name;
```

5. Confirm RLS and `service_role` grants:

```sql
select c.relname as table_name, c.relrowsecurity as rls_enabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'cls_leave_entitlements',
    'cls_leave_entitlement_adjustments',
    'cls_leave_policy_settings'
  )
order by c.relname;

select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in (
    'cls_leave_entitlements',
    'cls_leave_entitlement_adjustments',
    'cls_leave_policy_settings'
  )
order by table_name, grantee, privilege_type;
```

Expected: RLS is `true`; `service_role` has `SELECT`, `INSERT`, `UPDATE`, and `DELETE`; `anon` and `authenticated` have no table grants.

6. Deploy the application while all entitlement enforcement settings remain disabled.
7. In Admin > Employees > More > Manage Entitlements, review every employee's schedule, service start date, medical pools, annual grants, event grants, and remaining balances.
8. Enable one policy at a time. Every update below contains a `where` clause:

```sql
update public.cls_leave_policy_settings
set enforcement_enabled = true, updated_at = now()
where leave_type = 'Medical Leave';

update public.cls_leave_policy_settings
set enforcement_enabled = true, updated_at = now()
where leave_type = 'Hospitalization Leave';

update public.cls_leave_policy_settings
set enforcement_enabled = true, updated_at = now()
where leave_type = 'Compassionate Leave';

update public.cls_leave_policy_settings
set enforcement_enabled = true, updated_at = now()
where leave_type = 'Childcare Leave';

update public.cls_leave_policy_settings
set enforcement_enabled = true, updated_at = now()
where leave_type = 'Paternity Leave';

update public.cls_leave_policy_settings
set enforcement_enabled = true, updated_at = now()
where leave_type = 'Maternity Leave';

update public.cls_leave_policy_settings
set enforcement_enabled = true, updated_at = now()
where leave_type = 'National Service Leave';
```

9. After each update, submit and approve one staging request for that type. Confirm pending usage reserves capacity, approval does not change the displayed entitlement, cancellation releases capacity, and a request beyond the cap is rejected.
10. Before production, rerun the baseline row-count query and verify that V2 did not delete or replace any V1 rows.

### Behavior Rollback

Roll back behavior by disabling only the affected policy. Do not drop V2 columns, tables, or the trigger during an incident.

```sql
update public.cls_leave_policy_settings
set enforcement_enabled = false, updated_at = now()
where leave_type = 'Medical Leave';
```

Use the same statement with one of these exact `leave_type` values: `Hospitalization Leave`, `Compassionate Leave`, `Childcare Leave`, `Paternity Leave`, `Maternity Leave`, or `National Service Leave`. Confirm the affected row before and after every update:

```sql
select leave_type, enforcement_enabled, updated_at
from public.cls_leave_policy_settings
where leave_type = 'Medical Leave';
```

### Staging Acceptance

- Existing Annual, Medical Claims, Urgent, and Unpaid behavior is unchanged.
- Existing medical leave balances survive the migration.
- Service proration returns 0/0, 5/15, 8/30, 11/45, and 14/60 at the tested service boundaries.
- Outpatient Medical and Hospitalization share the 60-day combined pool.
- Compassionate grants 3 days per calendar year.
- Eligible Childcare grants 6 days per calendar year and does not expose child birth dates outside Admin.
- Paternity snapshots four work weeks and expires after 12 months.
- Maternity requires one continuous 112-calendar-day request matching its grant.
- National Service is uncapped and requires an Official Call-Up Notice.
- Pending requests reserve balances and concurrent writes cannot exceed an enabled cap.
- Overrides, remaining-balance adjustments, and audit events remain distinct.
