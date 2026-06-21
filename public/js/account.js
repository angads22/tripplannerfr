"use strict";

const $ = (s) => document.querySelector(s);
let ME = null;

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
  if (res.status === 401) { location.href = "/login.html?next=/account.html"; throw new Error("redirecting"); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

function paintAvatar() {
  const av = $("#avPreview");
  const emoji = $("#ac-emoji").value.trim();
  const color = $("#ac-color").value || avatarColor(ME.displayName);
  av.style.background = color;
  av.textContent = emoji || initials($("#ac-name").value || ME.displayName);
}

(async function init() {
  try {
    ME = (await api("/api/auth/me")).user;
    if (!ME) return (location.href = "/login.html?next=/account.html");
  } catch { return; }

  $("#whoUser").textContent = "@" + ME.username;
  $("#ac-name").value = ME.displayName;
  $("#ac-emoji").value = ME.avatarEmoji || "";
  $("#ac-color").value = ME.avatarColor || avatarColor(ME.displayName);
  paintAvatar();
  $("#ac-name").addEventListener("input", paintAvatar);
  $("#ac-emoji").addEventListener("input", paintAvatar);
  $("#ac-color").addEventListener("input", paintAvatar);

  $("#logoutBtn").addEventListener("click", async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    location.href = "/login.html";
  });

  $("#ac-save").addEventListener("click", async () => {
    try {
      await api("/api/auth/me", "PUT", {
        displayName: $("#ac-name").value.trim(),
        avatarEmoji: $("#ac-emoji").value.trim(),
        avatarColor: $("#ac-color").value,
      });
      toast("Profile saved.");
    } catch (e) { toast(e.message, true); }
  });

  $("#ac-pw").addEventListener("click", async () => {
    const currentPassword = $("#ac-cur").value;
    const password = $("#ac-new").value;
    if (!password) return toast("Enter a new password.", true);
    try {
      await api("/api/auth/me", "PUT", { currentPassword, password });
      $("#ac-cur").value = $("#ac-new").value = "";
      toast("Password changed.");
    } catch (e) { toast(e.message, true); }
  });

  $("#ac-del").addEventListener("click", async () => {
    const password = prompt("This deletes your account for good. Type your password to confirm:");
    if (!password) return;
    try {
      await api("/api/auth/me", "DELETE", { password });
      location.href = "/login.html";
    } catch (e) { toast(e.message, true); }
  });
})();
