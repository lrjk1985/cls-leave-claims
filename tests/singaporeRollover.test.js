const test = require("node:test");
const assert = require("node:assert/strict");
const { currentLeaveYear, leaveSummary } = require("../src/domain");
const { __test: { applyLeaveYearRollover } } = require("../server");

test("Singapore rollover at midnight and 00:05 counts advance bookings exactly once", () => {
  const db = {
    users: [{ id: "employee", annualLeaveEntitlement: 15, leaveEntitlement: 7, leavePolicyYear: 2026 }],
    leaveEntitlements: [], leaveRequests: [2026, 2027].map((year, i) => ({
      employeeId: "employee", type: "Annual Leave", leaveYear: year,
      status: "approved", days: i ? 5 : 2
    }))
  };
  const before = new Date("2026-12-31T15:59:59.999Z");
  assert.equal(applyLeaveYearRollover(db, before).processed.length, 0);
  assert.equal(currentLeaveYear(new Date("2026-12-31T16:00:00Z")), 2027);
  const cron = new Date("2027-01-01T00:05:00+08:00");
  const bookings = JSON.stringify(db.leaveRequests);
  assert.equal(applyLeaveYearRollover(db, cron).processed.length, 1);
  assert.equal(db.users[0].carriedForwardLeave, 5);
  assert.equal(db.users[0].leaveEntitlement, 21);
  assert.equal(leaveSummary(db.users[0], db.leaveRequests).available, 16);
  const rolled = JSON.stringify(db);
  assert.equal(applyLeaveYearRollover(db, cron).changed, false);
  assert.equal(JSON.stringify(db), rolled);
  assert.equal(JSON.stringify(db.leaveRequests), bookings);
});
