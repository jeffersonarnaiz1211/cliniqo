"use strict";
// All appointment dates and times are clinic-local text ("2026-10-12", "09:30").
// This module is the only place that knows the clinic time zone and the current time.
const cfg = { tz: "Asia/Manila", now: () => new Date() };
function configure(o) { Object.assign(cfg, o); }

function parts(d) {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: cfg.tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const p = {};
  f.formatToParts(d).forEach((x) => { p[x.type] = x.value; });
  return { date: p.year + "-" + p.month + "-" + p.day, time: p.hour + ":" + p.minute };
}
const now = () => parts(cfg.now());
const nowMs = () => cfg.now().getTime();
const today = () => now().date;
function ms(date, time) {
  const [y, m, d] = date.split("-").map(Number); const [h, mi] = (time || "00:00").split(":").map(Number);
  return Date.UTC(y, m - 1, d, h, mi);
}
const hoursUntil = (date, time) => { const n = now(); return (ms(date, time) - ms(n.date, n.time)) / 3600000; };
function isDate(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number); const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
const isTime = (s) => typeof s === "string" && /^([01]\d|2[0-3]):(00|30)$/.test(s);
function addDays(s, n) { const [y, m, d] = s.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); }
function weekday(s) { const [y, m, d] = s.split("-").map(Number); return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; } // Monday = 0
const toMin = (t) => { const p = t.split(":"); return +p[0] * 60 + +p[1]; };
const hhmm = (m) => String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
module.exports = { configure, now, nowMs, today, hoursUntil, isDate, isTime, addDays, weekday, toMin, hhmm, DAYS };
