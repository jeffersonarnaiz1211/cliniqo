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

function dbTarget() {
  if (env.DATABASE_URL) return env.DATABASE_URL.trim();
  if (prod) throw new Error("DATABASE_URL must be set when NODE_ENV=production (use your Supabase connection string).");
  return "pglite:" + path.join(__dirname, "..", "data", "pgdata");
}

module.exports = {
  prod,
  port: Number(env.PORT) || 3000,
  jwtSecret: secret,
  // Supabase (or any PostgreSQL) connection string. Required in production.
  // Without it, local development uses a PostgreSQL database stored in the data/ folder.
  dbTarget: dbTarget(),
  seedDemo: env.SEED_DEMO === "true",
  clinicTz: env.CLINIC_TZ || "Asia/Manila",
  secureCookie: env.COOKIE_SECURE ? env.COOKIE_SECURE === "true" : prod,
  trustProxy: env.TRUST_PROXY === "true" || env.TRUST_PROXY === "1"
};
