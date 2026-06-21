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
    const name = c.displayName || c.name || c || "?";
    return `<span class="crew__face" style="background:${avatarColor(name)}" title="${esc(name)}">${esc(initials(name))}</span>`;
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
  return `
    <a class="trip card-light" ${themeAttrs(t.theme)}transform:rotate(${tilt})" href="/trip/${encodeURIComponent(t.slug || t.id)}">
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
const STICKERS = ["🚗", "✈️", "🏙️", "🏔️", "🏖️", "🏕️", "🎡", "🛶", "🌮", "🍕", "🎸", "📸", "🗺️", "🐻", "🌵", "🛹"];

// Starter templates for different kinds of trips / hangouts. Picking one
// pre-fills the sticker, theme, tags, and a starter itinerary.
const TEMPLATES = {
  blank:    { label: "Blank", emoji: "🚗", theme: "red", tags: [], stops: [] },
  daytrip:  { label: "🏙️ Day trip", emoji: "🏙️", theme: "red", tags: ["Day trip"], stops: [
                { time: "09:00", title: "Meet up & depart" }, { time: "12:00", title: "Lunch" },
                { time: "14:00", title: "Explore" }, { time: "18:00", title: "Head home" } ] },
  weekend:  { label: "🏔️ Weekend away", emoji: "🏔️", theme: "blue", tags: ["Weekend"], stops: [
                { time: "10:00", title: "Check in" }, { time: "13:00", title: "Lunch spot" },
                { time: "19:00", title: "Dinner" }, { time: "10:00", title: "Day 2 adventure" } ] },
  nightout: { label: "🍸 Night out", emoji: "🍸", theme: "purple", tags: ["Night out"], stops: [
                { time: "19:00", title: "Pre-game" }, { time: "20:30", title: "Dinner" },
                { time: "22:00", title: "Main event" }, { time: "00:30", title: "After" } ] },
  hangout:  { label: "🎮 Hangout", emoji: "🎮", theme: "green", tags: ["Hangout"], stops: [
                { time: "15:00", title: "Meet up" }, { time: "16:00", title: "Food run" },
                { time: "17:00", title: "Activity" } ] },
  roadtrip: { label: "🛣️ Road trip", emoji: "🛣️", theme: "orange", tags: ["Road trip"], stops: [
                { time: "08:00", title: "Depart" }, { time: "11:00", title: "Pit stop" },
                { time: "15:00", title: "Arrive" } ] },
};

let ctEmoji = "🚗";
let ctTheme = "red";
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

function applyTemplate(key) {
  const t = TEMPLATES[key];
  if (!t) return;
  ctEmoji = t.emoji; ctTheme = t.theme; ctTags = [...t.tags]; ctStops = t.stops.map((s) => ({ ...s }));
  applyModalTheme(ctTheme);
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
  applyModalTheme(ctTheme);
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
      emoji: ctEmoji,
      theme: ctTheme,
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
  $("#avatar").textContent = me.avatarEmoji || initials(me.displayName);
  $("#avatar").style.background = me.avatarColor || avatarColor(me.displayName);
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

    grid.innerHTML = trips.map(tripCard).join("") + addCard();
    const add = $("#addCard");
    if (add) add.addEventListener("click", (e) => { e.preventDefault(); openCreate(); });
  } catch (err) {
    toast(err.message, true);
  }
})();
