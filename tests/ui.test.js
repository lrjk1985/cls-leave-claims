const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const appSource = readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");
const cssSource = readFileSync(path.join(__dirname, "..", "public", "styles.css"), "utf8");

test("admin employee rows expose medical claim limit separately from balance", () => {
  assert.match(appSource, /<label>Medical Claim Limit<\/label>\s*<input data-field="medicalClaimLimit"/);
  assert.match(appSource, /<label>Medical Claim Balance<\/label>\s*<input data-field="medicalClaimBalance"/);
});

test("core controls use a shared accessible touch target", () => {
  assert.match(cssSource, /--tap-target:\s*44px;/);
  assert.match(cssSource, /\.nav-button\s*\{[\s\S]*?min-height:\s*var\(--tap-target\);/);
  assert.match(cssSource, /input,\s*\nselect,\s*\ntextarea\s*\{[\s\S]*?min-height:\s*var\(--tap-target\);/);
  assert.match(cssSource, /\.button\s*\{[\s\S]*?min-height:\s*var\(--tap-target\);/);
  assert.match(cssSource, /\.button\.small\s*\{[\s\S]*?min-height:\s*var\(--tap-target\);/);
});

test("overview approval previews use compact cards instead of cramped tables", () => {
  assert.match(appSource, /function renderApprovalPreviewCards/);
  assert.match(appSource, /renderApprovalPreviewCards\("leave", pendingLeaves\)/);
  assert.match(appSource, /renderApprovalPreviewCards\("claim", pendingClaims\)/);
});

test("empty request states can offer clear next actions", () => {
  assert.match(appSource, /empty-actions/);
  assert.match(appSource, /Request Leave/);
  assert.match(appSource, /Submit Claim/);
});

test("admin leave and claim fields include policy helper text", () => {
  assert.match(appSource, /Annual \+ carry forward \+ birthday leave create the yearly total\./);
  assert.match(appSource, /Initial yearly claim cap\. Balance is edited separately per employee\./);
});

test("mobile navigation is compact without removing destinations", () => {
  assert.match(cssSource, /@media \(max-width:\s*640px\) \{[\s\S]*?\.sidebar\s*\{[\s\S]*?gap:\s*14px;/);
  assert.match(cssSource, /@media \(max-width:\s*640px\) \{[\s\S]*?\.nav-list\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/);
  assert.match(cssSource, /@media \(max-width:\s*640px\) \{[\s\S]*?\.sidebar-quote\s*\{[\s\S]*?display:\s*none;/);
  ["overview", "leave", "claims", "account", "mail"].forEach((tab) => {
    assert.match(appSource, new RegExp(`renderNavButton\\("${tab}"`));
  });
});

test("medical claim export controls align across fields and actions", () => {
  assert.match(appSource, /<div class="form-grid three export-controls">/);
  assert.match(cssSource, /\.export-controls\s*\{[\s\S]*?align-items:\s*end;/);
  assert.match(cssSource, /\.export-actions\s*\{[\s\S]*?align-self:\s*end;/);
});

test("leave form includes separately tracked HR leave categories", () => {
  [
    "Hospitalization Leave",
    "Compassionate Leave",
    "Paternity Leave",
    "Maternity Leave",
    "Childcare Leave",
    "National Service Leave"
  ].forEach((type) => assert.match(appSource, new RegExp(`<option>${type}</option>`)));
  assert.match(appSource, /Eligibility is reviewed during approval\./);
  assert.match(appSource, /requiresMedicalCertificate\(body\.type\)/);
  assert.match(appSource, /requiresMedicalCertificate\(typeField\.value\)/);
});

test("National Service Leave requests an official call-up notice", () => {
  assert.match(appSource, /Official Call-Up Notice/);
  assert.match(appSource, /\/api\/leave-supporting-documents\/upload-url/);
  assert.match(appSource, /supportingDocumentUpload/);
  assert.match(appSource, /uncapped_scheduled_days|National Service Leave/);
});

test("admin directory includes inline entitlement management", () => {
  assert.match(appSource, /data-action="manage-entitlements"/);
  assert.match(appSource, /aria-controls="employee-entitlements-/);
  assert.match(appSource, /name="workSchedule"/);
  assert.match(appSource, /\[1, "Monday"\]/);
  assert.match(appSource, /Outpatient Medical/);
  assert.match(appSource, /Combined Medical \+ Hospitalization/);
  assert.match(appSource, /Child Date of Birth/);
  assert.match(appSource, /Paternity Leave/);
  assert.match(appSource, /Maternity Leave/);
  assert.match(appSource, /Adjustment Reason/);
  ["Used", "Pending", "Remaining", "Valid", "Expiry"].forEach((label) => {
    assert.match(appSource, new RegExp(label));
  });
});

test("entitlement management is responsive and unframed", () => {
  assert.match(cssSource, /\.entitlement-manager\s*\{/);
  assert.match(cssSource, /\.entitlement-grid\s*\{[\s\S]*grid-template-columns/);
  assert.match(cssSource, /@media \(max-width:\s*640px\) \{[\s\S]*\.entitlement-grid\s*\{[\s\S]*grid-template-columns:\s*1fr/);
});

test("employee leave view explains special entitlement balances", () => {
  const summarySource = appSource.slice(
    appSource.indexOf("function renderEmployeeEntitlementSummaries"),
    appSource.indexOf("function renderClaimPageRings")
  );
  assert.match(appSource, /function renderEmployeeEntitlementSummaries/);
  ["Entitlement", "Approved", "Pending", "Remaining", "Expiry"].forEach((label) => {
    assert.match(appSource, new RegExp(label));
  });
  assert.match(appSource, /Unavailable/);
  assert.match(appSource, /Days taken/);
  assert.match(appSource, /Maternity Leave[\s\S]*weeks/);
  assert.doesNotMatch(summarySource, /Child Date of Birth/);
});

test("leave request form previews usage and blocks clearly unavailable grants", () => {
  assert.match(appSource, /data-leave-estimate/);
  assert.match(appSource, /Expected remaining/);
  assert.match(appSource, /function updateLeaveRequestEstimate/);
  assert.match(appSource, /data-entitlement-blocked/);
});

test("approvers see entitlement context without changed decision controls", () => {
  assert.match(appSource, /function renderLeaveApprovalContext/);
  assert.match(appSource, /Eligibility verified/);
  assert.match(appSource, /Linked period/);
  assert.match(appSource, /Supporting document/);
  assert.match(appSource, /Balance after approval/);
  assert.match(appSource, /renderDecisionControls\("leave", item\)/);
});

test("employee entitlement summaries stay compact on mobile", () => {
  assert.match(cssSource, /\.employee-entitlement-summary\s*\{/);
  assert.match(cssSource, /\.leave-estimate\s*\{/);
  assert.match(cssSource, /@media \(max-width:\s*640px\) \{[\s\S]*\.employee-entitlement-facts\s*\{[\s\S]*grid-template-columns:\s*repeat\(2,/);
});
