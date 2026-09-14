const test = require("node:test");
const assert = require("node:assert/strict");
const { __test } = require("../server");

function fixture(t) {
  __test.sessions.clear();
  t.after(() => __test.sessions.clear());
  const employee = { id: "employee", active: true };
  const other = { id: "other", active: true };
  const session = { token: "employee-token", userId: employee.id, expiresAt: Date.now() + 60000 };
  const otherSession = { token: "other-token", userId: other.id, expiresAt: Date.now() + 60000 };
  const db = { users: [employee, other], sessions: [session, otherSession] };
  const req = { headers: { cookie: `cls_session=${session.token}` } };
  return { db, req, session, otherSession, employee };
}

test("a session revoked by another server is rejected despite a warm memory cache", (t) => {
  const { db, req, session } = fixture(t);
  __test.sessions.set(session.token, session);
  db.sessions = [];
  assert.equal(__test.getAuthenticatedUser(req, db), null);
  assert.equal(__test.sessions.has(session.token), false);
});

test("a valid persisted session works on a cold server", (t) => {
  const { db, req, employee } = fixture(t);
  assert.equal(__test.getAuthenticatedUser(req, db), employee);
});

test("persisted expiry takes precedence over stale cached expiry", (t) => {
  const { db, req, session } = fixture(t);
  __test.sessions.set(session.token, { ...session });
  session.expiresAt = Date.now() - 1000;
  assert.equal(__test.getAuthenticatedUser(req, db), null);
});

test("admin password reset revokes only the affected employee's sessions", (t) => {
  const { db, req, session, otherSession, employee } = fixture(t);
  db.sessions.forEach((item) => __test.sessions.set(item.token, item));
  __test.resetEmployeePassword(db, employee.id, { password: "new-test-password" });
  assert.equal(__test.verifyPassword("new-test-password", employee), true);
  assert.deepEqual(db.sessions, [otherSession]);
  assert.equal(__test.sessions.has(session.token), false);
  assert.equal(__test.sessions.has(otherSession.token), true);
  assert.equal(__test.getAuthenticatedUser(req, db), null);
  // Another server may still hold the old token in memory after the reset.
  __test.sessions.set(session.token, session);
  assert.equal(__test.getAuthenticatedUser(req, db), null);
});

test("an invalid password reset preserves the current session", (t) => {
  const { db, req, employee } = fixture(t);
  assert.throws(() => __test.resetEmployeePassword(db, employee.id, { password: "short" }));
  assert.equal(__test.getAuthenticatedUser(req, db), employee);
});
