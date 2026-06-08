const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const { URL } = require("node:url");

const {
  assertDecision,
  assertIsoDate,
  ANNUAL_BIRTHDAY_LEAVE_DAYS,
  ANNUAL_MEDICAL_LEAVE_DAYS,
  canAdmin,
  canReview,
  canSeeEmployee,
  currentLeaveYear,
  decisionLabel,
  formatIsoDate,
  generalClaimSummary,
  isMedicalLeaveType,
  leaveDayBreakdown,
  leaveSummary,
  medicalClaimSummary,
  medicalLeaveSummary,
  nextLeaveYearBalance,
  normalizeLeaveDays,
  normalizeSignedLeaveDays,
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
const MAX_SESSIONS_PER_USER = 5;
const MAX_JSON_BYTES = 10_000_000;
const MAX_RECEIPT_BYTES = 5_000_000;
const MAX_MULTIPART_BYTES = MAX_RECEIPT_BYTES + 1_000_000;
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
const AUDIT_LOG_MAX_EVENTS = 1000;
const AUDIT_DEFAULT_LIMIT = 20;
const HISTORY_DEFAULT_LIMIT = 10;
const MAIL_DEFAULT_LIMIT = 20;
const HISTORY_MAX_LIMIT = 50;
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

function assertPassword(password, label = "Password") {
  const value = String(password || "");
  if (value.length < 8) throw new Error(`${label} must be at least 8 characters.`);
  return value;
}

function setUserPassword(user, password, label = "Password") {
  Object.assign(user, createPassword(assertPassword(password, label)));
  user.updatedAt = nowIso();
  return user;
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
  assertPassword(newPassword, "New password");
  if (newPassword !== confirmPassword) throw new Error("New passwords do not match.");
  if (verifyPassword(newPassword, user)) throw new Error("New password must be different from your current password.");

  return setUserPassword(user, newPassword, "New password");
}

function pruneMemorySessions(now = Date.now()) {
  let removed = 0;
  for (const [token, session] of sessions.entries()) {
    if (Number(session.expiresAt) < now) {
      sessions.delete(token);
      removed += 1;
    }
  }
  return removed;
}

function sessionRecency(session) {
  return Number(session.expiresAt || 0) || new Date(session.createdAt || 0).getTime() || 0;
}

function limitSessionsForUser(db, userId, maxSessions = MAX_SESSIONS_PER_USER) {
  if (!Array.isArray(db.sessions)) db.sessions = [];
  const userSessions = db.sessions
    .filter((session) => session.userId === userId)
    .sort((left, right) => sessionRecency(right) - sessionRecency(left));
  const allowedTokens = new Set(userSessions.slice(0, maxSessions).map((session) => session.token));
  let changed = false;

  db.sessions = db.sessions.filter((session) => {
    if (session.userId !== userId || allowedTokens.has(session.token)) return true;
    sessions.delete(session.token);
    changed = true;
    return false;
  });

  for (const [token, session] of sessions.entries()) {
    if (session.userId === userId && !allowedTokens.has(token)) {
      sessions.delete(token);
      changed = true;
    }
  }

  return changed;
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

async function readBody(req, maxBytes = MAX_JSON_BYTES) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) {
      throw new Error("Request is too large.");
    }
    chunks.push(chunk);
  }

  return chunks.length ? Buffer.concat(chunks) : Buffer.alloc(0);
}

async function readJson(req) {
  const buffer = await readBody(req, MAX_JSON_BYTES);
  if (!buffer.length) return {};
  return JSON.parse(buffer.toString("utf8"));
}

function multipartBoundary(contentType) {
  const match = String(contentType || "").match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  return match ? (match[1] || match[2] || "").trim() : "";
}

function parseMultipartHeaderValue(value) {
  const result = {};
  String(value || "")
    .split(";")
    .slice(1)
    .forEach((part) => {
      const index = part.indexOf("=");
      if (index === -1) return;
      const key = part.slice(0, index).trim().toLowerCase();
      let fieldValue = part.slice(index + 1).trim();
      if (fieldValue.startsWith('"') && fieldValue.endsWith('"')) {
        fieldValue = fieldValue.slice(1, -1).replace(/\\"/g, '"');
      }
      result[key] = fieldValue;
    });

  if (result["filename*"]) {
    const encoded = result["filename*"].replace(/^utf-8''/i, "");
    try {
      result.filename = decodeURIComponent(encoded);
    } catch (_error) {
      result.filename = encoded;
    }
  }

  return result;
}

function parseMultipartBuffer(buffer, boundary) {
  if (!boundary) throw new Error("Upload boundary is missing.");

  const boundaryBuffer = Buffer.from(`--${boundary}`);
  const nextBoundaryBuffer = Buffer.from(`\r\n--${boundary}`);
  const headerSeparator = Buffer.from("\r\n\r\n");
  const fields = {};
  let position = buffer.indexOf(boundaryBuffer);

  while (position !== -1) {
    position += boundaryBuffer.length;
    if (buffer[position] === 45 && buffer[position + 1] === 45) break;
    if (buffer[position] === 13 && buffer[position + 1] === 10) position += 2;

    const headerEnd = buffer.indexOf(headerSeparator, position);
    if (headerEnd === -1) throw new Error("Upload could not be read.");

    const rawHeaders = buffer.subarray(position, headerEnd).toString("utf8");
    const headers = Object.fromEntries(
      rawHeaders
        .split("\r\n")
        .map((line) => {
          const index = line.indexOf(":");
          if (index === -1) return null;
          return [line.slice(0, index).trim().toLowerCase(), line.slice(index + 1).trim()];
        })
        .filter(Boolean)
    );
    const disposition = parseMultipartHeaderValue(headers["content-disposition"]);
    const name = disposition.name;
    if (!name) throw new Error("Upload field name is missing.");

    const dataStart = headerEnd + headerSeparator.length;
    const nextBoundary = buffer.indexOf(nextBoundaryBuffer, dataStart);
    if (nextBoundary === -1) throw new Error("Upload ended unexpectedly.");
    const data = buffer.subarray(dataStart, nextBoundary);

    if (disposition.filename !== undefined) {
      fields[name] = {
        name: disposition.filename,
        type: headers["content-type"] || "application/octet-stream",
        buffer: Buffer.from(data)
      };
    } else {
      fields[name] = data.toString("utf8");
    }

    position = nextBoundary + 2;
  }

  return fields;
}

async function readMultipart(req) {
  const contentType = req.headers["content-type"] || "";
  const boundary = multipartBoundary(contentType);
  const buffer = await readBody(req, MAX_MULTIPART_BYTES);
  return parseMultipartBuffer(buffer, boundary);
}

async function readRequestBody(req) {
  if (req.method === "GET") return {};
  const contentType = String(req.headers["content-type"] || "").toLowerCase();
  if (contentType.startsWith("multipart/form-data")) {
    return readMultipart(req);
  }
  return readJson(req);
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

function nullish(value) {
  return value === undefined ? null : value;
}

function userToRow(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    manager_id: nullish(user.managerId),
    claim_approver_id: nullish(user.claimApproverId),
    service_start_date: user.serviceStartDate,
    starting_leave_entitlement: Number(user.startingLeaveEntitlement || 0),
    annual_leave_entitlement: Number(user.annualLeaveEntitlement || 0),
    carried_forward_leave: Number(user.carriedForwardLeave || 0),
    birthday_leave_entitlement: Number(user.birthdayLeaveEntitlement || 0),
    leave_policy_year: Number(user.leavePolicyYear || currentLeaveYear()),
    leave_entitlement: Number(user.leaveEntitlement || 0),
    leave_rollover_at: nullish(user.leaveRolloverAt),
    leave_service_accrual_at: nullish(user.leaveServiceAccrualAt),
    medical_claim_limit: Number(user.medicalClaimLimit || 0),
    medical_leave_entitlement: Number(user.medicalLeaveEntitlement ?? ANNUAL_MEDICAL_LEAVE_DAYS),
    active: Boolean(user.active),
    password_salt: user.passwordSalt,
    password_hash: user.passwordHash,
    created_at: user.createdAt,
    updated_at: user.updatedAt
  };
}

function userFromRow(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    managerId: row.manager_id,
    claimApproverId: row.claim_approver_id,
    serviceStartDate: row.service_start_date,
    startingLeaveEntitlement: Number(row.starting_leave_entitlement || 0),
    annualLeaveEntitlement: Number(row.annual_leave_entitlement || 0),
    carriedForwardLeave: Number(row.carried_forward_leave || 0),
    birthdayLeaveEntitlement: Number(row.birthday_leave_entitlement || 0),
    leavePolicyYear: Number(row.leave_policy_year || currentLeaveYear()),
    leaveEntitlement: Number(row.leave_entitlement || 0),
    leaveRolloverAt: row.leave_rollover_at,
    leaveServiceAccrualAt: row.leave_service_accrual_at,
    medicalClaimLimit: Number(row.medical_claim_limit || 0),
    medicalLeaveEntitlement: Number(row.medical_leave_entitlement ?? ANNUAL_MEDICAL_LEAVE_DAYS),
    active: Boolean(row.active),
    passwordSalt: row.password_salt,
    passwordHash: row.password_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function leaveRequestToRow(request) {
  return {
    id: request.id,
    employee_id: request.employeeId,
    manager_id: request.managerId,
    type: request.type,
    start_date: request.startDate,
    end_date: request.endDate,
    days: Number(request.days || 0),
    leave_year: Number(request.leaveYear || currentLeaveYear()),
    excluded_dates: Array.isArray(request.excludedDates) ? request.excludedDates : [],
    reason: request.reason || "",
    medical_certificate: request.medicalCertificate || null,
    status: request.status,
    decision_note: request.decisionNote || "",
    created_at: request.createdAt,
    updated_at: request.updatedAt,
    decided_at: nullish(request.decidedAt),
    decided_by: nullish(request.decidedBy),
    cancellation_note: request.cancellationNote || "",
    cancelled_at: nullish(request.cancelledAt),
    cancelled_by: nullish(request.cancelledBy)
  };
}

function leaveRequestFromRow(row) {
  return {
    id: row.id,
    employeeId: row.employee_id,
    managerId: row.manager_id,
    type: row.type,
    startDate: row.start_date,
    endDate: row.end_date,
    days: Number(row.days || 0),
    leaveYear: Number(row.leave_year || currentLeaveYear()),
    excludedDates: Array.isArray(row.excluded_dates) ? row.excluded_dates : [],
    reason: row.reason || "",
    medicalCertificate: row.medical_certificate || null,
    status: row.status,
    decisionNote: row.decision_note || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    decidedAt: row.decided_at,
    decidedBy: row.decided_by,
    cancellationNote: row.cancellation_note || "",
    cancelledAt: row.cancelled_at,
    cancelledBy: row.cancelled_by
  };
}

function leaveAdjustmentToRow(adjustment) {
  return {
    id: adjustment.id,
    employee_id: adjustment.employeeId,
    actor_id: nullish(adjustment.actorId),
    year: Number(adjustment.year || currentLeaveYear()),
    days: Number(adjustment.days || 0),
    reason: adjustment.reason || "",
    created_at: adjustment.createdAt
  };
}

function leaveAdjustmentFromRow(row) {
  return {
    id: row.id,
    employeeId: row.employee_id,
    actorId: row.actor_id,
    year: Number(row.year || currentLeaveYear()),
    days: Number(row.days || 0),
    reason: row.reason || "",
    createdAt: row.created_at
  };
}

function claimToRow(claim) {
  return {
    id: claim.id,
    employee_id: claim.employeeId,
    manager_id: claim.managerId,
    claim_type: claim.claimType,
    claim_date: claim.claimDate,
    category: claim.category,
    provider: claim.provider,
    amount: Number(claim.amount || 0),
    receipt_ref: claim.receiptRef || "",
    receipt: claim.receipt || null,
    client_submission_id: nullish(claim.clientSubmissionId),
    description: claim.description,
    status: claim.status,
    decision_note: claim.decisionNote || "",
    created_at: claim.createdAt,
    updated_at: claim.updatedAt,
    decided_at: nullish(claim.decidedAt),
    decided_by: nullish(claim.decidedBy)
  };
}

function claimFromRow(row) {
  return {
    id: row.id,
    employeeId: row.employee_id,
    managerId: row.manager_id,
    claimType: row.claim_type,
    claimDate: row.claim_date,
    category: row.category,
    provider: row.provider,
    amount: Number(row.amount || 0),
    receiptRef: row.receipt_ref || "",
    receipt: row.receipt || null,
    clientSubmissionId: row.client_submission_id,
    description: row.description,
    status: row.status,
    decisionNote: row.decision_note || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    decidedAt: row.decided_at,
    decidedBy: row.decided_by
  };
}

function emailToRow(email) {
  return {
    id: email.id,
    recipient_id: email.recipientId,
    to_address: email.to || "",
    subject: email.subject,
    body: email.body,
    type: email.type,
    related_id: nullish(email.relatedId),
    created_at: email.createdAt,
    delivered: Boolean(email.delivered),
    delivered_at: nullish(email.deliveredAt),
    delivery_error: nullish(email.deliveryError),
    provider_id: nullish(email.providerId)
  };
}

function emailFromRow(row) {
  return {
    id: row.id,
    recipientId: row.recipient_id,
    to: row.to_address || "",
    subject: row.subject,
    body: row.body,
    type: row.type,
    relatedId: row.related_id,
    createdAt: row.created_at,
    delivered: Boolean(row.delivered),
    deliveredAt: row.delivered_at,
    deliveryError: row.delivery_error,
    providerId: row.provider_id
  };
}

function auditEventToRow(event) {
  return {
    id: event.id,
    created_at: event.createdAt,
    actor_id: nullish(event.actorId),
    actor_name: event.actorName || "System",
    actor_email: event.actorEmail || "",
    actor_role: event.actorRole || "system",
    action: event.action,
    summary: event.summary || "",
    affected_user_id: nullish(event.affectedUserId),
    affected_user_name: event.affectedUserName || "",
    related_type: nullish(event.relatedType),
    related_id: nullish(event.relatedId),
    metadata: event.metadata && typeof event.metadata === "object" ? event.metadata : {}
  };
}

function auditEventFromRow(row) {
  return {
    id: row.id,
    createdAt: row.created_at,
    actorId: row.actor_id,
    actorName: row.actor_name || "System",
    actorEmail: row.actor_email || "",
    actorRole: row.actor_role || "system",
    action: row.action,
    summary: row.summary || "",
    affectedUserId: row.affected_user_id,
    affectedUserName: row.affected_user_name || "",
    relatedType: row.related_type,
    relatedId: row.related_id,
    metadata: row.metadata && typeof row.metadata === "object" ? row.metadata : {}
  };
}

function sessionToRow(session) {
  return {
    token: session.token,
    user_id: session.userId,
    expires_at: Number(session.expiresAt || 0),
    created_at: session.createdAt
  };
}

function sessionFromRow(row) {
  return {
    token: row.token,
    userId: row.user_id,
    expiresAt: Number(row.expires_at || 0),
    createdAt: row.created_at
  };
}

const SUPABASE_TABLES = [
  { field: "users", table: "cls_users", key: "id", order: "created_at.asc", toRow: userToRow, fromRow: userFromRow },
  { field: "leaveRequests", table: "cls_leave_requests", key: "id", order: "created_at.desc", toRow: leaveRequestToRow, fromRow: leaveRequestFromRow },
  { field: "leaveAdjustments", table: "cls_leave_adjustments", key: "id", order: "created_at.desc", toRow: leaveAdjustmentToRow, fromRow: leaveAdjustmentFromRow },
  { field: "medicalClaims", table: "cls_claims", key: "id", order: "created_at.desc", toRow: claimToRow, fromRow: claimFromRow },
  { field: "emails", table: "cls_emails", key: "id", order: "created_at.desc", toRow: emailToRow, fromRow: emailFromRow },
  { field: "auditEvents", table: "cls_audit_events", key: "id", order: "created_at.desc", toRow: auditEventToRow, fromRow: auditEventFromRow },
  { field: "sessions", table: "cls_sessions", key: "token", order: "created_at.desc", toRow: sessionToRow, fromRow: sessionFromRow }
];

function rowSnapshot(rows, key) {
  return Object.fromEntries(rows.map((row) => [String(row[key]), JSON.stringify(row)]));
}

function attachSupabaseSnapshot(db) {
  const snapshot = {};
  for (const config of SUPABASE_TABLES) {
    const rows = (db[config.field] || []).map(config.toRow);
    snapshot[config.field] = rowSnapshot(rows, config.key);
  }
  Object.defineProperty(db, "__supabaseSnapshot", {
    value: snapshot,
    enumerable: false,
    configurable: true,
    writable: true
  });
  return db;
}

async function loadSupabaseTable(config) {
  const params = new URLSearchParams({ select: "*" });
  if (config.order) params.set("order", config.order);
  const response = await supabaseRequest(`/rest/v1/${config.table}?${params.toString()}`, {
    headers: { Accept: "application/json" }
  });
  return response.json();
}

async function loadSupabaseDb() {
  let rowsByField;
  try {
    const tableRows = await Promise.all(SUPABASE_TABLES.map(loadSupabaseTable));
    rowsByField = Object.fromEntries(
      SUPABASE_TABLES.map((config, index) => [
        config.field,
        tableRows[index].map(config.fromRow)
      ])
    );
  } catch (error) {
    throw new Error(
      `Supabase table data layer is not ready. Apply supabase/v1-rollout.sql before deploying this version. ${error.message}`
    );
  }

  if (!rowsByField.users.length) {
    const db = seedProductionDb();
    applyLeaveYearRollover(db);
    applyServiceAnniversaryAccrual(db);
    await saveSupabaseDb(db);
    return db;
  }

  const db = attachSupabaseSnapshot(normalizeDb(rowsByField));
  const rollover = applyLeaveYearRollover(db);
  const anniversaryAccrual = applyServiceAnniversaryAccrual(db);
  const sessionsPruned = pruneExpiredSessions(db);
  if (rollover.changed || anniversaryAccrual.changed || sessionsPruned) await saveSupabaseDb(db);
  return db;
}

async function upsertSupabaseRows(config, rows) {
  if (!rows.length) return;
  await supabaseRequest(
    `/rest/v1/${config.table}?on_conflict=${encodeURIComponent(config.key)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal"
      },
      body: JSON.stringify(rows)
    }
  );
}

async function deleteSupabaseRows(config, keys) {
  if (!keys.length) return;
  const batchSize = 100;
  for (let index = 0; index < keys.length; index += batchSize) {
    const batch = keys.slice(index, index + batchSize);
    const filter = batch.map((key) => encodeURIComponent(String(key))).join(",");
    await supabaseRequest(
      `/rest/v1/${config.table}?${encodeURIComponent(config.key)}=in.(${filter})`,
      { method: "DELETE" }
    );
  }
}

async function saveSupabaseDb(db) {
  const previous = db.__supabaseSnapshot || {};
  const serialized = {};
  const upserts = [];
  const deletes = [];

  for (const config of SUPABASE_TABLES) {
    const rows = (db[config.field] || []).map(config.toRow);
    serialized[config.field] = rows;
    const before = previous[config.field] || {};
    const after = rowSnapshot(rows, config.key);
    const changedRows = rows.filter((row) => before[String(row[config.key])] !== JSON.stringify(row));
    const deletedKeys = Object.keys(before).filter((key) => !after[key]);
    if (changedRows.length) upserts.push([config, changedRows]);
    if (deletedKeys.length) deletes.push([config, deletedKeys]);
  }

  for (const [config, keys] of deletes.slice().reverse()) {
    await deleteSupabaseRows(config, keys);
  }
  for (const [config, rows] of upserts) {
    await upsertSupabaseRows(config, rows);
  }

  const normalizedRowsByField = Object.fromEntries(
    SUPABASE_TABLES.map((config) => [config.field, serialized[config.field].map(config.fromRow)])
  );
  attachSupabaseSnapshot(Object.assign(db, normalizeDb(normalizedRowsByField)));
}

async function saveSupabaseLegacyStateDb(db) {
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

async function loadSupabaseLegacyStateDb() {
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
    if (rollover.changed || anniversaryAccrual.changed || sessionsPruned) await saveSupabaseLegacyStateDb(db);
    return db;
  }

  const db = seedProductionDb();
  applyLeaveYearRollover(db);
  applyServiceAnniversaryAccrual(db);
  await saveSupabaseLegacyStateDb(db);
  return db;
}

function useSupabaseLegacyState() {
  return String(process.env.SUPABASE_DATA_MODE || "").toLowerCase() === "legacy_state";
}

async function loadDb() {
  if (isSupabaseEnabled()) {
    return useSupabaseLegacyState() ? loadSupabaseLegacyStateDb() : loadSupabaseDb();
  }

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
    if (useSupabaseLegacyState()) await saveSupabaseLegacyStateDb(db);
    else await saveSupabaseDb(db);
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
          medicalCertificate: request.medicalCertificate || null,
          excludedDates: Array.isArray(request.excludedDates) ? request.excludedDates : []
        }))
      : [],
    leaveAdjustments: Array.isArray(db.leaveAdjustments) ? db.leaveAdjustments.map(normalizeLeaveAdjustment) : [],
    medicalClaims: Array.isArray(db.medicalClaims) ? db.medicalClaims.map(normalizeClaim) : [],
    emails: Array.isArray(db.emails) ? db.emails : [],
    auditEvents: Array.isArray(db.auditEvents) ? db.auditEvents.map(normalizeAuditEvent) : [],
    sessions: Array.isArray(db.sessions) ? db.sessions : []
  };
}

function normalizeLeaveAdjustment(adjustment) {
  return {
    id: adjustment.id || id("adjust"),
    employeeId: adjustment.employeeId || null,
    actorId: adjustment.actorId || null,
    year: Number(adjustment.year || currentLeaveYear()),
    days: normalizeSignedLeaveDays(adjustment.days || 0, "Leave adjustment days"),
    reason: adjustment.reason || "",
    createdAt: adjustment.createdAt || nowIso()
  };
}

function normalizeAuditEvent(event) {
  return {
    id: event.id || id("audit"),
    createdAt: event.createdAt || nowIso(),
    actorId: event.actorId || null,
    actorName: event.actorName || "System",
    actorEmail: event.actorEmail || "",
    actorRole: event.actorRole || "system",
    action: event.action || "system.note",
    summary: event.summary || "",
    affectedUserId: event.affectedUserId || null,
    affectedUserName: event.affectedUserName || "",
    relatedType: event.relatedType || null,
    relatedId: event.relatedId || null,
    metadata: event.metadata && typeof event.metadata === "object" ? event.metadata : {}
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
    birthdayLeaveEntitlement: normalizeLeaveDays(user.birthdayLeaveEntitlement ?? 0, "Birthday leave"),
    leavePolicyYear: Number(user.leavePolicyYear || thisYear),
    leaveEntitlement: Number(user.leaveEntitlement || 0),
    medicalClaimLimit: Number(user.medicalClaimLimit ?? 500),
    medicalLeaveEntitlement: normalizeLeaveDays(
      user.medicalLeaveEntitlement ?? ANNUAL_MEDICAL_LEAVE_DAYS,
      "Medical leave entitlement"
    ),
    claimApproverId: user.claimApproverId ?? user.claimManagerId ?? user.claimApprover ?? user.managerId ?? null
  };
  if (user.annualLeaveEntitlement === undefined || user.annualLeaveEntitlement === null) {
    normalized.annualLeaveEntitlement = startingLeaveEntitlement;
  }
  if (!user.leaveEntitlement && user.leaveEntitlement !== 0) {
    normalized.leaveEntitlement = normalizeLeaveDays(
      normalized.annualLeaveEntitlement + normalized.carriedForwardLeave + normalized.birthdayLeaveEntitlement,
      "Leave entitlement"
    );
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
      const adjustmentDays = leaveAdjustmentTotal(db, user.id, balance.year);
      user.annualLeaveEntitlement = balance.baseEntitlement;
      user.carriedForwardLeave = balance.carriedForward;
      user.birthdayLeaveEntitlement = balance.birthdayLeave;
      user.leaveEntitlement = normalizeLeaveDays(balance.entitlement + adjustmentDays, "Leave entitlement");
      user.leavePolicyYear = balance.year;
      user.leaveRolloverAt = nowIso();
      processed.push({
        userId: user.id,
        year: balance.year,
        previousYear: balance.previousYear,
        carriedForward: balance.carriedForward,
        birthdayLeave: balance.birthdayLeave,
        annualLeaveEntitlement: balance.baseEntitlement,
        adjustmentDays,
        leaveEntitlement: user.leaveEntitlement
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
    const adjustmentDays = leaveAdjustmentTotal(db, user.id, Number(accrualDate.slice(0, 4)));
    const birthdayLeave = normalizeLeaveDays(user.birthdayLeaveEntitlement ?? 0, "Birthday leave");
    user.leaveEntitlement = normalizeLeaveDays(
      annualLeaveEntitlement + Number(user.carriedForwardLeave || 0) + birthdayLeave + adjustmentDays,
      "Leave entitlement"
    );
    user.leaveServiceAccrualAt = accrual.latestAnniversary || nowIso();
    processed.push({
      userId: user.id,
      asOfDate: accrualDate,
      anniversariesApplied: accrual.count,
      annualLeaveEntitlement,
      birthdayLeave,
      adjustmentDays,
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
    claimApproverId: null,
    leaveEntitlement: 0,
    startingLeaveEntitlement: 0,
    annualLeaveEntitlement: 0,
    carriedForwardLeave: 0,
    birthdayLeaveEntitlement: 0,
    leavePolicyYear: currentLeaveYear(),
    serviceStartDate: formatIsoDate(new Date()),
    medicalClaimLimit: 0,
    medicalLeaveEntitlement: ANNUAL_MEDICAL_LEAVE_DAYS,
    active: true,
    createdAt,
    updatedAt: createdAt,
    ...createPassword(adminPassword)
  };

  return {
    users: [admin],
    leaveRequests: [],
    leaveAdjustments: [],
    medicalClaims: [],
    sessions: [],
    auditEvents: [],
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
      claimApproverId: null,
      leaveEntitlement: 0,
      startingLeaveEntitlement: 0,
      annualLeaveEntitlement: 0,
      carriedForwardLeave: 0,
      birthdayLeaveEntitlement: 0,
      leavePolicyYear: currentLeaveYear(),
      serviceStartDate: "2026-01-01",
      medicalClaimLimit: 0,
      medicalLeaveEntitlement: ANNUAL_MEDICAL_LEAVE_DAYS,
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
      claimApproverId: adminId,
      leaveEntitlement: 18,
      startingLeaveEntitlement: 18,
      annualLeaveEntitlement: 18,
      carriedForwardLeave: 0,
      birthdayLeaveEntitlement: 0,
      leavePolicyYear: currentLeaveYear(),
      serviceStartDate: "2020-01-01",
      medicalClaimLimit: 500,
      medicalLeaveEntitlement: ANNUAL_MEDICAL_LEAVE_DAYS,
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
      claimApproverId: managerId,
      leaveEntitlement: 16,
      startingLeaveEntitlement: 16,
      annualLeaveEntitlement: 16,
      carriedForwardLeave: 0,
      birthdayLeaveEntitlement: 0,
      leavePolicyYear: currentLeaveYear(),
      serviceStartDate: "2024-01-01",
      medicalClaimLimit: 500,
      medicalLeaveEntitlement: ANNUAL_MEDICAL_LEAVE_DAYS,
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
      claimApproverId: managerId,
      leaveEntitlement: 15,
      startingLeaveEntitlement: 15,
      annualLeaveEntitlement: 15,
      carriedForwardLeave: 0,
      birthdayLeaveEntitlement: 0,
      leavePolicyYear: currentLeaveYear(),
      serviceStartDate: "2025-01-01",
      medicalClaimLimit: 500,
      medicalLeaveEntitlement: ANNUAL_MEDICAL_LEAVE_DAYS,
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
    leaveAdjustments: [],
    medicalClaims: [medicalClaim],
    sessions: [],
    auditEvents: [],
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

function pruneExpiredSessions(db, now = Date.now()) {
  if (!Array.isArray(db.sessions)) db.sessions = [];
  const memoryRemoved = pruneMemorySessions(now);
  const before = db.sessions.length;
  db.sessions = db.sessions.filter((session) => Number(session.expiresAt) >= now);
  return before !== db.sessions.length || memoryRemoved > 0;
}

function getAuthenticatedUser(req, db) {
  pruneMemorySessions();
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

function auditActor(actor) {
  if (!actor) {
    return {
      actorId: null,
      actorName: "System",
      actorEmail: "",
      actorRole: "system"
    };
  }

  return {
    actorId: actor.id || null,
    actorName: actor.name || "Unknown user",
    actorEmail: actor.email || "",
    actorRole: actor.role || "employee"
  };
}

function redactAuditMetadata(value) {
  if (Array.isArray(value)) return value.map(redactAuditMetadata);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      /password|passcode|hash|salt|secret|token/i.test(key)
        ? "[redacted]"
        : redactAuditMetadata(item)
    ])
  );
}

function addAuditEvent(db, actor, payload) {
  if (!Array.isArray(db.auditEvents)) db.auditEvents = [];
  const affectedUser = payload.affectedUserId ? getUser(db, payload.affectedUserId) : null;
  const event = normalizeAuditEvent({
    id: id("audit"),
    createdAt: nowIso(),
    ...auditActor(actor),
    action: payload.action,
    summary: payload.summary,
    affectedUserId: payload.affectedUserId || null,
    affectedUserName: affectedUser?.name || payload.affectedUserName || "",
    relatedType: payload.relatedType || null,
    relatedId: payload.relatedId || null,
    metadata: redactAuditMetadata(payload.metadata || {})
  });

  db.auditEvents.unshift(event);
  if (db.auditEvents.length > AUDIT_LOG_MAX_EVENTS) {
    db.auditEvents.length = AUDIT_LOG_MAX_EVENTS;
  }
  return event;
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
    deliveryError: null,
    providerId: null
  };
}

function queuedEmailDeliveries(db) {
  if (!Object.prototype.hasOwnProperty.call(db, "__queuedEmailDeliveries")) {
    Object.defineProperty(db, "__queuedEmailDeliveries", {
      value: [],
      enumerable: false,
      configurable: true,
      writable: true
    });
  }
  return db.__queuedEmailDeliveries;
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
  const calendarStatus = status === "CANCELLED"
    ? "CANCELLED"
    : status === "CONFIRMED"
      ? "CONFIRMED"
      : "TENTATIVE";
  const description = [
    calendarStatus === "CANCELLED"
      ? `${employee.name}'s leave from ${request.startDate} to ${request.endDate} has been cancelled.`
      : `${employee.name} is on leave from ${request.startDate} to ${request.endDate}.`,
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
    `METHOD:${calendarStatus === "CANCELLED" ? "CANCEL" : "PUBLISH"}`,
    "BEGIN:VEVENT",
    `UID:${request.id}@cls-leave-claims`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}`,
    `DTSTART;VALUE=DATE:${isoDateToIcs(request.startDate)}`,
    `DTEND;VALUE=DATE:${isoDateToIcs(addDays(request.endDate, 1))}`,
    `SUMMARY:${escapeIcsText(calendarStatus === "CANCELLED" ? `${employee.name} leave cancelled` : `${employee.name} on leave`)}`,
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

function addEmail(db, payload, options = {}) {
  if (!Array.isArray(db.emails)) db.emails = [];
  const email = makeEmail(db.users, payload);
  db.emails.unshift(email);
  queuedEmailDeliveries(db).push({
    emailId: email.id,
    options
  });
  return email;
}

async function deliverQueuedEmails(db) {
  const queue = queuedEmailDeliveries(db).splice(0);
  const result = {
    changed: false,
    delivered: 0,
    failed: 0,
    skipped: 0
  };

  for (const delivery of queue) {
    const email = db.emails.find((item) => item.id === delivery.emailId);
    if (!email) {
      result.skipped += 1;
      continue;
    }

    try {
      const deliveryResult = await deliverEmail(email, delivery.options);
      email.delivered = Boolean(deliveryResult.delivered);
      email.deliveredAt = deliveryResult.delivered ? nowIso() : null;
      email.deliveryError = null;
      email.providerId = deliveryResult.providerId || null;
      if (deliveryResult.delivered) {
        result.delivered += 1;
        console.log(`[Email delivery] Delivered ${email.type} to ${email.to}.`);
      } else {
        result.skipped += 1;
      }
    } catch (error) {
      email.delivered = false;
      email.deliveredAt = null;
      email.deliveryError = error.message;
      result.failed += 1;
      console.warn(`[Email delivery] ${error.message}`);
    }
    result.changed = true;
  }

  return result;
}

async function saveDbAndDeliverQueuedEmails(db) {
  await saveDb(db);
  const deliveryResult = await deliverQueuedEmails(db);
  if (deliveryResult.changed) {
    await saveDb(db);
  }
  return deliveryResult;
}

function safeReceiptName(name) {
  const base = path.basename(String(name || "receipt"));
  return base.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "receipt";
}

function encodedStoragePath(storedName) {
  return String(storedName || "")
    .split("/")
    .map(encodeURIComponent)
    .join("/");
}

function storageObjectEndpoint(bucket, storedName, action = "object") {
  return `/storage/v1/${action}/${encodeURIComponent(bucket)}/${encodedStoragePath(storedName)}`;
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
  let buffer = Buffer.isBuffer(receipt.buffer) ? receipt.buffer : null;
  if (!buffer) {
    const match = String(receipt.dataUrl || "").match(/^data:([^;]+);base64,(.+)$/);
    if (!match) {
      throw new Error("Receipt upload was not in the expected format.");
    }
    buffer = Buffer.from(match[2], "base64");
  }
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

function receiptUploadMetadata(body) {
  const originalName = safeReceiptName(body.name);
  const size = Number(body.size || 0);
  const declaredMimeType = String(body.type || "").toLowerCase();
  const extension = receiptExtension(originalName);
  const extensionMimeType = RECEIPT_EXTENSION_MIME_TYPES.get(extension);

  if (!originalName) throw new Error("Receipt file name is required.");
  if (!Number.isFinite(size) || size <= 0) throw new Error("Receipt upload is empty.");
  if (size > MAX_RECEIPT_BYTES) throw new Error("Receipt upload must be 5 MB or smaller.");
  if (!RECEIPT_MIME_TYPES.has(declaredMimeType) && !extensionMimeType) {
    throw new Error(RECEIPT_TYPE_ERROR);
  }

  const mimeType = RECEIPT_MIME_TYPES.has(declaredMimeType) ? declaredMimeType : extensionMimeType;
  return { originalName, size, mimeType, extension };
}

function resolveSupabaseSignedUrl(value, token, uploadEndpoint) {
  const config = supabaseConfig();
  if (!config) throw new Error("Supabase is not configured.");

  if (value) {
    if (/^https?:\/\//i.test(value)) return value;
    if (value.startsWith("/storage/v1/")) return `${config.url}${value}`;
    if (value.startsWith("/")) return `${config.url}/storage/v1${value}`;
    return `${config.url}/storage/v1/${value.replace(/^\/+/, "")}`;
  }

  if (token) {
    return `${config.url}${uploadEndpoint}?token=${encodeURIComponent(token)}`;
  }

  throw new Error("Supabase did not return a signed receipt upload URL.");
}

async function createReceiptUploadUrl(user, body) {
  if (!isSupabaseEnabled()) {
    return { direct: false };
  }

  const metadata = receiptUploadMetadata(body);
  const extension = RECEIPT_EXTENSION_MIME_TYPES.get(metadata.extension) === metadata.mimeType
    ? metadata.extension
    : RECEIPT_MIME_EXTENSIONS.get(metadata.mimeType) || metadata.extension || ".receipt";
  const storedName = `pending/${user.id}/${id("receipt")}${extension}`;
  const uploadEndpoint = storageObjectEndpoint(SUPABASE_RECEIPT_BUCKET, storedName, "object/upload/sign");
  const response = await supabaseRequest(uploadEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expiresIn: 600 })
  });
  const payload = await response.json();
  const uploadData = payload.data || payload;
  const signedUrl = resolveSupabaseSignedUrl(
    uploadData.signedURL || uploadData.signedUrl || uploadData.url,
    uploadData.token,
    uploadEndpoint
  );

  return {
    direct: true,
    storage: "supabase",
    bucket: SUPABASE_RECEIPT_BUCKET,
    originalName: metadata.originalName,
    mimeType: metadata.mimeType,
    size: metadata.size,
    storedName,
    signedUrl,
    method: "PUT"
  };
}

async function createMedicalCertificateUploadUrl(user, body) {
  if (!isSupabaseEnabled()) {
    return { direct: false };
  }

  const metadata = receiptUploadMetadata(body);
  const extension = RECEIPT_EXTENSION_MIME_TYPES.get(metadata.extension) === metadata.mimeType
    ? metadata.extension
    : RECEIPT_MIME_EXTENSIONS.get(metadata.mimeType) || metadata.extension || ".receipt";
  const storedName = `medical-certificates/${user.id}/${id("mc")}${extension}`;
  const uploadEndpoint = storageObjectEndpoint(SUPABASE_RECEIPT_BUCKET, storedName, "object/upload/sign");
  const response = await supabaseRequest(uploadEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expiresIn: 600 })
  });
  const payload = await response.json();
  const uploadData = payload.data || payload;
  const signedUrl = resolveSupabaseSignedUrl(
    uploadData.signedURL || uploadData.signedUrl || uploadData.url,
    uploadData.token,
    uploadEndpoint
  );

  return {
    direct: true,
    storage: "supabase",
    bucket: SUPABASE_RECEIPT_BUCKET,
    originalName: metadata.originalName,
    mimeType: metadata.mimeType,
    size: metadata.size,
    storedName,
    signedUrl,
    method: "PUT"
  };
}

async function receiptFromSupabaseUpload(user, upload) {
  if (!upload || typeof upload !== "object") {
    throw new Error("Receipt upload details are required.");
  }

  const storedName = String(upload.storedName || "");
  const expectedPrefix = `pending/${user.id}/`;
  if (!storedName.startsWith(expectedPrefix)) {
    throw new Error("Receipt upload path is invalid.");
  }

  const bucket = String(upload.bucket || SUPABASE_RECEIPT_BUCKET);
  if (bucket !== SUPABASE_RECEIPT_BUCKET) {
    throw new Error("Receipt upload bucket is invalid.");
  }

  const originalName = safeReceiptName(upload.originalName);
  const response = await supabaseRequest(storageObjectEndpoint(bucket, storedName));
  const buffer = Buffer.from(await response.arrayBuffer());
  const parsed = parseReceipt({ name: originalName, buffer });

  return {
    storage: "supabase",
    bucket,
    originalName: parsed.originalName,
    mimeType: parsed.mimeType,
    size: parsed.buffer.length,
    storedName,
    uploadedAt: nowIso()
  };
}

async function medicalCertificateFromSupabaseUpload(user, upload) {
  if (!upload || typeof upload !== "object") {
    throw new Error("Medical certificate upload details are required.");
  }

  const storedName = String(upload.storedName || "");
  const expectedPrefix = `medical-certificates/${user.id}/`;
  if (!storedName.startsWith(expectedPrefix)) {
    throw new Error("Medical certificate upload path is invalid.");
  }

  const bucket = String(upload.bucket || SUPABASE_RECEIPT_BUCKET);
  if (bucket !== SUPABASE_RECEIPT_BUCKET) {
    throw new Error("Medical certificate upload bucket is invalid.");
  }

  const originalName = safeReceiptName(upload.originalName);
  const response = await supabaseRequest(storageObjectEndpoint(bucket, storedName));
  const buffer = Buffer.from(await response.arrayBuffer());
  const parsed = parseReceipt({ name: originalName, buffer });

  return {
    storage: "supabase",
    bucket,
    originalName: parsed.originalName,
    mimeType: parsed.mimeType,
    size: parsed.buffer.length,
    storedName,
    uploadedAt: nowIso()
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
      storageObjectEndpoint(SUPABASE_RECEIPT_BUCKET, storedName),
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

async function saveMedicalCertificateAttachment(requestId, certificate) {
  const parsed = parseReceipt(certificate);
  const originalExtension = receiptExtension(parsed.originalName);
  const extension = RECEIPT_EXTENSION_MIME_TYPES.get(originalExtension) === parsed.mimeType
    ? originalExtension
    : RECEIPT_MIME_EXTENSIONS.get(parsed.mimeType);
  const storedName = isSupabaseEnabled()
    ? `medical-certificates/${requestId}${extension || ".receipt"}`
    : `medical-certificate-${requestId}${extension || ".receipt"}`;

  if (isSupabaseEnabled()) {
    await supabaseRequest(
      storageObjectEndpoint(SUPABASE_RECEIPT_BUCKET, storedName),
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
    const response = await supabaseRequest(storageObjectEndpoint(claim.receipt.bucket || SUPABASE_RECEIPT_BUCKET, storedName));
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  return fs.readFile(safeLocalReceiptPath(claim.receipt.storedName));
}

async function readMedicalCertificateAttachment(request) {
  if (request.medicalCertificate?.storage === "supabase") {
    const storedName = String(request.medicalCertificate.storedName || "");
    const response = await supabaseRequest(storageObjectEndpoint(
      request.medicalCertificate.bucket || SUPABASE_RECEIPT_BUCKET,
      storedName
    ));
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  return fs.readFile(safeLocalReceiptPath(request.medicalCertificate.storedName));
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

function visibleEmails(db, user) {
  if (canAdmin(user)) return db.emails;
  return db.emails.filter((email) => email.recipientId === user.id);
}

function visibleUsers(db, user) {
  return db.users.filter((employee) => canSeeEmployee(user, employee)).map(publicUser);
}

function historyYear(kind, item) {
  if (kind === "leave") {
    return String(item.leaveYear || item.startDate?.slice(0, 4) || currentLeaveYear());
  }
  return String(item.claimDate?.slice(0, 4) || currentLeaveYear());
}

function historyYears(kind, items) {
  const years = new Set([String(currentLeaveYear())]);
  items.forEach((item) => years.add(historyYear(kind, item)));
  return [...years].filter(Boolean).sort((a, b) => Number(b) - Number(a));
}

function claimHistoryCategory(item) {
  return item.claimType === "general" ? "Others" : "Medical";
}

function userSearchText(db, userId) {
  const user = getUser(db, userId);
  if (!user) return "unassigned";
  return `${user.name} ${user.email} ${user.role}`;
}

function auditValue(value) {
  return value === null || value === undefined ? "" : String(value);
}

function auditUserName(db, userId) {
  if (!userId) return "Unassigned";
  return getUser(db, userId)?.name || "Unknown";
}

function employeeChangeSet(db, before, after) {
  if (!before || !after) return { labels: [], changes: [] };

  const fields = [
    { key: "name", label: "name" },
    { key: "email", label: "email" },
    { key: "role", label: "role" },
    { key: "serviceStartDate", label: "service start" },
    { key: "annualLeaveEntitlement", label: "annual leave days" },
    { key: "leaveEntitlement", label: "total leave entitlement" },
    { key: "birthdayLeaveEntitlement", label: "birthday leave" },
    { key: "medicalLeaveEntitlement", label: "medical leave entitlement" },
    { key: "medicalClaimLimit", label: "medical claim limit" },
    { key: "active", label: "active status" }
  ];
  const changes = fields
    .filter((field) => auditValue(before[field.key]) !== auditValue(after[field.key]))
    .map((field) => ({
      field: field.key,
      label: field.label,
      from: before[field.key],
      to: after[field.key]
    }));

  if (auditValue(before.managerId) !== auditValue(after.managerId)) {
    changes.push({
      field: "managerId",
      label: "direct report",
      from: auditUserName(db, before.managerId),
      to: auditUserName(db, after.managerId)
    });
  }

  if (auditValue(before.claimApproverId) !== auditValue(after.claimApproverId)) {
    changes.push({
      field: "claimApproverId",
      label: "claims approver",
      from: auditUserName(db, before.claimApproverId),
      to: auditUserName(db, after.claimApproverId)
    });
  }

  return {
    labels: changes.map((change) => change.label),
    changes
  };
}

function addEmployeeUpdateAudit(db, actor, before, employee) {
  const after = publicUser(employee);
  const changeSet = employeeChangeSet(db, before, after);
  if (!changeSet.changes.length) return null;
  return addAuditEvent(db, actor, {
    action: "employee.updated",
    affectedUserId: employee.id,
    relatedType: "employee",
    relatedId: employee.id,
    summary: `Updated ${employee.name}: ${changeSet.labels.join(", ")}`,
    metadata: { changes: changeSet.changes }
  });
}

function addMaintenanceAuditEvents(db, actor, result) {
  let added = 0;

  if (result.rollover?.changed) {
    const count = result.rollover.processed?.length || 0;
    addAuditEvent(db, actor, {
      action: "maintenance.leave_rollover",
      relatedType: "maintenance",
      summary: `Leave rollover updated ${count} employee record${count === 1 ? "" : "s"}.`,
      metadata: {
        year: result.rollover.year,
        processedCount: count,
        processed: result.rollover.processed || []
      }
    });
    added += 1;
  }

  if (result.anniversaryAccrual?.changed) {
    const count = result.anniversaryAccrual.processed?.length || 0;
    addAuditEvent(db, actor, {
      action: "maintenance.service_anniversary_accrual",
      relatedType: "maintenance",
      summary: `Service anniversary leave accrual updated ${count} employee record${count === 1 ? "" : "s"}.`,
      metadata: {
        asOfDate: result.anniversaryAccrual.asOfDate,
        processedCount: count,
        processed: result.anniversaryAccrual.processed || []
      }
    });
    added += 1;
  }

  if (result.receiptRetention?.changed) {
    addAuditEvent(db, actor, {
      action: "maintenance.receipt_retention",
      relatedType: "maintenance",
      summary: `Receipt retention removed ${result.receiptRetention.deleted} old receipt${result.receiptRetention.deleted === 1 ? "" : "s"}.`,
      metadata: {
        cutoff: result.receiptRetention.cutoff,
        retentionYears: result.receiptRetention.retentionYears,
        deleted: result.receiptRetention.deleted,
        failed: result.receiptRetention.failed,
        errors: result.receiptRetention.errors || []
      }
    });
    added += 1;
  }

  return added;
}

function leaveAdjustmentTotal(db, employeeId, year) {
  return (Array.isArray(db.leaveAdjustments) ? db.leaveAdjustments : [])
    .filter((adjustment) => adjustment.employeeId === employeeId && Number(adjustment.year) === Number(year))
    .reduce((total, adjustment) => total + Number(adjustment.days || 0), 0);
}

function historySearchText(db, kind, item) {
  const shared = [
    userSearchText(db, item.employeeId),
    userSearchText(db, item.managerId),
    item.status,
    decisionLabel(item.status)
  ];

  if (kind === "leave") {
    shared.push(item.type, item.reason, item.startDate, item.endDate, item.days);
  } else {
    shared.push(
      claimHistoryCategory(item),
      item.category,
      item.provider,
      item.description,
      item.claimDate,
      item.amount,
      item.receipt?.originalName
    );
  }

  return shared.join(" ").toLowerCase();
}

function newestHistoryTime(kind, item) {
  const fallback = kind === "leave" ? item.startDate : item.claimDate;
  return new Date(item.decidedAt || item.createdAt || fallback || 0).getTime() || 0;
}

function pageParams(searchParams, defaultLimit) {
  const offset = Math.max(0, Number.parseInt(searchParams.get("offset") || "0", 10) || 0);
  const rawLimit = Number.parseInt(searchParams.get("limit") || String(defaultLimit), 10) || defaultLimit;
  const limit = Math.max(1, Math.min(rawLimit, HISTORY_MAX_LIMIT));
  return { offset, limit };
}

function historyPage(db, user, kind, searchParams) {
  const status = searchParams.get("status") || "all";
  const year = searchParams.get("year") || "all";
  const category = searchParams.get("category") || "all";
  const query = String(searchParams.get("query") || "").trim().toLowerCase();
  const { offset, limit } = pageParams(searchParams, HISTORY_DEFAULT_LIMIT);
  const visibleItems = kind === "leave" ? visibleLeaveRequests(db, user) : visibleMedicalClaims(db, user);
  const decidedItems = visibleItems.filter((item) => item.status !== "pending");

  const filtered = decidedItems
    .filter((item) => {
      if (status !== "all" && item.status !== status) return false;
      if (year !== "all" && historyYear(kind, item) !== year) return false;
      if (kind === "claim" && category !== "all" && claimHistoryCategory(item) !== category) return false;
      if (query && !historySearchText(db, kind, item).includes(query)) return false;
      return true;
    })
    .sort((a, b) => newestHistoryTime(kind, b) - newestHistoryTime(kind, a));

  return {
    items: filtered.slice(offset, offset + limit),
    total: filtered.length,
    offset,
    limit,
    hasMore: offset + limit < filtered.length,
    years: historyYears(kind, decidedItems)
  };
}

function emailPage(db, user, searchParams) {
  const { offset, limit } = pageParams(searchParams, MAIL_DEFAULT_LIMIT);
  const emails = visibleEmails(db, user)
    .slice()
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

  return {
    items: emails.slice(offset, offset + limit),
    total: emails.length,
    offset,
    limit,
    hasMore: offset + limit < emails.length
  };
}

function auditSearchText(event) {
  return [
    event.createdAt,
    event.action,
    event.summary,
    event.actorName,
    event.actorEmail,
    event.actorRole,
    event.affectedUserName,
    event.relatedType,
    event.relatedId
  ].join(" ").toLowerCase();
}

function auditPage(db, user, searchParams) {
  requireAdmin(user);
  const query = String(searchParams.get("query") || "").trim().toLowerCase();
  const { offset, limit } = pageParams(searchParams, AUDIT_DEFAULT_LIMIT);
  const events = (Array.isArray(db.auditEvents) ? db.auditEvents : [])
    .filter((event) => !query || auditSearchText(event).includes(query))
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

  return {
    items: events.slice(offset, offset + limit),
    total: events.length,
    offset,
    limit,
    hasMore: offset + limit < events.length
  };
}

function dashboard(db, user) {
  const employees = db.users.map(publicUser);
  const userById = Object.fromEntries(employees.map((employee) => [employee.id, employee]));
  const leaveRequests = visibleLeaveRequests(db, user);
  const medicalClaims = visibleMedicalClaims(db, user);
  const leaveYear = Number(user.leavePolicyYear || currentLeaveYear());
  const currentLeaveAdjustments = leaveAdjustmentTotal(db, user.id, leaveYear);
  const pendingLeaveRequests = leaveRequests.filter((request) => request.status === "pending");
  const pendingMedicalClaims = medicalClaims.filter((claim) => claim.status === "pending");
  const recentEmails = visibleEmails(db, user)
    .slice()
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
    .slice(0, 4);

  return {
    user: publicUser(user),
    users: visibleUsers(db, user),
    allEmployees: canAdmin(user) ? employees : visibleUsers(db, user),
    userById,
    leaveSummary: leaveSummary(user, db.leaveRequests, {
      adjustments: currentLeaveAdjustments,
      birthdayLeave: user.birthdayLeaveEntitlement
    }),
    medicalLeaveSummary: medicalLeaveSummary(user, db.leaveRequests),
    medicalClaimSummary: medicalClaimSummary(user, db.medicalClaims),
    generalClaimSummary: generalClaimSummary(user, db.medicalClaims),
    receiptStorageSummary: canAdmin(user) ? receiptStorageSummary(db) : null,
    leaveAdjustments: canAdmin(user) ? (db.leaveAdjustments || []).slice(0, 10) : [],
    leaveRequests: pendingLeaveRequests,
    medicalClaims: pendingMedicalClaims,
    emails: recentEmails,
    teamMembers: db.users
      .filter((employee) => employee.managerId === user.id)
      .map(publicUser),
    counts: {
      pendingLeave: pendingLeaveRequests.filter(
        (request) => request.status === "pending" && canReview(user, request)
      ).length,
      pendingClaims: pendingMedicalClaims.filter(
        (claim) => claim.status === "pending" && canReview(user, claim)
      ).length
    }
  };
}

function dashboardPatch(db, user) {
  const leaveYear = Number(user.leavePolicyYear || currentLeaveYear());
  const currentLeaveAdjustments = leaveAdjustmentTotal(db, user.id, leaveYear);
  const pendingLeaveRequests = visibleLeaveRequests(db, user).filter((request) => request.status === "pending");
  const pendingMedicalClaims = visibleMedicalClaims(db, user).filter((claim) => claim.status === "pending");
  const recentEmails = visibleEmails(db, user)
    .slice()
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
    .slice(0, 4);

  return {
    user: publicUser(user),
    leaveSummary: leaveSummary(user, db.leaveRequests, {
      adjustments: currentLeaveAdjustments,
      birthdayLeave: user.birthdayLeaveEntitlement
    }),
    medicalLeaveSummary: medicalLeaveSummary(user, db.leaveRequests),
    medicalClaimSummary: medicalClaimSummary(user, db.medicalClaims),
    generalClaimSummary: generalClaimSummary(user, db.medicalClaims),
    receiptStorageSummary: canAdmin(user) ? receiptStorageSummary(db) : null,
    leaveAdjustments: canAdmin(user) ? (db.leaveAdjustments || []).slice(0, 10) : [],
    emails: recentEmails,
    counts: {
      pendingLeave: pendingLeaveRequests.filter(
        (request) => request.status === "pending" && canReview(user, request)
      ).length,
      pendingClaims: pendingMedicalClaims.filter(
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
  const claimApproverId = body.claimApproverId || managerId || null;
  const serviceStartDate = String(body.serviceStartDate || formatIsoDate(new Date()));
  assertIsoDate(serviceStartDate, "Service start date");
  const initialAnnualLeaveDays = normalizeLeaveDays(
    body.startingLeaveEntitlement ?? body.leaveEntitlement ?? 0,
    "Initial annual leave days"
  );
  const medicalClaimLimit = Number(body.medicalClaimLimit ?? 500);
  const password = assertPassword(body.password || "welcome123", "Temporary password");

  if (!name) throw new Error("Employee name is required.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("A valid email is required.");
  if (!["admin", "manager", "employee"].includes(role)) throw new Error("Role is invalid.");
  if (db.users.some((user) => user.email.toLowerCase() === email)) {
    throw new Error("An employee with that email already exists.");
  }
  if (managerId && !getUser(db, managerId)) {
    throw new Error("Direct report approver was not found.");
  }
  if (claimApproverId && !getUser(db, claimApproverId)) {
    throw new Error("Claims approver was not found.");
  }
  if (!Number.isFinite(medicalClaimLimit) || medicalClaimLimit < 0) {
    throw new Error("Medical claim limit must be 0 or more.");
  }

  const createdAt = nowIso();
  const leavePolicyYear = currentLeaveYear();
  const annualLeaveEntitlement = initialAnnualLeaveDays;
  const birthdayLeaveEntitlement = 0;
  const employee = {
    id: id("usr"),
    name,
    email,
    role,
    managerId,
    claimApproverId,
    serviceStartDate,
    startingLeaveEntitlement: initialAnnualLeaveDays,
    annualLeaveEntitlement,
    carriedForwardLeave: 0,
    birthdayLeaveEntitlement,
    leavePolicyYear,
    leaveEntitlement: normalizeLeaveDays(annualLeaveEntitlement + birthdayLeaveEntitlement, "Leave entitlement"),
    leaveServiceAccrualAt: createdAt,
    medicalClaimLimit,
    medicalLeaveEntitlement: ANNUAL_MEDICAL_LEAVE_DAYS,
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
  if (body.claimApproverId !== undefined) {
    const claimApproverId = body.claimApproverId || null;
    if (claimApproverId === employee.id) throw new Error("An employee cannot approve their own claims.");
    if (claimApproverId && !getUser(db, claimApproverId)) throw new Error("Claims approver was not found.");
    employee.claimApproverId = claimApproverId;
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
    const leaveYear = Number(employee.leavePolicyYear || currentLeaveYear());
    const adjustmentDays = leaveAdjustmentTotal(db, employee.id, leaveYear);
    const birthdayLeave = normalizeLeaveDays(employee.birthdayLeaveEntitlement ?? 0, "Birthday leave");
    employee.startingLeaveEntitlement = initialAnnualLeaveDays;
    employee.annualLeaveEntitlement = initialAnnualLeaveDays;
    employee.leaveEntitlement = normalizeLeaveDays(
      initialAnnualLeaveDays + Number(employee.carriedForwardLeave || 0) + birthdayLeave + adjustmentDays,
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
  if (body.medicalLeaveEntitlement !== undefined) {
    employee.medicalLeaveEntitlement = normalizeLeaveDays(
      body.medicalLeaveEntitlement,
      "Medical leave entitlement"
    );
  }
  if (body.active !== undefined) {
    employee.active = Boolean(body.active);
  }
  if (body.password) {
    setUserPassword(employee, body.password, "Temporary password");
  }
  employee.updatedAt = nowIso();

  return employee;
}

function resetEmployeePassword(db, employeeId, body) {
  const employee = getUser(db, employeeId);
  if (!employee) {
    const error = new Error("Employee was not found.");
    error.status = 404;
    throw error;
  }

  const temporaryPassword = assertPassword(body.password, "Temporary password");
  setUserPassword(employee, temporaryPassword, "Temporary password");
  return { employee, temporaryPassword };
}

function updateEmployees(db, body) {
  const updates = Array.isArray(body.employees) ? body.employees : null;
  if (!updates) throw new Error("Employee updates are required.");
  if (!updates.length) throw new Error("At least one employee update is required.");

  const seen = new Set();
  return updates.map((update) => {
    if (!update || typeof update !== "object") {
      throw new Error("Each employee update must include employee details.");
    }

    const employeeId = String(update.id || "").trim();
    if (!employeeId) throw new Error("Employee ID is required for each update.");
    if (seen.has(employeeId)) throw new Error("Each employee can only appear once in Save All.");
    seen.add(employeeId);

    const { id: _id, ...fields } = update;
    return updateEmployee(db, employeeId, fields);
  });
}

function normalizeLeaveAdjustmentAmount(value) {
  const days = normalizeLeaveDays(value, "Adjustment days");
  if (days <= 0) throw new Error("Adjustment days must be greater than 0.");
  if (!Number.isInteger(days * 2)) {
    throw new Error("Adjustment days must be in half-day increments.");
  }
  return days;
}

function createLeaveAdjustment(db, actor, body) {
  const employeeId = String(body.employeeId || "").trim();
  const employee = getUser(db, employeeId);
  if (!employee) {
    const error = new Error("Employee was not found.");
    error.status = 404;
    throw error;
  }

  const direction = body.direction === "deduct" ? "deduct" : "add";
  const amount = normalizeLeaveAdjustmentAmount(body.days);
  const days = normalizeSignedLeaveDays(direction === "deduct" ? -amount : amount, "Adjustment days");
  const reason = String(body.reason || "").trim();
  if (!reason) throw new Error("Adjustment reason is required.");

  const year = Number(employee.leavePolicyYear || currentLeaveYear());
  const summary = leaveSummary(employee, db.leaveRequests, {
    year,
    adjustments: leaveAdjustmentTotal(db, employee.id, year)
  });
  if (days < 0 && summary.available + days < 0) {
    throw new Error(`This deduction would reduce ${employee.name}'s available leave below 0.`);
  }

  const createdAt = nowIso();
  const currentEntitlement = normalizeLeaveDays(employee.leaveEntitlement ?? 0, "Leave entitlement");
  employee.leaveEntitlement = normalizeLeaveDays(currentEntitlement + days, "Leave entitlement");
  employee.updatedAt = createdAt;
  const adjustment = {
    id: id("adjust"),
    employeeId: employee.id,
    actorId: actor.id,
    year,
    days,
    reason,
    createdAt
  };
  if (!Array.isArray(db.leaveAdjustments)) db.leaveAdjustments = [];
  db.leaveAdjustments.unshift(adjustment);

  addAuditEvent(db, actor, {
    action: days > 0 ? "leave.adjustment_added" : "leave.adjustment_deducted",
    affectedUserId: employee.id,
    relatedType: "leave_adjustment",
    relatedId: adjustment.id,
    summary: `${actor.name} ${days > 0 ? "added" : "deducted"} ${Math.abs(days)} leave day${Math.abs(days) === 1 ? "" : "s"} for ${employee.name}.`,
    metadata: {
      days,
      year,
      reason,
      previousEntitlement: currentEntitlement,
      newEntitlement: employee.leaveEntitlement
    }
  });

  return adjustment;
}

async function createLeaveRequest(db, user, body) {
  if (!user.managerId) {
    throw new Error("No Direct Report / approver has been assigned to your profile yet.");
  }

  const type = String(body.type || "Annual Leave").trim();
  const isMedicalLeave = isMedicalLeaveType(type);
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

  if (days <= 0) {
    throw new Error("This date range does not deduct any leave because it only covers weekends or Singapore public holidays.");
  }
  if (isMedicalLeave) {
    const summary = medicalLeaveSummary(user, db.leaveRequests, { year: leaveYear });
    if (days > summary.unreserved) {
      throw new Error(`This medical leave request needs ${days} days, but only ${summary.unreserved} days are available after approved and pending medical leave.`);
    }
    if (!body.medicalCertificateUpload && !body.medicalCertificate) {
      throw new Error("A Medical Certificate attachment is required for Medical Leave.");
    }
  } else {
    const summary = leaveSummary(user, db.leaveRequests, { year: leaveYear });
    if (days > summary.available) {
      throw new Error(`This request needs ${days} days, but only ${summary.available} days are available.`);
    }
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
    medicalCertificate: null,
    status: "pending",
    decisionNote: "",
    createdAt,
    updatedAt: createdAt,
    decidedAt: null,
    decidedBy: null
  };

  if (isMedicalLeave) {
    request.medicalCertificate = body.medicalCertificateUpload
      ? await medicalCertificateFromSupabaseUpload(user, body.medicalCertificateUpload)
      : await saveMedicalCertificateAttachment(request.id, body.medicalCertificate);
  }

  db.leaveRequests.unshift(request);
  await addEmail(db, {
    recipientId: user.managerId,
    type: "leave_submitted",
    subject: `Leave request pending approval: ${user.name}`,
    body: [
      `${user.name} has applied for ${days} deductible working day(s) of ${type} from ${startDate} to ${endDate}.`,
      isMedicalLeave ? "A Medical Certificate has been uploaded in CLS Leave & Claims for your review." : "",
      "Please review the leave request in CLS Leave & Claims.",
      `Use the attached calendar file (${user.name} on leave) to add this leave period to your calendar.`
    ].filter(Boolean).join("\n\n"),
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

async function cancelLeaveRequest(db, user, requestId, body = {}) {
  const request = db.leaveRequests.find((item) => item.id === requestId);
  if (!request) {
    const error = new Error("Leave request was not found.");
    error.status = 404;
    throw error;
  }
  if (request.employeeId !== user.id) {
    const error = new Error("Only the leave applicant can cancel this leave request.");
    error.status = 403;
    throw error;
  }
  if (!["pending", "approved"].includes(request.status)) {
    throw new Error("Only pending or approved leave requests can be cancelled.");
  }

  const previousStatus = request.status;
  const cancelledAt = nowIso();
  request.status = "cancelled";
  request.cancellationNote = String(body.reason || body.cancellationNote || "").trim();
  request.cancelledAt = cancelledAt;
  request.cancelledBy = user.id;
  request.updatedAt = cancelledAt;

  const manager = getUser(db, request.managerId);
  const managerBody = [
    `${user.name} has cancelled ${previousStatus === "approved" ? "an approved" : "a pending"} leave request from ${request.startDate} to ${request.endDate}.`,
    previousStatus === "approved"
      ? "Use the attached calendar file to remove this leave period from your calendar."
      : "No approval action is needed. Use the attached calendar file to remove the tentative leave period from your calendar."
  ].join("\n\n");

  await addEmail(db, {
    recipientId: request.managerId,
    type: "leave_cancelled",
    subject: `Leave request cancelled: ${user.name}`,
    body: managerBody,
    relatedId: request.id
  }, {
    attachments: manager
      ? [
          makeLeaveCalendarAttachment({
            request,
            employee: user,
            reviewer: manager,
            status: "CANCELLED"
          })
        ]
      : []
  });

  if (previousStatus === "approved") {
    await addEmail(db, {
      recipientId: user.id,
      type: "leave_cancelled_confirmation",
      subject: "Leave request cancelled",
      body: [
        `Your approved leave request from ${request.startDate} to ${request.endDate} has been cancelled.`,
        "Use the attached calendar file to remove this leave period from your calendar."
      ].join("\n\n"),
      relatedId: request.id
    }, {
      attachments: [
        makeLeaveCalendarAttachment({
          request,
          employee: user,
          reviewer: manager,
          status: "CANCELLED"
        })
      ]
    });
  }

  return { request, previousStatus };
}

async function createClaim(db, user, body) {
  const claimApproverId = user.claimApproverId || user.managerId;
  if (!claimApproverId) {
    throw new Error("No claims approver has been assigned to your profile yet.");
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
    managerId: claimApproverId,
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

  claim.receipt = body.receiptUpload
    ? await receiptFromSupabaseUpload(user, body.receiptUpload)
    : await saveReceiptAttachment(claim.id, body.receipt);

  db.medicalClaims.unshift(claim);
  const label = claimType === "medical" ? "Medical claim" : "General claim";
  await addEmail(db, {
    recipientId: claimApproverId,
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
  const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const searchParams = requestUrl.searchParams;
  const body = await readRequestBody(req);

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
    limitSessionsForUser(db, user.id);
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
    let actor = null;
    if (cronSecret) {
      const authHeader = req.headers.authorization || "";
      if (authHeader !== `Bearer ${cronSecret}`) {
        return jsonResponse(res, 401, { error: "Unauthorized." });
      }
    } else {
      const admin = requireUser(req, db);
      requireAdmin(admin);
      actor = admin;
    }

    const asOfDate = body.asOfDate ? assertIsoDate(String(body.asOfDate), "Rollover date") : new Date();
    const rollover = applyLeaveYearRollover(db, asOfDate);
    const anniversaryAccrual = applyServiceAnniversaryAccrual(db, asOfDate);
    const auditEvents = addMaintenanceAuditEvents(db, actor, { rollover, anniversaryAccrual });
    if (rollover.changed || anniversaryAccrual.changed || auditEvents) await saveDb(db);
    return jsonResponse(res, 200, { data: { rollover, anniversaryAccrual } });
  }

  if ((req.method === "GET" || req.method === "POST") && pathname === "/api/run-service-anniversary-accrual") {
    const cronSecret = process.env.CRON_SECRET;
    let actor = null;
    if (cronSecret) {
      const authHeader = req.headers.authorization || "";
      if (authHeader !== `Bearer ${cronSecret}`) {
        return jsonResponse(res, 401, { error: "Unauthorized." });
      }
    } else {
      const admin = requireUser(req, db);
      requireAdmin(admin);
      actor = admin;
    }

    const asOfDate = body.asOfDate ? assertIsoDate(String(body.asOfDate), "Accrual date") : new Date();
    const anniversaryAccrual = applyServiceAnniversaryAccrual(db, asOfDate);
    const auditEvents = addMaintenanceAuditEvents(db, actor, { anniversaryAccrual });
    if (anniversaryAccrual.changed || auditEvents) await saveDb(db);
    return jsonResponse(res, 200, { data: anniversaryAccrual });
  }

  if ((req.method === "GET" || req.method === "POST") && pathname === "/api/run-receipt-retention") {
    const cronSecret = process.env.CRON_SECRET;
    let actor = null;
    if (cronSecret) {
      const authHeader = req.headers.authorization || "";
      if (authHeader !== `Bearer ${cronSecret}`) {
        return jsonResponse(res, 401, { error: "Unauthorized." });
      }
    } else {
      const admin = requireUser(req, db);
      requireAdmin(admin);
      actor = admin;
    }

    const asOfDate = body.asOfDate ? assertIsoDate(String(body.asOfDate), "Retention date") : new Date();
    const receiptRetention = await applyReceiptRetention(db, asOfDate);
    const auditEvents = addMaintenanceAuditEvents(db, actor, { receiptRetention });
    if (receiptRetention.changed || auditEvents) await saveDb(db);
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
    const auditEvents = addMaintenanceAuditEvents(db, null, { rollover, anniversaryAccrual, receiptRetention });
    if (rollover.changed || anniversaryAccrual.changed || receiptRetention.changed || auditEvents) await saveDb(db);
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
    addAuditEvent(db, user, {
      action: "account.password_changed",
      affectedUserId: user.id,
      relatedType: "employee",
      relatedId: user.id,
      summary: `${user.name} changed their login password.`
    });
    await saveDb(db);
    return jsonResponse(res, 200, {
      data: {
        patch: dashboardPatch(db, user),
        stale: { audit: true }
      }
    });
  }

  if (req.method === "GET" && pathname === "/api/dashboard") {
    return jsonResponse(res, 200, { data: dashboard(db, user) });
  }

  if (req.method === "GET" && pathname === "/api/history/leave") {
    return jsonResponse(res, 200, { data: historyPage(db, user, "leave", searchParams) });
  }

  if (req.method === "GET" && pathname === "/api/history/claims") {
    return jsonResponse(res, 200, { data: historyPage(db, user, "claim", searchParams) });
  }

  if (req.method === "GET" && pathname === "/api/history/emails") {
    return jsonResponse(res, 200, { data: emailPage(db, user, searchParams) });
  }

  if (req.method === "GET" && pathname === "/api/audit-events") {
    return jsonResponse(res, 200, { data: auditPage(db, user, searchParams) });
  }

  if (req.method === "POST" && pathname === "/api/claim-receipts/upload-url") {
    return jsonResponse(res, 200, { data: await createReceiptUploadUrl(user, body) });
  }

  if (req.method === "POST" && pathname === "/api/leave-medical-certificates/upload-url") {
    return jsonResponse(res, 200, { data: await createMedicalCertificateUploadUrl(user, body) });
  }

  if (req.method === "POST" && pathname === "/api/leave-adjustments") {
    requireAdmin(user);
    const adjustment = createLeaveAdjustment(db, user, body);
    const employee = getUser(db, adjustment.employeeId);
    await saveDb(db);
    return jsonResponse(res, 201, {
      data: {
        adjustment,
        employee: publicUser(employee),
        patch: dashboardPatch(db, user),
        stale: { history: ["leave"], audit: true }
      }
    });
  }

  if (req.method === "POST" && pathname === "/api/employees") {
    requireAdmin(user);
    const employee = await createEmployee(db, body);
    addAuditEvent(db, user, {
      action: "employee.created",
      affectedUserId: employee.id,
      relatedType: "employee",
      relatedId: employee.id,
      summary: `Created employee ${employee.name}.`,
      metadata: {
        role: employee.role,
        manager: auditUserName(db, employee.managerId),
        claimApprover: auditUserName(db, employee.claimApproverId),
        annualLeaveEntitlement: employee.annualLeaveEntitlement,
        medicalLeaveEntitlement: employee.medicalLeaveEntitlement,
        medicalClaimLimit: employee.medicalClaimLimit
      }
    });
    await saveDbAndDeliverQueuedEmails(db);
    return jsonResponse(res, 201, {
      data: {
        employee: publicUser(employee),
        patch: dashboardPatch(db, user),
        stale: { mail: true, audit: true }
      }
    });
  }

  if (req.method === "PATCH" && pathname === "/api/employees/bulk") {
    requireAdmin(user);
    const beforeUsers = Object.fromEntries(db.users.map((employee) => [employee.id, publicUser(employee)]));
    const employees = updateEmployees(db, body);
    employees.forEach((employee) => {
      addEmployeeUpdateAudit(db, user, beforeUsers[employee.id], employee);
    });
    await saveDb(db);
    return jsonResponse(res, 200, {
      data: {
        employees: employees.map(publicUser),
        patch: dashboardPatch(db, user),
        stale: { audit: true }
      }
    });
  }

  const employeePasswordMatch = pathname.match(/^\/api\/employees\/([^/]+)\/password$/);
  if (employeePasswordMatch && req.method === "POST") {
    requireAdmin(user);
    const { employee } = resetEmployeePassword(db, employeePasswordMatch[1], body);
    keepOnlyCurrentSession(db, employee.id, parseCookies(req).cls_session);
    addAuditEvent(db, user, {
      action: "employee.password_reset",
      affectedUserId: employee.id,
      relatedType: "employee",
      relatedId: employee.id,
      summary: `Reset login password for ${employee.name}.`
    });
    await saveDb(db);
    return jsonResponse(res, 200, {
      data: {
        employee: publicUser(employee),
        patch: dashboardPatch(db, user),
        stale: { audit: true }
      }
    });
  }

  const employeeMatch = pathname.match(/^\/api\/employees\/([^/]+)$/);
  if (employeeMatch && req.method === "PATCH") {
    requireAdmin(user);
    const before = publicUser(getUser(db, employeeMatch[1]));
    const employee = updateEmployee(db, employeeMatch[1], body);
    addEmployeeUpdateAudit(db, user, before, employee);
    await saveDb(db);
    return jsonResponse(res, 200, {
      data: {
        employee: publicUser(employee),
        patch: dashboardPatch(db, user),
        stale: { audit: true }
      }
    });
  }

  if (req.method === "POST" && pathname === "/api/leave-requests") {
    const request = await createLeaveRequest(db, user, body);
    addAuditEvent(db, user, {
      action: "leave.submitted",
      affectedUserId: user.id,
      relatedType: "leave",
      relatedId: request.id,
      summary: `${user.name} submitted ${request.type} from ${request.startDate} to ${request.endDate} (${request.days} working day${request.days === 1 ? "" : "s"}).`,
      metadata: {
        type: request.type,
        startDate: request.startDate,
        endDate: request.endDate,
        days: request.days,
        excludedDates: request.excludedDates,
        hasMedicalCertificate: Boolean(request.medicalCertificate)
      }
    });
    await saveDbAndDeliverQueuedEmails(db);
    return jsonResponse(res, 201, {
      data: {
        request,
        patch: dashboardPatch(db, user),
        stale: { history: ["leave"], mail: true, audit: true }
      }
    });
  }

  const leaveCancelMatch = pathname.match(/^\/api\/leave-requests\/([^/]+)\/cancel$/);
  if (leaveCancelMatch && req.method === "PATCH") {
    const { request, previousStatus } = await cancelLeaveRequest(db, user, leaveCancelMatch[1], body);
    addAuditEvent(db, user, {
      action: "leave.cancelled",
      affectedUserId: user.id,
      relatedType: "leave",
      relatedId: request.id,
      summary: `${user.name} cancelled ${previousStatus} leave from ${request.startDate} to ${request.endDate}.`,
      metadata: {
        previousStatus,
        cancellationNote: request.cancellationNote,
        startDate: request.startDate,
        endDate: request.endDate,
        days: request.days
      }
    });
    await saveDbAndDeliverQueuedEmails(db);
    return jsonResponse(res, 200, {
      data: {
        request,
        patch: dashboardPatch(db, user),
        stale: { history: ["leave"], mail: true, audit: true }
      }
    });
  }

  const leaveDecisionMatch = pathname.match(/^\/api\/leave-requests\/([^/]+)\/status$/);
  if (leaveDecisionMatch && req.method === "PATCH") {
    const request = await decideLeaveRequest(db, user, leaveDecisionMatch[1], body);
    addAuditEvent(db, user, {
      action: request.status === "approved" ? "leave.approved" : "leave.rejected",
      affectedUserId: request.employeeId,
      relatedType: "leave",
      relatedId: request.id,
      summary: `${user.name} ${request.status === "approved" ? "approved" : "did not approve"} leave for ${auditUserName(db, request.employeeId)} from ${request.startDate} to ${request.endDate}.`,
      metadata: {
        status: request.status,
        decisionNote: request.decisionNote
      }
    });
    await saveDbAndDeliverQueuedEmails(db);
    return jsonResponse(res, 200, {
      data: {
        request,
        patch: dashboardPatch(db, user),
        stale: { history: ["leave"], mail: true, audit: true }
      }
    });
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

  const medicalCertificateMatch = pathname.match(/^\/api\/leave-requests\/([^/]+)\/medical-certificate$/);
  if (medicalCertificateMatch && req.method === "GET") {
    const request = db.leaveRequests.find((item) => item.id === medicalCertificateMatch[1]);
    if (!request) return jsonResponse(res, 404, { error: "Leave request was not found." });
    if (!canReview(user, request) && request.employeeId !== user.id) {
      return jsonResponse(res, 403, { error: "You cannot view this Medical Certificate." });
    }
    if (!request.medicalCertificate?.storedName) {
      return jsonResponse(res, 404, { error: "No Medical Certificate is attached to this leave request." });
    }

    const certificate = await readMedicalCertificateAttachment(request);
    res.writeHead(200, {
      "Content-Type": request.medicalCertificate.mimeType || "application/octet-stream",
      "Content-Disposition": `inline; filename="${request.medicalCertificate.originalName || "medical-certificate"}"`,
      "Content-Length": certificate.length
    });
    return res.end(certificate);
  }

  if (req.method === "POST" && (pathname === "/api/medical-claims" || pathname === "/api/claims")) {
    const beforeClaimCount = db.medicalClaims.length;
    const claim = await createClaim(db, user, body);
    if (db.medicalClaims.length > beforeClaimCount) {
      addAuditEvent(db, user, {
        action: "claim.submitted",
        affectedUserId: user.id,
        relatedType: "claim",
        relatedId: claim.id,
        summary: `${user.name} submitted a ${claim.claimType === "general" ? "general" : "medical"} claim for $${Number(claim.amount).toFixed(2)} from ${claim.provider}.`,
        metadata: {
          category: claim.category,
          claimType: claim.claimType,
          claimDate: claim.claimDate,
          amount: claim.amount,
          hasReceipt: Boolean(claim.receipt)
        }
      });
    }
    await saveDbAndDeliverQueuedEmails(db);
    return jsonResponse(res, 201, {
      data: {
        claim,
        patch: dashboardPatch(db, user),
        stale: { history: ["claim"], mail: true, audit: true }
      }
    });
  }

  const claimDecisionMatch = pathname.match(/^\/api\/(?:medical-claims|claims)\/([^/]+)\/status$/);
  if (claimDecisionMatch && req.method === "PATCH") {
    const claim = await decideClaim(db, user, claimDecisionMatch[1], body);
    addAuditEvent(db, user, {
      action: claim.status === "approved" ? "claim.approved" : "claim.rejected",
      affectedUserId: claim.employeeId,
      relatedType: "claim",
      relatedId: claim.id,
      summary: `${user.name} ${claim.status === "approved" ? "approved" : "did not approve"} ${claim.claimType === "general" ? "a general" : "a medical"} claim for ${auditUserName(db, claim.employeeId)}.`,
      metadata: {
        status: claim.status,
        decisionNote: claim.decisionNote,
        amount: claim.amount,
        category: claim.category,
        claimType: claim.claimType
      }
    });
    await saveDbAndDeliverQueuedEmails(db);
    return jsonResponse(res, 200, {
      data: {
        claim,
        patch: dashboardPatch(db, user),
        stale: { history: ["claim"], mail: true, audit: true }
      }
    });
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

module.exports = {
  handleRequest,
  __test: {
    addAuditEvent,
    addEmail,
    addMaintenanceAuditEvents,
    applyLeaveYearRollover,
    auditPage,
    cancelLeaveRequest,
    createClaim,
    createLeaveAdjustment,
    deliverQueuedEmails,
    limitSessionsForUser,
    multipartBoundary,
    parseMultipartBuffer,
    parseReceipt,
    pruneExpiredSessions,
    receiptUploadMetadata,
    resetEmployeePassword,
    resolveSupabaseSignedUrl,
    sessions,
    storageObjectEndpoint,
    supabaseTableConfigs: SUPABASE_TABLES,
    verifyPassword
  }
};
