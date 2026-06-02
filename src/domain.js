const VALID_DECISIONS = new Set(["approved", "rejected"]);
const MAX_ANNUAL_LEAVE_DAYS = 18;
const ANNUAL_BIRTHDAY_LEAVE_DAYS = 1;

function assertIsoDate(value, fieldName) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${fieldName} must be a date in YYYY-MM-DD format.`);
  }

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error(`${fieldName} is not a valid calendar date.`);
  }

  return date;
}

function formatIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function currentLeaveYear(date = new Date()) {
  return date.getFullYear();
}

function yearFromIsoDate(value, fieldName = "Date") {
  return assertIsoDate(value, fieldName).getUTCFullYear();
}

function addDays(date, days) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function isWeekend(date) {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

function leaveDayBreakdown(startDate, endDate, publicHolidays = []) {
  const start = assertIsoDate(startDate, "Start date");
  const end = assertIsoDate(endDate, "End date");

  if (start > end) {
    throw new Error("Start date must be before or equal to end date.");
  }

  const holidayByDate = new Map(
    publicHolidays.map((holiday) => [holiday.date, holiday.holiday || holiday.name || "Public Holiday"])
  );
  const excludedDates = [];
  let deductibleDays = 0;

  for (let cursor = start; cursor <= end; cursor = addDays(cursor, 1)) {
    const date = formatIsoDate(cursor);
    if (isWeekend(cursor)) {
      excludedDates.push({
        date,
        reason: "Weekend"
      });
    } else if (holidayByDate.has(date)) {
      excludedDates.push({
        date,
        reason: holidayByDate.get(date)
      });
    } else {
      deductibleDays += 1;
    }
  }

  return {
    days: deductibleDays,
    excludedDates
  };
}

function workingDaysBetween(startDate, endDate, publicHolidays = []) {
  return leaveDayBreakdown(startDate, endDate, publicHolidays).days;
}

function normalizeMoney(value, fieldName = "Amount") {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(`${fieldName} must be greater than 0.`);
  }
  return Math.round(amount * 100) / 100;
}

function normalizeLeaveDays(value, fieldName = "Leave days") {
  const days = Number(value);
  if (!Number.isFinite(days) || days < 0) {
    throw new Error(`${fieldName} must be 0 or more.`);
  }
  return Math.round(days * 100) / 100;
}

function normalizeSignedLeaveDays(value, fieldName = "Leave days") {
  const days = Number(value);
  if (!Number.isFinite(days)) {
    throw new Error(`${fieldName} must be a valid number.`);
  }
  return Math.round(days * 100) / 100;
}

function canAdmin(user) {
  return Boolean(user && user.role === "admin");
}

function canReview(user, item) {
  return Boolean(user && item && (canAdmin(user) || item.managerId === user.id));
}

function canSeeEmployee(user, employee) {
  return Boolean(
    user &&
      employee &&
      (canAdmin(user) || user.id === employee.id || employee.managerId === user.id)
  );
}

function completedYearsOfService(serviceStartDate, asOfDate) {
  const start = assertIsoDate(serviceStartDate, "Service start date");
  const asOf = assertIsoDate(asOfDate, "As of date");
  if (start > asOf) return 0;

  let years = asOf.getUTCFullYear() - start.getUTCFullYear();
  const anniversaryThisYear = new Date(Date.UTC(
    asOf.getUTCFullYear(),
    start.getUTCMonth(),
    start.getUTCDate(),
    12,
    0,
    0
  ));
  if (asOf < anniversaryThisYear) years -= 1;
  return Math.max(0, years);
}

function asIsoDate(value) {
  if (value instanceof Date) return formatIsoDate(value);
  if (typeof value === "number") return `${value}-01-01`;
  return String(value);
}

function serviceAdjustedAnnualLeave(user, asOfDate = new Date()) {
  const asOf = asIsoDate(asOfDate);
  const base = normalizeLeaveDays(
    user.startingLeaveEntitlement ?? user.leaveEntitlement ?? 0,
    "Initial annual leave days"
  );
  const serviceStartDate = user.serviceStartDate || asOf;
  const years = completedYearsOfService(serviceStartDate, asOf);
  return Math.min(MAX_ANNUAL_LEAVE_DAYS, base + years);
}

function leaveRequestYear(request) {
  return Number(request.leaveYear || yearFromIsoDate(request.startDate, "Leave start date"));
}

function leaveSummary(user, leaveRequests, options = {}) {
  const year = Number(options.year || user.leavePolicyYear || currentLeaveYear());
  const adjustments = normalizeSignedLeaveDays(options.adjustments ?? 0, "Leave adjustments");
  const birthdayLeave = normalizeLeaveDays(
    options.birthdayLeave ?? user.birthdayLeaveEntitlement ?? 0,
    "Birthday leave"
  );
  const entitlement = normalizeLeaveDays(
    options.entitlementOverride ?? user.leaveEntitlement ?? 0,
    "Leave entitlement"
  );
  const ownRequests = leaveRequests.filter(
    (request) => request.employeeId === user.id && leaveRequestYear(request) === year
  );
  const approved = ownRequests
    .filter((request) => request.status === "approved")
    .reduce((total, request) => total + Number(request.days || 0), 0);
  const pending = ownRequests
    .filter((request) => request.status === "pending")
    .reduce((total, request) => total + Number(request.days || 0), 0);
  return {
    year,
    entitlement,
    baseEntitlement: normalizeLeaveDays(user.annualLeaveEntitlement ?? entitlement, "Annual leave entitlement"),
    carriedForward: normalizeLeaveDays(user.carriedForwardLeave ?? 0, "Carried forward leave"),
    birthdayLeave,
    adjustments,
    approved: normalizeLeaveDays(approved, "Approved leave"),
    pending: normalizeLeaveDays(pending, "Pending leave"),
    available: normalizeLeaveDays(Math.max(0, entitlement - approved), "Available leave")
  };
}

function nextLeaveYearBalance(user, leaveRequests, nextYear) {
  const previousYear = Number(nextYear) - 1;
  const previousSummary = leaveSummary(user, leaveRequests, {
    year: previousYear,
    entitlementOverride: user.leaveEntitlement
  });
  const carriedForward = previousSummary.available;
  const baseEntitlement = normalizeLeaveDays(
    user.annualLeaveEntitlement ?? user.startingLeaveEntitlement ?? user.leaveEntitlement ?? 0,
    "Annual leave entitlement"
  );
  const birthdayLeave = normalizeLeaveDays(ANNUAL_BIRTHDAY_LEAVE_DAYS, "Birthday leave");

  return {
    year: Number(nextYear),
    previousYear,
    carriedForward,
    birthdayLeave,
    baseEntitlement,
    entitlement: normalizeLeaveDays(baseEntitlement + carriedForward + birthdayLeave, "Leave entitlement")
  };
}

function claimKind(value) {
  return value === "general" ? "general" : "medical";
}

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function medicalClaimSummary(user, claims) {
  const ownMedicalClaims = claims.filter(
    (claim) => claim.employeeId === user.id && claimKind(claim.claimType) === "medical"
  );
  const approved = ownMedicalClaims
    .filter((claim) => claim.status === "approved")
    .reduce((total, claim) => total + Number(claim.amount || 0), 0);
  const pending = ownMedicalClaims
    .filter((claim) => claim.status === "pending")
    .reduce((total, claim) => total + Number(claim.amount || 0), 0);
  const limit = Number(user.medicalClaimLimit || 0);

  return {
    limit,
    approved: roundMoney(approved),
    pending: roundMoney(pending),
    available: roundMoney(limit - approved),
    unreserved: roundMoney(limit - approved - pending)
  };
}

function generalClaimSummary(user, claims) {
  const ownGeneralClaims = claims.filter(
    (claim) => claim.employeeId === user.id && claimKind(claim.claimType) === "general"
  );
  const approved = ownGeneralClaims
    .filter((claim) => claim.status === "approved")
    .reduce((total, claim) => total + Number(claim.amount || 0), 0);
  const pending = ownGeneralClaims
    .filter((claim) => claim.status === "pending")
    .reduce((total, claim) => total + Number(claim.amount || 0), 0);

  return {
    approved: roundMoney(approved),
    pending: roundMoney(pending)
  };
}

function decisionLabel(status) {
  if (status === "approved") return "Approved";
  if (status === "rejected") return "Not Approved";
  return "Pending";
}

function assertDecision(status) {
  if (!VALID_DECISIONS.has(status)) {
    throw new Error("Decision must be approved or rejected.");
  }
}

module.exports = {
  assertDecision,
  assertIsoDate,
  ANNUAL_BIRTHDAY_LEAVE_DAYS,
  canAdmin,
  canReview,
  canSeeEmployee,
  completedYearsOfService,
  currentLeaveYear,
  decisionLabel,
  formatIsoDate,
  generalClaimSummary,
  leaveDayBreakdown,
  leaveRequestYear,
  leaveSummary,
  MAX_ANNUAL_LEAVE_DAYS,
  medicalClaimSummary,
  nextLeaveYearBalance,
  normalizeLeaveDays,
  normalizeSignedLeaveDays,
  normalizeMoney,
  serviceAdjustedAnnualLeave,
  workingDaysBetween
};
