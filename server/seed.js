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

async function seed(db) {
  const hash = (p) => bcrypt.hashSync(p, 10);
  await db.tx(async (db) => {
    const dept = {};
    for (const n of ["General Medicine", "Dental"]) dept[n] = await db.insert("INSERT INTO departments (name) VALUES (?)", n);
    const addUser = (role, f, l, login, pw, d) => db.insert("INSERT INTO users (role, first_name, last_name, login, password_hash, department_id) VALUES (?,?,?,?,?,?)", role, f, l, login, hash(pw), d || null);
    await addUser("admin", ...DEMO.admin.slice(0, 2), DEMO.admin[2], DEMO.admin[3]);
    await addUser("staff", ...DEMO.staff.slice(0, 2), DEMO.staff[2], DEMO.staff[3]);
    const provIds = [];
    for (const p of DEMO.providers) provIds.push(await addUser("provider", p[0], p[1], p[2], DEMO.providerPassword, dept[p[3]]));
    const stuIds = [];
    for (const [i, s] of DEMO.students.entries()) {
      const id = await addUser("student", s[0], s[1], s[2], DEMO.studentPassword);
      if (i === 2) await db.run("UPDATE users SET active = 0 WHERE id = ?", id);
      stuIds.push(id);
    }

    // Hours: Dr. Reyes mornings Mon-Sat, Dr. Cruz afternoons Mon-Wed and Fri-Sat.
    for (const [i, pid] of provIds.entries()) for (let d = 0; d < 7; d++) {
      const working = d !== 6 && !(i === 1 && d === 3);
      await db.run("INSERT INTO availability (provider_id, weekday, working, start_time, end_time) VALUES (?,?,?,?,?)", pid, d, working ? 1 : 0, i === 0 ? "09:00" : "13:00", i === 0 ? "12:00" : "16:00");
    }
    await db.run("INSERT INTO blocked_dates (provider_id, date, reason) VALUES (?,?,?)", provIds[0], T.addDays(T.today(), 5), "Seminar");

    // Sample appointments from 13 days ago to 6 days ahead.
    const rand = rng(42), today = T.today();
    const slots = [["09:00", "09:30", "10:00", "10:30", "11:00", "11:30"], ["13:00", "13:30", "14:00", "14:30", "15:00", "15:30"]];
    for (let off = -13; off <= 6; off++) {
      const date = T.addDays(today, off), wd = T.weekday(date);
      for (const [i, pid] of provIds.entries()) {
        if (wd === 6 || (i === 1 && wd === 3) || await db.get("SELECT 1 FROM blocked_dates WHERE provider_id = ? AND date = ?", pid, date)) continue;
        for (const t of slots[i]) {
          if (rand() > 0.55) continue;
          const sid = stuIds[Math.floor(rand() * stuIds.length)];
          if (sid === stuIds[2]) continue;
          const r = rand(); let status;
          if (off < 0) status = r < 0.7 ? "Completed" : r < 0.86 ? "No-show" : "Cancelled";
          else if (off === 0) status = r < 0.3 ? "Completed" : r < 0.4 ? "Checked in" : r < 0.5 ? "Cancelled" : "Booked";
          else status = r < 0.92 ? "Booked" : "Cancelled";
          // ON CONFLICT DO NOTHING skips a clash with the unique slot rules without aborting the transaction.
          await db.run("INSERT INTO appointments (student_id, provider_id, date, time, status, cancel_reason, created_by) VALUES (?,?,?,?,?,?,?) ON CONFLICT DO NOTHING", sid, pid, date, t, status, status === "Cancelled" ? "Student request" : null, sid);
        }
      }
    }
    await db.run("INSERT INTO audit_log (user_name, action) VALUES ('System', 'Seeded demo data')");
  });
}
module.exports = { seed, DEMO };

if (require.main === module) {
  (async () => {
    const cfg = require("./config");
    T.configure({ tz: cfg.clinicTz });
    const { openDb } = require("./db");
    const db = await openDb(cfg.dbTarget);
    if (await db.get("SELECT 1 FROM users LIMIT 1")) { console.log("The database already has users, so nothing was changed. To start fresh, empty the tables first (see README)."); await db.close(); process.exit(1); }
    await seed(db);
    await db.close();
    console.log("Demo data created.");
  })().catch((e) => { console.error("Seeding failed:", e.message); process.exit(1); });
}
