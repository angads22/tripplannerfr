"use strict";

// A tiny, dependency-free JSON file store. Perfect for a personal/friends app:
// no database server to install, no native modules to compile on Windows.
// Everything lives in data/db.json and is written atomically on each change.

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
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

function save(db) {
  ensureDir();
  // Atomic write: write to a temp file then rename, so a crash mid-write
  // can never corrupt the real db.json.
  const tmp = DB_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), "utf8");
  fs.renameSync(tmp, DB_FILE);
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
  // Also strip this user from any trip's access list.
  db.trips = db.trips.map((t) => ({
    ...t,
    allowedUsers: (t.allowedUsers || []).filter((uid) => uid !== id),
  }));
  save(db);
  return db.users.length < before;
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

function deleteTrip(id) {
  const db = load();
  const before = db.trips.length;
  db.trips = db.trips.filter((t) => t.id !== id);
  save(db);
  return db.trips.length < before;
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
