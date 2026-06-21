"use strict";

// Trips are shared plans with their own crew and access control.
// - Any logged-in user can create a trip (they become its creator).
// - Anyone on a trip (creator or member) can invite more people.
// - Only the creator (or an admin) can remove people, edit, or delete it.
// - Admins can see and manage every trip.

const express = require("express");
const crypto = require("crypto");
const db = require("../lib/db");
const {
  requireAuth,
  canView,
  isCreator,
  isMember,
  canAddMembers,
  canRemoveMembers,
  canManageTrip,
} = require("../lib/auth-middleware");

const router = express.Router();

const str = (v, max = 2000) => String(v == null ? "" : v).slice(0, max).trim();
const slugify = (v) =>
  str(v, 80).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || crypto.randomUUID();

// The three accent themes from the design (all share the Pitstop aesthetic).
const THEMES = ["red", "blue", "green"];
const cleanTheme = (v) => (THEMES.includes(String(v || "").trim()) ? String(v).trim() : "red");

// Turn a list of member user-ids into {id, displayName, initials} for display.
function resolveMembers(trip) {
  const ids = Array.isArray(trip.members) ? trip.members : [];
  const people = ids
    .map((id) => db.findUserById(id))
    .filter(Boolean)
    .map((u) => ({ id: u.id, displayName: u.displayName }));
  // plus any display-only names (people without an account, e.g. the seed crew)
  const extras = (Array.isArray(trip.crew) ? trip.crew : []).map((name) => ({ id: null, displayName: name }));
  return [...people, ...extras];
}

// What the board/detail needs to draw a trip, plus per-user permission flags.
function publicTrip(t, user) {
  const members = resolveMembers(t);
  const base = {
    id: t.id,
    slug: t.slug,
    title: t.title,
    subtitle: t.subtitle || "",
    date: t.date || "",
    emoji: t.emoji || "🚗",
    tags: t.tags || [],
    theme: cleanTheme(t.theme),
    members,
    memberCount: members.length,
    hasPage: !!t.pageFile,
    creatorId: t.createdBy || null,
    creatorName: t.createdByName || "",
    // permission flags so the UI can show the right controls
    isCreator: isCreator(t, user),
    isMember: isMember(t, user),
    canAddMembers: canAddMembers(t, user),
    canRemoveMembers: canRemoveMembers(t, user),
    canManage: canManageTrip(t, user),
  };
  if (user && (user.isAdmin || isCreator(t, user))) {
    base.shareWithEveryone = !!t.shareWithEveryone;
    base.pageFile = t.pageFile || "";
    base.memberIds = Array.isArray(t.members) ? t.members : [];
  }
  return base;
}

function normalizeTripInput(body) {
  return {
    title: str(body.title, 120) || "Untitled trip",
    subtitle: str(body.subtitle, 200),
    date: str(body.date, 20),
    emoji: str(body.emoji, 8) || "🚗",
    theme: cleanTheme(body.theme),
    tags: (Array.isArray(body.tags) ? body.tags : [])
      .map((x) => str(x, 40))
      .filter(Boolean)
      .slice(0, 8),
    pageFile: str(body.pageFile, 120),
    shareWithEveryone: !!body.shareWithEveryone,
  };
}

// --- Member-facing -------------------------------------------------------

// List the trips this user can see (soonest first).
router.get("/", requireAuth, (req, res) => {
  const trips = db
    .getTrips()
    .filter((t) => canView(t, req.user))
    .sort((a, b) => (a.date || a.createdAt || "").localeCompare(b.date || b.createdAt || ""))
    .map((t) => publicTrip(t, req.user));
  res.json({ trips });
});

router.get("/:id", requireAuth, (req, res) => {
  const trip = db.findTripBySlug(req.params.id) || db.findTripById(req.params.id);
  if (!trip || !canView(trip, req.user)) {
    return res.status(404).json({ error: "Trip not found." });
  }
  res.json({ trip: publicTrip(trip, req.user) });
});

// --- Create (any logged-in user) -----------------------------------------

router.post("/", requireAuth, (req, res) => {
  const input = normalizeTripInput(req.body || {});
  const now = new Date().toISOString();
  const slug = str(req.body.slug, 80) ? slugify(req.body.slug) : slugify(input.title);
  if (db.findTripBySlug(slug)) {
    return res.status(409).json({ error: `A trip called "${input.title}" already exists. Try a different name.` });
  }
  const trip = db.addTrip({
    id: crypto.randomUUID(),
    slug,
    ...input,
    members: [req.user.id], // creator is the first member
    crew: [],
    createdBy: req.user.id,
    createdByName: req.user.displayName,
    createdAt: now,
    updatedAt: now,
  });
  res.status(201).json({ trip: publicTrip(trip, req.user) });
});

// --- Edit details / delete (creator or admin) ----------------------------

router.put("/:id", requireAuth, (req, res) => {
  const existing = db.findTripById(req.params.id);
  if (!existing) return res.status(404).json({ error: "Trip not found." });
  if (!canManageTrip(existing, req.user)) {
    return res.status(403).json({ error: "Only the trip's creator can edit it." });
  }
  const input = normalizeTripInput({ ...existing, ...req.body });
  const updated = db.updateTrip(existing.id, input);
  res.json({ trip: publicTrip(updated, req.user) });
});

router.delete("/:id", requireAuth, (req, res) => {
  const existing = db.findTripById(req.params.id);
  if (!existing) return res.status(404).json({ error: "Trip not found." });
  if (!canManageTrip(existing, req.user)) {
    return res.status(403).json({ error: "Only the trip's creator can delete it." });
  }
  db.deleteTrip(existing.id);
  res.json({ ok: true });
});

// --- Members: add (any member) / remove (creator only) -------------------

// Add a person to the trip by their username. Anyone on the trip can do this.
router.post("/:id/members", requireAuth, (req, res) => {
  const trip = db.findTripById(req.params.id);
  if (!trip || !canView(trip, req.user)) return res.status(404).json({ error: "Trip not found." });
  if (!canAddMembers(trip, req.user)) {
    return res.status(403).json({ error: "You need to be on this trip to invite others." });
  }
  const { username, userId } = req.body || {};
  const target = userId ? db.findUserById(userId) : db.findUserByUsername(username);
  if (!target) return res.status(404).json({ error: "No account with that username." });

  const members = Array.isArray(trip.members) ? [...trip.members] : [];
  if (members.includes(target.id)) {
    return res.status(409).json({ error: `${target.displayName} is already on this trip.` });
  }
  members.push(target.id);
  const updated = db.updateTrip(trip.id, { members });
  res.json({ trip: publicTrip(updated, req.user) });
});

// Remove a person. Only the creator (or an admin) can.
router.delete("/:id/members/:userId", requireAuth, (req, res) => {
  const trip = db.findTripById(req.params.id);
  if (!trip || !canView(trip, req.user)) return res.status(404).json({ error: "Trip not found." });
  if (!canRemoveMembers(trip, req.user)) {
    return res.status(403).json({ error: "Only the trip's creator can remove people." });
  }
  if (req.params.userId === trip.createdBy) {
    return res.status(400).json({ error: "The creator can't be removed from their own trip." });
  }
  const members = (Array.isArray(trip.members) ? trip.members : []).filter((id) => id !== req.params.userId);
  const updated = db.updateTrip(trip.id, { members });
  res.json({ trip: publicTrip(updated, req.user) });
});

// --- Admin: toggle public visibility -------------------------------------

router.put("/:id/access", requireAuth, (req, res) => {
  const existing = db.findTripById(req.params.id);
  if (!existing) return res.status(404).json({ error: "Trip not found." });
  if (!canManageTrip(existing, req.user)) {
    return res.status(403).json({ error: "Only the trip's creator can change sharing." });
  }
  const updated = db.updateTrip(existing.id, { shareWithEveryone: !!(req.body || {}).shareWithEveryone });
  res.json({ trip: publicTrip(updated, req.user) });
});

module.exports = router;
