const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const appSource = readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");

test("admin employee rows expose medical claim limit separately from balance", () => {
  assert.match(appSource, /<label>Medical Claim Limit<\/label>\s*<input data-field="medicalClaimLimit"/);
  assert.match(appSource, /<label>Medical Claim Balance<\/label>\s*<input data-field="medicalClaimBalance"/);
});
