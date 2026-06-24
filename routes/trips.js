"use strict";

// Trips are shared plans with their own crew and access control.
// - Any logged-in user can create a trip (they become its creator).
// - Anyone on a trip (creator or member) can invite more people / share the link.
// - Any member can leave the trip; the creator deletes it instead.
// - Only the creator can remove people, change details/theme-locked settings,
//   reset the invite link, or delete the trip.
// - The admin gets NO special powers on the trip page itself. Every override
//   (see all trips, delete any trip, remove anyone, prune activity) lives in
//   the admin console under /api/admin/* — nowhere else.

const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const db = require("../lib/db");
const { DATA_DIR } = require("../lib/paths");
const {
  requireAuth,
  canView,
  onBoard,
  isCreator,
  isMember,
  canAddMembers,
  canEditPlan,
  canRemoveMembers,
  canManageTrip,
} = require("../lib/auth-middleware");

const router = express.Router();

const str = (v, max = 2000) => String(v == null ? "" : v).slice(0, max).trim();
const slugify = (v) =>
  str(v, 80).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || crypto.randomUUID();

// Accent themes (all share the Pitstop aesthetic; the first three are the
// design's Highway Red / Lake Blue / Pine Green). A custom #rrggbb is also
// allowed so people can pick their own accent.
const THEMES = ["red", "blue", "green", "purple", "orange", "pink", "teal", "gold", "slate", "coral", "indigo", "sky", "lime", "plum", "charcoal"];
const HEX = /^#[0-9a-fA-F]{6}$/;
const cleanTheme = (v) => {
  const s = String(v || "").trim();
  if (THEMES.includes(s)) return s;
  if (HEX.test(s)) return s;
  return "red";
};

// A "vibe" is the overall mood of a trip page — it drives the whole-page
// background (not just the accent), so picking a theme colour + a vibe lets the
// trip look and feel distinct. All vibes tint from the trip's accent so any
// colour (preset or custom hex) carries through. See pitstop.css.
const VIBES = ["classic", "vivid", "pastel", "night"];
const cleanVibe = (v) => (VIBES.includes(String(v || "").trim()) ? String(v).trim() : "classic");

// --- Budget ---------------------------------------------------------------
// A trip's shared budget so the crew can plan what it'll cost and make sure
// everyone can afford it. Each line item is either:
//   kind "group"  — a shared cost split evenly across the crew (e.g. the
//                   Airbnb, a rental van) — everyone pays amount / heads.
//   kind "person" — a per-person cost everyone pays themselves (flights,
//                   food, spending money).
// The frontend totals these into a per-person estimate and a trip total.
const BUDGET_CATS = ["transport", "stay", "food", "fun", "other"];
function cleanBudgetItem(it) {
  it = it || {};
  return {
    id: it.id || crypto.randomUUID(),
    label: str(it.label, 80) || "Item",
    amount: Math.max(0, Math.min(1e9, Math.round((Number(it.amount) || 0) * 100) / 100)),
    kind: it.kind === "group" ? "group" : "person",
    category: BUDGET_CATS.includes(it.category) ? it.category : "other",
  };
}
function normalizeBudget(b) {
  b = b || {};
  return {
    currency: str(b.currency, 4) || "$",
    // 0 means "use the live member count"; an explicit number lets you plan for
    // guests who aren't accounts on the app.
    splitCount: Math.max(0, Math.min(999, parseInt(b.splitCount, 10) || 0)),
    items: (Array.isArray(b.items) ? b.items : []).slice(0, 80).map(cleanBudgetItem),
  };
}

// Turn a list of member user-ids into display objects. Only real accounts are
// members now — the old display-only "crew" name strings (people without an
// account) are no longer shown. Each member carries their chosen avatar so the
// crew/board reflect profile customization.
function resolveMembers(trip) {
  const ids = Array.isArray(trip.members) ? trip.members : [];
  return ids
    .map((id) => db.findUserById(id))
    .filter(Boolean)
    .map((u) => ({
      id: u.id,
      displayName: u.displayName,
      avatarEmoji: u.avatarEmoji || "",
      avatarColor: u.avatarColor || "",
      avatarImage: u.avatarImage || "",
    }));
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
    vibe: cleanVibe(t.vibe),
    budget: normalizeBudget(t.budget),
    description: t.description || "",
    coverUrl: t.coverUrl || "",
    // Shared "post-trip notes" the crew writes after the trip wraps — surfaced
    // on the board's Past trips section and the trip page.
    recap: t.recap || "",
    members,
    memberCount: members.length,
    stops: (Array.isArray(t.stops) ? t.stops : []).slice().sort((a, b) => ((a.order ?? 1e9) - (b.order ?? 1e9)) || String(a.time || "").localeCompare(String(b.time || ""))),
    mapUrl: t.mapUrl || "",
    activity: (Array.isArray(t.activity) ? t.activity : []).slice(-30).reverse(),
    proposals: (Array.isArray(t.proposals) ? t.proposals : []).filter((p) => p.status === "open").reverse(),
    hasPage: !!t.pageFile,
    creatorId: t.createdBy || null,
    creatorName: t.createdByName || "",
    // permission flags so the UI can show the right controls
    isCreator: isCreator(t, user),
    isMember: isMember(t, user),
    canAddMembers: canAddMembers(t, user),
    canEditPlan: canEditPlan(t, user),
    canRemoveMembers: canRemoveMembers(t, user),
    canManage: canManageTrip(t, user),
    // a member who didn't create the trip can leave it (the creator deletes instead)
    canLeave: isMember(t, user) && !isCreator(t, user),
  };
  // The crew can see the join code so they can share the invite link.
  if (user && (user.isAdmin || isCreator(t, user) || isMember(t, user))) {
    base.joinCode = t.joinCode || "";
  }
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
    vibe: cleanVibe(body.vibe),
    tags: (Array.isArray(body.tags) ? body.tags : [])
      .map((x) => str(x, 40))
      .filter(Boolean)
      .slice(0, 8),
    pageFile: str(body.pageFile, 120),
    shareWithEveryone: !!body.shareWithEveryone,
    description: str(body.description, 1000),
    coverUrl: str(body.coverUrl, 500),
  };
}

// A short, readable, URL-safe code that gates joining a private trip.
function genJoinCode() {
  return crypto.randomBytes(5).toString("hex"); // 10 hex chars
}

// Does this person have the right join code for the trip? (case-insensitive)
function codeMatches(trip, code) {
  const given = String(code || "").trim().toLowerCase();
  return !!given && !!trip.joinCode && given === String(trip.joinCode).trim().toLowerCase();
}

// Make sure a trip has a join code (older trips / the seed may not). Returns
// the trip, backfilling and persisting a code if it was missing.
function ensureJoinCode(trip) {
  if (trip && !trip.joinCode) {
    const updated = db.updateTrip(trip.id, { joinCode: genJoinCode() });
    if (updated) return updated;
  }
  return trip;
}

// Who can open a trip page: anyone who can view it normally (admin, creator,
// member, or a trip marked shareWithEveryone) OR someone presenting the
// trip's join code via a shared link. Private trips are NOT visible to every
// signed-in user — only to the crew and people with the code.
function canSee(trip, user, code) {
  return canView(trip, user) || codeMatches(trip, code);
}

// --- Member-facing -------------------------------------------------------

// List the trips on this user's board (soonest first). This uses board
// membership, NOT canView — so even an admin only sees their own / invited /
// public trips here. The admin console lists every trip via its own endpoint.
router.get("/", requireAuth, (req, res) => {
  const trips = db
    .getTrips()
    .filter((t) => onBoard(t, req.user))
    .sort((a, b) => (a.date || a.createdAt || "").localeCompare(b.date || b.createdAt || ""))
    .map((t) => publicTrip(t, req.user));
  res.json({ trips });
});

router.get("/:id", requireAuth, (req, res) => {
  let trip = db.findTripBySlug(req.params.id) || db.findTripById(req.params.id);
  const code = req.query.code || req.query.j;
  if (!trip || !canSee(trip, req.user, code)) {
    return res.status(404).json({ error: "Trip not found." });
  }
  // Backfill a join code so the crew always has a link to share.
  if (canAddMembers(trip, req.user)) trip = ensureJoinCode(trip);
  res.json({ trip: publicTrip(trip, req.user) });
});

// Join a private trip via its code (from a shared link), or join a trip
// that's been shared with everyone.
router.post("/:id/join", requireAuth, (req, res) => {
  const trip = db.findTripBySlug(req.params.id) || db.findTripById(req.params.id);
  if (!trip) return res.status(404).json({ error: "Trip not found." });

  const members = Array.isArray(trip.members) ? [...trip.members] : [];
  if (members.includes(req.user.id) || isCreator(trip, req.user)) {
    return res.json({ trip: publicTrip(trip, req.user) }); // already on it
  }
  // Must either have the trip's code, or the trip is open to everyone.
  const code = (req.body && (req.body.code || req.body.j)) || req.query.code || req.query.j;
  if (!trip.shareWithEveryone && !codeMatches(trip, code) && !req.user.isAdmin) {
    return res.status(403).json({ error: "You need the trip's invite link or code to join." });
  }
  members.push(req.user.id);
  const updated = db.updateTrip(trip.id, withActivity(trip, req.user, "joined the trip", { members }));
  res.json({ trip: publicTrip(updated, req.user) });
});

// Leave a trip you're on. The creator can't leave their own trip (they delete
// it instead); everyone else just gets taken off the member list.
router.post("/:id/leave", requireAuth, (req, res) => {
  const trip = db.findTripBySlug(req.params.id) || db.findTripById(req.params.id);
  if (!trip) return res.status(404).json({ error: "Trip not found." });
  if (isCreator(trip, req.user)) {
    return res.status(400).json({ error: "You created this trip — delete it instead of leaving." });
  }
  if (!isMember(trip, req.user)) {
    return res.status(400).json({ error: "You're not on this trip." });
  }
  const members = (Array.isArray(trip.members) ? trip.members : []).filter((id) => id !== req.user.id);
  db.updateTrip(trip.id, withActivity(trip, req.user, "left the trip", { members }));
  res.json({ ok: true });
});

// Rotate the join code (revokes any previously shared links). Creator only.
router.post("/:id/rotate-code", requireAuth, (req, res) => {
  const trip = db.findTripById(req.params.id);
  if (!trip) return res.status(404).json({ error: "Trip not found." });
  if (!canManageTrip(trip, req.user)) {
    return res.status(403).json({ error: "Only the trip's creator can reset the invite link." });
  }
  const updated = db.updateTrip(trip.id, { joinCode: genJoinCode() });
  res.json({ trip: publicTrip(updated, req.user) });
});

// Duplicate a trip into a private copy owned by whoever duplicates it. Handy
// for forking a plan (e.g. the admin making the shared Toronto their own).
// Anyone who can see the trip (crew, admin, or someone with the code) can.
router.post("/:id/duplicate", requireAuth, (req, res) => {
  const src = db.findTripBySlug(req.params.id) || db.findTripById(req.params.id);
  const code = (req.body && (req.body.code || req.body.j)) || req.query.code || req.query.j;
  if (!src || !canSee(src, req.user, code)) return res.status(404).json({ error: "Trip not found." });

  const now = new Date().toISOString();
  const baseTitle = str(src.title, 110) + " (copy)";
  let slug = slugify(baseTitle);
  for (let n = 2; db.findTripBySlug(slug); n++) slug = slugify(baseTitle + " " + n);

  const copy = db.addTrip({
    id: crypto.randomUUID(),
    slug,
    title: baseTitle,
    subtitle: src.subtitle || "",
    date: src.date || "",
    emoji: src.emoji || "🚗",
    theme: cleanTheme(src.theme),
    tags: Array.isArray(src.tags) ? [...src.tags] : [],
    crew: Array.isArray(src.crew) ? [...src.crew] : [],
    members: [req.user.id], // the duplicator is the owner + first member
    stops: (Array.isArray(src.stops) ? src.stops : []).map((s) => ({ ...s, id: crypto.randomUUID() })),
    mapUrl: src.mapUrl || "",
    activity: [{ id: crypto.randomUUID(), ts: now, userId: req.user.id, userName: req.user.displayName, text: `duplicated from "${src.title}"` }],
    proposals: [],
    pageFile: "", // a copy uses the generic detail page, not the original's custom HTML
    shareWithEveryone: false, // private to the new owner
    joinCode: genJoinCode(),
    allowedUsers: [],
    createdBy: req.user.id,
    createdByName: req.user.displayName,
    createdAt: now,
    updatedAt: now,
  });
  res.status(201).json({ trip: publicTrip(copy, req.user) });
});

// Join a trip just by its code (paste-a-code on the dashboard). Works for any
// trip whose code matches — including Toronto.
router.post("/join-by-code", requireAuth, (req, res) => {
  const code = String((req.body && req.body.code) || "").trim().toLowerCase();
  if (!code) return res.status(400).json({ error: "Enter a trip code." });
  const trip = db.getTrips().find((t) => t.joinCode && String(t.joinCode).trim().toLowerCase() === code);
  if (!trip) return res.status(404).json({ error: "No trip found for that code." });

  const members = Array.isArray(trip.members) ? [...trip.members] : [];
  if (members.includes(req.user.id) || isCreator(trip, req.user)) {
    return res.json({ trip: publicTrip(trip, req.user), already: true });
  }
  members.push(req.user.id);
  const updated = db.updateTrip(trip.id, withActivity(trip, req.user, "joined the trip", { members }));
  res.json({ trip: publicTrip(updated, req.user) });
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
    joinCode: genJoinCode(), // private link/code others use to join
    members: [req.user.id], // creator is the first member
    crew: [],
    stops: [],
    mapUrl: "",
    activity: [{ id: crypto.randomUUID(), ts: now, userId: req.user.id, userName: req.user.displayName, text: "created the trip" }],
    createdBy: req.user.id,
    createdByName: req.user.displayName,
    createdAt: now,
    updatedAt: now,
  });
  res.status(201).json({ trip: publicTrip(trip, req.user) });
});

// --- Edit details (any member) / delete (creator only) -------------------

// Anyone on the trip can edit its details (title, date, theme, description,
// cover, tags). Two settings stay creator-only: making the trip public
// (shareWithEveryone) and the custom page file.
router.put("/:id", requireAuth, (req, res) => {
  const existing = db.findTripById(req.params.id);
  if (!existing) return res.status(404).json({ error: "Trip not found." });
  if (!canEditPlan(existing, req.user)) {
    return res.status(403).json({ error: "Join the trip to edit it." });
  }
  const input = normalizeTripInput({ ...existing, ...req.body });
  if (!canManageTrip(existing, req.user)) {
    input.shareWithEveryone = !!existing.shareWithEveryone; // members can't change visibility
    input.pageFile = existing.pageFile || ""; // or the custom page binding
  }
  const note = req.body && req.body.theme && req.body.theme !== existing.theme ? `changed the theme to ${input.theme}` : "updated trip details";
  const updated = db.updateTrip(existing.id, withActivity(existing, req.user, note, input));
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
  const updated = db.updateTrip(trip.id, withActivity(trip, req.user, `added ${target.displayName} to the trip`, { members }));
  res.json({ trip: publicTrip(updated, req.user) });
});

// Remove a person. Only the creator can (admin override is in the admin panel).
router.delete("/:id/members/:userId", requireAuth, (req, res) => {
  const trip = db.findTripById(req.params.id);
  if (!trip || !canView(trip, req.user)) return res.status(404).json({ error: "Trip not found." });
  if (!canRemoveMembers(trip, req.user)) {
    return res.status(403).json({ error: "Only the trip's creator can remove people." });
  }
  if (req.params.userId === trip.createdBy) {
    return res.status(400).json({ error: "The creator can't be removed from their own trip." });
  }
  const removed = db.findUserById(req.params.userId);
  const members = (Array.isArray(trip.members) ? trip.members : []).filter((id) => id !== req.params.userId);
  const updated = db.updateTrip(trip.id, withActivity(trip, req.user, `removed ${removed ? removed.displayName : "someone"} from the trip`, { members }));
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

// Delete an activity entry (creator only; admin override is in the admin panel)
router.delete("/:id/activity/:activityId", requireAuth, (req, res) => {
  const existing = db.findTripById(req.params.id);
  if (!existing) return res.status(404).json({ error: "Trip not found." });
  if (!canManageTrip(existing, req.user)) {
    return res.status(403).json({ error: "Only the trip's creator can delete activity." });
  }
  const activity = (Array.isArray(existing.activity) ? existing.activity : []).filter((a) => a.id !== req.params.activityId);
  const updated = db.updateTrip(existing.id, { activity });
  res.json({ trip: publicTrip(updated, req.user) });
});

// --- Activity log helper -------------------------------------------------

// Append a "who did what" entry (kept to the last 50) and return the patch.
function withActivity(trip, user, text, patch) {
  const activity = Array.isArray(trip.activity) ? trip.activity.slice(-49) : [];
  activity.push({
    id: crypto.randomUUID(),
    ts: new Date().toISOString(),
    userId: user.id,
    userName: user.displayName,
    text,
  });
  return { ...patch, activity };
}

// A Google Maps search link from a free-text place name.
const mapsLink = (place) => "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(place);

// --- Itinerary / timing events (any trip member) -------------------------

router.post("/:id/stops", requireAuth, (req, res) => {
  const trip = db.findTripById(req.params.id);
  if (!trip || !canView(trip, req.user)) return res.status(404).json({ error: "Trip not found." });
  if (!canEditPlan(trip, req.user)) return res.status(403).json({ error: "Join the trip to edit the plan." });

  const title = str((req.body || {}).title, 120);
  if (!title) return res.status(400).json({ error: "Give the stop a name." });
  const existing = Array.isArray(trip.stops) ? trip.stops : [];
  const stop = {
    id: crypto.randomUUID(),
    time: str((req.body || {}).time, 10),
    title,
    place: str((req.body || {}).place, 160),
    note: str((req.body || {}).note, 300),
    done: false,
    order: existing.length, // append to the end of the manual order
  };
  const stops = [...existing, stop];
  const updated = db.updateTrip(trip.id, withActivity(trip, req.user, `added a stop: ${stop.time ? stop.time + " " : ""}${stop.title}`, { stops }));
  res.status(201).json({ trip: publicTrip(updated, req.user) });
});

router.put("/:id/stops/:stopId", requireAuth, (req, res) => {
  const trip = db.findTripById(req.params.id);
  if (!trip || !canView(trip, req.user)) return res.status(404).json({ error: "Trip not found." });
  if (!canEditPlan(trip, req.user)) return res.status(403).json({ error: "Join the trip to edit the plan." });

  let note = "edited a stop";
  const stops = (Array.isArray(trip.stops) ? trip.stops : []).map((s) => {
    if (s.id !== req.params.stopId) return s;
    if (req.body.done != null && req.body.time == null && req.body.title == null) {
      note = req.body.done ? `checked off: ${s.title}` : `un-checked: ${s.title}`;
    }
    return {
      ...s,
      time: req.body.time != null ? str(req.body.time, 10) : s.time,
      title: req.body.title != null ? str(req.body.title, 120) || s.title : s.title,
      place: req.body.place != null ? str(req.body.place, 160) : s.place,
      note: req.body.note != null ? str(req.body.note, 300) : s.note,
      done: req.body.done != null ? !!req.body.done : !!s.done,
    };
  });
  const updated = db.updateTrip(trip.id, withActivity(trip, req.user, note, { stops }));
  res.json({ trip: publicTrip(updated, req.user) });
});

// Reorder the plan: body { ids: [stopId, ...] } in the desired order.
router.put("/:id/stops-order", requireAuth, (req, res) => {
  const trip = db.findTripById(req.params.id);
  if (!trip || !canView(trip, req.user)) return res.status(404).json({ error: "Trip not found." });
  if (!canEditPlan(trip, req.user)) return res.status(403).json({ error: "Join the trip to edit the plan." });

  const ids = Array.isArray((req.body || {}).ids) ? req.body.ids : [];
  const pos = new Map(ids.map((id, i) => [id, i]));
  const stops = (Array.isArray(trip.stops) ? trip.stops : []).map((s) => ({
    ...s,
    order: pos.has(s.id) ? pos.get(s.id) : (s.order ?? 9999),
  }));
  const updated = db.updateTrip(trip.id, withActivity(trip, req.user, "reordered the plan", { stops }));
  res.json({ trip: publicTrip(updated, req.user) });
});

router.delete("/:id/stops/:stopId", requireAuth, (req, res) => {
  const trip = db.findTripById(req.params.id);
  if (!trip || !canView(trip, req.user)) return res.status(404).json({ error: "Trip not found." });
  if (!canEditPlan(trip, req.user)) return res.status(403).json({ error: "Join the trip to edit the plan." });

  const removed = (Array.isArray(trip.stops) ? trip.stops : []).find((s) => s.id === req.params.stopId);
  const stops = (Array.isArray(trip.stops) ? trip.stops : []).filter((s) => s.id !== req.params.stopId);
  const updated = db.updateTrip(trip.id, withActivity(trip, req.user, `removed a stop${removed ? ": " + removed.title : ""}`, { stops }));
  res.json({ trip: publicTrip(updated, req.user) });
});

// --- The map link (any trip member) --------------------------------------

router.put("/:id/map", requireAuth, (req, res) => {
  const trip = db.findTripById(req.params.id);
  if (!trip || !canView(trip, req.user)) return res.status(404).json({ error: "Trip not found." });
  if (!canEditPlan(trip, req.user)) return res.status(403).json({ error: "Join the trip to edit the plan." });

  let mapUrl = str((req.body || {}).mapUrl, 600);
  // Accept either a pasted Google Maps URL or a plain place name.
  if (mapUrl && !/^https?:\/\//i.test(mapUrl)) mapUrl = mapsLink(mapUrl);
  const updated = db.updateTrip(trip.id, withActivity(trip, req.user, mapUrl ? "updated the map" : "cleared the map", { mapUrl }));
  res.json({ trip: publicTrip(updated, req.user) });
});

// --- Post-trip notes / recap (any trip member) ---------------------------

// A shared write-up the crew adds after the trip wraps — highlights, what to
// do differently next time, memories worth keeping. Lives on the trip and
// shows on past-trip cards + the trip page. Editable by anyone on the trip,
// just like the plan and budget.
router.put("/:id/recap", requireAuth, (req, res) => {
  const trip = db.findTripById(req.params.id);
  if (!trip || !canView(trip, req.user)) return res.status(404).json({ error: "Trip not found." });
  if (!canEditPlan(trip, req.user)) return res.status(403).json({ error: "Join the trip to add post-trip notes." });
  const recap = str((req.body || {}).recap, 4000);
  const had = !!(trip.recap && String(trip.recap).trim());
  const note = !recap ? "cleared the post-trip notes" : had ? "updated the post-trip notes" : "added post-trip notes";
  const updated = db.updateTrip(trip.id, withActivity(trip, req.user, note, { recap }));
  res.json({ trip: publicTrip(updated, req.user) });
});

// --- Budget (any trip member can edit, like the plan) --------------------

// Update currency / split count for the trip's budget.
router.put("/:id/budget-settings", requireAuth, (req, res) => {
  const trip = db.findTripById(req.params.id);
  if (!trip || !canView(trip, req.user)) return res.status(404).json({ error: "Trip not found." });
  if (!canEditPlan(trip, req.user)) return res.status(403).json({ error: "Join the trip to edit the budget." });
  const budget = normalizeBudget({ ...normalizeBudget(trip.budget), ...(req.body || {}), items: (trip.budget || {}).items });
  const updated = db.updateTrip(trip.id, { budget });
  res.json({ trip: publicTrip(updated, req.user) });
});

// Add a budget line item.
router.post("/:id/budget", requireAuth, (req, res) => {
  const trip = db.findTripById(req.params.id);
  if (!trip || !canView(trip, req.user)) return res.status(404).json({ error: "Trip not found." });
  if (!canEditPlan(trip, req.user)) return res.status(403).json({ error: "Join the trip to edit the budget." });
  const label = str((req.body || {}).label, 80);
  if (!label) return res.status(400).json({ error: "Give the cost a name." });
  const current = normalizeBudget(trip.budget);
  const item = cleanBudgetItem({ ...(req.body || {}), label });
  const budget = { ...current, items: [...current.items, item] };
  const updated = db.updateTrip(trip.id, withActivity(trip, req.user, `added a cost: ${item.label}`, { budget }));
  res.status(201).json({ trip: publicTrip(updated, req.user) });
});

// Edit a budget line item.
router.put("/:id/budget/:itemId", requireAuth, (req, res) => {
  const trip = db.findTripById(req.params.id);
  if (!trip || !canView(trip, req.user)) return res.status(404).json({ error: "Trip not found." });
  if (!canEditPlan(trip, req.user)) return res.status(403).json({ error: "Join the trip to edit the budget." });
  const current = normalizeBudget(trip.budget);
  let found = false;
  const items = current.items.map((it) => {
    if (it.id !== req.params.itemId) return it;
    found = true;
    return cleanBudgetItem({ ...it, ...(req.body || {}), id: it.id });
  });
  if (!found) return res.status(404).json({ error: "Cost not found." });
  const updated = db.updateTrip(trip.id, { budget: { ...current, items } });
  res.json({ trip: publicTrip(updated, req.user) });
});

// Remove a budget line item.
router.delete("/:id/budget/:itemId", requireAuth, (req, res) => {
  const trip = db.findTripById(req.params.id);
  if (!trip || !canView(trip, req.user)) return res.status(404).json({ error: "Trip not found." });
  if (!canEditPlan(trip, req.user)) return res.status(403).json({ error: "Join the trip to edit the budget." });
  const current = normalizeBudget(trip.budget);
  const removed = current.items.find((it) => it.id === req.params.itemId);
  const items = current.items.filter((it) => it.id !== req.params.itemId);
  const updated = db.updateTrip(trip.id, withActivity(trip, req.user, `removed a cost${removed ? ": " + removed.label : ""}`, { budget: { ...current, items } }));
  res.json({ trip: publicTrip(updated, req.user) });
});

// --- Suggestions / proposals (ask the group) -----------------------------

// Anyone on the trip can suggest a change. It shows up for everyone as a
// pending note until the creator (or an admin) marks it done or dismisses it.
router.post("/:id/proposals", requireAuth, (req, res) => {
  const trip = db.findTripById(req.params.id);
  if (!trip || !canSee(trip, req.user)) return res.status(404).json({ error: "Trip not found." });
  if (!canAddMembers(trip, req.user)) return res.status(403).json({ error: "Join the trip to suggest changes." });

  const text = str((req.body || {}).text, 300);
  if (!text) return res.status(400).json({ error: "Write your suggestion first." });
  const proposal = { id: crypto.randomUUID(), ts: new Date().toISOString(), userId: req.user.id, userName: req.user.displayName, text, status: "open" };
  const proposals = [...(Array.isArray(trip.proposals) ? trip.proposals : []), proposal];
  const updated = db.updateTrip(trip.id, withActivity(trip, req.user, `suggested: ${text}`, { proposals }));
  res.status(201).json({ trip: publicTrip(updated, req.user) });
});

// Resolve a suggestion: "done" or "dismissed". Creator/admin only.
router.put("/:id/proposals/:pid", requireAuth, (req, res) => {
  const trip = db.findTripById(req.params.id);
  if (!trip || !canSee(trip, req.user)) return res.status(404).json({ error: "Trip not found." });
  if (!canManageTrip(trip, req.user)) return res.status(403).json({ error: "Only the trip's creator can resolve suggestions." });

  const status = ["done", "dismissed"].includes((req.body || {}).status) ? req.body.status : "dismissed";
  let resolvedText = "";
  const proposals = (Array.isArray(trip.proposals) ? trip.proposals : []).map((p) => {
    if (p.id !== req.params.pid) return p;
    resolvedText = p.text;
    return { ...p, status };
  });
  const verb = status === "done" ? "marked a suggestion done" : "dismissed a suggestion";
  const updated = db.updateTrip(trip.id, withActivity(trip, req.user, `${verb}${resolvedText ? ": " + resolvedText : ""}`, { proposals }));
  res.json({ trip: publicTrip(updated, req.user) });
});

// --- Group chat ----------------------------------------------------------

// Read the trip's chat (anyone who can see the trip).
router.get("/:id/messages", requireAuth, (req, res) => {
  const trip = db.findTripBySlug(req.params.id) || db.findTripById(req.params.id);
  const code = req.query.code || req.query.j;
  if (!trip || !canSee(trip, req.user, code)) return res.status(404).json({ error: "Trip not found." });
  res.json({ messages: (Array.isArray(trip.messages) ? trip.messages : []).slice(-100) });
});

// Post to the trip's chat (anyone on the trip).
router.post("/:id/messages", requireAuth, (req, res) => {
  const trip = db.findTripById(req.params.id);
  if (!trip) return res.status(404).json({ error: "Trip not found." });
  if (!canAddMembers(trip, req.user)) return res.status(403).json({ error: "Join the trip to chat." });
  const text = str((req.body || {}).text, 1000);
  if (!text) return res.status(400).json({ error: "Type a message first." });
  const msg = { id: crypto.randomUUID(), ts: new Date().toISOString(), userId: req.user.id, userName: req.user.displayName, text };
  // Chat doesn't spam the changelog; keep the last 500 messages.
  const messages = [...(Array.isArray(trip.messages) ? trip.messages : []), msg].slice(-500);
  const updated = db.updateTrip(trip.id, { messages });
  res.status(201).json({ messages: updated.messages.slice(-100) });
});

// Delete a chat message (author, or the trip's creator/admin).
router.delete("/:id/messages/:msgId", requireAuth, (req, res) => {
  const trip = db.findTripById(req.params.id);
  if (!trip || !canSee(trip, req.user)) return res.status(404).json({ error: "Trip not found." });
  const msg = (Array.isArray(trip.messages) ? trip.messages : []).find((m) => m.id === req.params.msgId);
  if (!msg) return res.status(404).json({ error: "Message not found." });
  if (msg.userId !== req.user.id && !canManageTrip(trip, req.user)) {
    return res.status(403).json({ error: "You can only delete your own messages." });
  }
  const messages = trip.messages.filter((m) => m.id !== req.params.msgId);
  const updated = db.updateTrip(trip.id, { messages });
  res.json({ messages: updated.messages.slice(-100) });
});

// --- Shared drive (any trip member) -----------------------------------------------

function getTripsFileDir(tripId) {
  return path.join(DATA_DIR, `trip-${tripId}`, "files");
}

// List files in the trip's shared drive (any member).
router.get("/:id/files", requireAuth, (req, res) => {
  const trip = db.findTripById(req.params.id);
  if (!trip || !isMember(trip, req.user)) {
    return res.status(404).json({ error: "Trip not found." });
  }
  const dir = getTripsFileDir(trip.id);
  try {
    const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
    res.json({ files: files.map((f) => ({ name: f })) });
  } catch {
    res.json({ files: [] });
  }
});

// Upload a file to the trip's shared drive (any member).
router.post("/:id/files", requireAuth, (req, res) => {
  const trip = db.findTripById(req.params.id);
  if (!trip || !isMember(trip, req.user)) {
    return res.status(404).json({ error: "Trip not found." });
  }
  const { filename, data } = req.body || {};
  if (!filename || !data) {
    return res.status(400).json({ error: "Filename and file data required." });
  }
  const safe = path.basename(String(filename));
  const dir = getTripsFileDir(trip.id);
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    // Data is base64-encoded; decode and write.
    const buffer = Buffer.from(String(data), "base64");
    fs.writeFileSync(path.join(dir, safe), buffer);
    res.json({ ok: true, url: `/trip-files/${trip.id}/${encodeURIComponent(safe)}` });
  } catch (err) {
    res.status(500).json({ error: "Upload failed: " + err.message });
  }
});

// Delete a file from the trip's shared drive (any member).
router.delete("/:id/files/:filename", requireAuth, (req, res) => {
  const trip = db.findTripById(req.params.id);
  if (!trip || !isMember(trip, req.user)) {
    return res.status(404).json({ error: "Trip not found." });
  }
  const safe = path.basename(String(req.params.filename));
  const dir = getTripsFileDir(trip.id);
  const file = path.join(dir, safe);
  try {
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
      res.json({ ok: true });
    } else {
      res.status(404).json({ error: "File not found." });
    }
  } catch (err) {
    res.status(500).json({ error: "Delete failed: " + err.message });
  }
});

module.exports = router;
