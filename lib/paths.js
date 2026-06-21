"use strict";

// Resolve where the app's files live, working both as `node server.js` and as
// a packaged .exe.
//
// - When packaged (process.pkg is set), the JS is inside the read-only binary,
//   so anything we READ that ships alongside the exe (public/, content/) lives
//   in the bundled snapshot.
// - Anything we WRITE next to the exe (the downloaded update exe, the .bat) uses
//   EXE_DIR — the real folder the .exe sits in.
// - DATA (db.json, sessions, secret) lives in a STABLE per-user folder so it
//   survives re-downloading/moving the exe and in-app updates. Storing it next
//   to the exe meant data was "wiped" whenever the exe ran from a new location.

const path = require("path");
const fs = require("fs");
const os = require("os");

const isPackaged = !!process.pkg;

// READ-only bundled assets (public/, content/). In a pkg exe this is the
// snapshot (e.g. C:\snapshot\tripplannerfr); in dev it's the project root.
const APP_DIR = path.join(__dirname, "..");

// The real on-disk folder the .exe runs from (or project root in dev). Used for
// things we write right beside the exe (update download + .bat).
const EXE_DIR = isPackaged ? path.dirname(process.execPath) : APP_DIR;

// Where the older builds kept data — next to the exe. Kept so we can migrate.
const LEGACY_DATA_DIR = path.join(EXE_DIR, "data");

// Stable data location.
// - dev: ./data in the project (unchanged, so `node server.js` works as before)
// - packaged: a per-user app-data folder that doesn't move with the exe
function resolveDataDir() {
  if (!isPackaged) return path.join(APP_DIR, "data");
  const base =
    process.env.LOCALAPPDATA ||
    process.env.APPDATA ||
    process.env.XDG_DATA_HOME ||
    os.homedir();
  return path.join(base, "TripPlanner", "data");
}
const DATA_DIR = resolveDataDir();

// One-time migration: if a packaged build used to store data next to the exe,
// move it into the stable location so existing accounts/trips aren't lost.
(function migrateLegacyData() {
  try {
    if (!isPackaged) return;
    if (path.resolve(LEGACY_DATA_DIR) === path.resolve(DATA_DIR)) return;
    const legacyDb = path.join(LEGACY_DATA_DIR, "db.json");
    const newDb = path.join(DATA_DIR, "db.json");
    if (!fs.existsSync(legacyDb) || fs.existsSync(newDb)) return; // nothing to do

    fs.mkdirSync(DATA_DIR, { recursive: true });
    for (const name of ["db.json", "session.secret"]) {
      const src = path.join(LEGACY_DATA_DIR, name);
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(DATA_DIR, name));
    }
    const legacySessions = path.join(LEGACY_DATA_DIR, "sessions");
    if (fs.existsSync(legacySessions)) {
      const dst = path.join(DATA_DIR, "sessions");
      fs.mkdirSync(dst, { recursive: true });
      for (const f of fs.readdirSync(legacySessions)) {
        try { fs.copyFileSync(path.join(legacySessions, f), path.join(dst, f)); } catch {}
      }
    }
    console.log("  Migrated your data to a stable location so updates won't wipe it:\n  " + DATA_DIR);
  } catch {
    /* best-effort; if it fails we just start fresh in DATA_DIR */
  }
})();

const PUBLIC_DIR = path.join(APP_DIR, "public");
const CONTENT_DIR = path.join(APP_DIR, "content");

module.exports = { isPackaged, APP_DIR, EXE_DIR, DATA_DIR, LEGACY_DATA_DIR, PUBLIC_DIR, CONTENT_DIR };
