"use strict";
// Demo data: fictional people, dummy passwords. Never use these accounts or passwords for real.
const bcrypt = require("bcryptjs");
const T = require("./time");

const DEMO = {
  admin: ["Admin", "User", "admin@ntc.edu.ph", "Admin@123"],
  staff: ["L.", "Villanueva", "villanueva@ntc.edu.ph", "Staff@123"],
  providers: [["Dr.", "Reyes", "reyes@ntc.edu.ph", "General Medicine"], ["Dr.", "Cruz", "cruz@ntc.edu.ph", "Dental"]],
  providerPassword: "Provider@1",
  studentPassword: "Student@1",
  students: [["Maria", "Santos", "2024-00118"], ["Jefferson", "Arnaiz", "2024-00123"], ["Paolo", "Dela Cruz", "2024-00210"], ["Ana", "Lim", "2024-00177"], ["Ken", "Ocampo", "2024-00091"], ["Rhea", "Tan", "2024-00144"], ["Carlo", "Mendoza", "2024-00152"], ["Bea", "Flores", "2024-00203"], ["Miguel", "Ramos", "2024-00066"], ["Jo", "Navarro", "2024-00189"]]
};

function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function seed(db) {
  const hash = (p) => bcrypt.hashSync(p, 10);
  const run = db.transaction(() => {
    const dept = {};
    ["General Medicine", "Dental"].forEach((n) => { dept[n] = db.prepare("INSERT INTO departments (name) VALUES (?)").run(n).lastInsertRowid; });
    const addUser = (role, f, l, login, pw, d) => db.prepare("INSERT INTO users (role, first_name, last_name, login, password_hash, department_id) VALUES (?,?,?,?,?,?)").run(role, f, l, login, hash(pw), d || null).lastInsertRowid;
    addUser("admin", ...DEMO.admin.slice(0, 2), DEMO.admin[2], DEMO.admin[3]);
    addUser("staff", ...DEMO.staff.slice(0, 2), DEMO.staff[2], DEMO.staff[3]);
    const provIds = DEMO.providers.map((p) => addUser("provider", p[0], p[1], p[2], DEMO.providerPassword, dept[p[3]]));
    const stuIds = DEMO.students.map((s, i) => { const id = addUser("student", s[0], s[1], s[2], DEMO.studentPassword); if (i === 2) db.prepare("UPDATE users SET active = 0 WHERE id = ?").run(id); return id; });

    // Hours: Dr. Reyes mornings Mon-Sat, Dr. Cruz afternoons Mon-Wed and Fri-Sat.
    provIds.forEach((pid, i) => { for (let d = 0; d < 7; d++) {
      const working = d !== 6 && !(i === 1 && d === 3);
      db.prepare("INSERT INTO availability (provider_id, weekday, working, start_time, end_time) VALUES (?,?,?,?,?)").run(pid, d, working ? 1 : 0, i === 0 ? "09:00" : "13:00", i === 0 ? "12:00" : "16:00");
    } });
    db.prepare("INSERT INTO blocked_dates (provider_id, date, reason) VALUES (?,?,?)").run(provIds[0], T.addDays(T.today(), 5), "Seminar");

    // Sample appointments from 13 days ago to 6 days ahead.
    const rand = rng(42), today = T.today();
    const slots = [["09:00", "09:30", "10:00", "10:30", "11:00", "11:30"], ["13:00", "13:30", "14:00", "14:30", "15:00", "15:30"]];
    for (let off = -13; off <= 6; off++) {
      const date = T.addDays(today, off), wd = T.weekday(date);
      provIds.forEach((pid, i) => {
        if (wd === 6 || (i === 1 && wd === 3) || db.prepare("SELECT 1 FROM blocked_dates WHERE provider_id = ? AND date = ?").get(pid, date)) return;
        slots[i].forEach((t) => {
          if (rand() > 0.55) return;
          const sid = stuIds[Math.floor(rand() * stuIds.length)];
          if (sid === stuIds[2]) return;
          const r = rand(); let status;
          if (off < 0) status = r < 0.7 ? "Completed" : r < 0.86 ? "No-show" : "Cancelled";
          else if (off === 0) status = r < 0.3 ? "Completed" : r < 0.4 ? "Checked in" : r < 0.5 ? "Cancelled" : "Booked";
          else status = r < 0.92 ? "Booked" : "Cancelled";
          try { db.prepare("INSERT INTO appointments (student_id, provider_id, date, time, status, cancel_reason, created_by) VALUES (?,?,?,?,?,?,?)").run(sid, pid, date, t, status, status === "Cancelled" ? "Student request" : null, sid); } catch (e) { /* skip a clash with the unique slot rules */ }
        });
      });
    }
    db.prepare("INSERT INTO audit_log (user_name, action) VALUES ('System', 'Seeded demo data')").run();
  });
  run();
}
module.exports = { seed, DEMO };

if (require.main === module) {
  const cfg = require("./config");
  T.configure({ tz: cfg.clinicTz });
  const { openDb } = require("./db");
  const db = openDb(cfg.dbPath);
  if (db.prepare("SELECT 1 FROM users LIMIT 1").get()) { console.log("The database already has users. Delete the file at " + cfg.dbPath + " first to start fresh."); process.exit(1); }
  seed(db);
  console.log("Demo data created.");
}
