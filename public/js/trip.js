"use strict";

const $ = (s, r = document) => r.querySelector(s);
const slug = decodeURIComponent(location.pathname.replace(/^\/trip\//, "").replace(/\/$/, ""));
// Join code carried in a shared invite link, e.g. /trip/toronto?j=ab12cd34ef
const JOIN_CODE = new URLSearchParams(location.search).get("j") || new URLSearchParams(location.search).get("code") || "";

let ME = null;
let TRIP = null;
// Signature of the last-rendered trip, so the 5s poll can skip the (heavy)
// full re-render when nothing actually changed — no flicker, far less work.
let LAST_TRIP_SIG = "";

// One-tap starter stops so adding the plan isn't a blank form every time.
const STOP_TEMPLATES = [
  { label: "🤝 Meet up", title: "Meet up & depart" },
  { label: "☕ Coffee", title: "Coffee break" },
  { label: "🍴 Lunch", title: "Lunch" },
  { label: "🍽️ Dinner", title: "Dinner" },
  { label: "🍻 Drinks", title: "Drinks" },
  { label: "⛽ Gas + snacks", title: "Gas + snacks" },
  { label: "🏨 Check in", title: "Check in" },
  { label: "📸 Photo stop", title: "Photo stop" },
  { label: "🧭 Explore", title: "Explore" },
  { label: "🎟️ Main event", title: "Main event" },
  { label: "🛍️ Shopping", title: "Shopping" },
  { label: "🏡 Head home", title: "Head home" },
];

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
  const cover = TRIP.coverUrl ? `<img class="hero__cover" src="${esc(TRIP.coverUrl)}" alt="" onerror="this.remove()" />` : "";
  const desc = TRIP.description ? `<div class="trip-desc">${esc(TRIP.description)}</div>` : "";
  $("#tripHead").innerHTML = `
    ${cover}
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
      <div class="kicker">${esc(cd.label)}</div>
    </div>
    <div style="font-size:38px;line-height:1;margin-top:6px">${esc(TRIP.emoji || "🚗")}</div>
    <div class="hero__title" style="font-size:clamp(34px,9vw,52px);margin:8px 0 6px">${esc(TRIP.title)}</div>
    <div class="trip__date" style="color:var(--muted-dark)">${[fmtDate(TRIP.date), esc(TRIP.subtitle || "")].filter(Boolean).join(" · ").toUpperCase()}</div>
    ${tags ? `<div class="trip__tags" style="margin-top:12px">${tags}</div>` : ""}
    ${desc}
    <div class="hero__body" style="margin-top:12px">Started by ${esc(TRIP.creatorName || "someone")}.</div>`;
}

function renderCrew() {
  $("#crewCount").textContent = `${TRIP.memberCount} ${TRIP.memberCount === 1 ? "person" : "people"}`;
  const canRemove = TRIP.canRemoveMembers;
  $("#crewList").innerHTML = (TRIP.members || []).map((m) => {
    const removable = canRemove && m.id && m.id !== TRIP.creatorId;
    const isCreator = m.id && m.id === TRIP.creatorId;
    const faceStyle = m.avatarImage
      ? `background:url('${m.avatarImage}') center/cover no-repeat`
      : `background:${m.avatarColor || avatarColor(m.displayName)}`;
    const face = m.avatarImage ? "" : (m.avatarEmoji || esc(initials(m.displayName)));
    return `
      <div class="crew-item">
        <span class="crew-item__face" style="${faceStyle}">${face}</span>
        <span class="crew-item__name">${esc(m.displayName)}</span>
        ${isCreator ? '<span class="crew-item__tag">host</span>' : ""}
        ${removable ? `<button class="crew-item__x" data-remove="${esc(m.id)}" title="Remove from trip">✕</button>` : ""}
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
  $("#friendChips").innerHTML = addable.map((f) => {
    const faceStyle = f.avatarImage
      ? `background:url('${f.avatarImage}') center/cover no-repeat`
      : `background:${f.avatarColor || avatarColor(f.displayName)}`;
    const face = f.avatarImage ? "" : (f.avatarEmoji || esc(initials(f.displayName)));
    return `<button class="friend-chip" data-addfriend="${esc(f.id)}" title="Add ${esc(f.displayName)} to the trip">
      <span class="friend-chip__face" style="${faceStyle}">${face}</span>
      <span>${esc(f.displayName)}</span>
      <span class="friend-chip__plus">＋</span>
    </button>`;
  }).join("");
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

let EDIT_STOP = null; // id of the stop being edited inline
function stopEditRow(s) {
  return `
      <div class="crew-item stop-edit" data-stop="${esc(s.id)}">
        <div style="flex:1;display:flex;flex-direction:column;gap:8px">
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <input class="input se-f" data-f="time" value="${esc(s.time || "")}" placeholder="time" style="width:90px" />
            <input class="input se-f" data-f="title" value="${esc(s.title || "")}" placeholder="what's the stop" style="flex:1;min-width:120px" />
          </div>
          <input class="input se-f" data-f="place" value="${esc(s.place || "")}" placeholder="place (optional, links to maps)" />
          <input class="input se-f" data-f="note" value="${esc(s.note || "")}" placeholder="note (optional)" />
          <div style="display:flex;gap:8px">
            <button class="btn primary small" data-savestop="${esc(s.id)}">Save</button>
            <button class="btn small" data-canceledit="1">Cancel</button>
          </div>
        </div>
      </div>`;
}

function renderStops() {
  const stops = TRIP.stops || [];
  $("#stopCount").textContent = stops.length ? `${stops.length} ${stops.length === 1 ? "stop" : "stops"}` : "";
  const canEdit = TRIP.canEditPlan;
  $("#stopList").innerHTML = stops.map((s, i) => (s.id === EDIT_STOP ? stopEditRow(s) : `
      <div class="crew-item stop-row${s.done ? " stop-done" : ""}" data-stop="${esc(s.id)}" ${canEdit ? 'draggable="true"' : ""}>
        ${canEdit ? '<span class="grip" title="Drag to reorder" aria-hidden="true"></span>' : ""}
        <input type="checkbox" class="stop-check" data-check="${esc(s.id)}" ${s.done ? "checked" : ""} ${canEdit ? "" : "disabled"} title="Check off" />
        <span class="crew-item__face" style="background:var(--accent);font-size:11px">${esc(s.time || "·")}</span>
        <div style="flex:1">
          <div class="crew-item__name stop-title">${esc(s.title)}</div>
          ${s.note ? `<div class="crew-item__tag">${esc(s.note)}</div>` : ""}
          ${s.place ? `<a class="crew-item__tag" style="color:var(--accent)" href="${mapsSearch(s.place)}" target="_blank" rel="noopener">${esc(s.place)}</a>` : ""}
        </div>
        ${canEdit ? `
          <button class="crew-item__x mv" data-move="${esc(s.id)}" data-dir="up" title="Move up" ${i === 0 ? "disabled" : ""}>↑</button>
          <button class="crew-item__x mv" data-move="${esc(s.id)}" data-dir="down" title="Move down" ${i === stops.length - 1 ? "disabled" : ""}>↓</button>
          <button class="crew-item__x" data-editstop="${esc(s.id)}" title="Edit">✎</button>
          <button class="crew-item__x" data-delstop="${esc(s.id)}" title="Remove">✕</button>` : ""}
      </div>`)).join("") || '<p class="row__meta">No stops yet. Add the first one below.</p>';
  $("#addStopRow").style.display = canEdit ? "flex" : "none";
  const tw = $("#stopTemplatesWrap");
  if (tw) tw.style.display = canEdit ? "block" : "none";
}

// Render the one-tap stop-template chips (built once).
function renderStopTemplates() {
  const box = $("#stopTemplates");
  if (!box || box.dataset.built) return;
  box.innerHTML = STOP_TEMPLATES.map((t, i) => `<button type="button" class="vibe-chip" data-stoptpl="${i}">${esc(t.label)}</button>`).join("");
  box.dataset.built = "1";
}

function renderMap() {
  const has = !!TRIP.mapUrl;
  $("#mapState").textContent = has ? "Map is set." : "No map yet.";
  const open = $("#mapOpen");
  open.style.display = has ? "" : "none";
  if (has) open.href = TRIP.mapUrl;
  $("#mapEditRow").style.display = TRIP.canEditPlan ? "flex" : "none";
}

// --- Group chat -----------------------------------------------------------
let CHAT_SIG = "";
async function loadChat() {
  if (!TRIP) return;
  const onTrip = TRIP.isMember || TRIP.isCreator;
  $("#chatAddRow").style.display = onTrip ? "flex" : "none";
  let messages = [];
  try {
    const q = JOIN_CODE ? "?code=" + encodeURIComponent(JOIN_CODE) : "";
    messages = (await api("/api/trips/" + encodeURIComponent(TRIP.id) + "/messages" + q)).messages || [];
  } catch { return; }
  const sig = messages.map((m) => m.id).join(",");
  if (sig === CHAT_SIG) return; // nothing new; don't disrupt scroll
  CHAT_SIG = sig;
  const box = $("#chatList");
  box.innerHTML = messages.length
    ? messages.map((m) => {
        const mine = ME && m.userId === ME.id;
        const canDel = mine || TRIP.canManage;
        return `<div class="msg${mine ? " mine" : ""}">
          ${mine ? "" : `<span class="msg__who">${esc(m.userName)}</span>`}
          <span class="msg__bubble">${esc(m.text)}${canDel ? `<button class="msg__del" data-delmsg="${esc(m.id)}" title="Delete">×</button>` : ""}</span>
          <span class="msg__time">${esc(relTime(m.ts))}</span>
        </div>`;
      }).join("")
    : '<p class="row__meta">No messages yet — start the conversation.</p>';
  box.scrollTop = box.scrollHeight;
}

async function loadFiles() {
  if (!TRIP || !ME || !ME.isEarlyBird) {
    $("#sharedDriveSection").style.display = "none";
    return;
  }
  $("#sharedDriveSection").style.display = (TRIP.isMember || TRIP.isCreator) ? "block" : "none";
  $("#uploadRow").style.display = (TRIP.isMember || TRIP.isCreator) ? "flex" : "none";
  let files = [];
  try {
    files = (await api("/api/trips/" + encodeURIComponent(TRIP.id) + "/files")).files || [];
  } catch { return; }
  $("#fileList").innerHTML = files.length
    ? files.map((f) => `<div class="crew-item">
        <div style="flex:1">
          <div class="crew-item__name"><a href="/trip-files/${TRIP.id}/${encodeURIComponent(f.name)}" target="_blank">${esc(f.name)}</a></div>
        </div>
        <div class="row__actions">
          <button class="crew-item__x" data-delfile="${esc(f.name)}" title="Delete">×</button>
        </div>
      </div>`).join("")
    : '<p class="row__meta">No files shared yet.</p>';
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
  const canDeleteActivity = TRIP.canManage; // creator only (admin prunes via the admin panel)
  $("#logList").innerHTML = log.map((a) => `
      <div class="crew-item">
        <span class="crew-item__face" style="background:${avatarColor(a.userName)}">${esc(initials(a.userName))}</span>
        <div style="flex:1">
          <div class="crew-item__name" style="font-weight:600;font-size:13.5px"><b>${esc(a.userName)}</b> ${esc(a.text)}</div>
          <div class="crew-item__tag">${esc(relTime(a.ts))}</div>
        </div>
        ${canDeleteActivity ? `<button class="crew-item__x" data-delactivity="${esc(a.id)}" title="Delete activity">✕</button>` : ""}
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
  // vibe: drives the whole-page background mood (always cheap to apply)
  document.body.setAttribute("data-vibe", trip.vibe || "classic");
  renderStopTemplates();

  // Skip the heavy DOM rebuild when nothing changed since the last render
  // (the 5s poll calls reload() constantly). Theme/vibe above are already
  // applied, so the page still tracks live colour changes.
  const sig = JSON.stringify(trip);
  if (sig === LAST_TRIP_SIG) return;
  LAST_TRIP_SIG = sig;

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
  await loadFiles();
  // Any member can edit details/theme; only the creator sees the destructive
  // actions (reset invite link, delete trip). Admin overrides live in the
  // admin panel, not here.
  $("#manageBar").style.display = trip.canEditPlan ? "block" : "none";
  $("#rowInviteLink").style.display = trip.canManage ? "" : "none";
  $("#rowDelete").style.display = trip.canManage ? "" : "none";
  $("#quickEditBtn").style.display = trip.canEditPlan ? "" : "none";
  // A member who didn't create the trip can leave it.
  $("#leaveBtn").style.display = trip.canLeave ? "" : "none";
  if (trip.canEditPlan) {
    // Populate the edit-details form (only when not actively editing it).
    const ae = document.activeElement;
    if (!ae || !/^ed-/.test(ae.id || "")) {
      $("#ed-title").value = trip.title || "";
      $("#ed-date").value = trip.date || "";
      $("#ed-sub").value = trip.subtitle || "";
      $("#ed-desc").value = trip.description || "";
      $("#ed-cover").value = trip.coverUrl || "";
      $("#ed-tags").value = (trip.tags || []).join(", ");
    }
    $("#editThemes").querySelectorAll(".theme-dot").forEach((d) => d.classList.toggle("sel", d.dataset.theme === (trip.theme || "red")));
    $("#editVibes").querySelectorAll(".vibe-chip").forEach((c) => c.classList.toggle("sel", c.dataset.vibe === (trip.vibe || "classic")));
  }
}

// Collapsible sections — each section header toggles the panel under it,
// remembered per trip + per user in localStorage.
function initCollapsible() {
  document.querySelectorAll(".sec-row").forEach((row) => {
    if (row.dataset.collapsibleReady) return;
    const label = row.querySelector(".sec-row__label");
    const panel = row.nextElementSibling && row.nextElementSibling.classList.contains("panel") ? row.nextElementSibling : null;
    if (!label || !panel) return;
    row.dataset.collapsibleReady = "1";
    const key = "collapse:" + slug + ":" + label.textContent.trim();
    const caret = document.createElement("span");
    caret.className = "sec-caret";
    caret.textContent = "▾";
    row.appendChild(caret);
    row.style.cursor = "pointer";
    const apply = (c) => { panel.style.display = c ? "none" : ""; caret.classList.toggle("closed", c); };
    apply(localStorage.getItem(key) === "1");
    row.addEventListener("click", (e) => {
      if (e.target.closest("button, a, input, textarea")) return;
      const collapsed = localStorage.getItem(key) !== "1";
      localStorage.setItem(key, collapsed ? "1" : "0");
      apply(collapsed);
    });
  });
}

(async function init() {
  // Auth gate first — if this fails the page can't work, so bail/redirect.
  try {
    ME = (await api("/api/auth/me")).user;
    if (!ME) return (location.href = "/login.html?next=" + encodeURIComponent(location.pathname));
  } catch (e) {
    toast(e.message, true);
    return;
  }

  // Load the trip + supporting data. A failure here is surfaced but must NOT
  // skip the event-listener wiring below — otherwise the add/remove/share
  // buttons silently stop working after one flaky fetch.
  try {
    await reload();
    await loadChat();
    await loadDirectory();
    initCollapsible();
  } catch (e) {
    toast(e.message, true);
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

  // Check a stop off as you go (any member)
  // Drag-and-drop reorder (desktop). The ↑/↓ buttons cover touch.
  let DRAG_ID = null;
  $("#stopList").addEventListener("dragstart", (e) => {
    const row = e.target.closest("[data-stop]");
    if (!row) return;
    DRAG_ID = row.dataset.stop;
    row.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
    try { e.dataTransfer.setData("text/plain", DRAG_ID); } catch {}
  });
  $("#stopList").addEventListener("dragend", (e) => {
    const row = e.target.closest("[data-stop]");
    if (row) row.classList.remove("dragging");
    DRAG_ID = null;
  });
  $("#stopList").addEventListener("dragover", (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; });
  $("#stopList").addEventListener("drop", async (e) => {
    e.preventDefault();
    const target = e.target.closest("[data-stop]");
    if (!DRAG_ID || !target || target.dataset.stop === DRAG_ID) return;
    const ids = (TRIP.stops || []).map((s) => s.id);
    const from = ids.indexOf(DRAG_ID);
    if (from < 0) return;
    ids.splice(from, 1);
    let to = ids.indexOf(target.dataset.stop);
    const rect = target.getBoundingClientRect();
    if (e.clientY > rect.top + rect.height / 2) to += 1;
    ids.splice(to, 0, DRAG_ID);
    try {
      await api("/api/trips/" + encodeURIComponent(TRIP.id) + "/stops-order", "PUT", { ids });
      await reload();
      toast("Order saved ✓");
    } catch (err) { toast(err.message, true); }
  });

  $("#stopList").addEventListener("change", async (e) => {
    const cb = e.target.closest("[data-check]");
    if (!cb) return;
    try {
      await api("/api/trips/" + encodeURIComponent(TRIP.id) + "/stops/" + encodeURIComponent(cb.dataset.check), "PUT", { done: cb.checked });
      await reload();
      toast(cb.checked ? "Checked off ✓" : "Unchecked");
    } catch (err) { toast(err.message, true); await reload(); }
  });

  // Edit (inline), remove, reorder, save, or cancel a stop (any member)
  $("#stopList").addEventListener("click", async (e) => {
    const editBtn = e.target.closest("[data-editstop]");
    const delBtn = e.target.closest("[data-delstop]");
    const moveBtn = e.target.closest("[data-move]");
    const saveBtn = e.target.closest("[data-savestop]");
    const cancelBtn = e.target.closest("[data-canceledit]");
    if (moveBtn) {
      const ids = (TRIP.stops || []).map((s) => s.id);
      const idx = ids.indexOf(moveBtn.dataset.move);
      const swap = moveBtn.dataset.dir === "up" ? idx - 1 : idx + 1;
      if (idx < 0 || swap < 0 || swap >= ids.length) return;
      [ids[idx], ids[swap]] = [ids[swap], ids[idx]];
      try {
        await api("/api/trips/" + encodeURIComponent(TRIP.id) + "/stops-order", "PUT", { ids });
        await reload();
        toast("Order saved ✓");
      } catch (err) { toast(err.message, true); }
      return;
    }
    if (editBtn) {
      EDIT_STOP = editBtn.dataset.editstop; // open inline editor
      renderStops();
      const f = $('.stop-edit .se-f[data-f="title"]');
      if (f) f.focus();
      return;
    }
    if (cancelBtn) { EDIT_STOP = null; renderStops(); return; }
    if (saveBtn) {
      const row = saveBtn.closest("[data-stop]");
      const patch = {};
      row.querySelectorAll(".se-f").forEach((inp) => { patch[inp.dataset.f] = inp.value.trim(); });
      if (!patch.title) return toast("Give the stop a name.", true);
      try {
        await api("/api/trips/" + encodeURIComponent(TRIP.id) + "/stops/" + encodeURIComponent(saveBtn.dataset.savestop), "PUT", patch);
        EDIT_STOP = null;
        await reload();
        toast("Stop updated ✓");
      } catch (err) { toast(err.message, true); }
      return;
    }
    if (delBtn) {
      try {
        await api("/api/trips/" + encodeURIComponent(TRIP.id) + "/stops/" + encodeURIComponent(delBtn.dataset.delstop), "DELETE");
        await reload();
        toast("Stop removed.");
      } catch (err) { toast(err.message, true); }
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

  // Vibe change (creator/admin) — sets the whole-page background mood
  $("#editVibes").addEventListener("click", async (e) => {
    const c = e.target.closest(".vibe-chip[data-vibe]");
    if (!c) return;
    // Preview instantly, then persist.
    document.body.setAttribute("data-vibe", c.dataset.vibe);
    try {
      await api("/api/trips/" + encodeURIComponent(TRIP.id), "PUT", { vibe: c.dataset.vibe });
      await reload();
      toast("Vibe updated.");
    } catch (err) {
      toast(err.message, true);
    }
  });

  // Quick-add a common stop from a template (prefills the add-stop form)
  $("#stopTemplates").addEventListener("click", (e) => {
    const b = e.target.closest("[data-stoptpl]");
    if (!b) return;
    const t = STOP_TEMPLATES[Number(b.dataset.stoptpl)];
    if (!t) return;
    $("#st-title").value = t.title;
    if (t.time) $("#st-time").value = t.time;
    $("#st-title").focus();
    toast("Filled in — set a time and hit Add.");
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

  // Save edited trip details (creator/admin)
  $("#ed-save").addEventListener("click", async () => {
    try {
      await api("/api/trips/" + encodeURIComponent(TRIP.id), "PUT", {
        title: $("#ed-title").value.trim(),
        date: $("#ed-date").value,
        subtitle: $("#ed-sub").value.trim(),
        description: $("#ed-desc").value.trim(),
        coverUrl: $("#ed-cover").value.trim(),
        tags: $("#ed-tags").value.split(",").map((s) => s.trim()).filter(Boolean),
      });
      await reload();
      toast("Details saved.");
    } catch (e) {
      toast(e.message, true);
    }
  });

  // Delete trip (creator only)
  $("#deleteBtn").addEventListener("click", async () => {
    if (!confirm(`Delete "${TRIP.title}"? This can't be undone.`)) return;
    try {
      await api("/api/trips/" + encodeURIComponent(TRIP.id), "DELETE");
      location.href = "/";
    } catch (e) {
      toast(e.message, true);
    }
  });

  // Leave trip (members who didn't create it)
  $("#leaveBtn").addEventListener("click", async () => {
    if (!confirm(`Leave "${TRIP.title}"? You'll need the invite link to rejoin.`)) return;
    try {
      await api("/api/trips/" + encodeURIComponent(TRIP.id) + "/leave", "POST");
      location.href = "/";
    } catch (e) {
      toast(e.message, true);
    }
  });

  // Activity sidebar toggle
  function updateActivitySidebar() {
    const log = TRIP.activity || [];
    const sidebar = $("#activitySidebar");
    sidebar.style.display = sidebar.style.display === "none" ? "block" : "none";
    const list = $("#activityList");
    const canDeleteActivity = TRIP.canManage;
    list.innerHTML = log.slice().reverse().map((a) => `
      <div class="activity-item" style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
        <div style="flex:1">
          <div class="activity-item__name">${esc(a.userName)}</div>
          <div class="activity-item__text">${esc(a.text)}</div>
          <div class="activity-item__time">${esc(relTime(a.ts))}</div>
        </div>
        ${canDeleteActivity ? `<button class="crew-item__x" data-delactivity="${esc(a.id)}" title="Delete">✕</button>` : ""}
      </div>`).join("") || '<p class="row__meta" style="padding:12px">Nothing yet.</p>';
  }

  $("#activityToggleBtn").addEventListener("click", () => {
    updateActivitySidebar();
  });
  $("#closeActivityBtn").addEventListener("click", () => {
    $("#activitySidebar").style.display = "none";
  });

  // Quick-edit button: scroll to edit section
  $("#quickEditBtn").addEventListener("click", () => {
    const manageBar = $("#manageBar");
    if (manageBar && manageBar.style.display !== "none") {
      manageBar.scrollIntoView({ behavior: "smooth", block: "start" });
      setTimeout(() => $("#ed-title").focus(), 300);
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

  // Send a chat message
  async function sendChat() {
    const text = $("#chatInput").value.trim();
    if (!text) return;
    $("#chatInput").value = "";
    try {
      await api("/api/trips/" + encodeURIComponent(TRIP.id) + "/messages", "POST", { text });
      await loadChat();
    } catch (e) {
      toast(e.message, true);
      $("#chatInput").value = text;
    }
  }
  $("#chatSend").addEventListener("click", sendChat);
  $("#chatInput").addEventListener("keydown", (e) => { if (e.key === "Enter") sendChat(); });

  // Delete a chat message (own, or any if you manage the trip)
  $("#chatList").addEventListener("click", async (e) => {
    const del = e.target.closest("[data-delmsg]");
    if (!del) return;
    try {
      await api("/api/trips/" + encodeURIComponent(TRIP.id) + "/messages/" + encodeURIComponent(del.dataset.delmsg), "DELETE");
      CHAT_SIG = "";
      await loadChat();
    } catch (err) { toast(err.message, true); }
  });

  // Upload a file to shared drive
  $("#uploadBtn").addEventListener("click", async () => {
    const file = $("#fileInput").files[0];
    if (!file) return;
    if (!ME.isEarlyBird) {
      toast("Shared drive is for early birds only.", true);
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const base64 = reader.result.split(",")[1];
        await api("/api/trips/" + encodeURIComponent(TRIP.id) + "/files", "POST", { filename: file.name, data: base64 });
        $("#fileInput").value = "";
        await loadFiles();
        toast("File uploaded.");
      } catch (err) { toast(err.message, true); }
    };
    reader.readAsDataURL(file);
  });

  // Delete a file from shared drive
  document.addEventListener("click", async (e) => {
    const del = e.target.closest("[data-delfile]");
    if (!del || !TRIP) return;
    try {
      await api("/api/trips/" + encodeURIComponent(TRIP.id) + "/files/" + encodeURIComponent(del.dataset.delfile), "DELETE");
      await loadFiles();
      toast("File deleted.");
    } catch (err) { toast(err.message, true); }
  });

  // Delete an activity entry (creator/admin)
  document.addEventListener("click", async (e) => {
    const del = e.target.closest("[data-delactivity]");
    if (!del || !TRIP) return;
    if (!confirm("Remove this activity entry from the changelog?")) return;
    try {
      await api("/api/trips/" + encodeURIComponent(TRIP.id) + "/activity/" + encodeURIComponent(del.dataset.delactivity), "DELETE");
      await reload();
      toast("Activity removed.");
    } catch (err) { toast(err.message, true); }
  });

  // Live updates: refresh the trip + chat every ~5s so others' changes appear
  // without a manual reload. Skip while the user is typing or a dialog is open.
  setInterval(() => {
    const ae = document.activeElement;
    if (ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) return;
    if (EDIT_STOP) { loadChat().catch(() => {}); return; } // don't wipe an open editor
    reload().catch(() => {});
    loadChat().catch(() => {});
  }, 5000);
})();
