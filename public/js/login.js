"use strict";

const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);
const nextUrl = params.get("next") || "/";

let needsSetup = false;

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

// --- Tabs / copy -----------------------------------------------------------
const tabLogin = $("#tabLogin");
const tabRegister = $("#tabRegister");

function selectTab(which) {
  clearError();
  const reg = which === "register";
  tabLogin.classList.toggle("active", !reg);
  tabRegister.classList.toggle("active", reg);
  $("#loginForm").style.display = reg ? "none" : "flex";
  $("#registerForm").style.display = reg ? "flex" : "none";
  $("#kicker").textContent = reg ? "pull up a seat" : "welcome back, driver";
  $("#heading").textContent = reg ? "Let's roll." : "Keys, please.";
  $("#footerNote").textContent = reg
    ? "By signing up you agree to split gas money. Probably."
    : "New here? Tap sign up, it takes ten seconds.";
  validate();
}
tabLogin.addEventListener("click", () => selectTab("login"));
tabRegister.addEventListener("click", () => selectTab("register"));

// --- Password eye ----------------------------------------------------------
document.querySelectorAll(".pw-toggle").forEach((btn) => {
  btn.addEventListener("click", () => {
    const input = document.getElementById(btn.dataset.for);
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    btn.textContent = show ? "🙈" : "👁️";
  });
});

// --- Live validation (button opacity) --------------------------------------
function validate() {
  const loginOk = $("#li-user").value.trim() && $("#li-pass").value.trim();
  $("#loginSubmit").disabled = !loginOk;

  const regOk =
    $("#re-name").value.trim() &&
    $("#re-user").value.trim() &&
    $("#re-pass").value.trim() &&
    (needsSetup || $("#re-code").value.trim());
  $("#registerSubmit").disabled = !regOk;
}
document.querySelectorAll("input").forEach((i) => i.addEventListener("input", validate));

// --- First-run setup -------------------------------------------------------
(async function init() {
  try {
    const me = await fetch("/api/auth/me").then((r) => r.json());
    if (me.user) {
      location.href = nextUrl;
      return;
    }
    const data = await fetch("/api/auth/needs-setup").then((r) => r.json());
    needsSetup = !!data.needsSetup;
    if (needsSetup) {
      $("#setupBanner").style.display = "block";
      $("#inviteField").style.display = "none";
      selectTab("register");
    }
  } catch {
    /* offline-ish; forms still work */
  }
  validate();
})();

// --- Submit ----------------------------------------------------------------
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
