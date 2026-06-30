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
function makePacking(list) {
  return list.map((p) => ({
    id: crypto.randomUUID(),
    label: typeof p === "string" ? p : p.label,
    done: typeof p === "string" ? false : !!p.done,
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
  packing: makePacking([
    { label: "Passport + JR Pass voucher", done: true },
    "Pocket wifi / travel eSIM",
    "Comfortable walking shoes",
    "Portable charger",
    "Light layers (summer is humid)",
    "Cash — Japan still loves it",
  ]),
};

// A ready-to-share Cancún summer 2027 trip — beaches, ruins, and cenotes on the
// Yucatán. Fully planned with a per-person budget (the villa is a shared cost
// split across the crew) so the admin can hand it to friends and everyone can
// see the damage up front.
const CANCUN_2027 = {
  slug: "cancun-2027",
  title: "Cancún 2027",
  subtitle: "summer — beaches · ruins · cenotes",
  date: "2027-06-12",
  emoji: "🏝️",
  theme: "teal",
  vibe: "vivid",
  tags: ["Mexico", "Summer 2027", "6 days", "Beach"],
  description:
    "Six days on the Yucatán — turquoise water and beach days in Cancún, the ruins at Chichén Itzá and Tulum, plus cenote swims and an Isla Mujeres catamaran day. Budget below is a per-person estimate so everyone can plan ahead; the beachfront villa is a shared cost split across the crew. Book flights and the villa early — summer fills up.",
  stops: makeStops([
    { time: "14:00", title: "Day 1 · Land in Cancún", place: "Cancún International Airport", note: "Clear customs, grab pesos / a SIM, and take the pre-booked transfer to the villa. Don't get pulled into a timeshare 'tour' booth at arrivals." },
    { time: "19:00", title: "Day 1 · Hotel Zone dinner + first beach walk", place: "Zona Hotelera, Cancún", note: "Ease in with tacos al pastor and a sunset walk on the sand. Early-ish night — travel day." },
    { time: "10:00", title: "Day 2 · Beach + pool reset", place: "Playa Delfines, Cancún", note: "Full beach day at Playa Delfines (the big CANCÚN sign). Bring reef-safe sunscreen — it's required at the cenotes/parks anyway." },
    { time: "07:30", title: "Day 3 · Chichén Itzá day trip", place: "Chichén Itzá", note: "Leave early to beat the heat and crowds at El Castillo. Most tours fold in a cenote swim + lunch on the way back." },
    { time: "09:00", title: "Day 4 · Tulum ruins + cenotes", place: "Tulum", note: "Cliffside Mayan ruins over the Caribbean, then cool off at Gran Cenote or Dos Ojos. Snorkel gear pays for itself here." },
    { time: "09:30", title: "Day 5 · Isla Mujeres catamaran", place: "Isla Mujeres", note: "Catamaran out to the island — snorkel stop, open bar, beach club time at Playa Norte. The signature group day." },
    { time: "20:00", title: "Day 5 · Night out (optional)", place: "Coco Bongo, Cancún", note: "Coco Bongo show or a quieter rooftop — crew's call. Skippable if everyone's sun-fried." },
    { time: "11:00", title: "Day 6 · Last beach morning + fly home", note: "One more swim, pack up, last-minute souvenirs, then the transfer back to the airport." },
  ]),
  budget: makeBudget("$", 4, [
    { label: "Round-trip flights", amount: 550, kind: "person", category: "transport" },
    { label: "6 nights beachfront villa", amount: 2400, kind: "group", category: "stay" },
    { label: "Airport + day-trip transfers", amount: 160, kind: "group", category: "transport" },
    { label: "Chichén Itzá tour", amount: 90, kind: "person", category: "fun" },
    { label: "Tulum + cenotes day", amount: 80, kind: "person", category: "fun" },
    { label: "Isla Mujeres catamaran", amount: 110, kind: "person", category: "fun" },
    { label: "Food & drinks (~6 days)", amount: 350, kind: "person", category: "food" },
    { label: "Nightlife / pocket money", amount: 250, kind: "person", category: "other" },
  ]),
  packing: makePacking([
    { label: "Passport", done: true },
    "Reef-safe sunscreen (required at cenotes)",
    "Swimsuit + quick-dry towel",
    "Snorkel gear",
    "Sandals + water shoes",
    "Pesos for tips & taxis",
    "Aloe / after-sun",
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
    packing: makePacking([
      { label: "Presto / transit card", done: true },
      "Portable charger",
      "Reusable water bottle",
      "Cash for hot pot",
      "Layers — it gets windy by the lake",
    ]),
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
    packing: t.packing || [],
    rsvps: t.rsvps || {},
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
  db.addTrip(buildTrip(CANCUN_2027));
  console.log(`  Seeded ${SEED_TRIPS.length + 2} starter trip(s).`);
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

  // Add a planned trip if it's missing, owned by the existing admin (or left
  // ownerless on a fresh install, to be claimed by the first account).
  const ensureTrip = (template, label) => {
    if (db.getTrips().some((t) => t.slug === template.slug)) return;
    const trip = buildTrip(template);
    if (admin) {
      trip.createdBy = admin.id;
      trip.createdByName = admin.displayName;
      trip.members = [admin.id];
    }
    db.addTrip(trip);
    console.log(`  Added the planned ${label} trip${admin ? ` (owner: @${admin.username})` : ""}.`);
  };
  ensureTrip(JAPAN_2027, "Japan 2027");
  ensureTrip(CANCUN_2027, "Cancún 2027");

  const toronto = db.getTrips().find((t) => t.slug === "toronto");
  if (toronto && (!toronto.budget || !Array.isArray(toronto.budget.items) || toronto.budget.items.length === 0)) {
    db.updateTrip(toronto.id, { budget: TORONTO_BUDGET });
    console.log("  Backfilled Toronto's estimated budget.");
  }
}

module.exports = { seedIfEmpty, claimOwnerlessTrips, tidyExistingTrips, ensurePlannedContent, TORONTO_BUDGET };
