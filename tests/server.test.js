const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { __test } = require("../server");

test("normalizeDb adds entitlement collections and default work schedules", () => {
  const db = __test.normalizeDb({ users: [{ id: "u1", serviceStartDate: "2026-01-01" }] });
  assert.deepEqual(db.leaveEntitlements, []);
  assert.deepEqual(db.leaveEntitlementAdjustments, []);
  assert.deepEqual(db.leavePolicySettings, []);
  assert.deepEqual(db.users[0].workSchedule, [1, 2, 3, 4, 5]);
});
const { medicalClaimSummary, medicalLeaveSummary } = require("../src/domain");

test("parseMultipartBuffer keeps receipt uploads binary", () => {
  const boundary = "----cls-leave-claims-test";
  const receiptBytes = Buffer.from("%PDF-1.4\nbinary\u0000receipt-data\n", "utf8");
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="category"\r\n\r\nMedical\r\n`, "utf8"),
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="receipt"; filename="receipt.pdf"\r\nContent-Type: application/pdf\r\n\r\n`,
      "utf8"
    ),
    receiptBytes,
    Buffer.from(`\r\n--${boundary}--\r\n`, "utf8")
  ]);

  const parsed = __test.parseMultipartBuffer(body, boundary);
  assert.equal(parsed.category, "Medical");
  assert.equal(parsed.receipt.name, "receipt.pdf");
  assert.equal(parsed.receipt.type, "application/pdf");
  assert.deepEqual(parsed.receipt.buffer, receiptBytes);

  const receipt = __test.parseReceipt(parsed.receipt);
  assert.equal(receipt.originalName, "receipt.pdf");
  assert.equal(receipt.mimeType, "application/pdf");
  assert.deepEqual(receipt.buffer, receiptBytes);
});

test("receiptUploadMetadata falls back to file extension when browser MIME is missing", () => {
  const metadata = __test.receiptUploadMetadata({
    name: "receipt.jpg",
    type: "application/octet-stream",
    size: 1024
  });

  assert.equal(metadata.mimeType, "image/jpeg");
  assert.equal(metadata.extension, ".jpg");
});

test("resolveSupabaseSignedUrl builds a browser upload URL from a token", () => {
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";

  try {
    const endpoint = __test.storageObjectEndpoint("claim-receipts", "pending/user-1/receipt.pdf", "object/upload/sign");
    const signedUrl = __test.resolveSupabaseSignedUrl("", "upload-token", endpoint);
    assert.equal(
      signedUrl,
      "https://example.supabase.co/storage/v1/object/upload/sign/claim-receipts/pending/user-1/receipt.pdf?token=upload-token"
    );
  } finally {
    if (previousUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
  }
});

test("pruneExpiredSessions clears saved and in-memory expired sessions", () => {
  const now = Date.now();
  const expired = { token: "expired", userId: "usr_1", expiresAt: now - 1, createdAt: "2026-06-04T00:00:00.000Z" };
  const current = { token: "current", userId: "usr_1", expiresAt: now + 1000, createdAt: "2026-06-04T01:00:00.000Z" };
  const db = { sessions: [expired, current] };

  __test.sessions.clear();
  __test.sessions.set(expired.token, expired);
  __test.sessions.set(current.token, current);

  assert.equal(__test.pruneExpiredSessions(db, now), true);
  assert.deepEqual(db.sessions, [current]);
  assert.equal(__test.sessions.has(expired.token), false);
  assert.equal(__test.sessions.has(current.token), true);

  __test.sessions.clear();
});

test("limitSessionsForUser keeps only the newest sessions for that user", () => {
  const now = Date.now();
  const userSessions = Array.from({ length: 7 }, (_item, index) => ({
    token: `usr_1_${index}`,
    userId: "usr_1",
    expiresAt: now + index,
    createdAt: `2026-06-04T00:0${index}:00.000Z`
  }));
  const otherSession = {
    token: "usr_2_0",
    userId: "usr_2",
    expiresAt: now,
    createdAt: "2026-06-04T00:00:00.000Z"
  };
  const db = { sessions: [...userSessions, otherSession] };

  __test.sessions.clear();
  db.sessions.forEach((session) => __test.sessions.set(session.token, session));

  assert.equal(__test.limitSessionsForUser(db, "usr_1", 3), true);
  assert.deepEqual(
    db.sessions.filter((session) => session.userId === "usr_1").map((session) => session.token),
    ["usr_1_4", "usr_1_5", "usr_1_6"]
  );
  assert.equal(db.sessions.some((session) => session.token === otherSession.token), true);
  assert.equal(__test.sessions.has("usr_1_0"), false);
  assert.equal(__test.sessions.has("usr_1_6"), true);
  assert.equal(__test.sessions.has(otherSession.token), true);

  __test.sessions.clear();
});

test("deliverQueuedEmails records Resend failures without throwing", async () => {
  const previousFetch = global.fetch;
  const previousKey = process.env.RESEND_API_KEY;
  const previousWarn = console.warn;
  process.env.RESEND_API_KEY = "resend-test-key";
  console.warn = () => {};
  global.fetch = async () => ({
    ok: false,
    status: 500,
    statusText: "Server Error",
    text: async () => "temporary outage"
  });

  const db = {
    users: [{ id: "usr_1", name: "Employee", email: "employee@cls.local" }],
    emails: []
  };
  const email = __test.addEmail(db, {
    recipientId: "usr_1",
    type: "claim_decided",
    subject: "Claim approved",
    body: "Your claim was approved.",
    relatedId: "claim_1"
  });

  try {
    const result = await __test.deliverQueuedEmails(db);
    assert.equal(result.failed, 1);
    assert.equal(result.changed, true);
    assert.equal(email.delivered, false);
    assert.match(email.deliveryError, /Resend returned HTTP 500/);
  } finally {
    global.fetch = previousFetch;
    console.warn = previousWarn;
    if (previousKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = previousKey;
  }
});

test("resetEmployeePassword sets a new temporary password", () => {
  const db = {
    users: [
      {
        id: "usr_1",
        email: "employee@cls.local",
        name: "Employee",
        active: true
      }
    ]
  };

  const { employee, temporaryPassword } = __test.resetEmployeePassword(db, "usr_1", {
    password: "welcome123"
  });

  assert.equal(temporaryPassword, "welcome123");
  assert.equal(employee.updatedAt.includes("T"), true);
  assert.equal(__test.verifyPassword("welcome123", employee), true);
  assert.throws(
    () => __test.resetEmployeePassword(db, "usr_1", { password: "short" }),
    /Temporary password must be at least 8 characters/
  );
});

test("addAuditEvent records actor details and redacts secrets", () => {
  const db = {
    users: [
      {
        id: "usr_admin",
        name: "Admin",
        email: "admin@cls.local",
        role: "admin"
      },
      {
        id: "usr_employee",
        name: "Employee",
        email: "employee@cls.local",
        role: "employee"
      }
    ],
    auditEvents: []
  };

  const event = __test.addAuditEvent(db, db.users[0], {
    action: "employee.password_reset",
    affectedUserId: "usr_employee",
    relatedType: "employee",
    relatedId: "usr_employee",
    summary: "Reset login password for Employee.",
    metadata: {
      temporaryPassword: "welcome123",
      nested: { passwordHash: "hash-value" },
      safe: "kept"
    }
  });

  assert.equal(db.auditEvents.length, 1);
  assert.equal(event.actorName, "Admin");
  assert.equal(event.affectedUserName, "Employee");
  assert.equal(event.metadata.temporaryPassword, "[redacted]");
  assert.equal(event.metadata.nested.passwordHash, "[redacted]");
  assert.equal(event.metadata.safe, "kept");
});

test("auditPage is admin-only and searchable", () => {
  const db = {
    users: [
      {
        id: "usr_admin",
        name: "Admin",
        email: "admin@cls.local",
        role: "admin"
      },
      {
        id: "usr_employee",
        name: "Employee",
        email: "employee@cls.local",
        role: "employee"
      }
    ],
    auditEvents: []
  };
  __test.addAuditEvent(db, db.users[0], {
    action: "leave.approved",
    affectedUserId: "usr_employee",
    relatedType: "leave",
    relatedId: "leave_1",
    summary: "Admin approved leave for Employee."
  });

  const searchParams = new URLSearchParams({ query: "leave_1" });
  const page = __test.auditPage(db, db.users[0], searchParams);
  assert.equal(page.total, 1);
  assert.equal(page.items[0].relatedId, "leave_1");
  assert.throws(
    () => __test.auditPage(db, db.users[1], new URLSearchParams()),
    /Admin access is required/
  );
});

test("addMaintenanceAuditEvents records system maintenance changes", () => {
  const db = {
    users: [],
    auditEvents: []
  };

  const added = __test.addMaintenanceAuditEvents(db, null, {
    rollover: {
      changed: true,
      year: 2027,
      processed: [{ userId: "usr_1", leaveEntitlement: 15 }]
    },
    receiptRetention: {
      changed: true,
      cutoff: "2021-01-01T00:00:00.000Z",
      retentionYears: 5,
      deleted: 2,
      failed: 0,
      errors: []
    }
  });

  assert.equal(added, 2);
  assert.equal(db.auditEvents.length, 2);
  assert.equal(db.auditEvents[0].action, "maintenance.receipt_retention");
  assert.equal(db.auditEvents[1].action, "maintenance.leave_rollover");
  assert.equal(db.auditEvents[0].actorName, "System");
});

test("applyLeaveYearRollover grants annual birthday leave", () => {
  const db = {
    users: [
      {
        id: "usr_employee",
        name: "Employee",
        email: "employee@cls.local",
        role: "employee",
        leavePolicyYear: 2025,
        leaveEntitlement: 14,
        annualLeaveEntitlement: 14,
        startingLeaveEntitlement: 14,
        carriedForwardLeave: 0,
        birthdayLeaveEntitlement: 0
      }
    ],
    leaveRequests: [
      {
        id: "leave_1",
        employeeId: "usr_employee",
        leaveYear: 2025,
        status: "approved",
        days: 13,
        startDate: "2025-12-01"
      }
    ],
    leaveAdjustments: []
  };

  const rollover = __test.applyLeaveYearRollover(db, new Date("2026-01-01T00:00:00Z"));

  assert.equal(rollover.changed, true);
  assert.equal(db.users[0].leavePolicyYear, 2026);
  assert.equal(db.users[0].birthdayLeaveEntitlement, 1);
  assert.equal(db.users[0].carriedForwardLeave, 1);
  assert.equal(db.users[0].leaveEntitlement, 16);
  assert.equal(rollover.processed[0].birthdayLeave, 1);
});

test("cancelLeaveRequest lets applicants cancel pending future leave and notifies approvers", async () => {
  const manager = {
    id: "usr_manager",
    name: "Manager",
    email: "manager@cls.local",
    role: "manager"
  };
  const employee = {
    id: "usr_employee",
    name: "Employee",
    email: "employee@cls.local",
    role: "employee",
    managerId: "usr_manager"
  };
  const db = {
    users: [manager, employee],
    leaveRequests: [
      {
        id: "leave_1",
        employeeId: "usr_employee",
        managerId: "usr_manager",
        type: "Annual Leave",
        startDate: "2026-06-10",
        endDate: "2026-06-10",
        days: 1,
        leaveYear: 2026,
        excludedDates: [],
        reason: "Family",
        status: "pending",
        decisionNote: "",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
        decidedAt: null,
        decidedBy: null
      }
    ],
    emails: []
  };

  const { request, previousStatus } = await __test.cancelLeaveRequest(db, employee, "leave_1", {
    reason: "Plans changed"
  }, {
    asOfDate: "2026-06-09"
  });

  assert.equal(previousStatus, "pending");
  assert.equal(request.status, "cancelled");
  assert.equal(request.cancellationNote, "Plans changed");
  assert.equal(request.cancelledBy, "usr_employee");
  assert.equal(db.emails.length, 1);
  assert.equal(db.emails[0].recipientId, "usr_manager");
});

test("cancelLeaveRequest rejects approved leave and past leave", async () => {
  const employee = {
    id: "usr_employee",
    name: "Employee",
    email: "employee@cls.local",
    role: "employee",
    managerId: "usr_manager"
  };
  const db = {
    users: [employee],
    leaveRequests: [
      {
        id: "leave_approved",
        employeeId: "usr_employee",
        managerId: "usr_manager",
        type: "Annual Leave",
        startDate: "2026-06-12",
        endDate: "2026-06-12",
        days: 1,
        leaveYear: 2026,
        status: "approved"
      },
      {
        id: "leave_past",
        employeeId: "usr_employee",
        managerId: "usr_manager",
        type: "Annual Leave",
        startDate: "2026-06-10",
        endDate: "2026-06-10",
        days: 1,
        leaveYear: 2026,
        status: "pending"
      }
    ],
    emails: []
  };

  await assert.rejects(
    () => __test.cancelLeaveRequest(db, employee, "leave_approved", {}, { asOfDate: "2026-06-11" }),
    /Only pending leave requests can be cancelled/
  );
  await assert.rejects(
    () => __test.cancelLeaveRequest(db, employee, "leave_past", {}, { asOfDate: "2026-06-11" }),
    /after the leave period has passed/
  );
});

test("cancelLeaveRequest only allows the applicant to cancel", async () => {
  const manager = { id: "usr_manager", name: "Manager", email: "manager@cls.local", role: "manager" };
  const employee = { id: "usr_employee", name: "Employee", email: "employee@cls.local", role: "employee" };
  const db = {
    users: [manager, employee],
    leaveRequests: [
      {
        id: "leave_1",
        employeeId: "usr_employee",
        managerId: "usr_manager",
        type: "Annual Leave",
        startDate: "2026-06-10",
        endDate: "2026-06-10",
        days: 1,
        leaveYear: 2026,
        status: "pending"
      }
    ],
    emails: []
  };

  await assert.rejects(
    () => __test.cancelLeaveRequest(db, manager, "leave_1"),
    /Only the leave applicant can cancel/
  );
});

test("createLeaveAdjustment applies half-day leave credits and audits them", () => {
  const year = new Date().getFullYear();
  const admin = {
    id: "usr_admin",
    name: "Admin",
    email: "admin@cls.local",
    role: "admin"
  };
  const employee = {
    id: "usr_employee",
    name: "Employee",
    email: "employee@cls.local",
    role: "employee",
    leavePolicyYear: year,
    leaveEntitlement: 14,
    annualLeaveEntitlement: 14,
    carriedForwardLeave: 0
  };
  const db = {
    users: [admin, employee],
    leaveRequests: [],
    leaveAdjustments: [],
    auditEvents: []
  };

  const adjustment = __test.createLeaveAdjustment(db, admin, {
    employeeId: "usr_employee",
    direction: "add",
    days: "0.5",
    reason: "Manual half-day credit"
  });

  assert.equal(adjustment.days, 0.5);
  assert.equal(employee.leaveEntitlement, 14.5);
  assert.equal(db.leaveAdjustments.length, 1);
  assert.equal(db.auditEvents[0].action, "leave.adjustment_added");
});

test("createLeaveAdjustment rejects quarter-day adjustments", () => {
  const admin = { id: "usr_admin", name: "Admin", email: "admin@cls.local", role: "admin" };
  const employee = {
    id: "usr_employee",
    name: "Employee",
    email: "employee@cls.local",
    role: "employee",
    leaveEntitlement: 14,
    annualLeaveEntitlement: 14,
    carriedForwardLeave: 0
  };
  const db = {
    users: [admin, employee],
    leaveRequests: [],
    leaveAdjustments: [],
    auditEvents: []
  };

  assert.throws(
    () => __test.createLeaveAdjustment(db, admin, {
      employeeId: "usr_employee",
      direction: "add",
      days: "0.25",
      reason: "Invalid increment"
    }),
    /half-day increments/
  );
});

test("createLeaveAdjustment prevents deductions below available leave", () => {
  const year = new Date().getFullYear();
  const admin = { id: "usr_admin", name: "Admin", email: "admin@cls.local", role: "admin" };
  const employee = {
    id: "usr_employee",
    name: "Employee",
    email: "employee@cls.local",
    role: "employee",
    leavePolicyYear: year,
    leaveEntitlement: 1,
    annualLeaveEntitlement: 1,
    carriedForwardLeave: 0
  };
  const db = {
    users: [admin, employee],
    leaveRequests: [
      {
        id: "leave_1",
        employeeId: "usr_employee",
        managerId: "usr_admin",
        leaveYear: year,
        days: 1,
        status: "approved",
        startDate: `${year}-01-02`
      }
    ],
    leaveAdjustments: [],
    auditEvents: []
  };

  assert.throws(
    () => __test.createLeaveAdjustment(db, admin, {
      employeeId: "usr_employee",
      direction: "deduct",
      days: "0.5",
      reason: "Correction"
    }),
    /available leave below 0/
  );
});

test("updateEmployee lets admins edit leave components and recalculates total leave", () => {
  const year = new Date().getFullYear();
  const employee = {
    id: "usr_employee",
    name: "Employee",
    email: "employee@cls.local",
    role: "employee",
    leavePolicyYear: year,
    startingLeaveEntitlement: 14,
    annualLeaveEntitlement: 14,
    carriedForwardLeave: 1,
    birthdayLeaveEntitlement: 1,
    leaveEntitlement: 16,
    leaveServiceAccrualAt: "2026-01-01T00:00:00.000Z"
  };
  const db = {
    users: [employee],
    leaveRequests: [],
    leaveAdjustments: [
      {
        id: "adjust_1",
        employeeId: "usr_employee",
        actorId: "usr_admin",
        year,
        days: 0.5,
        reason: "Manual adjustment",
        createdAt: "2026-01-02T00:00:00.000Z"
      }
    ]
  };

  const updated = __test.updateEmployee(db, "usr_employee", {
    startingLeaveEntitlement: "15",
    carriedForwardLeave: "2.5",
    birthdayLeaveEntitlement: "1"
  });

  assert.equal(updated.annualLeaveEntitlement, 15);
  assert.equal(updated.carriedForwardLeave, 2.5);
  assert.equal(updated.birthdayLeaveEntitlement, 1);
  assert.equal(updated.leaveEntitlement, 19);
});

test("updateEmployee rejects quarter-day carry forward and birthday leave", () => {
  const employee = {
    id: "usr_employee",
    name: "Employee",
    email: "employee@cls.local",
    role: "employee",
    leaveEntitlement: 14,
    annualLeaveEntitlement: 14,
    carriedForwardLeave: 0,
    birthdayLeaveEntitlement: 0
  };
  const db = {
    users: [employee],
    leaveRequests: [],
    leaveAdjustments: []
  };

  assert.throws(
    () => __test.updateEmployee(db, "usr_employee", { carriedForwardLeave: "0.25" }),
    /half-day increments/
  );
  assert.throws(
    () => __test.updateEmployee(db, "usr_employee", { birthdayLeaveEntitlement: "0.25" }),
    /half-day increments/
  );
});

test("updateEmployee lets admins set current-year medical leave remaining", () => {
  const employee = {
    id: "usr_employee",
    name: "Employee",
    email: "employee@cls.local",
    role: "employee",
    leavePolicyYear: 2026,
    medicalLeaveEntitlement: 14
  };
  const db = {
    users: [employee],
    leaveRequests: [
      {
        id: "leave_medical_1",
        employeeId: "usr_employee",
        type: "Medical Leave",
        leaveYear: 2026,
        status: "approved",
        days: 4
      },
      {
        id: "leave_medical_pending",
        employeeId: "usr_employee",
        type: "Medical Leave",
        leaveYear: 2026,
        status: "pending",
        days: 2
      },
      {
        id: "leave_medical_old",
        employeeId: "usr_employee",
        type: "Medical Leave",
        leaveYear: 2025,
        status: "approved",
        days: 8
      }
    ],
    leaveAdjustments: []
  };

  const updated = __test.updateEmployee(db, "usr_employee", { medicalLeaveRemaining: "9.5" });
  const summary = medicalLeaveSummary(updated, db.leaveRequests);

  assert.equal(updated.medicalLeaveEntitlement, 14);
  assert.equal(updated.medicalLeaveBalanceAdjustment, -0.5);
  assert.equal(summary.entitlement, 14);
  assert.equal(summary.available, 9.5);
});

test("updateEmployee lets admins set medical leave entitlement independently", () => {
  const employee = {
    id: "usr_employee",
    name: "Employee",
    email: "employee@cls.local",
    role: "employee",
    medicalLeaveEntitlement: 14
  };
  const db = {
    users: [employee],
    leaveRequests: [],
    leaveAdjustments: []
  };

  const updated = __test.updateEmployee(db, "usr_employee", { medicalLeaveEntitlement: "16.5" });

  assert.equal(updated.medicalLeaveEntitlement, 16.5);
});

test("updateEmployee lets admins set current-year medical claim balance", () => {
  const employee = {
    id: "usr_employee",
    name: "Employee",
    email: "employee@cls.local",
    role: "employee",
    medicalClaimLimit: 500
  };
  const db = {
    users: [employee],
    medicalClaims: [
      {
        id: "claim_medical_1",
        employeeId: "usr_employee",
        claimType: "medical",
        claimDate: "2026-02-10",
        status: "approved",
        amount: 125.25
      },
      {
        id: "claim_pending",
        employeeId: "usr_employee",
        claimType: "medical",
        claimDate: "2026-03-15",
        status: "pending",
        amount: 80
      },
      {
        id: "claim_old",
        employeeId: "usr_employee",
        claimType: "medical",
        claimDate: "2025-12-20",
        status: "approved",
        amount: 300
      }
    ],
    leaveRequests: [],
    leaveAdjustments: []
  };

  const updated = __test.updateEmployee(db, "usr_employee", { medicalClaimBalance: "350.50" });
  const summary = medicalClaimSummary(updated, db.medicalClaims, { year: 2026 });

  assert.equal(updated.medicalClaimLimit, 500);
  assert.equal(updated.medicalClaimBalanceAdjustment, -24.25);
  assert.equal(summary.limit, 500);
  assert.equal(summary.available, 350.5);
});

test("updateEmployee toggles unlimited annual leave", () => {
  const employee = {
    id: "usr_employee",
    name: "Employee",
    email: "employee@cls.local",
    role: "employee",
    unlimitedAnnualLeave: false
  };
  const db = {
    users: [employee],
    leaveRequests: [],
    leaveAdjustments: []
  };

  assert.equal(__test.updateEmployee(db, "usr_employee", { unlimitedAnnualLeave: true }).unlimitedAnnualLeave, true);
  assert.equal(__test.updateEmployee(db, "usr_employee", { unlimitedAnnualLeave: false }).unlimitedAnnualLeave, false);
});

test("createLeaveRequest lets unlimited annual leave exceed annual balance", async () => {
  const manager = {
    id: "usr_manager",
    name: "Manager",
    email: "manager@cls.local",
    role: "manager"
  };
  const employee = {
    id: "usr_employee",
    name: "Employee",
    email: "employee@cls.local",
    role: "employee",
    managerId: "usr_manager",
    leavePolicyYear: 2026,
    leaveEntitlement: 0,
    annualLeaveEntitlement: 0,
    carriedForwardLeave: 0,
    birthdayLeaveEntitlement: 0,
    unlimitedAnnualLeave: true
  };
  const db = {
    users: [manager, employee],
    leaveRequests: [],
    emails: []
  };

  const request = await __test.createLeaveRequest(db, employee, {
    type: "Annual Leave",
    startDate: "2026-07-21",
    endDate: "2026-07-22",
    reason: "Owner leave"
  });

  assert.equal(request.days, 2);
  assert.equal(request.status, "pending");
  assert.equal(db.leaveRequests.length, 1);
  assert.equal(db.emails[0].recipientId, "usr_manager");
});

test("createLeaveRequest keeps medical leave capped for unlimited annual leave users", async () => {
  const employee = {
    id: "usr_employee",
    name: "Employee",
    email: "employee@cls.local",
    role: "employee",
    managerId: "usr_manager",
    leavePolicyYear: 2026,
    medicalLeaveEntitlement: 1,
    unlimitedAnnualLeave: true
  };
  const db = {
    users: [employee],
    leaveRequests: [
      {
        id: "leave_medical_1",
        employeeId: "usr_employee",
        managerId: "usr_manager",
        type: "Medical Leave",
        startDate: "2026-06-02",
        endDate: "2026-06-02",
        days: 1,
        leaveYear: 2026,
        status: "approved"
      }
    ],
    emails: []
  };

  await assert.rejects(
    () => __test.createLeaveRequest(db, employee, {
      type: "Medical Leave",
      startDate: "2026-06-03",
      endDate: "2026-06-03"
    }),
    /only 0 days are available/
  );
});

test("createLeaveRequest does not deduct special leave from annual balance", async () => {
  const employee = {
    id: "usr_employee",
    name: "Employee",
    email: "employee@cls.local",
    role: "employee",
    managerId: "usr_manager",
    leavePolicyYear: 2026,
    leaveEntitlement: 0,
    annualLeaveEntitlement: 0,
    medicalLeaveEntitlement: 0
  };
  const db = {
    users: [employee],
    leaveRequests: [],
    emails: []
  };
  const specialTypes = [
    "Compassionate Leave",
    "Paternity Leave",
    "Maternity Leave",
    "Childcare Leave",
    "National Service Leave"
  ];

  for (const type of specialTypes) {
    const request = await __test.createLeaveRequest(db, employee, {
      type,
      startDate: "2026-07-21",
      endDate: "2026-07-21",
      reason: "Eligibility documents available"
    });
    assert.equal(request.type, type);
    assert.equal(request.days, 1);
    assert.equal(request.status, "pending");
  }
});

test("dashboard exposes shadow summaries while disabled policy does not require a grant", async () => {
  const manager = {
    id: "usr_manager",
    name: "Manager",
    email: "manager@cls.local",
    role: "manager",
    serviceStartDate: "2025-01-01"
  };
  const employee = {
    id: "usr_employee",
    name: "Employee",
    email: "employee@cls.local",
    role: "employee",
    managerId: manager.id,
    serviceStartDate: "2025-01-01",
    leavePolicyYear: 2026,
    leaveEntitlement: 0,
    annualLeaveEntitlement: 0,
    medicalLeaveEntitlement: 14,
    workSchedule: [1, 2, 3, 4, 5]
  };
  const db = __test.normalizeDb({
    users: [manager, employee],
    leaveRequests: [],
    leavePolicySettings: [{
      leaveType: "Compassionate Leave",
      enforcementEnabled: false,
      updatedAt: "2026-07-20T00:00:00.000Z",
      updatedBy: null
    }],
    emails: []
  });

  const payload = __test.dashboard(db, employee);
  assert.equal(payload.leavePolicySettings.find(
    (setting) => setting.leaveType === "Compassionate Leave"
  ).enforcementEnabled, false);
  assert.equal(payload.leaveEntitlementSummaries[0].employeeId, employee.id);
  assert.ok(payload.leaveEntitlementSummaries[0].medicalHospitalization);

  const request = await __test.createLeaveRequest(db, employee, {
    type: "Compassionate Leave",
    startDate: "2026-07-21",
    endDate: "2026-07-21",
    reason: "Bereavement"
  });
  assert.equal(request.status, "pending");
  assert.equal(request.entitlementId, undefined);
});

test("createLeaveRequest requires medical documents for hospitalization leave", async (t) => {
  const employee = {
    id: "usr_employee",
    name: "Employee",
    email: "employee@cls.local",
    role: "employee",
    managerId: "usr_manager",
    leavePolicyYear: 2026,
    leaveEntitlement: 0,
    annualLeaveEntitlement: 0,
    medicalLeaveEntitlement: 0
  };
  const db = {
    users: [employee],
    leaveRequests: [],
    emails: []
  };
  const body = {
    type: "Hospitalization Leave",
    startDate: "2026-07-21",
    endDate: "2026-07-21"
  };

  await assert.rejects(
    () => __test.createLeaveRequest(db, employee, body),
    /required for Hospitalization Leave/
  );

  const request = await __test.createLeaveRequest(db, employee, {
    ...body,
    medicalCertificate: {
      name: "hospitalization-letter.pdf",
      type: "application/pdf",
      buffer: Buffer.from("%PDF-1.4\nhospitalization-letter\n", "utf8")
    }
  });
  t.after(() => fs.rm(path.join(__dirname, "..", "data", "uploads", request.medicalCertificate.storedName), { force: true }));

  assert.equal(request.type, "Hospitalization Leave");
  assert.equal(request.days, 1);
  assert.equal(request.medicalCertificate.originalName, "hospitalization-letter.pdf");
});

test("createClaim routes claims to the separate claims approver", async () => {
  const employee = {
    id: "usr_employee",
    name: "Employee",
    email: "employee@cls.local",
    role: "employee",
    managerId: "usr_leave_manager",
    claimApproverId: "usr_claim_manager",
    medicalClaimLimit: 500
  };
  const db = {
    users: [
      employee,
      {
        id: "usr_leave_manager",
        name: "Leave Manager",
        email: "leave.manager@cls.local",
        role: "manager"
      },
      {
        id: "usr_claim_manager",
        name: "Claims Manager",
        email: "claims.manager@cls.local",
        role: "manager"
      }
    ],
    medicalClaims: [],
    emails: []
  };

  const claim = await __test.createClaim(db, employee, {
    category: "Others",
    claimDate: "2026-06-04",
    provider: "Office supplier",
    amount: "45.20",
    description: "Stationery",
    receipt: {
      name: "claim.pdf",
      buffer: Buffer.from("%PDF-1.4\nclaim receipt\n", "utf8")
    }
  });

  assert.equal(claim.managerId, "usr_claim_manager");
  assert.equal(db.emails[0].recipientId, "usr_claim_manager");
  assert.equal(db.emails[0].to, "claims.manager@cls.local");

  await fs.rm(path.join(__dirname, "..", "data", "uploads", claim.receipt.storedName), {
    force: true
  });
});

test("createClaim validates medical claim balance against the claim date year", async () => {
  const employee = {
    id: "usr_employee",
    name: "Employee",
    email: "employee@cls.local",
    role: "employee",
    managerId: "usr_manager",
    medicalClaimLimit: 500
  };
  const db = {
    users: [
      employee,
      {
        id: "usr_manager",
        name: "Manager",
        email: "manager@cls.local",
        role: "manager"
      }
    ],
    medicalClaims: [
      {
        id: "claim_existing",
        employeeId: "usr_employee",
        managerId: "usr_manager",
        claimType: "medical",
        claimDate: "2027-01-15",
        amount: 450,
        status: "pending"
      }
    ],
    emails: []
  };

  let createdClaim;
  let caughtError;
  try {
    createdClaim = await __test.createClaim(db, employee, {
      category: "Medical",
      claimDate: "2027-02-04",
      provider: "Clinic",
      amount: "100",
      description: "Consultation",
      receipt: {
        name: "claim.pdf",
        buffer: Buffer.from("%PDF-1.4\nclaim receipt\n", "utf8")
      }
    });
  } catch (error) {
    caughtError = error;
  } finally {
    if (createdClaim?.receipt?.storedName) {
      await fs.rm(path.join(__dirname, "..", "data", "uploads", createdClaim.receipt.storedName), {
        force: true
      });
    }
  }

  assert.ok(caughtError);
  assert.match(caughtError.message, /only \$50\.00 is available/);
});

test("medicalClaimsExport exports medical claims by year and employee", () => {
  const db = {
    users: [
      {
        id: "usr_admin",
        name: "Admin",
        email: "admin@cls.local",
        role: "admin"
      },
      {
        id: "usr_employee",
        name: "Employee One",
        email: "employee.one@cls.local",
        role: "employee"
      },
      {
        id: "usr_other",
        name: "Employee Two",
        email: "employee.two@cls.local",
        role: "employee"
      },
      {
        id: "usr_manager",
        name: "Claims Manager",
        email: "manager@cls.local",
        role: "manager"
      }
    ],
    medicalClaims: [
      {
        id: "claim_medical_1",
        employeeId: "usr_employee",
        managerId: "usr_manager",
        claimType: "medical",
        claimDate: "2026-06-04",
        provider: "Raffles Medical",
        description: "Consultation",
        amount: 58.5,
        status: "approved",
        createdAt: "2026-06-04T00:00:00.000Z",
        decidedAt: "2026-06-05T00:00:00.000Z",
        decidedBy: "usr_manager",
        decisionNote: "OK",
        receipt: { originalName: "receipt.pdf" }
      },
      {
        id: "claim_general_1",
        employeeId: "usr_employee",
        managerId: "usr_manager",
        claimType: "general",
        claimDate: "2026-06-04",
        provider: "Office supplier",
        description: "Stationery",
        amount: 20,
        status: "approved"
      },
      {
        id: "claim_medical_other_year",
        employeeId: "usr_employee",
        managerId: "usr_manager",
        claimType: "medical",
        claimDate: "2025-06-04",
        provider: "Old Clinic",
        description: "Old consultation",
        amount: 40,
        status: "approved"
      },
      {
        id: "claim_medical_other_employee",
        employeeId: "usr_other",
        managerId: "usr_manager",
        claimType: "medical",
        claimDate: "2026-06-04",
        provider: "Other Clinic",
        description: "Other consultation",
        amount: 30,
        status: "pending"
      }
    ]
  };

  const exportFile = __test.medicalClaimsExport(
    db,
    db.users[0],
    new URLSearchParams({ year: "2026", employeeId: "usr_employee" })
  );

  assert.equal(exportFile.filename, "medical-claims-employee-one-2026.csv");
  assert.match(exportFile.body, /Claimant Name,Claimant Email,Claim Date/);
  assert.match(exportFile.body, /claim_medical_1/);
  assert.match(exportFile.body, /Employee One/);
  assert.match(exportFile.body, /58.50/);
  assert.doesNotMatch(exportFile.body, /claim_general_1/);
  assert.doesNotMatch(exportFile.body, /claim_medical_other_year/);
  assert.doesNotMatch(exportFile.body, /claim_medical_other_employee/);
});

test("medicalClaimsExport exports all medical claims for the selected year", () => {
  const admin = { id: "usr_admin", name: "Admin", email: "admin@cls.local", role: "admin" };
  const db = {
    users: [
      admin,
      { id: "usr_one", name: "Employee One", email: "one@cls.local", role: "employee" },
      { id: "usr_two", name: "Employee Two", email: "two@cls.local", role: "employee" }
    ],
    medicalClaims: [
      {
        id: "claim_one",
        employeeId: "usr_one",
        managerId: "usr_admin",
        claimType: "medical",
        claimDate: "2026-01-02",
        provider: "Clinic One",
        amount: 10,
        status: "approved"
      },
      {
        id: "claim_two",
        employeeId: "usr_two",
        managerId: "usr_admin",
        claimType: "medical",
        claimDate: "2026-02-02",
        provider: "Clinic Two",
        amount: 20,
        status: "pending"
      }
    ]
  };

  const exportFile = __test.medicalClaimsExport(db, admin, new URLSearchParams({ year: "2026" }));

  assert.equal(exportFile.filename, "medical-claims-all-employees-2026.csv");
  assert.match(exportFile.body, /claim_one/);
  assert.match(exportFile.body, /claim_two/);
});

test("Supabase table mappings round-trip core app records", () => {
  const byField = Object.fromEntries(__test.supabaseTableConfigs.map((config) => [config.field, config]));
  const records = {
    users: {
      id: "usr_employee",
      name: "Employee",
      email: "employee@cls.local",
      role: "employee",
      managerId: "usr_manager",
      claimApproverId: "usr_claim_manager",
      serviceStartDate: "2026-01-01",
      startingLeaveEntitlement: 14,
      annualLeaveEntitlement: 14,
      carriedForwardLeave: 1,
      birthdayLeaveEntitlement: 1,
      unlimitedAnnualLeave: true,
      leavePolicyYear: 2026,
      leaveEntitlement: 16,
      leaveRolloverAt: "2026-01-01T00:00:00.000Z",
      leaveServiceAccrualAt: "2026-01-01T00:00:00.000Z",
      medicalClaimLimit: 500,
      medicalClaimBalanceAdjustment: -25,
      medicalClaimBalanceAdjustmentYear: 2026,
      medicalLeaveEntitlement: 14,
      medicalLeaveBalanceAdjustment: -0.5,
      medicalLeaveBalanceAdjustmentYear: 2026,
      workSchedule: [1, 2, 3, 4, 5],
      medicalLeaveEntitlementOverride: 18,
      active: true,
      passwordSalt: "salt",
      passwordHash: "hash",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z"
    },
    leaveRequests: {
      id: "leave_1",
      employeeId: "usr_employee",
      managerId: "usr_manager",
      type: "Medical Leave",
      startDate: "2026-06-04",
      endDate: "2026-06-04",
      days: 1,
      leaveYear: 2026,
      excludedDates: [{ date: "2026-06-05", reason: "Public Holiday" }],
      reason: "Sick",
      medicalCertificate: { originalName: "mc.pdf", storedName: "medical-certificates/mc.pdf" },
      entitlementId: "ent_medical_2026",
      countingMethod: "scheduled_working_days",
      workScheduleSnapshot: [1, 2, 3, 4, 5],
      supportingDocument: { originalName: "mc.pdf", storedName: "medical-certificates/mc.pdf" },
      status: "pending",
      decisionNote: "",
      createdAt: "2026-06-04T00:00:00.000Z",
      updatedAt: "2026-06-04T00:00:00.000Z",
      decidedAt: null,
      decidedBy: null,
      cancellationNote: "",
      cancelledAt: null,
      cancelledBy: null
    },
    leaveAdjustments: {
      id: "adjust_1",
      employeeId: "usr_employee",
      actorId: "usr_admin",
      year: 2026,
      days: 0.5,
      reason: "Correction",
      createdAt: "2026-06-04T00:00:00.000Z"
    },
    leaveEntitlements: {
      id: "ent_medical_2026",
      employeeId: "usr_employee",
      leaveType: "Medical Leave",
      periodKind: "annual",
      periodYear: 2026,
      eventDate: null,
      validFrom: "2026-01-01",
      validUntil: "2026-12-31",
      baseDays: 14,
      overrideDays: 18,
      eligibilityVerified: true,
      eligibilityVerifiedBy: "usr_admin",
      eligibilityVerifiedAt: "2026-01-02T00:00:00.000Z",
      workScheduleSnapshot: [1, 2, 3, 4, 5],
      childBirthDate: null,
      active: true,
      createdBy: "usr_admin",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z"
    },
    leaveEntitlementAdjustments: {
      id: "ent_adjust_1",
      entitlementId: "ent_medical_2026",
      actorId: "usr_admin",
      days: -1,
      reason: "Correction",
      createdAt: "2026-06-04T00:00:00.000Z"
    },
    leavePolicySettings: {
      leaveType: "Medical Leave",
      enforcementEnabled: false,
      updatedAt: "2026-06-04T00:00:00.000Z",
      updatedBy: "usr_admin"
    },
    medicalClaims: {
      id: "claim_1",
      employeeId: "usr_employee",
      managerId: "usr_claim_manager",
      claimType: "general",
      claimDate: "2026-06-04",
      category: "Others",
      provider: "Vendor",
      amount: 42.25,
      receiptRef: "",
      receipt: { originalName: "receipt.pdf", storedName: "claims/receipt.pdf" },
      clientSubmissionId: "submission-1",
      description: "Team supplies",
      status: "approved",
      decisionNote: "OK",
      createdAt: "2026-06-04T00:00:00.000Z",
      updatedAt: "2026-06-04T00:00:00.000Z",
      decidedAt: "2026-06-05T00:00:00.000Z",
      decidedBy: "usr_claim_manager"
    },
    emails: {
      id: "email_1",
      recipientId: "usr_employee",
      to: "employee@cls.local",
      subject: "Subject",
      body: "Body",
      type: "claim_decided",
      relatedId: "claim_1",
      createdAt: "2026-06-04T00:00:00.000Z",
      delivered: true,
      deliveredAt: "2026-06-04T00:01:00.000Z",
      deliveryError: null,
      providerId: "resend_1"
    },
    auditEvents: {
      id: "audit_1",
      createdAt: "2026-06-04T00:00:00.000Z",
      actorId: "usr_admin",
      actorName: "Admin",
      actorEmail: "admin@cls.local",
      actorRole: "admin",
      action: "claim.approved",
      summary: "Approved claim.",
      affectedUserId: "usr_employee",
      affectedUserName: "Employee",
      relatedType: "claim",
      relatedId: "claim_1",
      metadata: { amount: 42.25 }
    },
    sessions: {
      token: "token",
      userId: "usr_employee",
      expiresAt: 1770000000000,
      createdAt: "2026-06-04T00:00:00.000Z"
    }
  };

  for (const [field, record] of Object.entries(records)) {
    const config = byField[field];
    assert.ok(config, `Missing mapping for ${field}`);
    assert.deepEqual(config.fromRow(config.toRow(record)), record);
  }
});
