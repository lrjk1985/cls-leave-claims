# CLS Production Rollout Notes

This local build uses a JSON data store and a local email outbox so the workflow can be completed before paid or hosted services are wired in.

## Recommended Production Shape

1. Vercel hosts the app and server routes.
2. Supabase Auth manages sign in.
3. Supabase Postgres stores employees, leave applications, claim records, and email notification records.
4. Supabase Storage stores private claim receipt uploads.
5. Server-side Vercel routes perform privileged admin actions, receipt access checks, and send real emails through a provider such as Resend, SendGrid, or Microsoft 365 SMTP.
6. Browser code uses only Supabase publishable keys. Never expose a service role key in the browser.

## Supabase

Use `supabase/schema.sql` as the first draft for the production tables and RLS policies. In production, the `admin` role should be stored in Supabase Auth `app_metadata`, not user-editable metadata.

Key tables:

- `profiles`: employee directory, role, direct report / approver, service start date, annual leave entitlement, carried-forward leave, current leave allotment, and medical claim limit
- `public_holidays`: synced Singapore public holidays and observed weekday substitutes
- `leave_requests`: employee leave applications and decisions
- `claims`: employee medical and general claims, receipt metadata, and decisions
- `email_notifications`: audit trail for email notifications

Receipt files should live in a private Supabase Storage bucket such as `claim-receipts`. Store the file path and metadata on the `claims` row, then serve downloads through a trusted server route that checks whether the requester is the employee, assigned direct report, or admin before downloading from Storage.

## Public Holiday Updates

The local app syncs Singapore public holidays from MOM's consolidated data.gov.sg dataset and caches the result in `data/sg-public-holidays.json`. Leave applications always calculate deducted days from this cache, excluding Saturdays, Sundays, gazetted public holidays, and the next working day when a public holiday falls on Sunday.

For production, create a Vercel Cron Job that calls a trusted server route such as `GET /api/sync-public-holidays` at least once a year, and also whenever MOM announces changes. A practical schedule is monthly during the second half of the year because the consolidated dataset is updated annually after the new public holidays are released.

Example Vercel cron configuration after the route exists in the production app:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "crons": [
    {
      "path": "/api/sync-public-holidays",
      "schedule": "0 17 1 7-12 *"
    }
  ]
}
```

Protect the route with `CRON_SECRET` and write synced dates into `public.public_holidays` using server-side credentials only.

## Leave Year Rollover

The local app applies the leave rollover and service-anniversary leave checks automatically when it starts or loads data. For production, create trusted scheduled routes for January 1 rollover and daily anniversary checks.

Policy implemented locally:

- Each employee has a service start date and a starting annual leave value.
- Personnel must serve a full year before receiving the extra service day.
- The annual base entitlement increases by 1 day on the employee's completed service anniversary.
- The annual base entitlement is capped at 18 days.
- Any leave left from the ending year is carried forward and added to the new year's allotment.
- The carry-forward amount is not included in the 18-day service entitlement cap.
- January 1 rollover keeps the carry-forward logic separate from service-anniversary accrual.

Example Vercel cron configuration after the production routes exist:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "crons": [
    {
      "path": "/api/run-leave-rollover",
      "schedule": "5 16 31 12 *"
    },
    {
      "path": "/api/run-service-anniversary-accrual",
      "schedule": "0 17 * * *"
    }
  ]
}
```

Vercel cron schedules use UTC, so `5 16 31 12 *` runs shortly after midnight on January 1 in Singapore, and `0 17 * * *` runs daily at 1:00 AM Singapore time.

## Vercel

The local `server.js` keeps everything in one process for ease of testing. For production, split the API handlers into Vercel server routes and replace the JSON store with Supabase queries.

Suggested server routes:

- `GET /api/sync-public-holidays`
- `POST /api/run-leave-rollover`
- `POST /api/run-service-anniversary-accrual`
- `POST /api/leave-requests`
- `PATCH /api/leave-requests/:id/status`
- `POST /api/claims`
- `PATCH /api/claims/:id/status`
- `GET /api/claims/:id/receipt`
- `POST /api/employees`
- `PATCH /api/employees/:id`

## Email

Local emails are written to the outbox. Production should send these events:

- Leave application submitted -> email assigned direct report / approver
- Leave application approved or not approved -> email employee
- Medical or general claim submitted -> email assigned direct report / approver
- Medical or general claim approved or not approved -> email employee
- New employee created -> email employee with account instructions

## Before Launch

- Confirm CLS leave policies, public holidays, half-day handling, and carry-forward rules.
- Confirm medical claim limits, reset periods, and whether pending claims should reserve the employee's medical balance.
- Add Supabase Storage policies or trusted server-only receipt access for private claim receipts.
- Add audit logging for admin changes and approval decisions.
- Run Supabase security advisors after the schema is applied.
- Configure production email sender domain authentication.
