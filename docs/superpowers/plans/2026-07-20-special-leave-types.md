# Special Leave Types Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add HR-requested leave categories to the existing request and approval workflow without deducting them from annual or outpatient medical leave balances.

**Architecture:** Keep leave types as text in the existing request record. Centralize category rules in `src/domain.js`, apply them in `server.js`, and mirror document requirements in `public/app.js`. No database migration or workflow redesign.

**Tech Stack:** Node.js, vanilla JavaScript, Node test runner, existing Supabase text column.

## Global Constraints

- Preserve existing colors, layouts, workflows, roles, and approval logic.
- Preserve existing Annual Leave, Medical Leave, Urgent Leave, and Unpaid Leave behavior.
- Hospitalization, Compassionate, Paternity, Maternity, Childcare, and National Service leave must not deduct annual leave.
- Medical Leave remains subject to the outpatient medical leave balance.
- Hospitalization Leave requires supporting medical documentation but has no cap enforcement in Option 1.
- No database migration or new dependency.

---

### Task 1: Domain Classification

**Files:**
- Modify: `src/domain.js`
- Test: `tests/domain.test.js`

**Interfaces:**
- Produces: `isSpecialLeaveType(type)`, `requiresMedicalCertificate(type)`, and annual summary filtering based on explicit balance categories.

- [x] **Step 1: Write failing domain tests**

Add a test proving all six new leave types are excluded from annual approved and pending totals, while Annual, Urgent, and Unpaid remain unchanged.

- [x] **Step 2: Verify the tests fail**

Run: `node --test tests/domain.test.js`

Expected: FAIL because special leave currently contributes to annual leave totals.

- [x] **Step 3: Implement minimal classification helpers**

Add a normalized set for the six special categories. Filter annual summaries to exclude only Medical Leave and those special categories. Require medical documents for Medical Leave and Hospitalization Leave.

- [x] **Step 4: Verify domain tests pass**

Run: `node --test tests/domain.test.js`

Expected: PASS.

### Task 2: Request Validation and UI

**Files:**
- Modify: `server.js`
- Modify: `public/app.js`
- Test: `tests/server.test.js`
- Test: `tests/ui.test.js`

**Interfaces:**
- Consumes: `isSpecialLeaveType(type)` and `requiresMedicalCertificate(type)` from `src/domain.js`.
- Produces: new dropdown options, hospitalization document upload, and special requests that bypass annual and medical balance checks.

- [x] **Step 1: Write failing server and UI tests**

Add tests proving special leave can be submitted with zero annual balance, Hospitalization Leave requires a document, and all new options appear in the form.

- [x] **Step 2: Verify the tests fail**

Run: `node --test tests/server.test.js tests/ui.test.js`

Expected: FAIL because new categories and rules are absent.

- [x] **Step 3: Implement minimal server and UI changes**

Use annual validation only for existing annual-balance categories. Use outpatient medical validation only for Medical Leave. Require and store medical documents for Medical Leave and Hospitalization Leave. Add eligibility review helper text to the existing form.

- [x] **Step 4: Verify targeted tests pass**

Run: `node --test tests/domain.test.js tests/server.test.js tests/ui.test.js`

Expected: PASS except any documented pre-existing holiday-data assertion.

### Task 3: Full Verification

**Files:**
- Review all modified files.

- [x] **Step 1: Run full test suite**

Run: `npm test`

Expected: all feature tests pass; report any unrelated baseline failure exactly.

- [x] **Step 2: Inspect diff and schema impact**

Run: `git diff --check` and `git diff --stat`.

Expected: no whitespace errors, no migration, no dependency changes.
