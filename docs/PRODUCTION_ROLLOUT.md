# CLS Production Rollout Notes

This build uses a local JSON data store on a developer machine. In production, the same application state is stored in Supabase, receipt uploads go to Supabase Storage, email is delivered through Resend, and Vercel hosts the web app plus a daily maintenance schedule.

## Recommended Production Shape

1. Vercel hosts the app and server routes.
2. Supabase Postgres stores the V1 application state.
3. Supabase Storage stores private claim receipt uploads.
4. Server-side Vercel routes perform privileged admin actions, receipt access checks, and send real emails through Resend.
5. Browser code never receives the Supabase service role key or Resend API key.

## Supabase

Apply `supabase/v1-rollout.sql` to create the V1 production table and private `claim-receipts` bucket.

The app expects these Vercel environment variables:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_RECEIPT_BUCKET` optional, defaults to `claim-receipts`

Keep the service role key server-side only. Do not expose it in browser code or commit it to Git.

## Public Holiday Updates

The app syncs Singapore public holidays from MOM's consolidated data.gov.sg dataset and caches the result locally. Leave applications exclude Saturdays, Sundays, gazetted public holidays, and the next working day when a public holiday falls on Sunday.

Production uses the Vercel Cron Job in `vercel.json`, which calls `GET /api/cron/daily-maintenance` every day at 12:05 AM Singapore time. This keeps public holidays refreshed without relying on a yearly manual update.

## Leave Year Rollover

The app applies leave rollover and service-anniversary leave checks automatically when it loads data. Production also calls `GET /api/cron/daily-maintenance` daily through Vercel Cron.

Policy implemented locally:

- Each employee has a service start date and a starting annual leave value.
- Personnel must serve a full year before receiving the extra service day.
- The annual base entitlement increases by 1 day on the employee's completed service anniversary.
- The annual base entitlement is capped at 18 days.
- Any leave left from the ending year is carried forward and added to the new year's allotment.
- The carry-forward amount is not included in the 18-day service entitlement cap.
- January 1 rollover keeps the carry-forward logic separate from service-anniversary accrual.

Vercel cron schedules use UTC, so `5 16 * * *` in `vercel.json` runs at 12:05 AM Singapore time.

## Vercel

The `api/[...path].js` adapter allows the existing API to run as a Vercel Function. Static files are served from `public/`.

Required Vercel environment variables:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
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
