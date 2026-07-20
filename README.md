# CLS Leave & Claims

A local-first Employee Leave Application and Medical Claims System for CLS.

## Run Locally

```bash
node server.js
```

Open `http://localhost:3000`.

Seeded local accounts:

- Admin: `admin@cls.local` / `password`
- Direct Report: `manager@cls.local` / `password`
- Employee: `employee@cls.local` / `password`

## What Is Included

- Employee login
- Employees can change their own password after logging in
- Leave balance shown after login
- Admin can set the employee's initial annual leave days as the current annual leave amount
- Admin can mark selected employees as having unlimited annual leave while keeping medical leave separate
- Future service-anniversary increases can apply from the configured amount, without changing the initial setup value
- Unused leave is carried forward into the next year on January 1
- Saturdays, Sundays, and Singapore public holidays are excluded from leave deduction
- Singapore public holidays sync from MOM's consolidated data.gov.sg dataset with a local cache
- Leave applications with local email notifications to the assigned Direct Report / approver
- Separately tracked Hospitalization, Compassionate, Paternity, Maternity, Childcare, and National Service leave
- Configurable per-employee working schedules and entitlement grants
- Combined outpatient and hospitalization medical pool with service-based proration
- Employee request estimates and approver entitlement context
- Admin entitlement adjustments with required reasons and audit history
- Direct Report approval queue
- Approved / not approved decision emails to employees
- Medical and general claim submission with receipt uploads
- Claim receipts accept PDF, JPG, PNG, WebP, HEIC, or HEIF files up to 5 MB
- Claim receipt storage is monitored for admins and receipts older than 5 years are removed by daily maintenance
- Medical claim balance shown after login, with admin-set medical claim limits
- General claims have no claim limit
- Admin employee management, role assignment, direct report assignment, initial annual leave days, and medical claim limit setup
- Supabase V1 rollout migration plus the additive, disabled-by-default V2 entitlement upgrade
- Vercel serverless adapter and daily maintenance cron in `vercel.json`
- Resend-ready production email delivery with `.ics` leave calendar attachments
- Vercel and Supabase rollout notes in `docs/PRODUCTION_ROLLOUT.md`

## Tests

```bash
npm test
```

The live Supabase concurrency test also requires `SUPABASE_TEST_URL` and `SUPABASE_TEST_SERVICE_ROLE_KEY`. Without them, that single staging-only test is skipped.

## Local Data

The first run creates `data/local-db.json`. Receipt uploads are stored in `data/uploads`. Delete `data/local-db.json` if you want to reset the local demo data.
