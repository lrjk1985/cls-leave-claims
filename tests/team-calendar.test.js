const test = require("node:test");
const assert = require("node:assert/strict");
const { teamCalendar } = require("../src/teamCalendar");
const { readSupabaseTeamCalendar } = require("../server").__test;
const user = { id: "e", name: "Example Colleague" };
const booking = { employeeId: "e", startDate: "2026-11-19", endDate: "2026-11-23",
  status: "approved", type: "Private category", reason: "Private explanation",
  decisionNote: "Private note", medicalCertificate: { storedName: "private.pdf" } };
const db = (...rows) => ({ users: [user], leaveRequests: rows });
test("public availability lists only approved dates, names and portions", async () => {
  const entries = await teamCalendar(db({ ...booking, cancellationReview: { state: "pending" },
    excludedDates: [{date:"2026-11-20",reason:"Holiday"}] },
    ...["cancelled","pending","rejected"].map(status => ({ ...booking, status })),
    ...["morning","afternoon"].map(dayPortion => ({ ...booking, dayPortion, endDate: booking.startDate }))), "2026-11");
  assert.deepEqual(entries, [
    ...["AM","Full day","PM"].map(portion => ({ name:user.name,date:"2026-11-19",portion })),
    { name:user.name,date:"2026-11-23",portion:"Full day" }
  ]);
});
test("calendar-day bookings cross months; custom schedules exclude weekend holidays", async () => {
  const entries = await teamCalendar(db({ ...booking, countingMethod:"calendar_days", startDate:"2026-10-30",endDate:"2026-11-01" },
    { ...booking, workScheduleSnapshot:[6,7], excludedDates:[{date:"2026-11-21",reason:"Weekend"}] }),
    "2026-11", async () => [{ date:"2026-11-22" }]);
  assert.deepEqual(entries.map(e => e.date), ["2026-11-01","2026-11-21"]);
  await assert.rejects(teamCalendar(db(), "2026-13"), /month/);
});

const signedRequest = { headers: { cookie: "cls_session=" + "a".repeat(64) } };
test("calendar rejects missing or invalid sessions without exposing bookings", async () => {
  let calls = 0;
  const read = async () => { calls++; return {json:async()=>null}; };
  await assert.rejects(readSupabaseTeamCalendar({ headers: {} }, "2026-11", read), {status:401});
  assert.equal(calls, 0);
  await assert.rejects(readSupabaseTeamCalendar(signedRequest, "2026-11", read), {status:401});
  assert.equal(calls, 1);
});

test("calendar uses a single server-side call; authenticated empty months return no entries", async () => {
  for (const rows of [[], [{employee_id:"e",name:"Colleague",start_date:"2026-02-02",
    end_date:"2026-02-02",day_portion:"afternoon"}]]) {
    let calls = 0;
    const result = await readSupabaseTeamCalendar(signedRequest,"2026-02", async (path, options) => {
      calls++;
      assert.equal(path,"/rest/v1/rpc/cls_team_calendar_month");
      assert.equal(options.method,"POST");
      assert.deepEqual(JSON.parse(options.body),{p_token:"a".repeat(64),p_first:"2026-02-01"});
      return {json:async()=>rows};
    });
    assert.equal(calls,1);
    assert.deepEqual(result, rows.length ? [{name:"Colleague",date:"2026-02-02",portion:"PM"}] : []);
  }
});
