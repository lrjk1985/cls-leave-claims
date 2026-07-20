const test = require("node:test");
const assert = require("node:assert/strict");
const {
  calendarDaysBetween,
  entitlementSummary,
  findActiveEntitlement,
  medicalHospitalizationSummary,
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

test("findActiveEntitlement matches validity and rejects overlapping grants", () => {
  const grants = [
    {
      id: "ent_1",
      employeeId: "u1",
      leaveType: "Compassionate Leave",
      periodKind: "annual",
      periodYear: 2026,
      validFrom: "2026-01-01",
      validUntil: "2026-12-31",
      active: true
    }
  ];

  assert.equal(findActiveEntitlement(grants, {
    employeeId: "u1",
    leaveType: "Compassionate Leave",
    date: "2026-07-20",
    year: 2026
  }).id, "ent_1");
  assert.equal(findActiveEntitlement(grants, {
    employeeId: "u1",
    leaveType: "Compassionate Leave",
    date: "2027-01-01",
    year: 2027
  }), null);
  assert.throws(() => findActiveEntitlement([...grants, { ...grants[0], id: "ent_2" }], {
    employeeId: "u1",
    leaveType: "Compassionate Leave",
    date: "2026-07-20",
    year: 2026
  }), /overlapping active entitlements/);
});
