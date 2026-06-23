"use strict";

// Admin-only: manage the people who can log in, plus the shared invite code.

const express = require("express");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const db = require("../lib/db");
const config = require("../lib/config");
const { requireAdmin, requireAuth, inviteCode } = require("../lib/auth-middleware");
const { ah } = require("../lib/async-handler");
const v = require("../lib/validate");

const router = express.Router();

const USERNAME_RE = /^[a-zA-Z0-9_.-]+$/;
const inviteCodeSchema = {
  inviteCode: { type: "string", required: true, min: 4, max: 100 },
};
const createUserSchema = {
  username: { type: "string", required: true, min: 3, max: 32, pattern: USERNAME_RE, patternMessage: "Username can only use letters, numbers, and . _ -" },
  displayName: { type: "string", max: 60 },
  password: { type: "string", required: true, min: 6, max: 200, trim: false },
  isAdmin: { type: "boolean" },
};
const updateUserSchema = {
  isAdmin: { type: "boolean" },
  isEarlyBird: { type: "boolean" },
  password: { type: "string", min: 6, max: 200, trim: false },
};

// A light directory any logged-in user can read, so they can pick people to
// invite to their own trips. Only id / username / display name is exposed.
router.get("/directory", requireAuth, (req, res) => {
  res.json({
    users: db.getUsers().map((u) => ({
      id: u.id,
      username: u.username,
      displayName: u.displayName,
      avatarEmoji: u.avatarEmoji || "",
      avatarColor: u.avatarColor || "",
      avatarImage: u.avatarImage || "",
    })),
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
    isEarlyBird: !!u.isEarlyBird,
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

router.put("/invite-code", v.body(inviteCodeSchema), (req, res) => {
  const code = req.valid.inviteCode;
  db.updateSettings({ inviteCode: code });
  res.json({ inviteCode: code, isDefault: false });
});

// Update a user: toggle admin/early bird, or reset their password.
router.put("/:id", v.body(updateUserSchema), ah(async (req, res) => {
  const target = db.findUserById(req.params.id);
  if (!target) return res.status(404).json({ error: "User not found." });

  const patch = {};
  const { isAdmin, isEarlyBird, password } = req.valid;

  if (typeof isAdmin === "boolean") {
    // Don't let the last admin demote themselves into a locked-out app.
    if (target.isAdmin && !isAdmin && db.adminCount() <= 1) {
      return res.status(400).json({ error: "You can't remove the last admin." });
    }
    patch.isAdmin = isAdmin;
  }

  if (typeof isEarlyBird === "boolean") {
    patch.isEarlyBird = isEarlyBird;
  }

  if (password != null) {
    patch.passwordHash = await bcrypt.hash(String(password), 10);
  }

  if (!Object.keys(patch).length) {
    return res.status(400).json({ error: "Nothing to update." });
  }

  const updated = db.updateUser(target.id, patch);
  res.json({ user: publicUser(updated) });
}));

// Create an account directly (handy for pre-making a friend's login).
router.post("/", v.body(createUserSchema), ah(async (req, res) => {
  const { username, displayName, password, isAdmin } = req.valid;
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
}));

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
