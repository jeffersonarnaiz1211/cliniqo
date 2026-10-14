"use strict";
const jwt = require("jsonwebtoken");
const { HttpError } = require("./util");

const COOKIE = "cliniqo_token";
const SESSION_HOURS = 8;

function setSession(res, ctx, user) {
  const token = jwt.sign({ sub: user.id }, ctx.jwtSecret, { expiresIn: SESSION_HOURS + "h" });
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: "lax", secure: ctx.secureCookie, maxAge: SESSION_HOURS * 3600 * 1000, path: "/" });
}
const clearSession = (res, ctx) => res.clearCookie(COOKIE, { httpOnly: true, sameSite: "lax", secure: ctx.secureCookie, path: "/" });

/* The role is always read from the database, never from the token or the browser. */
function authenticate(ctx) {
  return async (req, res, next) => {
    const token = req.cookies && req.cookies[COOKIE];
    if (!token) throw new HttpError(401, "Please sign in.");
    let payload;
    try { payload = jwt.verify(token, ctx.jwtSecret); } catch (e) { throw new HttpError(401, "Your session has ended. Please sign in again."); }
    const user = await ctx.db.get("SELECT * FROM users WHERE id = ?", payload.sub);
    if (!user || !user.active) throw new HttpError(401, "Your session has ended. Please sign in again.");
    req.user = user;
    next();
  };
}
const requireRole = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) throw new HttpError(403, "Your role cannot do that.");
  next();
};
/* State-changing requests must carry a custom header that other websites cannot add (CSRF protection). */
function csrf(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  if (req.get("x-requested-with") !== "cliniqo") throw new HttpError(403, "Request blocked.");
  next();
}
module.exports = { setSession, clearSession, authenticate, requireRole, csrf };
