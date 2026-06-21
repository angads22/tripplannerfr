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
  const crew = (t.members || []).map((m) => esc(m.displayName)).join(", ") || "no one yet";
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
  const { trips } = await api("GET", "/api/trips");
  TRIPS = trips;
  $("#tripList").innerHTML = trips.length ? trips.map(tripRow).join("") : '<div class="row__meta" style="padding:8px 0">No trips yet — add one below.</div>';
}
$("#tripList").addEventListener("change", async (e) => {
  const row = e.target.closest("[data-tid]");
  if (!row || !e.target.matches('[data-act="everyone"]')) return;
  try {
    await api("PUT", `/api/trips/${row.dataset.tid}/access`, { shareWithEveryone: e.target.checked });
    toast("Sharing updated.");
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
  if (!confirm(`Remove "${t ? t.title : "this trip"}" from the board? (The page file stays on disk.)`)) return;
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
async function checkUpdate() {
  const status = $("#updateStatus");
  const meta = $("#updateMeta");
  const applyBtn = $("#applyUpdateBtn");
  try {
    $("#checkUpdateBtn").disabled = true;
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
    toast(e.message, true);
  } finally {
    $("#checkUpdateBtn").disabled = false;
  }
}
$("#checkUpdateBtn").addEventListener("click", checkUpdate);
$("#applyUpdateBtn").addEventListener("click", async () => {
  if (!confirm("Download the latest build and restart the app? Anyone using it will be briefly disconnected.")) return;
  const btn = $("#applyUpdateBtn");
  btn.disabled = true;
  btn.textContent = "Updating...";
  try {
    const r = await api("POST", "/api/admin/apply-update");
    document.body.innerHTML = '<div class="auth-wrap"><div class="card-dark auth-card" style="color:var(--on-dark)"><div class="empty" style="color:var(--on-dark)"><div class="big">⬇️</div><h3 class="display" style="color:var(--on-dark)">Updating</h3><p style="color:var(--muted-dark-2)">' + (r.message || "Downloading the new build. The app will restart on its own — give it a few seconds, then refresh.") + '</p></div></div></div>';
  } catch (e) {
    toast(e.message, true);
    btn.disabled = false;
    btn.textContent = "Update now";
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
    await checkUpdate();
    setInterval(checkUpdate, 60 * 60 * 1000);
  } catch (e) {
    toast(e.message, true);
  }
})();
