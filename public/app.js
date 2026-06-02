const state = {
  dashboard: null,
  activeTab: "overview",
  busy: false,
  history: {
    leave: {
      status: "all",
      year: String(new Date().getFullYear()),
      query: "",
      items: [],
      total: 0,
      years: [String(new Date().getFullYear())],
      loading: false,
      loadedKey: "",
      requestKey: "",
      requestId: 0
    },
    claim: {
      status: "all",
      year: String(new Date().getFullYear()),
      category: "all",
      query: "",
      items: [],
      total: 0,
      years: [String(new Date().getFullYear())],
      loading: false,
      loadedKey: "",
      requestKey: "",
      requestId: 0
    }
  },
  mail: {
    items: [],
    total: 0,
    loading: false,
    loaded: false,
    requestId: 0
  },
  audit: {
    query: "",
    items: [],
    total: 0,
    loading: false,
    loadedKey: "",
    requestId: 0
  },
  passwordReset: {
    employeeId: null
  },
  leaveAdjustment: {
    employeeId: null
  }
};

const app = document.querySelector("#app");
const HISTORY_PAGE_SIZE = 10;
const MAIL_PAGE_SIZE = 20;
const AUDIT_PAGE_SIZE = 20;
let auditSearchTimer = null;
const MAX_RECEIPT_BYTES = 5_000_000;
const RECEIPT_HELP_TEXT = "PDF, JPG, PNG, WebP, HEIC, or HEIF. Max 5 MB.";
const RECEIPT_ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif";
const RECEIPT_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif"
]);
const RECEIPT_EXTENSIONS = new Set([".pdf", ".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif"]);

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function money(value) {
  return new Intl.NumberFormat("en-SG", {
    style: "currency",
    currency: "SGD"
  }).format(Number(value || 0));
}

function fileSize(value) {
  const bytes = Number(value || 0);
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(2)} MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)} KB`;
  return `${bytes} B`;
}

function claimTypeLabel(type) {
  return type === "general" ? "General Claim" : "Medical Claim";
}

function dateText(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-SG", {
    year: "numeric",
    month: "short",
    day: "numeric"
  }).format(new Date(`${value}T12:00:00Z`));
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function currentYearText() {
  return String(new Date().getFullYear());
}

function dateTimeText(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-SG", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function statusLabel(status) {
  if (status === "approved") return "Approved";
  if (status === "rejected") return "Not Approved";
  return "Pending";
}

function signedDays(value) {
  const days = Number(value || 0);
  return `${days > 0 ? "+" : ""}${days}`;
}

function showToast(message, type = "ok") {
  const old = document.querySelector(".toast");
  if (old) old.remove();
  const toast = document.createElement("div");
  toast.className = `toast ${type === "error" ? "error" : ""}`;
  toast.textContent = message;
  document.body.append(toast);
  setTimeout(() => toast.remove(), 4200);
}

async function api(path, options = {}) {
  const headers = options.body instanceof FormData
    ? { ...(options.headers || {}) }
    : {
        "Content-Type": "application/json",
        ...(options.headers || {})
      };
  const response = await fetch(path, {
    ...options,
    headers
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "Request failed.");
  }
  return payload.data;
}

function resetHistoryResults(kind = null) {
  const kinds = kind ? [kind] : ["leave", "claim"];
  kinds.forEach((historyKind) => {
    const filters = state.history[historyKind];
    filters.items = [];
    filters.total = 0;
    filters.loading = false;
    filters.loadedKey = "";
    filters.requestKey = "";
    filters.requestId = (filters.requestId || 0) + 1;
  });
}

function resetMailResults() {
  state.mail.items = [];
  state.mail.total = 0;
  state.mail.loading = false;
  state.mail.loaded = false;
  state.mail.requestId = (state.mail.requestId || 0) + 1;
}

function resetAuditResults() {
  state.audit.items = [];
  state.audit.total = 0;
  state.audit.loading = false;
  state.audit.loadedKey = "";
  state.audit.requestId = (state.audit.requestId || 0) + 1;
}

function updateDashboard(data) {
  if (data.dashboard) {
    state.dashboard = data.dashboard;
  } else {
    state.dashboard = data;
  }
  state.passwordReset = { employeeId: null };
  state.leaveAdjustment = { employeeId: null };
  resetHistoryResults();
  resetMailResults();
  resetAuditResults();
  render();
}

function employeeName(id) {
  return state.dashboard?.userById?.[id]?.name || "Unassigned";
}

function roleName(role) {
  if (role === "admin") return "Admin";
  if (role === "manager") return "Direct Report";
  return "Employee";
}

function isAdmin() {
  return state.dashboard?.user?.role === "admin";
}

function isReviewer(item) {
  const user = state.dashboard.user;
  return user.role === "admin" || item.managerId === user.id;
}

function pendingApprovalCount() {
  const counts = state.dashboard?.counts || { pendingLeave: 0, pendingClaims: 0 };
  return counts.pendingLeave + counts.pendingClaims;
}

function historyFilterKey(kind) {
  const filters = state.history[kind];
  return JSON.stringify({
    status: filters.status,
    year: filters.year,
    category: kind === "claim" ? filters.category : "",
    query: filters.query.trim().toLowerCase()
  });
}

function historyEndpoint(kind) {
  return kind === "leave" ? "/api/history/leave" : "/api/history/claims";
}

function historyQuery(kind, offset) {
  const filters = state.history[kind];
  const params = new URLSearchParams({
    status: filters.status,
    year: filters.year,
    query: filters.query.trim(),
    offset: String(offset),
    limit: String(HISTORY_PAGE_SIZE)
  });
  if (kind === "claim") params.set("category", filters.category);
  return params.toString();
}

async function loadHistory(kind, options = {}) {
  const filters = state.history[kind];
  if (!filters || filters.loading) return;

  const key = historyFilterKey(kind);
  const append = options.append && filters.loadedKey === key;
  const offset = append ? filters.items.length : 0;
  const requestId = (filters.requestId || 0) + 1;
  filters.requestId = requestId;
  filters.loading = true;
  filters.requestKey = key;
  if (!append) {
    filters.items = [];
    filters.total = 0;
    filters.loadedKey = key;
  }

  try {
    const data = await api(`${historyEndpoint(kind)}?${historyQuery(kind, offset)}`);
    if (filters.requestId !== requestId || historyFilterKey(kind) !== key) return;
    filters.items = append ? [...filters.items, ...data.items] : data.items;
    filters.total = data.total;
    filters.years = data.years?.length ? data.years : [currentYearText()];
    filters.loadedKey = key;
  } catch (error) {
    if (filters.requestId === requestId && historyFilterKey(kind) === key) showToast(error.message, "error");
  } finally {
    if (filters.requestId === requestId && filters.requestKey === key) {
      filters.loading = false;
      filters.requestKey = "";
      render();
    }
  }
}

function ensureHistoryLoaded(kind) {
  const filters = state.history[kind];
  if (!filters || filters.loading) return;
  if (filters.loadedKey !== historyFilterKey(kind)) {
    loadHistory(kind);
  }
}

async function loadMail(options = {}) {
  if (state.mail.loading) return;

  const append = Boolean(options.append);
  const offset = append ? state.mail.items.length : 0;
  const requestId = (state.mail.requestId || 0) + 1;
  state.mail.requestId = requestId;
  state.mail.loading = true;
  if (!append) {
    state.mail.items = [];
    state.mail.total = 0;
  }

  try {
    const params = new URLSearchParams({
      offset: String(offset),
      limit: String(MAIL_PAGE_SIZE)
    });
    const data = await api(`/api/history/emails?${params.toString()}`);
    if (state.mail.requestId !== requestId) return;
    state.mail.items = append ? [...state.mail.items, ...data.items] : data.items;
    state.mail.total = data.total;
    state.mail.loaded = true;
  } catch (error) {
    if (state.mail.requestId === requestId) showToast(error.message, "error");
  } finally {
    if (state.mail.requestId === requestId) {
      state.mail.loading = false;
      render();
    }
  }
}

function ensureMailLoaded() {
  if (!state.mail.loading && !state.mail.loaded) {
    loadMail();
  }
}

function auditFilterKey() {
  return state.audit.query.trim().toLowerCase();
}

async function loadAudit(options = {}) {
  if (!isAdmin() || state.audit.loading) return;

  const key = auditFilterKey();
  const append = options.append && state.audit.loadedKey === key;
  const offset = append ? state.audit.items.length : 0;
  const requestId = (state.audit.requestId || 0) + 1;
  state.audit.requestId = requestId;
  state.audit.loading = true;
  if (!append) {
    state.audit.items = [];
    state.audit.total = 0;
    state.audit.loadedKey = key;
  }

  try {
    const params = new URLSearchParams({
      query: state.audit.query.trim(),
      offset: String(offset),
      limit: String(AUDIT_PAGE_SIZE)
    });
    const data = await api(`/api/audit-events?${params.toString()}`);
    if (state.audit.requestId !== requestId || auditFilterKey() !== key) return;
    state.audit.items = append ? [...state.audit.items, ...data.items] : data.items;
    state.audit.total = data.total;
    state.audit.loadedKey = key;
  } catch (error) {
    if (state.audit.requestId === requestId && auditFilterKey() === key) showToast(error.message, "error");
  } finally {
    if (state.audit.requestId === requestId && state.audit.loadedKey === key) {
      state.audit.loading = false;
      render();
    }
  }
}

function ensureAuditLoaded() {
  if (!isAdmin() || state.audit.loading) return;
  if (state.audit.loadedKey !== auditFilterKey()) {
    loadAudit();
  }
}

function renderSelectOptions(options, selected) {
  return options
    .map((option) => `
      <option value="${escapeHtml(option.value)}" ${option.value === selected ? "selected" : ""}>
        ${escapeHtml(option.label)}
      </option>
    `)
    .join("");
}

function renderHistoryFilters(kind) {
  const filters = state.history[kind];
  const title = kind === "leave" ? "Leave History" : "Claim History";
  const years = [
    { value: "all", label: "All Years" },
    ...(filters.years || [currentYearText()]).map((year) => ({ value: year, label: year }))
  ];
  const statusOptions = [
    { value: "all", label: "All Status" },
    { value: "approved", label: "Approved" },
    { value: "rejected", label: "Not Approved" }
  ];

  return `
    <div class="history-heading">
      <h2 class="section-title">${title}</h2>
      <div class="history-tools">
        <label class="filter-field" for="${kind}-history-status">
          <span>Status</span>
          <select id="${kind}-history-status" data-history-kind="${kind}" data-history-field="status">
            ${renderSelectOptions(statusOptions, filters.status)}
          </select>
        </label>
        <label class="filter-field" for="${kind}-history-year">
          <span>Year</span>
          <select id="${kind}-history-year" data-history-kind="${kind}" data-history-field="year">
            ${renderSelectOptions(years, filters.year)}
          </select>
        </label>
        ${kind === "claim" ? `
          <label class="filter-field" for="claim-history-category">
            <span>Category</span>
            <select id="claim-history-category" data-history-kind="claim" data-history-field="category">
              ${renderSelectOptions([
                { value: "all", label: "All Categories" },
                { value: "Medical", label: "Medical" },
                { value: "Others", label: "Others" }
              ], filters.category)}
            </select>
          </label>
        ` : ""}
        <label class="filter-field search" for="${kind}-history-search">
          <span>Search</span>
          <input id="${kind}-history-search" data-history-kind="${kind}" data-history-field="query" type="search" value="${escapeHtml(filters.query)}" placeholder="Name, status, or details">
        </label>
      </div>
    </div>
  `;
}

function renderHistorySection(kind) {
  ensureHistoryLoaded(kind);
  const filters = state.history[kind];
  const items = filters.items || [];
  const table = filters.loading && !items.length
    ? `<div class="empty">Loading history...</div>`
    : kind === "leave"
      ? renderLeaveTable(items, false)
      : renderClaimsTable(items, false);
  const remaining = Math.max(0, Number(filters.total || 0) - items.length);

  return `
    <section class="section">
      <div class="section-header history-header">
        ${renderHistoryFilters(kind)}
      </div>
      ${table}
      ${remaining > 0 ? `
        <div class="history-more">
          <button class="button small" data-action="history-load-more" data-kind="${kind}">
            ${filters.loading ? "Loading..." : "Load More"}
          </button>
          <span class="muted">${items.length} of ${filters.total} shown</span>
        </div>
      ` : ""}
    </section>
  `;
}

function receiptExtension(name) {
  const match = String(name || "").toLowerCase().match(/\.[^.]+$/);
  return match ? match[0] : "";
}

function assertReceiptFile(file) {
  if (file.size > MAX_RECEIPT_BYTES) {
    throw new Error("Receipt upload must be 5 MB or smaller.");
  }

  const type = String(file.type || "").toLowerCase();
  const extension = receiptExtension(file.name);
  if (!RECEIPT_MIME_TYPES.has(type) && !RECEIPT_EXTENSIONS.has(extension)) {
    throw new Error(`Receipt must be ${RECEIPT_HELP_TEXT}`);
  }
}

function newClaimSubmissionId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function setFormSubmitting(form, submitting, label = "Submitting...") {
  form.dataset.submitting = submitting ? "true" : "false";
  form.setAttribute("aria-busy", submitting ? "true" : "false");
  const submitButton = form.querySelector("button[type='submit']");
  if (submitButton) {
    if (submitting) {
      submitButton.dataset.originalText = submitButton.dataset.originalText || submitButton.textContent;
      submitButton.textContent = label;
    } else if (submitButton.dataset.originalText) {
      submitButton.textContent = submitButton.dataset.originalText;
      delete submitButton.dataset.originalText;
    }
  }
  form.querySelectorAll("input, select, textarea, button").forEach((control) => {
    control.disabled = submitting;
  });
}

async function uploadReceiptToSignedUrl(upload, file) {
  const response = await fetch(upload.signedUrl, {
    method: upload.method || "PUT",
    headers: {
      "Content-Type": upload.mimeType || file.type || "application/octet-stream",
      "cache-control": "3600"
    },
    body: file
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Receipt upload failed: ${text || response.statusText}`);
  }
}

async function claimFormPayload(form, body) {
  const category = body.category === "Others" ? "Others" : "Medical";
  const claimType = category === "Medical" ? "medical" : "general";
  const file = form.querySelector("input[type='file'][name='receipt']")?.files?.[0];
  if (!file) {
    throw new Error("Please upload a receipt.");
  }
  assertReceiptFile(file);

  const claimBody = { ...body, category, claimType };
  delete claimBody.receipt;

  const upload = await api("/api/claim-receipts/upload-url", {
    method: "POST",
    body: JSON.stringify({
      name: file.name,
      type: file.type || "application/octet-stream",
      size: file.size
    })
  });
  if (upload.direct) {
    await uploadReceiptToSignedUrl(upload, file);
    claimBody.receiptUpload = {
      storage: upload.storage,
      bucket: upload.bucket,
      storedName: upload.storedName,
      originalName: upload.originalName,
      mimeType: upload.mimeType,
      size: upload.size
    };
    return {
      body: JSON.stringify(claimBody),
      claimType
    };
  }

  const formData = new FormData(form);
  formData.set("category", category);
  formData.set("claimType", claimType);
  return { body: formData, claimType };
}

function renderLogin() {
  app.innerHTML = `
    <main class="login-page">
      <section class="login-shell">
        <div class="login-panel">
          <div>
            <div class="brand-mark">CLS</div>
            <h1>Leave & Claims</h1>
            <p>Employee leave applications, direct report approvals, medical claims, and admin setup for CLS.</p>
          </div>
          <p>Local workspace</p>
        </div>
        <form class="login-card" data-form="login">
          <h2>Sign in</h2>
          <p>Use your CLS account details.</p>
          <div class="content-grid" style="margin-top: 28px;">
            <div class="field">
              <label for="email">Email</label>
              <input id="email" name="email" type="email" autocomplete="username" required value="admin@cls.local">
            </div>
            <div class="field">
              <label for="password">Password</label>
              <input id="password" name="password" type="password" autocomplete="current-password" required value="password">
            </div>
            <button class="button primary" type="submit">Sign in</button>
          </div>
        </form>
      </section>
    </main>
  `;
}

function renderNavButton(id, label, badge = "") {
  return `
    <button class="nav-button ${state.activeTab === id ? "active" : ""}" data-action="tab" data-tab="${id}">
      <span>${label}</span>
      ${badge ? `<span class="badge">${badge}</span>` : ""}
    </button>
  `;
}

function renderShell(content) {
  const { user } = state.dashboard;
  const approvals = pendingApprovalCount();
  app.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="brand">
          <div class="brand-mark">CLS</div>
          <div>
            <div class="brand-title">Leave & Claims</div>
            <div class="brand-subtitle">Local system</div>
          </div>
        </div>
        <div class="profile-strip">
          <div class="profile-name">${escapeHtml(user.name)}</div>
          <div class="profile-email">${escapeHtml(user.email)}</div>
          <span class="role-pill">${roleName(user.role)}</span>
        </div>
        <nav class="nav-list">
          ${renderNavButton("overview", "Overview")}
          ${renderNavButton("leave", "Leave")}
          ${renderNavButton("claims", "Claims")}
          ${(approvals || user.role !== "employee") ? renderNavButton("approvals", "Approvals", approvals || "") : ""}
          ${isAdmin() ? renderNavButton("employees", "Employees") : ""}
          ${isAdmin() ? renderNavButton("audit", "Audit Log") : ""}
          ${renderNavButton("account", "Account")}
          ${renderNavButton("mail", "Email Outbox")}
        </nav>
        <button class="button ghost" data-action="logout">Sign out</button>
      </aside>
      <main class="main">
        ${content}
      </main>
    </div>
    ${renderPasswordResetDialog()}
    ${renderLeaveAdjustmentDialog()}
  `;
}

function renderTopbar(title, kicker) {
  return `
    <div class="topbar">
      <div>
        <h1 class="page-title">${title}</h1>
        <p class="page-kicker">${kicker}</p>
      </div>
    </div>
  `;
}

function renderPasswordResetDialog() {
  const employeeId = state.passwordReset.employeeId;
  if (!employeeId) return "";

  const employee = state.dashboard.userById[employeeId];
  if (!employee) return "";

  return `
    <div class="modal-backdrop" role="presentation">
      <section class="modal" role="dialog" aria-modal="true" aria-labelledby="password-reset-title">
        <div class="modal-header">
          <h2 id="password-reset-title">Reset Login Password</h2>
          <button class="icon-button" data-action="close-password-reset" aria-label="Close password reset">x</button>
        </div>
        <div class="modal-body">
          <div>
            <div class="metric-label">Employee</div>
            <div class="detail-value">${escapeHtml(employee.name)}</div>
          </div>
          <label class="field" for="temporary-password">
            <span>New Temporary Password</span>
            <input id="temporary-password" data-password-reset-input autocomplete="new-password" type="password" minlength="8" required>
          </label>
        </div>
        <div class="modal-actions">
          <button class="button" data-action="close-password-reset">Cancel</button>
          <button class="button primary" data-action="confirm-password-reset" data-id="${escapeHtml(employee.id)}">Reset Password</button>
        </div>
      </section>
    </div>
  `;
}

function renderLeaveAdjustmentDialog() {
  const employeeId = state.leaveAdjustment.employeeId;
  if (!employeeId) return "";

  const employee = state.dashboard.userById[employeeId];
  if (!employee) return "";

  return `
    <div class="modal-backdrop" role="presentation">
      <form class="modal" role="dialog" aria-modal="true" aria-labelledby="leave-adjustment-title" data-form="leave-adjustment">
        <div class="modal-header">
          <h2 id="leave-adjustment-title">Adjust Leave</h2>
          <button class="icon-button" type="button" data-action="close-leave-adjustment" aria-label="Close leave adjustment">x</button>
        </div>
        <div class="modal-body">
          <input type="hidden" name="employeeId" value="${escapeHtml(employee.id)}">
          <div>
            <div class="metric-label">Employee</div>
            <div class="detail-value">${escapeHtml(employee.name)}</div>
            <div class="muted">Current total leave entitlement: ${employee.leaveEntitlement}</div>
          </div>
          <label class="field" for="leave-adjustment-direction">
            <span>Adjustment</span>
            <select id="leave-adjustment-direction" name="direction" required>
              <option value="add">Add Leave</option>
              <option value="deduct">Deduct Leave</option>
            </select>
          </label>
          <label class="field" for="leave-adjustment-days">
            <span>Days</span>
            <input id="leave-adjustment-days" name="days" type="number" min="0.5" step="0.5" value="0.5" required>
          </label>
          <label class="field" for="leave-adjustment-reason">
            <span>Reason</span>
            <textarea id="leave-adjustment-reason" name="reason" required></textarea>
          </label>
        </div>
        <div class="modal-actions">
          <button class="button" type="button" data-action="close-leave-adjustment">Cancel</button>
          <button class="button primary" type="submit">Apply Adjustment</button>
        </div>
      </form>
    </div>
  `;
}

function renderMetrics() {
  const summary = state.dashboard.leaveSummary;
  return `
    <section class="metrics">
      <div class="metric">
        <div class="metric-label">Available Leave</div>
        <div class="metric-value">${summary.available}</div>
      </div>
      <div class="metric">
        <div class="metric-label">Yearly Allotment</div>
        <div class="metric-value">${summary.entitlement}</div>
      </div>
      <div class="metric">
        <div class="metric-label">Carried Forward</div>
        <div class="metric-value">${summary.carriedForward}</div>
      </div>
      <div class="metric">
        <div class="metric-label">Birthday Leave</div>
        <div class="metric-value">${summary.birthdayLeave}</div>
      </div>
      <div class="metric">
        <div class="metric-label">Adjustments</div>
        <div class="metric-value">${signedDays(summary.adjustments)}</div>
      </div>
      <div class="metric">
        <div class="metric-label">Leave Pending</div>
        <div class="metric-value">${summary.pending}</div>
      </div>
    </section>
  `;
}

function renderAdminReceiptStorage() {
  const summary = state.dashboard.receiptStorageSummary;
  if (!isAdmin() || !summary) return "";

  return `
    <section class="section">
      <div class="section-header">
        <h2 class="section-title">Receipt Storage</h2>
        <div class="storage-meta">
          <span>Retention ${summary.retentionYears} years</span>
          <span>Max ${fileSize(summary.maxReceiptBytes)} per receipt</span>
        </div>
      </div>
      <div class="section-body">
        <div class="storage-metrics">
          <div class="metric">
            <div class="metric-label">Active Storage</div>
            <div class="metric-value money-value">${fileSize(summary.activeBytes)}</div>
          </div>
          <div class="metric">
            <div class="metric-label">Active Receipts</div>
            <div class="metric-value">${summary.activeReceiptCount}</div>
          </div>
          <div class="metric">
            <div class="metric-label">Due Cleanup</div>
            <div class="metric-value">${summary.dueForDeletionCount}</div>
          </div>
          <div class="metric">
            <div class="metric-label">Removed</div>
            <div class="metric-value">${summary.deletedReceiptCount}</div>
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderOverview() {
  const pendingLeaves = state.dashboard.leaveRequests.filter((item) => item.status === "pending" && isReviewer(item));
  const pendingClaims = state.dashboard.medicalClaims.filter((item) => item.status === "pending" && isReviewer(item));
  renderShell(`
    ${renderTopbar("Overview", "Leave balances, pending approvals, and recent activity.")}
    <div class="content-grid">
      ${renderMetrics()}
      ${renderAdminReceiptStorage()}
      <div class="split">
        <section class="section">
          <div class="section-header">
            <h2 class="section-title">Pending Leave Requests</h2>
            <button class="button small" data-action="tab" data-tab="approvals">Review</button>
          </div>
          ${pendingLeaves.length ? renderLeaveTable(pendingLeaves, true) : `<div class="empty">No pending leave requests.</div>`}
        </section>
        <section class="section">
          <div class="section-header">
            <h2 class="section-title">Pending Claims</h2>
            <button class="button small" data-action="tab" data-tab="approvals">Review</button>
          </div>
          ${pendingClaims.length ? renderClaimsTable(pendingClaims, true) : `<div class="empty">No pending medical claims.</div>`}
        </section>
      </div>
      <section class="section">
        <div class="section-header">
          <h2 class="section-title">Recent Notifications</h2>
          <button class="button small" data-action="tab" data-tab="mail">Open outbox</button>
        </div>
        ${renderMailList(state.dashboard.emails.slice(0, 4))}
      </section>
    </div>
  `);
}

function renderLeave() {
  const leaveRequests = state.dashboard.leaveRequests;
  const pendingLeaves = leaveRequests.filter((item) => item.status === "pending");
  renderShell(`
    ${renderTopbar("Leave", "Apply for leave and track your leave request history.")}
    <div class="content-grid">
      ${renderMetrics()}
      <section class="section">
        <div class="section-header">
          <h2 class="section-title">New Leave Application</h2>
        </div>
        <div class="section-body">
          <form class="form-grid" data-form="leave">
            <div class="field">
              <label for="leave-type">Leave Type</label>
              <select id="leave-type" name="type">
                <option>Annual Leave</option>
                <option>Medical Leave</option>
                <option>Urgent Leave</option>
                <option>Unpaid Leave</option>
              </select>
            </div>
            <div class="field">
              <label for="leave-start">Start Date</label>
              <input id="leave-start" name="startDate" type="date" required>
            </div>
            <div class="field">
              <label for="leave-end">End Date</label>
              <input id="leave-end" name="endDate" type="date" required>
            </div>
            <div class="field full">
              <label for="leave-reason">Reason</label>
              <textarea id="leave-reason" name="reason"></textarea>
            </div>
            <div class="field full actions">
              <button class="button primary" type="submit">Submit Leave</button>
            </div>
          </form>
        </div>
      </section>
      <section class="section">
        <div class="section-header">
          <h2 class="section-title">Pending Leave Applications</h2>
        </div>
        ${pendingLeaves.length ? renderLeaveTable(pendingLeaves, false) : `<div class="empty">No pending leave applications.</div>`}
      </section>
      ${renderHistorySection("leave")}
    </div>
  `);
}

function renderClaims() {
  const summary = state.dashboard.medicalClaimSummary;
  const generalSummary = state.dashboard.generalClaimSummary || { pending: 0, approved: 0 };
  const claims = state.dashboard.medicalClaims;
  const pendingClaims = claims.filter((item) => item.status === "pending");
  renderShell(`
    ${renderTopbar("Claims", "Submit medical and general claims and track approval status.")}
    <div class="content-grid">
      <section class="metrics">
        <div class="metric">
          <div class="metric-label">Medical Claim Balance</div>
          <div class="metric-value money-value">${money(summary.available)}</div>
        </div>
        <div class="metric">
          <div class="metric-label">Medical Limit</div>
          <div class="metric-value money-value">${money(summary.limit)}</div>
        </div>
        <div class="metric">
          <div class="metric-label">Medical Pending</div>
          <div class="metric-value money-value">${money(summary.pending)}</div>
        </div>
        <div class="metric">
          <div class="metric-label">Medical Approved</div>
          <div class="metric-value money-value">${money(summary.approved)}</div>
        </div>
        <div class="metric">
          <div class="metric-label">Others Pending</div>
          <div class="metric-value money-value">${money(generalSummary.pending)}</div>
        </div>
        <div class="metric">
          <div class="metric-label">Others Approved</div>
          <div class="metric-value money-value">${money(generalSummary.approved)}</div>
        </div>
      </section>
      <section class="section">
        <div class="section-header">
          <h2 class="section-title">New Claim</h2>
        </div>
        <div class="section-body">
          <form class="form-grid three" data-form="claim">
            <input type="hidden" name="clientSubmissionId" value="${newClaimSubmissionId()}">
            <div class="field">
              <label for="claim-category">Category</label>
              <select id="claim-category" name="category" required>
                <option>Medical</option>
                <option>Others</option>
              </select>
            </div>
            <div class="field">
              <label for="claim-date">Claim Date</label>
              <input id="claim-date" name="claimDate" type="date" required>
            </div>
            <div class="field">
              <label for="claim-amount">Amount</label>
              <input id="claim-amount" name="amount" type="number" min="0.01" step="0.01" required>
            </div>
            <div class="field">
              <label for="claim-provider">Clinic / Merchant</label>
              <input id="claim-provider" name="provider" required>
            </div>
            <div class="field">
              <label for="claim-receipt-file">Receipt Upload</label>
              <input id="claim-receipt-file" name="receipt" type="file" accept="${RECEIPT_ACCEPT}" required>
              <div class="field-hint">${RECEIPT_HELP_TEXT}</div>
            </div>
            <div class="field full">
              <label for="claim-description">Claim Explanation</label>
              <textarea id="claim-description" name="description" required></textarea>
            </div>
            <div class="field full actions">
              <button class="button primary" type="submit">Submit Claim</button>
            </div>
          </form>
        </div>
      </section>
      <section class="section">
        <div class="section-header">
          <h2 class="section-title">Pending Claims</h2>
        </div>
        ${pendingClaims.length ? renderClaimsTable(pendingClaims, false) : `<div class="empty">No pending claims.</div>`}
      </section>
      ${renderHistorySection("claim")}
    </div>
  `);
}

function renderApprovals() {
  const leave = state.dashboard.leaveRequests.filter((item) => item.status === "pending" && isReviewer(item));
  const claims = state.dashboard.medicalClaims.filter((item) => item.status === "pending" && isReviewer(item));
  renderShell(`
    ${renderTopbar("Approvals", "Pending leave applications and medical claims from employees.")}
    <div class="content-grid">
      <section class="section">
        <div class="section-header">
          <h2 class="section-title">Leave Applications</h2>
        </div>
        ${leave.length ? renderLeaveTable(leave, true) : `<div class="empty">No leave applications are pending.</div>`}
      </section>
      <section class="section">
        <div class="section-header">
          <h2 class="section-title">Claims</h2>
        </div>
        ${claims.length ? renderClaimsTable(claims, true) : `<div class="empty">No medical claims are pending.</div>`}
      </section>
    </div>
  `);
}

function statusPill(status) {
  return `<span class="status ${status}">${statusLabel(status)}</span>`;
}

function renderDecisionControls(type, item) {
  if (item.status !== "pending" || !isReviewer(item)) return "";
  return `
    <div class="decision-box">
      <textarea data-note-for="${item.id}" placeholder="Decision note"></textarea>
      <div class="actions">
        <button class="button primary small" data-action="decide" data-kind="${type}" data-id="${item.id}" data-status="approved">Approve</button>
        <button class="button reject small" data-action="decide" data-kind="${type}" data-id="${item.id}" data-status="rejected">Not Approve</button>
      </div>
    </div>
  `;
}

function excludedDatesText(item) {
  if (!Array.isArray(item.excludedDates) || !item.excludedDates.length) return "";
  const text = item.excludedDates
    .map((entry) => `${dateText(entry.date)} ${entry.reason}`)
    .join(", ");
  return `<div class="muted">Excluded: ${escapeHtml(text)}</div>`;
}

function renderLeaveTable(items, approvalsMode) {
  if (!items.length) return `<div class="empty">No leave requests found.</div>`;
  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Employee</th>
            <th>Dates</th>
            <th>Deducted Days</th>
            <th>Type</th>
            <th>Status</th>
            <th>${approvalsMode ? "Decision" : "Approver"}</th>
          </tr>
        </thead>
        <tbody>
          ${items.map((item) => `
            <tr>
              <td data-label="Employee">
                <strong>${escapeHtml(employeeName(item.employeeId))}</strong>
                <div class="muted">${escapeHtml(item.reason || "")}</div>
              </td>
              <td data-label="Dates">
                ${dateText(item.startDate)}<br>
                <span class="muted">${dateText(item.endDate)}</span>
                ${excludedDatesText(item)}
              </td>
              <td data-label="Deducted Days">${item.days}</td>
              <td data-label="Type">${escapeHtml(item.type)}</td>
              <td data-label="Status">${statusPill(item.status)}</td>
              <td data-label="${approvalsMode ? "Decision" : "Approver"}">
                ${approvalsMode ? renderDecisionControls("leave", item) : escapeHtml(employeeName(item.managerId))}
                ${item.decisionNote ? `<div class="muted">${escapeHtml(item.decisionNote)}</div>` : ""}
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderReceiptCell(item) {
  if (item.receipt?.deletedAt) {
    return `
      <span class="muted">Removed</span>
      <div class="muted">5-year retention policy</div>
    `;
  }

  return `
    ${item.receipt ? `<a class="receipt-link" href="/api/claims/${item.id}/receipt" target="_blank" rel="noreferrer">${escapeHtml(item.receipt.originalName || "Receipt")}</a>` : "-"}
    ${item.receiptRef ? `<div class="muted">${escapeHtml(item.receiptRef)}</div>` : ""}
  `;
}

function renderClaimsTable(items, approvalsMode) {
  if (!items.length) return `<div class="empty">No claims found.</div>`;
  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Employee</th>
            <th>Claim</th>
            <th>Amount</th>
            <th>Receipt</th>
            <th>Status</th>
            <th>${approvalsMode ? "Decision" : "Approver"}</th>
          </tr>
        </thead>
        <tbody>
          ${items.map((item) => `
            <tr>
              <td data-label="Employee">
                <strong>${escapeHtml(employeeName(item.employeeId))}</strong>
                <div class="muted">${dateText(item.claimDate)}</div>
              </td>
              <td data-label="Claim">
                <strong>${escapeHtml(claimTypeLabel(item.claimType))}</strong>
                <div>${escapeHtml(item.provider)}</div>
                <div class="muted">${escapeHtml(item.category)} - ${escapeHtml(item.description)}</div>
              </td>
              <td data-label="Amount">${money(item.amount)}</td>
              <td data-label="Receipt">
                ${renderReceiptCell(item)}
              </td>
              <td data-label="Status">${statusPill(item.status)}</td>
              <td data-label="${approvalsMode ? "Decision" : "Approver"}">
                ${approvalsMode ? renderDecisionControls("claim", item) : escapeHtml(employeeName(item.managerId))}
                ${item.decisionNote ? `<div class="muted">${escapeHtml(item.decisionNote)}</div>` : ""}
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function employeeManagerChoices() {
  const employees = state.dashboard.allEmployees || [];
  return employees
    .filter((employee) => employee.active)
    .map((employee) => ({
      id: employee.id,
      label: `${escapeHtml(employee.name)} (${roleName(employee.role)})`
    }));
}

function managerOptions(choices, selectedId, currentId = "") {
  return `<option value="">Unassigned</option>${choices
    .filter((employee) => employee.id !== currentId)
    .map((employee) => `
      <option value="${escapeHtml(employee.id)}" ${employee.id === selectedId ? "selected" : ""}>
        ${employee.label}
      </option>
    `)
    .join("")}`;
}

function employeeSearchText(employee) {
  const manager = employee.managerId ? employeeName(employee.managerId) : "unassigned";
  return [
    employee.name,
    employee.email,
    roleName(employee.role),
    manager,
    `service ${employee.serviceStartDate}`,
    `leave ${employee.annualLeaveEntitlement ?? employee.startingLeaveEntitlement} ${employee.leaveEntitlement} birthday ${employee.birthdayLeaveEntitlement ?? 0}`,
    `medical ${employee.medicalClaimLimit}`,
    employee.active ? "active" : "inactive"
  ].join(" ").toLowerCase();
}

function employeeRowBody(row) {
  const body = {};
  row.querySelectorAll("[data-field]").forEach((field) => {
    body[field.dataset.field] = field.dataset.field === "active"
      ? field.value === "true"
      : field.value;
  });
  return body;
}

function renderLeaveAdjustmentHistory() {
  const adjustments = state.dashboard.leaveAdjustments || [];
  if (!adjustments.length) return `<div class="empty">No leave adjustments recorded yet.</div>`;

  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Employee</th>
            <th>Adjustment</th>
            <th>Reason</th>
            <th>Admin</th>
          </tr>
        </thead>
        <tbody>
          ${adjustments.map((adjustment) => `
            <tr>
              <td data-label="Date">${dateTimeText(adjustment.createdAt)}</td>
              <td data-label="Employee">${escapeHtml(employeeName(adjustment.employeeId))}</td>
              <td data-label="Adjustment">
                <strong class="${Number(adjustment.days) >= 0 ? "adjustment-positive" : "adjustment-negative"}">${signedDays(adjustment.days)} day${Math.abs(Number(adjustment.days || 0)) === 1 ? "" : "s"}</strong>
              </td>
              <td data-label="Reason">${escapeHtml(adjustment.reason)}</td>
              <td data-label="Admin">${escapeHtml(employeeName(adjustment.actorId))}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderEmployees() {
  const managerChoices = employeeManagerChoices();
  renderShell(`
    ${renderTopbar("Employees", "Administer employees, roles, direct reports, and leave entitlement.")}
    <div class="content-grid">
      <section class="section">
        <div class="section-header">
          <h2 class="section-title">New Employee</h2>
        </div>
        <div class="section-body">
          <form class="form-grid three" data-form="employee">
            <div class="field">
              <label for="employee-name">Name</label>
              <input id="employee-name" name="name" required>
            </div>
            <div class="field">
              <label for="employee-email">Email</label>
              <input id="employee-email" name="email" type="email" required>
            </div>
            <div class="field">
              <label for="employee-role">Role</label>
              <select id="employee-role" name="role">
                <option value="employee">Employee</option>
                <option value="manager">Direct Report</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div class="field">
              <label for="employee-manager">Direct Report / Approver</label>
              <select id="employee-manager" name="managerId">${managerOptions(managerChoices, "")}</select>
            </div>
            <div class="field">
              <label for="employee-service-start">Service Start</label>
              <input id="employee-service-start" name="serviceStartDate" type="date" required value="${todayIso()}">
            </div>
            <div class="field">
              <label for="employee-leave">Set Initial Annual Leave Days</label>
              <input id="employee-leave" name="startingLeaveEntitlement" type="number" min="0" step="0.5" value="14">
            </div>
            <div class="field">
              <label for="employee-medical-limit">Medical Claim Limit</label>
              <input id="employee-medical-limit" name="medicalClaimLimit" type="number" min="0" step="0.01" value="500">
            </div>
            <div class="field">
              <label for="employee-password">Temporary Password</label>
              <input id="employee-password" name="password" value="welcome123">
            </div>
            <div class="field full actions">
              <button class="button primary" type="submit">Create Employee</button>
            </div>
          </form>
        </div>
      </section>
      <section class="section">
        <div class="section-header">
          <h2 class="section-title">Employee Directory</h2>
          <div class="directory-tools">
            <label class="search-field" for="employee-search">
              <span>Search</span>
              <input id="employee-search" data-action="employee-search" type="search" placeholder="Name, email, role, or direct report">
            </label>
            <button class="button primary" data-action="save-all-employees">Save All</button>
          </div>
        </div>
        <div class="section-body">
          <div class="employee-directory">
          ${state.dashboard.allEmployees.map((employee) => `
            <div class="employee-row" data-employee-id="${employee.id}" data-search="${escapeHtml(employeeSearchText(employee))}">
              <div class="field">
                <label>Name</label>
                <input data-field="name" value="${escapeHtml(employee.name)}">
              </div>
              <div class="field">
                <label>Email</label>
                <input data-field="email" type="email" value="${escapeHtml(employee.email)}">
              </div>
              <div class="field">
                <label>Role</label>
                <select data-field="role">
                  <option value="employee" ${employee.role === "employee" ? "selected" : ""}>Employee</option>
                  <option value="manager" ${employee.role === "manager" ? "selected" : ""}>Direct Report</option>
                  <option value="admin" ${employee.role === "admin" ? "selected" : ""}>Admin</option>
                </select>
              </div>
              <div class="field">
                <label>Direct Report</label>
                <select data-field="managerId">${managerOptions(managerChoices, employee.managerId, employee.id)}</select>
              </div>
              <div class="field">
                <label>Service Start</label>
                <input data-field="serviceStartDate" type="date" value="${escapeHtml(employee.serviceStartDate || "")}">
              </div>
              <div class="field">
                <label>Annual Leave Days</label>
                <input data-field="startingLeaveEntitlement" type="number" min="0" step="0.5" value="${employee.annualLeaveEntitlement ?? employee.startingLeaveEntitlement}">
              </div>
              <div class="field">
                <label>Current Total Leave</label>
                <input type="number" value="${employee.leaveEntitlement}" disabled>
              </div>
              <div class="field">
                <label>Medical Limit</label>
                <input data-field="medicalClaimLimit" type="number" min="0" step="0.01" value="${employee.medicalClaimLimit}">
              </div>
              <div class="field">
                <label>Active</label>
                <select data-field="active">
                  <option value="true" ${employee.active ? "selected" : ""}>Yes</option>
                  <option value="false" ${!employee.active ? "selected" : ""}>No</option>
                </select>
              </div>
              <div class="field row-actions">
                <label>Actions</label>
                <div class="employee-action-bar">
                  <button class="button primary small" data-action="save-employee" data-id="${employee.id}">Save</button>
                  <details class="action-menu">
                    <summary class="button small">More</summary>
                    <div class="action-menu-list">
                      <button class="button small" type="button" data-action="open-leave-adjustment" data-id="${employee.id}">Adjust Leave</button>
                      <button class="button small" type="button" data-action="open-password-reset" data-id="${employee.id}">Reset Password</button>
                    </div>
                  </details>
                </div>
              </div>
            </div>
          `).join("")}
          </div>
          <div class="empty" data-empty="employee-search" hidden>No employees match that search.</div>
        </div>
      </section>
      <section class="section">
        <div class="section-header">
          <h2 class="section-title">Recent Leave Adjustments</h2>
        </div>
        ${renderLeaveAdjustmentHistory()}
      </section>
    </div>
  `);
}

function renderMailList(emails) {
  if (!emails.length) return `<div class="empty">No email notifications yet.</div>`;
  return `
    <div>
      ${emails.map((email) => `
        <article class="mail-item">
          <div class="mail-subject">${escapeHtml(email.subject)}</div>
          <div class="mail-meta">To ${escapeHtml(email.to)} - ${dateTimeText(email.createdAt)}</div>
          <div>${escapeHtml(email.body)}</div>
        </article>
      `).join("")}
    </div>
  `;
}

function renderMail() {
  ensureMailLoaded();
  const emails = state.mail.items;
  const remaining = Math.max(0, Number(state.mail.total || 0) - emails.length);
  renderShell(`
    ${renderTopbar("Email Outbox", "Local email notifications generated by leave and claim workflows.")}
    <section class="section">
      ${state.mail.loading && !emails.length ? `<div class="empty">Loading email notifications...</div>` : renderMailList(emails)}
      ${remaining > 0 ? `
        <div class="history-more">
          <button class="button small" data-action="mail-load-more">
            ${state.mail.loading ? "Loading..." : "Load More"}
          </button>
          <span class="muted">${emails.length} of ${state.mail.total} shown</span>
        </div>
      ` : ""}
    </section>
  `);
}

function auditActionLabel(action) {
  const labels = {
    "account.password_changed": "Password Changed",
    "employee.created": "Employee Created",
    "employee.updated": "Employee Updated",
    "employee.password_reset": "Password Reset",
    "leave.submitted": "Leave Submitted",
    "leave.approved": "Leave Approved",
    "leave.rejected": "Leave Not Approved",
    "leave.adjustment_added": "Leave Added",
    "leave.adjustment_deducted": "Leave Deducted",
    "maintenance.leave_rollover": "Leave Rollover",
    "maintenance.service_anniversary_accrual": "Service Accrual",
    "maintenance.receipt_retention": "Receipt Retention",
    "claim.submitted": "Claim Submitted",
    "claim.approved": "Claim Approved",
    "claim.rejected": "Claim Not Approved"
  };
  return labels[action] || action;
}

function renderAuditTable(events) {
  if (!events.length) return `<div class="empty">No audit entries found.</div>`;
  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Action</th>
            <th>Actor</th>
            <th>Affected Employee</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          ${events.map((event) => `
            <tr>
              <td data-label="Date">${dateTimeText(event.createdAt)}</td>
              <td data-label="Action">
                <strong>${escapeHtml(auditActionLabel(event.action))}</strong>
                ${event.relatedType ? `<div class="muted">${escapeHtml(event.relatedType)}</div>` : ""}
              </td>
              <td data-label="Actor">
                <strong>${escapeHtml(event.actorName || "System")}</strong>
                <div class="muted">${escapeHtml(event.actorEmail || event.actorRole || "")}</div>
              </td>
              <td data-label="Affected Employee">${escapeHtml(event.affectedUserName || "-")}</td>
              <td data-label="Details">
                ${escapeHtml(event.summary || "")}
                ${event.relatedId ? `<div class="muted">Record ${escapeHtml(event.relatedId)}</div>` : ""}
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderAuditLog() {
  ensureAuditLoaded();
  const events = state.audit.items || [];
  const remaining = Math.max(0, Number(state.audit.total || 0) - events.length);
  renderShell(`
    ${renderTopbar("Audit Log", "Admin-only record of key leave, claim, account, and employee changes.")}
    <section class="section">
      <div class="section-header history-header">
        <div class="history-heading">
          <h2 class="section-title">Activity</h2>
          <div class="history-tools audit-tools">
            <label class="filter-field search" for="audit-search">
              <span>Search</span>
              <input id="audit-search" data-audit-search type="search" value="${escapeHtml(state.audit.query)}" placeholder="Employee, actor, action, or record ID">
            </label>
          </div>
        </div>
      </div>
      ${state.audit.loading && !events.length ? `<div class="empty">Loading audit log...</div>` : renderAuditTable(events)}
      ${remaining > 0 ? `
        <div class="history-more">
          <button class="button small" data-action="audit-load-more">
            ${state.audit.loading ? "Loading..." : "Load More"}
          </button>
          <span class="muted">${events.length} of ${state.audit.total} shown</span>
        </div>
      ` : ""}
    </section>
  `);
}

function renderAccount() {
  const { user } = state.dashboard;
  renderShell(`
    ${renderTopbar("Account", "Profile and password.")}
    <div class="content-grid">
      <section class="section">
        <div class="section-header">
          <h2 class="section-title">Profile</h2>
        </div>
        <div class="detail-grid">
          <div>
            <div class="metric-label">Name</div>
            <div class="detail-value">${escapeHtml(user.name)}</div>
          </div>
          <div>
            <div class="metric-label">Email</div>
            <div class="detail-value">${escapeHtml(user.email)}</div>
          </div>
          <div>
            <div class="metric-label">Role</div>
            <div class="detail-value">${roleName(user.role)}</div>
          </div>
        </div>
      </section>
      <section class="section">
        <div class="section-header">
          <h2 class="section-title">Change Password</h2>
        </div>
        <div class="section-body">
          <form class="form-grid" data-form="password">
            <div class="field">
              <label for="current-password">Current Password</label>
              <input id="current-password" name="currentPassword" type="password" autocomplete="current-password" required>
            </div>
            <div class="field">
              <label for="new-password">New Password</label>
              <input id="new-password" name="newPassword" type="password" autocomplete="new-password" minlength="8" required>
            </div>
            <div class="field">
              <label for="confirm-password">Confirm New Password</label>
              <input id="confirm-password" name="confirmPassword" type="password" autocomplete="new-password" minlength="8" required>
            </div>
            <div class="field">
              <label>&nbsp;</label>
              <button class="button primary" type="submit">Change Password</button>
            </div>
          </form>
        </div>
      </section>
    </div>
  `);
}

function render() {
  if (!state.dashboard) return renderLogin();
  if (state.activeTab === "leave") return renderLeave();
  if (state.activeTab === "claims") return renderClaims();
  if (state.activeTab === "approvals") return renderApprovals();
  if (state.activeTab === "employees" && isAdmin()) return renderEmployees();
  if (state.activeTab === "audit" && isAdmin()) return renderAuditLog();
  if (state.activeTab === "account") return renderAccount();
  if (state.activeTab === "mail") return renderMail();
  return renderOverview();
}

function formObject(form) {
  return Object.fromEntries(new FormData(form).entries());
}

async function refreshDashboard() {
  const data = await api("/api/dashboard");
  updateDashboard(data);
}

document.addEventListener("submit", async (event) => {
  const form = event.target;
  const formType = form.dataset.form;
  if (!formType) return;
  event.preventDefault();
  if (form.dataset.submitting === "true") {
    showToast("Please wait for this submission to finish.", "error");
    return;
  }

  const body = formObject(form);
  const submittingLabel = formType === "claim" ? "Submitting Claim..." : "Submitting...";
  try {
    setFormSubmitting(form, true, submittingLabel);
    state.busy = true;
    if (formType === "login") {
      const data = await api("/api/login", {
        method: "POST",
        body: JSON.stringify(body)
      });
      updateDashboard(data);
      showToast("Signed in.");
    }
    if (formType === "leave") {
      const data = await api("/api/leave-requests", {
        method: "POST",
        body: JSON.stringify(body)
      });
      form.reset();
      updateDashboard(data);
      showToast("Leave application submitted.");
    }
    if (formType === "claim") {
      const claimPayload = await claimFormPayload(form, body);
      const data = await api("/api/claims", {
        method: "POST",
        body: claimPayload.body
      });
      form.reset();
      updateDashboard(data);
      showToast(`${claimTypeLabel(claimPayload.claimType)} submitted.`);
    }
    if (formType === "employee") {
      const data = await api("/api/employees", {
        method: "POST",
        body: JSON.stringify(body)
      });
      form.reset();
      updateDashboard(data);
      showToast("Employee created.");
    }
    if (formType === "leave-adjustment") {
      const data = await api("/api/leave-adjustments", {
        method: "POST",
        body: JSON.stringify(body)
      });
      form.reset();
      const daysInput = form.querySelector("input[name='days']");
      if (daysInput) daysInput.value = "0.5";
      updateDashboard(data);
      showToast("Leave adjustment applied.");
    }
    if (formType === "password") {
      const data = await api("/api/account/password", {
        method: "POST",
        body: JSON.stringify(body)
      });
      form.reset();
      updateDashboard(data);
      showToast("Password changed.");
    }
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    state.busy = false;
    if (form.isConnected) setFormSubmitting(form, false);
  }
});

document.addEventListener("click", async (event) => {
  if (event.target.classList?.contains("modal-backdrop")) {
    state.passwordReset = { employeeId: null };
    state.leaveAdjustment = { employeeId: null };
    render();
    return;
  }

  const button = event.target.closest("[data-action]");
  if (!button) return;
  const action = button.dataset.action;

  try {
    if (action === "tab") {
      state.activeTab = button.dataset.tab;
      render();
    }

    if (action === "logout") {
      await api("/api/logout", { method: "POST", body: "{}" });
      state.dashboard = null;
      state.activeTab = "overview";
      render();
    }

    if (action === "decide") {
      const note = document.querySelector(`[data-note-for="${button.dataset.id}"]`)?.value || "";
      const path = button.dataset.kind === "leave"
        ? `/api/leave-requests/${button.dataset.id}/status`
        : `/api/claims/${button.dataset.id}/status`;
      const data = await api(path, {
        method: "PATCH",
        body: JSON.stringify({
          status: button.dataset.status,
          decisionNote: note
        })
      });
      updateDashboard(data);
      showToast(button.dataset.status === "approved" ? "Approved." : "Not approved.");
    }

    if (action === "save-employee") {
      const row = button.closest("[data-employee-id]");
      const data = await api(`/api/employees/${button.dataset.id}`, {
        method: "PATCH",
        body: JSON.stringify(employeeRowBody(row))
      });
      updateDashboard(data);
      showToast("Employee updated.");
    }

    if (action === "open-password-reset") {
      state.passwordReset = { employeeId: button.dataset.id };
      render();
    }

    if (action === "close-password-reset") {
      state.passwordReset = { employeeId: null };
      render();
    }

    if (action === "open-leave-adjustment") {
      state.leaveAdjustment = { employeeId: button.dataset.id };
      render();
    }

    if (action === "close-leave-adjustment") {
      state.leaveAdjustment = { employeeId: null };
      render();
    }

    if (action === "confirm-password-reset") {
      const input = document.querySelector("[data-password-reset-input]");
      const password = String(input?.value || "").trim();
      if (!password) {
        showToast("Enter a new temporary password first.", "error");
        return;
      }
      if (password.length < 8) {
        showToast("Temporary password must be at least 8 characters.", "error");
        return;
      }

      const data = await api(`/api/employees/${button.dataset.id}/password`, {
        method: "POST",
        body: JSON.stringify({ password })
      });
      updateDashboard(data);
      showToast("Temporary password reset.");
    }

    if (action === "save-all-employees") {
      const rows = [...document.querySelectorAll("[data-employee-id]")];
      if (!rows.length) {
        showToast("No employees to save.", "error");
        return;
      }

      button.disabled = true;
      const data = await api("/api/employees/bulk", {
        method: "PATCH",
        body: JSON.stringify({
          employees: rows.map((row) => ({
            id: row.dataset.employeeId,
            ...employeeRowBody(row)
          }))
        })
      });
      updateDashboard(data);
      showToast(`${rows.length} employee record${rows.length === 1 ? "" : "s"} saved.`);
    }

    if (action === "history-load-more") {
      const kind = button.dataset.kind;
      await loadHistory(kind, { append: true });
    }

    if (action === "mail-load-more") {
      await loadMail({ append: true });
    }

    if (action === "audit-load-more") {
      await loadAudit({ append: true });
    }
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    if (button) button.disabled = false;
  }
});

document.addEventListener("input", (event) => {
  const input = event.target.closest("[data-action='employee-search']");
  if (!input) return;

  const query = input.value.trim().toLowerCase();
  const rows = [...document.querySelectorAll("[data-employee-id]")];
  let visible = 0;
  rows.forEach((row) => {
    const match = !query || row.dataset.search.includes(query);
    row.hidden = !match;
    if (match) visible += 1;
  });
  const empty = document.querySelector("[data-empty='employee-search']");
  if (empty) empty.hidden = visible > 0;
});

function updateAuditSearch(field) {
  state.audit.query = field.value;
  resetAuditResults();
  if (auditSearchTimer) clearTimeout(auditSearchTimer);
  auditSearchTimer = setTimeout(() => {
    auditSearchTimer = null;
    loadAudit();
  }, 500);
}

document.addEventListener("input", (event) => {
  const field = event.target.closest("[data-audit-search]");
  if (!field) return;
  updateAuditSearch(field);
});

function updateHistoryFilter(field) {
  const kind = field.dataset.historyKind;
  const filterField = field.dataset.historyField;
  if (!kind || !filterField) return;

  const cursorStart = field.selectionStart;
  const cursorEnd = field.selectionEnd;
  state.history[kind][filterField] = field.value;
  resetHistoryResults(kind);
  render();

  const nextField = document.getElementById(field.id);
  if (!nextField) return;
  nextField.focus();
  if (filterField === "query" && Number.isInteger(cursorStart) && Number.isInteger(cursorEnd)) {
    nextField.setSelectionRange(cursorStart, cursorEnd);
  }
}

document.addEventListener("change", (event) => {
  const field = event.target.closest("[data-history-kind]");
  if (!field || field.dataset.historyField === "query") return;
  updateHistoryFilter(field);
});

document.addEventListener("input", (event) => {
  const field = event.target.closest("[data-history-kind][data-history-field='query']");
  if (!field) return;
  updateHistoryFilter(field);
});

api("/api/session")
  .then(updateDashboard)
  .catch(() => renderLogin());
