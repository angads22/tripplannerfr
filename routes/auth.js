"use strict";

const express = require("express");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const db = require("../lib/db");
const { inviteCode } = require("../lib/auth-middleware");

const router = express.Router();

function publicUser(u) {
  if (!u) return null;
  return { id: u.id, username: u.username, displayName: u.displayName, isAdmin: u.isAdmin };
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
  if (!isFirstUser && code !== inviteCode()) {
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

module.exports = router;
