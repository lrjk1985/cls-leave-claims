const test = require("node:test");
const assert = require("node:assert/strict");
const { changeApprovedCancellation: change } = require("../server").__test;
const { leaveSummary } = require("../src/domain");
const { offInLieuSummary } = require("../src/offInLieu");
const employee = { id: "e", name: "Employee" };
const manager = { id: "m", name: "Manager" };
const before = new Date("2027-01-03T15:59:59Z");
const midnight = new Date("2027-01-03T16:00:00Z");
function setup() {
  return { users: [employee, manager], emails: [], leaveRequests: [{
    id: "r", employeeId: "e", managerId: "m", status: "approved", decidedBy: "original",
    startDate: "2027-01-04", endDate: "2027-01-06", days: 3, leaveYear: 2027
  }] };
}
test("whole approved booking remains charged until a distinct reviewer agrees", () => {
  const db = setup();
  const remaining = (year) => leaveSummary(employee, db.leaveRequests, { year, entitlementOverride: 14 }).available;
  const act = (user, action, time = before) => change(db, user, "r", action, time);
  assert.throws(() => act(manager, "request"));
  assert.throws(() => act(employee, "request", midnight));
  const request = act(employee, "request");
  assert.equal(remaining(2027), 11);
  assert.equal(remaining(2026), 14);
  assert.equal(request.status, "approved");
  assert.throws(() => act(employee, "request"));
  assert.throws(() => act({ ...employee, role: "admin" }, "approve"));
  assert.throws(() => act({ id: "other" }, "approve"));
  assert.throws(() => act(manager, "approve", midnight));
  assert.equal(request.status, "approved");
  act(manager, "approve");
  assert.equal(request.status, "cancelled");
  assert.equal(remaining(2027), 14);
  assert.equal(remaining(2026), 14);
  assert.equal(request.leaveYear, 2027);
  assert.equal(request.decidedBy, "original");
  assert.throws(() => act(manager, "approve"));
  assert.equal(db.auditEvents.length, 2);
});
test("declining cancellation leaves approval and days untouched", () => {
  const db = setup();
  change(db, employee, "r", "request", before);
  const r = change(db, manager, "r", "decline", before);
  assert.equal(r.status, "approved");
  assert.equal(r.days, 3);
  assert.equal(r.cancellationReview.state, "declined");
  assert.throws(() => change(db, manager, "r", "approve", before));
});

test("half-day cancellation releases the original Off-in-Lieu award without extending expiry", () => {
  const db = setup();
  Object.assign(db.leaveRequests[0], { days: 0.5, dayPortion: "morning", type: "Off-in-Lieu Leave" });
  const available = (asOfDate) => offInLieuSummary({
    employeeId: "e", asOfDate, requests: db.leaveRequests,
    awards: [{ id: "a", employeeId: "e", awardDate: "2026-02-01", expiresOn: "2027-02-01", days: 1 }],
    allocations: [{ awardId: "a", leaveRequestId: "r", days: 0.5 }]
  }).available;
  change(db, employee, "r", "request", before);
  assert.equal(available("2027-01-03"), 0.5);
  change(db, manager, "r", "approve", before);
  assert.equal(available("2027-01-03"), 1);
  assert.equal(available("2027-02-01"), 0);
});
