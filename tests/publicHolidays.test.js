const test = require("node:test");
const assert = require("node:assert/strict");
const {
  withObservedRestDayHolidays
} = require("../src/publicHolidays");

test("withObservedRestDayHolidays adds next working day for Sunday public holidays", () => {
  const holidays = withObservedRestDayHolidays([
    {
      date: "2026-05-31",
      day: "Sunday",
      holiday: "Vesak Day",
      year: 2026,
      observed: false
    }
  ]);

  assert.deepEqual(
    holidays.map((holiday) => ({
      date: holiday.date,
      holiday: holiday.holiday,
      observed: holiday.observed
    })),
    [
      { date: "2026-05-31", holiday: "Vesak Day", observed: false },
      { date: "2026-06-01", holiday: "Vesak Day (observed)", observed: true }
    ]
  );
});

test("withObservedRestDayHolidays skips occupied weekdays", () => {
  const holidays = withObservedRestDayHolidays([
    {
      date: "2027-02-07",
      day: "Sunday",
      holiday: "Example Sunday Holiday",
      year: 2027,
      observed: false
    },
    {
      date: "2027-02-08",
      day: "Monday",
      holiday: "Existing Monday Holiday",
      year: 2027,
      observed: false
    }
  ]);

  assert.equal(holidays.some((holiday) => holiday.date === "2027-02-09" && holiday.observed), true);
});
