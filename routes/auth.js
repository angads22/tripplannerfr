"use strict";

const express = require("express");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const db = require("../lib/db");
const { codeAccepted } = require("../lib/auth-middleware");
const { claimOwnerlessTrips } = require("../lib/seed");
const { ah } = require("../lib/async-handler");
const { rateLimit } = require("../lib/rate-limit");

const router = express.Router();

// --- Auth-specific rate limits --------------------------------------------
// These are much tighter than the global API limit because these endpoints
// are the primary brute-force and account-enumeration targets.

// Login: 10 attempts per IP per 15 minutes.
const loginLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: "Too many login attempts from this address — wait 15 minutes and try again.",
});

// Register: 5 new accounts per IP per hour (stops signup spam / invite-code grinding).
const registerLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: "Too many sign-up attempts from this address — try again in an hour.",
});

// Password-change: 5 per IP per 15 minutes (prevents current-password brute-forcing).
const passwordChangeLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: "Too many password-change attempts — wait 15 minutes and try again.",
});

// A data: URL that is genuinely an image and nothing more. Anchored at BOTH
// ends: the prefix must be an allowed image type and the body must be pure
// base64 (so no quotes/parentheses/markup can survive to break out of the
// `style="background:url('...')"` the client renders it into).
function isValidImageDataUrl(s) {
  return /^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/i.test(String(s || ""));
}

// Normalise a user-supplied avatar colour to a safe CSS colour, or "" if it
// isn't one. Accepts #rgb/#rgba/#rrggbb/#rrggbbaa hex and a small set of CSS
// colour keywords. Rejects everything else — this value goes straight into an
// inline style attribute, so it can never contain quotes, parentheses, etc.
const COLOR_KEYWORDS = new Set([
  "red", "blue", "green", "purple", "orange", "pink", "teal", "gold",
  "black", "white", "gray", "grey", "yellow", "brown", "navy", "coral",
]);
function cleanColor(v) {
  const s = String(v == null ? "" : v).trim().toLowerCase();
  if (!s) return "";
  if (/^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/.test(s)) return s;
  if (COLOR_KEYWORDS.has(s)) return s;
  return "";
}

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

router.post("/register", registerLimit, ah(async (req, res) => {
  const { username, displayName, password, inviteCode: code } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ error: "Username and password are required." });
  }
  const uname = String(username).trim();
  if (uname.length < 3) {
    return res.status(400).json({ error: "Username must be at least 3 characters." });
  }
  if (uname.length > 32) {
    return res.status(400).json({ error: "Username must be 32 characters or fewer." });
  }
  // Allow only alphanumeric + underscore/hyphen in usernames.
  if (!/^[\w-]+$/.test(uname)) {
    return res.status(400).json({ error: "Username can only contain letters, numbers, _ and -." });
  }
  if (String(password).length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters." });
  }
  if (String(password).length > 1024) {
    // bcrypt silently truncates at 72 bytes; a huge input is likely an attack.
    return res.status(400).json({ error: "Password is too long." });
  }

  // The very first account becomes the admin (that's you) and skips the
  // invite check. Everyone after needs the shared invite code.
  const isFirstUser = db.userCount() === 0;
  if (!isFirstUser && !codeAccepted(code)) {
    return res.status(403).json({ error: "Wrong invite code — ask the trip's owner for it." });
  }

  if (db.findUserByUsername(uname)) {
    return res.status(409).json({ error: "That username is taken." });
  }

  const hash = await bcrypt.hash(String(password), 10);
  const user = {
    id: crypto.randomUUID(),
    username: uname,
    displayName: String(displayName || uname).trim().slice(0, 60) || uname,
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

router.post("/login", loginLimit, ah(async (req, res) => {
  const { username, password } = req.body || {};
  // Reject obviously oversized inputs before hitting bcrypt.
  if (!username || String(username).length > 200 || String(password || "").length > 1024) {
    return res.status(401).json({ error: "Wrong username or password." });
  }
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
// The password-change path gets a tighter rate limit to block current-password guessing.
router.put("/me", requireSelf, passwordChangeLimit, ah(async (req, res) => {
  const { displayName, avatarEmoji, avatarColor, password, currentPassword } = req.body || {};
  const patch = {};

  if (displayName != null) {
    const d = String(displayName).trim();
    if (d.length < 1) return res.status(400).json({ error: "Name can't be empty." });
    patch.displayName = d.slice(0, 60);
  }
  if (avatarEmoji != null) patch.avatarEmoji = String(avatarEmoji).trim().slice(0, 8);
  if (avatarColor != null) {
    // avatarColor is rendered into inline `style="..."` attributes on the
    // client, so it MUST be a well-formed CSS colour and nothing else — an
    // unrestricted string here is a stored-XSS / attribute-injection vector.
    const color = cleanColor(avatarColor);
    if (avatarColor !== "" && color === "") {
      return res.status(400).json({ error: "Pick a valid colour (e.g. #E23B26)." });
    }
    patch.avatarColor = color;
  }
  if (req.body.bio != null) patch.bio = String(req.body.bio).trim().slice(0, 280);

  // Profile photo: a small client-resized image stored as a data URL (this app
  // is file-backed with no upload server, so the thumbnail lives in db.json).
  // "" clears it back to the emoji/initials avatar.
  if (req.body.avatarImage != null) {
    const img = String(req.body.avatarImage).trim();
    if (img === "") {
      patch.avatarImage = "";
    } else if (img.length > 800000) {
      return res.status(400).json({ error: "That image is too large — try a smaller one." });
    } else if (!isValidImageDataUrl(img)) {
      // The whole string is checked (prefix AND a strict base64 body), because
      // this value is interpolated into `style="background:url('...')"` on the
      // client — anything past the prefix that isn't base64 could break out of
      // the attribute and inject markup (stored XSS).
      return res.status(400).json({ error: "That doesn't look like an image." });
    } else {
      patch.avatarImage = img;
    }
  }

  if (password != null && String(password) !== "") {
    // Changing the password requires confirming the current one.
    if (String(currentPassword || "").length > 1024 || String(password).length > 1024) {
      return res.status(400).json({ error: "Password is too long." });
    }
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
router.delete("/me", requireSelf, ah(async (req, res) => {
  const { password } = req.body || {};
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
