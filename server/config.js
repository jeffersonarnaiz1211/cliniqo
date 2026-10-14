"use strict";
// Reads settings from environment variables (see .env.example). Never hard-code secrets here.
const path = require("path");
const crypto = require("crypto");
require("dotenv").config({ path: path.join(__dirname, "..", ".env"), quiet: true });

const env = process.env;
const prod = env.NODE_ENV === "production";
let secret = env.JWT_SECRET;
if (!secret) {
  if (prod) throw new Error("JWT_SECRET must be set when NODE_ENV=production.");
  secret = crypto.randomBytes(32).toString("hex");
  console.warn("[config] JWT_SECRET is not set. Using a temporary secret, so everyone is signed out when the server restarts.");
}

module.exports = {
  prod,
  port: Number(env.PORT) || 3000,
  jwtSecret: secret,
  dbPath: env.DB_PATH || path.join(__dirname, "..", "data", "cliniqo.db"),
  clinicTz: env.CLINIC_TZ || "Asia/Manila",
  secureCookie: env.COOKIE_SECURE ? env.COOKIE_SECURE === "true" : prod,
  trustProxy: env.TRUST_PROXY === "1"
};
