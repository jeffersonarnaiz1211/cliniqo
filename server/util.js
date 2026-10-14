"use strict";
// Small validation helpers. Every route validates input on the server, whatever the browser already checked.
class HttpError extends Error {
  constructor(status, message, field) { super(message); this.status = status; this.field = field; }
}
const bad = (msg, field) => new HttpError(400, msg, field);

function str(v, field, { label = field, min = 1, max = 100 } = {}) {
  if (typeof v !== "string") throw bad(label + " is required.", field);
  const s = v.trim();
  if (s.length < min) throw bad(label + (min <= 1 ? " is required." : " must be at least " + min + " characters."), field);
  if (s.length > max) throw bad(label + " is too long (maximum " + max + " characters).", field);
  return s;
}
function personName(v, field, label) {
  const s = str(v, field, { label, max: 40 });
  if (!/^[\p{L}][\p{L} .'\-]*$/u.test(s)) throw bad(label + " can only contain letters, spaces, dots, apostrophes and hyphens.", field);
  return s;
}
function password(v, field = "password") {
  if (typeof v !== "string" || v.length === 0) throw bad("Password is required.", field);
  if (v.length < 8) throw bad("Password must be at least 8 characters.", field);
  if (v.length > 72) throw bad("Password is too long (maximum 72 characters).", field);
  if (!/[A-Za-z]/.test(v) || !/\d/.test(v)) throw bad("Password must include at least one letter and one number.", field);
  return v;
}
const STUDENT_NO = /^(\d{4}-\d{5}|\d{9})$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function studentNumber(v, field = "studentNumber") {
  const s = str(v, field, { label: "Student number", max: 20 });
  if (!STUDENT_NO.test(s)) throw bad("Student numbers look like 2024-00123 or 424005074.", field);
  return s;
}
function email(v, field = "login") {
  const s = str(v, field, { label: "Work email", max: 80 }).toLowerCase();
  if (!EMAIL.test(s)) throw bad("Enter a valid email, like name@ntc.edu.ph.", field);
  return s;
}
function intId(v, label = "id") {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw bad("Invalid " + label + ".");
  return n;
}
module.exports = { HttpError, bad, str, personName, password, studentNumber, email, intId, STUDENT_NO, EMAIL };
