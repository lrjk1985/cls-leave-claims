const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Isolate the calendar from local files and the external holiday service.
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cls-leave-tests-"));
const previousCache = process.env.PUBLIC_HOLIDAY_CACHE_PATH;
process.env.PUBLIC_HOLIDAY_CACHE_PATH = path.join(directory, "holidays.json");
fs.writeFileSync(process.env.PUBLIC_HOLIDAY_CACHE_PATH, JSON.stringify({
  syncedAt: new Date().toISOString(), years: [2026],
  holidays: [{ date: "2026-09-16", holiday: "Synthetic test holiday", year: 2026 }]
}));
const { __test } = require("../server");
test.after(() => {
  fs.rmSync(directory, { recursive: true });
  if (previousCache === undefined) delete process.env.PUBLIC_HOLIDAY_CACHE_PATH;
  else process.env.PUBLIC_HOLIDAY_CACHE_PATH = previousCache;
});

function fixture() {
  const db = __test.normalizeDb({ users: [
    { id: "employee", name: "Test employee", role: "employee", active: true,
      managerId: "manager", workSchedule: [1,2,3,4,5], leavePolicyYear: 2026,
      annualLeaveEntitlement: 14, leaveEntitlement: 14 },
    { id: "manager", name: "Test manager", role: "manager", active: true }
  ], offInLieuAwards: [{ id: "award", employeeId: "employee", days: 1,
    awardDate: "2026-09-01", expiresOn: "2027-09-01" }] });
  return { db, employee: db.users[0], manager: db.users[1] };
}

function submit(db, employee, date, dayPortion = "full", endDate = date) {
  return __test.createLeaveRequest(db, employee, {
    type: "Off-in-Lieu Leave", startDate: date, endDate, dayPortion
  });
}

test("full and half-day OIL reject weekends and holidays without reserving balance", async () => {
  for (const portion of ["full", "morning", "afternoon"]) {
    for (const date of ["2026-09-19", "2026-09-20", "2026-09-16"]) {
      const { db, employee } = fixture();
      await assert.rejects(submit(db, employee, date, portion), /holiday|weekend/i);
      assert.equal(db.leaveRequests.length, 0);
      assert.equal(db.offInLieuAllocations.length, 0);
      assert.equal(db.emails.length, 0);
    }
  }
});

test("full-day OIL counts only eligible dates in a range", async () => {
  const { db, employee } = fixture();
  const request = await submit(db, employee, "2026-09-15", "full", "2026-09-16");
  assert.equal(request.days, 1);
  assert.deepEqual(db.offInLieuAllocations.map((a) => a.leaveDate), ["2026-09-15"]);
  assert.equal(employee.leaveEntitlement, 14);
});

test("pending OIL reserves funds and cancellation releases them for a new request", async () => {
  const { db, employee } = fixture();
  const first = await submit(db, employee, "2026-09-15");
  await assert.rejects(submit(db, employee, "2026-09-17"), /Insufficient Off-in-Lieu/);
  await __test.cancelLeaveRequest(db, employee, first.id, {}, { asOfDate: "2026-09-14" });
  const replacement = await submit(db, employee, "2026-09-17");
  assert.equal(first.status, "cancelled");
  assert.equal(replacement.status, "pending");
  assert.equal(employee.leaveEntitlement, 14);
});

test("OIL approval retains usage while rejection releases it", async () => {
  for (const decision of ["approved", "rejected"]) {
    const { db, employee, manager } = fixture();
    const request = await submit(db, employee, "2026-09-15");
    await __test.decideLeaveRequest(db, manager, request.id, { status: decision });
    if (decision === "approved") {
      await assert.rejects(submit(db, employee, "2026-09-17"), /Insufficient Off-in-Lieu/);
    } else {
      assert.equal((await submit(db, employee, "2026-09-17")).days, 1);
    }
    assert.equal(employee.leaveEntitlement, 14);
  }
});
