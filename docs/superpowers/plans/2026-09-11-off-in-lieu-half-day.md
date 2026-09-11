# Off-in-Lieu and Half-Day Leave Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add admin-awarded Off-in-Lieu with per-award one-year expiry and safe earliest-expiry allocation, plus single-date morning and afternoon half-day requests for approved leave types.

**Architecture:** A focused `src/offInLieu.js` domain module owns expiry, half-day validation, summaries, and deterministic allocation. Two additive Supabase tables store immutable OIL awards and per-date request allocations; a security-invoker trigger performs authoritative allocation in the leave-request insert transaction. Existing leave requests gain a backward-compatible `day_portion` column defaulting to `full`.

**Tech Stack:** Node.js 20+, CommonJS, browser JavaScript, CSS, Node test runner, PostgreSQL/Supabase REST, Vercel.

**Spec:** `docs/superpowers/specs/2026-09-11-off-in-lieu-half-day-design.md`

## Global Constraints

- Off-in-Lieu is separate from Annual Leave and can only be awarded by an admin.
- Awards use positive 0.5-day increments and expire on the exclusive first-anniversary boundary.
- An award dated 15 September 2026 is usable through 14 September 2027.
- A 29 February award remains usable through the following 28 February and expires on 1 March.
- Pending and approved OIL requests reserve credits; rejected and cancelled requests release them.
- Allocate eligible awards by earliest expiry, then award date, then creation time.
- Half-days are single-date only and consume 0.5 day.
- Half-days are limited to Annual, Urgent, Medical, Off-in-Lieu, and Unpaid Leave.
- Existing requests remain Full Day without data conversion.
- Medical half-days continue requiring a Medical Certificate.
- Do not invent employee working-hour boundaries for calendar attachments.
- Preserve existing branding, navigation, approver routing, and business logic outside this scope.
- Do not add runtime dependencies.
- Keep schema changes additive, idempotent, RLS-enabled, and inaccessible to `anon` and `authenticated`.

## File Map

- Create `src/offInLieu.js`: pure OIL expiry, half-day validation, allocation, and summary logic.
- Create `tests/offInLieu.test.js`: focused domain coverage.
- Create `supabase/v3-off-in-lieu-half-day.sql`: additive migration and atomic allocation trigger.
- Modify `supabase/v1-rollout.sql`: keep the clean-install schema equivalent to all migrations.
- Modify `src/leaveEntitlements.js`: register OIL as separately tracked leave.
- Modify `server.js`: persistence, normalization, summaries, APIs, request behavior, audit, email, and calendar text.
- Modify `public/app.js`: employee/admin OIL interfaces, Duration control, estimates, and request displays.
- Modify `public/styles.css`: responsive controls using existing design tokens.
- Modify `tests/domain.test.js`, `tests/server.test.js`, `tests/supabaseEntitlements.test.js`, and `tests/ui.test.js`.
- Modify `docs/PRODUCTION_ROLLOUT.md`: staging, production, verification, and rollback instructions.

---

### Task 1: OIL and Half-Day Domain Rules

**Files:**
- Create: `src/offInLieu.js`
- Create: `tests/offInLieu.test.js`
- Modify: `src/leaveEntitlements.js`
- Modify: `tests/domain.test.js`

**Interfaces:**
- Consumes: ISO dates, leave types, OIL awards, allocation records, and request statuses.
- Produces: `DAY_PORTIONS`, `HALF_DAY_LEAVE_TYPES`, `offInLieuExpiresOn(awardDate)`, `normalizeDayPortion(input)`, `allocateOffInLieu(input)`, and `offInLieuSummary(input)`.

- [ ] **Step 1: Write failing expiry and half-day tests**

```js
test("OIL expires on the exclusive first anniversary", () => {
  assert.equal(offInLieuExpiresOn("2026-09-15"), "2027-09-15");
  assert.equal(offInLieuExpiresOn("2028-02-29"), "2029-03-01");
});

test("half-days require one date and an approved leave type", () => {
  assert.equal(normalizeDayPortion({
    type: "Medical Leave",
    startDate: "2026-09-15",
    endDate: "2026-09-15",
    dayPortion: "morning"
  }), "morning");
  assert.throws(() => normalizeDayPortion({
    type: "Maternity Leave",
    startDate: "2026-09-15",
    endDate: "2026-09-15",
    dayPortion: "afternoon"
  }), /Full Day/);
  assert.throws(() => normalizeDayPortion({
    type: "Annual Leave",
    startDate: "2026-09-15",
    endDate: "2026-09-16",
    dayPortion: "morning"
  }), /single date/);
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `node --test tests/offInLieu.test.js`

Expected: FAIL because `src/offInLieu.js` does not exist.

- [ ] **Step 3: Implement constants and validation**

```js
const DAY_PORTIONS = Object.freeze({
  FULL: "full",
  MORNING: "morning",
  AFTERNOON: "afternoon"
});

const HALF_DAY_LEAVE_TYPES = new Set([
  "annual leave",
  "urgent leave",
  "medical leave",
  "off-in-lieu leave",
  "unpaid leave"
]);

function offInLieuExpiresOn(awardDate) {
  const date = parseIsoDate(awardDate, "Award date");
  date.setUTCFullYear(date.getUTCFullYear() + 1);
  return date.toISOString().slice(0, 10);
}
```

`normalizeDayPortion()` defaults missing values to `full`, rejects unknown values, and enforces the approved type set and matching dates for non-full values.

- [ ] **Step 4: Write failing allocation and summary tests**

```js
test("OIL uses the earliest-expiring eligible award", () => {
  const result = allocateOffInLieu({
    employeeId: "u1",
    requestId: "leave1",
    leaveDates: [{ date: "2026-10-01", days: 1 }],
    awards: [
      award("later", "u1", 2, "2026-08-01", "2027-08-01"),
      award("earlier", "u1", 0.5, "2026-01-01", "2027-01-01")
    ],
    allocations: [],
    requests: []
  });
  assert.deepEqual(result.map(({ awardId, days }) => ({ awardId, days })), [
    { awardId: "earlier", days: 0.5 },
    { awardId: "later", days: 0.5 }
  ]);
});

test("rejected requests release allocated OIL", () => {
  const summary = offInLieuSummary({
    employeeId: "u1",
    asOfDate: "2026-10-01",
    awards: [award("a1", "u1", 1, "2026-01-01", "2027-01-01")],
    allocations: [{ awardId: "a1", leaveRequestId: "leave1", leaveDate: "2026-10-01", days: 1 }],
    requests: [{ id: "leave1", status: "rejected" }]
  });
  assert.equal(summary.unreserved, 1);
});
```

- [ ] **Step 5: Implement pure allocation and summaries**

`allocateOffInLieu()` returns allocation drafts without mutating inputs. It filters by employee, non-revoked state, and `awardDate <= leaveDate < expiresOn`; subtracts allocations linked to pending or approved requests; sorts deterministically; splits a date across awards; and throws `Insufficient Off-in-Lieu balance for <date>.` without partial output.

`offInLieuSummary()` returns:

```js
{
  available: 1.5,
  pending: 0.5,
  unreserved: 1,
  nextExpiry: "2027-01-01",
  expiringDays: 0.5,
  awards: []
}
```

- [ ] **Step 6: Register OIL as separately tracked**

Add `OFF_IN_LIEU: "Off-in-Lieu Leave"` to `LEAVE_TYPES` and add it to `SPECIAL_LEAVE_TYPES`. Add a regression proving an approved OIL request does not alter `leaveSummary()`.

- [ ] **Step 7: Run domain tests and commit**

Run: `node --test tests/offInLieu.test.js tests/domain.test.js`

Expected: PASS.

```bash
git add src/offInLieu.js src/leaveEntitlements.js tests/offInLieu.test.js tests/domain.test.js
git commit -m "Add OIL and half-day domain rules"
```

---

### Task 2: Persistence and Backward Compatibility

**Files:**
- Modify: `server.js`
- Modify: `tests/server.test.js`
- Modify: `tests/supabaseEntitlements.test.js`

**Interfaces:**
- Consumes: Task 1 constants and domain objects.
- Produces: normalized `dayPortion`, `offInLieuAwards`, and `offInLieuAllocations`, plus Supabase row mappers.

- [ ] **Step 1: Write failing normalization and round-trip tests**

```js
test("normalizeDb defaults historical leave data", () => {
  const db = normalizeDb({ leaveRequests: [{ id: "leave1", type: "Annual Leave" }] });
  assert.equal(db.leaveRequests[0].dayPortion, "full");
  assert.deepEqual(db.offInLieuAwards, []);
  assert.deepEqual(db.offInLieuAllocations, []);
});
```

Extend the Supabase round-trip test with one award, one allocation, and a morning leave request.

- [ ] **Step 2: Run tests and confirm RED**

Run: `node --test tests/server.test.js tests/supabaseEntitlements.test.js`

Expected: FAIL because the new mappings are absent.

- [ ] **Step 3: Add exact persistence mappings**

Add `day_portion` to `leaveRequestToRow()` and `leaveRequestFromRow()`. Add:

```js
function offInLieuAwardToRow(award) {
  return {
    id: award.id,
    employee_id: award.employeeId,
    days: Number(award.days),
    award_date: award.awardDate,
    expires_on: award.expiresOn,
    reason: award.reason,
    awarded_by: award.awardedBy,
    revoked_at: award.revokedAt || null,
    revoked_by: award.revokedBy || null,
    revocation_reason: award.revocationReason || null,
    created_at: award.createdAt
  };
}

function offInLieuAllocationToRow(allocation) {
  return {
    id: allocation.id,
    leave_request_id: allocation.leaveRequestId,
    award_id: allocation.awardId,
    leave_date: allocation.leaveDate,
    days: Number(allocation.days),
    created_at: allocation.createdAt
  };
}

function offInLieuAwardFromRow(row) {
  return {
    id: row.id,
    employeeId: row.employee_id,
    days: Number(row.days),
    awardDate: row.award_date,
    expiresOn: row.expires_on,
    reason: row.reason,
    awardedBy: row.awarded_by,
    revokedAt: row.revoked_at,
    revokedBy: row.revoked_by,
    revocationReason: row.revocation_reason,
    createdAt: row.created_at
  };
}

function offInLieuAllocationFromRow(row) {
  return {
    id: row.id,
    leaveRequestId: row.leave_request_id,
    awardId: row.award_id,
    leaveDate: row.leave_date,
    days: Number(row.days),
    createdAt: row.created_at
  };
}
```

Place awards before leave requests and allocations after leave requests in `SUPABASE_TABLES` to preserve foreign-key save order.

Normalize historical data with `dayPortion: request.dayPortion || DAY_PORTIONS.FULL` and empty arrays for both OIL collections.

- [ ] **Step 4: Run persistence tests and commit**

Run: `node --test tests/server.test.js tests/supabaseEntitlements.test.js`

Expected: PASS.

```bash
git add server.js tests/server.test.js tests/supabaseEntitlements.test.js
git commit -m "Persist OIL awards and leave portions"
```

---

### Task 3: Additive Supabase Migration and Atomic Allocation

**Files:**
- Create: `supabase/v3-off-in-lieu-half-day.sql`
- Modify: `tests/supabaseEntitlements.test.js`

**Interfaces:**
- Consumes: `cls_users`, `cls_leave_requests`, request schedule snapshots, excluded dates, and statuses.
- Produces: OIL tables, `day_portion`, constraints, indexes, RLS, grants, and `cls_allocate_off_in_lieu()`.

- [ ] **Step 1: Write failing migration-contract tests**

```js
assert.match(sql, /add column if not exists day_portion/);
assert.match(sql, /create table if not exists public\.cls_off_in_lieu_awards/);
assert.match(sql, /create table if not exists public\.cls_off_in_lieu_allocations/);
assert.match(sql, /security invoker/);
assert.match(sql, /for update/);
assert.match(sql, /revoke all.*anon, authenticated/is);
assert.match(sql, /grant .* service_role/is);
```

- [ ] **Step 2: Run the migration test and confirm RED**

Run: `node --test tests/supabaseEntitlements.test.js`

Expected: FAIL because the V3 migration is absent.

- [ ] **Step 3: Create the additive schema**

Create both tables and all constraints from the approved spec. Add these indexes:

```sql
create index if not exists cls_oil_awards_employee_expiry_idx
  on public.cls_off_in_lieu_awards(employee_id, expires_on, award_date)
  where revoked_at is null;
create index if not exists cls_oil_allocations_award_idx
  on public.cls_off_in_lieu_allocations(award_id, leave_date);
create index if not exists cls_oil_allocations_request_idx
  on public.cls_off_in_lieu_allocations(leave_request_id);
```

Add `day_portion` with default `full`. Add idempotent named constraints for allowed values, single-date half-days, `days = 0.5`, and the approved leave-type list.

- [ ] **Step 4: Implement the atomic allocation trigger**

Create `public.cls_allocate_off_in_lieu()` as `SECURITY INVOKER`. For a pending or approved OIL insert, generate scheduled leave dates, excluding dates listed in `excluded_dates`; lock eligible awards ordered by `expires_on`, `award_date`, `created_at`, and `id`; subtract allocations joined to pending or approved requests; and insert allocation rows until each date's 1.0 or 0.5 requirement is met.

Use deterministic IDs derived from request ID, award ID, and leave date. Raise a `CLS_OIL_CAP` exception when insufficient so the request insert rolls back. Revoke function execution from `PUBLIC`, `anon`, and `authenticated`; grant only to `service_role`.

- [ ] **Step 5: Verify migration tests and commit**

Run: `node --test tests/supabaseEntitlements.test.js`

Expected: PASS.

```bash
git add supabase/v3-off-in-lieu-half-day.sql tests/supabaseEntitlements.test.js
git commit -m "Add OIL and half-day Supabase schema"
```

---

### Task 4: Server Workflows and Admin APIs

**Files:**
- Modify: `server.js`
- Modify: `tests/server.test.js`

**Interfaces:**
- Consumes: Task 1 functions and Task 2 persistence collections.
- Produces: `createOffInLieuAward()`, `revokeOffInLieuAward()`, dashboard OIL summaries, and OIL-aware `createLeaveRequest()`.

- [ ] **Step 1: Write failing admin authorization and expiry tests**

```js
test("admin awards OIL with automatic expiry", () => {
  const award = createOffInLieuAward(db, admin, {
    employeeId: employee.id,
    days: 1.5,
    awardDate: "2026-09-15",
    reason: "Weekend event support"
  });
  assert.equal(award.expiresOn, "2027-09-15");
});

test("employees cannot award OIL", () => {
  assert.throws(() => createOffInLieuAward(db, employee, {
    employeeId: employee.id,
    days: 1,
    awardDate: "2026-09-15",
    reason: "Invalid self-award"
  }), /admin/i);
});
```

- [ ] **Step 2: Run server tests and confirm RED**

Run: `node --test tests/server.test.js`

Expected: FAIL because award operations are absent.

- [ ] **Step 3: Implement award creation, revocation, and routes**

`createOffInLieuAward()` validates admin role, active employee, ISO date, positive half-day amount, and reason. `revokeOffInLieuAward()` rejects non-admins, missing/revoked awards, blank reasons, and awards with pending allocations. It records revocation fields without changing original values.

Add:

```text
POST  /api/off-in-lieu-awards
PATCH /api/off-in-lieu-awards/:id/revoke
```

Add audit actions `oil.awarded` and `oil.revoked` containing employee, days, award date, expiry, reason, and actor.

- [ ] **Step 4: Write failing request tests**

Test Annual, Urgent, Medical, OIL, and Unpaid half-days; excluded leave types; multi-date half-days; weekends, unscheduled dates, and holidays; expired/insufficient OIL; and earliest-expiry local allocations.

```js
const request = await createLeaveRequest(db, employee, {
  type: "Annual Leave",
  startDate: "2026-09-15",
  endDate: "2026-09-15",
  dayPortion: "morning"
});
assert.equal(request.days, 0.5);
assert.equal(request.dayPortion, "morning");
```

- [ ] **Step 5: Implement request calculation and OIL allocation**

Normalize `dayPortion` before balance checks. Calculate the existing scheduled-day result first; non-full requests require exactly one eligible scheduled date and then use `days = 0.5`.

For OIL, snapshot `user.workSchedule`, calculate each scheduled leave date, and prevalidate with `allocateOffInLieu()`. Local mode appends allocation drafts. Supabase mode lets the request-insert trigger create them, then reloads `cls_off_in_lieu_allocations` before returning the dashboard.

- [ ] **Step 6: Add dashboard summaries and approval checks**

Expose the viewer's OIL totals and next expiry. Award details follow `canSeeEmployee()`; revocation metadata is admin-only. Before approval, verify OIL allocations equal request days. Rejection and cancellation release capacity through request status.

- [ ] **Step 7: Run server tests and commit**

Run: `node --test tests/server.test.js tests/offInLieu.test.js`

Expected: PASS.

```bash
git add server.js tests/server.test.js
git commit -m "Add OIL award and request workflows"
```

---

### Task 5: Employee Form and Estimates

**Files:**
- Modify: `public/app.js`
- Modify: `public/styles.css`
- Modify: `tests/ui.test.js`

**Interfaces:**
- Consumes: dashboard OIL summary, request `dayPortion`, and server validation.
- Produces: OIL selector option, Duration control, balance context, and 0.5-day estimates.

- [ ] **Step 1: Write failing UI tests**

```js
assert.match(appSource, /<option>Off-in-Lieu Leave<\/option>/);
assert.match(appSource, /name="dayPortion"/);
assert.match(appSource, /value="morning"/);
assert.match(appSource, /value="afternoon"/);
assert.match(appSource, /Half-day leave must use a single date/);
assert.match(appSource, /Next expiry/);
```

- [ ] **Step 2: Run UI tests and confirm RED**

Run: `node --test tests/ui.test.js`

Expected: FAIL because the controls are absent.

- [ ] **Step 3: Add OIL selection and balance context**

Add Off-in-Lieu to the selector. Extend `leaveRequestBalanceContext()` to use the selected `startDate` and the employee-visible award/allocation detail to calculate balance valid for that leave date. Return capped balance, unavailable text when no award covers the selected date, and next expiry. The server and database remain authoritative.

- [ ] **Step 4: Add the Duration segmented control**

Use radio inputs for Full Day, Morning Half, and Afternoon Half. Full Day is selected initially. `updateLeaveDurationField(form)` hides and disables half-day choices for excluded types and resets to `full` when the type changes.

- [ ] **Step 5: Update estimates and resets**

For non-full requests, require equal dates, verify the browser-known schedule, show `0.5 scheduled day`, and deduct 0.5 from the preview. After successful submission, restore Full Day and rerun duration, document, and estimate updates.

- [ ] **Step 6: Add responsive styling and commit**

Use existing color, tap-target, and motion variables. Keep stable segmented-control dimensions and collapse to one column below 640px.

Run: `node --test tests/ui.test.js`

Expected: PASS.

```bash
git add public/app.js public/styles.css tests/ui.test.js
git commit -m "Add OIL and half-day leave controls"
```

---

### Task 6: Admin OIL Management UI

**Files:**
- Modify: `public/app.js`
- Modify: `public/styles.css`
- Modify: `tests/ui.test.js`

**Interfaces:**
- Consumes: admin-visible awards and Task 4 endpoints.
- Produces: Manage Off-in-Lieu action, award form, history, and revoke flow.

- [ ] **Step 1: Write failing admin UI tests**

Assert `Manage Off-in-Lieu`, `Award Off-in-Lieu`, `Award Date`, calculated expiry, reason, available, pending, next expiry, and revoke controls.

- [ ] **Step 2: Run tests and confirm RED**

Run: `node --test tests/ui.test.js`

Expected: FAIL because the manager is absent.

- [ ] **Step 3: Implement the inline manager**

Add `state.offInLieuEmployeeId`. Follow the existing full-width entitlement-manager pattern. Show original days, remaining, award date, `Usable through <expiresOn minus one day>`, reason, status, and awarding admin.

- [ ] **Step 4: Implement award and revoke submissions**

Submit `{ employeeId, days, awardDate, reason }` to the award endpoint. Display a client-calculated expiry for guidance only. Require a non-empty revocation reason before calling the revoke endpoint.

- [ ] **Step 5: Verify accessibility, responsive layout, and commit**

Use `aria-expanded`, `aria-controls`, labels, a polite expiry status, and existing 44px targets. Collapse to one column below 640px.

Run: `node --test tests/ui.test.js`

Expected: PASS.

```bash
git add public/app.js public/styles.css tests/ui.test.js
git commit -m "Add admin OIL award management"
```

---

### Task 7: Approval, History, Email, Audit, and Calendar Context

**Files:**
- Modify: `server.js`
- Modify: `public/app.js`
- Modify: `tests/server.test.js`
- Modify: `tests/ui.test.js`

**Interfaces:**
- Consumes: `dayPortion`, OIL allocations, and summaries.
- Produces: consistent `Morning Half`, `Afternoon Half`, and OIL funding context.

- [ ] **Step 1: Write failing presentation tests**

Create morning Medical and afternoon OIL requests. Assert email body, audit metadata, calendar summary, approval table, and history identify the portion. Assert OIL approval context lists funding expiry and balance after approval.

- [ ] **Step 2: Run tests and confirm RED**

Run: `node --test tests/server.test.js tests/ui.test.js`

Expected: FAIL because portion wording is absent.

- [ ] **Step 3: Add server-side wording**

```js
function leavePortionLabel(dayPortion) {
  if (dayPortion === "morning") return "Morning Half";
  if (dayPortion === "afternoon") return "Afternoon Half";
  return "Full Day";
}
```

Use it in submission, decision, cancellation, audit, and ICS text. Keep ICS date-based and include `0.5 day`; do not add arbitrary times.

- [ ] **Step 4: Update browser displays**

Show non-full portions beside request dates. Extend `renderLeaveApprovalContext()` with OIL funding awards and post-approval balance without altering existing Medical, entitlement, or National Service branches.

- [ ] **Step 5: Run tests and commit**

Run: `node --test tests/server.test.js tests/ui.test.js`

Expected: PASS.

```bash
git add server.js public/app.js tests/server.test.js tests/ui.test.js
git commit -m "Show OIL and half-day request context"
```

---

### Task 8: Clean Install, Rollout, and Full Verification

**Files:**
- Modify: `supabase/v1-rollout.sql`
- Modify: `tests/supabaseEntitlements.test.js`
- Modify: `docs/PRODUCTION_ROLLOUT.md`

**Interfaces:**
- Consumes: completed V3 migration and application behavior.
- Produces: equivalent clean-install schema and production runbook.

- [ ] **Step 1: Write failing clean-install parity tests**

Assert V1 includes both OIL tables, `day_portion`, V3 constraints/indexes, RLS, grants, and final trigger definition exactly once.

- [ ] **Step 2: Run schema tests and confirm RED**

Run: `node --test tests/supabaseEntitlements.test.js`

Expected: FAIL because clean install lacks V3.

- [ ] **Step 3: Merge V3 into clean install**

Place tables after their referenced tables, add `day_portion` directly to the request definition, retain idempotent upgrade statements, and keep function execution revoked from public roles.

- [ ] **Step 4: Extend the production runbook**

Document exact commands and checks for backup and row baselines, staging migration, RLS/grants/constraints/indexes, concurrent final-0.5-day testing, deployment, admin award entry, employee smoke tests, and rollback that retains additive data.

- [ ] **Step 5: Run complete local verification**

```bash
npm test
git diff --check
```

Expected: all non-environment tests pass. The existing database concurrency test may remain skipped without Supabase test credentials.

- [ ] **Step 6: Run staging database verification**

Apply V3 to a Supabase staging branch. Verify access as `anon`, `authenticated`, and `service_role`; test constraints inside rollback-only transactions; submit two concurrent requests against the last 0.5 OIL day and confirm exactly one commits.

- [ ] **Step 7: Run browser verification**

Start with `npm start`. Check desktop and mobile OIL balances, Duration transitions, single-date validation, admin award/revoke, approval context, history, keyboard focus, and reduced motion.

- [ ] **Step 8: Commit integration work**

```bash
git add supabase/v1-rollout.sql tests/supabaseEntitlements.test.js docs/PRODUCTION_ROLLOUT.md
git commit -m "Complete OIL and half-day rollout support"
```

---

## Production Gate

Do not migrate or deploy production until:

- Local tests pass.
- Migration and clean-install parity tests pass.
- Staging schema and security checks pass.
- Concurrent requests against the final 0.5 OIL day allow exactly one commit.
- Admin award, employee request, approval, rejection, and cancellation pass in staging.
- Existing Annual, Medical, Hospitalization, Compassionate, Paternity, Maternity, Childcare, National Service, Urgent, and Unpaid workflows pass smoke testing.
- Production backup and baseline counts are recorded.
- The user explicitly approves the production migration.
