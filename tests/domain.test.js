const test = require("node:test");
const assert = require("node:assert/strict");
const {
  canReview,
  completedYearsOfService,
  generalClaimSummary,
  leaveDayBreakdown,
  leaveSummary,
  medicalClaimSummary,
  medicalLeaveSummary,
  nextLeaveYearBalance,
  normalizeLeaveDays,
  normalizeMoney,
  normalizeSignedLeaveDays,
  serviceAdjustedAnnualLeave,
  workingDaysBetween
} = require("../src/domain");

test("workingDaysBetween counts weekdays inclusively", () => {
  assert.equal(workingDaysBetween("2026-05-15", "2026-05-18"), 2);
  assert.equal(workingDaysBetween("2026-05-16", "2026-05-17"), 0);
});

test("workingDaysBetween excludes Singapore public holidays supplied by the holiday cache", () => {
  assert.equal(
    workingDaysBetween("2026-05-29", "2026-06-01", [
      { date: "2026-06-01", holiday: "Vesak Day (observed)" }
    ]),
    1
  );
});

test("leaveDayBreakdown records weekends and public holidays excluded from deduction", () => {
  const breakdown = leaveDayBreakdown("2026-05-29", "2026-06-01", [
    { date: "2026-06-01", holiday: "Vesak Day (observed)" }
  ]);

  assert.equal(breakdown.days, 1);
  assert.deepEqual(breakdown.excludedDates, [
    { date: "2026-05-30", reason: "Weekend" },
    { date: "2026-05-31", reason: "Weekend" },
    { date: "2026-06-01", reason: "Vesak Day (observed)" }
  ]);
});

test("leaveSummary separates approved and pending leave days", () => {
  const user = {
    id: "u1",
    leaveEntitlement: 14,
    annualLeaveEntitlement: 14,
    carriedForwardLeave: 0,
    leavePolicyYear: 2026
  };
  const summary = leaveSummary(user, [
    { employeeId: "u1", leaveYear: 2026, status: "approved", days: 3 },
    { employeeId: "u1", leaveYear: 2026, status: "pending", days: 2 },
    { employeeId: "u1", leaveYear: 2026, type: "Medical Leave", status: "approved", days: 4 },
    { employeeId: "u1", leaveYear: 2026, status: "cancelled", days: 5 },
    { employeeId: "u1", leaveYear: 2025, status: "approved", days: 9 },
    { employeeId: "u2", leaveYear: 2026, status: "approved", days: 9 }
  ]);

  assert.deepEqual(summary, {
    year: 2026,
    entitlement: 14,
    baseEntitlement: 14,
    carriedForward: 0,
    birthdayLeave: 0,
    adjustments: 0,
    approved: 3,
    pending: 2,
    available: 11
  });
});

test("medicalLeaveSummary tracks medical leave separately from annual leave", () => {
  const user = {
    id: "u1",
    medicalLeaveEntitlement: 14,
    leavePolicyYear: 2026
  };
  const summary = medicalLeaveSummary(user, [
    { employeeId: "u1", leaveYear: 2026, type: "Medical Leave", status: "approved", days: 3 },
    { employeeId: "u1", leaveYear: 2026, type: "Medical Leave", status: "pending", days: 1.5 },
    { employeeId: "u1", leaveYear: 2026, type: "Annual Leave", status: "approved", days: 8 },
    { employeeId: "u1", leaveYear: 2026, type: "Medical Leave", status: "cancelled", days: 2 },
    { employeeId: "u2", leaveYear: 2026, type: "Medical Leave", status: "approved", days: 7 }
  ]);

  assert.deepEqual(summary, {
    year: 2026,
    entitlement: 14,
    approved: 3,
    pending: 1.5,
    available: 11,
    unreserved: 9.5
  });
});

test("serviceAdjustedAnnualLeave adds service years and caps annual base at 18", () => {
  const user = {
    startingLeaveEntitlement: 14,
    serviceStartDate: "2024-05-15"
  };
  const cappedUser = {
    startingLeaveEntitlement: 14,
    serviceStartDate: "2020-05-15"
  };

  assert.equal(completedYearsOfService("2024-05-15", "2026-05-14"), 1);
  assert.equal(completedYearsOfService("2024-05-15", "2026-05-15"), 2);
  assert.equal(serviceAdjustedAnnualLeave(user, "2026-05-14"), 15);
  assert.equal(serviceAdjustedAnnualLeave(user, "2026-05-15"), 16);
  assert.equal(serviceAdjustedAnnualLeave(cappedUser, "2026-05-15"), 18);
});

test("nextLeaveYearBalance carries forward unused leave into the new year", () => {
  const user = {
    id: "u1",
    startingLeaveEntitlement: 14,
    serviceStartDate: "2025-06-15",
    leaveEntitlement: 14,
    annualLeaveEntitlement: 14,
    carriedForwardLeave: 0,
    leavePolicyYear: 2025
  };

  const balance = nextLeaveYearBalance(user, [
    { employeeId: "u1", leaveYear: 2025, status: "approved", days: 13 }
  ], 2026);

  assert.deepEqual(balance, {
    year: 2026,
    previousYear: 2025,
    carriedForward: 1,
    birthdayLeave: 1,
    baseEntitlement: 14,
    entitlement: 16
  });
});

test("nextLeaveYearBalance keeps manually set annual leave as the base", () => {
  const user = {
    id: "u1",
    startingLeaveEntitlement: 24,
    serviceStartDate: "2020-01-01",
    leaveEntitlement: 24,
    annualLeaveEntitlement: 24,
    carriedForwardLeave: 0,
    leavePolicyYear: 2025
  };

  const balance = nextLeaveYearBalance(user, [], 2026);

  assert.equal(balance.baseEntitlement, 24);
  assert.equal(balance.birthdayLeave, 1);
  assert.equal(balance.entitlement, 49);
});

test("medicalClaimSummary tracks approved, pending, available, and unreserved amounts", () => {
  const user = { id: "u1", medicalClaimLimit: 500 };
  const summary = medicalClaimSummary(user, [
    { employeeId: "u1", claimType: "medical", status: "approved", amount: 120.25 },
    { employeeId: "u1", claimType: "medical", status: "pending", amount: 80.1 },
    { employeeId: "u1", claimType: "general", status: "approved", amount: 999 },
    { employeeId: "u2", claimType: "medical", status: "approved", amount: 50 }
  ]);

  assert.deepEqual(summary, {
    limit: 500,
    approved: 120.25,
    pending: 80.1,
    available: 379.75,
    unreserved: 299.65
  });
});

test("generalClaimSummary tracks only others claim amounts", () => {
  const user = { id: "u1", medicalClaimLimit: 500 };
  const summary = generalClaimSummary(user, [
    { employeeId: "u1", claimType: "general", status: "approved", amount: 120.25 },
    { employeeId: "u1", claimType: "general", status: "pending", amount: 80.1 },
    { employeeId: "u1", claimType: "medical", status: "approved", amount: 999 },
    { employeeId: "u2", claimType: "general", status: "approved", amount: 50 }
  ]);

  assert.deepEqual(summary, {
    approved: 120.25,
    pending: 80.1
  });
});

test("canReview allows admins and assigned direct reports", () => {
  const request = { managerId: "m1" };
  assert.equal(canReview({ id: "a1", role: "admin" }, request), true);
  assert.equal(canReview({ id: "m1", role: "manager" }, request), true);
  assert.equal(canReview({ id: "m2", role: "manager" }, request), false);
});

test("normalizeMoney rounds to cents and rejects invalid amounts", () => {
  assert.equal(normalizeMoney("58.456"), 58.46);
  assert.throws(() => normalizeMoney("0"), /greater than 0/);
});

test("normalizeLeaveDays only allows half-day increments", () => {
  assert.equal(normalizeLeaveDays("14.5"), 14.5);
  assert.equal(normalizeSignedLeaveDays("-0.5"), -0.5);
  assert.throws(() => normalizeLeaveDays("14.25"), /half-day increments/);
  assert.throws(() => normalizeSignedLeaveDays("-0.25"), /half-day increments/);
});
