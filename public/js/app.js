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

function tripCard(t, i) {
  const cd = countdown(t.date);
  const tags = (t.tags || []).slice(0, 3).map((x) => `<span class="chip">${esc(x)}</span>`).join("");
  const tilt = TILTS[i % TILTS.length];
  const dateRow = [fmtDate(t.date), esc(t.subtitle || "")].filter(Boolean).join(" · ");
  const cover = t.coverUrl ? `<img class="trip__cover" src="${esc(t.coverUrl)}" alt="" loading="lazy" onerror="this.remove()" />` : "";
  return `
    <a class="trip card-light" ${themeAttrs(t.theme)}transform:rotate(${tilt})" href="/trip/${encodeURIComponent(t.slug || t.id)}">
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
        <div style="margin-top:14px"><span class="trip__open">Open trip →</span></div>
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

// --- Create-trip modal -----------------------------------------------------
const STICKERS = ["🚗", "✈️", "🏙️", "🏔️", "🏖️", "🏕️", "🎡", "🛶", "🌮", "🍕", "🎸", "📸", "🗺️", "🐻", "🌵", "🛹", "⛷️", "🎿", "🏂", "🍻", "🎢", "🎤", "🛳️", "🚆", "🏟️", "🎄", "🎃", "🌊", "🔥", "⛺", "🥾", "🍷"];

// Starter templates for different kinds of trips / hangouts. Picking one
// pre-fills the sticker, theme, vibe, tags, and a starter itinerary so you're
// never staring at an empty form.
const TEMPLATES = {
  blank:    { label: "Blank", emoji: "🚗", theme: "red", vibe: "classic", tags: [], desc: "", stops: [] },
  daytrip:  { label: "Day trip", emoji: "🏙️", theme: "sky", vibe: "classic", tags: ["Day trip"], desc: "Out and back in a day.", stops: [
                { time: "09:00", title: "Meet up & depart" }, { time: "10:30", title: "First stop" },
                { time: "12:30", title: "Lunch", note: "somewhere central" }, { time: "14:30", title: "Explore" },
                { time: "18:00", title: "Head home" } ] },
  weekend:  { label: "Weekend away", emoji: "🏔️", theme: "indigo", vibe: "classic", tags: ["Weekend"], desc: "Two days, one night.", stops: [
                { time: "10:00", title: "Hit the road" }, { time: "13:00", title: "Lunch on arrival" },
                { time: "15:00", title: "Check in" }, { time: "19:30", title: "Dinner" },
                { time: "09:00", title: "Day 2 — breakfast" }, { time: "11:00", title: "Main activity" }, { time: "16:00", title: "Head back" } ] },
  roadtrip: { label: "Road trip", emoji: "🛣️", theme: "orange", vibe: "vivid", tags: ["Road trip"], desc: "Long haul — plan the pit stops.", stops: [
                { time: "07:00", title: "Depart early" }, { time: "09:30", title: "Gas + snacks" },
                { time: "12:00", title: "Lunch town" }, { time: "15:00", title: "Scenic stop" }, { time: "18:00", title: "Arrive" } ] },
  nightout: { label: "Night out", emoji: "🍸", theme: "plum", vibe: "night", tags: ["Night out"], desc: "", stops: [
                { time: "19:00", title: "Pre-game" }, { time: "20:30", title: "Dinner" },
                { time: "22:00", title: "Main event" }, { time: "00:30", title: "After-hours" } ] },
  hangout:  { label: "Hangout", emoji: "🎮", theme: "green", vibe: "classic", tags: ["Hangout"], desc: "", stops: [
                { time: "15:00", title: "Meet up" }, { time: "16:00", title: "Food run" },
                { time: "17:00", title: "Activity" }, { time: "20:00", title: "Wind down" } ] },
  concert:  { label: "Concert / show", emoji: "🎤", theme: "pink", vibe: "night", tags: ["Show"], desc: "", stops: [
                { time: "18:00", title: "Dinner before" }, { time: "20:00", title: "Doors open" },
                { time: "21:00", title: "Show time" }, { time: "23:30", title: "After" } ] },
  festival: { label: "Festival", emoji: "🎪", theme: "coral", vibe: "vivid", tags: ["Festival"], desc: "Multi-stage, all day.", stops: [
                { time: "12:00", title: "Gates open" }, { time: "13:00", title: "First set" },
                { time: "16:00", title: "Food + rest" }, { time: "19:00", title: "Sunset set" }, { time: "21:30", title: "Headliner" } ] },
  beach:    { label: "Beach day", emoji: "🏖️", theme: "teal", vibe: "pastel", tags: ["Beach"], desc: "", stops: [
                { time: "10:00", title: "Pack the car" }, { time: "11:00", title: "Arrive + set up" },
                { time: "13:00", title: "Lunch" }, { time: "16:00", title: "Ice cream run" }, { time: "18:00", title: "Head home" } ] },
  camping:  { label: "Camping", emoji: "⛺", theme: "lime", vibe: "classic", tags: ["Camping", "Outdoors"], desc: "", stops: [
                { time: "11:00", title: "Drive to site" }, { time: "13:00", title: "Pitch tents" },
                { time: "15:00", title: "Hike" }, { time: "19:00", title: "Campfire dinner" }, { time: "08:00", title: "Day 2 — pack up" } ] },
  hike:     { label: "Hike", emoji: "🥾", theme: "green", vibe: "classic", tags: ["Hike", "Outdoors"], desc: "", stops: [
                { time: "07:30", title: "Trailhead + sign in" }, { time: "08:00", title: "Start the climb" },
                { time: "11:00", title: "Summit + snacks" }, { time: "13:30", title: "Back down" }, { time: "14:30", title: "Post-hike food" } ] },
  ski:      { label: "Ski / snow", emoji: "🎿", theme: "sky", vibe: "pastel", tags: ["Ski", "Winter"], desc: "", stops: [
                { time: "07:30", title: "Drive to the hill" }, { time: "09:00", title: "Lift tickets + gear" },
                { time: "09:30", title: "First runs" }, { time: "12:30", title: "Lodge lunch" }, { time: "16:00", title: "Last chair" } ] },
  foodie:   { label: "Foodie tour", emoji: "🍜", theme: "red", vibe: "vivid", tags: ["Food crawl"], desc: "Eat your way across town.", stops: [
                { time: "11:30", title: "Brunch spot" }, { time: "13:30", title: "Snack stop" },
                { time: "15:30", title: "Coffee + dessert" }, { time: "18:00", title: "Dinner" }, { time: "20:30", title: "Late-night bite" } ] },
  citybreak:{ label: "City break", emoji: "🌆", theme: "blue", vibe: "classic", tags: ["City break"], desc: "Sightseeing in a new city.", stops: [
                { time: "09:00", title: "Breakfast near the hotel" }, { time: "10:00", title: "Landmark #1" },
                { time: "12:30", title: "Local lunch" }, { time: "14:00", title: "Museum / gallery" }, { time: "17:00", title: "Old town wander" }, { time: "19:30", title: "Dinner out" } ] },
  themepark:{ label: "Theme park", emoji: "🎢", theme: "purple", vibe: "vivid", tags: ["Theme park"], desc: "", stops: [
                { time: "08:30", title: "Rope drop" }, { time: "09:00", title: "Headliner coaster first" },
                { time: "12:00", title: "Lunch (beat the rush)" }, { time: "15:00", title: "Water ride" }, { time: "20:00", title: "Fireworks" } ] },
  sports:   { label: "Game day", emoji: "🏟️", theme: "slate", vibe: "vivid", tags: ["Sports"], desc: "", stops: [
                { time: "16:00", title: "Tailgate / pre-drinks" }, { time: "18:00", title: "Head to the gate" },
                { time: "19:00", title: "Tip-off / kickoff" }, { time: "22:00", title: "Post-game spot" } ] },
  brewery:  { label: "Brewery / winery", emoji: "🍻", theme: "gold", vibe: "classic", tags: ["Tasting"], desc: "", stops: [
                { time: "12:00", title: "First stop + flight" }, { time: "14:00", title: "Second stop" },
                { time: "15:30", title: "Lunch between" }, { time: "17:00", title: "Last tasting" } ] },
  spa:      { label: "Spa / chill", emoji: "🧖", theme: "teal", vibe: "pastel", tags: ["Wellness"], desc: "Slow it all the way down.", stops: [
                { time: "10:00", title: "Check in + change" }, { time: "10:30", title: "Sauna + soak" },
                { time: "12:30", title: "Massage" }, { time: "14:00", title: "Light lunch" }, { time: "15:30", title: "Lounge + tea" } ] },
  birthday: { label: "Birthday", emoji: "🎂", theme: "pink", vibe: "vivid", tags: ["Birthday"], desc: "", stops: [
                { time: "18:00", title: "Gather" }, { time: "19:00", title: "Dinner" }, { time: "21:00", title: "Cake + celebrate" } ] },
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
  applyModalTheme(ctTheme);
  markVibe();
  $("#ct-stickers").querySelectorAll(".sticker").forEach((x) => x.classList.toggle("sel", x.dataset.emoji === ctEmoji));
  $("#ct-templates").querySelectorAll(".btn").forEach((b) => b.classList.toggle("primary", b.dataset.tpl === key));
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
  $("#greeting").textContent = `Hey ${me.displayName.split(" ")[0]}, where to next?`;
  if (me.isAdmin) $("#adminLink").style.display = "";

  $("#logoutBtn").addEventListener("click", async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    location.href = "/login.html";
  });

  // Create-trip modal wiring (any user can make a trip).
  $("#ct-cancel").addEventListener("click", closeCreate);
  $("#ct-create").addEventListener("click", createTrip);
  $("#createScrim").addEventListener("click", (e) => { if (e.target.id === "createScrim") closeCreate(); });

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

  try {
    const { trips } = await api("/api/trips");
    const grid = $("#grid");
    const n = trips.length;
    $("#tripCount").textContent = n ? `${n} on the board` : "make the first one";
    $("#empty").style.display = "none";
    grid.style.display = "";

    // First-time / empty board: explain how it works. You only see trips you
    // created or were invited to — there's nothing here until you make one or
    // paste an invite code.
    if (n === 0) {
      $("#heroBody").textContent =
        "Nothing here yet — and that's expected. You only see trips you start or get invited to. Hit New trip to plan one, or paste an invite code above to join a friend's.";
    }

    grid.innerHTML = trips.map(tripCard).join("") + addCard();
    const add = $("#addCard");
    if (add) add.addEventListener("click", (e) => { e.preventDefault(); openCreate(); });
  } catch (err) {
    toast(err.message, true);
  }
})();
