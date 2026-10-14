"use strict";
const express = require("express");
const T = require("../time");
const { bad } = require("../util");
const D = require("../domain");
const { requireRole } = require("../auth");

module.exports = function (ctx) {
  const r = express.Router(), db = ctx.db;
  r.use(requireRole("admin"));

  r.get("/dashboard", (req, res) => {
    const today = T.today(), now = T.now();
    const list = db.prepare(D.APPT_SQL + " WHERE a.date = ? ORDER BY a.time").all(today).map(D.apptDto);
    const count = (s) => list.filter((a) => a.status === s).length;
    const providers = db.prepare("SELECT * FROM users WHERE role = 'provider' AND active = 1").all();
    const openSlots = providers.reduce((n, p) => n + D.freeTimes(db, p.id, today).length, 0);
    const overdue = list.filter((a) => a.status === "Booked" && a.time < now.time).length;
    const noHours = providers.filter((p) => !db.prepare("SELECT 1 FROM availability WHERE provider_id = ? AND working = 1").get(p.id)).map(D.fullName);
    res.json({
      date: today,
      total: list.filter((a) => a.status !== "Cancelled").length, checkedIn: count("Checked in"), cancelled: count("Cancelled"), openSlots,
      next: list.filter((a) => a.status === "Booked" || a.status === "Checked in").slice(0, 5),
      attention: { overdue, providersWithoutHours: noHours, disabledAccounts: db.prepare("SELECT COUNT(*) c FROM users WHERE active = 0").get().c }
    });
  });

  function range(req) {
    const days = Number(req.query.days || 7);
    if (![7, 30].includes(days)) throw bad("Days must be 7 or 30.", "days");
    const to = T.today();
    return { days, from: T.addDays(to, -(days - 1)), to };
  }

  r.get("/reports", (req, res) => {
    const { days, from, to } = range(req);
    const rows = db.prepare(D.APPT_SQL + " WHERE a.date BETWEEN ? AND ?").all(from, to).map(D.apptDto);
    const c = (s) => rows.filter((a) => a.status === s).length;
    const total = rows.length, done = c("Completed"), ns = c("No-show"), cx = c("Cancelled");
    const perDay = [];
    for (let i = days - 1; i >= 0; i--) { const d = T.addDays(to, -i); perDay.push({ date: d, count: rows.filter((a) => a.date === d && a.status !== "Cancelled").length }); }
    const tally = (keyFn) => { const o = {}; rows.filter((a) => a.status !== "Cancelled").forEach((a) => { const k = keyFn(a); o[k] = (o[k] || 0) + 1; }); return Object.keys(o).map((k) => ({ name: k, count: o[k] })).sort((a, b) => b.count - a.count); };
    res.json({
      days, from, to, total, completed: done, noShow: ns, cancelled: cx,
      noShowRate: done + ns ? Math.round(ns * 100 / (done + ns)) : 0,
      cancelledRate: total ? Math.round(cx * 100 / total) : 0,
      perDay, byDepartment: tally((a) => a.provider.department), byProvider: tally((a) => a.provider.name)
    });
  });

  r.get("/reports.csv", (req, res) => {
    const { from, to } = range(req);
    const rows = db.prepare(D.APPT_SQL + " WHERE a.date BETWEEN ? AND ? ORDER BY a.date, a.time").all(from, to).map(D.apptDto);
    // A leading = + - @ can make spreadsheets run text as a formula, so those cells get a leading apostrophe.
    const cell = (v) => { v = String(v == null ? "" : v); if (/^[=+\-@]/.test(v)) v = "'" + v; return '"' + v.replace(/"/g, '""') + '"'; };
    const lines = [["Date", "Time", "Student", "Student number", "Provider", "Department", "Status", "Reason"].join(",")]
      .concat(rows.map((a) => [a.date, a.time, a.student.name, a.student.studentNumber, a.provider.name, a.provider.department, a.status, a.cancelReason].map(cell).join(",")));
    D.audit(db, req.user, "Exported CSV", from + " to " + to);
    res.set({ "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="cliniqo-appointments-' + from + "-to-" + to + '.csv"' }).send(lines.join("\r\n"));
  });

  r.get("/audit", (req, res) => {
    const rows = db.prepare("SELECT * FROM audit_log ORDER BY id DESC LIMIT 60").all();
    res.json({ entries: rows.map((l) => ({ id: l.id, at: l.at.replace(" ", "T") + "Z", by: l.user_name, action: l.action, target: l.target })) });
  });
  return r;
};
