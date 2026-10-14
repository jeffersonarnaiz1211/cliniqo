"use strict";
const cfg = require("./config");
const T = require("./time");
const { openDb } = require("./db");
const { createApp } = require("./app");
const { seed } = require("./seed");

async function main() {
  T.configure({ tz: cfg.clinicTz });
  const db = await openDb(cfg.dbTarget);
  if (!(await db.get("SELECT 1 FROM users LIMIT 1"))) {
    if (cfg.prod && !cfg.seedDemo) console.warn("[seed] The database is empty. Run `npm run seed` once (or set SEED_DEMO=true for the first start), then change the demo passwords.");
    else { await seed(db); console.log("[seed] Empty database: created demo accounts and sample data (see README)."); }
  }
  createApp({ db, jwtSecret: cfg.jwtSecret, secureCookie: cfg.secureCookie, trustProxy: cfg.trustProxy }).listen(cfg.port, () => {
    console.log("Cliniqo running on http://localhost:" + cfg.port + "  (student app: /app/   clinic console: /admin/)");
  });
}
main().catch((e) => { console.error("Startup failed:", e.message); process.exit(1); });
