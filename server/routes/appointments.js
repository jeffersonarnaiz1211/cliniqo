"use strict";
const express = require("express");
const T = require("../time");
const { HttpError, bad, str, intId, STUDENT_NO } = require("../util");
const D = require("../domain");
const { requireRole } = require("../auth");

module.exports = function (ctx) {
  const r = express.Router(), db = ctx.db;
  const staffUp = requireRole("staff", "admin");

  /* Book. Students book for themselves. Staff and admin book for a student by student number. */
  r.post("/appointments", (req, res) => {
    const b = req.body, actor = req.user;
    if (!["student", "staff", "admin"].includes(actor.role)) throw new HttpError(403, "Your role cannot do that.");
    const providerId = intId(b.providerId, "provider");
    let studentId = actor.id;
    if (actor.role !== "student") {
      const sn = str(b.studentNumber, "studentNumber", { label: "Student number", max: 20 });
      if (!STUDENT_NO.test(sn)) throw bad("Student numbers look like 2024-00123 or 424005074.", "studentNumber");
      const s = db.prepare("SELECT id FROM users WHERE login = ? AND role = 'student'").get(sn);
      if (!s) throw new HttpError(404, "No student with that number.", "studentNumber");
      studentId = s.id;
    }
    res.status(201).json({ appointment: D.createAppointment(db, { studentId, providerId, date: b.date, time: b.time, actor }) });
  });

  /* A student's own appointments, split into upcoming and past. */
  r.get("/appointments/mine", requireRole("student"), (req, res) => {
    const rows = db.prepare(D.APPT_SQL + " WHERE a.student_id = ?").all(req.user.id).map(D.apptDto);
    const isUp = (a) => (a.status === "Booked" || a.status === "Checked in") && a.hoursUntil >= -1;
    const upcoming = rows.filter(isUp).sort((a, b) => (a.date + a.time < b.date + b.time ? -1 : 1));
    const past = rows.filter((a) => !isUp(a)).sort((a, b) => (a.date + a.time < b.date + b.time ? 1 : -1));
    res.json({ upcoming, past });
  });

  /* Daily list for staff and admin (everyone) or a provider (own only). */
  r.get("/appointments", requireRole("staff", "admin", "provider"), (req, res) => {
    const date = req.query.date || T.today();
    if (!T.isDate(date)) throw bad("Choose a valid date.", "date");
    const where = ["a.date = ?"], args = [date];
    if (req.user.role === "provider") { where.push("a.provider_id = ?"); args.push(req.user.id); }
    else if (req.query.providerId) { where.push("a.provider_id = ?"); args.push(intId(req.query.providerId, "provider")); }
    if (req.query.status) {
      if (!D.STATUSES.includes(req.query.status)) throw bad("Unknown status.", "status");
      where.push("a.status = ?"); args.push(req.query.status);
    }
    if (req.query.q) {
      const q = "%" + String(req.query.q).slice(0, 40).toLowerCase().replace(/[%_]/g, "") + "%";
      where.push("(lower(s.first_name || ' ' || s.last_name) LIKE ? OR lower(s.login) LIKE ?)"); args.push(q, q);
    }
    const rows = db.prepare(D.APPT_SQL + " WHERE " + where.join(" AND ") + " ORDER BY a.time, p.last_name").all(...args);
    res.json({ date, appointments: rows.map(D.apptDto) });
  });

  r.post("/appointments/:id/cancel", requireRole("student", "staff", "admin"), (req, res) => {
    res.json({ appointment: D.cancelAppointment(db, { id: intId(req.params.id, "appointment"), actor: req.user, reason: typeof req.body.reason === "string" ? req.body.reason : "" }) });
  });
  r.post("/appointments/:id/reschedule", requireRole("student", "staff", "admin"), (req, res) => {
    res.json({ appointment: D.rescheduleAppointment(db, { id: intId(req.params.id, "appointment"), actor: req.user, date: req.body.date, time: req.body.time }) });
  });
  r.post("/appointments/:id/status", requireRole("provider", "staff", "admin"), (req, res) => {
    res.json({ appointment: D.setStatus(db, { id: intId(req.params.id, "appointment"), actor: req.user, status: req.body.status }) });
  });

  /* Staff and admin look a student up by number before booking for them. */
  r.get("/students/lookup", staffUp, (req, res) => {
    const sn = str(req.query.studentNumber, "studentNumber", { label: "Student number", max: 20 });
    if (!STUDENT_NO.test(sn)) throw bad("Student numbers look like 2024-00123 or 424005074.", "studentNumber");
    const s = db.prepare("SELECT * FROM users WHERE login = ? AND role = 'student'").get(sn);
    if (!s) throw new HttpError(404, "No student with that number.", "studentNumber");
    res.json({ student: { id: s.id, name: D.fullName(s), studentNumber: s.login, active: !!s.active } });
  });

  /* Notifications (students). */
  r.get("/notifications", requireRole("student"), (req, res) => {
    D.ensureReminders(db, req.user.id);
    const rows = db.prepare("SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 50").all(req.user.id);
    res.json({
      unread: rows.filter((n) => !n.is_read).length,
      notifications: rows.map((n) => ({ id: n.id, type: n.type, title: n.title, body: n.body, read: !!n.is_read, createdAt: n.created_at.replace(" ", "T") + "Z", appointmentId: n.appointment_id }))
    });
  });
  r.post("/notifications/read-all", requireRole("student"), (req, res) => {
    db.prepare("UPDATE notifications SET is_read = 1 WHERE user_id = ?").run(req.user.id);
    res.json({ ok: true });
  });
  return r;
};
