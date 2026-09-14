const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");

function browser() {
  const context = vm.createContext({
    FormData,
    document: { querySelector: () => null, addEventListener: () => {} },
    window: { matchMedia: () => ({ matches: true }) },
    // Leave startup session loading pending; these tests supply their own dashboard.
    fetch: () => new Promise(() => {})
  });
  vm.runInContext(source, context);
  vm.runInContext(`state.dashboard = {
    user: { id: "employee", workSchedule: [1,2,3,4,5] },
    offInLieuSummary: { awards: [] }, leaveEntitlementSummaries: []
  }`, context);
  return context;
}

function award(pending = 0, approved = 0, revoked = false) {
  return { awards: [{ id: "award", days: 1, awardDate: "2026-09-01",
    expiresOn: "2027-09-01", pending, approved, revoked }] };
}

function estimate(context, startDate, endDate = startDate, portion = "full") {
  const message = { dataset: {}, innerHTML: "" };
  const submit = { disabled: false };
  const fields = {
    "[data-leave-estimate]": message,
    "button[type='submit']": submit,
    "select[name='type']": { value: "Off-in-Lieu Leave" },
    "input[name='startDate']": { value: startDate },
    "input[name='endDate']": { value: endDate },
    "input[name='dayPortion']:checked": { value: portion }
  };
  context.updateLeaveRequestEstimate({ querySelector: (selector) => fields[selector] });
  return { message, submit };
}

test("OIL award, reservation, cancellation and revocation patches update submission immediately", () => {
  const context = browser();
  assert.equal(estimate(context, "2026-09-15").submit.disabled, true);
  context.applyDashboardPatch({ offInLieuSummary: award() });
  assert.equal(estimate(context, "2026-09-15").submit.disabled, false);
  context.applyDashboardPatch({ offInLieuSummary: award(0.5) });
  assert.equal(estimate(context, "2026-09-15").submit.disabled, true);
  assert.equal(estimate(context, "2026-09-15", "2026-09-15", "morning").submit.disabled, false);
  context.applyDashboardPatch({ offInLieuSummary: award() });
  assert.equal(estimate(context, "2026-09-15").submit.disabled, false);
  context.applyDashboardPatch({ offInLieuSummary: award(0, 0, true) });
  assert.equal(estimate(context, "2026-09-15").submit.disabled, true);
});

test("OIL full and half days reject unscheduled weekends but allow weekdays", () => {
  const context = browser();
  context.applyDashboardPatch({ offInLieuSummary: award() });
  for (const portion of ["full", "morning", "afternoon"]) {
    for (const date of ["2026-09-19", "2026-09-20"]) {
      const result = estimate(context, date, date, portion);
      assert.equal(result.submit.disabled, true);
      assert.equal(result.message.dataset.entitlementBlocked, "true");
    }
    assert.equal(estimate(context, "2026-09-15", "2026-09-15", portion).submit.disabled, false);
  }
});

test("OIL half days reject multiple dates and expiry is exclusive", () => {
  const context = browser();
  context.applyDashboardPatch({ offInLieuSummary: award() });
  assert.equal(estimate(context, "2026-09-15", "2026-09-16", "morning").submit.disabled, true);
  assert.equal(estimate(context, "2026-08-31").submit.disabled, true);
  assert.equal(estimate(context, "2027-08-31").submit.disabled, false);
  assert.equal(estimate(context, "2027-09-01").submit.disabled, true);
});
