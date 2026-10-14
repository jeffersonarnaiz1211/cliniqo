"use strict";
const path = require("path");
const express = require("express");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const { HttpError } = require("./util");
const { authenticate, csrf } = require("./auth");

function createApp({ db, jwtSecret, secureCookie = false, rateLimit = true, trustProxy = false }) {
  const ctx = { db, jwtSecret, secureCookie, rateLimit };
  const app = express();
  app.disable("x-powered-by");
  if (trustProxy) app.set("trust proxy", 1);

  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"], scriptSrc: ["'self'"], connectSrc: ["'self'"], imgSrc: ["'self'", "data:"],
        styleSrc: ["'self'", "https://fonts.googleapis.com", "'unsafe-inline'"], fontSrc: ["https://fonts.gstatic.com"],
        objectSrc: ["'none'"], baseUri: ["'self'"], formAction: ["'self'"], frameAncestors: ["'none'"], manifestSrc: ["'self'"], workerSrc: ["'self'"]
      }
    },
    hsts: secureCookie
  }));
  app.use(express.json({ limit: "20kb" }));
  app.use(cookieParser());

  /* ---- API ---- */
  app.use("/api", csrf);
  app.use("/api/auth", require("./routes/auth")(ctx));
  app.use("/api", authenticate(ctx));
  app.use("/api", require("./routes/catalog")(ctx));
  app.use("/api", require("./routes/appointments")(ctx));
  app.use("/api", require("./routes/people")(ctx));
  app.use("/api", require("./routes/admin")(ctx));
  app.use("/api", (req, res) => res.status(404).json({ error: "Not found." }));

  /* ---- Front ends: student app at /app, clinic console at /admin ---- */
  const root = path.join(__dirname, "..");
  const noCache = (res) => res.set("Cache-Control", "no-cache");
  app.use("/admin", express.static(path.join(root, "admin"), { setHeaders: noCache }));
  app.use("/app", express.static(path.join(root, "mobile"), { setHeaders: noCache }));
  app.get("/", (req, res) => res.sendFile(path.join(__dirname, "landing.html")));

  /* ---- Errors: clear messages, never a stack trace ---- */
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, field: err.field });
    if (err && err.type === "entity.parse.failed") return res.status(400).json({ error: "Invalid request." });
    if (err && err.type === "entity.too.large") return res.status(413).json({ error: "Request is too large." });
    console.error("[error]", req.method, req.path, err && err.message);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  });
  return app;
}
module.exports = { createApp };
