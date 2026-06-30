"use strict";

// Shared site footer (developer credit + contact + FAQ) and PWA service-worker
// registration, injected on every page from one place so we don't duplicate
// markup across the 6 standalone HTML files. Plain DOM, no dependencies.
(function () {
  if (window.__pitstopFooter) return; // guard against a double include
  window.__pitstopFooter = true;

  // Bump alongside package.json / build-info.json on each release.
  var APP_VERSION = "2.5.0";
  var DEV_NAME = "Angad Sandha";
  var DEV_EMAIL = "1angad.sandha22@gmail.com";

  // --- FAQ content (kept here so it's easy to edit) -------------------------
  var FAQ = [
    ["How do I invite people to a trip?",
      "Open the trip and tap <b>Copy invite link</b> (or <b>Copy code</b>). Send it to whoever you want — only people with the link/code can join. Anyone on the trip can invite others."],
    ["How does someone join with a code?",
      "On the board, paste the trip code into the <b>“Got a trip code?”</b> box and hit Add trip. Or just open the invite link they were sent."],
    ["Who can see my trip?",
      "Trips are private to the crew by default. Other signed-in users can’t see a trip unless they’re a member or have the invite link/code. You can make a trip public from its Edit panel."],
    ["How does the budget split work?",
      "Each cost is either <b>Per person</b> (everyone pays it) or <b>Split group</b> (divided across the crew). The summary shows what each person pays, the trip total, and a category breakdown. Set the split size in budget settings."],
    ["How do I update the app?",
      "Admins can update from the Admin console — it checks for the latest release and updates safely (it verifies the new build boots before switching, so an update won’t take the site down)."],
    ["Is my data private?",
      "Yes. Everything is self-hosted in a single local file — there’s no third-party database and no analytics. Passwords are hashed; only people with the shared sign-up code can make an account."],
    ["I found a bug / have a feature idea.",
      "Please email me — see below. Bug reports and feature requests are very welcome."],
  ];

  // --- Build the FAQ modal (reuses the existing .scrim/.modal styles) -------
  function buildFaqModal() {
    var scrim = document.createElement("div");
    scrim.className = "scrim";
    scrim.id = "faqScrim";
    scrim.hidden = true;

    var items = FAQ.map(function (qa) {
      return (
        '<details class="faq-item"><summary>' + qa[0] + "</summary>" +
        '<div class="faq-item__a">' + qa[1] + "</div></details>"
      );
    }).join("");

    scrim.innerHTML =
      '<div class="modal" role="dialog" aria-modal="true" aria-label="FAQ">' +
      '<div class="modal__kicker">good to know</div>' +
      '<div class="modal__title">FAQ</div>' +
      '<div class="faq-list">' + items + "</div>" +
      '<div class="modal__foot"><button class="btn primary" id="faqClose" type="button">Got it</button></div>' +
      "</div>";

    document.body.appendChild(scrim);
    function close() { scrim.hidden = true; }
    scrim.addEventListener("click", function (e) { if (e.target === scrim) close(); });
    scrim.querySelector("#faqClose").addEventListener("click", close);
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });
    return scrim;
  }

  // --- Build the footer -----------------------------------------------------
  function buildFooter() {
    var foot = document.createElement("footer");
    foot.className = "site-foot";
    foot.innerHTML =
      '<div class="site-foot__inner">' +
      '<span class="site-foot__dev">Built by <b>' + DEV_NAME + "</b></span>" +
      '<span class="site-foot__sep">·</span>' +
      '<span>Questions, bugs, or feature ideas? ' +
      '<a href="mailto:' + DEV_EMAIL + '?subject=Pitstop%20feedback">' + DEV_EMAIL + "</a></span>" +
      '<span class="site-foot__sep">·</span>' +
      '<button type="button" class="site-foot__link" id="faqOpen">FAQ</button>' +
      '<span class="site-foot__sep">·</span>' +
      '<span class="site-foot__ver">v' + APP_VERSION + "</span>" +
      "</div>";
    document.body.appendChild(foot);

    var modal = buildFaqModal();
    foot.querySelector("#faqOpen").addEventListener("click", function () { modal.hidden = false; });
  }

  // --- Trailing cursor (desktop only) --------------------------------------
  // A soft ring that eases toward the pointer, tinted (via CSS var(--accent))
  // to whatever trip's accent is active. Skipped on touch devices and when the
  // user prefers reduced motion — the CSS hides #pit-cursor there too, but we
  // also avoid spinning up the animation loop at all.
  function initCursor() {
    var fine = window.matchMedia && window.matchMedia("(pointer: fine)").matches;
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!fine || reduce) return;

    var ring = document.createElement("div");
    ring.id = "pit-cursor";
    document.body.appendChild(ring);

    var mx = window.innerWidth / 2, my = window.innerHeight * 0.35;
    var cx = mx, cy = my, raf = 0, seen = false;
    window.addEventListener("pointermove", function (e) {
      mx = e.clientX; my = e.clientY;
      if (!seen) { cx = mx; cy = my; seen = true; }
    }, { passive: true });

    (function loop() {
      cx += (mx - cx) * 0.18;
      cy += (my - cy) * 0.18;
      ring.style.transform = "translate(" + cx + "px," + cy + "px) translate(-50%,-50%)";
      raf = requestAnimationFrame(loop);
    })();
    // Pause the loop when the tab is hidden so it isn't burning frames offscreen.
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) { cancelAnimationFrame(raf); }
      else { cancelAnimationFrame(raf); (function loop() {
        cx += (mx - cx) * 0.18; cy += (my - cy) * 0.18;
        ring.style.transform = "translate(" + cx + "px," + cy + "px) translate(-50%,-50%)";
        raf = requestAnimationFrame(loop);
      })(); }
    });
  }

  // --- PWA: register the network-first service worker -----------------------
  function registerSW() {
    if (!("serviceWorker" in navigator)) return;
    // Register after load so it never competes with first paint / data fetches.
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("/service-worker.js").catch(function () {
        /* non-fatal: the app works fine without offline support */
      });
    });
  }

  // --- iOS "Add to Home Screen" hint ---------------------------------------
  // iOS Safari has no install prompt — you add a PWA via Share → Add to Home
  // Screen. Show a one-time, dismissable hint to iOS users who aren't already
  // running it as an installed app.
  function maybeShowIosHint() {
    var ua = window.navigator.userAgent || "";
    var isIOS = /iPad|iPhone|iPod/.test(ua) ||
      // iPadOS 13+ reports as desktop Safari but is a touch Mac.
      (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    if (!isIOS) return;
    var standalone = ("standalone" in navigator && navigator.standalone) ||
      (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);
    if (standalone) return; // already installed
    try { if (localStorage.getItem("pitstop:iosHintDismissed") === "1") return; } catch (e) {}

    var bar = document.createElement("div");
    bar.className = "ios-install-hint";
    bar.innerHTML =
      '<span class="ios-install-hint__txt">📲 <b>Add Pitstop to your Home Screen:</b> ' +
      'tap the Share icon <span class="ios-share-glyph" aria-hidden="true">⎙</span> below, then <b>“Add to Home Screen.”</b></span>' +
      '<button class="ios-install-hint__x" type="button" aria-label="Dismiss">✕</button>';
    document.body.appendChild(bar);
    bar.querySelector(".ios-install-hint__x").addEventListener("click", function () {
      bar.remove();
      try { localStorage.setItem("pitstop:iosHintDismissed", "1"); } catch (e) {}
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { buildFooter(); maybeShowIosHint(); initCursor(); });
  } else {
    buildFooter();
    maybeShowIosHint();
    initCursor();
  }
  registerSW();
})();
