"use strict";
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS departments (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('student','staff','provider','admin')),
  login TEXT NOT NULL UNIQUE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  department_id INTEGER REFERENCES departments(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS availability (
  provider_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  working INTEGER NOT NULL DEFAULT 0,
  start_time TEXT NOT NULL DEFAULT '09:00',
  end_time TEXT NOT NULL DEFAULT '12:00',
  PRIMARY KEY (provider_id, weekday)
);
CREATE TABLE IF NOT EXISTS blocked_dates (
  id INTEGER PRIMARY KEY,
  provider_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  reason TEXT NOT NULL,
  UNIQUE (provider_id, date)
);
CREATE TABLE IF NOT EXISTS appointments (
  id INTEGER PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES users(id),
  provider_id INTEGER NOT NULL REFERENCES users(id),
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Booked' CHECK (status IN ('Booked','Checked in','Completed','No-show','Cancelled')),
  cancel_reason TEXT,
  cancelled_by INTEGER REFERENCES users(id),
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- Conflict prevention enforced by the database itself: one active booking per provider slot,
-- and one active booking per student at the same time.
CREATE UNIQUE INDEX IF NOT EXISTS ux_provider_slot ON appointments (provider_id, date, time) WHERE status <> 'Cancelled';
CREATE UNIQUE INDEX IF NOT EXISTS ux_student_slot ON appointments (student_id, date, time) WHERE status <> 'Cancelled';
CREATE INDEX IF NOT EXISTS ix_appt_date ON appointments (date);
CREATE INDEX IF NOT EXISTS ix_appt_student ON appointments (student_id);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  appointment_id INTEGER REFERENCES appointments(id),
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_notif_user ON notifications (user_id);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  user_id INTEGER,
  user_name TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT NOT NULL DEFAULT ''
);
`;

function openDb(file) {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  return db;
}
module.exports = { openDb };
