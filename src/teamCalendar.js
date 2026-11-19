const { getSingaporePublicHolidaysForRange } = require("./publicHolidays");

async function teamCalendar(db, month, holidaysForRange = getSingaporePublicHolidaysForRange) {
  if (!/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(month || "")) throw new Error("Choose a valid calendar month.");
  const [year, number] = month.split("-").map(Number);
  const first = month + "-01";
  const length = new Date(Date.UTC(year, number, 0)).getUTCDate();
  const last = month + "-" + length;
  const bookings = db.leaveRequests.filter(r => r.status === "approved" && r.startDate <= last && r.endDate >= first);
  const names = new Map(db.users.map(u => [u.id, u.name]));
  // Legacy breakdowns marked weekends before checking holidays. A weekend worker
  // may therefore need the holiday calendar to distinguish an actual working day.
  const hasWeekendSchedule = bookings.some(r => r.countingMethod !== "calendar_days" &&
    r.workScheduleSnapshot?.some(d => d === 6 || d === 7));
  const holidays = new Set(hasWeekendSchedule ? (await holidaysForRange(first, last)).map(h => h.date) : []);
  const entries = [];
  for (const r of bookings) {
    const name = names.get(r.employeeId);
    if (!name) continue;
    const excluded = new Set((r.excludedDates || []).filter(e => e.reason !== "Weekend").map(e => e.date));
    const schedule = r.workScheduleSnapshot || [1, 2, 3, 4, 5];
    for (let day = 1; day <= length; day++) {
      const date = month + "-" + String(day).padStart(2, "0");
      if (date < r.startDate || date > r.endDate) continue;
      const weekday = new Date(Date.UTC(year, number - 1, day)).getUTCDay() || 7;
      if (r.countingMethod !== "calendar_days" && (!schedule.includes(weekday) || excluded.has(date) ||
        (weekday >= 6 && holidays.has(date)))) continue;
      entries.push({ name, date, portion: r.dayPortion === "morning" ? "AM" : r.dayPortion === "afternoon" ? "PM" : "Full day" });
    }
  }
  return entries.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name) || a.portion.localeCompare(b.portion));
}

module.exports = { teamCalendar };
