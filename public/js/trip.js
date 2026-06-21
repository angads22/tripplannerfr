"use strict";

const $ = (s, r = document) => r.querySelector(s);
const slug = decodeURIComponent(location.pathname.replace(/^\/trip\//, "").replace(/\/$/, ""));
// Join code carried in a shared invite link, e.g. /trip/toronto?j=ab12cd34ef
const JOIN_CODE = new URLSearchParams(location.search).get("j") || new URLSearchParams(location.search).get("code") || "";

let ME = null;
let TRIP = null;

function toast(msg, isErr) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.toggle("err", !!isErr);
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2600);
}
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function initials(name) {
  return (name || "?").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
}
const AV_COLORS = ["#E23B26", "#2D6CA2", "#3E8E5A", "#F4B528", "#1C1815", "#C8741C"];
function avatarColor(seed) {
  let h = 0;
  for (const ch of String(seed || "")) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AV_COLORS[h % AV_COLORS.length];
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

function countdown(dateStr) {
  if (!dateStr) return { label: "someday", cls: "past" };
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y) return { label: "someday", cls: "past" };
  const days = Math.round((new Date(y, m - 1, d) - new Date().setHours(0, 0, 0, 0)) / 86400000);
  if (days > 1) return { label: `${days} days to go`, cls: "soon" };
  if (days === 1) return { label: "tomorrow!", cls: "soon" };
  if (days === 0) return { label: "today!", cls: "today" };
  return { label: "wrapped", cls: "past" };
}
function fmtDate(dateStr) {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y) return dateStr;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

function renderHead() {
  const cd = countdown(TRIP.date);
  const tags = (TRIP.tags || []).map((x) => `<span class="chip" style="background:rgba(244,236,221,.14);border-color:rgba(255,255,255,.2);color:var(--on-dark)">${esc(x)}</span>`).join("");
  $("#tripHead").innerHTML = `
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
      <div class="kicker">${esc(cd.label)}</div>
    </div>
    <div style="font-size:38px;line-height:1;margin-top:6px">${esc(TRIP.emoji || "🚗")}</div>
    <div class="hero__title" style="font-size:clamp(34px,9vw,52px);margin:8px 0 6px">${esc(TRIP.title)}</div>
    <div class="trip__date" style="color:var(--muted-dark)">${[fmtDate(TRIP.date), esc(TRIP.subtitle || "")].filter(Boolean).join(" · ").toUpperCase()}</div>
    ${tags ? `<div class="trip__tags" style="margin-top:12px">${tags}</div>` : ""}
    <div class="hero__body" style="margin-top:12px">Started by ${esc(TRIP.creatorName || "someone")}.</div>`;
}

function renderCrew() {
  $("#crewCount").textContent = `${TRIP.memberCount} ${TRIP.memberCount === 1 ? "person" : "people"}`;
  const canRemove = TRIP.canRemoveMembers;
  $("#crewList").innerHTML = (TRIP.members || []).map((m) => {
    const removable = canRemove && m.id && m.id !== TRIP.creatorId;
    return `
      <div class="crew-item">
        <span class="crew-item__face" style="background:${avatarColor(m.displayName)}">${esc(initials(m.displayName))}</span>
        <span class="crew-item__name">${esc(m.displayName)}</span>
        ${m.id ? "" : '<span class="crew-item__tag">no account</span>'}
        ${removable ? `<button class="crew-item__x" data-remove="${esc(m.id)}" title="Remove">✕</button>` : ""}
      </div>`;
  }).join("") || '<p class="row__meta">No one yet.</p>';

  // Add row visible to anyone on the trip.
  $("#addRow").style.display = TRIP.canAddMembers ? "flex" : "none";
  $("#addHint").textContent = TRIP.canAddMembers
    ? (TRIP.canRemoveMembers ? "You can add or remove people (you started this trip)." : "You're on this trip, so you can invite others. Only the creator can remove people.")
    : "";
}

// Quick-add chips for your friends who aren't on the trip yet.
let FRIENDS = null;
async function renderFriendAdd() {
  const box = $("#friendAdd");
  if (!TRIP.canAddMembers) { box.style.display = "none"; return; }
  if (FRIENDS === null) {
    try { FRIENDS = (await api("/api/friends")).friends || []; } catch { FRIENDS = []; }
  }
  const onTrip = new Set((TRIP.members || []).map((m) => m.id).filter(Boolean));
  const addable = FRIENDS.filter((f) => !onTrip.has(f.id));
  if (!addable.length) { box.style.display = "none"; return; }
  box.style.display = "block";
  $("#friendChips").innerHTML = addable.map((f) => `<button class="btn small" data-addfriend="${esc(f.id)}">＋ ${esc(f.displayName)}</button>`).join("");
}

function relTime(iso) {
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 60) return "just now";
  if (d < 3600) return Math.floor(d / 60) + "m ago";
  if (d < 86400) return Math.floor(d / 3600) + "h ago";
  return Math.floor(d / 86400) + "d ago";
}

function mapsSearch(place) {
  return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(place);
}

function renderStops() {
  const stops = TRIP.stops || [];
  $("#stopCount").textContent = stops.length ? `${stops.length} ${stops.length === 1 ? "stop" : "stops"}` : "";
  const canEdit = TRIP.canEditPlan;
  $("#stopList").innerHTML = stops.map((s) => `
      <div class="crew-item" data-stop="${esc(s.id)}">
        <span class="crew-item__face" style="background:var(--accent);font-size:11px">${esc(s.time || "·")}</span>
        <div style="flex:1">
          <div class="crew-item__name">${esc(s.title)}</div>
          ${s.note ? `<div class="crew-item__tag">${esc(s.note)}</div>` : ""}
          ${s.place ? `<a class="crew-item__tag" style="color:var(--accent)" href="${mapsSearch(s.place)}" target="_blank" rel="noopener">📍 ${esc(s.place)}</a>` : ""}
        </div>
        ${canEdit ? `<button class="crew-item__x" data-delstop="${esc(s.id)}" title="Remove">✕</button>` : ""}
      </div>`).join("") || '<p class="row__meta">No stops yet. Add the first one below.</p>';
  $("#addStopRow").style.display = canEdit ? "flex" : "none";
}

function renderMap() {
  const has = !!TRIP.mapUrl;
  $("#mapState").textContent = has ? "Map is set." : "No map yet.";
  const open = $("#mapOpen");
  open.style.display = has ? "" : "none";
  if (has) open.href = TRIP.mapUrl;
  $("#mapEditRow").style.display = TRIP.canEditPlan ? "flex" : "none";
}

function renderProposals() {
  const props = TRIP.proposals || [];
  $("#propCount").textContent = props.length ? `${props.length} open` : "";
  const canResolve = TRIP.canManage;
  $("#propList").innerHTML = props.map((p) => `
      <div class="crew-item">
        <span class="crew-item__face" style="background:${avatarColor(p.userName)}">${esc(initials(p.userName))}</span>
        <div style="flex:1">
          <div class="crew-item__name">${esc(p.text)}</div>
          <div class="crew-item__tag">${esc(p.userName)} · ${esc(relTime(p.ts))}</div>
        </div>
        ${canResolve ? `<button class="btn small" data-done="${esc(p.id)}" title="Mark done">✓</button><button class="crew-item__x" data-dismiss="${esc(p.id)}" title="Dismiss">✕</button>` : ""}
      </div>`).join("") || '<p class="row__meta">No open suggestions.</p>';
  // anyone on the trip can suggest
  $("#propAddRow").style.display = TRIP.canAddMembers ? "flex" : "none";
}

function renderLog() {
  const log = TRIP.activity || [];
  $("#logList").innerHTML = log.map((a) => `
      <div class="crew-item">
        <span class="crew-item__face" style="background:${avatarColor(a.userName)}">${esc(initials(a.userName))}</span>
        <div style="flex:1">
          <div class="crew-item__name" style="font-weight:600;font-size:13.5px"><b>${esc(a.userName)}</b> ${esc(a.text)}</div>
          <div class="crew-item__tag">${esc(relTime(a.ts))}</div>
        </div>
      </div>`).join("") || '<p class="row__meta">Nothing yet.</p>';
}

async function loadDirectory() {
  try {
    const { users } = await api("/api/users/directory");
    $("#userList").innerHTML = users.map((u) => `<option value="${esc(u.username)}">${esc(u.displayName)}</option>`).join("");
  } catch { /* non-fatal */ }
}

async function reload() {
  const q = JOIN_CODE ? "?code=" + encodeURIComponent(JOIN_CODE) : "";
  const { trip } = await api("/api/trips/" + encodeURIComponent(slug) + q);
  TRIP = trip;
  // theme: keyword via data-theme, custom #hex via inline accent
  const theme = trip.theme || "red";
  if (theme.charAt(0) === "#") {
    document.body.setAttribute("data-theme", "custom");
    document.body.style.setProperty("--accent", theme);
  } else {
    document.body.style.removeProperty("--accent");
    document.body.setAttribute("data-theme", theme);
  }
  // join banner for people who arrived via a shared link but aren't on it yet
  const onTrip = trip.isMember || trip.isCreator;
  $("#joinBanner").style.display = onTrip ? "none" : "block";
  renderHead();
  renderCrew();
  renderFriendAdd();
  renderStops();
  renderMap();
  renderProposals();
  renderLog();
  $("#manageBar").style.display = trip.canManage ? "block" : "none";
  if (trip.canManage) {
    $("#editThemes").querySelectorAll(".theme-dot").forEach((d) => d.classList.toggle("sel", d.dataset.theme === (trip.theme || "red")));
  }
}

(async function init() {
  try {
    ME = (await api("/api/auth/me")).user;
    if (!ME) return (location.href = "/login.html?next=" + encodeURIComponent(location.pathname));
    await reload();
    await loadDirectory();
  } catch (e) {
    toast(e.message, true);
    return;
  }

  // Add member
  $("#addBtn").addEventListener("click", async () => {
    const username = $("#addUser").value.trim();
    if (!username) return;
    try {
      await api("/api/trips/" + encodeURIComponent(TRIP.id) + "/members", "POST", { username });
      $("#addUser").value = "";
      await reload();
      toast("Added to the trip.");
    } catch (e) {
      toast(e.message, true);
    }
  });

  // Remove member (creator only)
  $("#crewList").addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-remove]");
    if (!btn) return;
    if (!confirm("Remove this person from the trip?")) return;
    try {
      await api("/api/trips/" + encodeURIComponent(TRIP.id) + "/members/" + encodeURIComponent(btn.dataset.remove), "DELETE");
      await reload();
      toast("Removed.");
    } catch (e) {
      toast(e.message, true);
    }
  });

  // Copy a private invite link (includes the trip's join code) to this trip
  $("#shareBtn").addEventListener("click", async () => {
    if (!TRIP.joinCode) return toast("Only people on the trip can copy the invite link.", true);
    const url = location.origin + "/trip/" + encodeURIComponent(slug) + "?j=" + encodeURIComponent(TRIP.joinCode);
    try {
      await navigator.clipboard.writeText(url);
      toast("Invite link copied! Only people you send it to can join.");
    } catch {
      prompt("Copy this private invite link:", url);
    }
  });

  // Copy just the trip code (for people to paste on their dashboard)
  $("#codeBtn").addEventListener("click", async () => {
    if (!TRIP.joinCode) return toast("Only people on the trip can copy the code.", true);
    try {
      await navigator.clipboard.writeText(TRIP.joinCode);
      toast("Code copied: " + TRIP.joinCode);
    } catch {
      prompt("Trip code (paste it on the dashboard to join):", TRIP.joinCode);
    }
  });

  // Duplicate this trip into a private copy you own
  $("#dupBtn").addEventListener("click", async () => {
    if (!confirm(`Make your own private copy of "${TRIP.title}"?`)) return;
    try {
      const { trip } = await api("/api/trips/" + encodeURIComponent(TRIP.id) + "/duplicate", "POST", JOIN_CODE ? { code: JOIN_CODE } : {});
      toast("Duplicated — opening your copy…");
      location.href = "/trip/" + encodeURIComponent(trip.slug);
    } catch (e) {
      toast(e.message, true);
    }
  });

  // Join via the shared invite link (uses the code from the URL)
  $("#joinBtn").addEventListener("click", async () => {
    try {
      await api("/api/trips/" + encodeURIComponent(TRIP.id) + "/join", "POST", JOIN_CODE ? { code: JOIN_CODE } : {});
      await reload();
      toast("You're on the trip!");
    } catch (e) {
      toast(e.message, true);
    }
  });

  // Suggest a change (any member)
  $("#propAdd").addEventListener("click", async () => {
    const text = $("#propInput").value.trim();
    if (!text) return;
    try {
      await api("/api/trips/" + encodeURIComponent(TRIP.id) + "/proposals", "POST", { text });
      $("#propInput").value = "";
      await reload();
      toast("Suggestion sent to the group.");
    } catch (e) {
      toast(e.message, true);
    }
  });

  // Resolve a suggestion (creator/admin)
  $("#propList").addEventListener("click", async (e) => {
    const done = e.target.closest("[data-done]");
    const dismiss = e.target.closest("[data-dismiss]");
    if (!done && !dismiss) return;
    const pid = (done || dismiss).dataset.done || (done || dismiss).dataset.dismiss;
    try {
      await api("/api/trips/" + encodeURIComponent(TRIP.id) + "/proposals/" + encodeURIComponent(pid), "PUT", { status: done ? "done" : "dismissed" });
      await reload();
    } catch (e) {
      toast(e.message, true);
    }
  });

  // Add a stop (any member)
  $("#st-add").addEventListener("click", async () => {
    const title = $("#st-title").value.trim();
    if (!title) return toast("Give the stop a name.", true);
    try {
      await api("/api/trips/" + encodeURIComponent(TRIP.id) + "/stops", "POST", {
        time: $("#st-time").value,
        title,
        place: $("#st-place").value.trim(),
      });
      $("#st-time").value = $("#st-title").value = $("#st-place").value = "";
      await reload();
      toast("Stop added.");
    } catch (e) {
      toast(e.message, true);
    }
  });

  // Remove a stop (any member)
  $("#stopList").addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-delstop]");
    if (!btn) return;
    try {
      await api("/api/trips/" + encodeURIComponent(TRIP.id) + "/stops/" + encodeURIComponent(btn.dataset.delstop), "DELETE");
      await reload();
      toast("Stop removed.");
    } catch (e) {
      toast(e.message, true);
    }
  });

  // Save the map (any member)
  $("#mapSave").addEventListener("click", async () => {
    try {
      await api("/api/trips/" + encodeURIComponent(TRIP.id) + "/map", "PUT", { mapUrl: $("#mapInput").value.trim() });
      $("#mapInput").value = "";
      await reload();
      toast("Map updated.");
    } catch (e) {
      toast(e.message, true);
    }
  });

  // Theme change (creator/admin) — presets
  $("#editThemes").addEventListener("click", async (e) => {
    const d = e.target.closest(".theme-dot[data-theme]");
    if (!d) return;
    try {
      await api("/api/trips/" + encodeURIComponent(TRIP.id), "PUT", { theme: d.dataset.theme });
      await reload();
      toast("Theme updated.");
    } catch (e) {
      toast(e.message, true);
    }
  });
  // Theme change — custom color
  $("#editCustom").addEventListener("change", async (e) => {
    try {
      await api("/api/trips/" + encodeURIComponent(TRIP.id), "PUT", { theme: e.target.value });
      await reload();
      toast("Theme updated.");
    } catch (err) {
      toast(err.message, true);
    }
  });

  // Reset the private invite link (creator/admin) — revokes old links
  $("#resetLinkBtn").addEventListener("click", async () => {
    if (!confirm("Reset the invite link? Anyone you sent the old link to won't be able to join with it anymore.")) return;
    try {
      const { trip } = await api("/api/trips/" + encodeURIComponent(TRIP.id) + "/rotate-code", "POST");
      TRIP = trip;
      const url = location.origin + "/trip/" + encodeURIComponent(slug) + "?j=" + encodeURIComponent(trip.joinCode);
      try { await navigator.clipboard.writeText(url); toast("New invite link copied."); }
      catch { prompt("New private invite link:", url); }
    } catch (e) {
      toast(e.message, true);
    }
  });

  // Delete trip (creator/admin)
  $("#deleteBtn").addEventListener("click", async () => {
    if (!confirm(`Delete "${TRIP.title}"? This can't be undone.`)) return;
    try {
      await api("/api/trips/" + encodeURIComponent(TRIP.id), "DELETE");
      location.href = "/";
    } catch (e) {
      toast(e.message, true);
    }
  });

  // Quick-add a friend to the trip
  $("#friendChips").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-addfriend]");
    if (!b) return;
    try {
      await api("/api/trips/" + encodeURIComponent(TRIP.id) + "/members", "POST", { userId: b.dataset.addfriend });
      await reload();
      toast("Added to the trip.");
    } catch (err) {
      toast(err.message, true);
    }
  });

  // Live updates: refresh the trip every 15s so others' changes appear without
  // a manual reload. Skip while the user is typing or a dialog is open.
  setInterval(() => {
    const ae = document.activeElement;
    if (ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) return;
    reload().catch(() => {});
  }, 15000);
})();
