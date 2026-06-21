"use strict";

const $ = (s) => document.querySelector(s);
const errorBox = $("#error");

function showError(msg) {
  errorBox.textContent = msg;
  errorBox.classList.add("show");
}
function clearError() {
  errorBox.classList.remove("show");
}

async function api(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

// Tab switching
const tabLogin = $("#tabLogin");
const tabRegister = $("#tabRegister");
const loginForm = $("#loginForm");
const registerForm = $("#registerForm");

function selectTab(which) {
  clearError();
  const login = which === "login";
  tabLogin.classList.toggle("active", login);
  tabRegister.classList.toggle("active", !login);
  loginForm.style.display = login ? "" : "none";
  registerForm.style.display = login ? "none" : "";
}
tabLogin.addEventListener("click", () => selectTab("login"));
tabRegister.addEventListener("click", () => selectTab("register"));

// First-run: if there are no users yet, show the owner-setup banner and
// hide the invite-code field (the first account is the owner).
(async function checkSetup() {
  try {
    const res = await fetch("/api/auth/needs-setup");
    const { needsSetup } = await res.json();
    if (needsSetup) {
      $("#setupBanner").style.display = "block";
      $("#inviteField").style.display = "none";
      selectTab("register");
    }
  } catch {
    /* ignore — server may still be warming up */
  }
})();

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearError();
  const fd = new FormData(loginForm);
  try {
    await api("/api/auth/login", {
      username: fd.get("username"),
      password: fd.get("password"),
    });
    location.href = "/";
  } catch (err) {
    showError(err.message);
  }
});

registerForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearError();
  const fd = new FormData(registerForm);
  try {
    await api("/api/auth/register", {
      displayName: fd.get("displayName"),
      username: fd.get("username"),
      password: fd.get("password"),
      inviteCode: fd.get("inviteCode"),
    });
    location.href = "/";
  } catch (err) {
    showError(err.message);
  }
});
