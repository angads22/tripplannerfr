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

// The currently-staged photo data URL (null = unchanged, "" = cleared).
let PHOTO = undefined;

function currentImage() {
  return PHOTO !== undefined ? PHOTO : (ME.avatarImage || "");
}

function paintAvatar() {
  const av = $("#avPreview");
  const img = currentImage();
  if (img) {
    av.style.backgroundImage = `url('${img}')`;
    av.style.background = `url('${img}') center/cover no-repeat`;
    av.textContent = "";
    $("#ac-photo-clear").style.display = "";
  } else {
    av.style.backgroundImage = "";
    av.style.background = $("#ac-color").value || avatarColor(ME.displayName);
    av.textContent = $("#ac-emoji").value.trim() || initials($("#ac-name").value || ME.displayName);
    $("#ac-photo-clear").style.display = "none";
  }
}

// Read a chosen file, downscale it to a small square thumbnail on a canvas,
// and return a compact JPEG data URL. Keeps db.json small and avoids any
// server-side upload handling (this app is file-backed).
function fileToThumb(file, max = 256) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Couldn't read that file."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("That image won't load."));
      img.onload = () => {
        const side = Math.min(img.width, img.height);
        const sx = (img.width - side) / 2;
        const sy = (img.height - side) / 2;
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = max;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, sx, sy, side, side, 0, 0, max, max);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

(async function init() {
  try {
    ME = (await api("/api/auth/me")).user;
    if (!ME) return (location.href = "/login.html?next=/account.html");
  } catch { return; }

  $("#whoUser").textContent = "@" + ME.username;
  $("#ac-name").value = ME.displayName;
  $("#ac-bio").value = ME.bio || "";
  $("#ac-emoji").value = ME.avatarEmoji || "";
  $("#ac-color").value = ME.avatarColor || avatarColor(ME.displayName);
  paintAvatar();
  $("#ac-name").addEventListener("input", paintAvatar);
  $("#ac-emoji").addEventListener("input", paintAvatar);
  $("#ac-color").addEventListener("input", paintAvatar);

  // Photo upload: pick a file, downscale, stage it for the next save.
  $("#ac-photo-btn").addEventListener("click", () => $("#ac-photo").click());
  $("#ac-photo").addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = ""; // let the same file be re-picked later
    if (!file) return;
    if (!file.type.startsWith("image/")) return toast("Pick an image file.", true);
    try {
      PHOTO = await fileToThumb(file);
      paintAvatar();
      toast("Photo ready — hit Save profile to keep it.");
    } catch (err) { toast(err.message, true); }
  });
  $("#ac-photo-clear").addEventListener("click", () => {
    PHOTO = "";
    paintAvatar();
    toast("Photo removed — hit Save profile to confirm.");
  });

  $("#logoutBtn").addEventListener("click", async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    location.href = "/login.html";
  });

  $("#ac-save").addEventListener("click", async () => {
    try {
      const payload = {
        displayName: $("#ac-name").value.trim(),
        bio: $("#ac-bio").value.trim(),
        avatarEmoji: $("#ac-emoji").value.trim(),
        avatarColor: $("#ac-color").value,
      };
      if (PHOTO !== undefined) payload.avatarImage = PHOTO; // only send when changed
      const { user } = await api("/api/auth/me", "PUT", payload);
      ME = user;
      PHOTO = undefined;
      paintAvatar();
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
