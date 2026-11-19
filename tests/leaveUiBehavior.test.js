const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");

function browser() {
  const context = vm.createContext({
    FormData, AbortController,
    document: { querySelector: () => null, addEventListener: () => {} },
    window: { matchMedia: () => ({ matches: true }) },
    // Leave startup session loading pending; these tests supply their own dashboard.
    fetch: () => new Promise(() => {})
  });
  vm.runInContext(source, context);
  vm.runInContext(`state.dashboard = {
    user: { id: "employee", workSchedule: [1,2,3,4,5] },
    offInLieuSummary: { awards: [] }, leaveEntitlementSummaries: []
  }`, context);
  return context;
}

test("employee balance cards lead with days and keep approvals separate from pending", () => {
  const c = browser();
  vm.runInContext("state.dashboard.leaveSummary = {available:14,entitlement:16,approved:2,pending:0.5}", c);
  for (const html of [c.renderEmployeeBalanceRings(), c.renderLeavePageRings()]) {
    assert.match(html, /14 days left/);
    assert.match(html, /16 days total/);
  }
  assert.match(c.renderLeavePageRings(), /0.5 days pending/);
  assert.match(c.renderLeavePageRings(), /2 days approved/);
  vm.runInContext("state.dashboard.user.unlimitedAnnualLeave = true", c);
  assert.match(c.renderLeavePageRings(), /Unlimited/);
  assert.doesNotMatch(c.renderLeavePageRings(), /16 days total/);
});

test("cancellation deadline is the last Singapore minute before the start date", () => {
  const context = browser();
  assert.match(context.cancellationDeadline("2027-01-01"), /31 Dec 2026.*11:59 pm Singapore time/);
});

test("expiry notice groups only active unreserved days expiring within 30 days", () => {
  const context = browser();
  const award = {active:true,unreserved:0.5,expiresOn:"2027-01-01"};
  const awards = [award, award, {...award,unreserved:0}, {...award,active:false},
    {...award,expiresOn:"2027-01-02"}, {...award,expiresOn:"2026-12-02"}];
  assert.match(context.renderExpiryNotice(awards,"2026-12-02"), /1 day of Off-in-Lieu.*31 Dec 2026/);
  assert.equal(context.renderExpiryNotice([award],"2026-12-01"), "");
  assert.equal(context.renderExpiryNotice([award],"2027-01-01"), "");
});

test("form renders server results and ignores a stale response after a date change", async () => {
  const context = browser();
  const calls = [];
  context.fetch = (url, options) => new Promise(resolve => calls.push({url, options, resolve}));
  const estimate = {dataset:{}}, submit = {}, date = {value:"2027-02-08"};
  const form = {dataset:{}, querySelector: key => ({
    "[data-leave-estimate]": estimate, "button[type='submit']": submit,
    "input[name='startDate']": date, "input[name='endDate']": {value:"2027-02-09"},
    "select[name='type']": {value:"Annual Leave"}
  })[key]};
  const stale = context.updateLeaveRequestEstimate(form);
  date.value = "2027-02-05";
  const latest = context.updateLeaveRequestEstimate(form);
  assert.equal(submit.disabled, true);
  assert.equal(calls[1].url, "/api/leave-preview");
  assert.equal(JSON.parse(calls[1].options.body).startDate, date.value);
  calls[1].resolve({ok:true,json:async()=>({data:{days:2,remaining:9,excludedHolidays:[
    {date:"2027-02-08",name:"Chinese New Year (observed)"}],blocked:""}})});
  await latest;
  calls[0].resolve({ok:false,json:async()=>({error:"Stale error"})});
  await stale;
  assert.match(estimate.innerHTML, /2 scheduled days/);
  assert.match(estimate.innerHTML, /Expected remaining: 9/);
  assert.match(estimate.innerHTML, /Chinese New Year/);
  assert.equal(submit.disabled, false);
});
