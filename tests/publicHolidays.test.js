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

test("withObservedRestDayHolidays does not duplicate an official observed holiday", () => {
  const holidays = withObservedRestDayHolidays([
    {
      date: "2026-08-09",
      day: "Sunday",
      holiday: "National Day",
      year: 2026,
      observed: false
    },
    {
      date: "2026-08-10",
      day: "Monday",
      holiday: "National Day (Observed)",
      year: 2026,
      observed: false
    },
    {
      date: "2026-08-11",
      day: "",
      holiday: "National Day (observed)",
      year: 2026,
      observed: true,
      observedFor: "2026-08-09"
    }
  ]);

  assert.deepEqual(
    holidays.filter((holiday) => holiday.date >= "2026-08-09" && holiday.date <= "2026-08-11")
      .map((holiday) => holiday.date),
    ["2026-08-09", "2026-08-10"]
  );
});
