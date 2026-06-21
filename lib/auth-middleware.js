"use strict";

const db = require("./db");
const config = require("./config");

// The effective shared invite code: whatever the admin last set, otherwise
// the default from config / .env.
function inviteCode() {
  const s = db.getSettings();
  return s.inviteCode || config.INVITE_CODE;
}

// Gate the API: require a logged-in member.
function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: "Please log in." });
  }
  const user = db.findUserById(req.session.userId);
  if (!user) {
    return res.status(401).json({ error: "Session expired, please log in again." });
  }
  req.user = user;
  next();
}

// Gate admin-only API (user management, invite code, server controls).
function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (!req.user.isAdmin) {
      return res.status(403).json({ error: "Admins only." });
    }
    next();
  });
}

// For full HTML pages (not the JSON API): bounce to the login screen,
// remembering where the user was headed.
function requirePage(req, res, next) {
  if (req.session && req.session.userId && db.findUserById(req.session.userId)) {
    req.user = db.findUserById(req.session.userId);
    return next();
  }
  const next_ = encodeURIComponent(req.originalUrl || "/");
  res.redirect(`/login.html?next=${next_}`);
}

// Who can see a trip: an admin, the creator, anyone it's shared with, or
// everyone when the trip is marked shareWithEveryone.
function canView(trip, user) {
  if (!trip || !user) return false;
  if (user.isAdmin) return true;
  if (trip.shareWithEveryone) return true;
  if (trip.createdBy && trip.createdBy === user.id) return true;
  if (Array.isArray(trip.editorUsers) && trip.editorUsers.includes(user.id)) return true;
  return Array.isArray(trip.allowedUsers) && trip.allowedUsers.includes(user.id);
}

// Who can change a trip directly (no request needed): an admin, the creator,
// or a member the admin has elevated to "editor". Everyone else who can view
// may only suggest changes (which an editor/admin then approves).
function canEdit(trip, user) {
  if (!trip || !user) return false;
  if (user.isAdmin) return true;
  if (trip.createdBy && trip.createdBy === user.id) return true;
  return Array.isArray(trip.editorUsers) && trip.editorUsers.includes(user.id);
}

module.exports = { requireAuth, requireAdmin, requirePage, canView, canEdit, inviteCode };
