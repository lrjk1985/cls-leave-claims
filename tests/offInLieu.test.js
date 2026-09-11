const test = require("node:test");
const assert = require("node:assert/strict");
const {
  allocateOffInLieu,
  DAY_PORTIONS,
  normalizeDayPortion,
  offInLieuExpiresOn,
  offInLieuSummary
} = require("../src/offInLieu");

function award(id, employeeId, days, awardDate, expiresOn, extra = {}) {
  return {
    id,
    employeeId,
    days,
    awardDate,
    expiresOn,
    reason: "Test award",
    awardedBy: "admin",
    createdAt: `${awardDate}T00:00:00.000Z`,
    revokedAt: null,
    ...extra
  };
}

test("OIL expires on the exclusive first anniversary", () => {
  assert.equal(offInLieuExpiresOn("2026-09-15"), "2027-09-15");
  assert.equal(offInLieuExpiresOn("2028-02-29"), "2029-03-01");
});

test("half-day portions require one date and an approved leave type", () => {
  assert.equal(normalizeDayPortion({
    type: "Medical Leave",
    startDate: "2026-09-15",
    endDate: "2026-09-15",
    dayPortion: "morning"
  }), DAY_PORTIONS.MORNING);
  assert.throws(() => normalizeDayPortion({
    type: "Maternity Leave",
    startDate: "2026-09-15",
    endDate: "2026-09-15",
    dayPortion: "afternoon"
  }), /Full Day/);
  assert.throws(() => normalizeDayPortion({
    type: "Annual Leave",
    startDate: "2026-09-15",
    endDate: "2026-09-16",
    dayPortion: "morning"
  }), /single date/);
});

test("missing day portion remains backward-compatible Full Day", () => {
  assert.equal(normalizeDayPortion({
    type: "Annual Leave",
    startDate: "2026-09-15",
    endDate: "2026-09-16"
  }), DAY_PORTIONS.FULL);
});

test("OIL allocates each leave date from the earliest expiring award", () => {
  const result = allocateOffInLieu({
    employeeId: "u1",
    requestId: "leave1",
    leaveDates: [{ date: "2026-10-01", days: 1 }],
    awards: [
      award("later", "u1", 2, "2026-08-01", "2027-08-01"),
      award("earlier", "u1", 0.5, "2026-01-01", "2027-01-01")
    ],
    allocations: [],
    requests: []
  });

  assert.deepEqual(result.map(({ awardId, leaveDate, days }) => ({ awardId, leaveDate, days })), [
    { awardId: "earlier", leaveDate: "2026-10-01", days: 0.5 },
    { awardId: "later", leaveDate: "2026-10-01", days: 0.5 }
  ]);
});

test("OIL allocations can split a multi-day request across expiry boundaries", () => {
  const result = allocateOffInLieu({
    employeeId: "u1",
    requestId: "leave1",
    leaveDates: [
      { date: "2026-09-14", days: 1 },
      { date: "2026-09-15", days: 1 }
    ],
    awards: [
      award("expiring", "u1", 1, "2025-09-15", "2026-09-15"),
      award("newer", "u1", 1, "2026-09-01", "2027-09-01")
    ],
    allocations: [],
    requests: []
  });

  assert.deepEqual(result.map(({ awardId, leaveDate }) => ({ awardId, leaveDate })), [
    { awardId: "expiring", leaveDate: "2026-09-14" },
    { awardId: "newer", leaveDate: "2026-09-15" }
  ]);
});

test("OIL allocation rejects insufficient eligible balance without partial output", () => {
  assert.throws(() => allocateOffInLieu({
    employeeId: "u1",
    requestId: "leave1",
    leaveDates: [{ date: "2026-09-15", days: 1 }],
    awards: [award("expired", "u1", 1, "2025-09-15", "2026-09-15")],
    allocations: [],
    requests: []
  }), /Insufficient Off-in-Lieu balance for 2026-09-15/);
});

test("rejected and cancelled allocations do not reserve OIL", () => {
  const allocations = [
    { id: "a1", awardId: "award1", leaveRequestId: "leave1", leaveDate: "2026-10-01", days: 0.5 },
    { id: "a2", awardId: "award1", leaveRequestId: "leave2", leaveDate: "2026-10-02", days: 0.5 }
  ];
  const summary = offInLieuSummary({
    employeeId: "u1",
    asOfDate: "2026-10-01",
    awards: [award("award1", "u1", 1, "2026-01-01", "2027-01-01")],
    allocations,
    requests: [
      { id: "leave1", status: "rejected" },
      { id: "leave2", status: "cancelled" }
    ]
  });

  assert.equal(summary.available, 1);
  assert.equal(summary.pending, 0);
  assert.equal(summary.unreserved, 1);
});

test("OIL summary separates approved, pending, and next expiry", () => {
  const summary = offInLieuSummary({
    employeeId: "u1",
    asOfDate: "2026-10-01",
    awards: [
      award("award1", "u1", 1, "2026-01-01", "2027-01-01"),
      award("award2", "u1", 1, "2026-02-01", "2027-02-01")
    ],
    allocations: [
      { id: "a1", awardId: "award1", leaveRequestId: "leave1", leaveDate: "2026-10-01", days: 0.5 },
      { id: "a2", awardId: "award2", leaveRequestId: "leave2", leaveDate: "2026-10-02", days: 0.5 }
    ],
    requests: [
      { id: "leave1", status: "approved" },
      { id: "leave2", status: "pending" }
    ]
  });

  assert.equal(summary.available, 1.5);
  assert.equal(summary.pending, 0.5);
  assert.equal(summary.unreserved, 1);
  assert.equal(summary.nextExpiry, "2027-01-01");
  assert.equal(summary.expiringDays, 0.5);
});
