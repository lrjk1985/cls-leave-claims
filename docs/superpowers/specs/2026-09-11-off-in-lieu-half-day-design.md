# Off-in-Lieu and Half-Day Leave Design

**Date:** 2026-09-11

**Status:** Approved design, pending written-spec review

## Objective

Add an admin-awarded Off-in-Lieu (OIL) leave balance with rolling one-year expiry, and allow employees to request selected leave types in morning or afternoon half-day units.

The change must preserve the existing leave request, approval, cancellation, notification, audit, entitlement, and public-holiday workflows. Existing leave requests remain full-day requests and require no data conversion.

## Approved Policies

### Off-in-Lieu

- Off-in-Lieu is separate from Annual Leave and every other entitlement.
- Only an admin can award OIL.
- Awards use half-day increments and must be greater than zero.
- Every award records the employee, days, award date, reason, awarding admin, and creation time.
- An award remains usable through the day before its first anniversary.
- Example: an award dated 15 September 2026 is usable through 14 September 2027 and expires at the start of 15 September 2027.
- For a 29 February award, the following 28 February remains usable and the award expires on 1 March.
- Eligibility is evaluated against each requested leave date, not the date on which the request is submitted.
- Requests consume the eligible award with the earliest expiry first.
- Pending requests reserve OIL. Rejected and cancelled requests release it.
- Employees cannot request more OIL than has been explicitly awarded and remains unexpired and unreserved.
- Admins may revoke an award's unused balance with a required reason. An award with pending allocations cannot be revoked until those requests are rejected or cancelled. Historical approved usage remains intact.
- Revoking and replacing an award is used instead of silently editing its original days or date.

### Half-Day Leave

- The supported portions are Full Day, Morning Half, and Afternoon Half.
- Morning Half and Afternoon Half each consume 0.5 day.
- A half-day request must start and end on the same date.
- Half-days are permitted for Annual Leave, Urgent Leave, Medical Leave, Off-in-Lieu Leave, and Unpaid Leave.
- Hospitalization, Compassionate, Paternity, Maternity, Childcare, and National Service Leave remain full-day only.
- Medical half-days still require a Medical Certificate.
- A half-day cannot be requested on an unscheduled day, weekend, or Singapore public holiday.
- Morning or afternoon is visible in employee history, approvals, email text, audit records, and calendar attachment text.
- The application does not invent clock times because employee working hours are not stored. Calendar attachments remain date-based and clearly identify the selected half-day portion.

## Architecture

Use a dedicated OIL award ledger and allocation ledger rather than adapting annual entitlement grants.

The existing entitlement model assumes one active annual grant or one event period. OIL awards can overlap and expire independently. A dedicated allocation record preserves which award funded each requested leave date, supports earliest-expiry-first usage, and prevents expired credits from being treated as available.

Half-day support is an additive attribute on the existing leave request. The existing numeric day columns already support 0.5 increments.

## Data Model

### `cls_off_in_lieu_awards`

Create an additive table containing:

- `id text primary key`
- `employee_id text not null references cls_users(id) on delete cascade`
- `days numeric(7,2) not null`
- `award_date date not null`
- `expires_on date not null`
- `reason text not null`
- `awarded_by text not null references cls_users(id)`
- `revoked_at timestamptz`
- `revoked_by text references cls_users(id)`
- `revocation_reason text`
- `created_at timestamptz not null default now()`

Constraints require positive half-day increments, a non-empty reason, and `expires_on > award_date`. Revocation fields must be either all absent or complete.

`expires_on` is exclusive. The award is valid when:

```text
award_date <= requested leave date < expires_on
```

The server calculates `expires_on`; the admin does not enter it manually.

### `cls_off_in_lieu_allocations`

Create an additive table containing:

- `id text primary key`
- `leave_request_id text not null references cls_leave_requests(id) on delete cascade`
- `award_id text not null references cls_off_in_lieu_awards(id)`
- `leave_date date not null`
- `days numeric(7,2) not null`
- `created_at timestamptz not null default now()`

An allocation is unique by leave request, award, and leave date. Allocation days must be positive half-day increments.

Per-date allocations allow a multi-day request to use one award before it expires and a newer award for later dates. Active capacity calculations count allocations whose linked request is pending or approved. Rejected and cancelled requests retain allocation history but stop reserving capacity.

### `cls_leave_requests`

Add:

- `day_portion text not null default 'full'`

Allowed values are `full`, `morning`, and `afternoon`. Existing rows default to `full`.

Database validation requires:

- `morning` and `afternoon` requests to have matching start and end dates.
- `morning` and `afternoon` requests to contain `days = 0.5`.
- Half-day portions to use an approved half-day leave type.

No existing column is removed or rewritten.

## Balance Calculations

For each award:

```text
award days
- pending allocations
- approved allocations
= unreserved award balance
```

Employee OIL totals are:

```text
available = sum of unexpired award days - approved allocations
pending = sum of pending allocations
unreserved = available - pending
```

Expired and revoked awards provide no capacity for new requests. Approved historical usage remains visible. OIL never affects Annual Leave totals.

## Allocation Algorithm

When an OIL request is submitted:

1. Calculate its scheduled leave dates after excluding weekends, unscheduled days, and Singapore public holidays.
2. Convert a supported single-date half-day request to a 0.5-day requirement; full-day dates require 1 day each.
3. For each leave date, select non-revoked awards valid on that date, ordered by `expires_on`, then `award_date`, then `created_at`.
4. Lock eligible award rows in that order.
5. Subtract allocations attached to pending or approved requests.
6. Allocate the requirement across the earliest-expiring awards.
7. If capacity is insufficient for any leave date, reject the transaction without creating the request, allocations, email, or audit event.

The application performs a preview calculation for clear feedback. Supabase performs the authoritative allocation atomically to prevent simultaneous requests spending the same award.

## Admin Workflow

The existing employee actions gain **Manage Off-in-Lieu**.

The inline manager shows:

- Available OIL.
- Pending OIL.
- Next expiry and days expiring.
- Individual awards with original days, awarded date, expiry, remaining amount, reason, and awarding admin.
- Expired and revoked history.

The **Award Off-in-Lieu** form contains:

- Days, with 0.5 increments.
- Award date.
- Required reason.
- Read-only calculated expiry.

An admin may revoke only unused capacity. A required revocation reason and audit event record the action. Original award values remain visible and immutable.

## Employee Workflow

Add **Off-in-Lieu Leave** to the existing leave type selector.

When selected, the form shows:

- Available and pending OIL.
- The next expiry date and amount expiring.
- A clear unavailable state when no valid award balance exists.

Add a **Duration** control to the existing form:

- Full Day
- Morning Half
- Afternoon Half

The two half-day options appear only for approved half-day leave types. Selecting either one requires a single date and updates the estimate to 0.5 day. Changing to an unsupported leave type resets Duration to Full Day.

## Approver, History, and Notifications

Approval cards and leave history show Morning Half or Afternoon Half beside the date and requested days.

OIL approval context shows:

- Requested days.
- Available and pending balance.
- Awards funding the request and their expiry dates.
- Balance after approval.

Submission, decision, and cancellation emails include the leave type, date, half-day portion when applicable, and requested days.

Calendar attachments remain all-day/date-based because working-hour boundaries are not stored. Their summary and description explicitly state Morning Half or Afternoon Half so the recipient does not mistake the request for a full day.

## API and Local Mode

Add admin-only endpoints to:

- Create an OIL award.
- Revoke an award's unused balance.

Dashboard responses include employee-visible OIL summary data and admin-only award detail. They do not expose unrelated employees' awards to normal employees.

Local JSON mode receives matching `offInLieuAwards`, `offInLieuAllocations`, and `dayPortion` fields so local development behaves like production. Existing local data is normalized with empty OIL collections and `full` day portions.

## Supabase Enforcement and Security

The migration is additive and idempotent.

- Enable RLS on both new tables.
- Revoke access from `anon` and `authenticated`.
- Grant required table access only to `service_role`.
- Use a security-invoker trigger for atomic OIL allocation.
- Do not expose a callable privileged allocation function to public roles.
- Lock awards in a deterministic order to reduce deadlock risk.
- Add indexes for employee and expiry lookup, request allocation lookup, and active-capacity aggregation.

The existing leave cap trigger remains responsible for Medical and entitlement-backed leave. OIL allocation is isolated in its own trigger and tables.

## Error Handling

Return specific errors for:

- No unexpired OIL balance.
- OIL balance insufficient for the requested date or dates.
- An award expires before a requested leave date.
- Another request reserved the remaining OIL first.
- Invalid award amount, date, or reason.
- Attempt to revoke an award with pending allocations.
- Invalid half-day leave type.
- Half-day request covering multiple dates.
- Half-day request on a weekend, unscheduled day, or public holiday.
- Missing Medical Certificate for half-day Medical Leave.

Database failures must not leave partial requests, allocations, email records, or audit events.

## Rollout

1. Back up production Supabase data and record baseline row counts.
2. Apply the additive migration with OIL enforcement unavailable until the schema and trigger checks pass.
3. Verify RLS, grants, constraints, indexes, and atomic concurrency behavior in staging.
4. Deploy application code that understands the new tables and defaults all historical requests to Full Day.
5. Have admins create OIL awards for current employee balances.
6. Enable OIL applications after the award data is reviewed.
7. Smoke-test Full Day, Morning Half, and Afternoon Half requests in production using controlled accounts.
8. Confirm approval, rejection, cancellation, balances, emails, audit events, and calendar text.

Rollback disables OIL request creation and hides the new controls. Additive tables and columns remain intact so no award or request history is lost.

## Testing

Automated tests cover:

- Exact one-year expiry boundary, including 29 February.
- Multiple overlapping awards and earliest-expiry-first allocation.
- A multi-day request split across awards.
- Pending reservation, approval retention, rejection release, and cancellation release.
- Award revocation restrictions and audit history.
- Two simultaneous requests competing for the final OIL balance.
- Full-day compatibility for all historical request shapes.
- Morning and afternoon 0.5-day calculation.
- Single-date and permitted-type validation.
- Annual, Urgent, Medical, OIL, and Unpaid half-day requests.
- Whole-day enforcement for all excluded leave types.
- Medical Certificate enforcement for half-day Medical Leave.
- Weekend, schedule, and public-holiday rejection.
- Dashboard summaries and role-based data visibility.
- Admin award UI, employee estimate, approval context, history, emails, audit records, and calendar text.
- Local JSON and Supabase row-mapping round trips.
- Migration idempotency, RLS, grants, constraints, indexes, and trigger behavior.
- Regression coverage for all existing leave and claim workflows.

## Out of Scope

- Employee self-awarding or transferring OIL.
- Automatic OIL generation from overtime, attendance, or timesheets.
- Carrying OIL into a separate annual balance.
- Configurable expiry durations.
- Hourly leave or custom start and end times.
- Half-days for Hospitalization, Compassionate, Paternity, Maternity, Childcare, or National Service Leave.
- Partial first-day or last-day selections within a multi-day request.
