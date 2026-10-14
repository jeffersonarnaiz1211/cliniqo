"use strict";
// Automated API tests. Run with: npm test
// The clock is fixed to Monday 12 Oct 2026, 10:00 clinic time, so results are repeatable.
// Test IDs (API-01 ...) can be copied into your own test-case table. Run them yourselves and record the real results.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const T = require("../server/time");
const { openDb } = require("../server/db");
const { seed } = require("../server/seed");
const { createApp } = require("../server/app");

let server, base, db;
T.configure({ tz: "Asia/Manila", now: () => new Date("2026-10-12T02:00:00Z") }); // 10:00 in Manila
const TODAY = "2026-10-12";

before(async () => {
  db = await openDb(":memory:"); // PostgreSQL running inside Node (PGlite), so no database server is needed
  await seed(db);
  const app = createApp({ db, jwtSecret: "test-secret", rateLimit: false });
  return new Promise((resolve) => { server = app.listen(0, () => { base = "http://127.0.0.1:" + server.address().port; resolve(); }); });
});
after(async () => { server.close(); await db.close(); });

function client() {
  let cookie = "";
  const c = {
    async req(method, path, body, headers) {
      const h = Object.assign({ "content-type": "application/json", "x-requested-with": "cliniqo" }, headers || {});
      if (cookie) h.cookie = cookie;
      const res = await fetch(base + path, { method, headers: h, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
      const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
      if (sc.length) cookie = sc[0].split(";")[0];
      const text = await res.text();
      let json = null; try { json = JSON.parse(text); } catch (e) { /* not JSON */ }
      return { status: res.status, json, text, headers: res.headers };
    },
    get: (p) => c.req("GET", p), post: (p, b) => c.req("POST", p, b), put: (p, b) => c.req("PUT", p, b), patch: (p, b) => c.req("PATCH", p, b), del: (p) => c.req("DELETE", p)
  };
  return c;
}
async function login(login, password) { const c = client(); const r = await c.post("/api/auth/login", { login, password }); assert.equal(r.status, 200, "login " + login); return c; }
let n = 100;
async function newStudent() {
  const c = client(); const num = "2031-" + String(++n).padStart(5, "0");
  const r = await c.post("/api/auth/register", { firstName: "Test", lastName: "Student", studentNumber: num, password: "Passw0rd1", confirmPassword: "Passw0rd1" });
  assert.equal(r.status, 201); c.num = num; c.id = r.json.user.id; return c;
}
const admin = () => login("admin@ntc.edu.ph", "Admin@123");
const staff = () => login("villanueva@ntc.edu.ph", "Staff@123");
const reyes = () => login("reyes@ntc.edu.ph", "Provider@1");
const cruz = () => login("cruz@ntc.edu.ph", "Provider@1");
async function freeSlot(c, date, deptId = 1, skip = 0) {
  const r = await c.get("/api/slots?departmentId=" + deptId + "&date=" + date);
  assert.equal(r.status, 200); assert.ok(r.json.slots.length > skip, "need a free slot on " + date + ": " + r.json.why);
  return r.json.slots[skip];
}
// Pretend a booking was made `minutes` ago (the test clock is fixed, so we edit created_at).
async function ageBooking(id, minutes) {
  const stamp = new Date(T.nowMs() - minutes * 60000).toISOString().slice(0, 19).replace("T", " ");
  await db.run("UPDATE appointments SET created_at = ? WHERE id = ?", stamp, id);
}
async function laterToday(c) {
  for (const dept of [2, 1]) { const r = await c.get("/api/slots?departmentId=" + dept + "&date=" + TODAY); const s = r.json.slots.find((x) => x.time > "10:00"); if (s) return s; }
  assert.fail("no free slot later today");
}
const book = (c, s, date) => c.post("/api/appointments", { providerId: s.providerId, date, time: s.time });

/* ---------------- Authentication ---------------- */
test("API-01 admin signs in with correct credentials", async () => {
  const c = client(); const r = await c.post("/api/auth/login", { login: "admin@ntc.edu.ph", password: "Admin@123" });
  assert.equal(r.status, 200); assert.equal(r.json.user.role, "admin");
  assert.equal((await c.get("/api/auth/me")).json.user.login, "admin@ntc.edu.ph");
});
test("API-02 wrong password is rejected with a generic message", async () => {
  const r = await client().post("/api/auth/login", { login: "admin@ntc.edu.ph", password: "wrong" });
  assert.equal(r.status, 401); assert.match(r.json.error, /Incorrect/);
});
test("API-03 unknown user gets the same message (no account enumeration)", async () => {
  const a = await client().post("/api/auth/login", { login: "nobody@ntc.edu.ph", password: "Whatever1" });
  const b = await client().post("/api/auth/login", { login: "admin@ntc.edu.ph", password: "Whatever1" });
  assert.equal(a.status, 401); assert.equal(a.json.error, b.json.error);
});
test("API-04 empty password is rejected", async () => {
  const r = await client().post("/api/auth/login", { login: "admin@ntc.edu.ph", password: "" });
  assert.equal(r.status, 400);
});
test("API-05 five failed attempts lock the account for a minute", async () => {
  const c = client(); let last;
  for (let i = 0; i < 6; i++) last = await c.post("/api/auth/login", { login: "2024-00091", password: "bad" + i });
  assert.equal(last.status, 429);
  assert.equal((await c.post("/api/auth/login", { login: "2024-00091", password: "Student@1" })).status, 429);
});
test("API-06 disabled account cannot sign in", async () => {
  const r = await client().post("/api/auth/login", { login: "2024-00210", password: "Student@1" });
  assert.equal(r.status, 403);
});
test("API-07 student registers and is signed in", async () => {
  const c = await newStudent(); const me = await c.get("/api/auth/me");
  assert.equal(me.json.user.role, "student");
});
test("API-08 registration rejects invalid student number, weak password and mismatch", async () => {
  const base = { firstName: "Ana", lastName: "Lopez", studentNumber: "2032-00001", password: "Passw0rd1", confirmPassword: "Passw0rd1" };
  assert.equal((await client().post("/api/auth/register", { ...base, studentNumber: "abc" })).status, 400);
  assert.equal((await client().post("/api/auth/register", { ...base, password: "short1", confirmPassword: "short1" })).status, 400);
  assert.equal((await client().post("/api/auth/register", { ...base, password: "onlyletters", confirmPassword: "onlyletters" })).status, 400);
  assert.equal((await client().post("/api/auth/register", { ...base, confirmPassword: "Different1" })).status, 400);
  assert.equal((await client().post("/api/auth/register", { ...base, firstName: "<script>" })).status, 400);
});
test("API-09 registering an existing student number is rejected", async () => {
  const r = await client().post("/api/auth/register", { firstName: "Maria", lastName: "Santos", studentNumber: "2024-00118", password: "Passw0rd1", confirmPassword: "Passw0rd1" });
  assert.equal(r.status, 409);
});
test("API-10 passwords are stored as hashes", async () => {
  const row = await db.get("SELECT password_hash FROM users WHERE login = 'admin@ntc.edu.ph'");
  assert.match(row.password_hash, /^\$2[aby]\$/); assert.notEqual(row.password_hash, "Admin@123");
});
test("API-11 requests without the CSRF header are blocked", async () => {
  const c = await admin();
  const r = await fetch(base + "/api/auth/logout", { method: "POST", headers: { cookie: "x=1" } });
  assert.equal(r.status, 403); assert.ok(c);
});
test("API-12 protected routes need sign-in", async () => {
  assert.equal((await client().get("/api/departments")).status, 401);
  assert.equal((await client().get("/api/users")).status, 401);
});
test("API-13 malformed JSON gives a clear error and no stack trace", async () => {
  const r = await client().req("POST", "/api/auth/login", "{not json");
  assert.equal(r.status, 400); assert.ok(!/at .*\.js/.test(r.text));
});

/* ---------------- Roles ---------------- */
test("API-14 student cannot use admin or staff endpoints", async () => {
  const s = await newStudent();
  for (const p of ["/api/users", "/api/reports?days=7", "/api/dashboard", "/api/audit", "/api/appointments?date=" + TODAY, "/api/students/lookup?studentNumber=2024-00118"]) assert.equal((await s.get(p)).status, 403, p);
  assert.equal((await s.post("/api/users", { role: "admin" })).status, 403);
});
test("API-15 staff cannot see users, reports or provider hours", async () => {
  const s = await staff();
  for (const p of ["/api/users", "/api/reports?days=7", "/api/dashboard", "/api/audit", "/api/providers/3/availability"]) assert.equal((await s.get(p)).status, 403, p);
});
test("API-16 provider sees only their own appointments", async () => {
  const p = await reyes(); const r = await p.get("/api/appointments?date=" + T.addDays(TODAY, 1));
  assert.equal(r.status, 200); assert.ok(r.json.appointments.length > 0);
  assert.ok(r.json.appointments.every((a) => a.provider.name === "Dr. Reyes"));
});
test("API-17 provider cannot change another provider's hours", async () => {
  const p = await reyes(); const cruzId = (await db.get("SELECT id FROM users WHERE login = 'cruz@ntc.edu.ph'")).id;
  assert.equal((await p.get("/api/providers/" + cruzId + "/availability")).status, 403);
  assert.equal((await p.put("/api/providers/" + cruzId + "/availability", { hours: [] })).status, 403);
});

/* ---------------- Booking ---------------- */
test("API-18 student books a free slot and it disappears from the list", async () => {
  const s = await newStudent(); const date = "2026-10-14"; const slot = await freeSlot(s, date);
  const r = await book(s, slot, date);
  assert.equal(r.status, 201); assert.equal(r.json.appointment.status, "Booked");
  const after = await s.get("/api/slots?providerId=" + slot.providerId + "&date=" + date);
  assert.ok(!after.json.slots.some((x) => x.time === slot.time));
});
test("API-19 booking a taken slot is rejected (conflict prevention)", async () => {
  const a = await newStudent(), b = await newStudent(); const date = "2026-10-15"; const slot = await freeSlot(a, date);
  assert.equal((await book(a, slot, date)).status, 201);
  const r = await book(b, slot, date); assert.equal(r.status, 409);
});
test("API-20 the database itself blocks a double booking", async () => {
  const row = await db.get("SELECT provider_id, date, time, student_id FROM appointments WHERE status <> 'Cancelled' LIMIT 1");
  await assert.rejects(db.run("INSERT INTO appointments (student_id, provider_id, date, time, created_by) VALUES (?,?,?,?,1)", row.student_id + 100, row.provider_id, row.date, row.time), (e) => e.code === "23505"); // 23505 = unique violation
});
test("API-21 booking in the past, too far ahead, or at an invalid time is rejected", async () => {
  const s = await newStudent(); const slot = await freeSlot(s, "2026-10-16");
  assert.equal((await s.post("/api/appointments", { providerId: slot.providerId, date: "2026-10-11", time: "09:00" })).status, 400);
  assert.equal((await s.post("/api/appointments", { providerId: slot.providerId, date: "2026-12-30", time: "09:00" })).status, 400);
  assert.equal((await s.post("/api/appointments", { providerId: slot.providerId, date: "2026-10-16", time: "09:15" })).status, 400);
  assert.equal((await s.post("/api/appointments", { providerId: slot.providerId, date: "2026-02-31", time: "09:00" })).status, 400);
  assert.equal((await s.post("/api/appointments", { providerId: "abc", date: "2026-10-16", time: "09:00" })).status, 400);
});
test("API-22 a slot outside the provider's hours is rejected", async () => {
  const s = await newStudent(); const slot = await freeSlot(s, "2026-10-16");
  assert.equal((await s.post("/api/appointments", { providerId: slot.providerId, date: "2026-10-16", time: "20:00" })).status, 409);
});
test("API-23 a student can hold at most three upcoming appointments", async () => {
  const s = await newStudent(); const dates = ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22"];
  for (let i = 0; i < 3; i++) assert.equal((await book(s, await freeSlot(s, dates[i]), dates[i])).status, 201);
  const r = await book(s, await freeSlot(s, dates[3]), dates[3]); assert.equal(r.status, 409); assert.match(r.json.error, /at most 3/);
});
test("API-24 a student cannot double book the same time with another provider", async () => {
  const s = await newStudent(); const date = "2026-10-21";
  const g = await s.get("/api/slots?departmentId=1&date=" + date), d = await s.get("/api/slots?departmentId=2&date=" + date);
  const common = g.json.slots.find((x) => d.json.slots.some((y) => y.time === x.time));
  if (!common) return; // the two providers have no shared time that day
  assert.equal((await book(s, common, date)).status, 201);
  const other = d.json.slots.find((y) => y.time === common.time);
  assert.equal((await book(s, other, date)).status, 409);
});
test("API-25 booking for a later time today works (staff)", async () => {
  const st = await staff(); const stu = await newStudent();
  const later = await laterToday(st);
  const r = await st.post("/api/appointments", { studentNumber: stu.num, providerId: later.providerId, date: TODAY, time: later.time });
  assert.equal(r.status, 201);
  const all = (await st.get("/api/slots?departmentId=1&date=" + TODAY)).json.slots;
  assert.ok(!all.some((x) => x.time <= "10:00"), "past times are not offered");
});
test("API-26 staff booking for an unknown student is rejected", async () => {
  const st = await staff(); const slot = await freeSlot(st, "2026-10-30");
  assert.equal((await st.post("/api/appointments", { studentNumber: "2099-00000", providerId: slot.providerId, date: "2026-10-30", time: slot.time })).status, 404);
  assert.equal((await st.post("/api/appointments", { studentNumber: "bad", providerId: slot.providerId, date: "2026-10-30", time: slot.time })).status, 400);
});

/* ---------------- Cancel and reschedule ---------------- */
test("API-27 student cancels more than 24 hours ahead and the slot is freed", async () => {
  const s = await newStudent(); const date = "2026-10-22"; const slot = await freeSlot(s, date);
  const id = (await book(s, slot, date)).json.appointment.id;
  assert.equal((await s.post("/api/appointments/" + id + "/cancel", {})).status, 200);
  assert.ok((await s.get("/api/slots?providerId=" + slot.providerId + "&date=" + date)).json.slots.some((x) => x.time === slot.time));
});
test("API-28 student cannot cancel inside the 24-hour cutoff", async () => {
  const st = await staff(), s = await newStudent();
  const slot = await laterToday(st);
  const id = (await st.post("/api/appointments", { studentNumber: s.num, providerId: slot.providerId, date: TODAY, time: slot.time })).json.appointment.id;
  await ageBooking(id, 180); // booked 3 hours ago, so the new-booking grace period is over
  const r = await s.post("/api/appointments/" + id + "/cancel", {}); assert.equal(r.status, 403); assert.match(r.json.error, /24 hours/);
  const rs = await s.post("/api/appointments/" + id + "/reschedule", { date: "2026-10-23", time: "09:00" }); assert.equal(rs.status, 403);
  assert.equal((await st.post("/api/appointments/" + id + "/cancel", { reason: "Student called" })).status, 403);
  assert.equal((await (await admin()).post("/api/appointments/" + id + "/cancel", {})).status, 400);
  assert.equal((await (await admin()).post("/api/appointments/" + id + "/cancel", { reason: "Clinic emergency" })).status, 200);
});
test("API-28a new booking inside 24 hours can be cancelled within 2 hours of booking, but not rescheduled", async () => {
  const s = await newStudent(); const slot = await laterToday(s);
  const id = (await book(s, slot, TODAY)).json.appointment.id;
  const mine = (await s.get("/api/appointments/mine")).json.upcoming.find((a) => a.id === id);
  assert.equal(mine.cutoffPassed, true); assert.ok(mine.graceMinutesLeft > 0 && mine.graceMinutesLeft <= 120);
  assert.equal((await s.post("/api/appointments/" + id + "/reschedule", { date: "2026-10-23", time: "09:00" })).status, 403);
  assert.equal((await s.post("/api/appointments/" + id + "/cancel", {})).status, 200);
  assert.ok((await s.get("/api/slots?providerId=" + slot.providerId + "&date=" + TODAY)).json.slots.some((x) => x.time === slot.time), "slot freed");
});
test("API-28b the 2-hour grace period ends, and staff can use it for a booking they just made", async () => {
  const st = await staff(), s = await newStudent(); const slot = await laterToday(st);
  const id = (await st.post("/api/appointments", { studentNumber: s.num, providerId: slot.providerId, date: TODAY, time: slot.time })).json.appointment.id;
  await ageBooking(id, 119); assert.equal((await s.get("/api/appointments/mine")).json.upcoming[0].graceMinutesLeft, 1);
  await ageBooking(id, 121); assert.equal((await s.get("/api/appointments/mine")).json.upcoming[0].graceMinutesLeft, 0);
  assert.equal((await s.post("/api/appointments/" + id + "/cancel", {})).status, 403);
  await ageBooking(id, 30);
  assert.equal((await st.post("/api/appointments/" + id + "/cancel", {})).status, 400, "staff still must give a reason");
  assert.equal((await st.post("/api/appointments/" + id + "/cancel", { reason: "Booked wrong student" })).status, 200);
});
test("API-29 a student cannot cancel another student's appointment", async () => {
  const a = await newStudent(), b = await newStudent(); const date = "2026-10-23"; const id = (await book(a, await freeSlot(a, date), date)).json.appointment.id;
  assert.equal((await b.post("/api/appointments/" + id + "/cancel", {})).status, 404);
});
test("API-30 reschedule to a free slot works, to a taken slot is rejected", async () => {
  const a = await newStudent(), b = await newStudent(); const d1 = "2026-10-24", d2 = "2026-10-26";
  const s1 = await freeSlot(a, d1); const id = (await book(a, s1, d1)).json.appointment.id;
  const s2 = await freeSlot(b, d2); assert.equal((await book(b, s2, d2)).status, 201);
  assert.equal((await a.post("/api/appointments/" + id + "/reschedule", { date: d2, time: s2.time })).status === 409 || s2.providerId !== s1.providerId, true);
  const free = await a.get("/api/slots?providerId=" + s1.providerId + "&date=" + d2 + "&ignoreAppointmentId=" + id);
  const target = free.json.slots[0]; const ok = await a.post("/api/appointments/" + id + "/reschedule", { date: d2, time: target.time });
  assert.equal(ok.status, 200); assert.equal(ok.json.appointment.date, d2);
});
test("API-31 mine splits upcoming and past appointments", async () => {
  const s = await login("2024-00118", "Student@1"); const r = await s.get("/api/appointments/mine");
  assert.equal(r.status, 200); assert.ok(Array.isArray(r.json.upcoming) && Array.isArray(r.json.past));
  assert.ok(r.json.past.every((a) => a.status !== "Booked" || a.hoursUntil < -1));
});

/* ---------------- Status changes ---------------- */
test("API-32 staff checks in, provider completes, and invalid changes are refused", async () => {
  const st = await staff(), pr = await reyes(); const stu = await newStudent();
  const slot = (await st.get("/api/slots?providerId=" + (await db.get("SELECT id FROM users WHERE login='reyes@ntc.edu.ph'")).id + "&date=2026-10-27")).json.slots[0];
  const id = (await st.post("/api/appointments", { studentNumber: stu.num, providerId: slot.providerId, date: "2026-10-27", time: slot.time })).json.appointment.id;
  assert.equal((await pr.post("/api/appointments/" + id + "/status", { status: "Checked in" })).status, 403);
  assert.equal((await st.post("/api/appointments/" + id + "/status", { status: "Checked in" })).status, 200);
  assert.equal((await st.post("/api/appointments/" + id + "/status", { status: "Checked in" })).status, 409);
  assert.equal((await pr.post("/api/appointments/" + id + "/status", { status: "Completed" })).status, 200);
  assert.equal((await st.post("/api/appointments/" + id + "/status", { status: "Banana" })).status, 400);
  assert.equal((await stu.post("/api/appointments/" + id + "/status", { status: "Completed" })).status, 403);
});
test("API-33 a provider cannot update another provider's appointment", async () => {
  const st = await staff(), cz = await cruz(), stu = await newStudent();
  const rid = (await db.get("SELECT id FROM users WHERE login='reyes@ntc.edu.ph'")).id;
  const slot = (await st.get("/api/slots?providerId=" + rid + "&date=2026-10-28")).json.slots[0];
  const id = (await st.post("/api/appointments", { studentNumber: stu.num, providerId: rid, date: "2026-10-28", time: slot.time })).json.appointment.id;
  assert.equal((await cz.post("/api/appointments/" + id + "/status", { status: "Completed" })).status, 404);
});

/* ---------------- Notifications ---------------- */
test("API-34 booking creates a notification, and a reminder appears within 24 hours", async () => {
  const st = await staff(), s = await newStudent();
  const slot = await laterToday(st);
  await st.post("/api/appointments", { studentNumber: s.num, providerId: slot.providerId, date: TODAY, time: slot.time });
  const r = await s.get("/api/notifications"); const types = r.json.notifications.map((x) => x.type);
  assert.ok(types.includes("booked")); assert.ok(types.includes("reminder")); assert.equal(r.json.unread, types.length);
  await s.post("/api/notifications/read-all", {}); assert.equal((await s.get("/api/notifications")).json.unread, 0);
});

/* ---------------- Admin: users, hours, reports ---------------- */
test("API-35 admin creates a provider, with validation and duplicate checks", async () => {
  const a = await admin();
  const ok = await a.post("/api/users", { role: "provider", firstName: "Dr.", lastName: "Tester", login: "tester@ntc.edu.ph", password: "Passw0rd1", departmentId: 1 });
  assert.equal(ok.status, 201);
  assert.equal((await db.get("SELECT COUNT(*)::int c FROM availability WHERE provider_id = ?", ok.json.user.id)).c, 7);
  assert.equal((await a.post("/api/users", { role: "provider", firstName: "Dr.", lastName: "Tester", login: "tester@ntc.edu.ph", password: "Passw0rd1", departmentId: 1 })).status, 409);
  assert.equal((await a.post("/api/users", { role: "staff", firstName: "No", lastName: "Email", login: "nope", password: "Passw0rd1" })).status, 400);
  assert.equal((await a.post("/api/users", { role: "student", firstName: "Bad", lastName: "Number", login: "x@y.z", password: "Passw0rd1" })).status, 400);
  assert.equal((await a.post("/api/users", { role: "provider", firstName: "No", lastName: "Dept", login: "nodept@ntc.edu.ph", password: "Passw0rd1" })).status, 400);
  assert.equal((await a.post("/api/users", { role: "god", firstName: "No", lastName: "Role", login: "r@ntc.edu.ph", password: "Passw0rd1" })).status, 400);
});
test("API-36 admin cannot disable themself, and a disabled user loses access", async () => {
  const a = await admin(), s = await newStudent();
  assert.equal((await a.patch("/api/users/1", { active: false })).status, 409);
  assert.equal((await a.patch("/api/users/" + s.id, { active: false })).status, 200);
  assert.equal((await s.get("/api/auth/me")).status, 401);
  assert.equal((await client().post("/api/auth/login", { login: s.num, password: "Passw0rd1" })).status, 403);
  assert.equal((await a.patch("/api/users/" + s.id, { active: true })).status, 200);
});
test("API-37 admin resets a password", async () => {
  const a = await admin(), s = await newStudent();
  assert.equal((await a.post("/api/users/" + s.id + "/password", { password: "short" })).status, 400);
  assert.equal((await a.post("/api/users/" + s.id + "/password", { password: "NewPassw0rd" })).status, 200);
  assert.equal((await client().post("/api/auth/login", { login: s.num, password: "NewPassw0rd" })).status, 200);
});
test("API-38 hours: invalid times are rejected and valid hours change the slots", async () => {
  const a = await admin(); const rid = (await db.get("SELECT id FROM users WHERE login='reyes@ntc.edu.ph'")).id;
  const cur = (await a.get("/api/providers/" + rid + "/availability")).json.hours;
  const bad1 = cur.map((h) => (h.weekday === 0 ? { ...h, working: true, start: "12:00", end: "09:00" } : h));
  assert.equal((await a.put("/api/providers/" + rid + "/availability", { hours: bad1 })).status, 400);
  assert.equal((await a.put("/api/providers/" + rid + "/availability", { hours: cur.slice(0, 3) })).status, 400);
  assert.equal((await a.put("/api/providers/" + rid + "/availability", { hours: cur.map((h) => (h.weekday === 0 ? { ...h, start: "09:10" } : h)) })).status, 400);
  const longer = cur.map((h) => (h.weekday === 5 ? { ...h, working: true, start: "09:00", end: "10:00" } : h));
  assert.equal((await a.put("/api/providers/" + rid + "/availability", { hours: longer })).status, 200);
  assert.equal((await a.get("/api/slots?providerId=" + rid + "&date=2026-10-31")).json.slots.length, 2);
  assert.equal((await a.put("/api/providers/" + rid + "/availability", { hours: cur })).status, 200);
});
test("API-39 blocked dates remove slots and cannot be duplicated", async () => {
  const pr = await reyes(); const rid = (await db.get("SELECT id FROM users WHERE login='reyes@ntc.edu.ph'")).id;
  assert.equal((await pr.post("/api/providers/" + rid + "/blocked", { date: "2026-11-02", reason: "Training" })).status, 201);
  assert.equal((await pr.post("/api/providers/" + rid + "/blocked", { date: "2026-11-02", reason: "Again" })).status, 409);
  assert.equal((await pr.post("/api/providers/" + rid + "/blocked", { date: "2026-10-01", reason: "Past" })).status, 400);
  assert.equal((await pr.get("/api/slots?providerId=" + rid + "&date=2026-11-02")).json.slots.length, 0);
  const b = (await pr.get("/api/providers/" + rid + "/availability")).json.blocked.find((x) => x.date === "2026-11-02");
  assert.equal((await pr.del("/api/providers/" + rid + "/blocked/" + b.id)).status, 200);
});
test("API-40 reports add up, reject bad ranges, and export CSV", async () => {
  const a = await admin(); const r = await a.get("/api/reports?days=7");
  assert.equal(r.status, 200); assert.equal(r.json.perDay.length, 7); assert.ok(r.json.total >= r.json.completed + r.json.noShow + r.json.cancelled);
  assert.equal((await a.get("/api/reports?days=99")).status, 400);
  const csv = await a.get("/api/reports.csv?days=7"); assert.equal(csv.status, 200);
  assert.match(csv.headers.get("content-type"), /text\/csv/); assert.match(csv.text.split("\r\n")[0], /^"?Date/);
});
test("API-41 dashboard and audit log respond for admin and record actions", async () => {
  const a = await admin(); const d = await a.get("/api/dashboard");
  assert.equal(d.status, 200); assert.equal(typeof d.json.openSlots, "number");
  const log = await a.get("/api/audit"); assert.ok(log.json.entries.some((e) => e.action === "Created user (provider)"));
});
test("API-42 search input cannot inject SQL", async () => {
  const a = await admin(); const r = await a.get("/api/users?q=" + encodeURIComponent("' OR 1=1 --"));
  assert.equal(r.status, 200); assert.equal(r.json.users.length, 0);
  assert.equal((await a.get("/api/appointments?date=" + encodeURIComponent("2026-10-12' OR '1'='1"))).status, 400);
});
