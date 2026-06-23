"use strict";

const express = require("express");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const db = require("../lib/db");
const { codeAccepted } = require("../lib/auth-middleware");
const { claimOwnerlessTrips } = require("../lib/seed");
const { ah } = require("../lib/async-handler");
const v = require("../lib/validate");

const router = express.Router();

// --- Validation schemas (reject unknown fields, type/length-check inputs) ---
// Usernames stay simple & URL/display-safe; passwords are length-bounded only
// (any characters allowed). Login intentionally does NOT enforce a min length
// so it never leaks the password policy — wrong creds just return 401.
const USERNAME_RE = /^[a-zA-Z0-9_.-]+$/;
const registerSchema = {
  username: { type: "string", required: true, min: 3, max: 32, pattern: USERNAME_RE, patternMessage: "Username can only use letters, numbers, and . _ -" },
  displayName: { type: "string", max: 60 },
  password: { type: "string", required: true, min: 6, max: 200 },
  inviteCode: { type: "string", max: 100 },
};
const loginSchema = {
  username: { type: "string", required: true, max: 64 },
  password: { type: "string", required: true, max: 200, trim: false },
};
// avatarImage is a base64 data URL; allow a generous ceiling here (the handler
// does the precise format + 800 KB check) so valid images aren't clipped.
const updateMeSchema = {
  displayName: { type: "string", max: 60 },
  bio: { type: "string", max: 280 },
  avatarEmoji: { type: "string", max: 8 },
  avatarColor: { type: "string", max: 16 },
  avatarImage: { type: "string", max: 1200000, trim: false },
  currentPassword: { type: "string", max: 200, trim: false },
  password: { type: "string", max: 200, trim: false },
};
const deleteMeSchema = {
  password: { type: "string", required: true, max: 200, trim: false },
};

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    isAdmin: u.isAdmin,
    isEarlyBird: !!u.isEarlyBird,
    avatarEmoji: u.avatarEmoji || "",
    avatarColor: u.avatarColor || "",
    avatarImage: u.avatarImage || "",
    bio: u.bio || "",
    // Pending incoming friend requests — drives the "Friends" tab badge.
    friendReqCount: Array.isArray(u.friendReqIn) ? u.friendReqIn.length : 0,
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

router.post("/register", v.body(registerSchema), ah(async (req, res) => {
  const { username, displayName, password, inviteCode: code } = req.valid;

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
    isEarlyBird: isFirstUser,
    createdAt: new Date().toISOString(),
  };
  db.addUser(user);

  // The first account owns the app — give it the starter trip(s).
  if (isFirstUser) claimOwnerlessTrips(user);

  req.session.userId = user.id;
  res.json({ user: publicUser(user) });
}));

router.post("/login", v.body(loginSchema), ah(async (req, res) => {
  const { username, password } = req.valid;
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
}));

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
router.put("/me", requireSelf, v.body(updateMeSchema), ah(async (req, res) => {
  const { displayName, avatarEmoji, avatarColor, password, currentPassword } = req.valid;
  const patch = {};

  if (displayName != null) {
    const d = String(displayName).trim();
    if (d.length < 1) return res.status(400).json({ error: "Name can't be empty." });
    patch.displayName = d.slice(0, 60);
  }
  if (avatarEmoji != null) patch.avatarEmoji = String(avatarEmoji).trim().slice(0, 8);
  if (avatarColor != null) patch.avatarColor = String(avatarColor).trim().slice(0, 16);
  if (req.valid.bio != null) patch.bio = String(req.valid.bio).trim().slice(0, 280);

  // Profile photo: a small client-resized image stored as a data URL (this app
  // is file-backed with no upload server, so the thumbnail lives in db.json).
  // "" clears it back to the emoji/initials avatar.
  if (req.valid.avatarImage != null) {
    const img = String(req.valid.avatarImage).trim();
    if (img === "") {
      patch.avatarImage = "";
    } else if (!/^data:image\/(png|jpeg|jpg|webp|gif);base64,/i.test(img)) {
      return res.status(400).json({ error: "That doesn't look like an image." });
    } else if (img.length > 800000) {
      return res.status(400).json({ error: "That image is too large — try a smaller one." });
    } else {
      patch.avatarImage = img;
    }
  }

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
}));

// Delete your own account (after confirming your password). The last admin
// can only be blocked when there are OTHER users who'd be locked out — if
// you're the only account, deleting is fine (it resets the app).
router.delete("/me", requireSelf, v.body(deleteMeSchema), ah(async (req, res) => {
  const { password } = req.valid;
  const ok = await bcrypt.compare(String(password || ""), req.me.passwordHash);
  if (!ok) return res.status(403).json({ error: "Wrong password." });
  if (req.me.isAdmin && db.adminCount() <= 1 && db.userCount() > 1) {
    return res.status(400).json({ error: "You're the only admin — make someone else an admin first, then you can delete your account." });
  }
  // Persist the deletion FIRST so it's saved to db.json even if tearing the
  // session down hiccups; then end the session so they're logged out at once.
  db.deleteUser(req.me.id);
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    res.json({ ok: true });
  });
}));

module.exports = router;
