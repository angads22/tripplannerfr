"use strict";

// The in-app itinerary builder. One form drives two flows:
//   • editors (admin / creator / elevated member) → Save writes the trip.
//   • everyone else who can view → Submit sends a change request for review.

const $ = (s, r = document) => r.querySelector(s);

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function toast(msg, isErr) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.toggle("err", !!isErr);
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2800);
}
function uid() {
  return (crypto.randomUUID && crypto.randomUUID()) || "id-" + Math.random().toString(36).slice(2);
}
function slugFromPath() {
  const parts = location.pathname.split("/").filter(Boolean); // ["trip", "<slug>", "edit"]
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

let TRIP = null;
let CAN_EDIT = false;
const state = { days: [] }; // overview/crew/meta read straight from their inputs

function blankStop() {
  return { id: uid(), time: "", name: "", category: "", location: "", locationUrl: "", hours: "", notes: "", tip: "", travel: { mode: "", duration: "", detail: "" } };
}

const TRAVEL_MODES = ["", "walk", "transit", "train", "bus", "drive", "bike", "ferry"];
const TRAVEL_MODE_LABEL = { "": "— how you get here —", walk: "🚶 Walk", transit: "🚍 Transit", train: "🚆 Train", bus: "🚌 Bus", drive: "🚗 Drive", bike: "🚲 Bike", ferry: "⛴️ Ferry" };
function blankDay() {
  return { id: uid(), label: "", note: "", stops: [blankStop()] };
}

// --- Render ---------------------------------------------------------------

function stopEditHtml(s) {
  const t = s.travel || {};
  const modeOpts = TRAVEL_MODES.map((m) => `<option value="${m}" ${t.mode === m ? "selected" : ""}>${esc(TRAVEL_MODE_LABEL[m])}</option>`).join("");
  return `
    <div class="stop-edit" data-stop data-id="${esc(s.id)}">
      <div class="stop-edit__label">Getting here (optional)</div>
      <div class="grid3">
        <select class="input" data-k="travel.mode">${modeOpts}</select>
        <input class="input" data-k="travel.duration" placeholder="12 min" value="${esc(t.duration)}" />
        <input class="input" data-k="travel.detail" placeholder="Route / line / note" value="${esc(t.detail)}" />
      </div>
      <div class="stop-edit__label">The stop</div>
      <div class="grid2">
        <input class="input" data-k="time" placeholder="Time (9:00 AM)" value="${esc(s.time)}" />
        <input class="input" data-k="name" placeholder="Stop name" value="${esc(s.name)}" />
      </div>
      <div class="grid2" style="margin-top:10px">
        <input class="input" data-k="category" placeholder="Category (food, sight…)" value="${esc(s.category)}" />
        <input class="input" data-k="location" placeholder="Location / address (used for the map)" value="${esc(s.location)}" />
      </div>
      <input class="input" data-k="hours" placeholder="Hours (optional, e.g. Open 11–22)" value="${esc(s.hours)}" style="margin-top:10px" />
      <textarea class="input" data-k="notes" placeholder="Notes" style="margin-top:10px">${esc(s.notes)}</textarea>
      <input class="input" data-k="tip" placeholder="Tip (optional)" value="${esc(s.tip)}" style="margin-top:10px" />
      <input class="input" data-k="locationUrl" placeholder="Custom map/website link (optional — auto-filled from location)" value="${esc(s.locationUrl)}" style="margin-top:10px" />
      <div class="map-preview" hidden></div>
      <div class="mini-actions" style="margin-top:10px">
        <button type="button" class="btn small" data-act="map-preview">🗺️ Preview map</button>
        <span style="flex:1"></span>
        <button type="button" class="iconbtn" data-act="stop-up" title="Move up">↑</button>
        <button type="button" class="iconbtn" data-act="stop-down" title="Move down">↓</button>
        <button type="button" class="iconbtn" data-act="stop-del" title="Remove stop">✕</button>
      </div>
    </div>`;
}

function dayEditHtml(d, i) {
  return `
    <div class="day-edit" data-day data-id="${esc(d.id)}">
      <div class="day-edit__head">
        <span class="day-edit__num">Day ${i + 1}</span>
        <input class="input" data-k="label" placeholder="Label (e.g. Fri · Arrival)" value="${esc(d.label)}" />
        <div class="mini-actions">
          <button type="button" class="iconbtn" data-act="day-up" title="Move up">↑</button>
          <button type="button" class="iconbtn" data-act="day-down" title="Move down">↓</button>
          <button type="button" class="iconbtn" data-act="day-del" title="Remove day">✕</button>
        </div>
      </div>
      <textarea class="input" data-k="note" placeholder="Day note (optional)" style="margin-bottom:12px">${esc(d.note)}</textarea>
      <div data-stops>${d.stops.map(stopEditHtml).join("")}</div>
      <button type="button" class="btn small" data-act="stop-add" style="margin-top:4px">+ Add stop</button>
    </div>`;
}

function renderDays() {
  $("#days").innerHTML = state.days.map(dayEditHtml).join("") ||
    '<div class="row__meta" style="padding:8px 0">No days yet — add the first one below.</div>';
}

function renderShell() {
  const c = TRIP.content || {};
  const slug = TRIP.slug || TRIP.id;
  $("#backlink").href = "/trip/" + encodeURIComponent(slug);

  const metaFields = CAN_EDIT ? `
    <div class="panel">
      <div class="panel__head"><h2>Trip details</h2></div>
      <div class="panel__body">
        <div class="row" style="gap:10px">
          <input class="input" id="f-emoji" style="width:64px" placeholder="🏙️" value="${esc(TRIP.emoji || "")}" />
          <input class="input" id="f-title" style="flex:1;min-width:140px" placeholder="Title" value="${esc(TRIP.title || "")}" />
          <input class="input" id="f-date" type="date" style="width:160px" value="${esc(TRIP.date || "")}" />
        </div>
        <div class="row" style="gap:10px;border-top:none;padding-top:0">
          <input class="input" id="f-sub" style="flex:1;min-width:160px" placeholder="Subtitle (optional)" value="${esc(TRIP.subtitle || "")}" />
          <input class="input" id="f-tags" style="flex:1;min-width:160px" placeholder="Tags, comma separated" value="${esc((TRIP.tags || []).join(", "))}" />
        </div>
      </div>
    </div>` : "";

  const messageField = CAN_EDIT ? "" : `
    <div class="panel">
      <div class="panel__head"><h2>Note to the trip's admin</h2><span class="muted">explain your suggestion (optional)</span></div>
      <div class="panel__body"><textarea class="input" id="f-message" placeholder="What did you change and why?"></textarea></div>
    </div>`;

  const saveLabel = CAN_EDIT ? "Save itinerary" : "Submit suggestion";

  // Trips that still use a hand-written custom page have no structured content,
  // so this builder opens blank. Explain that saving will take over the page.
  const isLegacy = TRIP.hasPage && !(c.days && c.days.length) && !((c.overview || "").trim());
  const banner = isLegacy && CAN_EDIT
    ? `<div class="banner">This trip currently uses a custom page. Building an itinerary here and saving will replace that page for everyone.</div>`
    : "";

  $("#editor").innerHTML = `
    <h1 class="page-title">${CAN_EDIT ? "Edit" : "Suggest a change"}</h1>
    <p class="page-sub">${esc(TRIP.emoji || "✈️")} ${esc(TRIP.title)}${CAN_EDIT ? "" : " — your edits go to the admin for approval."}</p>
    ${banner}

    ${metaFields}

    <div class="panel">
      <div class="panel__head"><h2>Overview</h2></div>
      <div class="panel__body">
        <textarea class="input" id="f-overview" placeholder="A short intro to the trip…">${esc(c.overview || "")}</textarea>
        <input class="input" id="f-crew" placeholder="Crew, comma separated (optional)" value="${esc((c.crew || []).join(", "))}" style="margin-top:12px" />
      </div>
    </div>

    <div class="sec-label">Itinerary</div>
    <div id="days"></div>
    <button type="button" class="btn" id="add-day">+ Add a day</button>

    ${messageField}

    <div class="editbar">
      <a class="btn ghost" href="/trip/${encodeURIComponent(slug)}">Cancel</a>
      <div class="header-spacer"></div>
      <button type="button" class="btn primary" id="save-btn">${saveLabel}</button>
    </div>`;

  renderDays();
}

// --- State sync -----------------------------------------------------------

function syncFromDom() {
  state.days = [...document.querySelectorAll("[data-day]")].map((dayEl) => ({
    id: dayEl.dataset.id || uid(),
    label: dayEl.querySelector('[data-k="label"]').value,
    note: dayEl.querySelector('[data-k="note"]').value,
    stops: [...dayEl.querySelectorAll("[data-stop]")].map((sEl) => {
      const v = (k) => {
        const el = sEl.querySelector(`[data-k="${k}"]`);
        return el ? el.value : "";
      };
      return {
        id: sEl.dataset.id || uid(),
        time: v("time"),
        name: v("name"),
        category: v("category"),
        location: v("location"),
        locationUrl: v("locationUrl"),
        hours: v("hours"),
        notes: v("notes"),
        tip: v("tip"),
        travel: { mode: v("travel.mode"), duration: v("travel.duration"), detail: v("travel.detail") },
      };
    }),
  }));
}

function collectContent() {
  syncFromDom();
  const csv = (v) => (v || "").split(",").map((x) => x.trim()).filter(Boolean);
  return {
    overview: $("#f-overview").value,
    crew: csv($("#f-crew").value),
    days: state.days,
  };
}

// --- Structural edits (delegated) -----------------------------------------

function move(arr, idx, dir) {
  const j = idx + dir;
  if (j < 0 || j >= arr.length) return;
  [arr[idx], arr[j]] = [arr[j], arr[idx]];
}

// Toggle a lazy, keyless map preview for a stop without re-rendering the form.
function toggleMapPreview(btn) {
  const stopEl = btn.closest("[data-stop]");
  const slot = stopEl.querySelector(".map-preview");
  if (!slot.hidden) {
    slot.hidden = true;
    slot.innerHTML = "";
    btn.textContent = "🗺️ Preview map";
    return;
  }
  const loc = stopEl.querySelector('[data-k="location"]').value.trim() || stopEl.querySelector('[data-k="name"]').value.trim();
  if (!loc) return toast("Add a location or name first.", true);
  const src = Maps.embedUrl(loc);
  if (!src) return;
  const f = document.createElement("iframe");
  f.src = src;
  f.loading = "lazy";
  f.referrerPolicy = "no-referrer-when-downgrade";
  slot.appendChild(f);
  slot.hidden = false;
  btn.textContent = "🗺️ Hide map";
}

function onDaysClick(e) {
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  if (btn.dataset.act === "map-preview") return toggleMapPreview(btn);
  syncFromDom();
  const dayEl = btn.closest("[data-day]");
  const dayIdx = [...document.querySelectorAll("[data-day]")].indexOf(dayEl);
  const act = btn.dataset.act;

  if (act === "day-del") {
    if (state.days[dayIdx] && (state.days[dayIdx].stops.length === 0 || confirm("Remove this whole day?"))) state.days.splice(dayIdx, 1);
  } else if (act === "day-up") {
    move(state.days, dayIdx, -1);
  } else if (act === "day-down") {
    move(state.days, dayIdx, 1);
  } else if (act === "stop-add") {
    state.days[dayIdx].stops.push(blankStop());
  } else {
    const stopEl = btn.closest("[data-stop]");
    const stopIdx = [...dayEl.querySelectorAll("[data-stop]")].indexOf(stopEl);
    if (act === "stop-del") state.days[dayIdx].stops.splice(stopIdx, 1);
    else if (act === "stop-up") move(state.days[dayIdx].stops, stopIdx, -1);
    else if (act === "stop-down") move(state.days[dayIdx].stops, stopIdx, 1);
  }
  renderDays();
}

async function onSave() {
  const btn = $("#save-btn");
  btn.disabled = true;
  try {
    const content = collectContent();
    const slug = TRIP.slug || TRIP.id;
    if (CAN_EDIT) {
      const body = { content };
      body.emoji = $("#f-emoji").value.trim();
      body.title = $("#f-title").value.trim();
      body.date = $("#f-date").value;
      body.subtitle = $("#f-sub").value.trim();
      body.tags = $("#f-tags").value.split(",").map((x) => x.trim()).filter(Boolean);
      await api("PUT", "/api/trips/" + TRIP.id, body);
      toast("Saved.");
    } else {
      await api("POST", "/api/trips/" + TRIP.id + "/requests", { content, message: $("#f-message").value.trim() });
      toast("Suggestion sent for review.");
    }
    setTimeout(() => (location.href = "/trip/" + encodeURIComponent(slug)), 700);
  } catch (err) {
    if (err.message !== "redirecting") toast(err.message, true);
    btn.disabled = false;
  }
}

// --- Boot -----------------------------------------------------------------

(async function init() {
  const slug = slugFromPath();
  try {
    TRIP = (await api("GET", "/api/trips/" + encodeURIComponent(slug))).trip;
    CAN_EDIT = !!TRIP.canEdit;
    state.days = (TRIP.content && Array.isArray(TRIP.content.days) ? TRIP.content.days : []).map((d) => ({
      id: d.id || uid(),
      label: d.label || "",
      note: d.note || "",
      stops: (Array.isArray(d.stops) ? d.stops : []).map((s) => ({ ...blankStop(), ...s, id: s.id || uid() })),
    }));
    if (!state.days.length) state.days = [blankDay()];

    renderShell();
    $("#days").addEventListener("click", onDaysClick);
    $("#add-day").addEventListener("click", () => {
      syncFromDom();
      state.days.push(blankDay());
      renderDays();
    });
    $("#save-btn").addEventListener("click", onSave);
  } catch (err) {
    if (err.message === "redirecting") return;
    $("#editor").innerHTML = `<div class="empty"><div class="big">🚧</div><h3>Couldn't open the editor</h3><p>${esc(err.message)}</p></div>`;
  }
})();
