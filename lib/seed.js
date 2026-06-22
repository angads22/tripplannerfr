"use strict";

const crypto = require("crypto");
const db = require("./db");

// Helpers to build rich seed data with proper ids.
function makeStops(list) {
  return list.map((s, i) => ({
    id: crypto.randomUUID(),
    time: s.time || "",
    title: s.title,
    place: s.place || "",
    note: s.note || "",
    done: false,
    order: i,
  }));
}
function makeBudget(currency, splitCount, items) {
  return {
    currency,
    splitCount: splitCount || 0,
    items: items.map((it) => ({
      id: crypto.randomUUID(),
      label: it.label,
      amount: it.amount,
      kind: it.kind === "group" ? "group" : "person",
      category: it.category || "other",
    })),
  };
}

// Toronto's estimated day-trip budget (mostly per-person — it's a day out).
const TORONTO_BUDGET = makeBudget("$", 0, [
  { label: "GO Train round trip", amount: 20, kind: "person", category: "transport" },
  { label: "Gyukatsu lunch", amount: 30, kind: "person", category: "food" },
  { label: "Souper hot pot dinner", amount: 35, kind: "person", category: "food" },
  { label: "Snacks, bingsu & arcade", amount: 25, kind: "person", category: "food" },
  { label: "Shopping money", amount: 50, kind: "person", category: "other" },
]);

// A ready-to-share Japan summer 2027 trip, fully planned with a budget so the
// admin can hand it to friends and everyone can see what it'll cost.
const JAPAN_2027 = {
  slug: "japan-2027",
  title: "Japan 2027",
  subtitle: "summer — Tokyo · Kyoto · Osaka",
  date: "2027-07-10",
  emoji: "🗾",
  theme: "pink",
  vibe: "vivid",
  tags: ["Japan", "Summer 2027", "9 days", "Bucket list"],
  description:
    "Nine days across Japan in peak summer — Tokyo's neon, Kyoto's temples, Osaka's street food. Budget below is a per-person estimate so everyone can plan ahead; accommodation is a shared cost split across the crew. Lock in flights early — summer fares climb fast.",
  stops: makeStops([
    { time: "15:00", title: "Day 1 · Land in Tokyo", note: "Arrive at Narita/Haneda, grab a Suica/Welcome card, and take the train into the city. Drop bags at the hotel." },
    { time: "19:00", title: "Day 1 · Shinjuku neon + first ramen", place: "Shinjuku, Tokyo", note: "Ease into the time zone with a walk through Kabukicho and Omoide Yokocho. Early night — jet lag is real." },
    { time: "09:00", title: "Day 2 · Senso-ji & Asakusa", place: "Senso-ji, Tokyo", note: "Tokyo's oldest temple, then street snacks down Nakamise. Cheap and iconic." },
    { time: "14:00", title: "Day 2 · Akihabara", place: "Akihabara, Tokyo", note: "Arcades, anime, electronics. Claw machines and retro game floors." },
    { time: "10:00", title: "Day 3 · teamLab + Odaiba", place: "teamLab Planets, Tokyo", note: "Book the digital art museum in advance — it sells out. Bayfront views after." },
    { time: "18:00", title: "Day 3 · Shibuya crossing & izakaya", place: "Shibuya Crossing, Tokyo", note: "The famous scramble, then a group izakaya dinner — order lots of small plates." },
    { time: "08:00", title: "Day 4 · Mt. Fuji / Hakone day trip", place: "Hakone, Japan", note: "Use the rail pass. Lake Ashi, ropeway, onsen town. Clearest Fuji views are early." },
    { time: "10:00", title: "Day 5 · Shinkansen to Kyoto", place: "Kyoto Station", note: "~2.5h bullet train. Grab an ekiben (station bento) for the ride." },
    { time: "18:30", title: "Day 5 · Fushimi Inari at dusk", place: "Fushimi Inari Taisha, Kyoto", note: "The thousand torii gates — go late to beat crowds and heat." },
    { time: "09:00", title: "Day 6 · Arashiyama & Kinkaku-ji", place: "Arashiyama Bamboo Grove, Kyoto", note: "Bamboo grove early, then the Golden Pavilion. Bring water — summer is humid." },
    { time: "19:00", title: "Day 6 · Gion & Pontocho", place: "Gion, Kyoto", note: "Old streets, lantern-lit riverside dining. Keep an eye out for geiko." },
    { time: "09:30", title: "Day 7 · Nara day trip", place: "Nara Park", note: "Bowing deer and the giant Todai-ji Buddha. Easy train from Kyoto." },
    { time: "12:00", title: "Day 8 · Osaka — Dotonbori", place: "Dotonbori, Osaka", note: "Street food capital: takoyaki, okonomiyaki, the Glico sign. Come hungry." },
    { time: "18:00", title: "Day 8 · Optional: Universal Studios Japan", place: "Universal Studios Japan", note: "Super Nintendo World — book Express passes if you go. Skip if you'd rather wander." },
    { time: "10:00", title: "Day 9 · Last morning + fly home", note: "Last-minute souvenirs and one final konbini run, then head to the airport." },
  ]),
  budget: makeBudget("$", 4, [
    { label: "Round-trip flights", amount: 1700, kind: "person", category: "transport" },
    { label: "9 nights accommodation", amount: 2700, kind: "group", category: "stay" },
    { label: "JR Rail Pass (7-day)", amount: 350, kind: "person", category: "transport" },
    { label: "Local transit (Suica top-ups)", amount: 120, kind: "person", category: "transport" },
    { label: "Food & drinks (~9 days)", amount: 650, kind: "person", category: "food" },
    { label: "Attractions (teamLab, USJ, temples)", amount: 450, kind: "person", category: "fun" },
    { label: "Shopping / pocket money", amount: 600, kind: "person", category: "other" },
  ]),
};

// On first run (no trips yet), drop in the starter trips so the board isn't
// empty. They're PRIVATE: only the owner (the first/admin account, which claims
// them on sign-up) and people given an invite link/code can join.
//
// To add more trips later: drop a new HTML page in content/trips/ and add a
// matching entry here (or create it from the Admin console). A `pageFile` is
// served, behind login, at /trip/<slug>; trips without one use the editable
// generic page.
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
    budget: TORONTO_BUDGET,
  },
];

function buildTrip(t) {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    slug: t.slug,
    title: t.title,
    subtitle: t.subtitle || "",
    date: t.date || "",
    emoji: t.emoji || "🚗",
    theme: t.theme || "red",
    vibe: t.vibe || "classic",
    tags: t.tags || [],
    crew: t.crew || [],
    members: [],
    stops: t.stops || [],
    budget: t.budget || { currency: "$", splitCount: 0, items: [] },
    description: t.description || "",
    pageFile: t.pageFile || "",
    shareWithEveryone: !!t.shareWithEveryone,
    joinCode: crypto.randomBytes(5).toString("hex"),
    allowedUsers: [],
    activity: [],
    proposals: [],
    mapUrl: "",
    createdBy: null,
    createdByName: "seed",
    createdAt: now,
    updatedAt: now,
  };
}

function seedIfEmpty() {
  if (db.getTrips().length > 0) return;
  for (const t of SEED_TRIPS) db.addTrip(buildTrip(t));
  // The planned, shareable trip(s) ship for everyone (claimed by the admin).
  db.addTrip(buildTrip(JAPAN_2027));
  console.log(`  Seeded ${SEED_TRIPS.length + 1} starter trip(s).`);
}

// When the first account is created it becomes the admin/owner. Hand any
// ownerless seeded trips (Toronto, Japan) to them so they're "theirs" — they
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
// db.json across upgrades). Non-destructive.
function tidyExistingTrips() {
  let changed = 0;
  for (const t of db.getTrips()) {
    const patch = {};
    if (!t.createdBy && t.shareWithEveryone) patch.shareWithEveryone = false;
    if (!t.joinCode) patch.joinCode = crypto.randomBytes(5).toString("hex");
    if (Array.isArray(t.crew) && t.crew.length) patch.crew = [];
    if (Object.keys(patch).length) {
      db.updateTrip(t.id, patch);
      changed++;
    }
  }
  if (changed) console.log(`  Tidied ${changed} existing trip(s) for the private-link model.`);
}

// Idempotent: make sure the planned content exists even on an install that was
// created before these trips/budgets were added. Runs every startup; no-ops
// once everything's present.
//  - Adds the Japan 2027 trip if it's missing, owned by the existing admin (or
//    left ownerless to be claimed by the first account on a fresh install).
//  - Backfills Toronto's estimated budget if it doesn't have one yet.
function ensurePlannedContent() {
  const trips = db.getTrips();
  const admin = db.getUsers().filter((u) => u.isAdmin).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))[0] || null;

  if (!trips.some((t) => t.slug === "japan-2027")) {
    const japan = buildTrip(JAPAN_2027);
    if (admin) {
      japan.createdBy = admin.id;
      japan.createdByName = admin.displayName;
      japan.members = [admin.id];
    }
    db.addTrip(japan);
    console.log(`  Added the planned Japan 2027 trip${admin ? ` (owner: @${admin.username})` : ""}.`);
  }

  const toronto = db.getTrips().find((t) => t.slug === "toronto");
  if (toronto && (!toronto.budget || !Array.isArray(toronto.budget.items) || toronto.budget.items.length === 0)) {
    db.updateTrip(toronto.id, { budget: TORONTO_BUDGET });
    console.log("  Backfilled Toronto's estimated budget.");
  }
}

module.exports = { seedIfEmpty, claimOwnerlessTrips, tidyExistingTrips, ensurePlannedContent, TORONTO_BUDGET };
