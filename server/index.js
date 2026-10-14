"use strict";
const cfg = require("./config");
const T = require("./time");
const { openDb } = require("./db");
const { createApp } = require("./app");
const { seed } = require("./seed");

T.configure({ tz: cfg.clinicTz });
const db = openDb(cfg.dbPath);
if (!db.prepare("SELECT 1 FROM users LIMIT 1").get()) {
  if (cfg.prod) console.warn("[seed] The database is empty. Run `npm run seed` once, then change the demo passwords.");
  else { seed(db); console.log("[seed] Empty database: created demo accounts and sample data (see README)."); }
}
createApp({ db, jwtSecret: cfg.jwtSecret, secureCookie: cfg.secureCookie, trustProxy: cfg.trustProxy }).listen(cfg.port, () => {
  console.log("Cliniqo running on http://localhost:" + cfg.port + "  (student app: /app/   clinic console: /admin/)");
});
