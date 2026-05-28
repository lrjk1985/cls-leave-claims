const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const { URL } = require("node:url");

const {
  assertDecision,
  assertIsoDate,
  canAdmin,
  canReview,
  canSeeEmployee,
  currentLeaveYear,
  decisionLabel,
  formatIsoDate,
  generalClaimSummary,
  leaveDayBreakdown,
  leaveSummary,
  medicalClaimSummary,
  nextLeaveYearBalance,
  normalizeLeaveDays,
  normalizeMoney,
  workingDaysBetween
} = require("./src/domain");
const {
  getSingaporePublicHolidaysForRange,
  syncSingaporePublicHolidays
} = require("./src/publicHolidays");

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const DB_PATH = path.join(DATA_DIR, "local-db.json");
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
const PUBLIC_DIR = path.join(ROOT, "public");
const SESSION_TTL_MS = 1000 * 60 * 60 * 8;
const MAX_JSON_BYTES = 10_000_000;
const MAX_RECEIPT_BYTES = 5_000_000;
const RECEIPT_RETENTION_YEARS = 5;
const RECEIPT_TYPE_ERROR = "Receipt must be a PDF, JPG, PNG, WebP, HEIC, or HEIF file.";
const RECEIPT_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif"
]);
const RECEIPT_EXTENSION_MIME_TYPES = new Map([
  [".pdf", "application/pdf"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
  [".heic", "image/heic"],
  [".heif", "image/heif"]
]);
const RECEIPT_MIME_EXTENSIONS = new Map([
  ["application/pdf", ".pdf"],
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
  ["image/heic", ".heic"],
  ["image/heif", ".heif"]
]);
const SUPABASE_STATE_KEY = "default";
const SUPABASE_RECEIPT_BUCKET = process.env.SUPABASE_RECEIPT_BUCKET || "claim-receipts";
const sessions = new Map();

function nowIso() {
  return new Date().toISOString();
}

function id(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function createPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto
    .pbkdf2Sync(String(password), salt, 120000, 32, "sha256")
    .toString("hex");
  return { passwordSalt: salt, passwordHash: hash };
}

function verifyPassword(password, user) {
  if (!user.passwordSalt || !user.passwordHash) return false;
  const hash = crypto
    .pbkdf2Sync(String(password), user.passwordSalt, 120000, 32, "sha256")
    .toString("hex");
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(user.passwordHash, "hex"));
}

function changePassword(user, body) {
  const currentPassword = String(body.currentPassword || "");
  const newPassword = String(body.newPassword || "");
  const confirmPassword = String(body.confirmPassword || "");

  if (!currentPassword) throw new Error("Please enter your current password.");
  if (!verifyPassword(currentPassword, user)) throw new Error("Current password is incorrect.");
  if (newPassword.length < 8) throw new Error("New password must be at least 8 characters.");
  if (newPassword !== confirmPassword) throw new Error("New passwords do not match.");
  if (verifyPassword(newPassword, user)) throw new Error("New password must be different from your current password.");

  Object.assign(user, createPassword(newPassword));
  user.updatedAt = nowIso();
  return user;
}

function keepOnlyCurrentSession(db, userId, currentToken) {
  for (const [token, session] of sessions.entries()) {
    if (session.userId === userId && token !== currentToken) sessions.delete(token);
  }
  db.sessions = db.sessions.filter(
    (session) => session.userId !== userId || session.token === currentToken
  );
}

function publicUser(user) {
  if (!user) return null;
  const {
    passwordHash,
    passwordSalt,
    ...safeUser
  } = user;
  return safeUser;
}

function jsonResponse(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function textResponse(res, status, body, contentType = "text/plain; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": contentType,
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function parseCookies(req) {
  const header = req.headers.cookie || "";
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        return [decodeURIComponent(part.slice(0, index)), decodeURIComponent(part.slice(index + 1))];
      })
  );
}

function setSessionCookie(res, token) {
  res.setHeader(
    "Set-Cookie",
    `cls_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_MS / 1000}`
  );
}

function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", "cls_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
}

async function readJson(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_JSON_BYTES) {
      throw new Error("Request is too large.");
    }
    chunks.push(chunk);
  }

  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function supabaseConfig() {
  const url = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) return null;
  return { url, serviceRoleKey };
}

function isSupabaseEnabled() {
  return Boolean(supabaseConfig());
}

async function supabaseRequest(pathname, options = {}) {
  const config = supabaseConfig();
  if (!config) throw new Error("Supabase is not configured.");

  const headers = {
    apikey: config.serviceRoleKey,
    Authorization: `Bearer ${config.serviceRoleKey}`,
    ...(options.headers || {})
  };

  const response = await fetch(`${config.url}${pathname}`, {
    ...options,
    headers
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Supabase returned HTTP ${response.status}: ${text || response.statusText}`);
  }

  return response;
}

async function loadSupabaseDb() {
  const response = await supabaseRequest(
    `/rest/v1/cls_app_state?key=eq.${encodeURIComponent(SUPABASE_STATE_KEY)}&select=data`,
    { headers: { Accept: "application/json" } }
  );
  const rows = await response.json();
  if (Array.isArray(rows) && rows[0]?.data) {
    const db = normalizeDb(rows[0].data);
    const rollover = applyLeaveYearRollover(db);
    const anniversaryAccrual = applyServiceAnniversaryAccrual(db);
    const sessionsPruned = pruneExpiredSessions(db);
    if (rollover.changed || anniversaryAccrual.changed || sessionsPruned) await saveSupabaseDb(db);
    return db;
  }

  const db = seedDb();
  applyLeaveYearRollover(db);
  applyServiceAnniversaryAccrual(db);
  await saveSupabaseDb(db);
  return db;
}

async function saveSupabaseDb(db) {
  await supabaseRequest(
    `/rest/v1/cls_app_state?on_conflict=key`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates"
      },
      body: JSON.stringify({
        key: SUPABASE_STATE_KEY,
        data: db
      })
    }
  );
}

async function loadDb() {
  if (isSupabaseEnabled()) return loadSupabaseDb();

  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    const raw = await fs.readFile(DB_PATH, "utf8");
    const db = normalizeDb(JSON.parse(raw));
    const rollover = applyLeaveYearRollover(db);
    const anniversaryAccrual = applyServiceAnniversaryAccrual(db);
    const sessionsPruned = pruneExpiredSessions(db);
    if (rollover.changed || anniversaryAccrual.changed || sessionsPruned) await saveDb(db);
    return db;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const db = seedDb();
    applyLeaveYearRollover(db);
    applyServiceAnniversaryAccrual(db);
    await saveDb(db);
    return db;
  }
}

async function saveDb(db) {
  if (isSupabaseEnabled()) {
    await saveSupabaseDb(db);
    return;
  }

  await fs.mkdir(DATA_DIR, { recursive: true });
  const tmpPath = `${DB_PATH}.tmp`;
  await fs.writeFile(tmpPath, `${JSON.stringify(db, null, 2)}\n`, "utf8");
  await fs.rename(tmpPath, DB_PATH);
}

function normalizeDb(db) {
  return {
    users: Array.isArray(db.users) ? db.users.map(normalizeUser) : [],
    leaveRequests: Array.isArray(db.leaveRequests)
      ? db.leaveRequests.map((request) => ({
          ...request,
          excludedDates: Array.isArray(request.excludedDates) ? request.excludedDates : []
        }))
      : [],
    medicalClaims: Array.isArray(db.medicalClaims) ? db.medicalClaims.map(normalizeClaim) : [],
    emails: Array.isArray(db.emails) ? db.emails : [],
    sessions: Array.isArray(db.sessions) ? db.sessions : []
  };
}

function normalizeUser(user) {
  const thisYear = currentLeaveYear();
  const serviceStartDate = user.serviceStartDate || String(user.createdAt || new Date().toISOString()).slice(0, 10);
  const startingLeaveEntitlement = normalizeLeaveDays(
    user.startingLeaveEntitlement ?? user.annualLeaveEntitlement ?? user.leaveEntitlement ?? 0,
    "Initial annual leave days"
  );
  const normalized = {
    medicalClaimLimit: 500,
    ...user,
    serviceStartDate,
    startingLeaveEntitlement,
    annualLeaveEntitlement: normalizeLeaveDays(
      user.annualLeaveEntitlement ?? user.leaveEntitlement ?? startingLeaveEntitlement,
      "Annual leave entitlement"
    ),
    carriedForwardLeave: normalizeLeaveDays(user.carriedForwardLeave ?? 0, "Carried forward leave"),
    leavePolicyYear: Number(user.leavePolicyYear || thisYear),
    leaveEntitlement: Number(user.leaveEntitlement || 0),
    medicalClaimLimit: Number(user.medicalClaimLimit ?? 500)
  };
  if (user.annualLeaveEntitlement === undefined || user.annualLeaveEntitlement === null) {
    normalized.annualLeaveEntitlement = startingLeaveEntitlement;
  }
  if (!user.leaveEntitlement && user.leaveEntitlement !== 0) {
    normalized.leaveEntitlement = normalized.annualLeaveEntitlement + normalized.carriedForwardLeave;
  }
  return normalized;
}

function normalizeClaim(claim) {
  return {
    ...claim,
    claimType: claim.claimType === "general" ? "general" : "medical",
    amount: Number(claim.amount || 0),
    receipt: claim.receipt || null
  };
}

function claimCategoryAndType(body) {
  const rawCategory = String(body.category || "").trim();
  const fallbackCategory = body.claimType === "general" ? "Others" : "Medical";
  const category = rawCategory || fallbackCategory;
  const normalized = category.toLowerCase();

  if (normalized === "medical") return { category: "Medical", claimType: "medical" };
  if (["others", "other", "general", "general claim"].includes(normalized)) {
    return { category: "Others", claimType: "general" };
  }

  throw new Error("Category must be Medical or Others.");
}

function applyLeaveYearRollover(db, asOfDate = new Date()) {
  const targetYear = currentLeaveYear(asOfDate);
  const processed = [];

  for (const user of db.users) {
    user.leavePolicyYear = Number(user.leavePolicyYear || targetYear);

    while (user.leavePolicyYear < targetYear) {
      const balance = nextLeaveYearBalance(user, db.leaveRequests, user.leavePolicyYear + 1);
      user.annualLeaveEntitlement = balance.baseEntitlement;
      user.carriedForwardLeave = balance.carriedForward;
      user.leaveEntitlement = balance.entitlement;
      user.leavePolicyYear = balance.year;
      user.leaveRolloverAt = nowIso();
      processed.push({
        userId: user.id,
        year: balance.year,
        previousYear: balance.previousYear,
        carriedForward: balance.carriedForward,
        annualLeaveEntitlement: balance.baseEntitlement,
        leaveEntitlement: balance.entitlement
      });
    }
  }

  return {
    changed: processed.length > 0,
    processed,
    year: targetYear
  };
}

function serviceAnniversariesAfter(serviceStartDate, sinceDate, asOfDate) {
  const start = assertIsoDate(serviceStartDate, "Service start date");
  const since = assertIsoDate(sinceDate, "Last service accrual date");
  const asOf = assertIsoDate(asOfDate, "Accrual date");
  if (start > asOf || since >= asOf) return { count: 0, latestAnniversary: null };

  let count = 0;
  let latestAnniversary = null;
  for (let year = since.getUTCFullYear(); year <= asOf.getUTCFullYear(); year += 1) {
    const anniversary = new Date(Date.UTC(
      year,
      start.getUTCMonth(),
      start.getUTCDate(),
      12,
      0,
      0
    ));
    if (anniversary <= start || anniversary <= since || anniversary > asOf) continue;
    count += 1;
    latestAnniversary = formatIsoDate(anniversary);
  }

  return { count, latestAnniversary };
}

function applyServiceAnniversaryAccrual(db, asOfDate = new Date()) {
  const accrualDate = formatIsoDate(asOfDate);
  const processed = [];

  for (const user of db.users) {
    const baselineDate = String(user.leaveServiceAccrualAt || user.createdAt || accrualDate).slice(0, 10);
    const accrual = serviceAnniversariesAfter(user.serviceStartDate || baselineDate, baselineDate, accrualDate);
    if (!accrual.count) continue;

    const currentAnnualLeave = normalizeLeaveDays(
      user.annualLeaveEntitlement ?? user.startingLeaveEntitlement ?? user.leaveEntitlement ?? 0,
      "Annual leave entitlement"
    );
    const annualLeaveEntitlement = currentAnnualLeave >= 18
      ? currentAnnualLeave
      : Math.min(18, currentAnnualLeave + accrual.count);
    if (annualLeaveEntitlement === currentAnnualLeave) {
      user.leaveServiceAccrualAt = accrual.latestAnniversary || nowIso();
      processed.push({
        userId: user.id,
        asOfDate: accrualDate,
        anniversariesApplied: accrual.count,
        annualLeaveEntitlement,
        leaveEntitlement: user.leaveEntitlement,
        cappedOrManuallyHigher: true
      });
      continue;
    }
    user.annualLeaveEntitlement = annualLeaveEntitlement;
    user.leaveEntitlement = normalizeLeaveDays(
      annualLeaveEntitlement + Number(user.carriedForwardLeave || 0),
      "Leave entitlement"
    );
    user.leaveServiceAccrualAt = accrual.latestAnniversary || nowIso();
    processed.push({
      userId: user.id,
      asOfDate: accrualDate,
      anniversariesApplied: accrual.count,
      annualLeaveEntitlement,
      leaveEntitlement: user.leaveEntitlement
    });
  }

  return {
    changed: processed.length > 0,
    processed,
    asOfDate: accrualDate
  };
}

function seedProductionDb() {
  const createdAt = nowIso();
  const adminPassword = process.env.INITIAL_ADMIN_PASSWORD || "password";
  const admin = {
    id: "usr_admin",
    name: process.env.INITIAL_ADMIN_NAME || "CLS Admin",
    email: String(process.env.INITIAL_ADMIN_EMAIL || "admin@cls.local").trim().toLowerCase(),
    role: "admin",
    managerId: null,
    leaveEntitlement: 0,
    startingLeaveEntitlement: 0,
    annualLeaveEntitlement: 0,
    carriedForwardLeave: 0,
    leavePolicyYear: currentLeaveYear(),
    serviceStartDate: formatIsoDate(new Date()),
    medicalClaimLimit: 0,
    active: true,
    createdAt,
    updatedAt: createdAt,
    ...createPassword(adminPassword)
  };

  return {
    users: [admin],
    leaveRequests: [],
    medicalClaims: [],
    sessions: [],
    emails: [
      makeEmail([admin], {
        recipientId: admin.id,
        type: "system_ready",
        subject: "CLS Leave & Claims is ready",
        body: "Your production CLS Leave & Claims system has been initialized.",
        relatedId: admin.id,
        createdAt
      })
    ]
  };
}

function seedDb() {
  if (process.env.VERCEL && process.env.SEED_DEMO_DATA !== "true") {
    return seedProductionDb();
  }

  const createdAt = nowIso();
  const adminId = "usr_admin";
  const managerId = "usr_manager";
  const employeeId = "usr_employee";
  const teammateId = "usr_teammate";
  const nextWeek = new Date();
  nextWeek.setDate(nextWeek.getDate() + 8);
  const later = new Date();
  later.setDate(later.getDate() + 10);
  const leaveStart = formatIsoDate(nextWeek);
  const leaveEnd = formatIsoDate(later);

  const users = [
    {
      id: adminId,
      name: "CLS Admin",
      email: "admin@cls.local",
      role: "admin",
      managerId: null,
      leaveEntitlement: 0,
      startingLeaveEntitlement: 0,
      annualLeaveEntitlement: 0,
      carriedForwardLeave: 0,
      leavePolicyYear: currentLeaveYear(),
      serviceStartDate: "2026-01-01",
      medicalClaimLimit: 0,
      active: true,
      createdAt,
      updatedAt: createdAt,
      ...createPassword("password")
    },
    {
      id: managerId,
      name: "Melissa Wong",
      email: "manager@cls.local",
      role: "manager",
      managerId: adminId,
      leaveEntitlement: 18,
      startingLeaveEntitlement: 18,
      annualLeaveEntitlement: 18,
      carriedForwardLeave: 0,
      leavePolicyYear: currentLeaveYear(),
      serviceStartDate: "2020-01-01",
      medicalClaimLimit: 500,
      active: true,
      createdAt,
      updatedAt: createdAt,
      ...createPassword("password")
    },
    {
      id: employeeId,
      name: "Daniel Lim",
      email: "employee@cls.local",
      role: "employee",
      managerId,
      leaveEntitlement: 16,
      startingLeaveEntitlement: 16,
      annualLeaveEntitlement: 16,
      carriedForwardLeave: 0,
      leavePolicyYear: currentLeaveYear(),
      serviceStartDate: "2024-01-01",
      medicalClaimLimit: 500,
      active: true,
      createdAt,
      updatedAt: createdAt,
      ...createPassword("password")
    },
    {
      id: teammateId,
      name: "Priya Nair",
      email: "priya@cls.local",
      role: "employee",
      managerId,
      leaveEntitlement: 15,
      startingLeaveEntitlement: 15,
      annualLeaveEntitlement: 15,
      carriedForwardLeave: 0,
      leavePolicyYear: currentLeaveYear(),
      serviceStartDate: "2025-01-01",
      medicalClaimLimit: 500,
      active: true,
      createdAt,
      updatedAt: createdAt,
      ...createPassword("password")
    }
  ];

  const leaveRequest = {
    id: id("leave"),
    employeeId: teammateId,
    managerId,
    type: "Annual Leave",
    startDate: leaveStart,
    endDate: leaveEnd,
    days: workingDaysBetween(leaveStart, leaveEnd),
    leaveYear: Number(leaveStart.slice(0, 4)),
    excludedDates: [],
    reason: "Family travel",
    status: "pending",
    decisionNote: "",
    createdAt,
    updatedAt: createdAt,
    decidedAt: null,
    decidedBy: null
  };

  const medicalClaim = {
    id: id("claim"),
    employeeId,
    managerId,
    claimType: "medical",
    claimDate: formatIsoDate(new Date()),
    category: "General Practitioner",
    provider: "Raffles Medical",
    amount: 58.5,
    receiptRef: "RM-LOCAL-001",
    receipt: null,
    description: "Consultation and medication",
    status: "pending",
    decisionNote: "",
    createdAt,
    updatedAt: createdAt,
    decidedAt: null,
    decidedBy: null
  };

  return {
    users,
    leaveRequests: [leaveRequest],
    medicalClaims: [medicalClaim],
    sessions: [],
    emails: [
      makeEmail(users, {
        recipientId: managerId,
        type: "leave_submitted",
        subject: "Leave request pending approval: Priya Nair",
        body: "Priya Nair has submitted an annual leave request for your review.",
        relatedId: leaveRequest.id,
        createdAt
      }),
      makeEmail(users, {
        recipientId: managerId,
        type: "claim_submitted",
        subject: "Medical claim pending approval: Daniel Lim",
        body: "Daniel Lim has submitted a medical claim for your review.",
        relatedId: medicalClaim.id,
        createdAt
      })
    ]
  };
}

function getUser(db, userId) {
  return db.users.find((user) => user.id === userId);
}

function getUserByEmail(db, email) {
  return db.users.find((user) => user.email.toLowerCase() === String(email).toLowerCase());
}

function pruneExpiredSessions(db) {
  const before = db.sessions.length;
  db.sessions = db.sessions.filter((session) => Number(session.expiresAt) >= Date.now());
  return before !== db.sessions.length;
}

function getAuthenticatedUser(req, db) {
  const token = parseCookies(req).cls_session;
  if (!token) return null;
  let session = sessions.get(token);
  if (!session && Array.isArray(db.sessions)) {
    session = db.sessions.find((item) => item.token === token);
  }
  if (!session || Number(session.expiresAt) < Date.now()) {
    sessions.delete(token);
    return null;
  }
  return getUser(db, session.userId) || null;
}

function requireUser(req, db) {
  const user = getAuthenticatedUser(req, db);
  if (!user || !user.active) {
    const error = new Error("Please sign in again.");
    error.status = 401;
    throw error;
  }
  return user;
}

function requireAdmin(user) {
  if (!canAdmin(user)) {
    const error = new Error("Admin access is required.");
    error.status = 403;
    throw error;
  }
}

function makeEmail(users, payload) {
  const recipient = users.find((user) => user.id === payload.recipientId);
  return {
    id: id("email"),
    recipientId: payload.recipientId,
    to: recipient ? recipient.email : "",
    subject: payload.subject,
    body: payload.body,
    type: payload.type,
    relatedId: payload.relatedId || null,
    createdAt: payload.createdAt || nowIso(),
    delivered: false,
    deliveredAt: null,
    deliveryError: null
  };
}

function htmlEmailBody(body) {
  return String(body)
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeIcsText(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function isoDateToIcs(date) {
  return String(date).replace(/-/g, "");
}

function addDays(date, days) {
  const [year, month, day] = String(date).split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

function makeLeaveCalendarAttachment({ request, employee, reviewer, status = "TENTATIVE" }) {
  const calendarStatus = status === "CONFIRMED" ? "CONFIRMED" : "TENTATIVE";
  const description = [
    `${employee.name} is on leave from ${request.startDate} to ${request.endDate}.`,
    `${request.days} deductible working day(s).`,
    request.reason ? `Reason: ${request.reason}` : "",
    reviewer ? `Reviewed by: ${reviewer.name}` : ""
  ]
    .filter(Boolean)
    .join("\n");

  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//CLS Leave Claims//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${request.id}@cls-leave-claims`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}`,
    `DTSTART;VALUE=DATE:${isoDateToIcs(request.startDate)}`,
    `DTEND;VALUE=DATE:${isoDateToIcs(addDays(request.endDate, 1))}`,
    `SUMMARY:${escapeIcsText(`${employee.name} on leave`)}`,
    `DESCRIPTION:${escapeIcsText(description)}`,
    `STATUS:${calendarStatus}`,
    "TRANSP:OPAQUE",
    "END:VEVENT",
    "END:VCALENDAR"
  ].join("\r\n");

  return {
    filename: `${employee.name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "leave"}-${request.startDate}.ics`,
    content: Buffer.from(`${ics}\r\n`, "utf8").toString("base64")
  };
}

async function deliverEmail(email, options = {}) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log(`[Local email] To: ${email.to} | ${email.subject}`);
    return { delivered: false };
  }

  if (!email.to) {
    throw new Error("Email recipient is missing.");
  }

  const from = process.env.EMAIL_FROM || "CLS Leave & Claims <onboarding@resend.dev>";
  const appUrl = process.env.APP_URL;
  const body = appUrl ? `${email.body}\n\nTo Administer, please open CLS Leave & Claims: ${appUrl}` : email.body;
  const payload = {
    from,
    to: [email.to],
    subject: email.subject,
    text: body,
    html: htmlEmailBody(body)
  };

  if (options.attachments?.length) {
    payload.attachments = options.attachments;
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Resend returned HTTP ${response.status}: ${text || response.statusText}`);
  }

  const result = await response.json();
  return { delivered: true, providerId: result.id || result.data?.id || null };
}

async function addEmail(db, payload, options = {}) {
  const email = makeEmail(db.users, payload);
  db.emails.unshift(email);
  try {
    const result = await deliverEmail(email, options);
    email.delivered = Boolean(result.delivered);
    email.deliveredAt = result.delivered ? nowIso() : null;
    email.providerId = result.providerId || null;
  } catch (error) {
    email.delivered = false;
    email.deliveryError = error.message;
    console.warn(`[Email delivery] ${error.message}`);
  }
  return email;
}

function safeReceiptName(name) {
  const base = path.basename(String(name || "receipt"));
  return base.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "receipt";
}

function safeLocalReceiptPath(storedName) {
  const root = path.resolve(UPLOAD_DIR);
  const filePath = path.resolve(root, String(storedName || ""));
  if (!filePath.startsWith(`${root}${path.sep}`)) {
    throw new Error("Receipt file path is invalid.");
  }
  return filePath;
}

function receiptExtension(name) {
  return path.extname(String(name || "")).toLowerCase();
}

function detectReceiptMimeType(buffer) {
  if (buffer.subarray(0, 1024).includes(Buffer.from("%PDF-", "utf8"))) return "application/pdf";
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  if (buffer.length >= 12 && buffer.subarray(4, 8).toString("ascii") === "ftyp") {
    const brand = buffer.subarray(8, Math.min(buffer.length, 32)).toString("ascii");
    if (/(heic|heix|hevc|hevx)/.test(brand)) return "image/heic";
    if (/(heif|mif1|msf1)/.test(brand)) return "image/heif";
  }
  return "";
}

function receiptMimeType(originalName, buffer) {
  const extensionMimeType = RECEIPT_EXTENSION_MIME_TYPES.get(receiptExtension(originalName));
  const detectedMimeType = detectReceiptMimeType(buffer);
  const heifFamily = new Set(["image/heic", "image/heif"]);

  if (
    detectedMimeType &&
    (!extensionMimeType ||
      extensionMimeType === detectedMimeType ||
      (heifFamily.has(extensionMimeType) && heifFamily.has(detectedMimeType)))
  ) {
    return detectedMimeType;
  }

  throw new Error(RECEIPT_TYPE_ERROR);
}

function parseReceipt(receipt) {
  if (!receipt || typeof receipt !== "object") {
    throw new Error("A receipt upload is required.");
  }

  const originalName = safeReceiptName(receipt.name);
  const match = String(receipt.dataUrl || "").match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    throw new Error("Receipt upload was not in the expected format.");
  }

  const buffer = Buffer.from(match[2], "base64");
  if (!buffer.length) {
    throw new Error("Receipt upload is empty.");
  }
  if (buffer.length > MAX_RECEIPT_BYTES) {
    throw new Error("Receipt upload must be 5 MB or smaller.");
  }
  const mimeType = receiptMimeType(originalName, buffer);

  return {
    originalName,
    mimeType,
    buffer
  };
}

async function saveReceiptAttachment(claimId, receipt) {
  const parsed = parseReceipt(receipt);
  const originalExtension = receiptExtension(parsed.originalName);
  const extension = RECEIPT_EXTENSION_MIME_TYPES.get(originalExtension) === parsed.mimeType
    ? originalExtension
    : RECEIPT_MIME_EXTENSIONS.get(parsed.mimeType);
  const storedName = isSupabaseEnabled()
    ? `claims/${claimId}${extension || ".receipt"}`
    : `${claimId}${extension || ".receipt"}`;

  if (isSupabaseEnabled()) {
    await supabaseRequest(
      `/storage/v1/object/${encodeURIComponent(SUPABASE_RECEIPT_BUCKET)}/${storedName
        .split("/")
        .map(encodeURIComponent)
        .join("/")}`,
      {
        method: "POST",
        headers: {
          "Content-Type": parsed.mimeType,
          "x-upsert": "true"
        },
        body: parsed.buffer
      }
    );

    return {
      storage: "supabase",
      bucket: SUPABASE_RECEIPT_BUCKET,
      originalName: parsed.originalName,
      mimeType: parsed.mimeType,
      size: parsed.buffer.length,
      storedName,
      uploadedAt: nowIso()
    };
  }

  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  await fs.writeFile(safeLocalReceiptPath(storedName), parsed.buffer);

  return {
    storage: "local",
    originalName: parsed.originalName,
    mimeType: parsed.mimeType,
    size: parsed.buffer.length,
    storedName,
    uploadedAt: nowIso()
  };
}

async function readReceiptAttachment(claim) {
  if (claim.receipt?.deletedAt) {
    const error = new Error("Receipt has been removed under the 5-year retention policy.");
    error.status = 410;
    throw error;
  }

  if (claim.receipt?.storage === "supabase") {
    const storedName = String(claim.receipt.storedName || "");
    const response = await supabaseRequest(
      `/storage/v1/object/${encodeURIComponent(claim.receipt.bucket || SUPABASE_RECEIPT_BUCKET)}/${storedName
        .split("/")
        .map(encodeURIComponent)
        .join("/")}`
    );
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  return fs.readFile(safeLocalReceiptPath(claim.receipt.storedName));
}

async function deleteReceiptAttachment(receipt) {
  const storedName = String(receipt?.storedName || "");
  if (!storedName || receipt.deletedAt) return false;

  if (receipt.storage === "supabase") {
    await supabaseRequest(
      `/storage/v1/object/${encodeURIComponent(receipt.bucket || SUPABASE_RECEIPT_BUCKET)}`,
      {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prefixes: [storedName] })
      }
    );
    return true;
  }

  await fs.rm(safeLocalReceiptPath(storedName), { force: true });
  return true;
}

function receiptRetentionCutoff(asOfDate = new Date()) {
  const cutoff = asOfDate instanceof Date
    ? new Date(asOfDate.getTime())
    : assertIsoDate(String(asOfDate), "Retention date");
  cutoff.setUTCHours(0, 0, 0, 0);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - RECEIPT_RETENTION_YEARS);
  return cutoff;
}

function receiptReferenceDate(claim) {
  const value = claim.receipt?.uploadedAt || claim.createdAt || claim.claimDate;
  if (!value) return null;
  const date = String(value).includes("T")
    ? new Date(value)
    : new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function activeReceiptClaims(db) {
  return db.medicalClaims.filter((claim) => claim.receipt?.storedName && !claim.receipt.deletedAt);
}

function receiptStorageSummary(db, asOfDate = new Date()) {
  const cutoff = receiptRetentionCutoff(asOfDate);
  const summary = {
    activeBytes: 0,
    activeReceiptCount: 0,
    deletedBytes: 0,
    deletedReceiptCount: 0,
    dueForDeletionCount: 0,
    oldestActiveReceiptAt: null,
    retentionYears: RECEIPT_RETENTION_YEARS,
    maxReceiptBytes: MAX_RECEIPT_BYTES
  };

  for (const claim of db.medicalClaims) {
    const receipt = claim.receipt;
    if (!receipt) continue;
    const size = Number(receipt.size || 0);
    if (receipt.deletedAt) {
      summary.deletedBytes += size;
      summary.deletedReceiptCount += 1;
      continue;
    }
    if (!receipt.storedName) continue;

    summary.activeBytes += size;
    summary.activeReceiptCount += 1;
    const referenceDate = receiptReferenceDate(claim);
    if (referenceDate && referenceDate < cutoff) summary.dueForDeletionCount += 1;
    if (
      referenceDate &&
      (!summary.oldestActiveReceiptAt || referenceDate < new Date(summary.oldestActiveReceiptAt))
    ) {
      summary.oldestActiveReceiptAt = referenceDate.toISOString();
    }
  }

  return summary;
}

async function applyReceiptRetention(db, asOfDate = new Date()) {
  const cutoff = receiptRetentionCutoff(asOfDate);
  const result = {
    changed: false,
    cutoff: cutoff.toISOString(),
    retentionYears: RECEIPT_RETENTION_YEARS,
    deleted: 0,
    failed: 0,
    errors: []
  };

  for (const claim of activeReceiptClaims(db)) {
    const referenceDate = receiptReferenceDate(claim);
    if (!referenceDate || referenceDate >= cutoff) continue;

    try {
      await deleteReceiptAttachment(claim.receipt);
      claim.receipt = {
        ...claim.receipt,
        deletedAt: nowIso(),
        deletedReason: `${RECEIPT_RETENTION_YEARS}-year retention policy`
      };
      claim.updatedAt = nowIso();
      result.changed = true;
      result.deleted += 1;
    } catch (error) {
      result.failed += 1;
      result.errors.push({
        claimId: claim.id,
        receipt: claim.receipt.originalName || claim.receipt.storedName,
        error: error.message
      });
    }
  }

  return result;
}

function visibleLeaveRequests(db, user) {
  if (canAdmin(user)) return db.leaveRequests;
  return db.leaveRequests.filter(
    (request) => request.employeeId === user.id || request.managerId === user.id
  );
}

function visibleMedicalClaims(db, user) {
  if (canAdmin(user)) return db.medicalClaims;
  return db.medicalClaims.filter(
    (claim) => claim.employeeId === user.id || claim.managerId === user.id
  );
}

function visibleUsers(db, user) {
  return db.users.filter((employee) => canSeeEmployee(user, employee)).map(publicUser);
}

function dashboard(db, user) {
  const employees = db.users.map(publicUser);
  const userById = Object.fromEntries(employees.map((employee) => [employee.id, employee]));
  const leaveRequests = visibleLeaveRequests(db, user);
  const medicalClaims = visibleMedicalClaims(db, user);
  const emails = canAdmin(user)
    ? db.emails
    : db.emails.filter((email) => email.recipientId === user.id);

  return {
    user: publicUser(user),
    users: visibleUsers(db, user),
    allEmployees: canAdmin(user) ? employees : visibleUsers(db, user),
    userById,
    leaveSummary: leaveSummary(user, db.leaveRequests),
    medicalClaimSummary: medicalClaimSummary(user, db.medicalClaims),
    generalClaimSummary: generalClaimSummary(user, db.medicalClaims),
    receiptStorageSummary: canAdmin(user) ? receiptStorageSummary(db) : null,
    leaveRequests,
    medicalClaims,
    emails,
    teamMembers: db.users
      .filter((employee) => employee.managerId === user.id)
      .map(publicUser),
    counts: {
      pendingLeave: leaveRequests.filter(
        (request) => request.status === "pending" && canReview(user, request)
      ).length,
      pendingClaims: medicalClaims.filter(
        (claim) => claim.status === "pending" && canReview(user, claim)
      ).length
    }
  };
}

async function createEmployee(db, body) {
  const name = String(body.name || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const role = String(body.role || "employee");
  const managerId = body.managerId || null;
  const serviceStartDate = String(body.serviceStartDate || formatIsoDate(new Date()));
  assertIsoDate(serviceStartDate, "Service start date");
  const initialAnnualLeaveDays = normalizeLeaveDays(
    body.startingLeaveEntitlement ?? body.leaveEntitlement ?? 0,
    "Initial annual leave days"
  );
  const medicalClaimLimit = Number(body.medicalClaimLimit ?? 500);
  const password = String(body.password || "welcome123");

  if (!name) throw new Error("Employee name is required.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("A valid email is required.");
  if (!["admin", "manager", "employee"].includes(role)) throw new Error("Role is invalid.");
  if (db.users.some((user) => user.email.toLowerCase() === email)) {
    throw new Error("An employee with that email already exists.");
  }
  if (managerId && !getUser(db, managerId)) {
    throw new Error("Direct report approver was not found.");
  }
  if (!Number.isFinite(medicalClaimLimit) || medicalClaimLimit < 0) {
    throw new Error("Medical claim limit must be 0 or more.");
  }

  const createdAt = nowIso();
  const leavePolicyYear = currentLeaveYear();
  const annualLeaveEntitlement = initialAnnualLeaveDays;
  const employee = {
    id: id("usr"),
    name,
    email,
    role,
    managerId,
    serviceStartDate,
    startingLeaveEntitlement: initialAnnualLeaveDays,
    annualLeaveEntitlement,
    carriedForwardLeave: 0,
    leavePolicyYear,
    leaveEntitlement: annualLeaveEntitlement,
    leaveServiceAccrualAt: createdAt,
    medicalClaimLimit,
    active: true,
    createdAt,
    updatedAt: createdAt,
    ...createPassword(password)
  };
  db.users.push(employee);
  await addEmail(db, {
    recipientId: employee.id,
    type: "employee_created",
    subject: "CLS account created",
    body: `Your CLS leave and claims account has been created. Your temporary local password is ${password}.`,
    relatedId: employee.id
  });
  return employee;
}

function updateEmployee(db, employeeId, body) {
  const employee = getUser(db, employeeId);
  if (!employee) {
    const error = new Error("Employee was not found.");
    error.status = 404;
    throw error;
  }
  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name) throw new Error("Employee name is required.");
    employee.name = name;
  }
  if (body.email !== undefined) {
    const email = String(body.email).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("A valid email is required.");
    const duplicate = db.users.find((user) => user.email.toLowerCase() === email && user.id !== employeeId);
    if (duplicate) throw new Error("Another employee already uses that email.");
    employee.email = email;
  }
  if (body.role !== undefined) {
    if (!["admin", "manager", "employee"].includes(body.role)) throw new Error("Role is invalid.");
    employee.role = body.role;
  }
  if (body.managerId !== undefined) {
    const managerId = body.managerId || null;
    if (managerId === employee.id) throw new Error("An employee cannot approve themselves.");
    if (managerId && !getUser(db, managerId)) throw new Error("Direct report approver was not found.");
    employee.managerId = managerId;
  }
  if (body.serviceStartDate !== undefined) {
    assertIsoDate(String(body.serviceStartDate), "Service start date");
    employee.serviceStartDate = String(body.serviceStartDate);
    employee.leaveServiceAccrualAt = nowIso();
  }
  if (body.startingLeaveEntitlement !== undefined) {
    const initialAnnualLeaveDays = normalizeLeaveDays(
      body.startingLeaveEntitlement,
      "Initial annual leave days"
    );
    employee.startingLeaveEntitlement = initialAnnualLeaveDays;
    employee.annualLeaveEntitlement = initialAnnualLeaveDays;
    employee.leaveEntitlement = normalizeLeaveDays(
      initialAnnualLeaveDays + Number(employee.carriedForwardLeave || 0),
      "Leave entitlement"
    );
    employee.leaveServiceAccrualAt = nowIso();
  }
  if (body.leaveEntitlement !== undefined) {
    employee.leaveEntitlement = normalizeLeaveDays(body.leaveEntitlement, "Leave entitlement");
  }
  if (body.medicalClaimLimit !== undefined) {
    const limit = Number(body.medicalClaimLimit);
    if (!Number.isFinite(limit) || limit < 0) throw new Error("Medical claim limit must be 0 or more.");
    employee.medicalClaimLimit = limit;
  }
  if (body.active !== undefined) {
    employee.active = Boolean(body.active);
  }
  if (body.password) {
    Object.assign(employee, createPassword(String(body.password)));
  }
  employee.updatedAt = nowIso();

  return employee;
}

async function createLeaveRequest(db, user, body) {
  if (!user.managerId) {
    throw new Error("No Direct Report / approver has been assigned to your profile yet.");
  }

  const type = String(body.type || "Annual Leave").trim();
  const reason = String(body.reason || "").trim();
  const startDate = String(body.startDate || "");
  const endDate = String(body.endDate || "");
  assertIsoDate(startDate, "Start date");
  assertIsoDate(endDate, "End date");
  leaveDayBreakdown(startDate, endDate);

  const publicHolidays = await getSingaporePublicHolidaysForRange(startDate, endDate);
  const breakdown = leaveDayBreakdown(startDate, endDate, publicHolidays);
  const days = breakdown.days;
  const leaveYear = Number(startDate.slice(0, 4));
  const summary = leaveSummary(user, db.leaveRequests, { year: leaveYear });

  if (days <= 0) {
    throw new Error("This date range does not deduct any leave because it only covers weekends or Singapore public holidays.");
  }
  if (days > summary.available) {
    throw new Error(`This request needs ${days} days, but only ${summary.available} days are available.`);
  }

  const createdAt = nowIso();
  const request = {
    id: id("leave"),
    employeeId: user.id,
    managerId: user.managerId,
    type,
    startDate,
    endDate,
    days,
    leaveYear,
    excludedDates: breakdown.excludedDates,
    reason,
    status: "pending",
    decisionNote: "",
    createdAt,
    updatedAt: createdAt,
    decidedAt: null,
    decidedBy: null
  };

  db.leaveRequests.unshift(request);
  await addEmail(db, {
    recipientId: user.managerId,
    type: "leave_submitted",
    subject: `Leave request pending approval: ${user.name}`,
    body: [
      `${user.name} has applied for ${days} deductible working day(s) of ${type} from ${startDate} to ${endDate}.`,
      "Please review the leave request in CLS Leave & Claims.",
      `Use the attached calendar file (${user.name} on leave) to add this leave period to your calendar.`
    ].join("\n\n"),
    relatedId: request.id
  }, {
    attachments: [
      makeLeaveCalendarAttachment({
        request,
        employee: user,
        status: "TENTATIVE"
      })
    ]
  });
  return request;
}

async function decideLeaveRequest(db, reviewer, requestId, body) {
  const request = db.leaveRequests.find((item) => item.id === requestId);
  if (!request) {
    const error = new Error("Leave request was not found.");
    error.status = 404;
    throw error;
  }
  if (!canReview(reviewer, request)) {
    const error = new Error("You are not assigned to review this leave request.");
    error.status = 403;
    throw error;
  }
  if (request.status !== "pending") {
    throw new Error("Only pending leave requests can be approved or not approved.");
  }

  assertDecision(body.status);
  const decidedAt = nowIso();
  request.status = body.status;
  request.decisionNote = String(body.decisionNote || "").trim();
  request.decidedAt = decidedAt;
  request.decidedBy = reviewer.id;
  request.updatedAt = decidedAt;

  const employee = getUser(db, request.employeeId);
  const attachments = request.status === "approved" && employee
    ? [
        makeLeaveCalendarAttachment({
          request,
          employee,
          reviewer,
          status: "CONFIRMED"
        })
      ]
    : [];

  await addEmail(db, {
    recipientId: request.employeeId,
    type: "leave_decided",
    subject: `Leave request ${decisionLabel(request.status).toLowerCase()}`,
    body: [
      `Your leave request for ${request.days} working day(s) from ${request.startDate} to ${request.endDate} was ${decisionLabel(request.status).toLowerCase()} by ${reviewer.name}.`,
      request.status === "approved"
        ? "Use the attached calendar file to add your approved leave to your calendar."
        : "No calendar file is attached because this leave request was not approved."
    ].join("\n\n"),
    relatedId: request.id
  }, {
    attachments
  });
  console.log(`[Leave decision] ${employee ? employee.name : request.employeeId}: ${request.status}`);
  return request;
}

async function createClaim(db, user, body) {
  if (!user.managerId) {
    throw new Error("No Direct Report / approver has been assigned to your profile yet.");
  }

  const clientSubmissionId = String(body.clientSubmissionId || "").trim().slice(0, 120);
  if (clientSubmissionId) {
    const existingClaim = db.medicalClaims.find(
      (claim) => claim.employeeId === user.id && claim.clientSubmissionId === clientSubmissionId
    );
    if (existingClaim) return existingClaim;
  }

  const { category, claimType } = claimCategoryAndType(body);
  const claimDate = String(body.claimDate || "");
  assertIsoDate(claimDate, "Claim date");
  const amount = normalizeMoney(body.amount);
  const provider = String(body.provider || "").trim();
  const receiptRef = String(body.receiptRef || "").trim();
  const description = String(body.description || "").trim();

  if (!provider) throw new Error(claimType === "medical" ? "Clinic or provider is required." : "Merchant or provider is required.");
  if (!description) throw new Error("Claim description is required.");

  if (claimType === "medical") {
    const summary = medicalClaimSummary(user, db.medicalClaims);
    if (amount > summary.unreserved) {
      throw new Error(`This medical claim needs $${amount.toFixed(2)}, but only $${summary.unreserved.toFixed(2)} is available after approved and pending claims.`);
    }
  }

  const createdAt = nowIso();
  const claim = {
    id: id("claim"),
    employeeId: user.id,
    managerId: user.managerId,
    claimType,
    claimDate,
    category,
    provider,
    amount,
    receiptRef,
    receipt: null,
    clientSubmissionId: clientSubmissionId || null,
    description,
    status: "pending",
    decisionNote: "",
    createdAt,
    updatedAt: createdAt,
    decidedAt: null,
    decidedBy: null
  };

  claim.receipt = await saveReceiptAttachment(claim.id, body.receipt);

  db.medicalClaims.unshift(claim);
  const label = claimType === "medical" ? "Medical claim" : "General claim";
  await addEmail(db, {
    recipientId: user.managerId,
    type: "claim_submitted",
    subject: `${label} pending approval: ${user.name}`,
    body: `${user.name} has submitted a ${label.toLowerCase()} for $${amount.toFixed(2)} from ${provider}.`,
    relatedId: claim.id
  });
  return claim;
}

async function decideClaim(db, reviewer, claimId, body) {
  const claim = db.medicalClaims.find((item) => item.id === claimId);
  if (!claim) {
    const error = new Error("Claim was not found.");
    error.status = 404;
    throw error;
  }
  if (!canReview(reviewer, claim)) {
    const error = new Error("You are not assigned to review this claim.");
    error.status = 403;
    throw error;
  }
  if (claim.status !== "pending") {
    throw new Error("Only pending claims can be approved or not approved.");
  }

  assertDecision(body.status);
  const decidedAt = nowIso();
  claim.status = body.status;
  claim.decisionNote = String(body.decisionNote || "").trim();
  claim.decidedAt = decidedAt;
  claim.decidedBy = reviewer.id;
  claim.updatedAt = decidedAt;

  const label = claim.claimType === "general" ? "General claim" : "Medical claim";
  await addEmail(db, {
    recipientId: claim.employeeId,
    type: "claim_decided",
    subject: `${label} ${decisionLabel(claim.status).toLowerCase()}`,
    body: `Your ${label.toLowerCase()} for $${Number(claim.amount).toFixed(2)} from ${claim.provider} was ${decisionLabel(claim.status).toLowerCase()} by ${reviewer.name}.`,
    relatedId: claim.id
  });
  return claim;
}

async function handleApi(req, res, pathname) {
  const db = await loadDb();
  const body = req.method === "GET" ? {} : await readJson(req);

  if (req.method === "POST" && pathname === "/api/login") {
    const email = String(body.email || "").trim();
    const password = String(body.password || "");
    const user = getUserByEmail(db, email);
    if (!user || !user.active || !verifyPassword(password, user)) {
      return jsonResponse(res, 401, { error: "Email or password is incorrect." });
    }
    const token = crypto.randomBytes(32).toString("hex");
    const session = { token, userId: user.id, expiresAt: Date.now() + SESSION_TTL_MS, createdAt: nowIso() };
    sessions.set(token, session);
    db.sessions.unshift(session);
    await saveDb(db);
    setSessionCookie(res, token);
    return jsonResponse(res, 200, { data: dashboard(db, user) });
  }

  if (req.method === "POST" && pathname === "/api/logout") {
    const token = parseCookies(req).cls_session;
    if (token) {
      sessions.delete(token);
      db.sessions = db.sessions.filter((session) => session.token !== token);
      await saveDb(db);
    }
    clearSessionCookie(res);
    return jsonResponse(res, 200, { data: true });
  }

  if (req.method === "GET" && pathname === "/api/session") {
    const user = getAuthenticatedUser(req, db);
    if (!user || !user.active) return jsonResponse(res, 401, { error: "No active session." });
    return jsonResponse(res, 200, { data: dashboard(db, user) });
  }

  if (req.method === "GET" && pathname === "/api/sync-public-holidays") {
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret) {
      const authHeader = req.headers.authorization || "";
      if (authHeader !== `Bearer ${cronSecret}`) {
        return jsonResponse(res, 401, { error: "Unauthorized." });
      }
    } else {
      const admin = requireUser(req, db);
      requireAdmin(admin);
    }

    const cache = await syncSingaporePublicHolidays({ forceRefresh: true });
    return jsonResponse(res, 200, {
      data: {
        syncedAt: cache.syncedAt,
        holidays: cache.holidays.length,
        years: [...new Set(cache.holidays.map((holiday) => holiday.year))].sort()
      }
    });
  }

  if ((req.method === "GET" || req.method === "POST") && pathname === "/api/run-leave-rollover") {
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret) {
      const authHeader = req.headers.authorization || "";
      if (authHeader !== `Bearer ${cronSecret}`) {
        return jsonResponse(res, 401, { error: "Unauthorized." });
      }
    } else {
      const admin = requireUser(req, db);
      requireAdmin(admin);
    }

    const asOfDate = body.asOfDate ? assertIsoDate(String(body.asOfDate), "Rollover date") : new Date();
    const rollover = applyLeaveYearRollover(db, asOfDate);
    const anniversaryAccrual = applyServiceAnniversaryAccrual(db, asOfDate);
    if (rollover.changed || anniversaryAccrual.changed) await saveDb(db);
    return jsonResponse(res, 200, { data: { rollover, anniversaryAccrual } });
  }

  if ((req.method === "GET" || req.method === "POST") && pathname === "/api/run-service-anniversary-accrual") {
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret) {
      const authHeader = req.headers.authorization || "";
      if (authHeader !== `Bearer ${cronSecret}`) {
        return jsonResponse(res, 401, { error: "Unauthorized." });
      }
    } else {
      const admin = requireUser(req, db);
      requireAdmin(admin);
    }

    const asOfDate = body.asOfDate ? assertIsoDate(String(body.asOfDate), "Accrual date") : new Date();
    const anniversaryAccrual = applyServiceAnniversaryAccrual(db, asOfDate);
    if (anniversaryAccrual.changed) await saveDb(db);
    return jsonResponse(res, 200, { data: anniversaryAccrual });
  }

  if ((req.method === "GET" || req.method === "POST") && pathname === "/api/run-receipt-retention") {
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret) {
      const authHeader = req.headers.authorization || "";
      if (authHeader !== `Bearer ${cronSecret}`) {
        return jsonResponse(res, 401, { error: "Unauthorized." });
      }
    } else {
      const admin = requireUser(req, db);
      requireAdmin(admin);
    }

    const asOfDate = body.asOfDate ? assertIsoDate(String(body.asOfDate), "Retention date") : new Date();
    const receiptRetention = await applyReceiptRetention(db, asOfDate);
    if (receiptRetention.changed) await saveDb(db);
    return jsonResponse(res, 200, { data: receiptRetention });
  }

  if ((req.method === "GET" || req.method === "POST") && pathname === "/api/cron/daily-maintenance") {
    const cronSecret = process.env.CRON_SECRET;
    const authHeader = req.headers.authorization || "";
    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      return jsonResponse(res, 401, { error: "Unauthorized." });
    }

    const holidays = await syncSingaporePublicHolidays({ forceRefresh: true });
    const rollover = applyLeaveYearRollover(db);
    const anniversaryAccrual = applyServiceAnniversaryAccrual(db);
    const receiptRetention = await applyReceiptRetention(db);
    if (rollover.changed || anniversaryAccrual.changed || receiptRetention.changed) await saveDb(db);
    return jsonResponse(res, 200, {
      data: {
        holidays: {
          syncedAt: holidays.syncedAt,
          count: holidays.holidays.length,
          years: holidays.years
        },
        rollover,
        anniversaryAccrual,
        receiptRetention
      }
    });
  }

  const user = requireUser(req, db);

  if (req.method === "POST" && pathname === "/api/account/password") {
    changePassword(user, body);
    keepOnlyCurrentSession(db, user.id, parseCookies(req).cls_session);
    await saveDb(db);
    return jsonResponse(res, 200, { data: { dashboard: dashboard(db, user) } });
  }

  if (req.method === "GET" && pathname === "/api/dashboard") {
    return jsonResponse(res, 200, { data: dashboard(db, user) });
  }

  if (req.method === "POST" && pathname === "/api/employees") {
    requireAdmin(user);
    const employee = await createEmployee(db, body);
    await saveDb(db);
    return jsonResponse(res, 201, { data: { employee: publicUser(employee), dashboard: dashboard(db, user) } });
  }

  const employeeMatch = pathname.match(/^\/api\/employees\/([^/]+)$/);
  if (employeeMatch && req.method === "PATCH") {
    requireAdmin(user);
    const employee = updateEmployee(db, employeeMatch[1], body);
    await saveDb(db);
    return jsonResponse(res, 200, { data: { employee: publicUser(employee), dashboard: dashboard(db, user) } });
  }

  if (req.method === "POST" && pathname === "/api/leave-requests") {
    const request = await createLeaveRequest(db, user, body);
    await saveDb(db);
    return jsonResponse(res, 201, { data: { request, dashboard: dashboard(db, user) } });
  }

  const leaveDecisionMatch = pathname.match(/^\/api\/leave-requests\/([^/]+)\/status$/);
  if (leaveDecisionMatch && req.method === "PATCH") {
    const request = await decideLeaveRequest(db, user, leaveDecisionMatch[1], body);
    await saveDb(db);
    return jsonResponse(res, 200, { data: { request, dashboard: dashboard(db, user) } });
  }

  const receiptMatch = pathname.match(/^\/api\/claims\/([^/]+)\/receipt$/);
  if (receiptMatch && req.method === "GET") {
    const claim = db.medicalClaims.find((item) => item.id === receiptMatch[1]);
    if (!claim) return jsonResponse(res, 404, { error: "Claim was not found." });
    if (!canReview(user, claim) && claim.employeeId !== user.id) {
      return jsonResponse(res, 403, { error: "You cannot view this receipt." });
    }
    if (!claim.receipt?.storedName) {
      return jsonResponse(res, 404, { error: "No receipt is attached to this claim." });
    }
    if (claim.receipt.deletedAt) {
      return jsonResponse(res, 410, { error: "Receipt has been removed under the 5-year retention policy." });
    }

    const receipt = await readReceiptAttachment(claim);
    res.writeHead(200, {
      "Content-Type": claim.receipt.mimeType || "application/octet-stream",
      "Content-Disposition": `inline; filename="${claim.receipt.originalName || "receipt"}"`,
      "Content-Length": receipt.length
    });
    return res.end(receipt);
  }

  if (req.method === "POST" && (pathname === "/api/medical-claims" || pathname === "/api/claims")) {
    const claim = await createClaim(db, user, body);
    await saveDb(db);
    return jsonResponse(res, 201, { data: { claim, dashboard: dashboard(db, user) } });
  }

  const claimDecisionMatch = pathname.match(/^\/api\/(?:medical-claims|claims)\/([^/]+)\/status$/);
  if (claimDecisionMatch && req.method === "PATCH") {
    const claim = await decideClaim(db, user, claimDecisionMatch[1], body);
    await saveDb(db);
    return jsonResponse(res, 200, { data: { claim, dashboard: dashboard(db, user) } });
  }

  return jsonResponse(res, 404, { error: "Endpoint was not found." });
}

async function serveStatic(req, res, pathname) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, safePath));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    return textResponse(res, 403, "Forbidden");
  }

  try {
    const content = await fs.readFile(filePath);
    const ext = path.extname(filePath);
    const type = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".svg": "image/svg+xml"
    }[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type });
    res.end(content);
  } catch (error) {
    if (error.code === "ENOENT") {
      const index = await fs.readFile(path.join(PUBLIC_DIR, "index.html"));
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(index);
    }
    throw error;
  }
}

async function handleRequest(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/")) {
      return await handleApi(req, res, url.pathname);
    }
    return await serveStatic(req, res, url.pathname);
  } catch (error) {
    const status = error.status || 400;
    return jsonResponse(res, status, { error: error.message || "Something went wrong." });
  }
}

if (require.main === module) {
  const server = http.createServer(handleRequest);
  server.listen(PORT, "127.0.0.1", () => {
    console.log(`CLS Leave & Claims is running at http://localhost:${PORT}`);
    syncSingaporePublicHolidays()
      .then((cache) => {
        console.log(`[Public holidays] Synced ${cache.holidays.length} Singapore public holiday dates.`);
      })
      .catch((error) => {
        console.warn(`[Public holidays] Sync skipped: ${error.message}`);
      });
  });
}

module.exports = { handleRequest };
