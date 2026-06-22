"use strict";

// A tiny, dependency-free JSON file store. Perfect for a personal/friends app:
// no database server to install, no native modules to compile on Windows.
// Everything lives in data/db.json and is written atomically on each change.

const fs = require("fs");
const path = require("path");
const { DATA_DIR } = require("./paths");

const DB_FILE = path.join(DATA_DIR, "db.json");

const DEFAULT_DB = { users: [], trips: [], settings: {} };

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function load() {
  ensureDir();
  if (!fs.existsSync(DB_FILE)) {
    save(DEFAULT_DB);
    return structuredClone(DEFAULT_DB);
  }
  try {
    const raw = fs.readFileSync(DB_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return { ...structuredClone(DEFAULT_DB), ...parsed };
  } catch (err) {
    console.error("[db] Could not read db.json, starting fresh:", err.message);
    return structuredClone(DEFAULT_DB);
  }
}

// A tiny synchronous sleep (no deps) for the rare write-retry path below.
function sleepMs(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    /* spin briefly — only used for a few short retries, never hot */
  }
}

function save(db) {
  ensureDir();
  // Atomic write: write to a temp file then rename, so a crash mid-write
  // can never corrupt the real db.json.
  const tmp = DB_FILE + ".tmp";
  const json = JSON.stringify(db, null, 2);
  fs.writeFileSync(tmp, json, "utf8");

  // On Windows the rename can transiently fail with EPERM/EBUSY/EACCES when
  // antivirus or another process has db.json open for a moment. Historically
  // that threw straight out of an async route and crashed the whole server
  // (the "site crashes when I delete an account" bug). Retry a few times, then
  // fall back to writing directly over the file — keeping the app alive.
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(tmp, DB_FILE);
      return;
    } catch (err) {
      const retriable = err && ["EPERM", "EBUSY", "EACCES"].includes(err.code);
      if (retriable && attempt < 5) {
        sleepMs(40);
        continue;
      }
      // Last resort: overwrite in place so the change still persists.
      try {
        fs.writeFileSync(DB_FILE, json, "utf8");
        try { fs.unlinkSync(tmp); } catch { /* ignore */ }
        return;
      } catch (err2) {
        try { fs.unlinkSync(tmp); } catch { /* ignore */ }
        throw err2;
      }
    }
  }
}

// --- Users -----------------------------------------------------------------

function getUsers() {
  return load().users;
}

function findUserByUsername(username) {
  const u = String(username || "").trim().toLowerCase();
  return getUsers().find((x) => x.username.toLowerCase() === u) || null;
}

function findUserById(id) {
  return getUsers().find((x) => x.id === id) || null;
}

function addUser(user) {
  const db = load();
  db.users.push(user);
  save(db);
  return user;
}

function updateUser(id, patch) {
  const db = load();
  const idx = db.users.findIndex((u) => u.id === id);
  if (idx === -1) return null;
  db.users[idx] = { ...db.users[idx], ...patch, id };
  save(db);
  return db.users[idx];
}

function deleteUser(id) {
  const db = load();
  const before = db.users.length;
  db.users = db.users.filter((u) => u.id !== id);
  if (db.users.length === before) return false; // wasn't there

  // Strip this user from everyone else's friends + pending requests.
  db.users = db.users.map((u) => ({
    ...u,
    friends: (u.friends || []).filter((x) => x !== id),
    friendReqIn: (u.friendReqIn || []).filter((x) => x !== id),
    friendReqOut: (u.friendReqOut || []).filter((x) => x !== id),
  }));

  // Clean every trip the deleted account touched, in one pass:
  //  - drop them from member / legacy-allowed lists;
  //  - if they CREATED the trip, hand it to the next member so it doesn't
  //    become an un-manageable orphan — or delete it outright if no one is
  //    left on it. This is what makes account deletion "smooth": no ghost
  //    creators, no trips nobody can edit or remove.
  const remaining = [];
  const dropped = [];
  for (const t of db.trips) {
    const members = (t.members || []).filter((uid) => uid !== id);
    const allowedUsers = (t.allowedUsers || []).filter((uid) => uid !== id);
    let createdBy = t.createdBy;
    let createdByName = t.createdByName;

    if (t.createdBy === id) {
      if (members.length) {
        createdBy = members[0];
        const heir = db.users.find((u) => u.id === members[0]);
        createdByName = heir ? heir.displayName : t.createdByName;
      } else {
        // Creator left and no one else is on it — drop the trip entirely.
        dropped.push(t.id);
        continue;
      }
    }
    remaining.push({ ...t, members, allowedUsers, createdBy, createdByName });
  }
  db.trips = remaining;

  save(db);
  // Clean up the shared-drive folders of any trips we just dropped.
  for (const tid of dropped) removeTripFiles(tid);
  return true;
}

function userCount() {
  return getUsers().length;
}

function adminCount() {
  return getUsers().filter((u) => u.isAdmin).length;
}

// --- Trips -----------------------------------------------------------------

function getTrips() {
  return load().trips;
}

function findTripById(id) {
  return getTrips().find((t) => t.id === id) || null;
}

function findTripBySlug(slug) {
  const s = String(slug || "").trim().toLowerCase();
  return getTrips().find((t) => String(t.slug || "").toLowerCase() === s) || null;
}

function addTrip(trip) {
  const db = load();
  db.trips.push(trip);
  save(db);
  return trip;
}

function updateTrip(id, patch) {
  const db = load();
  const idx = db.trips.findIndex((t) => t.id === id);
  if (idx === -1) return null;
  db.trips[idx] = { ...db.trips[idx], ...patch, id, updatedAt: new Date().toISOString() };
  save(db);
  return db.trips[idx];
}

// Best-effort removal of a trip's uploaded-files folder so deleting a trip
// doesn't leave its shared-drive data orphaned on disk. Never throws.
function removeTripFiles(id) {
  try {
    const dir = path.join(DATA_DIR, `trip-${id}`);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* non-fatal */
  }
}

function deleteTrip(id) {
  const db = load();
  const before = db.trips.length;
  db.trips = db.trips.filter((t) => t.id !== id);
  save(db);
  const removed = db.trips.length < before;
  if (removed) removeTripFiles(id);
  return removed;
}

// --- Settings (e.g. the shared invite code) --------------------------------

function getSettings() {
  return load().settings || {};
}

function updateSettings(patch) {
  const db = load();
  db.settings = { ...(db.settings || {}), ...patch };
  save(db);
  return db.settings;
}

module.exports = {
  DB_FILE,
  DATA_DIR,
  load,
  save,
  getUsers,
  findUserByUsername,
  findUserById,
  addUser,
  updateUser,
  deleteUser,
  userCount,
  adminCount,
  getTrips,
  findTripById,
  findTripBySlug,
  addTrip,
  updateTrip,
  deleteTrip,
  getSettings,
  updateSettings,
};
