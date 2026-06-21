"use strict";

// Admin-only: manage the people who can log in, plus the shared invite code.

const express = require("express");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const db = require("../lib/db");
const config = require("../lib/config");
const { requireAdmin, requireAuth, inviteCode, earlyBird } = require("../lib/auth-middleware");

const router = express.Router();

// A light directory any logged-in user can read, so they can pick people to
// invite to their own trips. Only id / username / display name is exposed.
router.get("/directory", requireAuth, (req, res) => {
  res.json({
    users: db.getUsers().map((u) => ({ id: u.id, username: u.username, displayName: u.displayName })),
  });
});

// Everything below is admin-only.
router.use(requireAdmin);

function publicUser(u) {
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    isAdmin: !!u.isAdmin,
    createdAt: u.createdAt,
  };
}

// List everyone (used by the admin console + the per-trip access editor).
router.get("/", (req, res) => {
  res.json({ users: db.getUsers().map(publicUser) });
});

// The shared invite code lives here so the admin can read/rotate it.
router.get("/invite-code", (req, res) => {
  res.json({ inviteCode: inviteCode(), isDefault: !db.getSettings().inviteCode });
});

router.put("/invite-code", (req, res) => {
  const code = String((req.body || {}).inviteCode || "").trim();
  if (code.length < 4) {
    return res.status(400).json({ error: "Invite code must be at least 4 characters." });
  }
  db.updateSettings({ inviteCode: code });
  res.json({ inviteCode: code, isDefault: false });
});

// The "early bird" code (on by default; admin can flip it off or change it).
router.get("/early-bird", (req, res) => {
  res.json(earlyBird());
});

router.put("/early-bird", (req, res) => {
  const { enabled, code } = req.body || {};
  const patch = {};
  if (typeof enabled === "boolean") patch.earlyBirdEnabled = enabled;
  if (code != null) {
    const c = String(code).trim();
    if (c.length < 4) return res.status(400).json({ error: "Early-bird code must be at least 4 characters." });
    patch.earlyBirdCode = c;
  }
  db.updateSettings(patch);
  res.json(earlyBird());
});

// Update a user: toggle admin, or reset their password.
router.put("/:id", async (req, res) => {
  const target = db.findUserById(req.params.id);
  if (!target) return res.status(404).json({ error: "User not found." });

  const patch = {};
  const { isAdmin, password } = req.body || {};

  if (typeof isAdmin === "boolean") {
    // Don't let the last admin demote themselves into a locked-out app.
    if (target.isAdmin && !isAdmin && db.adminCount() <= 1) {
      return res.status(400).json({ error: "You can't remove the last admin." });
    }
    patch.isAdmin = isAdmin;
  }

  if (password != null) {
    if (String(password).length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters." });
    }
    patch.passwordHash = await bcrypt.hash(String(password), 10);
  }

  if (!Object.keys(patch).length) {
    return res.status(400).json({ error: "Nothing to update." });
  }

  const updated = db.updateUser(target.id, patch);
  res.json({ user: publicUser(updated) });
});

// Create an account directly (handy for pre-making a friend's login).
router.post("/", async (req, res) => {
  const { username, displayName, password, isAdmin } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: "Username and password are required." });
  }
  if (String(username).trim().length < 3) {
    return res.status(400).json({ error: "Username must be at least 3 characters." });
  }
  if (String(password).length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters." });
  }
  if (db.findUserByUsername(username)) {
    return res.status(409).json({ error: "That username is taken." });
  }
  const user = {
    id: crypto.randomUUID(),
    username: String(username).trim(),
    displayName: String(displayName || username).trim(),
    passwordHash: await bcrypt.hash(String(password), 10),
    isAdmin: !!isAdmin,
    createdAt: new Date().toISOString(),
  };
  db.addUser(user);
  res.status(201).json({ user: publicUser(user) });
});

router.delete("/:id", (req, res) => {
  const target = db.findUserById(req.params.id);
  if (!target) return res.status(404).json({ error: "User not found." });
  if (target.id === req.user.id) {
    return res.status(400).json({ error: "You can't delete your own account while signed in." });
  }
  if (target.isAdmin && db.adminCount() <= 1) {
    return res.status(400).json({ error: "You can't delete the last admin." });
  }
  db.deleteUser(target.id);
  res.json({ ok: true });
});

module.exports = router;
