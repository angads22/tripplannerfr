"use strict";

const $ = (s, r = document) => r.querySelector(s);

let ME = null;
let USERS = [];
let TRIPS = [];
let REQUESTS = [];

function fmtWhen(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d) ? iso : d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function toast(msg, isErr) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.toggle("err", !!isErr);
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2800);
}
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    location.href = "/login.html?next=/admin";
    throw new Error("redirecting");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

// --- Invite code -----------------------------------------------------------
async function loadInvite() {
  const { inviteCode, isDefault } = await api("GET", "/api/users/invite-code");
  $("#inviteCurrent").textContent = inviteCode + (isDefault ? "  (default — change it!)" : "");
}
$("#inviteSave").addEventListener("click", async () => {
  const code = $("#inviteInput").value.trim();
  if (!code) return;
  try {
    await api("PUT", "/api/users/invite-code", { inviteCode: code });
    $("#inviteInput").value = "";
    await loadInvite();
    toast("Invite code updated.");
  } catch (e) {
    toast(e.message, true);
  }
});

// --- Users -----------------------------------------------------------------
function userRow(u) {
  const you = u.id === ME.id;
  return `
    <div class="row" data-uid="${u.id}">
      <div class="row__main">
        <div class="row__title">${esc(u.displayName)}
          ${u.isAdmin ? '<span class="badge admin">admin</span>' : ""}
          ${you ? '<span class="badge you">you</span>' : ""}
        </div>
        <div class="row__meta"><span class="mono">@${esc(u.username)}</span></div>
      </div>
      <div class="row__actions">
        <label class="toggle"><input type="checkbox" data-act="admin" ${u.isAdmin ? "checked" : ""} ${you ? "disabled" : ""}/><span class="track"></span>Admin</label>
        <button class="btn small" data-act="pw">Reset password</button>
        <button class="btn danger small" data-act="del" ${you ? "disabled" : ""}>Delete</button>
      </div>
    </div>`;
}
async function loadUsers() {
  const { users } = await api("GET", "/api/users");
  USERS = users;
  $("#userCount").textContent = `${users.length} ${users.length === 1 ? "person" : "people"}`;
  $("#userList").innerHTML = users.map(userRow).join("");
}
$("#userList").addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  const row = e.target.closest("[data-uid]");
  const uid = row.dataset.uid;
  const act = btn.dataset.act;
  try {
    if (act === "admin") {
      await api("PUT", `/api/users/${uid}`, { isAdmin: btn.checked });
      toast("Updated.");
      await loadUsers();
    } else if (act === "pw") {
      const pw = prompt("New password for this account (6+ characters):");
      if (!pw) return;
      await api("PUT", `/api/users/${uid}`, { password: pw });
      toast("Password reset.");
    } else if (act === "del") {
      const u = USERS.find((x) => x.id === uid);
      if (!confirm(`Delete ${u ? u.displayName : "this account"}? This can't be undone.`)) return;
      await api("DELETE", `/api/users/${uid}`);
      toast("Account deleted.");
      await loadUsers();
      await loadTrips();
    }
  } catch (err) {
    toast(err.message, true);
    await loadUsers();
  }
});
$("#na-add").addEventListener("click", async () => {
  try {
    await api("POST", "/api/users", {
      displayName: $("#na-name").value.trim(),
      username: $("#na-user").value.trim(),
      password: $("#na-pass").value,
      isAdmin: $("#na-admin").checked,
    });
    $("#na-name").value = $("#na-user").value = $("#na-pass").value = "";
    $("#na-admin").checked = false;
    toast("Account created.");
    await loadUsers();
  } catch (e) {
    toast(e.message, true);
  }
});

// --- Trips & access --------------------------------------------------------
function aclChecks(role, selected) {
  return USERS.map(
    (u) => `<label class="${selected.has(u.id) ? "on" : ""}">
        <input type="checkbox" data-role="${role}" data-uid="${u.id}" ${selected.has(u.id) ? "checked" : ""}/> ${esc(u.displayName)}
      </label>`
  ).join("");
}

function tripRow(t) {
  const everyone = !!t.shareWithEveryone;
  const allowed = new Set(t.allowedUsers || []);
  const editors = new Set(t.editorUsers || []);
  const pending = t.pendingRequestCount || 0;
  const slug = t.slug || t.id;
  return `
    <div class="row" data-tid="${t.id}" style="align-items:flex-start;flex-direction:column">
      <div style="display:flex;gap:12px;align-items:center;width:100%;flex-wrap:wrap">
        <div class="row__main">
          <div class="row__title">${esc(t.emoji || "✈️")} ${esc(t.title)} ${pending ? `<span class="cr-badge">${pending} pending</span>` : ""}</div>
          <div class="row__meta"><span class="mono">/trip/${esc(slug)}</span> · ${esc(t.date || "no date")}</div>
        </div>
        <div class="row__actions">
          <label class="toggle"><input type="checkbox" data-act="everyone" ${everyone ? "checked" : ""}/><span class="track"></span>Everyone</label>
          <a class="btn small" href="/trip/${encodeURIComponent(slug)}/edit">Build</a>
          <a class="btn small" href="/trip/${encodeURIComponent(slug)}" target="_blank" rel="noopener">Open</a>
          <button class="btn danger small" data-act="del">Delete</button>
        </div>
      </div>
      <div style="width:100%">
        <div class="row__meta" style="margin:6px 0 4px">Who can see it${everyone ? " — everyone's in" : ""}</div>
        <div class="access ${everyone ? "disabled" : ""}" data-acl="view">${USERS.length ? aclChecks("view", allowed) : '<span class="row__meta">No accounts yet.</span>'}</div>
        <div class="row__meta" style="margin:12px 0 4px">Who can edit directly <span class="muted">(everyone else can only suggest)</span></div>
        <div class="access" data-acl="edit">${USERS.length ? aclChecks("edit", editors) : '<span class="row__meta">No accounts yet.</span>'}</div>
      </div>
    </div>`;
}
async function loadTrips() {
  const { trips } = await api("GET", "/api/trips");
  TRIPS = trips;
  $("#tripList").innerHTML = trips.length ? trips.map(tripRow).join("") : '<div class="row__meta" style="padding:8px 0">No trips yet — add one below.</div>';
}
async function saveAccess(tid) {
  const row = $(`[data-tid="${tid}"]`);
  const everyone = row.querySelector('[data-act="everyone"]').checked;
  const allowedUsers = [...row.querySelectorAll('[data-acl="view"] input[data-uid]')].filter((c) => c.checked).map((c) => c.dataset.uid);
  const editorUsers = [...row.querySelectorAll('[data-acl="edit"] input[data-uid]')].filter((c) => c.checked).map((c) => c.dataset.uid);
  await api("PUT", `/api/trips/${tid}/access`, { shareWithEveryone: everyone, allowedUsers, editorUsers });
}
$("#tripList").addEventListener("change", async (e) => {
  const row = e.target.closest("[data-tid]");
  if (!row) return;
  const tid = row.dataset.tid;
  if (e.target.matches('[data-act="everyone"]')) {
    row.querySelector('[data-acl="view"]').classList.toggle("disabled", e.target.checked);
  }
  if (e.target.matches(".access input[data-uid]")) {
    e.target.closest("label").classList.toggle("on", e.target.checked);
    // An editor must also be able to see the trip — mirror the view tick.
    if (e.target.dataset.role === "edit" && e.target.checked) {
      const viewBox = row.querySelector(`[data-acl="view"] input[data-uid="${e.target.dataset.uid}"]`);
      if (viewBox && !viewBox.checked) {
        viewBox.checked = true;
        viewBox.closest("label").classList.add("on");
      }
    }
  }
  try {
    await saveAccess(tid);
    toast("Access saved.");
  } catch (err) {
    toast(err.message, true);
    await loadTrips();
  }
});
$("#tripList").addEventListener("click", async (e) => {
  const btn = e.target.closest('[data-act="del"]');
  if (!btn) return;
  const row = e.target.closest("[data-tid]");
  const t = TRIPS.find((x) => x.id === row.dataset.tid);
  if (!confirm(`Remove "${t ? t.title : "this trip"}" from the board? This can't be undone.`)) return;
  try {
    await api("DELETE", `/api/trips/${row.dataset.tid}`);
    toast("Trip removed.");
    await loadTrips();
  } catch (err) {
    toast(err.message, true);
  }
});
$("#nt-add").addEventListener("click", async () => {
  const title = $("#nt-title").value.trim();
  if (!title) return toast("Give the trip a title.", true);
  try {
    const { trip } = await api("POST", "/api/trips", {
      title,
      emoji: $("#nt-emoji").value.trim(),
      date: $("#nt-date").value,
      subtitle: $("#nt-sub").value.trim(),
      shareWithEveryone: true,
    });
    toast("Trip created — opening the builder…");
    setTimeout(() => (location.href = "/trip/" + encodeURIComponent(trip.slug || trip.id) + "/edit"), 650);
  } catch (e) {
    toast(e.message, true);
  }
});

// --- Change requests -------------------------------------------------------
function tripSlug(tripId) {
  const t = TRIPS.find((x) => x.id === tripId);
  return (t && t.slug) || tripId;
}
// A readable text preview of a proposed itinerary (no diffing — full snapshot).
function summarize(c) {
  if (!c) return "(empty)";
  const lines = [];
  if (c.overview) lines.push("Overview: " + c.overview.slice(0, 160));
  if (Array.isArray(c.crew) && c.crew.length) lines.push("Crew: " + c.crew.join(", "));
  (c.days || []).forEach((d, i) => {
    lines.push(`${d.label || "Day " + (i + 1)} — ${(d.stops || []).length} stop(s)`);
    (d.stops || []).forEach((s) => lines.push(`   • ${s.time ? s.time + "  " : ""}${s.name || "(unnamed)"}${s.location ? "  @ " + s.location : ""}`));
  });
  return lines.join("\n") || "(empty itinerary)";
}
function crRow(r) {
  return `
    <div class="cr" data-rid="${r.id}">
      <div class="cr__head">
        <span class="cr__who">${esc(r.userName)} → ${esc(r.tripTitle)}</span>
        <span class="cr__when">${esc(fmtWhen(r.createdAt))}</span>
      </div>
      ${r.message ? `<div class="cr__msg">“${esc(r.message)}”</div>` : ""}
      <div class="cr__preview">${esc(summarize(r.proposedContent))}</div>
      <div class="cr__actions">
        <a class="btn small" href="/trip/${encodeURIComponent(tripSlug(r.tripId))}" target="_blank" rel="noopener">See current</a>
        <button class="btn primary small" data-act="approve">Approve &amp; apply</button>
        <button class="btn danger small" data-act="reject">Reject</button>
      </div>
    </div>`;
}
async function loadRequests() {
  const { requests } = await api("GET", "/api/trips/requests");
  REQUESTS = requests;
  $("#crCount").textContent = requests.length ? `${requests.length} pending` : "all caught up";
  $("#crList").innerHTML = requests.length
    ? requests.map(crRow).join("")
    : '<div class="row__meta" style="padding:8px 0">No pending suggestions.</div>';
}
$("#crList").addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  const rid = e.target.closest("[data-rid]").dataset.rid;
  const act = btn.dataset.act;
  if (act === "reject" && !confirm("Reject this suggestion? The member can send a new one.")) return;
  btn.disabled = true;
  try {
    await api("POST", `/api/trips/requests/${rid}/${act}`, {});
    toast(act === "approve" ? "Applied to the trip." : "Suggestion rejected.");
    await loadRequests();
    await loadTrips();
  } catch (err) {
    toast(err.message, true);
    btn.disabled = false;
  }
});

// --- Server power ----------------------------------------------------------
$("#shutdownBtn").addEventListener("click", async () => {
  if (!confirm("Shut down the server for everyone? You'll need to run Start Trip Planner.bat to turn it back on.")) return;
  try {
    await api("POST", "/api/admin/shutdown");
    document.body.innerHTML = '<div class="auth-wrap"><div class="auth-card" style="text-align:center"><div class="empty"><div class="big">⏻</div><h3>Server shutting down</h3><p>Run <b>Start Trip Planner.bat</b> on the host computer to turn it back on.</p></div></div></div>';
  } catch (e) {
    toast(e.message, true);
  }
});

// --- Logout / boot ---------------------------------------------------------
$("#logoutBtn").addEventListener("click", async () => {
  await fetch("/api/auth/logout", { method: "POST" });
  location.href = "/login.html";
});

(async function init() {
  try {
    ME = (await api("GET", "/api/auth/me")).user;
    if (!ME) return (location.href = "/login.html?next=/admin");
    if (!ME.isAdmin) return (location.href = "/");
    await loadInvite();
    await loadUsers();
    await loadTrips();
    await loadRequests();
  } catch (e) {
    toast(e.message, true);
  }
})();
