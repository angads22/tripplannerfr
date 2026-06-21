"use strict";

const express = require("express");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const db = require("../lib/db");
const { codeAccepted } = require("../lib/auth-middleware");
const { claimOwnerlessTrips } = require("../lib/seed");

const router = express.Router();

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    isAdmin: u.isAdmin,
    avatarEmoji: u.avatarEmoji || "",
    avatarColor: u.avatarColor || "",
    bio: u.bio || "",
  };
}

// Who am I? Used by the frontend to decide what to show.
router.get("/me", (req, res) => {
  if (!req.session.userId) return res.json({ user: null });
  const u = db.findUserById(req.session.userId);
  res.json({ user: publicUser(u) });
});

// Tells the sign-in screen whether this is the first-run admin setup.
router.get("/needs-setup", (req, res) => {
  res.json({ needsSetup: db.userCount() === 0 });
});

router.post("/register", async (req, res) => {
  const { username, displayName, password, inviteCode: code } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ error: "Username and password are required." });
  }
  if (String(username).trim().length < 3) {
    return res.status(400).json({ error: "Username must be at least 3 characters." });
  }
  if (String(password).length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters." });
  }

  // The very first account becomes the admin (that's you) and skips the
  // invite check. Everyone after needs the shared invite code.
  const isFirstUser = db.userCount() === 0;
  if (!isFirstUser && !codeAccepted(code)) {
    return res.status(403).json({ error: "Wrong invite code — ask the trip's owner for it." });
  }

  if (db.findUserByUsername(username)) {
    return res.status(409).json({ error: "That username is taken." });
  }

  const hash = await bcrypt.hash(String(password), 10);
  const user = {
    id: crypto.randomUUID(),
    username: String(username).trim(),
    displayName: String(displayName || username).trim(),
    passwordHash: hash,
    isAdmin: isFirstUser,
    createdAt: new Date().toISOString(),
  };
  db.addUser(user);

  // The first account owns the app — give it the starter trip(s).
  if (isFirstUser) claimOwnerlessTrips(user);

  req.session.userId = user.id;
  res.json({ user: publicUser(user) });
});

router.post("/login", async (req, res) => {
  const { username, password } = req.body || {};
  const user = db.findUserByUsername(username);
  if (!user) {
    return res.status(401).json({ error: "Wrong username or password." });
  }
  const ok = await bcrypt.compare(String(password || ""), user.passwordHash);
  if (!ok) {
    return res.status(401).json({ error: "Wrong username or password." });
  }
  req.session.userId = user.id;
  res.json({ user: publicUser(user) });
});

router.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    res.json({ ok: true });
  });
});

// --- Account settings (edit your own profile / delete your account) --------

function requireSelf(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: "Please log in." });
  const u = db.findUserById(req.session.userId);
  if (!u) return res.status(401).json({ error: "Session expired, please log in again." });
  req.me = u;
  next();
}

// Update your own display name, avatar, and (optionally) password.
router.put("/me", requireSelf, async (req, res) => {
  const { displayName, avatarEmoji, avatarColor, password, currentPassword } = req.body || {};
  const patch = {};

  if (displayName != null) {
    const d = String(displayName).trim();
    if (d.length < 1) return res.status(400).json({ error: "Name can't be empty." });
    patch.displayName = d.slice(0, 60);
  }
  if (avatarEmoji != null) patch.avatarEmoji = String(avatarEmoji).trim().slice(0, 8);
  if (avatarColor != null) patch.avatarColor = String(avatarColor).trim().slice(0, 16);
  if (req.body.bio != null) patch.bio = String(req.body.bio).trim().slice(0, 280);

  if (password != null && String(password) !== "") {
    // Changing the password requires confirming the current one.
    const ok = await bcrypt.compare(String(currentPassword || ""), req.me.passwordHash);
    if (!ok) return res.status(403).json({ error: "Current password is wrong." });
    if (String(password).length < 6) return res.status(400).json({ error: "New password must be at least 6 characters." });
    patch.passwordHash = await bcrypt.hash(String(password), 10);
  }

  if (!Object.keys(patch).length) return res.status(400).json({ error: "Nothing to update." });
  const updated = db.updateUser(req.me.id, patch);
  res.json({ user: publicUser(updated) });
});

// Delete your own account (after confirming your password). The last admin
// can only be blocked when there are OTHER users who'd be locked out — if
// you're the only account, deleting is fine (it resets the app).
router.delete("/me", requireSelf, async (req, res) => {
  const { password } = req.body || {};
  const ok = await bcrypt.compare(String(password || ""), req.me.passwordHash);
  if (!ok) return res.status(403).json({ error: "Wrong password." });
  if (req.me.isAdmin && db.adminCount() <= 1 && db.userCount() > 1) {
    return res.status(400).json({ error: "You're the only admin — make someone else an admin first, then you can delete your account." });
  }
  db.deleteUser(req.me.id);
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    res.json({ ok: true });
  });
});

module.exports = router;
