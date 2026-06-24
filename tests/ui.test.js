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
