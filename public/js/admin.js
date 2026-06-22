"use strict";

const $ = (s, r = document) => r.querySelector(s);

let ME = null;
let USERS = [];
let TRIPS = [];

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

function relTime(iso) {
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (isNaN(d)) return "";
  if (d < 60) return "just now";
  if (d < 3600) return Math.floor(d / 60) + "m ago";
  if (d < 86400) return Math.floor(d / 3600) + "h ago";
  return Math.floor(d / 86400) + "d ago";
}

// --- Activity log ----------------------------------------------------------
async function loadLogs() {
  const { logs } = await api("GET", "/api/admin/logs");
  $("#logFeed").innerHTML = logs.length
    ? logs.map((e) => {
        // Only trip-activity rows carry ids, so only those can be pruned.
        const deletable = e.tripId && e.activityId;
        return `
        <div class="row" style="padding:9px 0" ${deletable ? `data-log-trip="${esc(e.tripId)}" data-log-act="${esc(e.activityId)}"` : ""}>
          <div class="row__main">
            <div class="row__title" style="font-size:14px"><b>${esc(e.who)}</b> ${esc(e.text)}</div>
            <div class="row__meta">${e.trip ? esc(e.trip) + " · " : ""}${esc(relTime(e.ts))}</div>
          </div>
          ${deletable ? '<div class="row__actions"><button class="btn danger small" data-act="dellog">Delete</button></div>' : ""}
        </div>`;
      }).join("")
    : '<p class="row__meta">No activity yet.</p>';
}
$("#logRefresh").addEventListener("click", () => loadLogs().catch((e) => toast(e.message, true)));
$("#logFeed").addEventListener("click", async (e) => {
  const btn = e.target.closest('[data-act="dellog"]');
  if (!btn) return;
  const row = e.target.closest("[data-log-trip]");
  if (!row) return;
  if (!confirm("Delete this activity entry? This can't be undone.")) return;
  try {
    await api("DELETE", `/api/admin/trips/${row.dataset.logTrip}/activity/${row.dataset.logAct}`);
    toast("Activity entry deleted.");
    await loadLogs();
  } catch (err) {
    toast(err.message, true);
  }
});

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
function tripRow(t) {
  const everyone = !!t.shareWithEveryone;
  // Members as removable chips (admin override — can remove anyone, creator included).
  const crew = (t.members || []).length
    ? (t.members || []).map((m) => `<span class="mono" style="display:inline-flex;align-items:center;gap:3px;background:rgba(0,0,0,.06);border-radius:8px;padding:1px 4px 1px 7px;margin:2px 3px 0 0">${esc(m.displayName)}<button class="crew-item__x" style="font-size:13px;padding:0 4px" data-act="rmmember" data-uid="${esc(m.id)}" title="Remove from trip">×</button></span>`).join("")
    : '<span class="mono">no one yet</span>';
  return `
    <div class="row" data-tid="${t.id}" data-theme="${esc(t.theme || "red")}">
      <span class="theme-dot ${esc(t.theme || "red")}" style="width:14px;height:14px;cursor:default" title="${esc(t.theme || "red")} theme"></span>
      <div class="row__main">
        <div class="row__title">${esc(t.emoji || "🚗")} ${esc(t.title)}</div>
        <div class="row__meta">
          <span class="mono">/trip/${esc(t.slug || t.id)}</span> · ${esc(t.date || "no date")}<br/>
          by ${esc(t.creatorName || "—")} · ${t.memberCount} on board: ${crew}
        </div>
      </div>
      <div class="row__actions">
        <label class="toggle"><input type="checkbox" data-act="everyone" ${everyone ? "checked" : ""}/><span class="track"></span>Everyone</label>
        <a class="btn small" href="/trip/${encodeURIComponent(t.slug || t.id)}">Open</a>
        <button class="btn danger small" data-act="del">Delete</button>
      </div>
    </div>`;
}
async function loadTrips() {
  // Admin override endpoint: lists EVERY trip, not just the admin's board.
  const { trips } = await api("GET", "/api/admin/trips");
  TRIPS = trips;
  $("#tripList").innerHTML = trips.length ? trips.map(tripRow).join("") : '<div class="row__meta" style="padding:8px 0">No trips yet — add one below.</div>';
}
$("#tripList").addEventListener("change", async (e) => {
  const row = e.target.closest("[data-tid]");
  if (!row || !e.target.matches('[data-act="everyone"]')) return;
  try {
    await api("PUT", `/api/admin/trips/${row.dataset.tid}/access`, { shareWithEveryone: e.target.checked });
    toast("Sharing updated.");
  } catch (err) {
    toast(err.message, true);
    await loadTrips();
  }
});
$("#tripList").addEventListener("click", async (e) => {
  const row = e.target.closest("[data-tid]");
  if (!row) return;

  // Remove a single member from the trip (admin override).
  const rm = e.target.closest('[data-act="rmmember"]');
  if (rm) {
    if (!confirm("Remove this person from the trip?")) return;
    try {
      await api("DELETE", `/api/admin/trips/${row.dataset.tid}/members/${rm.dataset.uid}`);
      toast("Removed from trip.");
      await loadTrips();
    } catch (err) {
      toast(err.message, true);
    }
    return;
  }

  // Delete the whole trip.
  const btn = e.target.closest('[data-act="del"]');
  if (!btn) return;
  const t = TRIPS.find((x) => x.id === row.dataset.tid);
  if (!confirm(`Delete "${t ? t.title : "this trip"}" for everyone? This can't be undone.`)) return;
  try {
    await api("DELETE", `/api/admin/trips/${row.dataset.tid}`);
    toast("Trip deleted.");
    await loadTrips();
  } catch (err) {
    toast(err.message, true);
  }
});
$("#nt-add").addEventListener("click", async () => {
  const title = $("#nt-title").value.trim();
  if (!title) return toast("Give the trip a title.", true);
  try {
    await api("POST", "/api/trips", {
      title,
      emoji: $("#nt-emoji").value.trim(),
      date: $("#nt-date").value,
      subtitle: $("#nt-sub").value.trim(),
      pageFile: $("#nt-page").value.trim(),
      shareWithEveryone: true,
    });
    $("#nt-title").value = $("#nt-emoji").value = $("#nt-sub").value = $("#nt-page").value = "";
    $("#nt-date").value = "";
    toast("Trip added (shared with everyone).");
    await loadTrips();
  } catch (e) {
    toast(e.message, true);
  }
});

// --- Updates ---------------------------------------------------------------
const autoUpdate = {
  get on() { return localStorage.getItem("autoUpdate") === "1"; },
  set on(v) { localStorage.setItem("autoUpdate", v ? "1" : "0"); },
};

async function checkUpdate(silent) {
  const status = $("#updateStatus");
  const meta = $("#updateMeta");
  const applyBtn = $("#applyUpdateBtn");
  try {
    $("#checkUpdateBtn").disabled = true;
    if (!silent) { status.textContent = "Checking…"; meta.textContent = "Looking for a newer build."; }
    applyBtn.style.display = "none";
    const r = await api("GET", "/api/admin/check-update");
    $("#curVer").textContent = `${r.currentVersion} (build ${r.currentBuild})`;
    if (r.error) {
      status.textContent = "Couldn't check";
      meta.textContent = "Update check failed: " + r.error;
      return;
    }
    if (r.hasUpdate) {
      status.textContent = `Update available: build ${r.latestBuild}`;
      status.style.color = "var(--accent)";
      if (r.canSelfUpdate) {
        meta.innerHTML = `A newer build is ready. Click <b>Update now</b> to download and restart automatically.`;
        applyBtn.style.display = "";
        applyBtn.textContent = "Update now";
        applyBtn.disabled = false;
        // Auto-install if the admin turned it on.
        if (autoUpdate.on) applyUpdate(true);
      } else if (!r.isPackaged) {
        meta.innerHTML = `You're running from source. Update with <code>git pull</code> then restart.`;
      } else {
        meta.innerHTML = `New build available. <a href="${r.releaseUrl}" target="_blank" rel="noopener">Download it here</a>.`;
      }
    } else {
      status.textContent = "You're up to date";
      status.style.color = "";
      meta.textContent = "Running the latest build.";
    }
  } catch (e) {
    if (!silent) toast(e.message, true);
  } finally {
    $("#checkUpdateBtn").disabled = false;
  }
}

async function applyUpdate(auto) {
  const btn = $("#applyUpdateBtn");
  if (!auto && !confirm("Download the latest build and restart the app? Anyone using it will be briefly disconnected.")) return;
  // Immediate, obvious feedback.
  btn.disabled = true;
  btn.textContent = "Downloading…";
  $("#updateStatus").textContent = "Updating…";
  $("#updateStatus").style.color = "var(--accent)";
  $("#updateMeta").textContent = "Downloading the new build…";
  toast("Update started — downloading…");
  try {
    const r = await api("POST", "/api/admin/apply-update");
    document.body.innerHTML =
      '<div class="auth-wrap"><div class="card-dark auth-card" style="color:var(--on-dark)"><div class="empty" style="color:var(--on-dark)">' +
      '<div class="big spin">⟳</div>' +
      '<h3 class="display" style="color:var(--on-dark)">Installing the update</h3>' +
      '<p style="color:var(--muted-dark-2)">' + (r.message || "Downloading the new build. The app restarts on its own — give it ~10 seconds, then this page reloads.") + '</p></div></div></div>';
    // The server exits + relaunches; poll until it's back, then reload.
    setTimeout(function ping() {
      fetch("/api/health", { cache: "no-store" })
        .then((res) => { if (res.ok) location.reload(); else setTimeout(ping, 1500); })
        .catch(() => setTimeout(ping, 1500));
    }, 4000);
  } catch (e) {
    toast(e.message, true);
    btn.disabled = false;
    btn.textContent = "Update now";
    $("#updateMeta").textContent = "Update failed: " + e.message;
  }
}

$("#checkUpdateBtn").addEventListener("click", () => checkUpdate(false));
$("#applyUpdateBtn").addEventListener("click", () => applyUpdate(false));
$("#autoUpdateToggle").addEventListener("change", (e) => {
  autoUpdate.on = e.target.checked;
  toast(e.target.checked ? "Auto-update on — new builds install themselves." : "Auto-update off.");
  if (e.target.checked) checkUpdate(true);
});

// --- Maintenance -----------------------------------------------------------
$("#migrateTorontoBtn").addEventListener("click", async () => {
  if (!confirm("Migrate the Toronto trip to the editable system? The crew keeps access and the itinerary is preserved, but the old static page is replaced.")) return;
  const btn = $("#migrateTorontoBtn");
  btn.disabled = true;
  try {
    const r = await api("POST", "/api/admin/migrate-toronto");
    toast(r.message || "Migrated.");
    loadTrips().catch(() => {});
  } catch (e) {
    toast(e.message, true);
  } finally {
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
    $("#autoUpdateToggle").checked = autoUpdate.on;
    await loadInvite();
    await loadUsers();
    await loadTrips();
    await loadLogs();
    await checkUpdate();
    // Check periodically; with auto-update on, new builds install themselves.
    setInterval(() => checkUpdate(true), 20 * 60 * 1000);
  } catch (e) {
    toast(e.message, true);
  }
})();
