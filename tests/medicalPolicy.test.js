const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { medicalHospitalizationSummary } = require("../src/leaveEntitlements");
const { __test } = require("../server");

function employee(overrides = {}) {
  return { id: "employee", name: "Employee", email: "employee@example.test",
    role: "employee", managerId: "manager", leavePolicyYear: 2026,
    serviceStartDate: "2026-11-17", medicalLeaveEntitlement: 14,
    medicalLeaveBalanceAdjustment: -3, medicalLeaveBalanceAdjustmentYear: 2026,
    ...overrides };
}
function request(type, status, days, year = 2026) {
  return { employeeId: "employee", type, status, days, leaveYear: year,
    startDate: `${year}-01-02`, endDate: `${year}-01-02` };
}
function database(user = employee(), requests = [], enabled = true) {
  return __test.normalizeDb({ users: [user, { id: "manager", role: "manager" }],
    leaveRequests: requests,
    leavePolicySettings: ["Medical Leave", "Hospitalization Leave"].map((leaveType) =>
      ({ leaveType, enforcementEnabled: enabled })) });
}

test("fixed medical policy grants 14/60 from day one regardless of old overrides", () => {
  for (const serviceStartDate of ["2026-11-17", "2026-08-17", "2026-07-17", "2025-01-01", undefined]) {
    const summary = medicalHospitalizationSummary(employee({ serviceStartDate,
      medicalLeaveEntitlementOverride: 8 }), [], { year: 2026, asOfDate: "2026-11-17" });
    assert.equal(summary.outpatient.entitlement, 14);
    assert.equal(summary.combined.entitlement, 60);
    assert.equal(summary.outpatient.available, 11);
    assert.equal(summary.combined.available, 57);
  }
});

test("signed medical adjustments affect both pools once and only in their year", () => {
  const requests = [request("Medical Leave", "approved", 6), request("Medical Leave", "pending", 0.5),
    request("Hospitalization Leave", "approved", 10), request("Hospitalization Leave", "pending", 2),
    request("Medical Leave", "cancelled", 3), request("Medical Leave", "rejected", 3),
    request("Medical Leave", "approved", 2, 2027),
    { ...request("Medical Leave", "approved", 14), employeeId: "other" }];
  for (const adjustment of [-3, 0, 1]) {
    const user = employee({ medicalLeaveBalanceAdjustment: adjustment });
    const summary = medicalHospitalizationSummary(user, requests, { year: 2026 });
    assert.equal(summary.outpatient.available, 8 + adjustment);
    assert.equal(summary.outpatient.unreserved, 7.5 + adjustment);
    assert.equal(summary.combined.unreserved, 41.5 + adjustment);
    const next = medicalHospitalizationSummary(user, requests, { year: 2027 });
    assert.equal(next.outpatient.available, 12);
    assert.equal(next.combined.available, 58);
  }
});

test("all audited active outpatient balances survive enforcement unchanged", () => {
  for (const [used, adjustment, remaining] of [[6,-3,5], [5,-7,2], [0,0,14], [0,0,14], [0,-2,12], [3,0,11], [0,-1,13]]) {
    const summary = medicalHospitalizationSummary(employee({ medicalLeaveBalanceAdjustment: adjustment }),
      [request("Medical Leave", "approved", used)], { year: 2026 });
    assert.equal(summary.outpatient.available, remaining);
  }
});

test("dashboard and admin balances use the enforced 14-day policy and adjusted remaining", () => {
  const db = database(employee({ medicalLeaveEntitlement: 8 }), [request("Medical Leave", "approved", 3)]);
  const dashboard = __test.dashboard(db, db.users[0]);
  assert.equal(dashboard.medicalLeaveSummary.entitlement, 14);
  assert.equal(dashboard.medicalLeaveSummary.available, 8);
  assert.equal(dashboard.userById.employee.medicalLeaveRemaining, 8);
  const updated = __test.updateEmployee(db, "employee", { medicalLeaveRemaining: 7 });
  assert.equal(updated.medicalLeaveBalanceAdjustment, -4);
  assert.equal(__test.dashboard(db, updated).medicalLeaveSummary.available, 7);
});

test("disabled medical enforcement preserves legacy entitlement and adjustments", () => {
  const db = database(employee({ medicalLeaveEntitlement: 8 }), [], false);
  assert.equal(__test.dashboard(db, db.users[0]).medicalLeaveSummary.available, 5);
});

test("fixed entitlement cannot be changed through the admin editor when enabled", () => {
  const db = database();
  assert.throws(() => __test.updateEmployee(db, "employee", { medicalLeaveEntitlement: 8 }), /fixed at 14/);
  assert.equal(db.users[0].medicalLeaveEntitlement, 14);
});

test("dashboard publishes separate next-year balances including advance bookings", () => {
  const year = new Date().getFullYear();
  const db = database(employee({ leavePolicyYear: year, medicalLeaveBalanceAdjustmentYear: year }),
    [request("Medical Leave", "approved", 2, year + 1)]);
  const bundle = __test.dashboard(db, db.users[0]).leaveEntitlementSummaries[0];
  assert.equal(bundle.medicalHospitalizationByYear[year + 1].outpatient.available, 12);
});

test("approval rechecks an admin deduction made after submission without mutating status", async () => {
  const db = database(employee({ medicalLeaveBalanceAdjustment: -14 }),
    [{ ...request("Medical Leave", "pending", 1), id: "pending", managerId: "manager" }]);
  await assert.rejects(() => __test.decideLeaveRequest(db, db.users[1], "pending", { status: "approved" }), /only 0 days remaining/);
  assert.equal(db.leaveRequests[0].status, "pending");
});

test("enforced medical submission reserves final half day, blocks excess and permits approval", async (t) => {
  const db = database(employee(), [request("Medical Leave", "approved", 10.5)]);
  const user = db.users[0];
  const body = { type: "Medical Leave", startDate: "2026-11-18", endDate: "2026-11-18",
    dayPortion: "morning", medicalCertificate: { name: "test.pdf", type: "application/pdf",
      buffer: Buffer.from("%PDF-1.4\nmedical policy test\n") } };
  const created = await __test.createLeaveRequest(db, user, body);
  t.after(() => fs.rm(path.join(__dirname, "..", "data", "uploads", created.medicalCertificate.storedName), { force: true }));
  assert.equal(created.days, 0.5);
  await assert.rejects(() => __test.createLeaveRequest(db, user, { ...body, startDate: "2026-11-19", endDate: "2026-11-19" }), /only 0 days remaining/);
  await __test.decideLeaveRequest(db, db.users[1], created.id, { status: "approved" });
  assert.equal(__test.dashboard(db, user).medicalLeaveSummary.available, 0);
});

test("medical and hospitalization submissions respect adjusted combined pool", async () => {
  const db = database(employee(), [request("Hospitalization Leave", "approved", 57)]);
  for (const type of ["Medical Leave", "Hospitalization Leave"]) {
    await assert.rejects(() => __test.createLeaveRequest(db, db.users[0], {
      type, startDate: "2026-11-18", endDate: "2026-11-18"
    }), /combined Medical and Hospitalization balance has only 0 days remaining/);
  }
});

test("hospitalization override only applies when it covers the whole requested period", async () => {
  const db = database();
  db.leaveEntitlements.push({ id: "limited-grant", employeeId: "employee",
    leaveType: "Hospitalization Leave", periodKind: "annual", periodYear: 2026,
    active: true, validFrom: "2026-01-01", validUntil: "2026-11-18", baseDays: 0 });
  await assert.rejects(() => __test.createLeaveRequest(db, db.users[0], {
    type: "Hospitalization Leave", startDate: "2026-11-18", endDate: "2026-11-18"
  }), /combined Medical and Hospitalization balance has only 0 days remaining/);
  // The expired override is ignored for a range it does not cover, matching SQL.
  await assert.rejects(() => __test.createLeaveRequest(db, db.users[0], {
    type: "Hospitalization Leave", startDate: "2026-11-18", endDate: "2026-11-19"
  }), /required for Hospitalization Leave/);
});

test("rollover resets medical deductions without consuming prior-year usage again", () => {
  const db = database(employee(), [request("Medical Leave", "approved", 6), request("Medical Leave", "approved", 2, 2027)]);
  __test.applyLeaveYearRollover(db, new Date("2027-01-01T12:00:00+08:00"));
  const summary = __test.dashboard(db, db.users[0]).medicalLeaveSummary;
  assert.equal(summary.entitlement, 14);
  assert.equal(summary.available, 12);
  assert.equal(db.users[0].medicalLeaveBalanceAdjustment, 0);
});
