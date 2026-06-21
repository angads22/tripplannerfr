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

function initials(name) {
  return (name || "?").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
}

function countdown(dateStr) {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return "";
  const trip = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((trip - today) / 86400000);
  if (days > 1) return `in ${days} days`;
  if (days === 1) return "tomorrow";
  if (days === 0) return "today!";
  return "wrapped";
}

function fmtDate(dateStr) {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y) return dateStr;
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }).toUpperCase();
}

function tripCard(t) {
  const cd = countdown(t.date);
  const slug = t.slug || t.id;
  const tags = (t.tags || []).slice(0, 3).map((x) => `<span class="tag">${esc(x)}</span>`).join("");
  const edit = t.canEdit
    ? `<a class="trip__edit" href="/trip/${encodeURIComponent(slug)}/edit" title="Edit itinerary" aria-label="Edit ${esc(t.title)}">✎</a>`
    : "";
  return `
    <div class="trip reveal">
      <a class="trip__link" href="/trip/${encodeURIComponent(slug)}" aria-label="Open ${esc(t.title)}">
        <div class="trip__top">
          ${cd ? `<span class="trip__count">${cd}</span>` : ""}
          <div class="trip__emoji">${esc(t.emoji || "✈️")}</div>
          <div class="trip__name">${esc(t.title)}</div>
          <div class="trip__date">${[fmtDate(t.date), esc(t.subtitle || "")].filter(Boolean).join(" · ")}</div>
        </div>
        <div class="trip__body">
          ${tags ? `<div class="trip__row">${tags}</div>` : ""}
          <div class="trip__cta"><span class="trip__open">Open trip <span class="arr">→</span></span></div>
        </div>
      </a>
      ${edit}
    </div>`;
}

async function createTrip() {
  const title = (prompt("Name your trip (e.g. Montréal weekend):") || "").trim();
  if (!title) return;
  try {
    const res = await fetch("/api/trips", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, shareWithEveryone: true }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Could not create the trip.");
    location.href = "/trip/" + encodeURIComponent(data.trip.slug || data.trip.id) + "/edit";
  } catch (e) {
    toast(e.message, true);
  }
}

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
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
  $("#greeting").textContent = `Hey ${me.displayName.split(" ")[0]} 👋`;
  if (me.isAdmin) {
    $("#adminLink").style.display = "";
    const nt = $("#newTripBtn");
    nt.style.display = "";
    nt.addEventListener("click", createTrip);
  }

  $("#logoutBtn").addEventListener("click", async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    location.href = "/login.html";
  });

  try {
    const { trips } = await api("/api/trips");
    const grid = $("#grid");
    if (!trips.length) {
      grid.style.display = "none";
      $("#empty").style.display = "block";
      $("#emptyMsg").textContent = me.isAdmin
        ? "Add trips and share them from the Admin console."
        : "Nothing's been shared with you yet — nudge the trip's owner.";
      return;
    }
    grid.innerHTML = trips.map(tripCard).join("");
  } catch (err) {
    toast(err.message, true);
  }
})();
