"use strict";

const path = require("path");
const fs = require("fs");
const express = require("express");
const session = require("express-session");
const FileStore = require("session-file-store")(session);

const config = require("./lib/config");
const db = require("./lib/db");
const { seedIfEmpty } = require("./lib/seed");
const { requirePage, requireAdmin, canView } = require("./lib/auth-middleware");
const { DATA_DIR, PUBLIC_DIR, CONTENT_DIR } = require("./lib/paths");

const authRoutes = require("./routes/auth");
const tripRoutes = require("./routes/trips");
const userRoutes = require("./routes/users");
const adminRoutes = require("./routes/admin");

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

// Persist sessions to disk so logins survive the server being turned off/on.
const SESSIONS_DIR = path.join(DATA_DIR, "sessions");
if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });

app.use(
  session({
    store: new FileStore({ path: SESSIONS_DIR, retries: 1, logFn: () => {} }),
    secret: config.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: { httpOnly: true, sameSite: "lax", maxAge: config.SESSION_MAX_AGE },
  })
);

// Seed the starter trip(s) on first run.
seedIfEmpty();

// --- API -------------------------------------------------------------------
app.use("/api/auth", authRoutes);
app.use("/api/trips", tripRoutes);
app.use("/api/users", userRoutes);
app.use("/api/admin", adminRoutes);
app.get("/api/health", (req, res) => res.json({ ok: true, uptime: process.uptime() }));

// --- Protected pages -------------------------------------------------------

// The admin console is only reachable by admins (bounce others to login/home).
app.get(["/admin", "/admin.html"], requirePage, (req, res) => {
  if (!req.user.isAdmin) return res.redirect("/");
  res.sendFile(path.join(PUBLIC_DIR, "admin.html"));
});

const TRIPS_CONTENT_DIR = path.join(CONTENT_DIR, "trips");

// A trip's rich page, served behind login + access check at /trip/<slug>.
app.get("/trip/:slug", requirePage, (req, res) => {
  const trip = db.findTripBySlug(req.params.slug) || db.findTripById(req.params.slug);
  if (!trip || !canView(trip, req.user)) {
    return res.status(404).sendFile(path.join(PUBLIC_DIR, "404.html"));
  }
  if (!trip.pageFile) {
    return res.status(404).sendFile(path.join(PUBLIC_DIR, "404.html"));
  }
  // Guard against path traversal — only ever serve a bare filename from the
  // trips content folder.
  const safe = path.basename(trip.pageFile);
  const file = path.join(TRIPS_CONTENT_DIR, safe);
  if (!file.startsWith(TRIPS_CONTENT_DIR) || !fs.existsSync(file)) {
    return res.status(404).sendFile(path.join(PUBLIC_DIR, "404.html"));
  }
  res.sendFile(file);
});

// --- Static frontend (login, board, css, js) -------------------------------
app.use(express.static(PUBLIC_DIR));

// Fallback: send the board shell for any other non-API route.
app.get("*", (req, res) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({ error: "Not found." });
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

// --- Lifecycle: PID file + graceful shutdown (the on/off buttons) ----------
const PID_FILE = path.join(DATA_DIR, "server.pid");
try {
  fs.writeFileSync(PID_FILE, String(process.pid), "utf8");
} catch {
  /* non-fatal */
}

const server = app.listen(config.PORT, config.HOST, () => {
  console.log("");
  console.log("  🧳  Trip Planner is running!");
  console.log("  ----------------------------------------");
  console.log(`  On this computer:  http://localhost:${config.PORT}`);
  for (const ip of localAddresses()) {
    console.log(`  On your network:   http://${ip}:${config.PORT}`);
  }
  console.log("  ----------------------------------------");
  if (db.userCount() === 0) {
    console.log("  First run: open it and create your account — you become the admin.");
  }
  console.log("  Press Ctrl+C here (or run Stop Trip Planner.bat) to turn it off.");
  console.log("");
});

function shutdown() {
  console.log("\n  Shutting down Trip Planner...");
  try {
    fs.unlinkSync(PID_FILE);
  } catch {
    /* already gone */
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

function localAddresses() {
  const os = require("os");
  const out = [];
  for (const nets of Object.values(os.networkInterfaces())) {
    for (const net of nets || []) {
      if (net.family === "IPv4" && !net.internal) out.push(net.address);
    }
  }
  return out;
}
