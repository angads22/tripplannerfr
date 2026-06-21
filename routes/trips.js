"use strict";

// Trips are itineraries (a structured page built in-app) wrapped with access
// control. Anyone logged in sees the trips shared with them; admins manage the
// trips and who can see each one. Members invited to a trip can suggest changes
// (change requests); admins can elevate a member to "editor" so they edit
// directly without needing approval. Legacy trips can still point at a custom
// HTML page in content/trips/ via pageFile.

const express = require("express");
const crypto = require("crypto");
const db = require("../lib/db");
const { requireAuth, requireAdmin, canView, canEdit } = require("../lib/auth-middleware");

const router = express.Router();

const str = (v, max = 2000) => String(v == null ? "" : v).slice(0, max).trim();
const slugify = (v) =>
  str(v, 80).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || crypto.randomUUID();
const uniqIds = (arr) =>
  [...new Set((Array.isArray(arr) ? arr : []).map((x) => str(x, 60)).filter(Boolean))];

// Only allow real web links through — never javascript:/data: etc.
const safeUrl = (v) => {
  const s = str(v, 500);
  return /^https?:\/\//i.test(s) ? s : "";
};

// How you get from the previous stop to this one. Unknown modes drop to "".
const TRAVEL_MODES = new Set(["walk", "transit", "train", "bus", "drive", "bike", "ferry"]);
const travelMode = (v) => {
  const m = str(v, 20).toLowerCase();
  return TRAVEL_MODES.has(m) ? m : "";
};
function normalizeTravel(travel) {
  const t = travel && typeof travel === "object" ? travel : {};
  const mode = travelMode(t.mode);
  // Minutes for this leg (auto-estimated client-side, or typed). Accept the
  // legacy free-text `duration` ("12 min") from earlier builds too.
  let durationMin = parseInt(t.durationMin, 10);
  if (!Number.isFinite(durationMin)) durationMin = parseInt(t.duration, 10);
  durationMin = Number.isFinite(durationMin) ? Math.min(Math.max(durationMin, 0), 1440) : 0;
  const detail = str(t.detail, 120);
  const leaveTime = str(t.leaveTime, 20); // when you depart the previous stop
  return mode || durationMin || detail || leaveTime ? { mode, durationMin, detail, leaveTime } : null;
}

// A finite coordinate within range, or null.
const coord = (v, max) => {
  const n = Number(v);
  return Number.isFinite(n) && Math.abs(n) <= max ? n : null;
};

// Keyless Google Maps search link for a place name/address.
const mapsSearchUrl = (q) => {
  const s = str(q, 200);
  return s ? "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(s) : "";
};

// Coerce whatever the editor sends into a clean, size-capped itinerary. This is
// the single source of truth for trip content shape (used on create, edit, and
// when approving a change request), so stored data can never blow up the file
// store or smuggle in HTML — the frontend renders every field with escaping.
function normalizeContent(content) {
  const c = content && typeof content === "object" ? content : {};
  const days = (Array.isArray(c.days) ? c.days : []).slice(0, 30).map((d) => {
    const day = d && typeof d === "object" ? d : {};
    return {
      id: str(day.id, 40) || crypto.randomUUID(),
      label: str(day.label, 120),
      note: str(day.note, 1000),
      stops: (Array.isArray(day.stops) ? day.stops : []).slice(0, 40).map((s) => {
        const stop = s && typeof s === "object" ? s : {};
        const name = str(stop.name, 160);
        const location = str(stop.location, 200);
        return {
          id: str(stop.id, 40) || crypto.randomUUID(),
          time: str(stop.time, 20),
          name,
          category: str(stop.category, 40),
          location,
          // Fall back to a keyless Google Maps search link if none was given.
          locationUrl: safeUrl(stop.locationUrl) || mapsSearchUrl(location || name),
          // Cached geocode (set by the builder) — speeds re-estimates and gives
          // the map a precise pin.
          lat: coord(stop.lat, 90),
          lon: coord(stop.lon, 180),
          hours: str(stop.hours, 120),
          notes: str(stop.notes, 2000),
          tip: str(stop.tip, 500),
          travel: normalizeTravel(stop.travel),
        };
      }),
    };
  });
  return {
    overview: str(c.overview, 5000),
    crew: (Array.isArray(c.crew) ? c.crew : []).map((x) => str(x, 60)).filter(Boolean).slice(0, 20),
    days,
  };
}

// Fields any editor (admin, creator, or elevated member) may change.
function normalizeTripInput(body) {
  return {
    title: str(body.title, 120) || "Untitled trip",
    subtitle: str(body.subtitle, 200),
    date: str(body.date, 20),
    emoji: str(body.emoji, 8) || "✈️",
    tags: (Array.isArray(body.tags) ? body.tags : [])
      .map((x) => str(x, 40))
      .filter(Boolean)
      .slice(0, 8),
    content: normalizeContent(body.content),
  };
}

// Sharing + editor elevation — admin-only fields.
function normalizeAccessInput(body) {
  return {
    shareWithEveryone: !!body.shareWithEveryone,
    allowedUsers: uniqIds(body.allowedUsers),
    editorUsers: uniqIds(body.editorUsers),
  };
}

// What the board/page needs to draw a trip. Never leaks who-can-see or the
// editor list to non-admins.
function publicTrip(t, user) {
  const base = {
    id: t.id,
    slug: t.slug,
    title: t.title,
    subtitle: t.subtitle || "",
    date: t.date || "",
    emoji: t.emoji || "✈️",
    tags: t.tags || [],
    hasPage: !!t.pageFile,
    content: t.content || null,
    canEdit: canEdit(t, user),
  };
  if (user && user.isAdmin) {
    base.shareWithEveryone = !!t.shareWithEveryone;
    base.allowedUsers = t.allowedUsers || [];
    base.editorUsers = t.editorUsers || [];
    base.pageFile = t.pageFile || "";
    base.pendingRequestCount = db
      .getRequestsForTrip(t.id)
      .filter((r) => r.status === "pending").length;
  }
  return base;
}

function publicRequest(r) {
  return {
    id: r.id,
    tripId: r.tripId,
    tripTitle: r.tripTitle || "",
    userId: r.userId,
    userName: r.userName || "",
    createdAt: r.createdAt || "",
    status: r.status || "pending",
    proposedContent: r.proposedContent || null,
    message: r.message || "",
    reviewedByName: r.reviewedByName || "",
    reviewedAt: r.reviewedAt || null,
  };
}

// --- Member-facing -------------------------------------------------------

// List only the trips this user is allowed to see (soonest first).
router.get("/", requireAuth, (req, res) => {
  const trips = db
    .getTrips()
    .filter((t) => canView(t, req.user))
    .sort((a, b) => (a.date || a.createdAt || "").localeCompare(b.date || b.createdAt || ""))
    .map((t) => publicTrip(t, req.user));
  res.json({ trips });
});

// The review queue: pending suggestions for any trip this user can edit.
// NOTE: must be declared before "/:id" so the literal path wins.
router.get("/requests", requireAuth, (req, res) => {
  const requests = db
    .getRequests()
    .filter((r) => r.status === "pending")
    .filter((r) => {
      const trip = db.findTripById(r.tripId);
      return trip && canEdit(trip, req.user);
    })
    .sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""))
    .map(publicRequest);
  res.json({ requests });
});

router.get("/:id", requireAuth, (req, res) => {
  const trip = db.findTripById(req.params.id) || db.findTripBySlug(req.params.id);
  if (!trip || !canView(trip, req.user)) {
    return res.status(404).json({ error: "Trip not found." });
  }
  res.json({ trip: publicTrip(trip, req.user) });
});

// --- Suggestions (members who can view but not edit) ---------------------

router.post("/:id/requests", requireAuth, (req, res) => {
  const trip = db.findTripById(req.params.id) || db.findTripBySlug(req.params.id);
  if (!trip || !canView(trip, req.user)) {
    return res.status(404).json({ error: "Trip not found." });
  }
  const now = new Date().toISOString();
  const request = db.addRequest({
    id: crypto.randomUUID(),
    tripId: trip.id,
    tripTitle: trip.title,
    userId: req.user.id,
    userName: req.user.displayName,
    createdAt: now,
    status: "pending",
    proposedContent: normalizeContent(req.body && req.body.content),
    message: str(req.body && req.body.message, 1000),
    reviewedBy: null,
    reviewedByName: "",
    reviewedAt: null,
  });
  res.status(201).json({ request: publicRequest(request) });
});

// --- Review a suggestion (admin / editor) --------------------------------

function reviewRequest(req, res, approve) {
  const request = db.findRequestById(req.params.reqId);
  if (!request) return res.status(404).json({ error: "Request not found." });
  const trip = db.findTripById(request.tripId);
  if (!trip) {
    db.deleteRequest(request.id);
    return res.status(404).json({ error: "That trip no longer exists." });
  }
  if (!canEdit(trip, req.user)) return res.status(403).json({ error: "Admins only." });
  if (request.status !== "pending") {
    return res.status(409).json({ error: "This suggestion was already reviewed." });
  }
  if (approve) {
    db.updateTrip(trip.id, { content: normalizeContent(request.proposedContent) });
  }
  const updated = db.updateRequest(request.id, {
    status: approve ? "approved" : "rejected",
    reviewedBy: req.user.id,
    reviewedByName: req.user.displayName,
    reviewedAt: new Date().toISOString(),
  });
  res.json({ request: publicRequest(updated) });
}

router.post("/requests/:reqId/approve", requireAuth, (req, res) => reviewRequest(req, res, true));
router.post("/requests/:reqId/reject", requireAuth, (req, res) => reviewRequest(req, res, false));

// --- Admin: create / edit / share / delete -------------------------------

router.post("/", requireAdmin, (req, res) => {
  const input = normalizeTripInput(req.body || {});
  const access = normalizeAccessInput(req.body || {});
  const now = new Date().toISOString();
  const slug = str(req.body.slug, 80) ? slugify(req.body.slug) : slugify(input.title);
  if (db.findTripBySlug(slug)) {
    return res.status(409).json({ error: `A trip with the slug "${slug}" already exists.` });
  }
  const trip = db.addTrip({
    id: crypto.randomUUID(),
    slug,
    ...input,
    ...access,
    pageFile: str(req.body.pageFile, 120),
    createdBy: req.user.id,
    createdByName: req.user.displayName,
    createdAt: now,
    updatedAt: now,
  });
  res.status(201).json({ trip: publicTrip(trip, req.user) });
});

// Edit the trip's content + metadata. Allowed for anyone who can edit (admin,
// creator, or an elevated member); everyone else must use /requests instead.
router.put("/:id", requireAuth, (req, res) => {
  const existing = db.findTripById(req.params.id);
  if (!existing) return res.status(404).json({ error: "Trip not found." });
  if (!canEdit(existing, req.user)) {
    return res.status(403).json({ error: "You can only suggest changes to this trip." });
  }
  const patch = normalizeTripInput({ ...existing, ...req.body });
  // Only admins may repoint the legacy custom HTML page.
  if (req.user.isAdmin && req.body.pageFile !== undefined) {
    patch.pageFile = str(req.body.pageFile, 120);
  }
  const updated = db.updateTrip(existing.id, patch);
  res.json({ trip: publicTrip(updated, req.user) });
});

// Manage who can see a trip and who can edit it without touching its content.
router.put("/:id/access", requireAdmin, (req, res) => {
  const existing = db.findTripById(req.params.id);
  if (!existing) return res.status(404).json({ error: "Trip not found." });
  const updated = db.updateTrip(existing.id, normalizeAccessInput({ ...existing, ...req.body }));
  res.json({ trip: publicTrip(updated, req.user) });
});

router.delete("/:id", requireAdmin, (req, res) => {
  const existing = db.findTripById(req.params.id);
  if (!existing) return res.status(404).json({ error: "Trip not found." });
  db.deleteTrip(existing.id);
  res.json({ ok: true });
});

module.exports = router;
