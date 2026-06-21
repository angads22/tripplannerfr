"use strict";

const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);
const nextUrl = params.get("next") || "/";

function showError(msg) {
  const e = $("#error");
  e.textContent = msg;
  e.classList.add("show");
}
function clearError() {
  $("#error").classList.remove("show");
}

async function send(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

// Tabs
const tabLogin = $("#tabLogin");
const tabRegister = $("#tabRegister");
function selectTab(which) {
  clearError();
  const reg = which === "register";
  tabLogin.classList.toggle("active", !reg);
  tabRegister.classList.toggle("active", reg);
  $("#loginForm").style.display = reg ? "none" : "block";
  $("#registerForm").style.display = reg ? "block" : "none";
}
tabLogin.addEventListener("click", () => selectTab("login"));
tabRegister.addEventListener("click", () => selectTab("register"));

// First-run setup: if there are no accounts yet, nudge toward creating the admin.
(async function init() {
  try {
    const me = await fetch("/api/auth/me").then((r) => r.json());
    if (me.user) {
      location.href = nextUrl;
      return;
    }
    const { needsSetup } = await fetch("/api/auth/needs-setup").then((r) => r.json());
    if (needsSetup) {
      $("#setupBanner").style.display = "block";
      $("#inviteField").style.display = "none"; // first account skips the code
      selectTab("register");
      $("#hint").textContent = "No accounts yet — make yours to become the admin.";
    } else {
      $("#hint").innerHTML = 'New here? Switch to <span class="linkish" id="goReg">Create account</span> and use the invite code.';
      const go = $("#goReg");
      if (go) go.addEventListener("click", () => selectTab("register"));
    }
  } catch {
    /* offline-ish; forms still work */
  }
})();

$("#loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  clearError();
  try {
    await send("/api/auth/login", {
      username: $("#li-user").value.trim(),
      password: $("#li-pass").value,
    });
    location.href = nextUrl;
  } catch (err) {
    showError(err.message);
  }
});

$("#registerForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  clearError();
  try {
    await send("/api/auth/register", {
      displayName: $("#re-name").value.trim(),
      username: $("#re-user").value.trim(),
      password: $("#re-pass").value,
      inviteCode: $("#re-code").value.trim(),
    });
    location.href = nextUrl;
  } catch (err) {
    showError(err.message);
  }
});
