"use strict";
const express = require("express");
const bcrypt = require("bcryptjs");
const T = require("../time");
const { HttpError, bad, str, personName, password, studentNumber, email, intId } = require("../util");
const D = require("../domain");
const { requireRole } = require("../auth");

module.exports = function (ctx) {
  const r = express.Router(), db = ctx.db;
  const admin = requireRole("admin");
  const ROLES = ["student", "staff", "provider", "admin"];

  /* ---------- Users (admin) ---------- */
  r.get("/users", admin, (req, res) => {
    const where = [], args = [];
    if (req.query.role) { if (!ROLES.includes(req.query.role)) throw bad("Unknown role.", "role"); where.push("u.role = ?"); args.push(req.query.role); }
    if (req.query.q) { const q = "%" + String(req.query.q).slice(0, 40).toLowerCase().replace(/[%_]/g, "") + "%"; where.push("(lower(u.first_name || ' ' || u.last_name) LIKE ? OR lower(u.login) LIKE ?)"); args.push(q, q); }
    const rows = db.prepare("SELECT u.*, d.name dname FROM users u LEFT JOIN departments d ON d.id = u.department_id" + (where.length ? " WHERE " + where.join(" AND ") : "") + " ORDER BY CASE u.role WHEN 'admin' THEN 0 WHEN 'staff' THEN 1 WHEN 'provider' THEN 2 ELSE 3 END, u.last_name LIMIT 300").all(...args);
    res.json({ users: rows.map((u) => Object.assign(D.userDto(u), { department: u.dname || "" })), total: db.prepare("SELECT COUNT(*) c FROM users").get().c });
  });

  r.post("/users", admin, (req, res) => {
    const b = req.body;
    if (!ROLES.includes(b.role)) throw bad("Choose a role.", "role");
    const firstName = personName(b.firstName, "firstName", "First name");
    const lastName = personName(b.lastName, "lastName", "Last name");
    const login = b.role === "student" ? studentNumber(b.login, "login") : email(b.login, "login");
    const pw = password(b.password);
    let dept = null;
    if (b.role === "provider") {
      dept = intId(b.departmentId, "department");
      if (!db.prepare("SELECT 1 FROM departments WHERE id = ?").get(dept)) throw bad("Choose a department.", "departmentId");
    }
    if (db.prepare("SELECT 1 FROM users WHERE lower(login) = ?").get(login.toLowerCase())) throw new HttpError(409, "An account with that ID or email already exists.", "login");
    const create = db.transaction(() => {
      const id = db.prepare("INSERT INTO users (role, login, first_name, last_name, password_hash, department_id) VALUES (?,?,?,?,?,?)").run(b.role, login, firstName, lastName, bcrypt.hashSync(pw, 10), dept).lastInsertRowid;
      if (b.role === "provider") for (let d = 0; d < 7; d++) db.prepare("INSERT INTO availability (provider_id, weekday, working) VALUES (?,?,0)").run(id, d);
      return id;
    });
    const id = create();
    const u = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
    D.audit(db, req.user, "Created user (" + b.role + ")", D.fullName(u));
    res.status(201).json({ user: D.userDto(u) });
  });

  r.patch("/users/:id", admin, (req, res) => {
    const id = intId(req.params.id, "user");
    if (typeof req.body.active !== "boolean") throw bad("Send active as true or false.", "active");
    if (id === req.user.id) throw new HttpError(409, "You cannot disable your own account.");
    const u = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
    if (!u) throw new HttpError(404, "User not found.");
    db.prepare("UPDATE users SET active = ? WHERE id = ?").run(req.body.active ? 1 : 0, id);
    D.audit(db, req.user, req.body.active ? "Enabled account" : "Disabled account", D.fullName(u));
    res.json({ user: D.userDto(Object.assign({}, u, { active: req.body.active ? 1 : 0 })) });
  });

  r.post("/users/:id/password", admin, (req, res) => {
    const id = intId(req.params.id, "user");
    const u = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
    if (!u) throw new HttpError(404, "User not found.");
    const pw = password(req.body.password);
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(bcrypt.hashSync(pw, 10), id);
    D.audit(db, req.user, "Reset password", D.fullName(u));
    res.json({ ok: true });
  });

  /* ---------- Provider hours and blocked dates (admin, or the provider for themselves) ---------- */
  function ownerOrAdmin(req) {
    const id = intId(req.params.id, "provider");
    const p = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'provider'").get(id);
    if (!p) throw new HttpError(404, "Provider not found.");
    if (req.user.role === "provider" && req.user.id !== id) throw new HttpError(403, "You can only change your own hours.");
    if (!["admin", "provider"].includes(req.user.role)) throw new HttpError(403, "Your role cannot do that.");
    return p;
  }
  const hoursOf = (id) => ({
    hours: db.prepare("SELECT weekday, working, start_time, end_time FROM availability WHERE provider_id = ? ORDER BY weekday").all(id).map((h) => ({ weekday: h.weekday, day: T.DAYS[h.weekday], working: !!h.working, start: h.start_time, end: h.end_time })),
    blocked: db.prepare("SELECT id, date, reason FROM blocked_dates WHERE provider_id = ? AND date >= ? ORDER BY date").all(id, T.today())
  });

  r.get("/providers/:id/availability", (req, res) => { const p = ownerOrAdmin(req); res.json(Object.assign({ provider: { id: p.id, name: D.fullName(p) } }, hoursOf(p.id))); });

  r.put("/providers/:id/availability", (req, res) => {
    const p = ownerOrAdmin(req);
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
    db.transaction(() => hours.forEach((h) => db.prepare("UPDATE availability SET working = ?, start_time = ?, end_time = ? WHERE provider_id = ? AND weekday = ?").run(h.working ? 1 : 0, h.start, h.end, p.id, h.weekday)))();
    D.audit(db, req.user, "Updated provider hours", D.fullName(p));
    res.json(hoursOf(p.id));
  });

  r.post("/providers/:id/blocked", (req, res) => {
    const p = ownerOrAdmin(req);
    if (!T.isDate(req.body.date) || req.body.date < T.today()) throw bad("Choose today or a later date.", "date");
    const reason = str(req.body.reason, "reason", { label: "Reason", max: 80 });
    if (db.prepare("SELECT 1 FROM blocked_dates WHERE provider_id = ? AND date = ?").get(p.id, req.body.date)) throw new HttpError(409, "That date is already blocked.", "date");
    db.prepare("INSERT INTO blocked_dates (provider_id, date, reason) VALUES (?,?,?)").run(p.id, req.body.date, reason);
    D.audit(db, req.user, "Blocked date", D.fullName(p) + " · " + req.body.date);
    res.status(201).json(hoursOf(p.id));
  });
  r.delete("/providers/:id/blocked/:bid", (req, res) => {
    const p = ownerOrAdmin(req);
    db.prepare("DELETE FROM blocked_dates WHERE id = ? AND provider_id = ?").run(intId(req.params.bid, "date"), p.id);
    D.audit(db, req.user, "Removed blocked date", D.fullName(p));
    res.json(hoursOf(p.id));
  });
  return r;
};
