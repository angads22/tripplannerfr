"use strict";

const $ = (s, r = document) => r.querySelector(s);
const slug = decodeURIComponent(location.pathname.replace(/^\/trip\//, "").replace(/\/$/, ""));

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

async function loadDirectory() {
  try {
    const { users } = await api("/api/users/directory");
    $("#userList").innerHTML = users.map((u) => `<option value="${esc(u.username)}">${esc(u.displayName)}</option>`).join("");
  } catch { /* non-fatal */ }
}

async function reload() {
  const { trip } = await api("/api/trips/" + encodeURIComponent(slug));
  TRIP = trip;
  document.body.setAttribute("data-theme", trip.theme || "red");
  renderHead();
  renderCrew();
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

  // Theme change (creator/admin)
  $("#editThemes").addEventListener("click", async (e) => {
    const d = e.target.closest(".theme-dot");
    if (!d) return;
    try {
      await api("/api/trips/" + encodeURIComponent(TRIP.id), "PUT", { theme: d.dataset.theme });
      await reload();
      toast("Theme updated.");
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
})();
