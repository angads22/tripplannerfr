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

module.exports = {
  PORT: parseInt(process.env.PORT || "4040", 10),
  HOST: process.env.HOST || "0.0.0.0",
  // The initial shared sign-up code. Once the app runs, the admin can change
  // it from the console (stored in data/db.json); this stays the fallback.
  INVITE_CODE: process.env.INVITE_CODE || "potato 21",
  SESSION_SECRET: process.env.SESSION_SECRET || loadOrCreateSecret(),
  // 30 days
  SESSION_MAX_AGE: 1000 * 60 * 60 * 24 * 30,
};
