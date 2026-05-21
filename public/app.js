const state = {
  dashboard: null,
  activeTab: "overview",
  busy: false,
  history: {
    leave: {
      status: "all",
      year: String(new Date().getFullYear()),
      query: "",
      visible: 10
    },
    claim: {
      status: "all",
      year: String(new Date().getFullYear()),
      category: "all",
      query: "",
      visible: 10
    }
  }
};

const app = document.querySelector("#app");
const HISTORY_PAGE_SIZE = 10;

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
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "Request failed.");
  }
  return payload.data;
}

function updateDashboard(data) {
  if (data.dashboard) {
    state.dashboard = data.dashboard;
  } else {
    state.dashboard = data;
  }
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

function historyYear(kind, item) {
  if (kind === "leave") {
    return String(item.leaveYear || item.startDate?.slice(0, 4) || currentYearText());
  }
  return String(item.claimDate?.slice(0, 4) || currentYearText());
}

function historyYears(kind, items) {
  const years = new Set([currentYearText()]);
  items.forEach((item) => years.add(historyYear(kind, item)));
  return [...years].filter(Boolean).sort((a, b) => Number(b) - Number(a));
}

function historySearchText(kind, item) {
  const shared = [
    employeeName(item.employeeId),
    employeeName(item.managerId),
    statusLabel(item.status)
  ];

  if (kind === "leave") {
    shared.push(item.type, item.reason, item.startDate, item.endDate, item.days);
  } else {
    shared.push(claimTypeLabel(item.claimType), item.category, item.provider, item.description, item.claimDate, item.amount);
  }

  return shared.join(" ").toLowerCase();
}

function claimHistoryCategory(item) {
  return item.claimType === "general" ? "Others" : "Medical";
}

function filteredHistoryItems(kind, items) {
  const filters = state.history[kind];
  const query = filters.query.trim().toLowerCase();

  return items.filter((item) => {
    if (item.status === "pending") return false;
    if (filters.status !== "all" && item.status !== filters.status) return false;
    if (filters.year !== "all" && historyYear(kind, item) !== filters.year) return false;
    if (kind === "claim" && filters.category !== "all" && claimHistoryCategory(item) !== filters.category) return false;
    if (query && !historySearchText(kind, item).includes(query)) return false;
    return true;
  });
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

function renderHistoryFilters(kind, items) {
  const filters = state.history[kind];
  const title = kind === "leave" ? "Leave History" : "Claim History";
  const years = [
    { value: "all", label: "All Years" },
    ...historyYears(kind, items).map((year) => ({ value: year, label: year }))
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

function renderHistorySection(kind, items) {
  const filters = state.history[kind];
  const filtered = filteredHistoryItems(kind, items);
  const visible = filtered.slice(0, filters.visible);
  const table = kind === "leave" ? renderLeaveTable(visible, false) : renderClaimsTable(visible, false);
  const remaining = filtered.length - visible.length;

  return `
    <section class="section">
      <div class="section-header history-header">
        ${renderHistoryFilters(kind, items)}
      </div>
      ${table}
      ${remaining > 0 ? `
        <div class="history-more">
          <button class="button small" data-action="history-load-more" data-kind="${kind}">
            Load More
          </button>
          <span class="muted">${visible.length} of ${filtered.length} shown</span>
        </div>
      ` : ""}
    </section>
  `;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result));
    reader.addEventListener("error", () => reject(new Error("Receipt could not be read.")));
    reader.readAsDataURL(file);
  });
}

async function claimFormPayload(form) {
  const body = formObject(form);
  body.category = body.category === "Others" ? "Others" : "Medical";
  body.claimType = body.category === "Medical" ? "medical" : "general";
  const file = form.querySelector("input[type='file'][name='receipt']")?.files?.[0];
  if (!file) {
    throw new Error("Please upload a receipt.");
  }

  body.receipt = {
    name: file.name,
    type: file.type || "application/octet-stream",
    dataUrl: await fileToDataUrl(file)
  };
  return body;
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
          ${renderNavButton("mail", "Email Outbox")}
        </nav>
        <button class="button ghost" data-action="logout">Sign out</button>
      </aside>
      <main class="main">
        ${content}
      </main>
    </div>
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
        <div class="metric-label">Leave Pending</div>
        <div class="metric-value">${summary.pending}</div>
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
      ${renderHistorySection("leave", leaveRequests)}
    </div>
  `);
}

function renderClaims() {
  const summary = state.dashboard.medicalClaimSummary;
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
      </section>
      <section class="section">
        <div class="section-header">
          <h2 class="section-title">New Claim</h2>
        </div>
        <div class="section-body">
          <form class="form-grid three" data-form="claim">
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
              <input id="claim-receipt-file" name="receipt" type="file" accept="image/*,.pdf" required>
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
      ${renderHistorySection("claim", claims)}
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
              <td>
                <strong>${escapeHtml(employeeName(item.employeeId))}</strong>
                <div class="muted">${escapeHtml(item.reason || "")}</div>
              </td>
              <td>
                ${dateText(item.startDate)}<br>
                <span class="muted">${dateText(item.endDate)}</span>
                ${excludedDatesText(item)}
              </td>
              <td>${item.days}</td>
              <td>${escapeHtml(item.type)}</td>
              <td>${statusPill(item.status)}</td>
              <td>
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
              <td>
                <strong>${escapeHtml(employeeName(item.employeeId))}</strong>
                <div class="muted">${dateText(item.claimDate)}</div>
              </td>
              <td>
                <strong>${escapeHtml(claimTypeLabel(item.claimType))}</strong>
                <div>${escapeHtml(item.provider)}</div>
                <div class="muted">${escapeHtml(item.category)} - ${escapeHtml(item.description)}</div>
              </td>
              <td>${money(item.amount)}</td>
              <td>
                ${item.receipt ? `<a class="receipt-link" href="/api/claims/${item.id}/receipt" target="_blank" rel="noreferrer">${escapeHtml(item.receipt.originalName || "Receipt")}</a>` : "-"}
                ${item.receiptRef ? `<div class="muted">${escapeHtml(item.receiptRef)}</div>` : ""}
              </td>
              <td>${statusPill(item.status)}</td>
              <td>
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

function managerOptions(selectedId, currentId = "") {
  const employees = state.dashboard.allEmployees || [];
  return `<option value="">Unassigned</option>${employees
    .filter((employee) => employee.id !== currentId && employee.active)
    .map((employee) => `
      <option value="${employee.id}" ${employee.id === selectedId ? "selected" : ""}>
        ${escapeHtml(employee.name)} (${roleName(employee.role)})
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
    `leave ${employee.startingLeaveEntitlement} ${employee.leaveEntitlement}`,
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

function renderEmployees() {
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
              <select id="employee-manager" name="managerId">${managerOptions("")}</select>
            </div>
            <div class="field">
              <label for="employee-service-start">Service Start</label>
              <input id="employee-service-start" name="serviceStartDate" type="date" required value="${todayIso()}">
            </div>
            <div class="field">
              <label for="employee-leave">Starting Annual Leave</label>
              <input id="employee-leave" name="startingLeaveEntitlement" type="number" min="0" max="18" step="0.5" value="14">
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
                <select data-field="managerId">${managerOptions(employee.managerId, employee.id)}</select>
              </div>
              <div class="field">
                <label>Service Start</label>
                <input data-field="serviceStartDate" type="date" value="${escapeHtml(employee.serviceStartDate || "")}">
              </div>
              <div class="field">
                <label>Start Leave</label>
                <input data-field="startingLeaveEntitlement" type="number" min="0" max="18" step="0.5" value="${employee.startingLeaveEntitlement}">
              </div>
              <div class="field">
                <label>Current Allotment</label>
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
                <button class="button small" data-action="save-employee" data-id="${employee.id}">Save</button>
              </div>
            </div>
          `).join("")}
          </div>
          <div class="empty" data-empty="employee-search" hidden>No employees match that search.</div>
        </div>
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
  renderShell(`
    ${renderTopbar("Email Outbox", "Local email notifications generated by leave and claim workflows.")}
    <section class="section">
      ${renderMailList(state.dashboard.emails)}
    </section>
  `);
}

function render() {
  if (!state.dashboard) return renderLogin();
  if (state.activeTab === "leave") return renderLeave();
  if (state.activeTab === "claims") return renderClaims();
  if (state.activeTab === "approvals") return renderApprovals();
  if (state.activeTab === "employees" && isAdmin()) return renderEmployees();
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

  try {
    state.busy = true;
    const body = formObject(form);
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
      const claimBody = await claimFormPayload(form);
      const data = await api("/api/claims", {
        method: "POST",
        body: JSON.stringify(claimBody)
      });
      form.reset();
      updateDashboard(data);
      showToast(`${claimTypeLabel(claimBody.claimType)} submitted.`);
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
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    state.busy = false;
  }
});

document.addEventListener("click", async (event) => {
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

    if (action === "save-all-employees") {
      const rows = [...document.querySelectorAll("[data-employee-id]")];
      if (!rows.length) {
        showToast("No employees to save.", "error");
        return;
      }

      button.disabled = true;
      let latestData = null;
      for (const row of rows) {
        latestData = await api(`/api/employees/${row.dataset.employeeId}`, {
          method: "PATCH",
          body: JSON.stringify(employeeRowBody(row))
        });
      }
      updateDashboard(latestData);
      showToast(`${rows.length} employee record${rows.length === 1 ? "" : "s"} saved.`);
    }

    if (action === "history-load-more") {
      const kind = button.dataset.kind;
      state.history[kind].visible += HISTORY_PAGE_SIZE;
      render();
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

function updateHistoryFilter(field) {
  const kind = field.dataset.historyKind;
  const filterField = field.dataset.historyField;
  if (!kind || !filterField) return;

  const cursorStart = field.selectionStart;
  const cursorEnd = field.selectionEnd;
  state.history[kind][filterField] = field.value;
  state.history[kind].visible = HISTORY_PAGE_SIZE;
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
