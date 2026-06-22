"use strict";

const crypto = require("crypto");
const db = require("./db");

// On first run (no trips yet), drop in the Toronto day trip so the board
// isn't empty. It's PRIVATE: only the owner (the first/admin account, which
// claims it on sign-up) and people given its invite link/code can join.
//
// To add more trips later: drop a new HTML page in content/trips/ and add a
// matching entry here (or create it from the Admin console). The `pageFile`
// is what gets served, behind login, at /trip/<slug>.
const SEED_TRIPS = [
  {
    slug: "toronto",
    title: "Toronto",
    subtitle: "the Yonge Street run",
    date: "2026-06-24",
    emoji: "🏙️",
    theme: "red",
    tags: ["Day trip", "Yonge St run", "Hot pot", "GO train"],
    pageFile: "toronto.html",
    shareWithEveryone: false,
  },
];

function seedIfEmpty() {
  if (db.getTrips().length > 0) return;
  const now = new Date().toISOString();
  for (const t of SEED_TRIPS) {
    db.addTrip({
      id: crypto.randomUUID(),
      slug: t.slug,
      title: t.title,
      subtitle: t.subtitle || "",
      date: t.date || "",
      emoji: t.emoji || "🚗",
      theme: t.theme || "red",
      tags: t.tags || [],
      crew: t.crew || [],
      members: [],
      pageFile: t.pageFile,
      shareWithEveryone: !!t.shareWithEveryone,
      joinCode: crypto.randomBytes(5).toString("hex"),
      allowedUsers: [],
      createdBy: null,
      createdByName: "seed",
      createdAt: now,
      updatedAt: now,
    });
  }
  console.log(`  Seeded ${SEED_TRIPS.length} starter trip(s).`);
}

// When the first account is created it becomes the admin/owner. Hand any
// ownerless seeded trips (e.g. Toronto) to them so they're "theirs" — they
// become the creator and first member.
function claimOwnerlessTrips(user) {
  for (const t of db.getTrips()) {
    if (!t.createdBy) {
      const members = Array.isArray(t.members) ? [...t.members] : [];
      if (!members.includes(user.id)) members.push(user.id);
      db.updateTrip(t.id, { createdBy: user.id, createdByName: user.displayName, members });
    }
  }
}

// One-time, idempotent cleanup for EXISTING data (people who keep their
// db.json across this upgrade). Non-destructive:
//   - an ownerless trip that was shared with everyone (the old seeded Toronto)
//     is flipped to private so new users stop seeing it. It isn't deleted and
//     ownership isn't changed — the admin still sees it and can duplicate or
//     delete it from its page;
//   - every trip without a joinCode gets one, so the crew can share an invite
//     link.
// Once applied it's a no-op (nothing left to change).
function tidyExistingTrips() {
  let changed = 0;
  for (const t of db.getTrips()) {
    const patch = {};
    if (!t.createdBy && t.shareWithEveryone) patch.shareWithEveryone = false;
    if (!t.joinCode) patch.joinCode = crypto.randomBytes(5).toString("hex");
    // Drop the old display-only "crew" name strings (people with no account):
    // membership is now real-accounts-only, so these ghosts shouldn't linger.
    if (Array.isArray(t.crew) && t.crew.length) patch.crew = [];
    if (Object.keys(patch).length) {
      db.updateTrip(t.id, patch);
      changed++;
    }
  }
  if (changed) console.log(`  Tidied ${changed} existing trip(s) for the private-link model.`);
}

module.exports = { seedIfEmpty, claimOwnerlessTrips, tidyExistingTrips };
