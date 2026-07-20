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
  },
  entitlementEmployeeId: null,
  sidebarQuote: null
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
const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
let lastRenderedTab = null;
const INSPIRATIONAL_QUOTES = [
  {
    text: "Trust thyself: every heart vibrates to that iron string.",
    author: "Ralph Waldo Emerson",
    source: "Essays"
  },
  {
    text: "Simplify, simplify.",
    author: "Henry David Thoreau",
    source: "Walden"
  },
  {
    text: "The best kind of revenge is, not to become like unto them.",
    author: "Marcus Aurelius",
    source: "Meditations"
  },
  {
    text: "Resolve to perform what you ought; perform without fail what you resolve.",
    author: "Benjamin Franklin",
    source: "Autobiography"
  },
  {
    text: "The beginning is the most important part of any work.",
    author: "Plato",
    source: "The Republic"
  },
  {
    text: "Men are disturbed not by things, but by the views which they take of things.",
    author: "Epictetus",
    source: "The Enchiridion"
  },
  {
    text: "The highest excellence is like that of water.",
    author: "Laozi",
    source: "Tao Teh King"
  },
  {
    text: "Knowledge can be conveyed, but not wisdom.",
    author: "Hermann Hesse",
    source: "Siddhartha"
  },
  {
    text: "I am not afraid of storms, for I am learning how to sail my ship.",
    author: "Louisa May Alcott",
    source: "Little Women"
  },
  {
    text: "Think only of the past as its remembrance gives you pleasure.",
    author: "Jane Austen",
    source: "Pride and Prejudice"
  },
  {
    text: "Nothing contributes so much to tranquillise the mind as a steady purpose.",
    author: "Mary Wollstonecraft Shelley",
    source: "Frankenstein"
  },
  {
    text: "I will honour Christmas in my heart, and try to keep it all the year.",
    author: "Charles Dickens",
    source: "A Christmas Carol"
  },
  {
    text: "Begin at the beginning, and go on till you come to the end: then stop.",
    author: "Lewis Carroll",
    source: "Alice's Adventures in Wonderland"
  },
  {
    text: "In the midst of difficulties we are always ready to seize an advantage.",
    author: "Sun Tzu",
    source: "The Art of War"
  },
  {
    text: "There is nothing more difficult to take in hand than to take the lead in a new order of things.",
    author: "Niccolo Machiavelli",
    source: "The Prince"
  },
  {
    text: "She stopped worrying and resolved to wait calmly and see what the future would bring.",
    author: "L. Frank Baum",
    source: "The Wonderful Wizard of Oz"
  },
  {
    text: "The Vision that you glorify in your mind, the Ideal that you enthrone in your heart, this you will become.",
    author: "James Allen",
    source: "As a Man Thinketh"
  },
  {
    text: "The strength of the effort is the measure of the result.",
    author: "James Allen",
    source: "As a Man Thinketh"
  },
  {
    text: "Calmness of mind is one of the beautiful jewels of wisdom.",
    author: "James Allen",
    source: "As a Man Thinketh"
  },
  {
    text: "Let all your things have their places; let each part of your business have its time.",
    author: "Benjamin Franklin",
    source: "Autobiography"
  },
  {
    text: "Speak not but what may benefit others or yourself.",
    author: "Benjamin Franklin",
    source: "Autobiography"
  },
  {
    text: "Make no expense but to do good to others or yourself.",
    author: "Benjamin Franklin",
    source: "Autobiography"
  },
  {
    text: "If words of command are not clear and distinct, the general is to blame.",
    author: "Sun Tzu",
    source: "The Art of War"
  },
  {
    text: "The work is accomplished, and there is no resting in it.",
    author: "Laozi",
    source: "Tao Teh King"
  },
  {
    text: "The excellence of water appears in its benefiting all things.",
    author: "Laozi",
    source: "Tao Teh King"
  },
  {
    text: "Your inner being guard, and keep it free.",
    author: "Laozi",
    source: "Tao Teh King"
  },
  {
    text: "The more tranquil a man becomes, the greater is his success, his influence, his power for good.",
    author: "James Allen",
    source: "As a Man Thinketh"
  },
  {
    text: "Do all things as becometh the disciple of Antoninus Pius.",
    author: "Marcus Aurelius",
    source: "Meditations"
  },
  {
    text: "Let this be thy only joy, from one sociable kind action to pass unto another.",
    author: "Marcus Aurelius",
    source: "Meditations"
  },
  {
    text: "I will be cool, persevering, and prudent.",
    author: "Mary Wollstonecraft Shelley",
    source: "Frankenstein"
  }
];

function randomQuote() {
  return INSPIRATIONAL_QUOTES[Math.floor(Math.random() * INSPIRATIONAL_QUOTES.length)];
}

function renderQuote(quote, className = "") {
  if (!quote) return "";
  return `
    <figure class="quote-block ${className}">
      <blockquote>&quot;${escapeHtml(quote.text)}&quot;</blockquote>
      <figcaption>- ${escapeHtml(quote.author)}</figcaption>
    </figure>
  `;
}

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

function claimExportEmployees() {
  const employees = state.dashboard?.allEmployees || state.dashboard?.users || [];
  return employees
    .slice()
    .sort((left, right) => String(left.name || "").localeCompare(String(right.name || "")));
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
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-SG", {
      timeZone: "Asia/Singapore",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(new Date()).map((part) => [part.type, part.value])
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
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
  if (status === "cancelled") return "Cancelled";
  return "Pending";
}

function emailDeliveryText(email) {
  if (email.delivered) return `Delivered${email.deliveredAt ? ` ${dateTimeText(email.deliveredAt)}` : ""}`;
  if (email.deliveryError) return `Failed: ${email.deliveryError}`;
  return "Queued locally";
}

function signedDays(value) {
  const days = Number(value || 0);
  return `${days > 0 ? "+" : ""}${days}`;
}

function annualLeaveDisplay(value) {
  return state.dashboard?.user?.unlimitedAnnualLeave ? "Unlimited" : value;
}

function showToast(message, type = "ok") {
  let stack = document.querySelector(".toast-stack");
  if (!stack) {
    stack = document.createElement("div");
    stack.className = "toast-stack";
    stack.setAttribute("aria-live", "polite");
    stack.setAttribute("aria-atomic", "false");
    document.body.append(stack);
  }

  const visibleToasts = [...stack.querySelectorAll(".toast")];
  visibleToasts.slice(0, Math.max(0, visibleToasts.length - 2)).forEach((item) => item.remove());

  const toast = document.createElement("div");
  toast.className = `toast ${type === "error" ? "error" : "success"}`;
  toast.setAttribute("role", type === "error" ? "alert" : "status");
  toast.innerHTML = `
    <span class="toast-icon" aria-hidden="true">${type === "error" ? "!" : "OK"}</span>
    <span class="toast-message">${escapeHtml(message)}</span>
  `;
  stack.append(toast);

  const dismiss = () => {
    toast.classList.add("toast-exit");
    setTimeout(() => toast.remove(), 180);
  };
  setTimeout(dismiss, type === "error" ? 5600 : 3800);
}

function renderLoadingState(label, variant = "list") {
  const rows = variant === "table" ? 5 : 3;
  return `
    <div class="empty loading-state" aria-busy="true" aria-live="polite">
      <div class="loading-copy">${escapeHtml(label)}</div>
      <div class="skeleton-stack ${variant === "table" ? "table" : ""}" aria-hidden="true">
        ${Array.from({ length: rows }, (_item, index) => `
          <div class="skeleton-row">
            <span class="skeleton-line wide"></span>
            <span class="skeleton-line ${index % 2 ? "short" : "medium"}"></span>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

function shouldReduceMotion() {
  return reducedMotionQuery.matches;
}

function animateElement(element, keyframes, options) {
  if (!element || shouldReduceMotion() || !element.animate) return;
  element.animate(keyframes, {
    duration: 220,
    easing: "cubic-bezier(.16, 1, .3, 1)",
    fill: "both",
    ...options
  });
}

function staggerElements(elements, options = {}) {
  if (shouldReduceMotion()) return;
  [...elements].slice(0, options.limit || 24).forEach((element, index) => {
    animateElement(
      element,
      [
        { opacity: 0, transform: `translateY(${options.distance || 8}px)` },
        { opacity: 1, transform: "translateY(0)" }
      ],
      {
        duration: options.duration || 260,
        delay: Math.min(index * (options.step || 24), options.maxDelay || 180)
      }
    );
  });
}

function runPostRenderMotion({ viewChanged = false } = {}) {
  if (shouldReduceMotion()) return;

  requestAnimationFrame(() => {
    const modalBackdrop = app.querySelector(".modal-backdrop");
    if (modalBackdrop) {
      animateElement(modalBackdrop, [{ opacity: 0 }, { opacity: 1 }], { duration: 180 });
      animateElement(
        modalBackdrop.querySelector(".modal"),
        [
          { opacity: 0, transform: "translateY(10px) scale(.985)" },
          { opacity: 1, transform: "translateY(0) scale(1)" }
        ],
        { duration: 260 }
      );
    }

    if (viewChanged) {
      staggerElements(app.querySelectorAll(".login-shell, .topbar, .content-grid > *"), {
        distance: 10,
        duration: 300,
        step: 36,
        limit: 18,
        maxDelay: 220
      });
    }

    staggerElements(app.querySelectorAll("tbody tr, .employee-row, .employee-request-card, .mail-item, .empty"), {
      distance: 6,
      duration: 220,
      step: 18,
      limit: 28,
      maxDelay: 140
    });
  });
}

async function animateDialogClose() {
  const modalBackdrop = app.querySelector(".modal-backdrop");
  const modal = modalBackdrop?.querySelector(".modal");
  if (!modalBackdrop || shouldReduceMotion() || !modalBackdrop.animate) return;

  const animations = [
    modalBackdrop.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: 150,
      easing: "cubic-bezier(.2, 0, 0, 1)",
      fill: "forwards"
    })
  ];

  if (modal?.animate) {
    animations.push(
      modal.animate(
        [
          { opacity: 1, transform: "translateY(0) scale(1)" },
          { opacity: 0, transform: "translateY(6px) scale(.99)" }
        ],
        {
          duration: 170,
          easing: "cubic-bezier(.2, 0, 0, 1)",
          fill: "forwards"
        }
      )
    );
  }

  await Promise.all(animations.map((animation) => animation.finished.catch(() => {})));
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

function upsertById(list, item) {
  if (!item) return Array.isArray(list) ? list : [];
  const current = Array.isArray(list) ? list : [];
  const index = current.findIndex((entry) => entry.id === item.id);
  if (index === -1) return [item, ...current];
  return current.map((entry) => (entry.id === item.id ? item : entry));
}

function upsertPendingById(list, item) {
  if (!item) return Array.isArray(list) ? list : [];
  const current = Array.isArray(list) ? list : [];
  const withoutItem = current.filter((entry) => entry.id !== item.id);
  return item.status === "pending" ? [item, ...withoutItem] : withoutItem;
}

function mergeEmployee(employee) {
  if (!state.dashboard || !employee) return;
  state.dashboard.userById = {
    ...(state.dashboard.userById || {}),
    [employee.id]: employee
  };
  if (state.dashboard.user?.id === employee.id) {
    state.dashboard.user = employee;
  }
  if (Array.isArray(state.dashboard.users)) {
    state.dashboard.users = upsertById(state.dashboard.users, employee);
  }
  if (Array.isArray(state.dashboard.allEmployees)) {
    state.dashboard.allEmployees = upsertById(state.dashboard.allEmployees, employee);
  }
  if (Array.isArray(state.dashboard.teamMembers)) {
    state.dashboard.teamMembers = (state.dashboard.allEmployees || state.dashboard.teamMembers)
      .filter((item) => item.managerId === state.dashboard.user.id);
  }
}

function applyDashboardPatch(patch = {}) {
  if (!state.dashboard) return;
  [
    "leaveSummary",
    "medicalLeaveSummary",
    "medicalClaimSummary",
    "generalClaimSummary",
    "leaveEntitlementSummaries",
    "leavePolicySettings",
    "receiptStorageSummary",
    "leaveAdjustments",
    "emails",
    "counts"
  ].forEach((key) => {
    if (patch[key] !== undefined) state.dashboard[key] = patch[key];
  });

  if (patch.user) mergeEmployee(patch.user);
}

function markStale(stale = {}) {
  if (Array.isArray(stale.history)) {
    stale.history.forEach((kind) => resetHistoryResults(kind));
  }
  if (stale.mail) resetMailResults();
  if (stale.audit) resetAuditResults();
}

function updateDashboard(data) {
  if (data.dashboard || data.userById) {
    state.dashboard = data.dashboard;
    if (!state.dashboard) state.dashboard = data;
    state.passwordReset = { employeeId: null };
    state.leaveAdjustment = { employeeId: null };
    resetHistoryResults();
    resetMailResults();
    resetAuditResults();
    render();
    return;
  }

  if (!state.dashboard) {
    state.dashboard = data;
    render();
    return;
  }

  if (data.patch) applyDashboardPatch(data.patch);
  if (data.request) {
    state.dashboard.leaveRequests = upsertPendingById(state.dashboard.leaveRequests, data.request);
  }
  if (data.claim) {
    state.dashboard.medicalClaims = upsertPendingById(state.dashboard.medicalClaims, data.claim);
  }
  if (data.employee) {
    mergeEmployee(data.employee);
  }
  if (Array.isArray(data.employees)) {
    data.employees.forEach(mergeEmployee);
  }
  markStale(data.stale);

  state.passwordReset = { employeeId: null };
  state.leaveAdjustment = { employeeId: null };
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
    { value: "rejected", label: "Not Approved" },
    ...(kind === "leave" ? [{ value: "cancelled", label: "Cancelled" }] : [])
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
    ? renderLoadingState(`Loading ${kind === "leave" ? "leave" : "claim"} history`, "table")
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

function assertAttachmentFile(file, label = "Receipt") {
  if (file.size > MAX_RECEIPT_BYTES) {
    throw new Error(`${label} upload must be 5 MB or smaller.`);
  }

  const type = String(file.type || "").toLowerCase();
  const extension = receiptExtension(file.name);
  if (!RECEIPT_MIME_TYPES.has(type) && !RECEIPT_EXTENSIONS.has(extension)) {
    throw new Error(`${label} must be ${RECEIPT_HELP_TEXT}`);
  }
}

function assertReceiptFile(file) {
  assertAttachmentFile(file, "Receipt");
}

function assertMedicalCertificateFile(file) {
  assertAttachmentFile(file, "Medical Certificate");
}

function isMedicalLeaveType(type) {
  return String(type || "").trim().toLowerCase() === "medical leave";
}

function requiresMedicalCertificate(type) {
  const normalizedType = String(type || "").trim().toLowerCase();
  return normalizedType === "medical leave" || normalizedType === "hospitalization leave";
}

function isNationalServiceLeave(type) {
  return String(type || "").trim().toLowerCase() === "national service leave";
}

function leavePolicyEnforcementEnabled(type) {
  const normalizedType = String(type || "").trim().toLowerCase();
  return Boolean(state.dashboard?.leavePolicySettings?.find(
    (setting) => String(setting.leaveType || "").trim().toLowerCase() === normalizedType
  )?.enforcementEnabled);
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
      submitButton.setAttribute("aria-busy", "true");
    } else if (submitButton.dataset.originalText) {
      submitButton.textContent = submitButton.dataset.originalText;
      delete submitButton.dataset.originalText;
      submitButton.removeAttribute("aria-busy");
    } else {
      submitButton.removeAttribute("aria-busy");
    }
  }
  form.querySelectorAll("input, select, textarea, button").forEach((control) => {
    control.disabled = submitting;
  });
}

function formSubmittingLabel(formType) {
  return {
    login: "Signing in...",
    leave: "Submitting Leave...",
    claim: "Submitting Claim...",
    employee: "Creating Employee...",
    "leave-adjustment": "Applying Adjustment...",
    "entitlement-adjustment": "Applying Adjustment...",
    "leave-entitlement": "Creating Grant...",
    "work-schedule": "Saving Schedule...",
    password: "Changing Password..."
  }[formType] || "Submitting...";
}

function busyButtonScope(button) {
  return button.closest(".decision-box") ||
    button.closest(".employee-action-bar") ||
    button.closest(".modal-actions") ||
    button.closest(".history-more");
}

async function withButtonBusy(button, label, work) {
  if (button.dataset.busy === "true") {
    showToast("Please wait for this action to finish.", "error");
    return null;
  }

  const scope = busyButtonScope(button);
  const controls = scope ? [...scope.querySelectorAll("button")] : [button];
  controls.forEach((control) => {
    control.dataset.wasDisabled = control.disabled ? "true" : "false";
    control.disabled = true;
  });
  button.dataset.busy = "true";
  button.setAttribute("aria-busy", "true");
  button.dataset.originalText = button.dataset.originalText || button.textContent;
  button.textContent = label;

  try {
    return await work();
  } finally {
    controls.forEach((control) => {
      if (!control.isConnected) return;
      control.disabled = control.dataset.wasDisabled === "true";
      delete control.dataset.wasDisabled;
    });
    if (button.isConnected) {
      if (button.dataset.originalText) {
        button.textContent = button.dataset.originalText;
        delete button.dataset.originalText;
      }
      button.removeAttribute("aria-busy");
      delete button.dataset.busy;
    }
  }
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

async function uploadMedicalCertificateToSignedUrl(upload, file) {
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
    throw new Error(`Medical Certificate upload failed: ${text || response.statusText}`);
  }
}

async function uploadSupportingDocumentToSignedUrl(upload, file) {
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
    throw new Error(`Supporting document upload failed: ${text || response.statusText}`);
  }
}

async function leaveFormPayload(form, body) {
  const medicalDocument = requiresMedicalCertificate(body.type);
  const nationalServiceDocument = isNationalServiceLeave(body.type) &&
    leavePolicyEnforcementEnabled(body.type);
  if (!medicalDocument && !nationalServiceDocument) {
    const leaveBody = { ...body };
    delete leaveBody.supportingDocument;
    return { body: JSON.stringify(leaveBody) };
  }

  const file = form.querySelector("input[type='file'][name='supportingDocument']")?.files?.[0];
  const documentLabel = nationalServiceDocument ? "Official Call-Up Notice" : "Medical Certificate";
  if (!file) {
    throw new Error(`Please upload ${nationalServiceDocument ? "an" : "a"} ${documentLabel} for ${body.type}.`);
  }
  assertAttachmentFile(file, documentLabel);

  const leaveBody = { ...body };
  delete leaveBody.supportingDocument;
  const uploadEndpoint = nationalServiceDocument
    ? "/api/leave-supporting-documents/upload-url"
    : "/api/leave-medical-certificates/upload-url";
  const upload = await api(uploadEndpoint, {
    method: "POST",
    body: JSON.stringify({
      name: file.name,
      type: file.type || "application/octet-stream",
      size: file.size
    })
  });
  if (upload.direct) {
    if (nationalServiceDocument) await uploadSupportingDocumentToSignedUrl(upload, file);
    else await uploadMedicalCertificateToSignedUrl(upload, file);
    const uploadMetadata = {
      storage: upload.storage,
      bucket: upload.bucket,
      storedName: upload.storedName,
      originalName: upload.originalName,
      mimeType: upload.mimeType,
      size: upload.size
    };
    if (nationalServiceDocument) leaveBody.supportingDocumentUpload = uploadMetadata;
    else leaveBody.medicalCertificateUpload = uploadMetadata;
    return { body: JSON.stringify(leaveBody) };
  }

  const formData = new FormData();
  Object.entries(leaveBody).forEach(([key, value]) => formData.set(key, value));
  formData.set(nationalServiceDocument ? "supportingDocument" : "medicalCertificate", file, file.name);
  return { body: formData };
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

  const formData = new FormData();
  Object.entries(claimBody).forEach(([key, value]) => formData.set(key, value));
  formData.set("receipt", file, file.name);
  return { body: formData, claimType };
}

function renderLogin() {
  lastRenderedTab = "login";
  const quote = randomQuote();
  app.innerHTML = `
    <main class="login-page">
      <section class="login-shell">
        <div class="login-panel">
          <div>
            <div class="brand-mark">CLS</div>
            <h1>Leave & Claims</h1>
            <p>Welcome to the Chye Lee & Sons Leave & Claims System.</p>
          </div>
          ${renderQuote(quote, "login-quote")}
        </div>
        <form class="login-card" data-form="login">
          <h2>Sign in</h2>
          <p>Use your CLS account details.</p>
          <div class="content-grid" style="margin-top: 28px;">
            <div class="field">
              <label for="email">Email</label>
              <input id="email" name="email" type="email" autocomplete="username" required>
            </div>
            <div class="field">
              <label for="password">Password</label>
              <input id="password" name="password" type="password" autocomplete="current-password" required>
            </div>
            <button class="button primary" type="submit">Sign in</button>
          </div>
        </form>
      </section>
    </main>
  `;
  runPostRenderMotion({ viewChanged: true });
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
  const viewChanged = lastRenderedTab !== state.activeTab;
  lastRenderedTab = state.activeTab;
  if (!state.sidebarQuote) state.sidebarQuote = randomQuote();
  app.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="brand">
          <div class="brand-mark">CLS</div>
          <div>
            <div class="brand-title">Leave & Claims</div>
            <div class="brand-subtitle">Company portal</div>
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
        ${renderQuote(state.sidebarQuote, "sidebar-quote")}
        <button class="button ghost" data-action="logout">Sign out</button>
      </aside>
      <main class="main">
        ${content}
      </main>
    </div>
    ${renderPasswordResetDialog()}
    ${renderLeaveAdjustmentDialog()}
  `;
  runPostRenderMotion({ viewChanged });
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
  const medicalSummary = state.dashboard.medicalLeaveSummary || {
    entitlement: 14,
    available: 14,
    pending: 0,
    approved: 0
  };
  return `
    <section class="metrics">
      <div class="metric">
        <div class="metric-label">Available Leave</div>
        <div class="metric-value">${annualLeaveDisplay(summary.available)}</div>
      </div>
      <div class="metric">
        <div class="metric-label">Yearly Allotment</div>
        <div class="metric-value">${annualLeaveDisplay(summary.entitlement)}</div>
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
      <div class="metric">
        <div class="metric-label">Medical Leave Available</div>
        <div class="metric-value">${medicalSummary.available}</div>
      </div>
      <div class="metric">
        <div class="metric-label">Medical Leave Pending</div>
        <div class="metric-value">${medicalSummary.pending}</div>
      </div>
    </section>
  `;
}

function renderEmployeeLeaveHero() {
  const { user, leaveSummary: summary } = state.dashboard;
  if (user.role !== "employee" || !summary) return "";

  const isUnlimited = Boolean(user.unlimitedAnnualLeave);
  const availableLabel = annualLeaveDisplay(summary.available);
  const helperText = isUnlimited
    ? "Annual and urgent leave can be requested without a balance limit."
    : "Working days ready to use.";

  return `
    <section class="employee-leave-hero">
      <div class="employee-leave-hero-content">
        <div>
          <div class="employee-leave-kicker">Available annual leave</div>
          <div class="employee-leave-value">${availableLabel}</div>
          <p>${helperText}</p>
        </div>
        <div class="employee-leave-stats">
          <div class="employee-leave-stat">
            <strong>${isUnlimited ? "Unlimited" : summary.baseEntitlement}</strong>
            <span>Yearly allotment</span>
          </div>
          <div class="employee-leave-stat">
            <strong>${summary.carriedForward}</strong>
            <span>Carried forward</span>
          </div>
          <div class="employee-leave-stat">
            <strong>${summary.birthdayLeave}</strong>
            <span>Birthday leave</span>
          </div>
          <div class="employee-leave-stat">
            <strong>${summary.approved} / ${summary.pending}</strong>
            <span>Taken / pending</span>
          </div>
        </div>
      </div>
    </section>
  `;
}

function percentage(numerator, denominator) {
  const total = Number(denominator || 0);
  if (!total) return 0;
  return Math.max(0, Math.min(100, Math.round((Number(numerator || 0) / total) * 100)));
}

function displayNumber(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return "0";
  return String(Math.round(number * 100) / 100);
}

function renderEmployeeBalanceRings() {
  const summary = state.dashboard.leaveSummary;
  const medicalSummary = state.dashboard.medicalLeaveSummary || {
    entitlement: 14,
    available: 14,
    pending: 0,
    approved: 0
  };
  const claimSummary = state.dashboard.medicalClaimSummary || {
    limit: 0,
    available: 0,
    pending: 0,
    approved: 0
  };
  const annualPercent = state.dashboard.user.unlimitedAnnualLeave
    ? 100
    : percentage(summary.available, summary.entitlement);
  const medicalPercent = percentage(medicalSummary.available, medicalSummary.entitlement);
  const claimPercent = percentage(claimSummary.available, claimSummary.limit);

  return `
    <section class="employee-balance-grid">
      <article class="employee-ring-card">
        <div class="employee-ring" style="--value: ${annualPercent}%; --ring-gradient: #ff5fc8, #5d7cfa;">
          <strong>${state.dashboard.user.unlimitedAnnualLeave ? "Open" : `${annualPercent}%`}</strong>
        </div>
        <div>
          <h2>Annual Leave</h2>
          <p class="muted">${state.dashboard.user.unlimitedAnnualLeave ? "Unlimited balance" : `${summary.available} days available`}</p>
        </div>
      </article>
      <article class="employee-ring-card">
        <div class="employee-ring" style="--value: ${medicalPercent}%; --ring-gradient: #5ee8d6, #5d7cfa;">
          <strong>${medicalPercent}%</strong>
        </div>
        <div>
          <h2>Medical Leave</h2>
          <p class="muted">${medicalSummary.available} / ${medicalSummary.entitlement} days remaining</p>
        </div>
      </article>
      <article class="employee-ring-card">
        <div class="employee-ring" style="--value: ${claimPercent}%; --ring-gradient: #ffbd3d, #ff7b68;">
          <strong>${claimPercent}%</strong>
        </div>
        <div>
          <h2>Medical Claims</h2>
          <p class="muted">${money(claimSummary.available)} balance remaining</p>
        </div>
      </article>
    </section>
  `;
}

function employeeRecentRequests() {
  const userId = state.dashboard.user.id;
  const leaveItems = state.dashboard.leaveRequests
    .filter((item) => item.employeeId === userId)
    .map((item) => ({
      id: `leave-${item.id}`,
      status: item.status,
      dateKey: item.createdAt || item.startDate,
      kind: item.type,
      title: item.startDate === item.endDate
        ? dateText(item.startDate)
        : `${dateText(item.startDate)} to ${dateText(item.endDate)}`,
      meta: `${item.days} working day${Number(item.days) === 1 ? "" : "s"}${item.reason ? ` - ${item.reason}` : ""}`
    }));
  const claimItems = state.dashboard.medicalClaims
    .filter((item) => item.employeeId === userId)
    .map((item) => ({
      id: `claim-${item.id}`,
      status: item.status,
      dateKey: item.createdAt || item.claimDate,
      kind: claimTypeLabel(item.claimType),
      title: item.provider || claimTypeLabel(item.claimType),
      meta: `${money(item.amount)} - ${item.description || item.category || "Claim"}`
    }));

  return [...leaveItems, ...claimItems]
    .sort((left, right) => String(right.dateKey || "").localeCompare(String(left.dateKey || "")))
    .slice(0, 5);
}

function renderEmployeeRecentRequests() {
  const items = employeeRecentRequests();
  return `
    <section class="section employee-recent-section">
      <div class="section-header">
        <div>
          <h2 class="section-title">My Active Requests</h2>
          <p class="page-kicker">Pending leave and claims without another long table.</p>
        </div>
      </div>
      ${items.length ? `
        <div class="employee-request-list">
          ${items.map((item) => `
            <article class="employee-request-card">
              <div>
                <span class="employee-request-kind">${escapeHtml(item.kind)}</span>
                <h3>${escapeHtml(item.title)}</h3>
                <p class="muted">${escapeHtml(item.meta)}</p>
              </div>
              ${statusPill(item.status)}
            </article>
          `).join("")}
        </div>
      ` : `
        <div class="empty">
          You're all caught up. New leave and claim requests will appear here.
          <div class="empty-actions">
            <button class="button small" data-action="tab" data-tab="leave">Request Leave</button>
            <button class="button small" data-action="tab" data-tab="claims">Submit Claim</button>
          </div>
        </div>
      `}
    </section>
  `;
}

function featureRingCard({ title, value, text, percent, gradient }) {
  return `
    <article class="feature-ring-card">
      <div class="feature-ring" style="--value: ${percent}%; --ring-gradient: ${gradient};">
        <strong>${escapeHtml(value)}</strong>
      </div>
      <div>
        <h2>${escapeHtml(title)}</h2>
        <p class="muted">${escapeHtml(text)}</p>
      </div>
    </article>
  `;
}

function renderLeavePageRings() {
  const summary = state.dashboard.leaveSummary;
  const medicalSummary = state.dashboard.medicalLeaveSummary || {
    entitlement: 14,
    available: 14,
    pending: 0,
    approved: 0
  };
  const isUnlimited = Boolean(state.dashboard.user.unlimitedAnnualLeave);
  const annualPercent = isUnlimited ? 100 : percentage(summary.available, summary.entitlement);
  const pendingPercent = isUnlimited ? 0 : percentage(summary.pending, summary.entitlement || summary.pending);
  const medicalPercent = percentage(medicalSummary.available, medicalSummary.entitlement);

  return `
    <section class="feature-balance-grid">
      ${featureRingCard({
        title: "Annual Leave",
        value: isUnlimited ? "Open" : `${annualPercent}%`,
        text: isUnlimited ? "Unlimited annual leave" : `${summary.available} days available`,
        percent: annualPercent,
        gradient: "#ff5fc8, #5d7cfa"
      })}
      ${featureRingCard({
        title: "Medical Leave",
        value: `${medicalPercent}%`,
        text: `${medicalSummary.available} / ${medicalSummary.entitlement} days remaining`,
        percent: medicalPercent,
        gradient: "#5ee8d6, #5d7cfa"
      })}
      ${featureRingCard({
        title: "Leave Pending",
        value: String(summary.pending),
        text: `${summary.approved} days approved this year`,
        percent: pendingPercent,
        gradient: "#ffbd3d, #ff7b68"
      })}
    </section>
  `;
}

const EMPLOYEE_ENTITLEMENT_TYPES = [
  "Hospitalization Leave",
  "Compassionate Leave",
  "Paternity Leave",
  "Maternity Leave",
  "Childcare Leave",
  "National Service Leave"
];

function entitlementForType(bundle, type, date = todayIso()) {
  const normalizedType = String(type || "").toLowerCase();
  return (bundle?.entitlements || []).find((entitlement) =>
    entitlement.active !== false &&
    String(entitlement.leaveType || "").toLowerCase() === normalizedType &&
    (!entitlement.validFrom || date >= entitlement.validFrom) &&
    (!entitlement.validUntil || date <= entitlement.validUntil)
  ) || null;
}

function entitlementUnavailableReason(type, entitlement, date = todayIso()) {
  if (!leavePolicyEnforcementEnabled(type)) return "";
  if (!entitlement) return "No active entitlement has been verified for this period.";
  if (entitlement.active === false) return "This entitlement is inactive.";
  if (entitlement.validFrom && date < entitlement.validFrom) return `Available from ${dateText(entitlement.validFrom)}.`;
  if (entitlement.validUntil && date > entitlement.validUntil) return `Expired ${dateText(entitlement.validUntil)}.`;
  if (["Paternity Leave", "Maternity Leave", "Childcare Leave"].includes(type) && !entitlement.eligibilityVerified) {
    return "Eligibility has not been verified by HR.";
  }
  return "";
}

function renderEmployeeEntitlementFacts(facts) {
  return `
    <dl class="employee-entitlement-facts">
      ${facts.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}
    </dl>
  `;
}

function renderEmployeeEntitlementSummaries() {
  const bundle = employeeEntitlementBundle(state.dashboard.user.id);
  const medical = bundle.medicalHospitalization;
  return `
    <section class="section employee-entitlement-summary" aria-labelledby="special-entitlements-title">
      <div class="section-header">
        <div>
          <h2 class="section-title" id="special-entitlements-title">Special Leave Entitlements</h2>
          <p class="page-kicker">These balances are tracked separately from annual leave.</p>
        </div>
      </div>
      <div class="employee-entitlement-list">
        ${EMPLOYEE_ENTITLEMENT_TYPES.map((type) => {
          if (type === "National Service Leave") {
            const summary = bundle.nationalService || { approved: 0, pending: 0 };
            return `
              <article class="employee-entitlement-item">
                <div class="employee-entitlement-heading"><strong>${type}</strong><span>Uncapped</span></div>
                ${renderEmployeeEntitlementFacts([
                  ["Days taken", displayNumber(summary.approved)],
                  ["Pending", displayNumber(summary.pending)],
                  ["Supporting document", leavePolicyEnforcementEnabled(type) ? "Required" : "Reviewed on submission"]
                ])}
              </article>
            `;
          }

          if (type === "Hospitalization Leave") {
            const summary = medical?.combined || {};
            return `
              <article class="employee-entitlement-item">
                <div class="employee-entitlement-heading"><strong>${type}</strong><span>Combined medical pool</span></div>
                ${renderEmployeeEntitlementFacts([
                  ["Entitlement", displayNumber(summary.entitlement)],
                  ["Approved", displayNumber(summary.approved)],
                  ["Pending", displayNumber(summary.pending)],
                  ["Remaining", displayNumber(summary.unreserved)],
                  ["Expiry", `31 Dec ${medical?.year || currentYearText()}`]
                ])}
              </article>
            `;
          }

          const entitlement = entitlementForType(bundle, type);
          const summary = entitlement?.summary || {};
          const unavailable = entitlementUnavailableReason(type, entitlement);
          const entitlementValue = type === "Maternity Leave" && entitlement
            ? `${displayNumber(Number(summary.entitlement || entitlement.baseDays) / 7)} weeks (${displayNumber(summary.entitlement || entitlement.baseDays)} days)`
            : displayNumber(summary.entitlement || entitlement?.baseDays || 0);
          const validity = entitlement
            ? `${dateText(entitlement.validFrom)} to ${entitlement.validUntil ? dateText(entitlement.validUntil) : "No expiry"}`
            : leavePolicyEnforcementEnabled(type) ? "Not available" : "Confirmed during approval";
          return `
            <article class="employee-entitlement-item" ${unavailable ? `data-entitlement-blocked="true"` : ""}>
              <div class="employee-entitlement-heading">
                <strong>${type}</strong>
                <span>${unavailable ? "Unavailable" : validity}</span>
              </div>
              ${renderEmployeeEntitlementFacts([
                ["Entitlement", entitlementValue],
                ["Approved", displayNumber(summary.approved)],
                ["Pending", displayNumber(summary.pending)],
                ["Remaining", displayNumber(summary.unreserved)],
                ["Expiry", entitlement?.validUntil ? dateText(entitlement.validUntil) : "-"]
              ])}
              ${type === "Maternity Leave" && entitlement ? `<p class="muted">Grant period: ${validity}</p>` : ""}
              ${unavailable ? `<p class="entitlement-unavailable">${escapeHtml(unavailable)}</p>` : ""}
            </article>
          `;
        }).join("")}
      </div>
    </section>
  `;
}

function renderClaimPageRings() {
  const summary = state.dashboard.medicalClaimSummary;
  const generalSummary = state.dashboard.generalClaimSummary || { pending: 0, approved: 0 };
  const availablePercent = percentage(summary.available, summary.limit);
  const pendingPercent = percentage(summary.pending, summary.limit || summary.pending);

  return `
    <section class="feature-balance-grid">
      ${featureRingCard({
        title: "Medical Balance",
        value: `${availablePercent}%`,
        text: `${money(summary.available)} remaining`,
        percent: availablePercent,
        gradient: "#5ee8d6, #5d7cfa"
      })}
      ${featureRingCard({
        title: "Medical Pending",
        value: money(summary.pending),
        text: `${money(summary.approved)} approved`,
        percent: pendingPercent,
        gradient: "#ffbd3d, #ff7b68"
      })}
      ${featureRingCard({
        title: "Others Pending",
        value: money(generalSummary.pending),
        text: "No medical balance deduction",
        percent: generalSummary.pending > 0 ? 100 : 0,
        gradient: "#ff5fc8, #8a68ff"
      })}
      ${featureRingCard({
        title: "Others Approved",
        value: money(generalSummary.approved),
        text: "General claims total",
        percent: generalSummary.approved > 0 ? 100 : 0,
        gradient: "#ff8a5b, #ff5fc8"
      })}
    </section>
  `;
}

function renderManagementOverviewHero(pendingLeaves, pendingClaims) {
  const { user } = state.dashboard;
  const totalPending = pendingLeaves.length + pendingClaims.length;
  const teamCount = user.role === "admin"
    ? (state.dashboard.allEmployees || []).filter((employee) => employee.active !== false).length
    : (state.dashboard.teamMembers || []).length;
  const storage = state.dashboard.receiptStorageSummary;

  return `
    <section class="management-hero">
      <div>
        <div class="management-kicker">${user.role === "admin" ? "Admin command view" : "Direct report queue"}</div>
        <h2>${totalPending ? `${totalPending} item${totalPending === 1 ? "" : "s"} need attention` : "Everything is clear"}</h2>
        <p>${totalPending ? "Review leave applications and claims from your team." : "No pending approvals in your queue right now."}</p>
      </div>
      <div class="management-hero-stats">
        <div class="management-stat">
          <strong>${pendingLeaves.length}</strong>
          <span>Leave approvals</span>
        </div>
        <div class="management-stat">
          <strong>${pendingClaims.length}</strong>
          <span>Claim approvals</span>
        </div>
        <div class="management-stat">
          <strong>${teamCount}</strong>
          <span>${user.role === "admin" ? "Active employees" : "Team members"}</span>
        </div>
        <div class="management-stat">
          <strong>${storage ? fileSize(storage.activeBytes) : "-"}</strong>
          <span>${storage ? "Receipt storage" : "Admin only"}</span>
        </div>
      </div>
    </section>
  `;
}

function renderManagementOverviewRings(pendingLeaves, pendingClaims) {
  const totalPending = pendingLeaves.length + pendingClaims.length;
  const teamCount = state.dashboard.user.role === "admin"
    ? (state.dashboard.allEmployees || []).filter((employee) => employee.active !== false).length
    : (state.dashboard.teamMembers || []).length;
  const storage = state.dashboard.receiptStorageSummary;

  return `
    <section class="feature-balance-grid management-ring-grid">
      ${featureRingCard({
        title: "Pending Leave",
        value: String(pendingLeaves.length),
        text: "Applications awaiting review",
        percent: totalPending ? percentage(pendingLeaves.length, totalPending) : 0,
        gradient: "#ff5fc8, #5d7cfa"
      })}
      ${featureRingCard({
        title: "Pending Claims",
        value: String(pendingClaims.length),
        text: "Claims awaiting review",
        percent: totalPending ? percentage(pendingClaims.length, totalPending) : 0,
        gradient: "#5ee8d6, #5d7cfa"
      })}
      ${featureRingCard({
        title: state.dashboard.user.role === "admin" ? "Employees" : "Team",
        value: String(teamCount),
        text: state.dashboard.user.role === "admin" ? "Active employee records" : "Assigned direct reports",
        percent: teamCount ? 100 : 0,
        gradient: "#ffbd3d, #ff7b68"
      })}
      ${featureRingCard({
        title: "Receipt Storage",
        value: storage ? fileSize(storage.activeBytes) : "-",
        text: storage ? `${storage.activeReceiptCount} active receipts` : "Visible to admins",
        percent: storage?.activeReceiptCount ? 100 : 0,
        gradient: "#ff8a5b, #ff5fc8"
      })}
    </section>
  `;
}

function renderApprovalSummary(leave, claims) {
  const total = leave.length + claims.length;
  return `
    <section class="feature-balance-grid management-ring-grid">
      ${featureRingCard({
        title: "Leave Queue",
        value: String(leave.length),
        text: "Pending leave decisions",
        percent: total ? percentage(leave.length, total) : 0,
        gradient: "#ff5fc8, #5d7cfa"
      })}
      ${featureRingCard({
        title: "Claims Queue",
        value: String(claims.length),
        text: "Pending claim decisions",
        percent: total ? percentage(claims.length, total) : 0,
        gradient: "#5ee8d6, #5d7cfa"
      })}
      ${featureRingCard({
        title: "Total Pending",
        value: String(total),
        text: total ? "Items awaiting action" : "Queue is clear",
        percent: total ? 100 : 0,
        gradient: "#ffbd3d, #ff7b68"
      })}
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

function renderApprovalPreviewCards(kind, items) {
  const isLeave = kind === "leave";
  const emptyText = isLeave ? "No leave approvals need attention." : "No claim approvals need attention.";
  if (!items.length) return `<div class="empty">${emptyText}</div>`;

  return `
    <div class="approval-preview-list">
      ${items.map((item) => `
        <article class="approval-preview-card">
          <div class="approval-preview-main">
            <span class="employee-request-kind">${isLeave ? "Leave request" : claimTypeLabel(item.claimType)}</span>
            <h3>${escapeHtml(employeeName(item.employeeId))}</h3>
            ${isLeave ? `
              <div class="approval-preview-meta">
                <span>${dateText(item.startDate)}${item.startDate === item.endDate ? "" : ` to ${dateText(item.endDate)}`}</span>
                <span>${item.days} day${Number(item.days) === 1 ? "" : "s"}</span>
                <span>${escapeHtml(item.type)}</span>
              </div>
              ${item.reason ? `<p class="muted">${escapeHtml(item.reason)}</p>` : ""}
              ${excludedDatesText(item)}
              ${renderMedicalCertificateLink(item)}
              ${renderLeaveApprovalContext(item)}
            ` : `
              <div class="approval-preview-meta">
                <span>${dateText(item.claimDate)}</span>
                <span>${money(item.amount)}</span>
                <span>${escapeHtml(item.category)}</span>
              </div>
              <strong>${escapeHtml(item.provider)}</strong>
              <p class="muted">${escapeHtml(item.description || "Claim awaiting review")}</p>
              <div>${renderReceiptCell(item)}</div>
            `}
          </div>
          <div class="approval-preview-actions">
            ${statusPill(item.status)}
            ${renderDecisionControls(kind, item)}
          </div>
        </article>
      `).join("")}
    </div>
  `;
}

function renderEmployeeOverview() {
  renderShell(`
    ${renderTopbar("Overview", "Your leave, medical leave, and claims in one calm view.")}
    <div class="content-grid">
      ${renderEmployeeLeaveHero()}
      ${renderEmployeeBalanceRings()}
      ${renderEmployeeRecentRequests()}
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

function renderOverview() {
  if (state.dashboard.user.role === "employee") {
    renderEmployeeOverview();
    return;
  }

  const pendingLeaves = state.dashboard.leaveRequests.filter((item) => item.status === "pending" && isReviewer(item));
  const pendingClaims = state.dashboard.medicalClaims.filter((item) => item.status === "pending" && isReviewer(item));
  renderShell(`
    ${renderTopbar("Overview", "Leave balances, pending approvals, and recent activity.")}
    <div class="content-grid">
      ${renderManagementOverviewHero(pendingLeaves, pendingClaims)}
      ${renderManagementOverviewRings(pendingLeaves, pendingClaims)}
      ${renderAdminReceiptStorage()}
      <div class="split">
        <section class="section management-section">
          <div class="section-header">
            <div>
              <h2 class="section-title">Pending Leave Requests</h2>
              <p class="page-kicker">Review team leave requests quickly.</p>
            </div>
            <button class="button small" data-action="tab" data-tab="approvals">Review</button>
          </div>
          ${renderApprovalPreviewCards("leave", pendingLeaves)}
        </section>
        <section class="section management-section">
          <div class="section-header">
            <div>
              <h2 class="section-title">Pending Claims</h2>
              <p class="page-kicker">Claims routed to you for approval.</p>
            </div>
            <button class="button small" data-action="tab" data-tab="approvals">Review</button>
          </div>
          ${renderApprovalPreviewCards("claim", pendingClaims)}
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

function estimatedLeaveDays(startDate, endDate, schedule, calendarDays = false) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate) || startDate > endDate) {
    return null;
  }
  const workdays = new Set(schedule || [1, 2, 3, 4, 5]);
  const start = new Date(`${startDate}T12:00:00Z`);
  const end = new Date(`${endDate}T12:00:00Z`);
  let days = 0;
  for (const cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const isoWeekday = cursor.getUTCDay() || 7;
    if (calendarDays || workdays.has(isoWeekday)) days += 1;
  }
  return days;
}

function leaveRequestBalanceContext(type, startDate) {
  const bundle = employeeEntitlementBundle(state.dashboard.user.id);
  if (isNationalServiceLeave(type) || type === "Unpaid Leave") {
    return { capped: false, remaining: null, unavailable: "", entitlement: null };
  }
  if (isMedicalLeaveType(type)) {
    const summary = leavePolicyEnforcementEnabled(type)
      ? bundle.medicalHospitalization?.outpatient
      : state.dashboard.medicalLeaveSummary;
    const remaining = summary?.unreserved ?? Number(summary?.available || 0) - Number(summary?.pending || 0);
    return { capped: true, remaining, unavailable: "", entitlement: null };
  }
  if (type === "Hospitalization Leave") {
    if (!leavePolicyEnforcementEnabled(type)) return { capped: false, remaining: null, unavailable: "", entitlement: null };
    return {
      capped: true,
      remaining: bundle.medicalHospitalization?.combined?.unreserved ?? 0,
      unavailable: "",
      entitlement: null
    };
  }
  if (["Compassionate Leave", "Paternity Leave", "Maternity Leave", "Childcare Leave"].includes(type)) {
    const entitlement = entitlementForType(bundle, type, startDate);
    const unavailable = entitlementUnavailableReason(type, entitlement, startDate);
    if (!leavePolicyEnforcementEnabled(type) && !entitlement) {
      return { capped: false, remaining: null, unavailable: "", entitlement: null };
    }
    return {
      capped: true,
      remaining: entitlement?.summary?.unreserved ?? 0,
      unavailable,
      entitlement
    };
  }
  if (type === "Annual Leave" || type === "Urgent Leave") {
    return {
      capped: !state.dashboard.user.unlimitedAnnualLeave,
      remaining: state.dashboard.leaveSummary?.available ?? 0,
      unavailable: "",
      entitlement: null
    };
  }
  return { capped: false, remaining: null, unavailable: "", entitlement: null };
}

function updateLeaveRequestEstimate(form) {
  const estimate = form.querySelector("[data-leave-estimate]");
  const submit = form.querySelector("button[type='submit']");
  const type = form.querySelector("select[name='type']")?.value || "Annual Leave";
  const startDate = form.querySelector("input[name='startDate']")?.value || "";
  const endDate = form.querySelector("input[name='endDate']")?.value || "";
  if (!estimate || !submit) return;

  estimate.dataset.entitlementBlocked = "false";
  submit.disabled = false;
  if (!startDate || !endDate) {
    estimate.innerHTML = `<strong>Request estimate</strong><span>Choose start and end dates to preview usage.</span>`;
    return;
  }
  if (startDate > endDate) {
    estimate.dataset.entitlementBlocked = "true";
    estimate.innerHTML = `<strong>Unavailable</strong><span>End date must be on or after the start date.</span>`;
    submit.disabled = true;
    return;
  }

  const context = leaveRequestBalanceContext(type, startDate);
  const usesCalendarDays = type === "Maternity Leave" && Boolean(context.entitlement);
  const usesEmployeeSchedule = isMedicalLeaveType(type) ||
    type === "Hospitalization Leave" ||
    isNationalServiceLeave(type) ||
    Boolean(context.entitlement);
  const schedule = context.entitlement?.workScheduleSnapshot ||
    (usesEmployeeSchedule ? state.dashboard.user.workSchedule : [1, 2, 3, 4, 5]);
  const days = estimatedLeaveDays(startDate, endDate, schedule, usesCalendarDays);
  let unavailable = context.unavailable;
  if (
    type === "Maternity Leave" &&
    context.entitlement &&
    (startDate !== context.entitlement.validFrom || endDate !== context.entitlement.validUntil)
  ) {
    unavailable = "Maternity Leave dates must match the verified grant period exactly.";
  }
  if (!unavailable && context.capped && Number(days) > Number(context.remaining)) {
    unavailable = `This estimate exceeds the ${displayNumber(context.remaining)} days currently remaining.`;
  }

  if (unavailable) {
    estimate.dataset.entitlementBlocked = "true";
    estimate.innerHTML = `<strong>Unavailable</strong><span>${escapeHtml(unavailable)}</span>`;
    submit.disabled = true;
    return;
  }

  const remaining = context.capped
    ? `${displayNumber(Number(context.remaining) - Number(days))} days`
    : "Not capped";
  estimate.innerHTML = `
    <strong>${displayNumber(days)} ${usesCalendarDays ? "calendar" : "scheduled"} day${Number(days) === 1 ? "" : "s"}</strong>
    <span>Expected remaining: ${escapeHtml(remaining)}. Public holiday exclusions are confirmed when submitted.</span>
  `;
}

function renderLeave() {
  const leaveRequests = state.dashboard.leaveRequests;
  const pendingLeaves = leaveRequests.filter((item) => item.status === "pending");
  renderShell(`
    ${renderTopbar("Leave", "Apply for leave and track your leave request history.")}
    <div class="content-grid">
      ${renderLeavePageRings()}
      ${renderEmployeeEntitlementSummaries()}
      <section class="section feature-form-card">
        <div class="section-header">
          <div>
            <h2 class="section-title">New Leave Application</h2>
            <p class="page-kicker">Weekends and Singapore public holidays are excluded automatically.</p>
          </div>
        </div>
        <div class="section-body">
          <form class="form-grid" data-form="leave">
            <div class="field">
              <label for="leave-type">Leave Type</label>
              <select id="leave-type" name="type">
                <option>Annual Leave</option>
                <option>Medical Leave</option>
                <option>Hospitalization Leave</option>
                <option>Compassionate Leave</option>
                <option>Paternity Leave</option>
                <option>Maternity Leave</option>
                <option>Childcare Leave</option>
                <option>National Service Leave</option>
                <option>Urgent Leave</option>
                <option>Unpaid Leave</option>
              </select>
              <div class="field-hint">Special leave is tracked separately from annual leave. Eligibility is reviewed during approval.</div>
            </div>
            <div class="field full" data-medical-certificate-field hidden>
              <label for="leave-supporting-document" data-leave-document-label>Medical Certificate / Hospitalization Document</label>
              <input id="leave-supporting-document" name="supportingDocument" type="file" accept="${RECEIPT_ACCEPT}" disabled>
              <div class="field-hint">${RECEIPT_HELP_TEXT}</div>
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
              <textarea id="leave-reason" name="reason" placeholder="Brief reason for this leave request"></textarea>
            </div>
            <div class="field full">
              <div class="leave-estimate" data-leave-estimate data-entitlement-blocked="false" role="status" aria-live="polite">
                <strong>Request estimate</strong>
                <span>Choose start and end dates to preview usage.</span>
              </div>
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
        ${pendingLeaves.length ? renderLeaveTable(pendingLeaves, false) : `<div class="empty">Submitted leave applications that are waiting for review will appear here.</div>`}
      </section>
      ${renderHistorySection("leave")}
    </div>
  `);
  requestAnimationFrame(() => {
    const form = document.querySelector("form[data-form='leave']");
    if (form) updateLeaveRequestEstimate(form);
  });
}

function renderClaimsExportPanel() {
  if (!isAdmin()) return "";
  const employees = claimExportEmployees();
  return `
    <section class="section">
      <div class="section-header">
        <h2 class="section-title">Medical Claim Exports</h2>
      </div>
      <div class="section-body">
        <div class="form-grid three export-controls">
          <div class="field">
            <label for="medical-claims-export-year">Year</label>
            <input id="medical-claims-export-year" data-export-field="medical-claims-year" type="number" min="2000" max="2100" step="1" value="${currentYearText()}">
          </div>
          <div class="field">
            <label for="medical-claims-export-employee">Employee</label>
            <select id="medical-claims-export-employee" data-export-field="medical-claims-employee">
              <option value="">Select employee</option>
              ${employees.map((employee) => `
                <option value="${escapeHtml(employee.id)}">${escapeHtml(employee.name)} (${escapeHtml(employee.email)})</option>
              `).join("")}
            </select>
          </div>
          <div class="field actions export-actions">
            <button class="button" type="button" data-action="export-medical-claims-employee">Export Employee</button>
            <button class="button primary" type="button" data-action="export-medical-claims-all">Export All</button>
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderClaims() {
  const summary = state.dashboard.medicalClaimSummary;
  const generalSummary = state.dashboard.generalClaimSummary || { pending: 0, approved: 0 };
  const claims = state.dashboard.medicalClaims;
  const pendingClaims = claims.filter((item) => item.status === "pending");
  renderShell(`
    ${renderTopbar("Claims", "Submit medical and general claims and track approval status.")}
    <div class="content-grid">
      ${renderClaimPageRings()}
      ${renderClaimsExportPanel()}
      <section class="section feature-form-card">
        <div class="section-header">
          <div>
            <h2 class="section-title">New Claim</h2>
            <p class="page-kicker">Medical claims use your medical balance. Others are tracked separately.</p>
          </div>
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
              <input id="claim-amount" name="amount" type="number" min="0.01" step="0.01" placeholder="0.00" required>
            </div>
            <div class="field">
              <label for="claim-provider">Clinic / Merchant</label>
              <input id="claim-provider" name="provider" placeholder="Clinic or merchant name" required>
            </div>
            <div class="field">
              <label for="claim-receipt-file">Receipt Upload</label>
              <input id="claim-receipt-file" name="receipt" type="file" accept="${RECEIPT_ACCEPT}" required>
              <div class="field-hint">${RECEIPT_HELP_TEXT}</div>
            </div>
            <div class="field full">
              <label for="claim-description">Claim Explanation</label>
              <textarea id="claim-description" name="description" placeholder="Explain what this claim is for" required></textarea>
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
        ${pendingClaims.length ? renderClaimsTable(pendingClaims, false) : `<div class="empty">Submitted claims that are waiting for review will appear here.</div>`}
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
      ${renderApprovalSummary(leave, claims)}
      <section class="section management-section">
        <div class="section-header">
          <div>
            <h2 class="section-title">Leave Applications</h2>
            <p class="page-kicker">Approve or not approve pending leave.</p>
          </div>
        </div>
        ${leave.length ? renderLeaveTable(leave, true) : `<div class="empty">No leave applications are waiting for your decision.</div>`}
      </section>
      <section class="section management-section">
        <div class="section-header">
          <div>
            <h2 class="section-title">Claims</h2>
            <p class="page-kicker">Review receipts, notes, and claim amounts.</p>
          </div>
        </div>
        ${claims.length ? renderClaimsTable(claims, true) : `<div class="empty">No claims are waiting for your decision.</div>`}
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

function canCancelLeave(item) {
  return item.employeeId === state.dashboard.user.id &&
    item.status === "pending" &&
    String(item.endDate || "") >= todayIso();
}

function renderLeaveApplicantControls(item) {
  if (!canCancelLeave(item)) return "";
  return `
    <div class="actions leave-row-actions">
      <button class="button reject small" data-action="cancel-leave" data-id="${item.id}">Cancel Leave</button>
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

function renderMedicalCertificateLink(item) {
  const medicalLink = item.medicalCertificate?.storedName ? (() => {
    const title = item.medicalCertificate.originalName || "Medical Certificate";
    return `
      <div>
        <a class="receipt-link" href="/api/leave-requests/${item.id}/medical-certificate" target="_blank" rel="noreferrer" title="${escapeHtml(title)}">
          Medical Certificate
        </a>
      </div>
    `;
  })() : "";
  const supportingLink = item.supportingDocument?.storedName ? `
    <div>
      <a class="receipt-link" href="/api/leave-requests/${item.id}/supporting-document" target="_blank" rel="noreferrer" title="${escapeHtml(item.supportingDocument.originalName || "Supporting Document")}">
        Official Call-Up Notice
      </a>
    </div>
  ` : "";
  return `
    ${medicalLink}
    ${supportingLink}
  `;
}

function renderLeaveApprovalContext(item) {
  const bundle = employeeEntitlementBundle(item.employeeId);
  const entitlement = (bundle.entitlements || []).find((entry) => entry.id === item.entitlementId) || null;
  const medicalType = isMedicalLeaveType(item.type);
  const hospitalizationType = item.type === "Hospitalization Leave";
  const nationalServiceType = isNationalServiceLeave(item.type);
  const pool = medicalType
    ? bundle.medicalHospitalization?.outpatient
    : hospitalizationType
      ? bundle.medicalHospitalization?.combined
      : null;
  const summary = entitlement?.summary || pool;
  const balanceAfterApproval = nationalServiceType
    ? "Uncapped"
    : summary
      ? `${displayNumber(Number(summary.available || 0) - Number(item.days || 0))} days`
      : "Not capped by this policy";
  const eligibility = entitlement
    ? entitlement.eligibilityVerified ? "Yes" : "No"
    : ["Paternity Leave", "Maternity Leave", "Childcare Leave"].includes(item.type)
      ? "No linked entitlement"
      : "Not required";
  const linkedPeriod = entitlement
    ? `${dateText(entitlement.validFrom)} to ${entitlement.validUntil ? dateText(entitlement.validUntil) : "No expiry"}`
    : pool
      ? `Calendar year ${bundle.medicalHospitalization?.year || item.leaveYear}`
      : nationalServiceType
        ? `${dateText(item.startDate)} to ${dateText(item.endDate)}`
        : "Not linked";
  const documentAttached = Boolean(item.medicalCertificate?.storedName || item.supportingDocument?.storedName);
  const documentRequired = requiresMedicalCertificate(item.type) ||
    (nationalServiceType && leavePolicyEnforcementEnabled(item.type));

  return `
    <dl class="leave-approval-context" aria-label="Entitlement context">
      <div><dt>Eligibility verified</dt><dd>${escapeHtml(eligibility)}</dd></div>
      <div><dt>Linked period</dt><dd>${escapeHtml(linkedPeriod)}</dd></div>
      <div><dt>Supporting document</dt><dd>${documentAttached ? "Attached" : documentRequired ? "Missing" : "Not required"}</dd></div>
      <div><dt>Balance after approval</dt><dd>${escapeHtml(balanceAfterApproval)}</dd></div>
    </dl>
  `;
}

function renderLeaveTable(items, approvalsMode) {
  if (!items.length) return `<div class="empty">No leave requests match the current view.</div>`;
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
              <td data-label="Type">
                ${escapeHtml(item.type)}
                ${renderMedicalCertificateLink(item)}
                ${approvalsMode ? renderLeaveApprovalContext(item) : ""}
              </td>
              <td data-label="Status">${statusPill(item.status)}</td>
              <td data-label="${approvalsMode ? "Decision" : "Approver"}">
                ${approvalsMode ? renderDecisionControls("leave", item) : escapeHtml(employeeName(item.managerId))}
                ${!approvalsMode ? renderLeaveApplicantControls(item) : ""}
                ${item.decisionNote ? `<div class="muted">${escapeHtml(item.decisionNote)}</div>` : ""}
                ${item.cancellationNote ? `<div class="muted">${escapeHtml(item.cancellationNote)}</div>` : ""}
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
  if (!items.length) return `<div class="empty">No claims match the current view.</div>`;
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
  const claimApprover = employee.claimApproverId ? employeeName(employee.claimApproverId) : "unassigned";
  return [
    employee.name,
    employee.email,
    roleName(employee.role),
    manager,
    claimApprover,
    `service ${employee.serviceStartDate}`,
    `leave ${employee.annualLeaveEntitlement ?? employee.startingLeaveEntitlement} ${employee.leaveEntitlement}`,
    `carry forward ${employee.carriedForwardLeave ?? 0}`,
    `birthday ${employee.birthdayLeaveEntitlement ?? 0}`,
    employee.unlimitedAnnualLeave ? "unlimited annual leave" : "limited annual leave",
    `medical leave ${employee.medicalLeaveEntitlement ?? 14}`,
    `medical remaining ${employee.medicalLeaveRemaining ?? employee.medicalLeaveEntitlement ?? 14}`,
    `medical claim ${employee.medicalClaimLimit}`,
    `medical claim balance ${employee.medicalClaimBalance ?? employee.medicalClaimLimit}`,
    employee.active ? "active" : "inactive"
  ].join(" ").toLowerCase();
}

function employeeRowBody(row) {
  const body = {};
  row.querySelectorAll("[data-field]").forEach((field) => {
    const fieldName = field.dataset.field;
    if (
      ["medicalLeaveEntitlement", "medicalLeaveRemaining", "medicalClaimLimit", "medicalClaimBalance"].includes(fieldName) &&
      field.dataset.originalValue !== undefined &&
      Number(field.value) === Number(field.dataset.originalValue)
    ) {
      return;
    }

    body[fieldName] = field.type === "checkbox"
      ? field.checked
      : fieldName === "active"
      ? field.value === "true"
      : field.value;
  });
  return body;
}

function medicalClaimsExportUrl({ employeeId = "" } = {}) {
  const year = document.querySelector("[data-export-field='medical-claims-year']")?.value || currentYearText();
  const params = new URLSearchParams({ year });
  if (employeeId) params.set("employeeId", employeeId);
  return `/api/exports/medical-claims?${params.toString()}`;
}

function renderLeaveAdjustmentHistory() {
  const adjustments = state.dashboard.leaveAdjustments || [];
  if (!adjustments.length) return `<div class="empty">Leave adjustments will appear here after an admin applies one.</div>`;

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

function employeeMedicalLeaveEntitlement(employee) {
  return Number(employee.medicalLeaveEntitlement ?? 14);
}

function employeeMedicalLeaveRemaining(employee) {
  return Number(employee.medicalLeaveRemaining ?? employeeMedicalLeaveEntitlement(employee));
}

const WORK_WEEKDAYS = [
  [1, "Monday"],
  [2, "Tuesday"],
  [3, "Wednesday"],
  [4, "Thursday"],
  [5, "Friday"],
  [6, "Saturday"],
  [7, "Sunday"]
];

function employeeEntitlementBundle(employeeId) {
  return state.dashboard.leaveEntitlementSummaries?.find(
    (entry) => entry.employeeId === employeeId
  ) || { entitlements: [], medicalHospitalization: null };
}

function renderManagedEntitlement(entitlement) {
  const summary = entitlement.summary || {};
  const expiryLabel = entitlement.validUntil ? dateText(entitlement.validUntil) : "No expiry";
  return `
    <div class="entitlement-row">
      <div class="entitlement-row-main">
        <strong>${escapeHtml(entitlement.leaveType)}</strong>
        <span class="muted">Valid ${dateText(entitlement.validFrom)} to ${expiryLabel}</span>
      </div>
      <dl class="entitlement-facts">
        <div><dt>Entitlement</dt><dd>${displayNumber(summary.entitlement ?? entitlement.baseDays)}</dd></div>
        <div><dt>Used</dt><dd>${displayNumber(summary.approved ?? 0)}</dd></div>
        <div><dt>Pending</dt><dd>${displayNumber(summary.pending ?? 0)}</dd></div>
        <div><dt>Remaining</dt><dd>${displayNumber(summary.unreserved ?? entitlement.baseDays)}</dd></div>
        <div><dt>Expiry</dt><dd>${expiryLabel}</dd></div>
      </dl>
      <form class="entitlement-adjustment-form" data-form="entitlement-adjustment" data-entitlement-id="${entitlement.id}">
        <div class="field">
          <label>Set Remaining</label>
          <input name="desiredRemaining" type="number" min="0" step="0.5" value="${displayNumber(summary.available ?? entitlement.baseDays)}" required>
        </div>
        <div class="field">
          <label>Adjustment Reason</label>
          <input name="reason" required>
        </div>
        <button class="button small" type="submit">Apply</button>
      </form>
    </div>
  `;
}

function renderEntitlementManager(employee) {
  const bundle = employeeEntitlementBundle(employee.id);
  const medical = bundle.medicalHospitalization;
  const selectedDays = new Set(employee.workSchedule || [1, 2, 3, 4, 5]);
  return `
    <section class="entitlement-manager" id="employee-entitlements-${employee.id}" aria-label="Manage entitlements for ${escapeHtml(employee.name)}">
      <div class="entitlement-manager-header">
        <div>
          <h3>Leave Entitlements</h3>
          <p class="muted">Grant values remain separate from approved and pending usage.</p>
        </div>
        <button class="button small" type="button" data-action="manage-entitlements" data-id="${employee.id}" aria-expanded="true" aria-controls="employee-entitlements-${employee.id}">Close</button>
      </div>
      <div class="entitlement-medical-summary">
        <div><span>Outpatient Medical</span><strong>${displayNumber(medical?.outpatient?.unreserved ?? 0)} remaining</strong></div>
        <div><span>Combined Medical + Hospitalization</span><strong>${displayNumber(medical?.combined?.unreserved ?? 0)} remaining</strong></div>
      </div>
      <form class="entitlement-schedule-form" data-form="work-schedule" data-employee-id="${employee.id}">
        <fieldset>
          <legend>Scheduled Working Days</legend>
          <div class="weekday-options">
            ${WORK_WEEKDAYS.map(([day, label]) => `
              <label><input name="workSchedule" type="checkbox" value="${day}" ${selectedDays.has(day) ? "checked" : ""}> ${label}</label>
            `).join("")}
          </div>
        </fieldset>
        <button class="button small" type="submit">Save Schedule</button>
      </form>
      <div class="entitlement-list">
        ${bundle.entitlements.length
          ? bundle.entitlements.map(renderManagedEntitlement).join("")
          : `<div class="empty">No entitlement grants have been created for this employee.</div>`}
      </div>
      <form class="entitlement-create-form entitlement-grid" data-form="leave-entitlement" data-employee-id="${employee.id}">
        <div class="field">
          <label>Leave Type</label>
          <select name="leaveType" required>
            <option>Hospitalization Leave</option>
            <option>Compassionate Leave</option>
            <option>Paternity Leave</option>
            <option>Maternity Leave</option>
            <option>Childcare Leave</option>
          </select>
        </div>
        <div class="field"><label>Period Year</label><input name="periodYear" type="number" value="${currentYearText()}"></div>
        <div class="field"><label>Entitlement Days</label><input name="baseDays" type="number" min="0" step="0.5"></div>
        <div class="field"><label>Event Date</label><input name="eventDate" type="date"></div>
        <div class="field"><label>Valid From</label><input name="validFrom" type="date"></div>
        <div class="field"><label>Valid Until / Expiry</label><input name="validUntil" type="date"></div>
        <div class="field"><label>Child Date of Birth</label><input name="childBirthDate" type="date"></div>
        <label class="field checkbox-field"><span>Eligibility Verified</span><input name="eligibilityVerified" type="checkbox"></label>
        <div class="field full actions"><button class="button primary small" type="submit">Create Grant</button></div>
      </form>
    </section>
  `;
}

function renderEmployees() {
  const managerChoices = employeeManagerChoices();
  renderShell(`
    ${renderTopbar("Employees", "Administer employees, roles, direct reports, claims approvers, and leave entitlement.")}
    <div class="content-grid">
      <section class="section">
        <div class="section-header">
          <div>
            <h2 class="section-title">New Employee</h2>
            <p class="page-kicker">Annual + carry forward + birthday leave create the yearly total.</p>
          </div>
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
              <label for="employee-claim-approver">Claims Approver</label>
              <select id="employee-claim-approver" name="claimApproverId">${managerOptions(managerChoices, "")}</select>
            </div>
            <div class="field">
              <label for="employee-service-start">Service Start</label>
              <input id="employee-service-start" name="serviceStartDate" type="date" required value="${todayIso()}">
            </div>
            <div class="field">
              <label for="employee-leave">Set Initial Annual Leave Days</label>
              <input id="employee-leave" name="startingLeaveEntitlement" type="number" min="0" step="0.5" value="14">
              <div class="field-hint">Base annual entitlement before carry forward, birthday leave, and admin adjustments.</div>
            </div>
            <div class="field">
              <label for="employee-carry-forward">Carry Forward Leave</label>
              <input id="employee-carry-forward" name="carriedForwardLeave" type="number" min="0" step="0.5" value="0">
              <div class="field-hint">Unused leave brought into this leave year.</div>
            </div>
            <div class="field">
              <label for="employee-birthday-leave">Birthday Leave</label>
              <input id="employee-birthday-leave" name="birthdayLeaveEntitlement" type="number" min="0" step="0.5" value="0">
              <div class="field-hint">Extra yearly leave granted by policy.</div>
            </div>
            <label class="field checkbox-field" for="employee-unlimited-annual-leave">
              <span>Unlimited Annual Leave</span>
              <input id="employee-unlimited-annual-leave" name="unlimitedAnnualLeave" type="checkbox">
            </label>
            <div class="field">
              <label for="employee-medical-leave-entitlement">Medical Leave Days</label>
              <input id="employee-medical-leave-entitlement" name="medicalLeaveEntitlement" type="number" min="0" step="0.5" value="14">
              <div class="field-hint">Initial yearly medical leave entitlement.</div>
            </div>
            <div class="field">
              <label for="employee-medical-limit">Medical Claim Limit</label>
              <input id="employee-medical-limit" name="medicalClaimLimit" type="number" min="0" step="0.01" value="500">
              <div class="field-hint">Initial yearly claim cap. Balance is edited separately per employee.</div>
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
          <div>
            <h2 class="section-title">Employee Directory</h2>
            <p class="page-kicker">Use balance fields for what remains; use limit or entitlement fields for yearly starting amounts.</p>
          </div>
          <div class="directory-tools">
            <label class="search-field" for="employee-search">
              <span>Search</span>
              <input id="employee-search" data-action="employee-search" type="search" placeholder="Name, email, role, or approver">
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
                <label>Claims Approver</label>
                <select data-field="claimApproverId">${managerOptions(managerChoices, employee.claimApproverId || employee.managerId, employee.id)}</select>
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
                <label>Carry Forward</label>
                <input data-field="carriedForwardLeave" type="number" min="0" step="0.5" value="${employee.carriedForwardLeave ?? 0}">
              </div>
              <div class="field">
                <label>Birthday Leave</label>
                <input data-field="birthdayLeaveEntitlement" type="number" min="0" step="0.5" value="${employee.birthdayLeaveEntitlement ?? 0}">
              </div>
              <label class="field checkbox-field">
                <span>Unlimited Annual Leave</span>
                <input data-field="unlimitedAnnualLeave" type="checkbox" ${employee.unlimitedAnnualLeave ? "checked" : ""}>
              </label>
              <div class="field">
                <label>Current Total Leave</label>
                <input value="${employee.unlimitedAnnualLeave ? "Unlimited" : employee.leaveEntitlement}" disabled>
              </div>
              <div class="field">
                <label>Medical Leave Days</label>
                <input data-field="medicalLeaveEntitlement" data-original-value="${displayNumber(employeeMedicalLeaveEntitlement(employee))}" type="number" min="0" step="0.5" value="${displayNumber(employeeMedicalLeaveEntitlement(employee))}">
              </div>
              <div class="field">
                <label>Medical Leave Remaining</label>
                <input data-field="medicalLeaveRemaining" data-original-value="${displayNumber(employeeMedicalLeaveRemaining(employee))}" type="number" min="0" step="0.5" value="${displayNumber(employeeMedicalLeaveRemaining(employee))}">
              </div>
              <div class="field">
                <label>Medical Claim Limit</label>
                <input data-field="medicalClaimLimit" data-original-value="${displayNumber(employee.medicalClaimLimit)}" type="number" min="0" step="0.01" value="${displayNumber(employee.medicalClaimLimit)}">
              </div>
              <div class="field">
                <label>Medical Claim Balance</label>
                <input data-field="medicalClaimBalance" data-original-value="${displayNumber(employee.medicalClaimBalance ?? employee.medicalClaimLimit)}" type="number" min="0" step="0.01" value="${displayNumber(employee.medicalClaimBalance ?? employee.medicalClaimLimit)}">
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
                      <button class="button small" type="button" data-action="manage-entitlements" data-id="${employee.id}" aria-expanded="${state.entitlementEmployeeId === employee.id}" aria-controls="employee-entitlements-${employee.id}">Manage Entitlements</button>
                      <button class="button small" type="button" data-action="open-leave-adjustment" data-id="${employee.id}">Adjust Leave</button>
                      <button class="button small" type="button" data-action="open-password-reset" data-id="${employee.id}">Reset Password</button>
                    </div>
                  </details>
                </div>
              </div>
              ${state.entitlementEmployeeId === employee.id ? renderEntitlementManager(employee) : ""}
            </div>
          `).join("")}
          </div>
          <div class="empty" data-empty="employee-search" hidden>No employees match this search.</div>
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
  if (!emails.length) return `<div class="empty">Email notifications generated by leave and claim workflows will appear here.</div>`;
  return `
    <div>
      ${emails.map((email) => `
        <article class="mail-item">
          <div class="mail-subject">${escapeHtml(email.subject)}</div>
          <div class="mail-meta">To ${escapeHtml(email.to)} - ${dateTimeText(email.createdAt)} - ${escapeHtml(emailDeliveryText(email))}</div>
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
    ${renderTopbar("Email Outbox", "Email notifications generated by leave and claim workflows.")}
    <section class="section">
      ${state.mail.loading && !emails.length ? renderLoadingState("Loading email notifications", "list") : renderMailList(emails)}
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
    "leave.cancelled": "Leave Cancelled",
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
  if (!events.length) return `<div class="empty">No audit entries match the current search.</div>`;
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
      ${state.audit.loading && !events.length ? renderLoadingState("Loading audit log", "table") : renderAuditTable(events)}
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

function updateMedicalCertificateField(form) {
  const typeField = form.querySelector("select[name='type']");
  const wrapper = form.querySelector("[data-medical-certificate-field]");
  const fileInput = form.querySelector("input[name='supportingDocument']");
  const label = form.querySelector("[data-leave-document-label]");
  if (!typeField || !wrapper || !fileInput) return;

  const medicalDocument = requiresMedicalCertificate(typeField.value);
  const nationalServiceDocument = isNationalServiceLeave(typeField.value) &&
    leavePolicyEnforcementEnabled(typeField.value);
  const required = medicalDocument || nationalServiceDocument;
  wrapper.hidden = !required;
  fileInput.required = required;
  fileInput.disabled = !required;
  if (label) {
    label.textContent = nationalServiceDocument
      ? "Official Call-Up Notice"
      : "Medical Certificate / Hospitalization Document";
  }
  if (!required) fileInput.value = "";
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
  const submittingLabel = formSubmittingLabel(formType);
  try {
    setFormSubmitting(form, true, submittingLabel);
    state.busy = true;
    if (formType === "login") {
      const data = await api("/api/login", {
        method: "POST",
        body: JSON.stringify(body)
      });
      updateDashboard(data);
    }
    if (formType === "leave") {
      const leavePayload = await leaveFormPayload(form, body);
      const data = await api("/api/leave-requests", {
        method: "POST",
        body: leavePayload.body
      });
      form.reset();
      updateMedicalCertificateField(form);
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
    if (formType === "work-schedule") {
      const workSchedule = [...form.querySelectorAll("input[name='workSchedule']:checked")]
        .map((input) => Number(input.value));
      const data = await api(`/api/employees/${form.dataset.employeeId}/work-schedule`, {
        method: "PATCH",
        body: JSON.stringify({ workSchedule })
      });
      updateDashboard(data);
      showToast("Work schedule updated.");
    }
    if (formType === "leave-entitlement") {
      const entitlementBody = { ...body, employeeId: form.dataset.employeeId };
      entitlementBody.eligibilityVerified = form.querySelector("input[name='eligibilityVerified']").checked;
      Object.keys(entitlementBody).forEach((key) => {
        if (entitlementBody[key] === "") delete entitlementBody[key];
      });
      const data = await api("/api/leave-entitlements", {
        method: "POST",
        body: JSON.stringify(entitlementBody)
      });
      updateDashboard(data);
      showToast("Entitlement grant created.");
    }
    if (formType === "entitlement-adjustment") {
      if (!String(body.reason || "").trim()) {
        throw new Error("Adjustment Reason is required.");
      }
      const data = await api(`/api/leave-entitlements/${form.dataset.entitlementId}/adjustments`, {
        method: "POST",
        body: JSON.stringify(body)
      });
      updateDashboard(data);
      showToast("Entitlement remaining balance updated.");
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
    if (form.isConnected) {
      setFormSubmitting(form, false);
      if (formType === "leave") updateLeaveRequestEstimate(form);
    }
  }
});

document.addEventListener("click", async (event) => {
  if (event.target.classList?.contains("modal-backdrop")) {
    await animateDialogClose();
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
      return;
    }

    if (action === "logout") {
      await withButtonBusy(button, "Signing out...", async () => {
        await api("/api/logout", { method: "POST", body: "{}" });
        state.dashboard = null;
        state.activeTab = "overview";
        state.sidebarQuote = null;
        render();
      });
      return;
    }

    if (action === "decide") {
      const label = button.dataset.status === "approved" ? "Approving..." : "Not Approving...";
      await withButtonBusy(button, label, async () => {
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
      });
      return;
    }

    if (action === "cancel-leave") {
      if (!window.confirm("Cancel this leave request?")) return;
      await withButtonBusy(button, "Cancelling...", async () => {
        const data = await api(`/api/leave-requests/${button.dataset.id}/cancel`, {
          method: "PATCH",
          body: "{}"
        });
        updateDashboard(data);
        showToast("Leave request cancelled.");
      });
      return;
    }

    if (action === "save-employee") {
      await withButtonBusy(button, "Saving...", async () => {
        const row = button.closest("[data-employee-id]");
        const data = await api(`/api/employees/${button.dataset.id}`, {
          method: "PATCH",
          body: JSON.stringify(employeeRowBody(row))
        });
        updateDashboard(data);
        showToast("Employee updated.");
      });
      return;
    }

    if (action === "manage-entitlements") {
      const opening = state.entitlementEmployeeId !== button.dataset.id;
      state.entitlementEmployeeId = opening ? button.dataset.id : null;
      render();
      if (opening) {
        requestAnimationFrame(() => {
          document.querySelector(`#employee-entitlements-${CSS.escape(button.dataset.id)} input, #employee-entitlements-${CSS.escape(button.dataset.id)} select`)?.focus();
        });
      }
      return;
    }

    if (action === "open-password-reset") {
      state.passwordReset = { employeeId: button.dataset.id };
      render();
      return;
    }

    if (action === "close-password-reset") {
      await animateDialogClose();
      state.passwordReset = { employeeId: null };
      render();
      return;
    }

    if (action === "open-leave-adjustment") {
      state.leaveAdjustment = { employeeId: button.dataset.id };
      render();
      return;
    }

    if (action === "close-leave-adjustment") {
      await animateDialogClose();
      state.leaveAdjustment = { employeeId: null };
      render();
      return;
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

      await withButtonBusy(button, "Resetting...", async () => {
        const data = await api(`/api/employees/${button.dataset.id}/password`, {
          method: "POST",
          body: JSON.stringify({ password })
        });
        updateDashboard(data);
        showToast("Temporary password reset.");
      });
      return;
    }

    if (action === "save-all-employees") {
      const rows = [...document.querySelectorAll("[data-employee-id]")];
      if (!rows.length) {
        showToast("No employees to save.", "error");
        return;
      }

      await withButtonBusy(button, "Saving All...", async () => {
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
      });
      return;
    }

    if (action === "export-medical-claims-all") {
      window.location.assign(medicalClaimsExportUrl());
      return;
    }

    if (action === "export-medical-claims-employee") {
      const employeeId = document.querySelector("[data-export-field='medical-claims-employee']")?.value || "";
      if (!employeeId) {
        showToast("Select an employee first.", "error");
        return;
      }
      window.location.assign(medicalClaimsExportUrl({ employeeId }));
      return;
    }

    if (action === "history-load-more") {
      await withButtonBusy(button, "Loading...", async () => {
        const kind = button.dataset.kind;
        await loadHistory(kind, { append: true });
      });
      return;
    }

    if (action === "mail-load-more") {
      await withButtonBusy(button, "Loading...", async () => {
        await loadMail({ append: true });
      });
      return;
    }

    if (action === "audit-load-more") {
      await withButtonBusy(button, "Loading...", async () => {
        await loadAudit({ append: true });
      });
      return;
    }
  } catch (error) {
    if (action === "decide" && button.dataset.kind === "leave") {
      await refreshDashboard().catch(() => {});
    }
    showToast(error.message, "error");
  }
});

document.addEventListener("keydown", async (event) => {
  if (event.key !== "Escape" || !app.querySelector(".modal-backdrop")) return;
  await animateDialogClose();
  state.passwordReset = { employeeId: null };
  state.leaveAdjustment = { employeeId: null };
  render();
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
  const leaveField = event.target.closest(
    "form[data-form='leave'] select[name='type'], form[data-form='leave'] input[name='startDate'], form[data-form='leave'] input[name='endDate']"
  );
  if (leaveField) {
    if (leaveField.name === "type") updateMedicalCertificateField(leaveField.form);
    updateLeaveRequestEstimate(leaveField.form);
    return;
  }

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
