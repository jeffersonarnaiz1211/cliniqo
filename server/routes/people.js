"use strict";
const express = require("express");
const bcrypt = require("bcryptjs");
const T = require("../time");
const { HttpError, bad, str, personName, password, studentNumber, email, intId } = require("../util");
const D = require("../domain");
const { requireRole } = require("../auth");
const { isConflict } = require("../db");

module.exports = function (ctx) {
  const r = express.Router(), db = ctx.db;
  const admin = requireRole("admin");
  const ROLES = ["student", "staff", "provider", "admin"];

  /* ---------- Users (admin) ---------- */
  r.get("/users", admin, async (req, res) => {
    const where = [], args = [];
    if (req.query.role) { if (!ROLES.includes(req.query.role)) throw bad("Unknown role.", "role"); where.push("u.role = ?"); args.push(req.query.role); }
    if (req.query.q) { const q = "%" + String(req.query.q).slice(0, 40).toLowerCase().replace(/[%_]/g, "") + "%"; where.push("(lower(u.first_name || ' ' || u.last_name) LIKE ? OR lower(u.login) LIKE ?)"); args.push(q, q); }
    const rows = await db.all("SELECT u.*, d.name dname FROM users u LEFT JOIN departments d ON d.id = u.department_id" + (where.length ? " WHERE " + where.join(" AND ") : "") + " ORDER BY CASE u.role WHEN 'admin' THEN 0 WHEN 'staff' THEN 1 WHEN 'provider' THEN 2 ELSE 3 END, u.last_name LIMIT 300", ...args);
    res.json({ users: rows.map((u) => Object.assign(D.userDto(u), { department: u.dname || "" })), total: (await db.get("SELECT COUNT(*)::int c FROM users")).c });
  });

  r.post("/users", admin, async (req, res) => {
    const b = req.body;
    if (!ROLES.includes(b.role)) throw bad("Choose a role.", "role");
    const firstName = personName(b.firstName, "firstName", "First name");
    const lastName = personName(b.lastName, "lastName", "Last name");
    const login = b.role === "student" ? studentNumber(b.login, "login") : email(b.login, "login");
    const pw = password(b.password);
    let dept = null;
    if (b.role === "provider") {
      dept = intId(b.departmentId, "department");
      if (!(await db.get("SELECT 1 FROM departments WHERE id = ?", dept))) throw bad("Choose a department.", "departmentId");
    }
    if (await db.get("SELECT 1 FROM users WHERE lower(login) = ?", login.toLowerCase())) throw new HttpError(409, "An account with that ID or email already exists.", "login");
    const hash = await bcrypt.hash(pw, 10);
    let id;
    try {
      id = await db.tx(async (t) => {
        const newId = await t.insert("INSERT INTO users (role, login, first_name, last_name, password_hash, department_id) VALUES (?,?,?,?,?,?)", b.role, login, firstName, lastName, hash, dept);
        if (b.role === "provider") for (let d = 0; d < 7; d++) await t.run("INSERT INTO availability (provider_id, weekday, working) VALUES (?,?,0)", newId, d);
        return newId;
      });
    } catch (e) { if (isConflict(e)) throw new HttpError(409, "An account with that ID or email already exists.", "login"); throw e; }
    const u = await db.get("SELECT * FROM users WHERE id = ?", id);
    await D.audit(db, req.user, "Created user (" + b.role + ")", D.fullName(u));
    res.status(201).json({ user: D.userDto(u) });
  });

  r.patch("/users/:id", admin, async (req, res) => {
    const id = intId(req.params.id, "user");
    if (typeof req.body.active !== "boolean") throw bad("Send active as true or false.", "active");
    if (id === req.user.id) throw new HttpError(409, "You cannot disable your own account.");
    const u = await db.get("SELECT * FROM users WHERE id = ?", id);
    if (!u) throw new HttpError(404, "User not found.");
    await db.run("UPDATE users SET active = ? WHERE id = ?", req.body.active ? 1 : 0, id);
    await D.audit(db, req.user, req.body.active ? "Enabled account" : "Disabled account", D.fullName(u));
    res.json({ user: D.userDto(Object.assign({}, u, { active: req.body.active ? 1 : 0 })) });
  });

  r.post("/users/:id/password", admin, async (req, res) => {
    const id = intId(req.params.id, "user");
    const u = await db.get("SELECT * FROM users WHERE id = ?", id);
    if (!u) throw new HttpError(404, "User not found.");
    const pw = password(req.body.password);
    await db.run("UPDATE users SET password_hash = ? WHERE id = ?", await bcrypt.hash(pw, 10), id);
    await D.audit(db, req.user, "Reset password", D.fullName(u));
    res.json({ ok: true });
  });

  /* ---------- Provider hours and blocked dates (admin, or the provider for themselves) ---------- */
  async function ownerOrAdmin(req) {
    const id = intId(req.params.id, "provider");
    const p = await db.get("SELECT * FROM users WHERE id = ? AND role = 'provider'", id);
    if (!p) throw new HttpError(404, "Provider not found.");
    if (req.user.role === "provider" && req.user.id !== id) throw new HttpError(403, "You can only change your own hours.");
    if (!["admin", "provider"].includes(req.user.role)) throw new HttpError(403, "Your role cannot do that.");
    return p;
  }
  const hoursOf = async (id) => ({
    hours: (await db.all("SELECT weekday, working, start_time, end_time FROM availability WHERE provider_id = ? ORDER BY weekday", id)).map((h) => ({ weekday: h.weekday, day: T.DAYS[h.weekday], working: !!h.working, start: h.start_time, end: h.end_time })),
    blocked: await db.all("SELECT id, date, reason FROM blocked_dates WHERE provider_id = ? AND date >= ? ORDER BY date", id, T.today())
  });

  r.get("/providers/:id/availability", async (req, res) => { const p = await ownerOrAdmin(req); res.json(Object.assign({ provider: { id: p.id, name: D.fullName(p) } }, await hoursOf(p.id))); });

  r.put("/providers/:id/availability", async (req, res) => {
    const p = await ownerOrAdmin(req);
    const hours = req.body.hours;
    if (!Array.isArray(hours) || hours.length !== 7) throw bad("Send hours for all 7 days.", "hours");
    const seen = new Set();
    hours.forEach((h) => {
      if (!Number.isInteger(h.weekday) || h.weekday < 0 || h.weekday > 6 || seen.has(h.weekday)) throw bad("Invalid weekday.", "hours");
      seen.add(h.weekday);
      if (typeof h.working !== "boolean") throw bad("Working must be true or false.", "hours");
      if (!T.isTime(h.start) || !T.isTime(h.end)) throw bad(T.DAYS[h.weekday] + ": times must be on the hour or half hour, like 09:00 or 13:30.", "hours");
      if (h.working && T.toMin(h.start) >= T.toMin(h.end)) throw bad(T.DAYS[h.weekday] + ": end time must be after start time.", "hours");
    });
    await db.tx(async (t) => { for (const h of hours) await t.run("UPDATE availability SET working = ?, start_time = ?, end_time = ? WHERE provider_id = ? AND weekday = ?", h.working ? 1 : 0, h.start, h.end, p.id, h.weekday); });
    await D.audit(db, req.user, "Updated provider hours", D.fullName(p));
    res.json(await hoursOf(p.id));
  });

  r.post("/providers/:id/blocked", async (req, res) => {
    const p = await ownerOrAdmin(req);
    if (!T.isDate(req.body.date) || req.body.date < T.today()) throw bad("Choose today or a later date.", "date");
    const reason = str(req.body.reason, "reason", { label: "Reason", max: 80 });
    if (await db.get("SELECT 1 FROM blocked_dates WHERE provider_id = ? AND date = ?", p.id, req.body.date)) throw new HttpError(409, "That date is already blocked.", "date");
    try { await db.run("INSERT INTO blocked_dates (provider_id, date, reason) VALUES (?,?,?)", p.id, req.body.date, reason); }
    catch (e) { if (isConflict(e)) throw new HttpError(409, "That date is already blocked.", "date"); throw e; }
    await D.audit(db, req.user, "Blocked date", D.fullName(p) + " · " + req.body.date);
    res.status(201).json(await hoursOf(p.id));
  });
  r.delete("/providers/:id/blocked/:bid", async (req, res) => {
    const p = await ownerOrAdmin(req);
    await db.run("DELETE FROM blocked_dates WHERE id = ? AND provider_id = ?", intId(req.params.bid, "date"), p.id);
    await D.audit(db, req.user, "Removed blocked date", D.fullName(p));
    res.json(await hoursOf(p.id));
  });
  return r;
};
