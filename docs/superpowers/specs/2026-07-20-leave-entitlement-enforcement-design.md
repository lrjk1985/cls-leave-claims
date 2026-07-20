# Leave Entitlement Enforcement Design

**Date:** 2026-07-20

**Status:** Approved design, pending written-spec review

## Objective

Add entitlement, eligibility, expiry, document, and cap enforcement for Hospitalization, Compassionate, Paternity, Maternity, Childcare, and National Service Leave without changing the established Annual Leave workflow or losing existing Medical Leave balances.

The rollout must be additive, auditable, reversible by leave type, and safe under concurrent production requests.

## Scope

This design covers:

- Employee work schedules.
- Service-based Medical and Hospitalization entitlements.
- Annual Compassionate and Childcare entitlements.
- Event-based Paternity and Maternity grants.
- Uncapped, document-based National Service Leave.
- Employee, admin, and approver workflows.
- Supabase schema additions, atomic enforcement, RLS, and staged activation.
- Local-mode compatibility and automated testing.

This design does not change:

- Annual Leave, carry-forward, birthday leave, or annual adjustments.
- Medical Claims or other claim workflows.
- Existing roles, approver routing, branding, navigation, or page structure.
- Existing leave records. Historical requests remain valid and visible.

## Approved Policies

### Employee Work Schedule

- Every employee has an explicit weekly work schedule.
- Existing and newly created employees default to Monday through Friday.
- Leave that uses scheduled working days counts only dates selected in the employee's work schedule and excludes Singapore public holidays.
- Event-based entitlements snapshot the work schedule when HR creates the grant. Later schedule changes do not recalculate an existing event grant.

### Medical and Hospitalization Leave

- Medical Leave is paid outpatient sick leave.
- The full-service outpatient cap is 14 scheduled working days.
- Medical and Hospitalization Leave share a combined cap of 60 scheduled working days.
- Medical Leave consumes both the 14-day outpatient pool and the 60-day combined pool.
- Hospitalization Leave consumes only the combined pool.
- Example: after 14 Medical Leave days, 46 Hospitalization Leave days remain.
- Pending requests reserve both applicable pools.
- Both leave types require a Medical Certificate or hospitalization document.
- Entitlement is calculated from completed service months:
  - Fewer than 3 months: 0 outpatient / 0 combined.
  - 3 months: 5 outpatient / 15 combined.
  - 4 months: 8 outpatient / 30 combined.
  - 5 months: 11 outpatient / 45 combined.
  - 6 or more months: 14 outpatient / 60 combined.
- HR can override either entitlement. Overrides are audited and do not alter the employee's service start date.

Reference: [MOM Sick Leave Eligibility and Entitlement](https://www.mom.gov.sg/employment-practices/leave/sick-leave/eligibility-and-entitlement)

### Compassionate Leave

- 3 scheduled working days per calendar year.
- Available to every active employee.
- No carry-forward.
- Pending and approved requests consume the annual entitlement.
- HR can override entitlement or remaining balance through an audited adjustment.

### Paternity Leave

- HR verifies eligibility before creating a grant.
- The grant records the qualifying event date.
- Entitlement is 4 multiplied by the employee's scheduled working days per week, capped at 6 working days per week.
- The work schedule is snapshotted when the grant is created.
- The grant expires 12 months after the event date.
- Pending and approved requests consume the grant.
- HR can override entitlement and expiry.
- If no active verified grant exists, the employee cannot submit Paternity Leave.

Reference: [MOM Paternity Leave](https://www.mom.gov.sg/employment-practices/leave/paternity-leave)

### Maternity Leave

- HR verifies eligibility before creating a grant.
- The first version supports one continuous 16-week period only.
- The period counts calendar days and includes weekends, non-working days, and public holidays.
- The grant is 112 calendar days.
- HR records the event date, grant start, and grant end.
- The employee request must stay within the granted continuous period.
- Flexible use of the final 8 weeks is outside this version.
- HR can override the entitlement period with an audited reason.

Reference: [MOM Planning Maternity Leave](https://www.mom.gov.sg/employment-practices/leave/maternity-leave/planning-your-leave)

### Childcare Leave

- This is a company benefit managed by HR.
- HR verifies and activates eligibility.
- The system stores only the child's date of birth. It does not store the child's name or citizenship.
- Entitlement is 6 scheduled working days per calendar year while HR keeps eligibility active.
- Eligibility does not automatically end when the child reaches age 7.
- There is no lifetime cap.
- No carry-forward.
- Pending and approved requests consume the annual entitlement.
- HR can deactivate eligibility or override entitlement and remaining balance.

### National Service Leave

- No annual entitlement cap.
- The employee uploads an official call-up notice.
- The requested date range represents the call-up period.
- The system reports scheduled working days affected but does not show a remaining balance.
- HR or the assigned approver verifies the supporting document.
- National Service Leave does not consume any other leave balance.

Reference: [Singapore Enlistment Act, Part 6](https://sso.agc.gov.sg/Act/EA1970?ProvIds=P16-)

## Architecture

Use a hybrid staged model:

- Keep existing Annual Leave fields and calculations unchanged.
- Keep existing Medical Leave fields during migration so current balances remain recoverable.
- Add normalized entitlement grants for new leave types.
- Link entitlement-backed requests to a specific grant.
- Derive remaining balances from grants, adjustments, and requests. Do not persist a second mutable remaining value.
- Keep National Service Leave uncapped and document-based.
- Enforce rules in both application code and Supabase.

This avoids a high-risk migration of working Annual Leave behavior while preventing one column pair per new leave type.

## Data Model

### `cls_users` Additions

Add:

- `work_schedule jsonb not null default '[1,2,3,4,5]'::jsonb`
- `medical_leave_entitlement_override numeric(7,2)`

Values use ISO weekday numbers, where Monday is 1 and Sunday is 7. Validation requires a non-empty array containing unique integers from 1 through 7.

The existing `medical_leave_entitlement` value remains untouched during shadow mode. The new nullable override records an explicit HR decision separately from the service-based calculation. Before Medical/Hospitalization enforcement is enabled, HR reviews any employee whose stored entitlement differs from the automatic service-based entitlement. The combined Hospitalization override is stored on that employee's annual Hospitalization entitlement grant.

### `cls_leave_entitlements`

Create an additive table with:

- `id text primary key`
- `employee_id text not null references cls_users(id) on delete cascade`
- `leave_type text not null`
- `period_kind text not null` with `annual`, `event`, or `continuous`
- `period_year integer`
- `event_date date`
- `valid_from date not null`
- `valid_until date`
- `base_days numeric(7,2) not null check (base_days >= 0)`
- `override_days numeric(7,2)`
- `eligibility_verified boolean not null default false`
- `eligibility_verified_by text references cls_users(id)`
- `eligibility_verified_at timestamptz`
- `work_schedule_snapshot jsonb`
- `child_birth_date date`
- `active boolean not null default true`
- `created_by text references cls_users(id)`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Annual grants are unique by employee, leave type, and period year. Event and continuous grants may have multiple historical records but cannot have overlapping active periods for the same employee and leave type.

Effective entitlement is `override_days` when present; otherwise it is `base_days`.

At calendar-year rollover, the system creates the new Compassionate grant for every active employee. It creates a new Childcare grant only when the latest Childcare eligibility remains active, copying the verified status and child date of birth while resetting annual usage to zero.

### `cls_leave_entitlement_adjustments`

Create an append-only table with:

- `id text primary key`
- `entitlement_id text not null references cls_leave_entitlements(id) on delete cascade`
- `actor_id text references cls_users(id)`
- `days numeric(7,2) not null`
- `reason text not null`
- `created_at timestamptz not null default now()`

When an admin enters a desired remaining balance, the server converts that value into an adjustment. Approved and pending requests are never rewritten.

### `cls_leave_requests` Additions

Add:

- `entitlement_id text references cls_leave_entitlements(id)`
- `counting_method text not null default 'scheduled_working_days'`
- `work_schedule_snapshot jsonb`
- `supporting_document jsonb`

Allowed counting methods are `scheduled_working_days`, `calendar_days`, and `uncapped_scheduled_days`.

Existing requests keep a null entitlement link and retain their current values.

### `cls_leave_policy_settings`

Create a service-role-only table with:

- `leave_type text primary key`
- `enforcement_enabled boolean not null default false`
- `updated_at timestamptz not null default now()`
- `updated_by text references cls_users(id)`

This table controls staged enforcement by leave type. It does not allow admins to redefine statutory calculations.

## Balance Calculations

For entitlement-backed leave:

```text
effective entitlement
+ entitlement adjustments
- approved request days
- pending request days
= unreserved balance
```

Available balance shown after approval excludes approved days but displays pending separately.

Medical balances are coupled:

```text
outpatient unreserved
= outpatient entitlement
- approved Medical Leave
- pending Medical Leave

combined unreserved
= combined entitlement
- approved Medical Leave
- pending Medical Leave
- approved Hospitalization Leave
- pending Hospitalization Leave
```

A Medical Leave request must fit both pools. A Hospitalization Leave request must fit the combined pool.

## User Workflows

### Admin

The existing Employee row remains intact. Its More menu gains `Manage Entitlements`, which expands a full-width section beneath that employee.

The section contains:

- Work schedule controls.
- Medical and Hospitalization calculated caps and overrides.
- Annual Compassionate and Childcare entitlements.
- Childcare eligibility status and child date of birth.
- Event-grant creation for Paternity and Maternity.
- Used, pending, remaining, valid dates, and expiry.
- Adjustment history and required adjustment reason.

All eligibility, grant, schedule, override, and adjustment changes create audit events.

### Employee

The Leave page shows a compact entitlement summary for each available leave type:

- Entitlement.
- Approved usage.
- Pending usage.
- Remaining or unreserved balance.
- Expiry when applicable.
- Eligibility or unavailable state.

Selecting a leave type updates the counting explanation and document field. Before submission, the page shows requested units and expected remaining balance.

### Approver

The existing approval card additionally shows:

- Eligibility verification.
- Linked entitlement period.
- Supporting document.
- Entitlement, approved, pending, and remaining values.
- Remaining balance after approval.

Approval revalidates the request. A stale or over-cap request cannot be approved.

## Atomic Enforcement

Application validation alone is insufficient because production Vercel requests can load the same Supabase snapshot concurrently.

Add a Supabase trigger that:

1. Locks the relevant entitlement row for entitlement-backed requests.
2. Locks the employee row for coupled Medical and Hospitalization requests.
3. Recalculates approved and pending usage inside the database transaction.
4. Rejects inserts or updates that exceed an enabled entitlement.
5. Prevents reducing a grant below already reserved usage unless an explicit audited override path is used.

The trigger is a security-invoker function. Tables remain RLS-enabled. `anon` and `authenticated` receive no table or function access. Only `service_role` receives required privileges.

Application code performs the same checks first so users receive readable messages. The database trigger remains the final concurrency guard.

## Error Handling

Return specific user-facing errors for:

- No active entitlement.
- Eligibility not verified.
- Entitlement not yet valid.
- Entitlement expired.
- Request outside a continuous Maternity period.
- Request exceeds remaining entitlement.
- Request exceeds the outpatient or combined medical pool.
- Missing Medical Certificate, hospitalization document, or NS call-up notice.
- Another request consumed the remaining balance before this request saved.
- Admin adjustment would place a grant below reserved usage.

Failed database enforcement must not create leave-request email or audit side effects. The current Supabase save order must continue writing the leave request before its related email and audit records.

## Rollout

### Stage 1: Additive Schema

- Add tables and columns.
- Enable RLS and service-role-only grants.
- Backfill all employees with Monday-through-Friday schedules.
- Keep all new enforcement settings disabled.
- Preserve existing requests and balances.

### Stage 2: Shadow Calculations

- Load and save entitlement data.
- Generate Medical/Hospitalization, Compassionate, and eligible Childcare calculations.
- Allow HR to create Paternity and Maternity grants.
- Display calculated balances to admins without blocking submissions.
- Produce audit records for discrepancies and configuration changes.

### Stage 3: Medical Enforcement

- Verify service-month calculations against employee records.
- Enable combined Medical/Hospitalization enforcement.
- Monitor rejected submissions and adjustment usage.

### Stage 4: Annual Special Leave

- Enable Compassionate enforcement.
- Enable Childcare enforcement after HR confirms eligibility records.

### Stage 5: Event Grants

- Enable Paternity enforcement after active grants are configured.
- Enable continuous Maternity enforcement after active grants are configured.

### Stage 6: National Service Documents

- Require call-up documents for new NS requests.
- Keep NS Leave uncapped.

Each stage can be disabled independently without deleting data or reverting the schema.

## Testing

### Domain Tests

- Service entitlement at one day before and on each 3-, 4-, 5-, and 6-month boundary.
- Coupled Medical and Hospitalization usage.
- Pending reservation and cancellation release.
- Monday-to-Friday and nonstandard employee schedules.
- Paternity entitlement snapshots and expiry.
- Continuous Maternity calendar-day counting.
- Compassionate and Childcare annual reset without carry-forward.
- Childcare eligibility activation and deactivation.
- NS scheduled-day reporting without a balance.

### Server Tests

- Grant creation, update, override, adjustment, and audit events.
- Employee request validation for every leave type.
- Approval-time revalidation.
- Document requirements.
- Existing Annual, Urgent, Unpaid, and Medical workflows remain compatible.
- Local JSON and Supabase row mapping round trips.

### Supabase Integration Tests

- Migration succeeds on the existing schema.
- RLS and grants expose new tables only to `service_role`.
- Two simultaneous requests competing for the last available days result in exactly one success.
- Trigger enforcement matches application calculations.
- No email or audit side effects are written after a rejected request.
- Disabling one policy setting restores non-blocking behavior for that leave type.

### Browser Verification

- Employee, approver, and admin flows on desktop and mobile.
- Work-schedule editing.
- Inline entitlement expansion within the existing Employee table.
- Clear unavailable, expired, over-cap, missing-document, loading, and success states.
- Keyboard navigation and screen-reader labels remain functional.

## Deployment and Rollback

- Apply the additive Supabase migration before deploying application code that reads the new columns.
- Verify new table grants and schema cache before enabling shadow calculations.
- Keep enforcement disabled until entitlement backfill is reviewed.
- Roll back behavior by disabling the relevant `cls_leave_policy_settings` row.
- Do not drop new columns or tables during behavioral rollback.
- Back up production tables before the migration and record row counts before and after backfill.

## Success Criteria

- Existing Annual and Medical balances remain correct after migration.
- Every capped leave request displays and enforces the approved entitlement rules.
- Pending requests reserve capacity.
- Concurrent requests cannot exceed entitlement.
- Admin overrides and adjustments remain separate from original entitlement and are fully audited.
- Maternity uses calendar days; scheduled-day leave uses each employee's work schedule.
- NS Leave remains uncapped but requires supporting documentation.
- Enforcement can be enabled or disabled independently by leave type.
