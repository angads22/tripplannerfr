"use strict";

const $ = (s, r = document) => r.querySelector(s);

function toast(msg, isErr) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.toggle("err", !!isErr);
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2600);
}

async function api(path) {
  const res = await fetch(path);
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

function crewStack(crew) {
  if (!crew || !crew.length) return "";
  const faces = crew.slice(0, 5).map((c) => {
    const name = typeof c === "string" ? c : c.name || c.displayName || "?";
    return `<span class="crew__face" style="background:${avatarColor(name)}" title="${esc(name)}">${esc(initials(name))}</span>`;
  }).join("");
  const n = crew.length;
  return `<div class="crew"><div class="crew__stack">${faces}</div><span class="crew__count">${n} going</span></div>`;
}

function tripCard(t, i) {
  const cd = countdown(t.date);
  const tags = (t.tags || []).slice(0, 3).map((x) => `<span class="chip">${esc(x)}</span>`).join("");
  const tilt = TILTS[i % TILTS.length];
  const dateRow = [fmtDate(t.date), esc(t.subtitle || "")].filter(Boolean).join(" · ");
  return `
    <a class="trip card-light" href="/trip/${encodeURIComponent(t.slug || t.id)}" style="transform:rotate(${tilt})">
      <div class="trip__head">
        <span class="trip__count ${cd.cls}">${cd.label}</span>
        <div class="trip__emoji">${esc(t.emoji || "🚗")}</div>
        <div class="trip__name">${esc(t.title)}</div>
        ${dateRow ? `<div class="trip__date">${dateRow}</div>` : ""}
      </div>
      <div class="trip__body">
        ${tags ? `<div class="trip__tags">${tags}</div>` : ""}
        ${crewStack(t.crew)}
        <div style="margin-top:14px"><span class="trip__open">Open itinerary →</span></div>
      </div>
    </a>`;
}

(async function init() {
  let me;
  try {
    me = (await api("/api/auth/me")).user;
  } catch {
    return;
  }
  if (!me) {
    location.href = "/login.html";
    return;
  }
  $("#whoName").textContent = me.displayName;
  $("#avatar").textContent = initials(me.displayName);
  $("#avatar").style.background = avatarColor(me.displayName);
  $("#greeting").textContent = `Hey ${me.displayName.split(" ")[0]}, where to next?`;
  if (me.isAdmin) $("#adminLink").style.display = "";

  $("#logoutBtn").addEventListener("click", async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    location.href = "/login.html";
  });

  try {
    const { trips } = await api("/api/trips");
    const grid = $("#grid");
    const n = trips.length;
    $("#tripCount").textContent = n ? `${n} on the board` : "";

    if (!n) {
      grid.style.display = "none";
      $("#empty").style.display = "block";
      $("#emptyMsg").textContent = me.isAdmin
        ? "Add trips and share them from the Admin console."
        : "Nothing's been shared with you yet. Nudge the trip's owner.";
      return;
    }
    grid.innerHTML = trips.map(tripCard).join("");
  } catch (err) {
    toast(err.message, true);
  }
})();
