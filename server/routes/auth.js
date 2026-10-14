"use strict";
const express = require("express");
const bcrypt = require("bcryptjs");
const rateLimit = require("express-rate-limit");
const { HttpError, bad, str, personName, password, studentNumber } = require("../util");
const { userDto, audit } = require("../domain");
const { setSession, clearSession, authenticate } = require("../auth");

const DUMMY_HASH = bcrypt.hashSync("not-a-real-password-1", 10); // keeps timing similar when the account does not exist
const MAX_FAILS = 5, LOCK_MS = 60 * 1000;

module.exports = function (ctx) {
  const r = express.Router();
  const fails = new Map(); // login -> { n, until }
  if (ctx.rateLimit) r.use(["/login", "/register"], rateLimit({ windowMs: 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false, message: { error: "Too many requests. Please wait a minute and try again." } }));

  r.post("/login", (req, res) => {
    const login = str(req.body.login, "login", { label: "Student number or email", max: 80 }).toLowerCase();
    const pw = typeof req.body.password === "string" ? req.body.password : "";
    if (!pw) throw bad("Password is required.", "password");
    const f = fails.get(login);
    if (f && f.until > Date.now()) throw new HttpError(429, "Too many failed attempts. Try again in " + Math.ceil((f.until - Date.now()) / 1000) + " seconds.");
    const user = ctx.db.prepare("SELECT * FROM users WHERE lower(login) = ?").get(login);
    const ok = bcrypt.compareSync(pw, user ? user.password_hash : DUMMY_HASH);
    if (!user || !ok) {
      const n = (f ? f.n : 0) + 1;
      fails.set(login, n >= MAX_FAILS ? { n: 0, until: Date.now() + LOCK_MS } : { n, until: 0 });
      throw new HttpError(401, n >= MAX_FAILS ? "Too many failed attempts. Try again in 60 seconds." : "Incorrect student number, email or password.");
    }
    if (!user.active) throw new HttpError(403, "This account is disabled. Contact the clinic administrator.");
    fails.delete(login);
    setSession(res, ctx, user);
    if (user.role !== "student") audit(ctx.db, user, "Signed in", "");
    res.json({ user: userDto(user) });
  });

  r.post("/register", (req, res) => {
    const b = req.body;
    const firstName = personName(b.firstName, "firstName", "First name");
    const lastName = personName(b.lastName, "lastName", "Last name");
    const sn = studentNumber(b.studentNumber);
    const pw = password(b.password);
    if (b.confirmPassword !== pw) throw bad("Passwords do not match.", "confirmPassword");
    if (ctx.db.prepare("SELECT 1 FROM users WHERE lower(login) = ?").get(sn.toLowerCase())) throw new HttpError(409, "An account with that student number already exists.", "studentNumber");
    const id = ctx.db.prepare("INSERT INTO users (role, login, first_name, last_name, password_hash) VALUES ('student',?,?,?,?)").run(sn, firstName, lastName, bcrypt.hashSync(pw, 10)).lastInsertRowid;
    const user = ctx.db.prepare("SELECT * FROM users WHERE id = ?").get(id);
    setSession(res, ctx, user);
    res.status(201).json({ user: userDto(user) });
  });

  r.post("/logout", (req, res) => { clearSession(res, ctx); res.json({ ok: true }); });
  r.get("/me", authenticate(ctx), (req, res) => res.json({ user: userDto(req.user) }));
  return r;
};
