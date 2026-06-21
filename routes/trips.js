"use strict";

// Trips are rich pages (an HTML file in content/trips/) wrapped with access
// control. Anyone logged in sees the trips shared with them; admins manage
// the trips themselves and who can see each one.

const express = require("express");
const crypto = require("crypto");
const db = require("../lib/db");
const { requireAuth, requireAdmin, canView } = require("../lib/auth-middleware");

const router = express.Router();

const str = (v, max = 2000) => String(v == null ? "" : v).slice(0, max).trim();
const slugify = (v) =>
  str(v, 80).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || crypto.randomUUID();

// What the board needs to draw a card. Never leaks who-can-see to non-admins.
function publicTrip(t, user) {
  const base = {
    id: t.id,
    slug: t.slug,
    title: t.title,
    subtitle: t.subtitle || "",
    date: t.date || "",
    emoji: t.emoji || "✈️",
    tags: t.tags || [],
    crew: t.crew || [],
    hasPage: !!t.pageFile,
  };
  if (user && user.isAdmin) {
    base.shareWithEveryone = !!t.shareWithEveryone;
    base.allowedUsers = t.allowedUsers || [];
    base.pageFile = t.pageFile || "";
  }
  return base;
}

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
    crew: (Array.isArray(body.crew) ? body.crew : [])
      .map((x) => str(x, 40))
      .filter(Boolean)
      .slice(0, 20),
    pageFile: str(body.pageFile, 120),
    shareWithEveryone: !!body.shareWithEveryone,
    allowedUsers: [...new Set((Array.isArray(body.allowedUsers) ? body.allowedUsers : []).map((x) => str(x, 60)).filter(Boolean))],
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

router.get("/:id", requireAuth, (req, res) => {
  const trip = db.findTripById(req.params.id);
  if (!trip || !canView(trip, req.user)) {
    return res.status(404).json({ error: "Trip not found." });
  }
  res.json({ trip: publicTrip(trip, req.user) });
});

// --- Admin: create / edit / share / delete -------------------------------

router.post("/", requireAdmin, (req, res) => {
  const input = normalizeTripInput(req.body || {});
  const now = new Date().toISOString();
  const slug = str(req.body.slug, 80) ? slugify(req.body.slug) : slugify(input.title);
  if (db.findTripBySlug(slug)) {
    return res.status(409).json({ error: `A trip with the slug "${slug}" already exists.` });
  }
  const trip = db.addTrip({
    id: crypto.randomUUID(),
    slug,
    ...input,
    createdBy: req.user.id,
    createdByName: req.user.displayName,
    createdAt: now,
    updatedAt: now,
  });
  res.status(201).json({ trip: publicTrip(trip, req.user) });
});

router.put("/:id", requireAdmin, (req, res) => {
  const existing = db.findTripById(req.params.id);
  if (!existing) return res.status(404).json({ error: "Trip not found." });
  const input = normalizeTripInput({ ...existing, ...req.body });
  const updated = db.updateTrip(existing.id, input);
  res.json({ trip: publicTrip(updated, req.user) });
});

// Manage who can see a trip without touching the rest of it.
router.put("/:id/access", requireAdmin, (req, res) => {
  const existing = db.findTripById(req.params.id);
  if (!existing) return res.status(404).json({ error: "Trip not found." });
  const { shareWithEveryone, allowedUsers } = req.body || {};
  const updated = db.updateTrip(existing.id, {
    shareWithEveryone: !!shareWithEveryone,
    allowedUsers: [...new Set((Array.isArray(allowedUsers) ? allowedUsers : []).map((x) => str(x, 60)).filter(Boolean))],
  });
  res.json({ trip: publicTrip(updated, req.user) });
});

router.delete("/:id", requireAdmin, (req, res) => {
  const existing = db.findTripById(req.params.id);
  if (!existing) return res.status(404).json({ error: "Trip not found." });
  db.deleteTrip(existing.id);
  res.json({ ok: true });
});

module.exports = router;
