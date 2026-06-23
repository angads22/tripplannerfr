"use strict";

// Central config. Everything can be overridden with environment variables,
// but sensible defaults mean it "just works" out of the box.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { DATA_DIR, EXE_DIR } = require("./paths");

// Tiny .env loader (no dependency). Reads KEY=VALUE lines from a .env next to
// the app into process.env without overriding anything already set.
(function loadDotEnv() {
  try {
    const envPath = path.join(EXE_DIR, ".env");
    if (!fs.existsSync(envPath)) return;
    for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
      if (!m || line.trim().startsWith("#")) continue;
      const key = m[1];
      let val = m[2].replace(/^["']|["']$/g, "");
      if (process.env[key] === undefined) process.env[key] = val;
    }
  } catch {
    /* ignore */
  }
})();

const SECRET_FILE = path.join(DATA_DIR, "session.secret");

// A stable session secret kept on disk so logins survive server restarts
// (important since you'll be flipping the server on and off).
function loadOrCreateSecret() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(SECRET_FILE)) {
      return fs.readFileSync(SECRET_FILE, "utf8").trim();
    }
    const secret = crypto.randomBytes(48).toString("hex");
    fs.writeFileSync(SECRET_FILE, secret, "utf8");
    return secret;
  } catch {
    // Fall back to an ephemeral secret (logs everyone out on restart).
    return crypto.randomBytes(48).toString("hex");
  }
}

// Was the session secret supplied explicitly (env), or are we relying on the
// auto-generated on-disk one? Both are fine in practice; this lets the startup
// audit print the right guidance.
const SESSION_SECRET_FROM_ENV = !!process.env.SESSION_SECRET;

// The default sign-up code. Kept identical to .env.example so docs and code
// agree. It only gates account creation, never trip access — but a default
// everyone knows is still weak, so the startup audit nudges the host to change
// it (the admin can do so from the console).
const DEFAULT_INVITE_CODE = "letmein";

const config = {
  PORT: parseInt(process.env.PORT || "4040", 10),
  HOST: process.env.HOST || "0.0.0.0",
  // The initial shared sign-up code. Once the app runs, the admin can change
  // it from the console (stored in data/db.json); this stays the fallback.
  INVITE_CODE: process.env.INVITE_CODE || DEFAULT_INVITE_CODE,
  DEFAULT_INVITE_CODE,
  SESSION_SECRET: process.env.SESSION_SECRET || loadOrCreateSecret(),
  SESSION_SECRET_FROM_ENV,
  // 30 days
  SESSION_MAX_AGE: 1000 * 60 * 60 * 24 * 30,
  // Max JSON request body. The shared drive stores files as base64 inside the
  // JSON body, so this is the real upload ceiling (base64 inflates ~33%, so the
  // default ~18 MB raw file fits in a 25 MB body). Configurable via env, and a
  // far cry safer than the old unconditional 50 MB (a cheap memory-DoS vector).
  MAX_BODY_MB: Math.max(1, Math.min(100, parseInt(process.env.MAX_BODY_MB || "25", 10) || 25)),
  // Treat anything that isn't NODE_ENV=production as "dev" for warning purposes.
  IS_PRODUCTION: process.env.NODE_ENV === "production",
};

// --- Startup security audit ------------------------------------------------
// Print clear, actionable warnings when the app is running with weak defaults.
// Never prints the actual secret/code values. Call once from server.js.
function auditSecurity() {
  const warn = [];
  if (config.INVITE_CODE === DEFAULT_INVITE_CODE) {
    warn.push("Sign-up code is still the default — change it in the Admin console (or set INVITE_CODE).");
  }
  if (!SESSION_SECRET_FROM_ENV) {
    // The on-disk generated secret is perfectly fine for self-hosting; only flag
    // it as info so a security-conscious host can pin it via env if they prefer.
    warn.push("SESSION_SECRET not set in env — using the auto-generated on-disk secret (fine for self-hosting).");
  }
  if (warn.length) {
    console.log("  🔒 Security notes:");
    for (const w of warn) console.log("     • " + w);
  }
}

config.auditSecurity = auditSecurity;

module.exports = config;
