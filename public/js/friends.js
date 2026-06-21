"use strict";

const $ = (s) => document.querySelector(s);

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
  if (res.status === 401) { location.href = "/login.html?next=/friends.html"; throw new Error("redirecting"); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

function personRow(u, actions) {
  return `
    <div class="crew-item">
      <span class="crew-item__face" style="background:${u.avatarColor || avatarColor(u.displayName)}">${u.avatarEmoji || esc(initials(u.displayName))}</span>
      <div style="flex:1">
        <div class="crew-item__name">${esc(u.displayName)}</div>
        <div class="crew-item__tag">@${esc(u.username)}</div>
      </div>
      <div style="display:flex;gap:6px">${actions}</div>
    </div>`;
}

async function load() {
  const { friends, incoming, outgoing } = await api("/api/friends");

  $("#reqCount").textContent = incoming.length ? incoming.length : "";
  $("#friendCount").textContent = friends.length ? friends.length : "";

  $("#incomingList").innerHTML = incoming.length
    ? incoming.map((u) => personRow(u, `<button class="btn primary small" data-accept="${u.id}">Accept</button><button class="btn small" data-decline="${u.id}">Ignore</button>`)).join("")
    : '<p class="row__meta">No pending requests.</p>';

  $("#friendsList").innerHTML = friends.length
    ? friends.map((u) => personRow(u, `<button class="btn small" data-remove="${u.id}">Remove</button>`)).join("")
    : '<p class="row__meta">No friends yet — add someone by username above.</p>';

  $("#outgoingList").innerHTML = outgoing.length
    ? outgoing.map((u) => personRow(u, `<button class="btn small" data-cancel="${u.id}">Cancel</button>`)).join("")
    : '<p class="row__meta">Nothing pending.</p>';
}

document.addEventListener("click", async (e) => {
  const acc = e.target.closest("[data-accept]");
  const dec = e.target.closest("[data-decline]");
  const rem = e.target.closest("[data-remove]");
  const can = e.target.closest("[data-cancel]");
  try {
    if (acc) { await api("/api/friends/accept", "POST", { userId: acc.dataset.accept }); toast("You're friends now!"); await load(); }
    else if (dec) { await api("/api/friends/decline", "POST", { userId: dec.dataset.decline }); await load(); }
    else if (rem) { await api("/api/friends/" + encodeURIComponent(rem.dataset.remove), "DELETE"); await load(); }
    else if (can) { await api("/api/friends/decline", "POST", { userId: can.dataset.cancel }); await load(); }
  } catch (err) { toast(err.message, true); }
});

(async function init() {
  try {
    const me = (await api("/api/auth/me")).user;
    if (!me) return (location.href = "/login.html?next=/friends.html");
  } catch { return; }

  $("#logoutBtn").addEventListener("click", async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    location.href = "/login.html";
  });

  // Live search of everyone, debounced.
  function statusBtn(u) {
    if (u.status === "friend") return `<span class="badge you">friends</span>`;
    if (u.status === "outgoing") return `<button class="btn small" data-cancel="${u.id}">Cancel</button>`;
    if (u.status === "incoming") return `<button class="btn primary small" data-accept="${u.id}">Accept</button>`;
    return `<button class="btn primary small" data-req="${u.username}">Add</button>`;
  }
  async function runSearch() {
    const q = $("#fr-search").value.trim();
    if (!q) { $("#searchResults").innerHTML = ""; $("#searchHint").style.display = ""; return; }
    try {
      const { results } = await api("/api/friends/search?q=" + encodeURIComponent(q));
      $("#searchHint").style.display = results.length ? "none" : "";
      $("#searchResults").innerHTML = results.map((u) => personRow(u, statusBtn(u))).join("") || '<p class="row__meta">No one found.</p>';
    } catch (e) { toast(e.message, true); }
  }
  let searchT;
  $("#fr-search").addEventListener("input", () => { clearTimeout(searchT); searchT = setTimeout(runSearch, 220); });

  // "Add" from search results sends a request by username.
  $("#searchResults").addEventListener("click", async (e) => {
    const add = e.target.closest("[data-req]");
    if (!add) return;
    try {
      const r = await api("/api/friends/request", "POST", { username: add.dataset.req });
      toast(r.status === "friends" ? "You're friends now!" : "Request sent.");
      await runSearch();
      await load();
    } catch (err) { toast(err.message, true); }
  });

  await load();
})();
