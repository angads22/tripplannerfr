"use strict";

const crypto = require("crypto");
const db = require("./db");

// On first run (no trips yet), drop in the Toronto day trip so the board
// isn't empty. It's shared with everyone by default; the admin can restrict
// access from the console at any time.
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
    tags: ["Day trip", "Yonge St run", "Hot pot", "GO train"],
    crew: ["You", "Yareem", "Noah", "Cynthia", "Luvena"],
    pageFile: "toronto.html",
    shareWithEveryone: true,
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
      emoji: t.emoji || "✈️",
      tags: t.tags || [],
      crew: t.crew || [],
      pageFile: t.pageFile,
      shareWithEveryone: !!t.shareWithEveryone,
      allowedUsers: [],
      createdBy: null,
      createdByName: "seed",
      createdAt: now,
      updatedAt: now,
    });
  }
  console.log(`  Seeded ${SEED_TRIPS.length} starter trip(s).`);
}

module.exports = { seedIfEmpty };
