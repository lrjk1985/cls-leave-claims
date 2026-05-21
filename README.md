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
- Leave balance shown after login
- Admin can set the employee's initial annual leave days as the current annual leave amount
- Future service-anniversary increases can apply from the configured amount, without changing the initial setup value
- Unused leave is carried forward into the next year on January 1
- Saturdays, Sundays, and Singapore public holidays are excluded from leave deduction
- Singapore public holidays sync from MOM's consolidated data.gov.sg dataset with a local cache
- Leave applications with local email notifications to the assigned Direct Report / approver
- Direct Report approval queue
- Approved / not approved decision emails to employees
- Medical and general claim submission with receipt uploads
- Medical claim balance shown after login, with admin-set medical claim limits
- General claims have no claim limit
- Admin employee management, role assignment, direct report assignment, initial annual leave days, and medical claim limit setup
- Supabase V1 rollout migration in `supabase/v1-rollout.sql`
- Vercel serverless adapter and daily maintenance cron in `vercel.json`
- Resend-ready production email delivery with `.ics` leave calendar attachments
- Vercel and Supabase rollout notes in `docs/PRODUCTION_ROLLOUT.md`

## Tests

```bash
node --test
```

## Local Data

The first run creates `data/local-db.json`. Receipt uploads are stored in `data/uploads`. Delete `data/local-db.json` if you want to reset the local demo data.
