# Leave Entitlement Enforcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Safely enforce approved Medical/Hospitalization, Compassionate, Paternity, Maternity, Childcare, and National Service Leave policies while preserving existing Annual Leave and Medical Claims behavior.

**Architecture:** Keep existing Annual Leave storage and calculations unchanged. Add a focused entitlement domain module, normalized entitlement records, employee work schedules, application validation, and an atomic Supabase trigger. Roll out calculations in shadow mode before enabling each leave type independently.

**Tech Stack:** Node.js 20+, vanilla JavaScript, Node test runner, PostgreSQL/Supabase REST, Vercel Functions, existing CSS design system.

## Global Constraints

- Preserve existing colors, typography, branding, navigation, layouts, roles, approver routing, Annual Leave, Medical Claims, Urgent Leave, and Unpaid Leave workflows.
- No new runtime package beyond the existing platform APIs.
- Existing users default to a Monday-through-Friday work schedule.
- Existing leave requests remain readable with null entitlement links.
- Remaining balances are derived, not stored independently.
- Pending requests reserve entitlement.
- Application validation provides readable feedback; Supabase performs the final atomic check.
- New Supabase tables use RLS, revoke `anon` and `authenticated`, and grant only `service_role`.
- Each leave type remains independently switchable until production verification completes.
- Follow TDD for every behavior change: failing test, observed failure, minimal implementation, passing test.

## File Map

- Create `src/leaveEntitlements.js`: policy constants, schedule normalization, service proration, day counting, entitlement summaries, grant matching, and coupled medical calculations.
- Modify `src/domain.js`: delegate special-leave classification and counting to the new module while retaining existing exports.
- Modify `server.js`: persistence mappings, maintenance, admin APIs, request validation, audit events, dashboard data, and document handling.
- Modify `public/app.js`: work-schedule controls, entitlement management, employee summaries, request feedback, and approval context.
- Modify `public/styles.css`: existing-design-system styles for inline entitlement management and responsive summaries.
- Create `supabase/v2-leave-entitlements.sql`: additive schema, RLS/grants, backfill, indexes, policy settings, and atomic trigger.
- Modify `supabase/v1-rollout.sql`: append the v2 schema for clean installations after v2 is verified.
- Create `tests/leaveEntitlements.test.js`: focused domain tests.
- Modify `tests/domain.test.js`: compatibility tests for existing summaries.
- Modify `tests/server.test.js`: persistence, APIs, validation, maintenance, audit, and document tests.
- Modify `tests/ui.test.js`: source-level UI contract tests.
- Create `tests/supabaseEntitlements.test.js`: SQL structure and optional live concurrency tests.
- Modify `docs/PRODUCTION_ROLLOUT.md`: migration, shadow verification, staged activation, rollback, and production checks.

---

### Task 1: Entitlement Domain Foundation

**Files:**
- Create: `src/leaveEntitlements.js`
- Create: `tests/leaveEntitlements.test.js`
- Modify: `src/domain.js:1-210`
- Test: `tests/domain.test.js`

**Interfaces:**
- Produces: `LEAVE_TYPES`, `COUNTING_METHODS`, `normalizeWorkSchedule(value)`, `scheduledDaysBetween(startDate, endDate, schedule, holidays)`, `calendarDaysBetween(startDate, endDate)`, `serviceMedicalEntitlement(serviceStartDate, asOfDate)`, `paternityGrantDays(schedule)`, `isSpecialLeaveType(type)`, and `requiresSupportingDocument(type)`.
- Preserves: existing `isMedicalLeaveType(type)` and all existing `src/domain.js` exports.

- [ ] **Step 1: Write failing schedule and proration tests**

Create `tests/leaveEntitlements.test.js` with these exact cases:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  calendarDaysBetween,
  normalizeWorkSchedule,
  paternityGrantDays,
  scheduledDaysBetween,
  serviceMedicalEntitlement
} = require("../src/leaveEntitlements");

test("normalizeWorkSchedule defaults to Monday through Friday and rejects invalid schedules", () => {
  assert.deepEqual(normalizeWorkSchedule(), [1, 2, 3, 4, 5]);
  assert.deepEqual(normalizeWorkSchedule([5, 1, 3]), [1, 3, 5]);
  assert.throws(() => normalizeWorkSchedule([]), /at least one working day/);
  assert.throws(() => normalizeWorkSchedule([1, 1]), /unique/);
  assert.throws(() => normalizeWorkSchedule([0, 8]), /between 1 and 7/);
});

test("scheduledDaysBetween uses the employee schedule and public holidays", () => {
  assert.equal(scheduledDaysBetween("2026-07-20", "2026-07-26", [1, 3, 5]), 3);
  assert.equal(
    scheduledDaysBetween("2026-07-20", "2026-07-26", [1, 3, 5], [{ date: "2026-07-22" }]),
    2
  );
});

test("calendarDaysBetween includes weekends and public holidays", () => {
  assert.equal(calendarDaysBetween("2026-07-20", "2026-11-08"), 112);
});

test("serviceMedicalEntitlement follows completed service-month boundaries", () => {
  assert.deepEqual(serviceMedicalEntitlement("2026-01-15", "2026-04-14"), { outpatient: 0, combined: 0 });
  assert.deepEqual(serviceMedicalEntitlement("2026-01-15", "2026-04-15"), { outpatient: 5, combined: 15 });
  assert.deepEqual(serviceMedicalEntitlement("2026-01-15", "2026-05-15"), { outpatient: 8, combined: 30 });
  assert.deepEqual(serviceMedicalEntitlement("2026-01-15", "2026-06-15"), { outpatient: 11, combined: 45 });
  assert.deepEqual(serviceMedicalEntitlement("2026-01-15", "2026-07-15"), { outpatient: 14, combined: 60 });
});

test("paternityGrantDays snapshots four work weeks and caps six days per week", () => {
  assert.equal(paternityGrantDays([1, 2, 3, 4, 5]), 20);
  assert.equal(paternityGrantDays([1, 2, 3, 4, 5, 6]), 24);
  assert.equal(paternityGrantDays([1, 2, 3, 4, 5, 6, 7]), 24);
});
```

- [ ] **Step 2: Run tests and observe RED**

Run:

```bash
node --test tests/leaveEntitlements.test.js
```

Expected: FAIL with `Cannot find module '../src/leaveEntitlements'`.

- [ ] **Step 3: Implement the minimal domain module**

Create `src/leaveEntitlements.js` with constants and pure functions. Use existing `assertIsoDate`, `formatIsoDate`, and date-loop patterns by moving those generic helpers into this module or exporting them without changing behavior. Core policy declarations must be:

```js
const LEAVE_TYPES = Object.freeze({
  ANNUAL: "Annual Leave",
  MEDICAL: "Medical Leave",
  HOSPITALIZATION: "Hospitalization Leave",
  COMPASSIONATE: "Compassionate Leave",
  PATERNITY: "Paternity Leave",
  MATERNITY: "Maternity Leave",
  CHILDCARE: "Childcare Leave",
  NATIONAL_SERVICE: "National Service Leave",
  URGENT: "Urgent Leave",
  UNPAID: "Unpaid Leave"
});

const COUNTING_METHODS = Object.freeze({
  SCHEDULED: "scheduled_working_days",
  CALENDAR: "calendar_days",
  UNCAPPED_SCHEDULED: "uncapped_scheduled_days"
});

const DOCUMENT_REQUIRED_TYPES = new Set([
  LEAVE_TYPES.MEDICAL.toLowerCase(),
  LEAVE_TYPES.HOSPITALIZATION.toLowerCase(),
  LEAVE_TYPES.NATIONAL_SERVICE.toLowerCase()
]);
```

Implement service-month comparison by anniversary day, not by dividing milliseconds. Return the exact entitlement table from the approved specification.

- [ ] **Step 4: Preserve compatibility through `src/domain.js`**

Import and re-export the classification helpers. Keep `leaveSummary` excluding special leave and keep `medicalLeaveSummary` counting only `Medical Leave`. Do not change Annual, Urgent, or Unpaid calculations.

- [ ] **Step 5: Run focused and compatibility tests**

Run:

```bash
node --test tests/leaveEntitlements.test.js tests/domain.test.js
```

Expected: PASS with zero failures.

- [ ] **Step 6: Commit domain foundation**

```bash
git add src/leaveEntitlements.js src/domain.js tests/leaveEntitlements.test.js tests/domain.test.js
git commit -m "Add leave entitlement domain rules"
```

---

### Task 2: Local and Supabase Persistence Shapes

**Files:**
- Modify: `server.js:430-900`
- Modify: `tests/server.test.js`
- Create: `supabase/v2-leave-entitlements.sql`
- Create: `tests/supabaseEntitlements.test.js`

**Interfaces:**
- Consumes: policy constants and work-schedule normalization from Task 1.
- Produces: local DB arrays `leaveEntitlements`, `leaveEntitlementAdjustments`, and `leavePolicySettings`; user fields `workSchedule` and `medicalLeaveEntitlementOverride`; request fields `entitlementId`, `countingMethod`, `workScheduleSnapshot`, and `supportingDocument`.

- [ ] **Step 1: Write failing normalization and mapping tests**

Extend `tests/server.test.js` so `normalizeDb`, exported through `__test`, defaults the new arrays and fields:

```js
test("normalizeDb adds entitlement collections and default work schedules", () => {
  const db = __test.normalizeDb({ users: [{ id: "u1", serviceStartDate: "2026-01-01" }] });
  assert.deepEqual(db.leaveEntitlements, []);
  assert.deepEqual(db.leaveEntitlementAdjustments, []);
  assert.deepEqual(db.leavePolicySettings, []);
  assert.deepEqual(db.users[0].workSchedule, [1, 2, 3, 4, 5]);
});
```

Expand the existing Supabase mapping round-trip test with one record for each new table and the new user/request fields.

- [ ] **Step 2: Observe RED**

```bash
node --test tests/server.test.js
```

Expected: FAIL because `normalizeDb` is not exported and new collections/mappings are absent.

- [ ] **Step 3: Add app data normalization and mappings**

Add exact mapping functions in `server.js`:

```js
function leaveEntitlementToRow(entitlement) {
  return {
    id: entitlement.id,
    employee_id: entitlement.employeeId,
    leave_type: entitlement.leaveType,
    period_kind: entitlement.periodKind,
    period_year: nullish(entitlement.periodYear),
    event_date: nullish(entitlement.eventDate),
    valid_from: entitlement.validFrom,
    valid_until: nullish(entitlement.validUntil),
    base_days: Number(entitlement.baseDays || 0),
    override_days: entitlement.overrideDays === null || entitlement.overrideDays === undefined
      ? null
      : Number(entitlement.overrideDays),
    eligibility_verified: Boolean(entitlement.eligibilityVerified),
    eligibility_verified_by: nullish(entitlement.eligibilityVerifiedBy),
    eligibility_verified_at: nullish(entitlement.eligibilityVerifiedAt),
    work_schedule_snapshot: entitlement.workScheduleSnapshot || null,
    child_birth_date: nullish(entitlement.childBirthDate),
    active: Boolean(entitlement.active),
    created_by: nullish(entitlement.createdBy),
    created_at: entitlement.createdAt,
    updated_at: entitlement.updatedAt
  };
}

function leaveEntitlementFromRow(row) {
  return {
    id: row.id,
    employeeId: row.employee_id,
    leaveType: row.leave_type,
    periodKind: row.period_kind,
    periodYear: row.period_year === null ? null : Number(row.period_year),
    eventDate: row.event_date,
    validFrom: row.valid_from,
    validUntil: row.valid_until,
    baseDays: Number(row.base_days || 0),
    overrideDays: row.override_days === null ? null : Number(row.override_days),
    eligibilityVerified: Boolean(row.eligibility_verified),
    eligibilityVerifiedBy: row.eligibility_verified_by,
    eligibilityVerifiedAt: row.eligibility_verified_at,
    workScheduleSnapshot: row.work_schedule_snapshot,
    childBirthDate: row.child_birth_date,
    active: Boolean(row.active),
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function leaveEntitlementAdjustmentToRow(adjustment) {
  return {
    id: adjustment.id,
    entitlement_id: adjustment.entitlementId,
    actor_id: nullish(adjustment.actorId),
    days: Number(adjustment.days),
    reason: adjustment.reason,
    created_at: adjustment.createdAt
  };
}

function leaveEntitlementAdjustmentFromRow(row) {
  return {
    id: row.id,
    entitlementId: row.entitlement_id,
    actorId: row.actor_id,
    days: Number(row.days),
    reason: row.reason,
    createdAt: row.created_at
  };
}

function leavePolicySettingToRow(setting) {
  return {
    leave_type: setting.leaveType,
    enforcement_enabled: Boolean(setting.enforcementEnabled),
    updated_at: setting.updatedAt,
    updated_by: nullish(setting.updatedBy)
  };
}

function leavePolicySettingFromRow(row) {
  return {
    leaveType: row.leave_type,
    enforcementEnabled: Boolean(row.enforcement_enabled),
    updatedAt: row.updated_at,
    updatedBy: row.updated_by
  };
}
```

Append these exact `SUPABASE_TABLES` entries:

```js
{ field: "leaveEntitlements", table: "cls_leave_entitlements", key: "id", order: "created_at.desc", toRow: leaveEntitlementToRow, fromRow: leaveEntitlementFromRow },
{ field: "leaveEntitlementAdjustments", table: "cls_leave_entitlement_adjustments", key: "id", order: "created_at.desc", toRow: leaveEntitlementAdjustmentToRow, fromRow: leaveEntitlementAdjustmentFromRow },
{ field: "leavePolicySettings", table: "cls_leave_policy_settings", key: "leave_type", order: "leave_type.asc", toRow: leavePolicySettingToRow, fromRow: leavePolicySettingFromRow }
```

Update `normalizeDb`, `normalizeUser`, request row mappings, local seeds, and production seeds. Export `normalizeDb` for tests.

- [ ] **Step 4: Write failing SQL structure tests**

Create `tests/supabaseEntitlements.test.js` to read `supabase/v2-leave-entitlements.sql` and assert:

```js
assert.match(sql, /create table if not exists public\.cls_leave_entitlements/i);
assert.match(sql, /create table if not exists public\.cls_leave_entitlement_adjustments/i);
assert.match(sql, /create table if not exists public\.cls_leave_policy_settings/i);
assert.match(sql, /alter table public\.cls_leave_requests[\s\S]*entitlement_id/i);
assert.match(sql, /enable row level security/i);
assert.match(sql, /revoke all[\s\S]*from anon, authenticated/i);
assert.match(sql, /grant select, insert, update, delete[\s\S]*to service_role/i);
```

- [ ] **Step 5: Observe SQL RED**

```bash
node --test tests/supabaseEntitlements.test.js
```

Expected: FAIL because `supabase/v2-leave-entitlements.sql` does not exist.

- [ ] **Step 6: Create additive schema SQL**

Create `supabase/v2-leave-entitlements.sql` using only additive `create table if not exists` and `add column if not exists` statements. Include:

```sql
alter table public.cls_users
  add column if not exists work_schedule jsonb not null default '[1,2,3,4,5]'::jsonb,
  add column if not exists medical_leave_entitlement_override numeric(7,2);

alter table public.cls_leave_requests
  add column if not exists entitlement_id text,
  add column if not exists counting_method text not null default 'scheduled_working_days',
  add column if not exists work_schedule_snapshot jsonb,
  add column if not exists supporting_document jsonb;
```

Create the three approved tables, foreign keys, unique annual-grant index, lookup indexes, RLS, revocations, and `service_role` grants. Insert one disabled `cls_leave_policy_settings` row for each new enforced leave type. Backfill null work schedules to `[1,2,3,4,5]` with an explicit `where work_schedule is null` clause.

- [ ] **Step 7: Run persistence and SQL tests**

```bash
node --test tests/server.test.js tests/supabaseEntitlements.test.js
```

Expected: PASS with zero failures.

- [ ] **Step 8: Commit persistence foundation**

```bash
git add server.js tests/server.test.js supabase/v2-leave-entitlements.sql tests/supabaseEntitlements.test.js
git commit -m "Add leave entitlement persistence schema"
```

---

### Task 3: Grant Summaries and Shadow Mode

**Files:**
- Modify: `src/leaveEntitlements.js`
- Modify: `server.js:950-1180,2550-2670`
- Modify: `tests/leaveEntitlements.test.js`
- Modify: `tests/server.test.js`

**Interfaces:**
- Produces: `entitlementSummary(entitlement, requests, adjustments, options)`, `medicalHospitalizationSummary(user, requests, options)`, `findActiveEntitlement(entitlements, criteria)`, `policyEnforcementEnabled(db, type)`, and dashboard field `leaveEntitlementSummaries`.

- [ ] **Step 1: Write failing summary tests**

Add tests proving:

```js
test("entitlementSummary reserves pending days and applies adjustments", () => {
  const summary = entitlementSummary(
    { id: "ent_1", baseDays: 6, overrideDays: null },
    [
      { entitlementId: "ent_1", status: "approved", days: 2 },
      { entitlementId: "ent_1", status: "pending", days: 1 }
    ],
    [{ entitlementId: "ent_1", days: 0.5 }]
  );
  assert.deepEqual(summary, {
    entitlement: 6,
    adjustments: 0.5,
    approved: 2,
    pending: 1,
    available: 4.5,
    unreserved: 3.5
  });
});

test("medicalHospitalizationSummary enforces outpatient and combined pools", () => {
  const summary = medicalHospitalizationSummary(
    { id: "u1", serviceStartDate: "2025-01-01", medicalLeaveEntitlementOverride: null },
    [
      { employeeId: "u1", type: "Medical Leave", status: "approved", days: 10, leaveYear: 2026 },
      { employeeId: "u1", type: "Hospitalization Leave", status: "pending", days: 20, leaveYear: 2026 }
    ],
    { year: 2026, asOfDate: "2026-07-20" }
  );
  assert.equal(summary.outpatient.unreserved, 4);
  assert.equal(summary.combined.unreserved, 30);
});
```

- [ ] **Step 2: Observe RED**

```bash
node --test tests/leaveEntitlements.test.js
```

Expected: FAIL because summary functions are missing.

- [ ] **Step 3: Implement pure summaries and matching**

Implement functions with no I/O. `findActiveEntitlement` must require matching employee/type, active status, verified eligibility when required, valid dates, and matching year for annual grants. It returns one record or `null`; overlapping records throw a configuration error.

- [ ] **Step 4: Seed shadow-mode settings and dashboard data**

Add disabled settings for Hospitalization, Compassionate, Paternity, Maternity, Childcare, and National Service. Keep current Medical validation active. Add summaries and setting status to employee, admin, and approver dashboard payloads without changing submission behavior while the relevant setting is disabled.

- [ ] **Step 5: Write and run dashboard tests**

Add a server test asserting shadow summaries appear but a disabled Compassionate setting does not block a request with no grant.

```bash
node --test tests/leaveEntitlements.test.js tests/server.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit shadow calculations**

```bash
git add src/leaveEntitlements.js server.js tests/leaveEntitlements.test.js tests/server.test.js
git commit -m "Add leave entitlement shadow calculations"
```

---

### Task 4: Work Schedule and Entitlement Admin APIs

**Files:**
- Modify: `server.js:2750-2890,3500-3595`
- Modify: `tests/server.test.js`

**Interfaces:**
- Produces endpoints `PATCH /api/employees/:id/work-schedule`, `POST /api/leave-entitlements`, `PATCH /api/leave-entitlements/:id`, and `POST /api/leave-entitlements/:id/adjustments`.
- Produces domain functions `createLeaveEntitlement`, `updateLeaveEntitlement`, `createEntitlementAdjustment`, and `setEmployeeWorkSchedule` exported through `__test`.

- [ ] **Step 1: Write failing admin authorization and audit tests**

Cover:

- Admin can change a work schedule.
- Manager and employee receive HTTP 403.
- Grant creation requires employee, allowed leave type, dates, entitlement, and verified eligibility where applicable.
- Adjustment requires a non-empty reason.
- Setting desired remaining converts to an adjustment without rewriting approved requests.
- Every mutation adds an audit event with before/after metadata.

- [ ] **Step 2: Observe RED**

```bash
node --test tests/server.test.js
```

Expected: FAIL because admin entitlement functions and endpoints are absent.

- [ ] **Step 3: Implement work-schedule mutation**

Use `normalizeWorkSchedule`. Store sorted ISO weekday numbers and update `updatedAt`. Audit action: `employee.work_schedule_updated`.

- [ ] **Step 4: Implement entitlement grant validation**

Enforce exact type rules:

```js
const GRANT_RULES = {
  "Hospitalization Leave": { periodKind: "annual", countingMethod: "scheduled_working_days" },
  "Compassionate Leave": { periodKind: "annual", countingMethod: "scheduled_working_days" },
  "Paternity Leave": { periodKind: "event", countingMethod: "scheduled_working_days", eligibilityRequired: true },
  "Maternity Leave": { periodKind: "continuous", countingMethod: "calendar_days", eligibilityRequired: true },
  "Childcare Leave": { periodKind: "annual", countingMethod: "scheduled_working_days", eligibilityRequired: true }
};
```

Paternity defaults `baseDays` from `paternityGrantDays(workScheduleSnapshot)` and `validUntil` to 12 months after `eventDate`. Maternity requires exactly 112 inclusive calendar days unless an audited override reason is supplied. Childcare stores only `childBirthDate`.

- [ ] **Step 5: Implement adjustments and desired-remaining conversion**

Compute:

```js
adjustmentDays = desiredRemaining - (effectiveEntitlement - approvedDays);
```

Reject quarter-day values, empty reasons, and values that would make unreserved balance negative. Use half-day increments for scheduled-day leave and whole calendar days for continuous Maternity Leave.

- [ ] **Step 6: Add API handlers and dashboard patches**

Return updated employee, entitlement, summary, stale audit state, and affected history keys. Do not return password hashes, salts, or service-role values.

- [ ] **Step 7: Run tests and commit**

```bash
node --test tests/server.test.js
git add server.js tests/server.test.js
git commit -m "Add entitlement administration APIs"
```

---

### Task 5: Combined Medical and Hospitalization Enforcement

**Files:**
- Modify: `src/leaveEntitlements.js`
- Modify: `server.js:2974-3055`
- Modify: `tests/leaveEntitlements.test.js`
- Modify: `tests/server.test.js`
- Modify: `supabase/v2-leave-entitlements.sql`
- Modify: `tests/supabaseEntitlements.test.js`

**Interfaces:**
- Consumes: coupled medical summary and policy settings.
- Produces: application enforcement for both pools and database function `cls_assert_leave_entitlement()` attached to `cls_leave_requests`.

- [ ] **Step 1: Write failing application tests**

Cover service boundaries, outpatient exhaustion, combined exhaustion, pending reservations, Hospitalization documents, admin outpatient override, annual Hospitalization grant override, and cancellation releasing capacity.

Representative assertion:

```js
await assert.rejects(
  () => __test.createLeaveRequest(db, employee, hospitalizationBody),
  /combined Medical and Hospitalization balance has only 1 day remaining/
);
```

- [ ] **Step 2: Observe RED**

```bash
node --test tests/leaveEntitlements.test.js tests/server.test.js
```

Expected: FAIL because Hospitalization remains uncapped.

- [ ] **Step 3: Implement application validation**

For Medical Leave, require the request to fit outpatient and combined unreserved balances. For Hospitalization Leave, require it to fit combined unreserved balance. Keep disabled policy behavior non-blocking during shadow mode, except existing Medical validation remains active until combined enforcement is enabled.

- [ ] **Step 4: Write failing trigger-structure tests**

Assert the SQL contains:

```js
assert.match(sql, /create or replace function public\.cls_assert_leave_entitlement\(\)/i);
assert.match(sql, /for update/i);
assert.match(sql, /before insert or update on public\.cls_leave_requests/i);
assert.match(sql, /security invoker/i);
```

- [ ] **Step 5: Add atomic Supabase trigger**

The PL/pgSQL trigger must:

1. Return immediately when the leave type setting is disabled.
2. Lock `cls_users` for Medical/Hospitalization requests.
3. Lock the linked entitlement for other capped requests.
4. Sum existing `pending` and `approved` rows, excluding `NEW.id` during updates.
5. Include `NEW.days` when `NEW.status` is pending or approved.
6. Raise SQLSTATE `P0001` with a stable `CLS_LEAVE_CAP:` prefix when a pool is exceeded.
7. Run as `security invoker` and remain executable only through service-role table writes.

- [ ] **Step 6: Add optional live concurrency test**

In `tests/supabaseEntitlements.test.js`, skip unless `SUPABASE_TEST_URL` and `SUPABASE_TEST_SERVICE_ROLE_KEY` exist. Insert two simultaneous pending requests competing for one remaining day with `Promise.allSettled`; assert one succeeds and one returns `CLS_LEAVE_CAP`.

- [ ] **Step 7: Verify and commit medical enforcement**

```bash
node --test tests/leaveEntitlements.test.js tests/server.test.js tests/supabaseEntitlements.test.js
git add src/leaveEntitlements.js server.js tests/leaveEntitlements.test.js tests/server.test.js supabase/v2-leave-entitlements.sql tests/supabaseEntitlements.test.js
git commit -m "Enforce combined medical leave limits"
```

---

### Task 6: Compassionate and Childcare Annual Grants

**Files:**
- Modify: `server.js:1020-1150,2974-3055`
- Modify: `src/leaveEntitlements.js`
- Modify: `tests/server.test.js`
- Modify: `tests/leaveEntitlements.test.js`

**Interfaces:**
- Produces maintenance function `ensureAnnualSpecialLeaveEntitlements(db, asOfDate)`.
- Produces annual grant enforcement for Compassionate and Childcare.

- [ ] **Step 1: Write failing annual-grant tests**

Cover:

- Every active employee receives a 3-day Compassionate grant for the current year.
- Inactive employees receive no new grant.
- Childcare receives 6 days only when the previous eligibility remains active.
- Child date of birth copies forward; no name or citizenship field exists.
- No usage carries forward.
- Running maintenance twice is idempotent.
- Pending requests reserve days and over-cap requests fail only when enforcement is enabled.

- [ ] **Step 2: Observe RED**

```bash
node --test tests/leaveEntitlements.test.js tests/server.test.js
```

Expected: FAIL because annual special grants are not generated.

- [ ] **Step 3: Implement idempotent annual maintenance**

Create deterministic grant IDs from employee, type, and year or detect the unique annual key before insertion. Set Compassionate eligibility verified automatically. Copy active Childcare eligibility and `childBirthDate`; do not infer eligibility from age.

- [ ] **Step 4: Integrate maintenance**

Run from existing leave rollover and daily maintenance paths. Add audit events only when grants are created or eligibility changes, not on no-op runs.

- [ ] **Step 5: Apply request validation**

Link new requests to the current annual grant. Block missing, inactive, unverified, or exhausted grants when each setting is enabled.

- [ ] **Step 6: Verify and commit**

```bash
node --test tests/leaveEntitlements.test.js tests/server.test.js
git add src/leaveEntitlements.js server.js tests/leaveEntitlements.test.js tests/server.test.js
git commit -m "Enforce annual special leave grants"
```

---

### Task 7: Paternity and Continuous Maternity Grants

**Files:**
- Modify: `src/leaveEntitlements.js`
- Modify: `server.js:2974-3055`
- Modify: `tests/leaveEntitlements.test.js`
- Modify: `tests/server.test.js`

**Interfaces:**
- Produces event-grant matching and expiry validation.
- Produces Paternity scheduled-day and Maternity calendar-day request counting.

- [ ] **Step 1: Write failing event-grant tests**

Cover:

- Five-day Paternity grant equals 20 days; six-day grant equals 24.
- A later work-schedule change does not change the grant snapshot.
- Paternity request after `validUntil` fails.
- Missing or unverified grant fails.
- Maternity request spanning the full approved block counts 112 calendar days.
- Maternity request outside the approved block fails.
- Maternity permits one active request per grant and the request dates match the approved grant period exactly.
- Weekends and public holidays remain included for Maternity.
- Overlapping active event grants are rejected as configuration errors.

- [ ] **Step 2: Observe RED**

```bash
node --test tests/leaveEntitlements.test.js tests/server.test.js
```

Expected: FAIL because event grants are not matched during requests.

- [ ] **Step 3: Implement event matching and counting**

Use the entitlement's schedule snapshot for Paternity. Use inclusive calendar dates for Maternity. Set request `entitlementId`, `countingMethod`, and `workScheduleSnapshot` before persistence.

- [ ] **Step 4: Enforce event rules in the trigger**

Extend `cls_assert_leave_entitlement()` to verify linked grant activity, eligibility, valid dates, and remaining balance. For Maternity, require the request range to remain inside `valid_from` and `valid_until`.

- [ ] **Step 5: Verify and commit**

```bash
node --test tests/leaveEntitlements.test.js tests/server.test.js tests/supabaseEntitlements.test.js
git add src/leaveEntitlements.js server.js tests/leaveEntitlements.test.js tests/server.test.js supabase/v2-leave-entitlements.sql tests/supabaseEntitlements.test.js
git commit -m "Enforce parental leave grants"
```

---

### Task 8: National Service Supporting Documents

**Files:**
- Modify: `server.js:1820-2045,2974-3055,3470-3710`
- Modify: `public/app.js:900-1100,1880-1920,2710-2745`
- Modify: `tests/server.test.js`
- Modify: `tests/ui.test.js`

**Interfaces:**
- Produces generic supporting-document upload metadata while retaining existing Medical Certificate endpoints.
- Produces NS request counting with `uncapped_scheduled_days` and no entitlement link.

- [ ] **Step 1: Write failing NS tests**

Cover missing call-up notice, valid PDF/image upload, scheduled-day reporting, no annual/medical deduction, and approver document access authorization.

- [ ] **Step 2: Observe RED**

```bash
node --test tests/server.test.js tests/ui.test.js
```

Expected: FAIL because NS does not require or store a call-up notice.

- [ ] **Step 3: Generalize document storage safely**

Keep existing Medical Certificate paths and records valid. Add generic `supporting-documents/{employeeId}/...` paths for NS. Reuse current MIME, extension, 5 MB, private bucket, and signed URL checks. Validate the employee-specific storage prefix server-side.

- [ ] **Step 4: Implement NS request behavior**

Require `supportingDocumentUpload` or multipart `supportingDocument` when NS enforcement is enabled. Count scheduled working days, store no entitlement ID, and never run a balance check.

- [ ] **Step 5: Update request form behavior**

When National Service Leave is selected, show label `Official Call-Up Notice`, preserve keyboard behavior, and upload through the new endpoint. Medical and Hospitalization labels remain unchanged.

- [ ] **Step 6: Verify and commit**

```bash
node --test tests/server.test.js tests/ui.test.js
git add server.js public/app.js tests/server.test.js tests/ui.test.js
git commit -m "Require National Service call-up documents"
```

---

### Task 9: Admin Entitlement Management UI

**Files:**
- Modify: `public/app.js:2200-2530`
- Modify: `public/styles.css`
- Modify: `tests/ui.test.js`

**Interfaces:**
- Consumes: admin APIs from Task 4 and dashboard summaries from Task 3.
- Produces: inline `Manage Entitlements` expansion under an employee row.

- [ ] **Step 1: Write failing UI source-contract tests**

Assert presence of:

- `data-action="manage-entitlements"`.
- Weekday checkboxes with accessible labels.
- Medical outpatient and combined summary labels.
- Childcare eligibility and child date-of-birth controls only.
- Paternity and Maternity grant creation controls.
- Adjustment reason requirement.
- Used, pending, remaining, valid, and expiry labels.

- [ ] **Step 2: Observe RED**

```bash
node --test tests/ui.test.js
```

Expected: FAIL because the controls are absent.

- [ ] **Step 3: Implement inline expansion**

Reuse existing Employee `More` menu. Add one expanded full-width region per selected employee, with `aria-expanded`, `aria-controls`, and keyboard-safe focus. Keep quick fields in the existing row. Do not introduce a drawer, modal, or nested cards.

- [ ] **Step 4: Implement admin interactions**

Use existing busy-button, toast, API, and dashboard-patch patterns. Confirm destructive eligibility deactivation when pending requests exist. Require an adjustment reason before API submission.

- [ ] **Step 5: Add responsive styles**

Use existing colors, typography, spacing tokens, 44px touch targets, 8px-or-less radii, and reduced-motion rules. Desktop uses aligned compact grids; mobile uses one column with no horizontal overflow.

- [ ] **Step 6: Verify and commit**

```bash
node --test tests/ui.test.js
git add public/app.js public/styles.css tests/ui.test.js
git commit -m "Add admin entitlement management UI"
```

---

### Task 10: Employee and Approver Entitlement UI

**Files:**
- Modify: `public/app.js:1300-1600,1860-2120`
- Modify: `public/styles.css`
- Modify: `tests/ui.test.js`

**Interfaces:**
- Consumes: entitlement summaries and request validation errors.
- Produces: employee entitlement summaries, live request estimate, unavailable states, and approval context.

- [ ] **Step 1: Write failing UI tests**

Assert that each summary can display entitlement, approved, pending, remaining, expiry, and unavailable reason. Assert approval rendering includes eligibility verification, linked period, supporting document, and balance after approval.

- [ ] **Step 2: Observe RED**

```bash
node --test tests/ui.test.js
```

Expected: FAIL because special entitlement summaries are absent.

- [ ] **Step 3: Implement employee summaries**

Use an unframed compact list consistent with existing leave metrics. NS displays `Days taken` and no denominator. Maternity displays weeks plus exact dates. Childcare does not expose child date of birth outside admin views.

- [ ] **Step 4: Implement request estimate and blocked states**

On type/date change, calculate requested units from dashboard holidays and work-schedule data. Display expected remaining balance. Keep server validation authoritative. Disable submit only for clearly unavailable, expired, or unverified states and preserve an explanatory message.

- [ ] **Step 5: Implement approver context**

Add entitlement facts to existing approval cards without changing approve/reject controls. Display concurrent-cap errors returned during approval as accessible toasts and refresh dashboard state.

- [ ] **Step 6: Verify and commit**

```bash
node --test tests/ui.test.js tests/server.test.js
git add public/app.js public/styles.css tests/ui.test.js tests/server.test.js
git commit -m "Show entitlement context in leave workflows"
```

---

### Task 11: Production Rollout, Full Verification, and Clean-Install Schema

**Files:**
- Modify: `supabase/v1-rollout.sql`
- Modify: `docs/PRODUCTION_ROLLOUT.md`
- Modify: `README.md`
- Test: all test files

**Interfaces:**
- Produces: clean-install schema parity, operator commands, shadow-review checklist, activation order, and rollback commands.

- [ ] **Step 1: Append verified v2 schema to clean-install rollout**

After `supabase/v2-leave-entitlements.sql` passes staging verification, append its additive statements to `supabase/v1-rollout.sql`. Keep `v2` as the production upgrade script for existing databases.

- [ ] **Step 2: Document exact production sequence**

Add commands and checks to `docs/PRODUCTION_ROLLOUT.md`:

```text
1. Back up cls_users, cls_leave_requests, and cls_leave_adjustments.
2. Record row counts.
3. Run supabase/v2-leave-entitlements.sql in Supabase SQL Editor.
4. Confirm new columns and three new tables.
5. Confirm RLS and service_role grants.
6. Deploy application with enforcement settings disabled.
7. Review shadow calculations for every employee.
8. Enable Hospitalization, then Compassionate, Childcare, Paternity, Maternity, and National Service individually.
9. Run one submission and approval smoke test per enabled type.
10. Roll back behavior by setting enforcement_enabled=false; do not drop schema.
```

Include safe SQL updates with `where leave_type = ...` for each enable/disable action. Never use an update without a `where` clause.

- [ ] **Step 3: Run full automated verification**

```bash
npm test
node --check server.js
node --check public/app.js
node --check src/domain.js
node --check src/leaveEntitlements.js
git diff --check
```

Expected: all tests pass, all syntax checks exit 0, and no whitespace errors.

- [ ] **Step 4: Run Supabase staging verification**

With staging credentials already exported in the shell:

```bash
test -n "$SUPABASE_TEST_URL"
test -n "$SUPABASE_TEST_SERVICE_ROLE_KEY"
node --test tests/supabaseEntitlements.test.js
```

Expected: migration, access-control, trigger-parity, and concurrency tests pass. Never print or commit the service-role key.

- [ ] **Step 5: Run browser verification**

Start the application, then verify employee, admin, and approver flows at desktop and mobile widths. Capture screenshots of Leave, expanded Employee entitlements, and Approvals. Confirm no overlap, horizontal overflow, inaccessible controls, or stale balances.

- [ ] **Step 6: Review requirement coverage**

Confirm every approved policy in `docs/superpowers/specs/2026-07-20-leave-entitlement-enforcement-design.md` maps to a passing automated test and one rollout check. Record any intentionally disabled enforcement setting in the handoff.

- [ ] **Step 7: Commit rollout documentation**

```bash
git add supabase/v1-rollout.sql docs/PRODUCTION_ROLLOUT.md README.md
git commit -m "Document leave entitlement rollout"
```

## Final Acceptance Checklist

- [ ] Existing Annual, Medical Claims, Urgent, and Unpaid behavior is unchanged.
- [ ] Existing Medical Leave balances survive migration.
- [ ] Service proration produces 0/0, 5/15, 8/30, 11/45, and 14/60 at exact boundaries.
- [ ] Medical and Hospitalization share the combined pool.
- [ ] Compassionate resets to 3 annually.
- [ ] Childcare resets to 6 annually while HR eligibility remains active, with no age or lifetime cap.
- [ ] Paternity uses a snapshotted work schedule and 12-month expiry.
- [ ] Maternity supports one continuous 112-calendar-day period.
- [ ] NS is uncapped and requires a call-up notice.
- [ ] Pending requests reserve balances.
- [ ] Concurrent Supabase writes cannot exceed entitlement.
- [ ] Admin overrides and adjustments are distinct and audited.
- [ ] Each leave type can be disabled independently without schema rollback.
- [ ] Full automated, staging Supabase, and browser verification pass.
