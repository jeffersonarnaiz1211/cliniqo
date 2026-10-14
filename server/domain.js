"use strict";
// Business rules in one place: slots, booking, cancel and reschedule, notifications, audit.
const T = require("./time");
const { HttpError } = require("./util");

const RULES = { CUTOFF_HOURS: 24, BOOKING_DAYS: 30, MAX_UPCOMING: 3, NEW_BOOKING_GRACE_MINUTES: 120 };
const STATUSES = ["Booked", "Checked in", "Completed", "No-show", "Cancelled"];

const fullName = (u) => (u.first_name + " " + u.last_name).trim();
const userDto = (u) => ({
  id: u.id, name: fullName(u), firstName: u.first_name, lastName: u.last_name, login: u.login,
  role: u.role, active: !!u.active, departmentId: u.department_id || null
});

const APPT_SQL = `SELECT a.*, s.first_name sfn, s.last_name sln, s.login slogin, p.first_name pfn, p.last_name pln,
  p.department_id pdept, d.name dname
  FROM appointments a JOIN users s ON s.id = a.student_id JOIN users p ON p.id = a.provider_id
  LEFT JOIN departments d ON d.id = p.department_id`;

/* A booking made inside the 24-hour window can still be cancelled for 2 hours after it was made
   (as long as the visit has not started). created_at is UTC text: "YYYY-MM-DD HH:MM:SS". */
const utcStamp = (ms) => new Date(ms).toISOString().slice(0, 19).replace("T", " ");
function graceMinutesLeft(row) {
  if (row.status !== "Booked" || !row.created_at) return 0;
  if (T.hoursUntil(row.date, row.time) <= 0) return 0;
  const since = (T.nowMs() - Date.parse(row.created_at.replace(" ", "T") + "Z")) / 60000;
  if (!(since >= 0) || since > RULES.NEW_BOOKING_GRACE_MINUTES) return 0;
  return Math.ceil(RULES.NEW_BOOKING_GRACE_MINUTES - since);
}

function apptDto(r) {
  const hu = T.hoursUntil(r.date, r.time);
  return {
    id: r.id, date: r.date, time: r.time, status: r.status, cancelReason: r.cancel_reason || "",
    student: { id: r.student_id, name: (r.sfn + " " + r.sln).trim(), studentNumber: r.slogin },
    provider: { id: r.provider_id, name: (r.pfn + " " + r.pln).trim(), departmentId: r.pdept, department: r.dname || "" },
    hoursUntil: Math.round(hu * 10) / 10, cutoffPassed: hu < RULES.CUTOFF_HOURS,
    graceMinutesLeft: hu < RULES.CUTOFF_HOURS ? graceMinutesLeft(r) : 0
  };
}
const getAppt = (db, id) => db.prepare(APPT_SQL + " WHERE a.id = ?").get(id);

function audit(db, actor, action, target) {
  db.prepare("INSERT INTO audit_log (user_id, user_name, action, target) VALUES (?,?,?,?)").run(actor ? actor.id : null, actor ? fullName(actor) : "System", action, target || "");
}
function notify(db, userId, appointmentId, type, title, body) {
  db.prepare("INSERT INTO notifications (user_id, appointment_id, type, title, body) VALUES (?,?,?,?,?)").run(userId, appointmentId, type, title, body);
}

/* Every 30-minute slot in a provider's hours for a date, flagged taken or past. */
function slotInfo(db, providerId, date, ignoreId) {
  const prov = db.prepare("SELECT id, active FROM users WHERE id = ? AND role = 'provider'").get(providerId);
  if (!prov || !prov.active) return { slots: [], why: "That provider is not available." };
  const av = db.prepare("SELECT working, start_time, end_time FROM availability WHERE provider_id = ? AND weekday = ?").get(providerId, T.weekday(date));
  if (!av || !av.working) return { slots: [], why: "This provider does not work on that day." };
  if (db.prepare("SELECT 1 FROM blocked_dates WHERE provider_id = ? AND date = ?").get(providerId, date)) return { slots: [], why: "This provider is not available on that date." };
  const taken = new Set(db.prepare("SELECT time FROM appointments WHERE provider_id = ? AND date = ? AND status <> 'Cancelled' AND id <> ?").all(providerId, date, ignoreId || -1).map((r) => r.time));
  const n = T.now(), out = [];
  for (let m = T.toMin(av.start_time); m + 30 <= T.toMin(av.end_time); m += 30) {
    const t = T.hhmm(m);
    out.push({ time: t, taken: taken.has(t), past: date < n.date || (date === n.date && t <= n.time) });
  }
  return { slots: out, why: "" };
}
const freeTimes = (db, providerId, date, ignoreId) => slotInfo(db, providerId, date, ignoreId).slots.filter((s) => !s.taken && !s.past).map((s) => s.time);

function checkWindow(date, time) {
  if (!T.isDate(date)) throw new HttpError(400, "Choose a valid date.", "date");
  if (!T.isTime(time)) throw new HttpError(400, "Choose a valid time.", "time");
  const today = T.today();
  if (date < today) throw new HttpError(400, "Choose today or a later date.", "date");
  if (date > T.addDays(today, RULES.BOOKING_DAYS)) throw new HttpError(400, "You can book up to " + RULES.BOOKING_DAYS + " days ahead.", "date");
}
const isConflict = (e) => e && typeof e.code === "string" && e.code.startsWith("SQLITE_CONSTRAINT");

function createAppointment(db, { studentId, providerId, date, time, actor }) {
  checkWindow(date, time);
  const stu = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'student'").get(studentId);
  if (!stu) throw new HttpError(404, "Student not found.");
  if (!stu.active) throw new HttpError(409, "This student account is disabled.");
  if (!freeTimes(db, providerId, date).includes(time)) throw new HttpError(409, "That time is not available. Pick another slot.", "time");
  if (db.prepare("SELECT 1 FROM appointments WHERE student_id = ? AND date = ? AND time = ? AND status <> 'Cancelled'").get(studentId, date, time)) throw new HttpError(409, "This student already has an appointment at that time.", "time");
  const upcoming = db.prepare("SELECT date, time FROM appointments WHERE student_id = ? AND status IN ('Booked','Checked in')").all(studentId).filter((a) => T.hoursUntil(a.date, a.time) >= 0).length;
  if (upcoming >= RULES.MAX_UPCOMING) throw new HttpError(409, "A student can have at most " + RULES.MAX_UPCOMING + " upcoming appointments. Cancel one first.");
  let id;
  try {
    id = db.prepare("INSERT INTO appointments (student_id, provider_id, date, time, created_by, created_at) VALUES (?,?,?,?,?,?)").run(studentId, providerId, date, time, actor.id, utcStamp(T.nowMs())).lastInsertRowid;
  } catch (e) {
    if (isConflict(e)) throw new HttpError(409, "That time was just taken. Pick another slot.", "time");
    throw e;
  }
  const a = apptDto(getAppt(db, id));
  notify(db, studentId, id, "booked", "Booking confirmed", a.date + " at " + a.time + " with " + a.provider.name);
  if (actor.role !== "student") audit(db, actor, "Created booking", a.student.name + " · " + a.date + " " + a.time);
  return a;
}

function assertCanCancel(actor, row, { reschedule = false } = {}) {
  const open = row.status === "Booked" || (actor.role === "admin" && row.status === "Checked in");
  if (!open) throw new HttpError(409, "Only a booked appointment can be changed.");
  if (actor.role !== "admin" && T.hoursUntil(row.date, row.time) < RULES.CUTOFF_HOURS) {
    // New-booking grace: cancelling (not rescheduling) is allowed for 2 hours after the booking was made.
    if (!reschedule && graceMinutesLeft(row) > 0) return;
    throw new HttpError(403, actor.role === "student"
      ? "Cancellations and changes close 24 hours before your visit. Please contact the clinic."
      : "This is inside the 24-hour cutoff. Only an admin can change it.");
  }
}

function cancelAppointment(db, { id, actor, reason }) {
  const row = getAppt(db, id);
  if (!row) throw new HttpError(404, "Appointment not found.");
  if (actor.role === "student" && row.student_id !== actor.id) throw new HttpError(404, "Appointment not found.");
  assertCanCancel(actor, row);
  const why = (reason || "").trim();
  if (actor.role !== "student" && why.length < 3) throw new HttpError(400, "Enter a reason for the cancellation.", "reason");
  if (why.length > 120) throw new HttpError(400, "Reason is too long (maximum 120 characters).", "reason");
  const overridden = actor.role === "admin" && T.hoursUntil(row.date, row.time) < RULES.CUTOFF_HOURS && graceMinutesLeft(row) === 0;
  db.prepare("UPDATE appointments SET status = 'Cancelled', cancel_reason = ?, cancelled_by = ? WHERE id = ?").run(why || "Cancelled by student", actor.id, id);
  notify(db, row.student_id, id, "cancelled", "Appointment cancelled", row.date + " at " + row.time + " with " + (row.pfn + " " + row.pln).trim());
  if (actor.role !== "student") audit(db, actor, overridden ? "Cancelled (cutoff override)" : "Cancelled appointment", (row.sfn + " " + row.sln).trim() + " · " + row.date + " " + row.time + " · " + why);
  return apptDto(getAppt(db, id));
}

function rescheduleAppointment(db, { id, actor, date, time }) {
  const row = getAppt(db, id);
  if (!row) throw new HttpError(404, "Appointment not found.");
  if (actor.role === "student" && row.student_id !== actor.id) throw new HttpError(404, "Appointment not found.");
  assertCanCancel(actor, row, { reschedule: true });
  checkWindow(date, time);
  if (!freeTimes(db, row.provider_id, date, id).includes(time)) throw new HttpError(409, "That time is not available. Pick another slot.", "time");
  if (db.prepare("SELECT 1 FROM appointments WHERE student_id = ? AND date = ? AND time = ? AND status <> 'Cancelled' AND id <> ?").get(row.student_id, date, time, id)) throw new HttpError(409, "This student already has an appointment at that time.", "time");
  try {
    db.prepare("UPDATE appointments SET date = ?, time = ? WHERE id = ?").run(date, time, id);
  } catch (e) {
    if (isConflict(e)) throw new HttpError(409, "That time was just taken. Pick another slot.", "time");
    throw e;
  }
  notify(db, row.student_id, id, "rescheduled", "Appointment rescheduled", "Now " + date + " at " + time + " with " + (row.pfn + " " + row.pln).trim());
  if (actor.role !== "student") audit(db, actor, "Rescheduled appointment", (row.sfn + " " + row.sln).trim() + " · " + date + " " + time);
  return apptDto(getAppt(db, id));
}

const STATUS_RULES = {
  "Checked in": { from: ["Booked"], roles: ["staff", "admin"] },
  "Completed": { from: ["Booked", "Checked in"], roles: ["provider", "staff", "admin"] },
  "No-show": { from: ["Booked", "Checked in"], roles: ["provider", "staff", "admin"] }
};
function setStatus(db, { id, actor, status }) {
  const rule = STATUS_RULES[status];
  if (!rule) throw new HttpError(400, "Status must be Checked in, Completed or No-show.", "status");
  if (!rule.roles.includes(actor.role)) throw new HttpError(403, "Your role cannot do that.");
  const row = getAppt(db, id);
  if (!row || (actor.role === "provider" && row.provider_id !== actor.id)) throw new HttpError(404, "Appointment not found.");
  if (!rule.from.includes(row.status)) throw new HttpError(409, "This appointment is already " + row.status.toLowerCase() + ".");
  db.prepare("UPDATE appointments SET status = ? WHERE id = ?").run(status, id);
  audit(db, actor, status === "Checked in" ? "Checked in student" : status === "Completed" ? "Marked completed" : "Marked no-show", (row.sfn + " " + row.sln).trim() + " · " + row.date + " " + row.time);
  return apptDto(getAppt(db, id));
}

/* In-app reminder: created the first time a student's list is read within 24 hours of a visit. */
function ensureReminders(db, studentId) {
  const rows = db.prepare(APPT_SQL + " WHERE a.student_id = ? AND a.status = 'Booked' AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.appointment_id = a.id AND n.type = 'reminder')").all(studentId);
  rows.forEach((r) => {
    const hu = T.hoursUntil(r.date, r.time);
    if (hu >= 0 && hu <= RULES.CUTOFF_HOURS) notify(db, studentId, r.id, "reminder", "Appointment reminder", (r.pfn + " " + r.pln).trim() + " on " + r.date + " at " + r.time);
  });
}

module.exports = { RULES, STATUSES, fullName, userDto, APPT_SQL, apptDto, getAppt, audit, notify, slotInfo, freeTimes, createAppointment, cancelAppointment, rescheduleAppointment, setStatus, ensureReminders };
