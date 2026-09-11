const DAY_PORTIONS = Object.freeze({
  FULL: "full",
  MORNING: "morning",
  AFTERNOON: "afternoon"
});

const HALF_DAY_LEAVE_TYPES = new Set([
  "annual leave",
  "urgent leave",
  "medical leave",
  "off-in-lieu leave",
  "unpaid leave"
]);

const RESERVED_STATUSES = new Set(["pending", "approved"]);

function parseIsoDate(value, fieldName) {
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

function offInLieuExpiresOn(awardDate) {
  const date = parseIsoDate(awardDate, "Award date");
  date.setUTCFullYear(date.getUTCFullYear() + 1);
  return date.toISOString().slice(0, 10);
}

function normalizeDayPortion(input = {}) {
  const dayPortion = String(input.dayPortion || DAY_PORTIONS.FULL).trim().toLowerCase();
  if (!Object.values(DAY_PORTIONS).includes(dayPortion)) {
    throw new Error("Leave duration must be Full Day, Morning Half, or Afternoon Half.");
  }
  if (dayPortion === DAY_PORTIONS.FULL) return dayPortion;
  if (!HALF_DAY_LEAVE_TYPES.has(String(input.type || "").trim().toLowerCase())) {
    throw new Error(`${input.type || "This leave type"} must be requested as Full Day leave.`);
  }
  if (input.startDate !== input.endDate) {
    throw new Error("Half-day leave must use a single date.");
  }
  return dayPortion;
}

function requestStatusById(requests) {
  return new Map((requests || []).map((request) => [request.id, request.status]));
}

function reservedDaysByAward(allocations, requests, excludedRequestId = null) {
  const statuses = requestStatusById(requests);
  const reserved = new Map();
  for (const allocation of allocations || []) {
    if (allocation.leaveRequestId === excludedRequestId) continue;
    if (!RESERVED_STATUSES.has(statuses.get(allocation.leaveRequestId))) continue;
    reserved.set(
      allocation.awardId,
      Number(reserved.get(allocation.awardId) || 0) + Number(allocation.days || 0)
    );
  }
  return reserved;
}

function compareAwards(left, right) {
  return left.expiresOn.localeCompare(right.expiresOn) ||
    left.awardDate.localeCompare(right.awardDate) ||
    String(left.createdAt || "").localeCompare(String(right.createdAt || "")) ||
    String(left.id).localeCompare(String(right.id));
}

function allocateOffInLieu(input = {}) {
  const reserved = reservedDaysByAward(input.allocations, input.requests, input.requestId);
  const remainingByAward = new Map();
  const employeeAwards = (input.awards || [])
    .filter((award) => award.employeeId === input.employeeId && !award.revokedAt)
    .slice()
    .sort(compareAwards);
  for (const award of employeeAwards) {
    remainingByAward.set(
      award.id,
      Math.max(0, Number(award.days || 0) - Number(reserved.get(award.id) || 0))
    );
  }

  const drafts = [];
  for (const leaveDate of input.leaveDates || []) {
    parseIsoDate(leaveDate.date, "Leave date");
    let needed = Number(leaveDate.days || 0);
    if (!Number.isFinite(needed) || needed <= 0 || !Number.isInteger(needed * 2)) {
      throw new Error("Off-in-Lieu allocation days must be positive half-day increments.");
    }

    for (const award of employeeAwards) {
      if (needed <= 0) break;
      if (award.awardDate > leaveDate.date || leaveDate.date >= award.expiresOn) continue;
      const remaining = Number(remainingByAward.get(award.id) || 0);
      if (remaining <= 0) continue;
      const days = Math.min(remaining, needed);
      drafts.push({
        awardId: award.id,
        leaveRequestId: input.requestId,
        leaveDate: leaveDate.date,
        days
      });
      remainingByAward.set(award.id, remaining - days);
      needed -= days;
    }

    if (needed > 0) {
      throw new Error(`Insufficient Off-in-Lieu balance for ${leaveDate.date}.`);
    }
  }
  return drafts;
}

function offInLieuSummary(input = {}) {
  const statuses = requestStatusById(input.requests);
  const awards = (input.awards || [])
    .filter((award) => award.employeeId === input.employeeId)
    .slice()
    .sort(compareAwards)
    .map((award) => {
      let approved = 0;
      let pending = 0;
      for (const allocation of input.allocations || []) {
        if (allocation.awardId !== award.id) continue;
        const status = statuses.get(allocation.leaveRequestId);
        if (status === "approved") approved += Number(allocation.days || 0);
        if (status === "pending") pending += Number(allocation.days || 0);
      }
      const active = !award.revokedAt && award.awardDate <= input.asOfDate && input.asOfDate < award.expiresOn;
      return {
        ...award,
        approved,
        pending,
        available: active ? Math.max(0, Number(award.days || 0) - approved) : 0,
        unreserved: active ? Math.max(0, Number(award.days || 0) - approved - pending) : 0,
        active
      };
    });

  const activeAwards = awards.filter((award) => award.active);
  const available = activeAwards.reduce((total, award) => total + award.available, 0);
  const pending = activeAwards.reduce((total, award) => total + award.pending, 0);
  const unreserved = activeAwards.reduce((total, award) => total + award.unreserved, 0);
  const nextAward = activeAwards.find((award) => award.unreserved > 0) || null;
  return {
    available,
    pending,
    unreserved,
    nextExpiry: nextAward?.expiresOn || null,
    expiringDays: nextAward
      ? activeAwards
        .filter((award) => award.expiresOn === nextAward.expiresOn)
        .reduce((total, award) => total + award.unreserved, 0)
      : 0,
    awards
  };
}

module.exports = {
  allocateOffInLieu,
  DAY_PORTIONS,
  HALF_DAY_LEAVE_TYPES,
  normalizeDayPortion,
  offInLieuExpiresOn,
  offInLieuSummary
};
