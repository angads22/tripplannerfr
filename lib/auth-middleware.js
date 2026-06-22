"use strict";

const db = require("./db");
const config = require("./config");

// The effective shared invite code: whatever the admin last set, otherwise
// the default from config / .env. This is the one and only sign-up code.
function inviteCode() {
  const s = db.getSettings();
  return s.inviteCode || config.INVITE_CODE;
}

// Does this code let someone register? Matches the single invite code
// (case-insensitive, trimmed).
function codeAccepted(code) {
  const given = String(code || "").trim().toLowerCase();
  if (!given) return false;
  return given === String(inviteCode()).trim().toLowerCase();
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

// Who can open a trip's page: the creator, anyone it's shared with, a member,
// or everyone when the trip is marked shareWithEveryone. The admin keeps view
// access so the admin console's "Open" link works for any trip — but viewing
// is all it grants here; management is creator-only (see canManageTrip) and is
// only overridable through the admin panel's own endpoints.
function canView(trip, user) {
  if (!trip || !user) return false;
  if (user.isAdmin) return true;
  return onBoard(trip, user);
}

// Membership test for the personal board/feed — NO admin god-mode. Even the
// admin only sees, on their own board, trips they created, were invited to, or
// that are public. The admin console lists every trip via its override route.
function onBoard(trip, user) {
  if (!trip || !user) return false;
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

// Anyone on the trip (creator or member) can invite others / share the link.
// Admin is intentionally NOT special here: an admin viewing a trip they aren't
// on can't edit it from the trip page — overrides live in the admin panel.
function canAddMembers(trip, user) {
  if (!trip || !user) return false;
  return isCreator(trip, user) || isMember(trip, user);
}

// Anyone on the trip can edit the plan (timing/stops, the map). Same set as
// inviting: it's a collaborative plan.
function canEditPlan(trip, user) {
  return canAddMembers(trip, user);
}

// Only the trip's creator can remove people. (Admin override: admin panel.)
function canRemoveMembers(trip, user) {
  return isCreator(trip, user);
}

// Editing trip details and deleting: the creator only. The admin can still do
// these, but ONLY through the admin console's dedicated override endpoints —
// never from the regular trip page.
function canManageTrip(trip, user) {
  return isCreator(trip, user);
}

module.exports = {
  requireAuth,
  requireAdmin,
  requirePage,
  canView,
  onBoard,
  isCreator,
  isMember,
  canAddMembers,
  canEditPlan,
  canRemoveMembers,
  canManageTrip,
  inviteCode,
  codeAccepted,
};
