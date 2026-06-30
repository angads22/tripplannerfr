"use strict";

const $ = (s, r = document) => r.querySelector(s);

function toast(msg, isErr) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.toggle("err", !!isErr);
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2600);
}

async function api(path, method, body) {
  const res = await fetch(path, {
    method: method || "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    location.href = "/login.html?next=" + encodeURIComponent(location.pathname);
    throw new Error("redirecting");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function initials(name) {
  return (name || "?").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
}

// Avatar palette from the Pitstop tokens.
const AV_COLORS = ["#E23B26", "#2D6CA2", "#3E8E5A", "#F4B528", "#1C1815", "#C8741C"];
function avatarColor(seed) {
  let h = 0;
  for (const ch of String(seed || "")) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AV_COLORS[h % AV_COLORS.length];
}

// Countdown -> { label, cls } matching the design's pill states.
function countdown(dateStr) {
  if (!dateStr) return { label: "someday", cls: "past" };
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return { label: "someday", cls: "past" };
  const trip = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((trip - today) / 86400000);
  if (days > 1) return { label: `in ${days} days`, cls: "soon" };
  if (days === 1) return { label: "tomorrow", cls: "soon" };
  if (days === 0) return { label: "today!", cls: "today" };
  return { label: "wrapped", cls: "past" };
}

function fmtDate(dateStr) {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y) return dateStr;
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }).toUpperCase();
}

// True only when the trip has a real date that's already gone by (strictly
// before today). No date = "someday" = still upcoming, never past.
function isPastDate(dateStr) {
  if (!dateStr) return false;
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(y, m - 1, d) < today;
}

// "09:30" -> "9:30a". Leaves anything that isn't HH:MM untouched.
function fmtTime(t) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || "").trim());
  if (!m) return esc(t || "");
  let h = +m[1];
  const ap = h >= 12 ? "p" : "a";
  h = h % 12 || 12;
  return h + ":" + m[2] + ap;
}

// Trim long text to n chars with an ellipsis (so recap rows stay one-liners).
function clip(s, n) {
  s = String(s == null ? "" : s);
  return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s;
}

// --- Board state (filter / sort / pin) + small mobile helpers --------------
let ME = null;
let ALL_TRIPS = [];
let QUERY = "";
let SORT = "soon"; // soon | late | added

// Subtle haptic tick on supported devices (mobile). No-op everywhere else.
function haptic(ms) {
  try { if (navigator.vibrate) navigator.vibrate(ms || 8); } catch { /* unsupported */ }
}

// Rotating greeting: time-of-day aware, with general + funny lines for variety.
// A fresh one is picked on every board load.
function pickGreeting(name) {
  const n = name || "there";
  const h = new Date().getHours();
  const timed =
    h >= 5 && h < 12 ? [`Morning, ${n} ☕`, `Rise and road-trip, ${n}.`, `Early start, ${n}? where to?`]
    : h >= 12 && h < 17 ? [`Afternoon, ${n} — where to next?`, `Hey ${n}, beating the afternoon slump?`, `Midday plotting, ${n}?`]
    : h >= 17 && h < 22 ? [`Evening, ${n} — plotting an escape?`, `Hey ${n}, where to tonight?`, `Good evening, ${n}. let's go somewhere.`]
    : [`Can't sleep, ${n}? plan something.`, `Burning the midnight oil, ${n}?`, `Late one, ${n} — dream up a trip.`];
  const always = [`Hey ${n}, where to next?`, `Where to, ${n}?`, `${n}, the map's wide open.`, `Welcome back, ${n}.`];
  const funny = [`${n}, gas, snacks, chaos?`, `shotgun's calling, ${n}.`, `${n}, let's get outta here.`, `pack a bag, ${n}.`, `${n}, adventure won't plan itself.`, `wheels up, ${n}?`];
  const pool = timed.concat(always, funny);
  return pool[Math.floor(Math.random() * pool.length)];
}

// Pinned trips float to the top of the board. Saved per-user, per-device.
function pinsKey() { return "pitstop:pins:" + (ME && ME.id ? ME.id : "anon"); }
function getPins() {
  try { return new Set(JSON.parse(localStorage.getItem(pinsKey()) || "[]")); } catch { return new Set(); }
}
function togglePin(id) {
  const pins = getPins();
  if (pins.has(id)) pins.delete(id); else pins.add(id);
  try { localStorage.setItem(pinsKey(), JSON.stringify([...pins])); } catch { /* storage full/blocked */ }
}

// Placeholder shimmer cards shown while the board loads / refreshes.
function skeletonCards(n) {
  let out = "";
  for (let i = 0; i < n; i++) out += '<div class="trip-skel" aria-hidden="true"></div>';
  return out;
}

const TILTS = ["-1.4deg", "1deg", "-0.7deg", "1.3deg", "-1.1deg", "0.8deg"];

function crewStack(members) {
  if (!members || !members.length) return "";
  const faces = members.slice(0, 5).map((c) => {
    const name = (c && (c.displayName || c.name)) || c || "?";
    if (c && c.avatarImage) {
      return `<span class="crew__face" style="background:url('${c.avatarImage}') center/cover no-repeat" title="${esc(name)}"></span>`;
    }
    const color = (c && c.avatarColor) || avatarColor(name);
    const face = (c && c.avatarEmoji) || esc(initials(name));
    return `<span class="crew__face" style="background:${color}" title="${esc(name)}">${face}</span>`;
  }).join("");
  const n = members.length;
  return `<div class="crew"><div class="crew__stack">${faces}</div><span class="crew__count">${n} going</span></div>`;
}

// A theme is either a keyword (data-theme) or a custom #hex (inline --accent).
function themeAttrs(theme) {
  const t = theme || "red";
  if (t.charAt(0) === "#") return `data-theme="custom" style="--accent:${esc(t)};`;
  return `data-theme="${esc(t)}" style="`;
}

// A recap strip for past-trip cards: the itinerary's times + locations + notes
// (a glance at what went down) plus the crew's post-trip notes, if any.
function tripRecap(t) {
  const stops = Array.isArray(t.stops) ? t.stops : [];
  const SHOW = 3;
  let list = "";
  if (stops.length) {
    const rows = stops.slice(0, SHOW).map((s) => {
      const time = `<span class="trip__recap-time">${s.time ? fmtTime(s.time) : "·"}</span>`;
      const place = s.place ? ` · ${esc(clip(s.place, 40))}` : "";
      const note = s.note ? `<div class="trip__recap-note">${esc(clip(s.note, 90))}</div>` : "";
      return `<li>${time}<span class="trip__recap-what">${esc(clip(s.title, 48))}${place}</span>${note}</li>`;
    }).join("");
    const extra = stops.length - SHOW;
    const more = extra > 0 ? `<li class="trip__recap-more">+${extra} more stop${extra > 1 ? "s" : ""}</li>` : "";
    list = `<ul class="trip__recap-list">${rows}${more}</ul>`;
  }
  const recap = t.recap && t.recap.trim()
    ? `<div class="trip__recap-summary">📝 ${esc(clip(t.recap.trim(), 180))}</div>` : "";
  if (!list && !recap) {
    return `<div class="trip__recap"><div class="trip__recap-empty">No itinerary or notes were logged for this trip.</div></div>`;
  }
  return `<div class="trip__recap"><div class="trip__recap-head">Trip recap</div>${list}${recap}</div>`;
}

function tripCard(t, i, past) {
  const cd = countdown(t.date);
  const tags = (t.tags || []).slice(0, 3).map((x) => `<span class="chip">${esc(x)}</span>`).join("");
  const tilt = TILTS[i % TILTS.length];
  const dateRow = [fmtDate(t.date), esc(t.subtitle || "")].filter(Boolean).join(" · ");
  const cover = t.coverUrl ? `<img class="trip__cover" src="${esc(t.coverUrl)}" alt="" loading="lazy" onerror="this.remove()" />` : "";
  const pinned = getPins().has(t.id);
  return `
    <a class="trip card-light${pinned ? " is-pinned" : ""}${past ? " is-past" : ""}" ${themeAttrs(t.theme)}transform:rotate(${tilt})" href="/trip/${encodeURIComponent(t.slug || t.id)}">
      ${cover}
      <div class="trip__head">
        <span class="trip__count ${cd.cls}">${cd.label}</span>
        <div class="trip__emoji">${esc(t.emoji || "🚗")}</div>
        <div class="trip__name">${esc(t.title)}</div>
        ${dateRow ? `<div class="trip__date">${dateRow}</div>` : ""}
      </div>
      <div class="trip__body">
        ${tags ? `<div class="trip__tags">${tags}</div>` : ""}
        ${crewStack(t.members)}
        ${past ? tripRecap(t) : ""}
        <div class="trip__foot">
          <span class="trip__open">${past ? "See the recap →" : "Open trip →"}</span>
          <button class="trip__pin${pinned ? " on" : ""}" data-pin="${esc(t.id)}" type="button" title="${pinned ? "Unpin" : "Pin to top"}" aria-label="${pinned ? "Unpin trip" : "Pin trip to top"}">${pinned ? "★ Pinned" : "☆ Pin"}</button>
        </div>
      </div>
    </a>`;
}

function addCard() {
  return `
    <a class="add-card" id="addCard" href="#">
      <span class="add-card__plus">+</span>
      <span class="add-card__title">New trip</span>
      <span class="add-card__sub">add the next one</span>
    </a>`;
}

// --- Board: load, filter/sort/pin render, pull-to-refresh ------------------

// Fetch the board (optionally showing skeletons first), then render.
async function loadTrips(showSkeleton) {
  const grid = $("#grid");
  if (showSkeleton && grid) {
    $("#empty").style.display = "none";
    grid.style.display = "";
    grid.innerHTML = skeletonCards(6);
  }
  try {
    const { trips } = await api("/api/trips");
    ALL_TRIPS = Array.isArray(trips) ? trips : [];
    renderBoard();
  } catch (err) {
    toast(err.message, true);
  }
}

// Render the board from ALL_TRIPS applying the current search + sort, with
// pinned trips floated to the top. Pure client-side — no refetch.
function renderBoard() {
  const grid = $("#grid");
  if (!grid) return;
  const pins = getPins();
  const q = QUERY.trim().toLowerCase();

  if (!ALL_TRIPS.length) {
    $("#heroBody").textContent =
      "Nothing here yet — and that's expected. You only see trips you start or get invited to. Hit New trip to plan one, or paste an invite code above to join a friend's.";
  }

  let list = ALL_TRIPS.filter((t) => {
    if (!q) return true;
    return [t.title, t.subtitle, (t.tags || []).join(" ")].join(" ").toLowerCase().includes(q);
  });

  const byDate = (a, b) => (a.date || a.createdAt || "").localeCompare(b.date || b.createdAt || "");
  const byAdded = (a, b) => (b.createdAt || "").localeCompare(a.createdAt || "");
  list.sort(SORT === "late" ? (a, b) => byDate(b, a) : SORT === "added" ? byAdded : byDate);
  // Stable second pass: pinned trips first, keeping the sort order within groups.
  list.sort((a, b) => (pins.has(b.id) ? 1 : 0) - (pins.has(a.id) ? 1 : 0));

  // Split the (already filtered/sorted/pinned) list into what's coming up and
  // what's already wrapped. Past trips read best newest-first regardless of the
  // board's sort, with pinned ones still floated to the top of their group.
  const upcoming = list.filter((t) => !isPastDate(t.date));
  const past = list.filter((t) => isPastDate(t.date));
  past.sort((a, b) => (b.date || b.createdAt || "").localeCompare(a.date || a.createdAt || ""));
  past.sort((a, b) => (pins.has(b.id) ? 1 : 0) - (pins.has(a.id) ? 1 : 0));

  $("#tripCount").textContent = upcoming.length
    ? `${upcoming.length} coming up`
    : (ALL_TRIPS.length ? "all wrapped" : "make the first one");

  const noMatch = q && list.length === 0
    ? `<div class="board-nomatch">No trips match “${esc(QUERY)}”.</div>` : "";
  grid.innerHTML = noMatch + upcoming.map((t, i) => tripCard(t, i)).join("") + addCard();
  const add = $("#addCard");
  if (add) add.addEventListener("click", (e) => { e.preventDefault(); openCreate(); });

  const pastSection = $("#pastSection");
  const pastGrid = $("#pastGrid");
  if (pastSection && pastGrid) {
    if (past.length) {
      pastSection.style.display = "";
      const pc = $("#pastCount");
      if (pc) pc.textContent = past.length === 1 ? "1 wrapped" : `${past.length} wrapped`;
      pastGrid.innerHTML = past.map((t, i) => tripCard(t, i, true)).join("");
    } else {
      pastSection.style.display = "none";
      pastGrid.innerHTML = "";
    }
  }
}

// Pull-to-refresh on touch devices: drag down at the top of the board to reload.
function initPullToRefresh() {
  if (!("ontouchstart" in window)) return;
  const TH = 70; // px to trigger
  let startY = 0, pulling = false, fired = false;
  const ind = document.createElement("div");
  ind.className = "ptr-indicator";
  ind.textContent = "↓ pull to refresh";
  document.body.appendChild(ind);

  window.addEventListener("touchstart", (e) => {
    if (window.scrollY <= 0 && e.touches.length === 1) { startY = e.touches[0].clientY; pulling = true; fired = false; }
  }, { passive: true });

  window.addEventListener("touchmove", (e) => {
    if (!pulling) return;
    const dy = e.touches[0].clientY - startY;
    if (dy > 6) {
      const pull = Math.min(dy, TH + 40);
      ind.style.transform = `translateX(-50%) translateY(${Math.min(pull, TH)}px)`;
      ind.classList.add("show");
      ind.textContent = dy >= TH ? "↑ release to refresh" : "↓ pull to refresh";
      fired = dy >= TH;
    }
  }, { passive: true });

  window.addEventListener("touchend", async () => {
    if (!pulling) return;
    pulling = false;
    ind.style.transform = "";
    if (fired) {
      ind.textContent = "refreshing…";
      ind.classList.add("show");
      haptic(12);
      await loadTrips(false);
    }
    ind.classList.remove("show");
  });
}

// --- Create-trip modal -----------------------------------------------------
const STICKERS = ["🚗", "✈️", "🏙️", "🏔️", "🏖️", "🏕️", "🎡", "🛶", "🌮", "🍕", "🎸", "📸", "🗺️", "🐻", "🌵", "🛹", "⛷️", "🎿", "🏂", "🍻", "🎢", "🎤", "🛳️", "🚆", "🏟️", "🎄", "🎃", "🌊", "🔥", "⛺", "🥾", "🍷"];

// Fully-fledged starter templates. Picking one fills the sticker, theme, vibe,
// tagline, tags, description, AND a complete itinerary with a note on every
// stop — so a new trip starts as a real plan you can tweak, not a blank form.
const TEMPLATES = {
  blank: {
    label: "Blank", emoji: "🚗", theme: "red", vibe: "classic", subtitle: "", tags: [], desc: "", stops: [],
  },
  daytrip: {
    label: "Day trip", emoji: "🏙️", theme: "sky", vibe: "classic",
    subtitle: "out and back in a day", tags: ["Day trip"],
    desc: "A full day out and home by night — no overnight bag needed.",
    stops: [
      { time: "08:30", title: "Meet up & depart", note: "Pick a single meeting point so no one's left behind. Top up gas and grab coffees for the road." },
      { time: "10:00", title: "First stop", note: "The main reason for the trip — hit it early while you're fresh and the crowds are thin." },
      { time: "12:30", title: "Lunch", note: "Somewhere central so you're not backtracking. Book ahead if it's a weekend." },
      { time: "14:00", title: "Explore / second stop", note: "A walkable area, market, or viewpoint to wander after eating." },
      { time: "16:30", title: "Coffee or treat break", note: "Recharge before the drive — find the local dessert or specialty spot." },
      { time: "18:00", title: "Head home", note: "Beat the worst of the traffic. Decide now who's driving back." },
    ],
  },
  weekend: {
    label: "Weekend away", emoji: "🏔️", theme: "indigo", vibe: "classic",
    subtitle: "two days, one night", tags: ["Weekend", "Getaway"],
    desc: "Two days, one night. Pack light, split the driving, share the cost of the stay.",
    stops: [
      { time: "09:30", title: "Hit the road", note: "Leave by mid-morning to land in time for lunch. Make a shared playlist before you go." },
      { time: "12:30", title: "Lunch on arrival", note: "First meal in the new spot — ask a local or check reviews for something memorable." },
      { time: "15:00", title: "Check in & settle", note: "Drop bags, claim beds, regroup. Confirm checkout time for tomorrow." },
      { time: "16:30", title: "Afternoon activity", note: "The big thing you came for — hike, beach, town, whatever fits the vibe." },
      { time: "19:30", title: "Dinner out", note: "The nice meal of the trip. Reserve a table for the group." },
      { time: "09:00", title: "Day 2 — breakfast", note: "Slow start. Coffee and a proper breakfast before checkout." },
      { time: "11:00", title: "One more thing", note: "Squeeze in a market, viewpoint, or swim before you pack the car." },
      { time: "16:00", title: "Drive back", note: "Aim to be home before dark. Split snacks and fuel on the way." },
    ],
  },
  roadtrip: {
    label: "Road trip", emoji: "🛣️", theme: "orange", vibe: "vivid",
    subtitle: "the long haul", tags: ["Road trip", "Pit stops"],
    desc: "Long miles, good company. Plan the pit stops so it's the journey, not just the destination.",
    stops: [
      { time: "06:30", title: "Depart early", note: "Beat traffic and bank daylight. Assign a driver and a DJ for the first leg." },
      { time: "09:00", title: "Breakfast pit stop", note: "First proper stretch and a real breakfast — not just a gas-station snack." },
      { time: "11:30", title: "Gas + snacks", note: "Top up before you're below a quarter tank. Swap drivers here." },
      { time: "13:30", title: "Lunch town", note: "Pick a town worth stopping in, not just the nearest exit. Walk it off." },
      { time: "16:00", title: "Scenic detour", note: "The photo stop — a lookout, landmark, or roadside oddity worth the time." },
      { time: "18:30", title: "Arrive & check in", note: "Get to the stay, drop bags, find food nearby. You earned it." },
    ],
  },
  nightout: {
    label: "Night out", emoji: "🍸", theme: "plum", vibe: "night",
    subtitle: "big night", tags: ["Night out"],
    desc: "Dinner, drinks, and dancing. Sort the ride home before the first round.",
    stops: [
      { time: "18:30", title: "Pre-game", note: "Drinks and snacks at someone's place. Cheaper, and a good warm-up." },
      { time: "20:00", title: "Dinner", note: "Line your stomach. Book a table — walk-ins are rough at prime time." },
      { time: "22:00", title: "Main event", note: "The bar, club, or show. Check the dress code and cover charge first." },
      { time: "00:30", title: "Late-night food", note: "The non-negotiable post-party meal. Everyone knows the spot." },
      { time: "01:30", title: "Ride home", note: "Pre-book the cab or designate a sober driver. No one drives drunk." },
    ],
  },
  hangout: {
    label: "Hangout", emoji: "🎮", theme: "green", vibe: "classic",
    subtitle: "low-key day", tags: ["Hangout", "Chill"],
    desc: "Nothing fancy — just good people and an easy afternoon.",
    stops: [
      { time: "14:00", title: "Meet up", note: "Roll in whenever. Set a loose start so people aren't waiting around." },
      { time: "15:00", title: "Food run", note: "Grab snacks and drinks together, or settle the takeout order." },
      { time: "16:00", title: "Main activity", note: "Games, a movie, a walk — whatever the group's feeling." },
      { time: "19:00", title: "Dinner", note: "Cook together or order in. Split the bill evenly." },
      { time: "21:00", title: "Wind down", note: "Second wind or a slow fade — no pressure either way." },
    ],
  },
  concert: {
    label: "Concert / show", emoji: "🎤", theme: "pink", vibe: "night",
    subtitle: "showtime", tags: ["Show", "Live music"],
    desc: "See it live. Get there early, hold the group together, plan the exit.",
    stops: [
      { time: "18:00", title: "Dinner before", note: "Eat near the venue so you're not hungry through the set. Keep it quick." },
      { time: "19:30", title: "Doors / will-call", note: "Arrive early for security and merch. Have tickets ready on your phones." },
      { time: "20:00", title: "Opener", note: "Find your spot and a meet-up point in case anyone gets separated." },
      { time: "21:15", title: "Headliner", note: "The main act. Phones down, be present — you paid for this." },
      { time: "23:30", title: "After the show", note: "Beat the rush or grab a drink while it clears. Pre-plan the ride home." },
    ],
  },
  festival: {
    label: "Festival", emoji: "🎪", theme: "coral", vibe: "vivid",
    subtitle: "all day, all stages", tags: ["Festival", "Music"],
    desc: "A full day across stages. Hydrate, sunscreen, and a solid meet-up plan.",
    stops: [
      { time: "11:30", title: "Gates open", note: "Get in early to scope the layout, stages, and exits. Set a landmark to regroup at." },
      { time: "12:30", title: "First set", note: "Ease in with an act everyone likes. Lock in the must-see schedule together." },
      { time: "15:00", title: "Food + shade break", note: "Eat and rehydrate during the afternoon lull. Reapply sunscreen." },
      { time: "17:30", title: "Golden-hour set", note: "Best vibes of the day. Charge phones at a locker beforehand." },
      { time: "20:00", title: "Headliner", note: "Stake out a spot early. Agree on a clear exit/meet point for after." },
      { time: "23:00", title: "Exit & ride", note: "Surge pricing is brutal — walk a few blocks out before booking a ride." },
    ],
  },
  beach: {
    label: "Beach day", emoji: "🏖️", theme: "teal", vibe: "pastel",
    subtitle: "sun and sand", tags: ["Beach", "Summer"],
    desc: "Sun, water, snacks. Bring more water and shade than you think you need.",
    stops: [
      { time: "09:30", title: "Pack & depart", note: "Towels, sunscreen, cooler, speaker, cash for parking. Leave early for a good spot." },
      { time: "10:30", title: "Set up base", note: "Claim a spot near washrooms but away from the crowd. Umbrella up first." },
      { time: "12:30", title: "Lunch / picnic", note: "Cooler food or a nearby shack. Reapply sunscreen before going back in." },
      { time: "15:00", title: "Water + games", note: "Swim, volleyball, frisbee. Buddy-check anyone going far out." },
      { time: "17:00", title: "Ice cream run", note: "The reward. Find the local spot, not the tourist truck." },
      { time: "18:30", title: "Pack up & home", note: "Shake out the sand, count your stuff, beat the sunset traffic." },
    ],
  },
  camping: {
    label: "Camping", emoji: "⛺", theme: "lime", vibe: "classic",
    subtitle: "a night outdoors", tags: ["Camping", "Outdoors"],
    desc: "Off-grid for a night. Divide the gear, prep food ahead, leave no trace.",
    stops: [
      { time: "10:30", title: "Grocery & ice run", note: "Last stop with cell service — grab firewood, ice, and anything forgotten." },
      { time: "12:30", title: "Arrive & pitch camp", note: "Tents up before anything else, while it's light. Find the water source." },
      { time: "14:30", title: "Afternoon hike / swim", note: "Explore nearby trails or the lake while there's sun." },
      { time: "18:00", title: "Campfire dinner", note: "Get the fire going early. Foil packs and s'mores are foolproof." },
      { time: "20:30", title: "Stars & stories", note: "No signal, no problem. Stargaze and keep the fire safe." },
      { time: "08:30", title: "Day 2 — pack out", note: "Breakfast, douse the fire cold, pack everything, leave it cleaner than you found it." },
    ],
  },
  hike: {
    label: "Hike", emoji: "🥾", theme: "green", vibe: "classic",
    subtitle: "trail day", tags: ["Hike", "Outdoors"],
    desc: "Earn the view. Check the forecast, pack water and layers, tell someone the plan.",
    stops: [
      { time: "07:00", title: "Trailhead & sign in", note: "Early start beats heat and crowds. Hit the washroom and check the trail map." },
      { time: "07:30", title: "Start the climb", note: "Steady pace, regular water sips. Keep the group within sight of each other." },
      { time: "10:30", title: "Summit & snacks", note: "Refuel, take the photos, soak it in. Watch the time for the way down." },
      { time: "13:00", title: "Descend", note: "Knees take a beating downhill — go slow, watch footing on loose rock." },
      { time: "14:30", title: "Post-hike feast", note: "Burgers, tacos, anything big. You burned it, you earned it." },
    ],
  },
  ski: {
    label: "Ski / snow", emoji: "🎿", theme: "sky", vibe: "pastel",
    subtitle: "on the mountain", tags: ["Ski", "Winter"],
    desc: "First chair to last. Buy tickets online, dress in layers, meet for lunch.",
    stops: [
      { time: "07:00", title: "Drive to the hill", note: "Leave early to park close and beat the lift lines. Check road conditions." },
      { time: "08:30", title: "Tickets, rentals, gear", note: "Sort passes and rentals first. Agree on a meet-up time and spot." },
      { time: "09:00", title: "First runs", note: "Warm up on easy groomers before tackling the steeper stuff." },
      { time: "12:30", title: "Lodge lunch", note: "Refuel and dry off. Pack snacks — lodge food is pricey." },
      { time: "13:30", title: "Afternoon laps", note: "Hit the runs you've been eyeing while legs are still good." },
      { time: "16:00", title: "Last chair & après", note: "Final run, then a warm drink before the drive. Don't ski tired." },
    ],
  },
  foodie: {
    label: "Foodie tour", emoji: "🍜", theme: "red", vibe: "vivid",
    subtitle: "eat the whole city", tags: ["Food crawl", "Eats"],
    desc: "A planned crawl through the best bites in town. Come hungry, share everything.",
    stops: [
      { time: "11:00", title: "Brunch / first bite", note: "Start strong but don't overdo it — pace yourself, you've got all day." },
      { time: "13:00", title: "Signature dish stop", note: "The thing this city is known for. Order it and split it around." },
      { time: "15:00", title: "Coffee & dessert", note: "A sweet, light reset between heavy meals. Find the local roaster or bakery." },
      { time: "17:00", title: "Market / snack walk", note: "Graze through a food market or street stalls. Small plates, big variety." },
      { time: "19:30", title: "Dinner finale", note: "The headliner meal. Book it — the best spots fill up fast." },
      { time: "21:30", title: "Nightcap bite", note: "One last small plate or dessert if there's room. There's always room." },
    ],
  },
  citybreak: {
    label: "City break", emoji: "🌆", theme: "blue", vibe: "classic",
    subtitle: "see the city", tags: ["City break", "Sightseeing"],
    desc: "Hit the highlights without rushing. Buy major tickets ahead, leave room to wander.",
    stops: [
      { time: "08:30", title: "Breakfast near the stay", note: "Fuel up local. Grab transit passes or sort rideshares for the day." },
      { time: "09:30", title: "Top landmark", note: "Do the big one first — earliest slot means smaller lines and better light." },
      { time: "12:30", title: "Local lunch", note: "Eat where the locals do, a few streets off the tourist drag." },
      { time: "14:00", title: "Museum or gallery", note: "An indoor anchor for the afternoon. Pre-book to skip the queue." },
      { time: "16:30", title: "Old town wander", note: "No agenda — side streets, shops, a coffee. The best part of any city." },
      { time: "19:30", title: "Dinner out", note: "Nicer sit-down meal to cap the day. Reserve for the group." },
    ],
  },
  themepark: {
    label: "Theme park", emoji: "🎢", theme: "purple", vibe: "vivid",
    subtitle: "ride everything", tags: ["Theme park", "Rides"],
    desc: "Max the day. Buy tickets online, rope-drop the big ones, save a meet-up spot.",
    stops: [
      { time: "08:30", title: "Rope drop", note: "Be at the gate before opening. The first hour has the shortest lines all day." },
      { time: "09:00", title: "Headliner coaster", note: "Hit the most popular ride first while everyone's still at breakfast." },
      { time: "11:30", title: "Early lunch", note: "Eat before noon to skip the rush and free up peak ride time." },
      { time: "13:30", title: "Mid-park rides + show", note: "Knock out the middle of your list. Catch a show during the heat." },
      { time: "16:00", title: "Water ride & re-rides", note: "Cool off, then re-ride favorites as afternoon lines drop." },
      { time: "20:30", title: "Fireworks finale", note: "Stake out a viewing spot early. Plan the exit before the crowd surges." },
    ],
  },
  sports: {
    label: "Game day", emoji: "🏟️", theme: "slate", vibe: "vivid",
    subtitle: "go team", tags: ["Sports", "Game day"],
    desc: "Tailgate to final whistle. Check the bag policy, wear the colors, plan the exit.",
    stops: [
      { time: "15:30", title: "Tailgate / pre-drinks", note: "Food, drinks, and hype near the stadium. Check the parking lot rules." },
      { time: "17:30", title: "Head to the gate", note: "Clear-bag policy at most venues — travel light and arrive before kickoff." },
      { time: "18:00", title: "Find seats & snacks", note: "Get settled, grab the overpriced stadium food, soak up the atmosphere." },
      { time: "19:00", title: "Game time", note: "Be loud. Agree on a meet point in case anyone splits off." },
      { time: "22:00", title: "Post-game spot", note: "Celebrate or commiserate at a nearby bar while traffic clears." },
    ],
  },
  brewery: {
    label: "Brewery / winery", emoji: "🍻", theme: "gold", vibe: "classic",
    subtitle: "tasting trail", tags: ["Tasting", "Drinks"],
    desc: "A relaxed tasting trail. Line up a driver or a tour van — never DIY the driving.",
    stops: [
      { time: "11:30", title: "First stop + flight", note: "Start with a tasting flight to find what you like. Eat something first." },
      { time: "13:00", title: "Lunch between", note: "Solid meal to pace the day. Many spots have food trucks on site." },
      { time: "14:30", title: "Second tasting", note: "A different style or region. Take notes on favorites to buy later." },
      { time: "16:00", title: "Last stop + bottles", note: "Wind down with the best of the day and grab a few bottles to take home." },
      { time: "17:30", title: "Ride home", note: "Designated driver or pre-booked van only. Hydrate on the way back." },
    ],
  },
  spa: {
    label: "Spa / wellness", emoji: "🧖", theme: "teal", vibe: "pastel",
    subtitle: "reset day", tags: ["Wellness", "Relax"],
    desc: "Slow it all the way down. Book treatments ahead and silence the group chat.",
    stops: [
      { time: "10:00", title: "Check in & change", note: "Arrive early to settle in. Robes on, phones away." },
      { time: "10:30", title: "Sauna & soak", note: "Warm up slow. Hydrate between rounds of sauna, steam, and cold plunge." },
      { time: "12:30", title: "Treatments", note: "Massage or facial — book the slots in advance so you're not waiting." },
      { time: "14:00", title: "Light lunch", note: "Something fresh and easy. Keep the calm going, no rushing." },
      { time: "15:30", title: "Lounge & tea", note: "Read, nap, or just sit. The whole point is doing nothing well." },
    ],
  },
  birthday: {
    label: "Birthday", emoji: "🎂", theme: "pink", vibe: "vivid",
    subtitle: "celebrate them", tags: ["Birthday", "Party"],
    desc: "Make their day. Keep the surprise tight and pin down dinner numbers early.",
    stops: [
      { time: "17:30", title: "Gather & decorate", note: "Arrive before the guest of honor. Sort cake, candles, and any surprise." },
      { time: "18:30", title: "Group photo", note: "Get everyone together while they look fresh and the light's good." },
      { time: "19:00", title: "Dinner", note: "Reserve under the right name. Tell the restaurant it's a birthday." },
      { time: "21:00", title: "Cake & celebrate", note: "Candles, song, the works. Don't forget a lighter." },
      { time: "22:00", title: "Drinks or dancing", note: "Keep it going if the energy's there. Sort rides home in advance." },
    ],
  },
};

const VIBES = [
  { key: "classic", label: "Classic" },
  { key: "vivid", label: "Vivid" },
  { key: "pastel", label: "Pastel" },
  { key: "night", label: "Night" },
];

let ctEmoji = "🚗";
let ctTheme = "red";
let ctVibe = "classic";
let ctTags = [];
let ctStops = [];
let ctCrew = [];        // friend ids picked in "who's coming"
let MY_FRIENDS = null;  // cached friends list for the create-modal crew picker

// Build the "who's coming" chips from your friends. Fetched once and cached;
// if you have no friends yet, show a gentle hint instead.
async function buildCrewPicker() {
  const box = $("#ct-crew");
  const empty = $("#ct-crewEmpty");
  if (!box) return;
  if (MY_FRIENDS === null) {
    try { MY_FRIENDS = (await api("/api/friends")).friends || []; }
    catch { MY_FRIENDS = []; }
  }
  if (!MY_FRIENDS.length) {
    box.innerHTML = "";
    box.style.display = "none";
    if (empty) empty.style.display = "block";
    return;
  }
  box.style.display = "flex";
  if (empty) empty.style.display = "none";
  box.innerHTML = MY_FRIENDS.map((f) => {
    const sel = ctCrew.includes(f.id);
    const faceStyle = f.avatarImage
      ? `background:url('${f.avatarImage}') center/cover no-repeat`
      : `background:${f.avatarColor || avatarColor(f.displayName)}`;
    const face = f.avatarImage ? "" : (f.avatarEmoji || esc(initials(f.displayName)));
    return `<button type="button" class="crew-pick__chip${sel ? " on" : ""}" data-crew="${esc(f.id)}">
      <span class="crew-pick__face" style="${faceStyle}">${face}</span>${esc(f.displayName)}</button>`;
  }).join("");
}

// Preview a theme on the modal: keyword via data-theme, #hex via inline accent.
function applyModalTheme(theme) {
  const m = $("#createModal");
  if (theme.charAt(0) === "#") {
    m.setAttribute("data-theme", "custom");
    m.style.setProperty("--accent", theme);
  } else {
    m.style.removeProperty("--accent");
    m.setAttribute("data-theme", theme);
  }
  $("#ct-themes").querySelectorAll(".theme-dot[data-theme]").forEach((x) => x.classList.toggle("sel", x.dataset.theme === theme));
}

function markVibe() {
  const box = $("#ct-vibes");
  if (box) box.querySelectorAll(".vibe-chip").forEach((c) => c.classList.toggle("sel", c.dataset.vibe === ctVibe));
}

function applyTemplate(key) {
  const t = TEMPLATES[key];
  if (!t) return;
  ctEmoji = t.emoji; ctTheme = t.theme; ctVibe = t.vibe || "classic"; ctTags = [...t.tags]; ctStops = t.stops.map((s) => ({ ...s }));
  if (t.desc != null && $("#ct-desc")) $("#ct-desc").value = t.desc;
  if (t.subtitle != null && $("#ct-sub")) $("#ct-sub").value = t.subtitle;
  applyModalTheme(ctTheme);
  markVibe();
  $("#ct-stickers").querySelectorAll(".sticker").forEach((x) => x.classList.toggle("sel", x.dataset.emoji === ctEmoji));
  $("#ct-templates").querySelectorAll(".btn").forEach((b) => b.classList.toggle("primary", b.dataset.tpl === key));
  // A non-blank template fills in tagline/description/vibe — which live inside
  // the collapsed "More options". Reveal it so the change isn't invisible.
  const more = document.querySelector(".more-options");
  if (more && key !== "blank") more.open = true;
}

function openCreate() {
  const scrim = $("#createScrim");
  // build template chips once
  const tg = $("#ct-templates");
  if (!tg.dataset.built) {
    tg.innerHTML = Object.entries(TEMPLATES).map(([k, t]) => `<button type="button" class="btn small${k === "blank" ? " primary" : ""}" data-tpl="${k}">${t.label}</button>`).join("");
    tg.dataset.built = "1";
    tg.addEventListener("click", (ev) => { const b = ev.target.closest("[data-tpl]"); if (b) applyTemplate(b.dataset.tpl); });
  }
  // build sticker grid once
  const sg = $("#ct-stickers");
  if (!sg.dataset.built) {
    sg.innerHTML = STICKERS.map((e) => `<button type="button" class="sticker${e === ctEmoji ? " sel" : ""}" data-emoji="${e}">${e}</button>`).join("");
    sg.dataset.built = "1";
    sg.addEventListener("click", (ev) => {
      const b = ev.target.closest(".sticker");
      if (!b) return;
      ctEmoji = b.dataset.emoji;
      sg.querySelectorAll(".sticker").forEach((x) => x.classList.toggle("sel", x === b));
    });
    $("#ct-themes").addEventListener("click", (ev) => {
      const d = ev.target.closest(".theme-dot[data-theme]");
      if (!d) return;
      ctTheme = d.dataset.theme;
      applyModalTheme(ctTheme);
    });
    $("#ct-custom").addEventListener("input", (ev) => {
      ctTheme = ev.target.value;
      applyModalTheme(ctTheme);
    });
  }
  // build the vibe picker once
  const vg = $("#ct-vibes");
  if (vg && !vg.dataset.built) {
    vg.innerHTML = VIBES.map((v) => `<button type="button" class="vibe-chip" data-vibe="${v.key}"><span class="vibe-chip__dot ${v.key}"></span>${v.label}</button>`).join("");
    vg.dataset.built = "1";
    vg.addEventListener("click", (ev) => {
      const c = ev.target.closest(".vibe-chip[data-vibe]");
      if (!c) return;
      ctVibe = c.dataset.vibe;
      markVibe();
    });
  }
  applyModalTheme(ctTheme);
  markVibe();
  ctCrew = [];           // start with no one pre-selected
  buildCrewPicker();     // async; fills in once friends load
  scrim.hidden = false;
}
function closeCreate() { $("#createScrim").hidden = true; }

async function createTrip() {
  const title = $("#ct-title").value.trim();
  if (!title) return toast("Give your trip a name.", true);
  try {
    const { trip } = await api("/api/trips", "POST", {
      title,
      date: $("#ct-date").value,
      subtitle: $("#ct-sub").value.trim(),
      description: $("#ct-desc").value.trim(),
      coverUrl: $("#ct-cover").value.trim(),
      emoji: ctEmoji,
      theme: ctTheme,
      vibe: ctVibe,
      tags: ctTags,
    });
    // Seed the template's starter stops, if any.
    for (const s of ctStops) {
      await api("/api/trips/" + encodeURIComponent(trip.id) + "/stops", "POST", s).catch(() => {});
    }
    // Invite the friends picked in "who's coming".
    for (const uid of ctCrew) {
      await api("/api/trips/" + encodeURIComponent(trip.id) + "/members", "POST", { userId: uid }).catch(() => {});
    }
    location.href = "/trip/" + encodeURIComponent(trip.slug || trip.id);
  } catch (e) {
    toast(e.message, true);
  }
}

(async function init() {
  let me;
  try {
    me = (await api("/api/auth/me")).user;
  } catch (err) {
    // Don't fail silently — show what went wrong so it's debuggable.
    toast("Couldn't reach the app: " + err.message, true);
    return;
  }
  if (!me) {
    location.href = "/login.html";
    return;
  }
  ME = me; // module-scoped so pins/render can read the user id
  $("#whoName").textContent = me.displayName;
  const avEl = $("#avatar");
  avEl.style.backgroundSize = "cover";
  avEl.style.backgroundPosition = "center";
  if (me.avatarImage) {
    avEl.textContent = "";
    avEl.style.background = `url('${me.avatarImage}') center/cover no-repeat`;
  } else {
    avEl.textContent = me.avatarEmoji || initials(me.displayName);
    avEl.style.background = me.avatarColor || avatarColor(me.displayName);
  }
  $("#greeting").textContent = pickGreeting(me.displayName.split(" ")[0]);
  if (me.isAdmin) $("#adminLink").style.display = "";

  // Friends tab notification badge: show how many friend requests are waiting,
  // and keep it fresh so new requests appear without a manual reload.
  function setFriendBadge(n) {
    const b = $("#friendReqBadge");
    if (!b) return;
    if (n > 0) { b.textContent = n > 99 ? "99+" : String(n); b.hidden = false; }
    else b.hidden = true;
  }
  setFriendBadge(me.friendReqCount || 0);
  setInterval(async () => {
    try { const u = (await api("/api/auth/me")).user; if (u) setFriendBadge(u.friendReqCount || 0); } catch { /* ignore */ }
  }, 30000);

  $("#logoutBtn").addEventListener("click", async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    location.href = "/login.html";
  });

  // Create-trip modal wiring (any user can make a trip).
  $("#ct-cancel").addEventListener("click", closeCreate);
  $("#ct-create").addEventListener("click", createTrip);
  $("#createScrim").addEventListener("click", (e) => { if (e.target.id === "createScrim") closeCreate(); });

  // Floating "+ New trip" button (mobile).
  const fab = $("#fabNew");
  if (fab) fab.addEventListener("click", openCreate);

  // Toggle a friend in the "who's coming" picker.
  const crewBox = $("#ct-crew");
  if (crewBox) crewBox.addEventListener("click", (e) => {
    const chip = e.target.closest("[data-crew]");
    if (!chip) return;
    const id = chip.dataset.crew;
    if (ctCrew.includes(id)) ctCrew = ctCrew.filter((x) => x !== id);
    else ctCrew.push(id);
    chip.classList.toggle("on");
  });

  // Add a trip by pasting its code.
  async function addByCode() {
    const code = $("#joinCodeInput").value.trim();
    if (!code) return toast("Paste a trip code first.", true);
    try {
      const { trip } = await api("/api/trips/join-by-code", "POST", { code });
      location.href = "/trip/" + encodeURIComponent(trip.slug || trip.id);
    } catch (err) {
      toast(err.message, true);
    }
  }
  $("#joinCodeBtn").addEventListener("click", addByCode);
  $("#joinCodeInput").addEventListener("keydown", (e) => { if (e.key === "Enter") addByCode(); });

  // Board search + sort controls (added to index.html).
  const searchEl = $("#boardSearch");
  if (searchEl) searchEl.addEventListener("input", (e) => { QUERY = e.target.value; renderBoard(); });
  const sortEl = $("#boardSort");
  if (sortEl) sortEl.addEventListener("change", (e) => { SORT = e.target.value; renderBoard(); });

  // Pin/unpin from a card without following the card's link. Bound to both the
  // upcoming grid and the past-trips grid.
  const onPinClick = (e) => {
    const pin = e.target.closest("[data-pin]");
    if (!pin) return;
    e.preventDefault();
    e.stopPropagation();
    togglePin(pin.dataset.pin);
    haptic();
    renderBoard();
  };
  $("#grid").addEventListener("click", onPinClick);
  $("#pastGrid").addEventListener("click", onPinClick);

  initPullToRefresh();
  await loadTrips(true);
})();
