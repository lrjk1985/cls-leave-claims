const LEAVE_TYPES = Object.freeze({
  ANNUAL: "Annual Leave",
  MEDICAL: "Medical Leave",
  HOSPITALIZATION: "Hospitalization Leave",
  COMPASSIONATE: "Compassionate Leave",
  PATERNITY: "Paternity Leave",
  MATERNITY: "Maternity Leave",
  CHILDCARE: "Childcare Leave",
  NATIONAL_SERVICE: "National Service Leave",
  URGENT: "Urgent Leave",
  UNPAID: "Unpaid Leave"
});

const COUNTING_METHODS = Object.freeze({
  SCHEDULED: "scheduled_working_days",
  CALENDAR: "calendar_days",
  UNCAPPED_SCHEDULED: "uncapped_scheduled_days"
});

const DEFAULT_WORK_SCHEDULE = Object.freeze([1, 2, 3, 4, 5]);
const SPECIAL_LEAVE_TYPES = new Set([
  LEAVE_TYPES.HOSPITALIZATION.toLowerCase(),
  LEAVE_TYPES.COMPASSIONATE.toLowerCase(),
  LEAVE_TYPES.PATERNITY.toLowerCase(),
  LEAVE_TYPES.MATERNITY.toLowerCase(),
  LEAVE_TYPES.CHILDCARE.toLowerCase(),
  LEAVE_TYPES.NATIONAL_SERVICE.toLowerCase()
]);
const DOCUMENT_REQUIRED_TYPES = new Set([
  LEAVE_TYPES.MEDICAL.toLowerCase(),
  LEAVE_TYPES.HOSPITALIZATION.toLowerCase(),
  LEAVE_TYPES.NATIONAL_SERVICE.toLowerCase()
]);

function assertIsoDate(value, fieldName) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${fieldName} must be a date in YYYY-MM-DD format.`);
  }

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error(`${fieldName} is not a valid calendar date.`);
  }
  return date;
}

function normalizeWorkSchedule(value = DEFAULT_WORK_SCHEDULE) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Work schedule must contain at least one working day.");
  }

  const days = value.map(Number);
  if (days.some((day) => !Number.isInteger(day) || day < 1 || day > 7)) {
    throw new Error("Work schedule days must be whole numbers between 1 and 7.");
  }
  if (new Set(days).size !== days.length) {
    throw new Error("Work schedule days must be unique.");
  }
  return days.sort((left, right) => left - right);
}

function eachDate(startDate, endDate, callback) {
  const start = assertIsoDate(startDate, "Start date");
  const end = assertIsoDate(endDate, "End date");
  if (start > end) throw new Error("Start date must be before or equal to end date.");

  let count = 0;
  for (let cursor = start; cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    if (callback(cursor)) count += 1;
  }
  return count;
}

function scheduledDaysBetween(startDate, endDate, schedule, publicHolidays = []) {
  const scheduledDays = new Set(normalizeWorkSchedule(schedule));
  const holidayDates = new Set(publicHolidays.map((holiday) => holiday.date));
  return eachDate(startDate, endDate, (date) => {
    const isoDay = date.getUTCDay() || 7;
    const isoDate = date.toISOString().slice(0, 10);
    return scheduledDays.has(isoDay) && !holidayDates.has(isoDate);
  });
}

function calendarDaysBetween(startDate, endDate) {
  return eachDate(startDate, endDate, () => true);
}

function completedServiceMonths(serviceStartDate, asOfDate) {
  const start = assertIsoDate(serviceStartDate, "Service start date");
  const asOf = assertIsoDate(asOfDate, "As of date");
  if (start > asOf) return 0;

  let months = (asOf.getUTCFullYear() - start.getUTCFullYear()) * 12;
  months += asOf.getUTCMonth() - start.getUTCMonth();
  if (asOf.getUTCDate() < start.getUTCDate()) months -= 1;
  return Math.max(0, months);
}

function serviceMedicalEntitlement(serviceStartDate, asOfDate) {
  const months = completedServiceMonths(serviceStartDate, asOfDate);
  if (months < 3) return { outpatient: 0, combined: 0 };
  if (months === 3) return { outpatient: 5, combined: 15 };
  if (months === 4) return { outpatient: 8, combined: 30 };
  if (months === 5) return { outpatient: 11, combined: 45 };
  return { outpatient: 14, combined: 60 };
}

function paternityGrantDays(schedule) {
  return Math.min(6, normalizeWorkSchedule(schedule).length) * 4;
}

function normalizedLeaveType(type) {
  return String(type || "").trim().toLowerCase();
}

function isMedicalLeaveType(type) {
  return normalizedLeaveType(type) === LEAVE_TYPES.MEDICAL.toLowerCase();
}

function isSpecialLeaveType(type) {
  return SPECIAL_LEAVE_TYPES.has(normalizedLeaveType(type));
}

function requiresSupportingDocument(type) {
  return DOCUMENT_REQUIRED_TYPES.has(normalizedLeaveType(type));
}

module.exports = {
  calendarDaysBetween,
  COUNTING_METHODS,
  isMedicalLeaveType,
  isSpecialLeaveType,
  LEAVE_TYPES,
  normalizeWorkSchedule,
  paternityGrantDays,
  requiresSupportingDocument,
  scheduledDaysBetween,
  serviceMedicalEntitlement
};
