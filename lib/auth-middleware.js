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

// Who can see a trip: an admin, the creator, anyone it's shared with, a
// member of the trip, or everyone when the trip is marked shareWithEveryone.
function canView(trip, user) {
  if (!trip || !user) return false;
  if (user.isAdmin) return true;
  if (trip.shareWithEveryone) return true;
  if (isCreator(trip, user)) return true;
  if (isMember(trip, user)) return true;
  // legacy field, kept so older trips keep working
  return Array.isArray(trip.allowedUsers) && trip.allowedUsers.includes(user.id);
}

function isCreator(trip, user) {
  return !!(trip && user && trip.createdBy && trip.createdBy === user.id);
}

function isMember(trip, user) {
  return !!(trip && user && Array.isArray(trip.members) && trip.members.includes(user.id));
}

// Anyone on the trip (creator or member) — or an admin — can invite others.
function canAddMembers(trip, user) {
  if (!trip || !user) return false;
  return user.isAdmin || isCreator(trip, user) || isMember(trip, user);
}

// Only the trip's creator (or an admin) can remove people or delete the trip.
function canRemoveMembers(trip, user) {
  if (!trip || !user) return false;
  return user.isAdmin || isCreator(trip, user);
}

// Editing trip details (title, date, theme, etc.) and deleting: creator or admin.
function canManageTrip(trip, user) {
  if (!trip || !user) return false;
  return user.isAdmin || isCreator(trip, user);
}

module.exports = {
  requireAuth,
  requireAdmin,
  requirePage,
  canView,
  isCreator,
  isMember,
  canAddMembers,
  canRemoveMembers,
  canManageTrip,
  inviteCode,
};
