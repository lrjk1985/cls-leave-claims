const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

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
  assert.match(sql, /create or replace function public\.cls_assert_leave_entitlement\(\)/i);
  assert.match(sql, /for update/i);
  assert.match(sql, /before insert or update on public\.cls_leave_requests/i);
  assert.match(sql, /security invoker/i);
  assert.match(sql, /new\.type = 'Maternity Leave'[\s\S]*new\.start_date <> v_entitlement_from/i);
  assert.match(sql, /Maternity Leave entitlement already has an active request/i);
});

const supabaseTestUrl = process.env.SUPABASE_TEST_URL;
const supabaseTestKey = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY;

test("atomic trigger permits only one request for the final outpatient day", {
  skip: !supabaseTestUrl || !supabaseTestKey
}, async () => {
  const suffix = crypto.randomUUID();
  const managerId = `test_manager_${suffix}`;
  const employeeId = `test_employee_${suffix}`;
  const headers = {
    apikey: supabaseTestKey,
    Authorization: `Bearer ${supabaseTestKey}`,
    "Content-Type": "application/json"
  };
  const rest = (resource, options = {}) => fetch(
    `${supabaseTestUrl.replace(/\/$/, "")}/rest/v1/${resource}`,
    { ...options, headers: { ...headers, ...(options.headers || {}) } }
  );

  const previousSettingResponse = await rest(
    "cls_leave_policy_settings?leave_type=eq.Medical%20Leave&select=*"
  );
  assert.equal(previousSettingResponse.ok, true);
  const [previousSetting] = await previousSettingResponse.json();

  try {
    const usersResponse = await rest("cls_users", {
      method: "POST",
      body: JSON.stringify([
        {
          id: managerId,
          name: "Concurrency Manager",
          email: `${managerId}@example.test`,
          role: "manager",
          service_start_date: "2025-01-01",
          leave_policy_year: 2026,
          password_salt: "test",
          password_hash: "test"
        },
        {
          id: employeeId,
          name: "Concurrency Employee",
          email: `${employeeId}@example.test`,
          role: "employee",
          manager_id: managerId,
          service_start_date: "2025-01-01",
          leave_policy_year: 2026,
          medical_leave_entitlement_override: 1,
          password_salt: "test",
          password_hash: "test"
        }
      ])
    });
    assert.equal(usersResponse.ok, true, await usersResponse.text());

    const settingResponse = await rest("cls_leave_policy_settings?on_conflict=leave_type", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({
        leave_type: "Medical Leave",
        enforcement_enabled: true,
        updated_at: new Date().toISOString()
      })
    });
    assert.equal(settingResponse.ok, true, await settingResponse.text());

    const makeRequest = (id) => rest("cls_leave_requests", {
      method: "POST",
      body: JSON.stringify({
        id,
        employee_id: employeeId,
        manager_id: managerId,
        type: "Medical Leave",
        start_date: "2026-07-21",
        end_date: "2026-07-21",
        days: 1,
        leave_year: 2026,
        status: "pending"
      })
    });
    const results = await Promise.allSettled([
      makeRequest(`test_leave_a_${suffix}`),
      makeRequest(`test_leave_b_${suffix}`)
    ]);
    const responses = results.map((result) => {
      assert.equal(result.status, "fulfilled");
      return result.value;
    });
    assert.equal(responses.filter((response) => response.ok).length, 1);
    const rejectedResponse = responses.find((response) => !response.ok);
    assert.match(await rejectedResponse.text(), /CLS_LEAVE_CAP:/);
  } finally {
    await rest(`cls_leave_requests?employee_id=eq.${encodeURIComponent(employeeId)}`, { method: "DELETE" });
    await rest(`cls_users?id=in.(${encodeURIComponent(employeeId)},${encodeURIComponent(managerId)})`, { method: "DELETE" });
    await rest("cls_leave_policy_settings?on_conflict=leave_type", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(previousSetting || {
        leave_type: "Medical Leave",
        enforcement_enabled: false,
        updated_at: new Date().toISOString()
      })
    });
  }
});
