const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { __test } = require("../server");

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

test("cancelLeaveRequest lets applicants cancel approved leave and notifies calendars", async () => {
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
        status: "approved",
        decisionNote: "",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
        decidedAt: "2026-06-02T00:00:00.000Z",
        decidedBy: "usr_manager"
      }
    ],
    emails: []
  };

  const { request, previousStatus } = await __test.cancelLeaveRequest(db, employee, "leave_1", {
    reason: "Plans changed"
  });

  assert.equal(previousStatus, "approved");
  assert.equal(request.status, "cancelled");
  assert.equal(request.cancellationNote, "Plans changed");
  assert.equal(request.cancelledBy, "usr_employee");
  assert.equal(db.emails.length, 2);
  assert.equal(db.emails[0].recipientId, "usr_employee");
  assert.equal(db.emails[1].recipientId, "usr_manager");
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
