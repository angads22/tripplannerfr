"use strict";

// Renders a trip's structured itinerary (fetched from the API) into a numbered
// timeline with transit legs between stops and an expandable detail drawer per
// stop (notes, tip, hours, a lazy keyless map, and directions). Every field is
// escaped — content is plain data, never HTML.

const $ = (s, r = document) => r.querySelector(s);

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function toast(msg, isErr) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.toggle("err", !!isErr);
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2600);
}
function initials(name) {
  return (name || "?").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
}
function countdown(dateStr) {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return "";
  const days = Math.round((new Date(y, m - 1, d) - new Date().setHours(0, 0, 0, 0)) / 86400000);
  if (days > 1) return `in ${days} days`;
  if (days === 1) return "tomorrow";
  if (days === 0) return "today!";
  return "wrapped";
}
function fmtDate(dateStr) {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y) return dateStr;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}
function slugFromPath() {
  const parts = location.pathname.split("/").filter(Boolean); // ["trip", "<slug>"]
  return decodeURIComponent(parts[1] || "");
}

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
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

const TRAVEL_ICON = { walk: "🚶", transit: "🚍", train: "🚆", bus: "🚌", drive: "🚗", bike: "🚲", ferry: "⛴️" };
const TRAVEL_LABEL = { walk: "Walk", transit: "Transit", train: "Train", bus: "Bus", drive: "Drive", bike: "Bike", ferry: "Ferry" };

function legHtml(travel) {
  if (!travel || (!travel.mode && !travel.duration && !travel.detail)) return "";
  const icon = TRAVEL_ICON[travel.mode] || "→";
  const bits = [TRAVEL_LABEL[travel.mode] || "", travel.duration, travel.detail].filter(Boolean).map(esc).join(" · ");
  return `<div class="leg"><span class="leg__chip">${icon} ${bits || "Travel"}</span></div>`;
}

function stopHtml(s, num, prevQuery) {
  const time = s.time ? `<span class="stop__time">${esc(s.time)}</span>` : "";
  const cat = s.category ? `<span class="stop__cat">${esc(s.category)}</span>` : "";
  const query = s.location || s.name || "";
  const mapUrl = s.locationUrl || (query ? Maps.searchUrl(query) : "");
  const loc = s.location
    ? `<div class="stop__loc">📍 ${mapUrl ? `<a href="${esc(mapUrl)}" target="_blank" rel="noopener noreferrer">${esc(s.location)}</a>` : esc(s.location)}</div>`
    : "";
  const hours = s.hours ? `<div class="stop__hours">🕑 ${esc(s.hours)}</div>` : "";
  const notes = s.notes ? `<div class="stop__notes">${esc(s.notes)}</div>` : "";
  const tip = s.tip ? `<div class="stop__tip"><b>Tip</b> · ${esc(s.tip)}</div>` : "";

  const links = [];
  if (mapUrl) links.push(`<a class="btn small" href="${esc(mapUrl)}" target="_blank" rel="noopener noreferrer">Open in Maps</a>`);
  const dir = query ? Maps.dirUrl(prevQuery, query) : "";
  if (dir && prevQuery) links.push(`<a class="btn small" href="${esc(dir)}" target="_blank" rel="noopener noreferrer">Directions from previous</a>`);
  const linkRow = links.length ? `<div class="stop__links">${links.join("")}</div>` : "";

  const embed = query ? Maps.embedUrl(query) : "";
  const mapSlot = embed ? `<div class="stop__map" data-embed="${esc(embed)}"></div>` : "";

  const hasDrawer = notes || tip || hours || linkRow || mapSlot;
  const drawer = hasDrawer
    ? `<div class="stop__drawer"><div class="stop__drawer-inner">${notes}${hours}${tip}${mapSlot}${linkRow}</div></div>`
    : "";

  return `
    <div class="stop">
      <div class="node">${num}</div>
      <div class="stop__card${hasDrawer ? " has-drawer" : ""}" ${hasDrawer ? 'data-toggle="1"' : ""}>
        <div class="stop__head">
          ${time}<span class="stop__name">${esc(s.name || "Untitled stop")}</span>${cat}
          ${hasDrawer ? '<span class="stop__chev">▾</span>' : ""}
        </div>
        ${loc}
        ${drawer}
      </div>
    </div>`;
}

function dayHtml(d, i) {
  const stops = Array.isArray(d.stops) ? d.stops : [];
  let prevQuery = "";
  const rows = stops
    .map((s, idx) => {
      const html = legHtml(s.travel) + stopHtml(s, idx + 1, prevQuery);
      prevQuery = s.location || s.name || prevQuery;
      return html;
    })
    .join("");
  return `
    <section class="day">
      <div class="day__label">${esc(d.label || `Day ${i + 1}`)}</div>
      ${d.note ? `<div class="day__note">${esc(d.note)}</div>` : ""}
      <div class="itin">${rows || '<div class="row__meta" style="padding-left:4px">No stops yet.</div>'}</div>
    </section>`;
}

function render(trip) {
  const c = trip.content || {};
  const days = Array.isArray(c.days) ? c.days : [];
  const crew = Array.isArray(c.crew) ? c.crew : [];
  document.title = `${trip.title} · Trip Planner`;

  const cd = countdown(trip.date);
  const metaSub = [fmtDate(trip.date), trip.subtitle].filter(Boolean).join(" · ");
  const crewHtml = crew.length
    ? `<div class="ticket__crew">
         <div class="ticket__avs">${crew.slice(0, 6).map((n) => `<span class="ticket__av">${esc(initials(n))}</span>`).join("")}</div>
         <span class="ticket__names">${crew.map(esc).join(", ")}</span>
       </div>`
    : "";

  const slug = trip.slug || trip.id;
  const editLabel = trip.canEdit ? "✎ Edit itinerary" : "💡 Suggest a change";
  const actions = `<div class="trip-actions"><a class="btn ${trip.canEdit ? "primary" : ""} small" href="/trip/${encodeURIComponent(slug)}/edit">${editLabel}</a></div>`;

  const hasBody = days.length || (c.overview && c.overview.trim());
  let body;
  if (hasBody) {
    body = `${c.overview ? `<p class="overview">${esc(c.overview)}</p>` : ""}${days.map(dayHtml).join("")}`;
  } else {
    body = `<div class="empty"><div class="big">🗺️</div><h3>${trip.canEdit ? "This trip is empty" : "Nothing planned yet"}</h3><p>${trip.canEdit ? "Open the builder to add days and stops." : "Check back soon, or suggest something to add."}</p></div>`;
  }

  $("#content").innerHTML = `
    <div class="ticket reveal">
      <div class="ticket__kicker">${esc(trip.emoji || "✈️")} Trip ${cd ? `<span class="ticket__count">${esc(cd)}</span>` : ""}</div>
      <div class="ticket__title">${esc(trip.title)}</div>
      ${metaSub ? `<div class="ticket__sub">${esc(metaSub)}</div>` : ""}
      ${crewHtml}
    </div>
    ${actions}
    ${body}`;
}

// Expand/collapse a stop drawer; lazily mount its map iframe the first time.
function onContentClick(e) {
  if (e.target.closest("a")) return; // let links through
  const card = e.target.closest('.stop__card[data-toggle="1"]');
  if (!card) return;
  const open = card.classList.toggle("open");
  if (open) {
    const slot = card.querySelector(".stop__map");
    if (slot && !slot.dataset.loaded && slot.dataset.embed) {
      slot.dataset.loaded = "1";
      const f = document.createElement("iframe");
      f.src = slot.dataset.embed;
      f.loading = "lazy";
      f.referrerPolicy = "no-referrer-when-downgrade";
      f.allowFullscreen = true;
      slot.appendChild(f);
    }
  }
}

(async function init() {
  const slug = slugFromPath();
  try {
    const { trip } = await api("GET", "/api/trips/" + encodeURIComponent(slug));
    render(trip);
    $("#content").addEventListener("click", onContentClick);
  } catch (err) {
    if (err.message === "redirecting") return;
    $("#content").innerHTML = `<div class="empty"><div class="big">🚧</div><h3>Couldn't load this trip</h3><p>${esc(err.message)}</p></div>`;
  }
})();
