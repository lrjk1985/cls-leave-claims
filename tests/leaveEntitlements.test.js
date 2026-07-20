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
