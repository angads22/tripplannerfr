"use strict";

const path = require("path");
const fs = require("fs");
const express = require("express");
const session = require("express-session");
const FileStore = require("session-file-store")(session);

const config = require("./lib/config");
const db = require("./lib/db");
const { seedIfEmpty, tidyExistingTrips, ensurePlannedContent } = require("./lib/seed");
const { requirePage, requireAdmin, canView } = require("./lib/auth-middleware");
const { DATA_DIR, PUBLIC_DIR, CONTENT_DIR } = require("./lib/paths");
const { securityHeaders } = require("./lib/security-headers");
const { rateLimit } = require("./lib/rate-limit");

const authRoutes = require("./routes/auth");
const tripRoutes = require("./routes/trips");
const userRoutes = require("./routes/users");
const adminRoutes = require("./routes/admin");
const friendRoutes = require("./routes/friends");

// Last line of defense: never let a stray async error take the whole site
// down. Node 18 exits the process on an unhandled rejection, and Express 4
// doesn't catch errors thrown inside async route handlers — so without this a
// single transient file lock (e.g. while deleting an account) crashed the
// server for everyone. Log it and keep serving instead.
process.on("unhandledRejection", (reason) => {
  console.error("  ✖ Unhandled promise rejection (server kept running):", reason && reason.stack ? reason.stack : reason);
});
process.on("uncaughtException", (err) => {
  console.error("  ✖ Uncaught exception (server kept running):", err && err.stack ? err.stack : err);
});

const app = express();
app.disable("x-powered-by");
// Behind the Cloudflare tunnel the app is proxied; trust it so sessions and
// protocol detection work correctly.
app.set("trust proxy", 1);

// OWASP security headers on every response (CSP, anti-clickjacking, nosniff,
// referrer policy, HSTS over HTTPS). See lib/security-headers.js.
app.use(securityHeaders);

// Parse JSON bodies up to a bounded size. The shared drive sends files as
// base64 in the body, so this is the upload ceiling — configurable, and far
// safer than an unbounded/50 MB limit (a cheap memory-DoS vector). Oversized
// bodies get a clean 413 from the error handler below instead of crashing.
app.use(express.json({ limit: `${config.MAX_BODY_MB}mb` }));

// Never let the browser (or Cloudflare) cache the API or the app pages. This
// avoids stale UI after an update — the #1 cause of "I clicked and nothing
// happened" right after a new build.
app.use((req, res, next) => {
  if (req.path.startsWith("/api/") || /\.(html)$/.test(req.path) || req.path === "/" || req.path.startsWith("/trip/") || req.path === "/admin") {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  }
  next();
});

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
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      // "auto" marks the cookie Secure only when the request is HTTPS (behind
      // the Cloudflare tunnel, via trust proxy + X-Forwarded-Proto). On plain
      // localhost HTTP it stays unset so dev login keeps working.
      secure: "auto",
      maxAge: config.SESSION_MAX_AGE,
    },
  })
);

// Terminal logging: print each meaningful request to the console so whoever is
// running the app (the host) can watch what's happening live. Skips static
// assets and the update health-poll to stay readable.
app.use((req, res, next) => {
  const start = Date.now();
  // Capture the full path now — nested routers rewrite req.url during handling.
  const fullPath = req.path;
  const url = (req.originalUrl || req.url || "").split("?")[0];
  res.on("finish", () => {
    if (fullPath.startsWith("/css/") || fullPath.startsWith("/js/") || fullPath === "/favicon.ico" || fullPath === "/api/health") return;
    const ms = Date.now() - start;
    let who = "";
    try {
      if (req.session && req.session.userId) {
        const u = db.findUserById(req.session.userId);
        if (u) who = "  @" + u.username;
      }
    } catch { /* ignore */ }
    const time = new Date().toTimeString().slice(0, 8);
    const code = res.statusCode;
    const mark = code >= 500 ? "✖" : code >= 400 ? "!" : "·";
    console.log(`  ${time}  ${mark} ${req.method.padEnd(6)} ${url}  →  ${code}  ${ms}ms${who}`);
  });
  next();
});

// Seed the starter trip(s) on first run, then tidy any existing data so old
// shared/ownerless trips become private under the new invite-link model.
seedIfEmpty();
tidyExistingTrips();
// Idempotently ensure the planned, shareable trips + budgets exist (Japan 2027,
// Toronto budget) even on installs created before they were added.
ensurePlannedContent();

// --- Rate limiting (OWASP API4: Unrestricted Resource Consumption) ---------
//
// Two layers, keyed by IP + (when logged in) user id:
//  1. A broad limiter on the whole API so no single client can flood writes or
//     hammer polling endpoints.
//  2. A strict limiter on the auth endpoints (login/register) to blunt
//     credential-stuffing / brute-force, plus account-creation abuse.
// Health checks are exempt so the self-updater's poll never trips it. All trip
// over the limit gets a graceful JSON 429 with a Retry-After.

// Strict: 20 auth attempts per 15 min per IP. Generous for humans, painful for
// a brute-forcer. (Keyed by IP only — a logged-out attacker has no user id.)
const authLimiter = rateLimit({
  name: "auth",
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: "Too many sign-in attempts — wait a few minutes and try again.",
});

// Broad: 300 API requests/min per IP+user. The frontend polls every 5s and can
// fan out a handful of calls per render, so this leaves comfortable headroom
// for normal use while stopping abuse.
const apiLimiter = rateLimit({
  name: "api",
  windowMs: 60 * 1000,
  max: 300,
  byUser: true,
});

// --- API -------------------------------------------------------------------
// Health first and un-limited so the updater's poll is never throttled.
app.get("/api/health", (req, res) => res.json({ ok: true, uptime: process.uptime() }));
app.use("/api/", apiLimiter);
// The strict auth limiter applies only to the credential-checking endpoints.
app.use("/api/auth/login", authLimiter);
app.use("/api/auth/register", authLimiter);
app.use("/api/auth", authRoutes);
app.use("/api/trips", tripRoutes);
app.use("/api/users", userRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/friends", friendRoutes);

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
  // Members/admins/public trips can always view; otherwise the visitor needs
  // the trip's join code (carried in the shared link as ?j=...) to see it and
  // join. Private trips are NOT visible to other signed-in users.
  const code = req.query.code || req.query.j;
  const hasCode = !!trip && !!code && !!trip.joinCode && String(code).trim().toLowerCase() === String(trip.joinCode).trim().toLowerCase();
  if (!trip || (!canView(trip, req.user) && !hasCode)) {
    return res.status(404).sendFile(path.join(PUBLIC_DIR, "404.html"));
  }
  // Trips without their own rich HTML page get the generic Pitstop detail
  // page, which renders crew + info from the trip's data via the API.
  if (!trip.pageFile) {
    return res.sendFile(path.join(PUBLIC_DIR, "trip.html"));
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

// --- Static frontend (login, board, css, js) + trip file uploads -----------
app.use(
  express.static(PUBLIC_DIR, {
    setHeaders: (res, p) => {
      // Don't cache app scripts so updates take effect immediately.
      if (/\.(js|html)$/.test(p)) res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    },
  })
);

// Serve trip file uploads.
app.get("/trip-files/:tripId/:filename", (req, res) => {
  const file = path.join(DATA_DIR, `trip-${req.params.tripId}`, "files", path.basename(req.params.filename));
  if (!file.startsWith(path.join(DATA_DIR, `trip-${req.params.tripId}`, "files"))) {
    return res.status(403).send("Forbidden");
  }
  if (!fs.existsSync(file)) {
    return res.status(404).send("Not found");
  }
  res.sendFile(file);
});

// Fallback: send the board shell for any other non-API route.
app.get("*", (req, res) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({ error: "Not found." });
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

// Error handler (must be last): turns any thrown/rejected route error into a
// clean response instead of a crash. Async routes are wrapped with `ah(...)`
// so their rejections land here too.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  // Oversized or malformed JSON bodies: respond cleanly instead of a 500/crash.
  if (err && err.type === "entity.too.large") {
    return res.status(413).json({ error: `That upload is too big (limit ${config.MAX_BODY_MB} MB).` });
  }
  if (err && (err.type === "entity.parse.failed" || err instanceof SyntaxError)) {
    return res.status(400).json({ error: "Malformed request body." });
  }
  console.error("  ✖ Request error:", err && err.stack ? err.stack : err);
  if ((req.path || "").startsWith("/api/")) {
    return res.status(500).json({ error: "Something went wrong on the server — it stayed up, give it another try." });
  }
  res.status(500).send("Something went wrong. The app is still running — try again.");
});

// --- Lifecycle: PID file + graceful shutdown (the on/off buttons) ----------
const PID_FILE = path.join(DATA_DIR, "server.pid");
try {
  fs.writeFileSync(PID_FILE, String(process.pid), "utf8");
} catch {
  /* non-fatal */
}

const server = app.listen(config.PORT, config.HOST, () => {
  let buildStr = "dev";
  try { const info = require("./build-info.json"); buildStr = `v${info.version || ""} build ${info.build}`; } catch { /* dev */ }
  console.log("");
  console.log(`  🧳  Trip Planner is running!  (${buildStr})`);
  console.log("  ----------------------------------------");
  console.log(`  On this computer:  http://localhost:${config.PORT}`);
  for (const ip of localAddresses()) {
    console.log(`  On your network:   http://${ip}:${config.PORT}`);
  }
  console.log("  ----------------------------------------");
  if (db.userCount() === 0) {
    console.log("  First run: open it and create your account — you become the admin.");
  }
  // Flag weak defaults (default sign-up code, etc.) without printing secrets.
  config.auditSecurity();
  console.log("  Press Ctrl+C here (or run Stop Trip Planner.bat) to turn it off.");
  console.log("");
});

// Right after an in-app update the old process may not have released the port
// yet. Instead of crashing on EADDRINUSE (which leaves the site dead — the Bad
// Gateway problem), retry binding for a short window so the new build can take
// over the moment the port frees.
let bindRetries = 0;
server.on("error", (err) => {
  if (err.code === "EADDRINUSE" && bindRetries < 20) {
    bindRetries++;
    if (bindRetries === 1) console.log(`  Port ${config.PORT} is still in use — waiting for it to free up…`);
    setTimeout(() => server.listen(config.PORT, config.HOST), 1000);
  } else {
    console.error(`  Could not start: ${err.message}`);
    process.exit(1);
  }
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
