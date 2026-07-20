const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const sqlPath = path.join(__dirname, "..", "supabase", "v2-leave-entitlements.sql");

test("leave entitlement rollout creates secured additive schema", () => {
  const sql = fs.readFileSync(sqlPath, "utf8");

  assert.match(sql, /create table if not exists public\.cls_leave_entitlements/i);
  assert.match(sql, /create table if not exists public\.cls_leave_entitlement_adjustments/i);
  assert.match(sql, /create table if not exists public\.cls_leave_policy_settings/i);
  assert.match(sql, /alter table public\.cls_leave_requests[\s\S]*entitlement_id/i);
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /revoke all[\s\S]*from anon, authenticated/i);
  assert.match(sql, /grant select, insert, update, delete[\s\S]*to service_role/i);
});
