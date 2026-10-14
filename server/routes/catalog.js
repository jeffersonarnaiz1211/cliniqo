"use strict";
const express = require("express");
const T = require("../time");
const { bad, intId } = require("../util");
const { slotInfo, freeTimes, fullName, RULES } = require("../domain");

module.exports = function (ctx) {
  const r = express.Router(), db = ctx.db;

  /* Clinic "today" and the booking rules, so every screen agrees on the date and the cutoff. */
  r.get("/meta", (req, res) => res.json({ today: T.today(), now: T.now(), rules: { cutoffHours: RULES.CUTOFF_HOURS, bookingDays: RULES.BOOKING_DAYS, maxUpcoming: RULES.MAX_UPCOMING, newBookingGraceMinutes: RULES.NEW_BOOKING_GRACE_MINUTES } }));

  r.get("/departments", async (req, res) => {
    res.json({ departments: await db.all("SELECT id, name FROM departments ORDER BY name") });
  });

  r.get("/providers", async (req, res) => {
    const dept = req.query.departmentId ? intId(req.query.departmentId, "department") : null;
    const rows = await db.all("SELECT u.*, d.name dname FROM users u LEFT JOIN departments d ON d.id = u.department_id WHERE u.role = 'provider' AND u.active = 1" + (dept ? " AND u.department_id = ?" : "") + " ORDER BY u.last_name", ...(dept ? [dept] : []));
    res.json({ providers: rows.map((u) => ({ id: u.id, name: fullName(u), departmentId: u.department_id, department: u.dname || "" })) });
  });

  /* Free slots for a day, for one provider or for every provider in a department. */
  r.get("/slots", async (req, res) => {
    const date = req.query.date;
    if (!T.isDate(date)) throw bad("Choose a valid date.", "date");
    if (date < T.today() || date > T.addDays(T.today(), RULES.BOOKING_DAYS)) return res.json({ date, slots: [], why: "Choose a date within the next " + RULES.BOOKING_DAYS + " days." });
    let provs;
    if (req.query.providerId) provs = await db.all("SELECT * FROM users WHERE id = ? AND role = 'provider' AND active = 1", intId(req.query.providerId, "provider"));
    else if (req.query.departmentId) provs = await db.all("SELECT * FROM users WHERE department_id = ? AND role = 'provider' AND active = 1 ORDER BY last_name", intId(req.query.departmentId, "department"));
    else throw bad("Choose a department or a provider.");
    const ignore = req.query.ignoreAppointmentId ? intId(req.query.ignoreAppointmentId, "appointment") : null;
    const slots = [];
    let why = "";
    if (req.query.all === "1" && req.query.providerId) { // every slot of one provider, with taken ones flagged (staff booking screen)
      for (const p of provs) {
        const info = await slotInfo(db, p.id, date, ignore);
        info.slots.filter((s) => !s.past).forEach((s) => slots.push({ providerId: p.id, providerName: fullName(p), time: s.time, taken: s.taken }));
        why = info.why;
      }
      return res.json({ date, slots, why: slots.length ? "" : (why || "No slots left on this day.") });
    }
    for (const p of provs) {
      const info = await slotInfo(db, p.id, date, ignore);
      why = info.why || why;
      (await freeTimes(db, p.id, date, ignore)).forEach((t) => slots.push({ providerId: p.id, providerName: fullName(p), time: t }));
    }
    slots.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : a.providerName.localeCompare(b.providerName)));
    res.json({ date, slots, why: slots.length ? "" : (why || "No free slots on this day.") });
  });
  return r;
};
