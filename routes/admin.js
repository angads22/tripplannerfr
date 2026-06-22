"use strict";

// Admin-only server controls: shut down, and a real self-updater backed by
// GitHub Releases.
//
// Distribution: a GitHub Action builds TripPlanner.exe on every push to main
// and publishes it as a Release tagged v<build> (a monotonic build number).
// Each exe is stamped with the build number it came from (build-info.json),
// so the app can tell whether the latest Release is newer than itself.
//
// Update flow (packaged exe only): download the latest release's exe next to
// the current one, write a tiny apply-update.bat that waits for this app to
// exit, swaps the file, and relaunches. Running from source? Use `git pull`.

const express = require("express");
const fs = require("fs");
const path = require("path");
const https = require("https");
const { spawn } = require("child_process");
const { requireAdmin } = require("../lib/auth-middleware");
const { isPackaged, EXE_DIR } = require("../lib/paths");
const db = require("../lib/db");

const REPO = "angads22/tripplannerfr";
const LATEST_RELEASE_API = `https://api.github.com/repos/${REPO}/releases/latest`;

// What build this exe was made from (stamped by CI; 0 in dev).
let APP_BUILD = 0;
let APP_VERSION = require("../package.json").version;
try {
  const info = require("../build-info.json");
  APP_BUILD = parseInt(info.build, 10) || 0;
  if (info.version) APP_VERSION = info.version;
} catch {
  /* dev without a stamp */
}

const router = express.Router();
router.use(requireAdmin);

// --- helpers ---------------------------------------------------------------

function fetchText(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error("Too many redirects."));
    https
      .get(url, { headers: { "User-Agent": "TripPlanner" } }, (resp) => {
        if ([301, 302, 307, 308].includes(resp.statusCode) && resp.headers.location) {
          resp.resume();
          return resolve(fetchText(resp.headers.location, redirects + 1));
        }
        if (resp.statusCode !== 200) {
          resp.resume();
          return reject(new Error("HTTP " + resp.statusCode));
        }
        let body = "";
        resp.on("data", (c) => (body += c));
        resp.on("end", () => resolve(body));
      })
      .on("error", reject);
  });
}

function download(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error("Too many redirects."));
    https
      .get(url, { headers: { "User-Agent": "TripPlanner" } }, (resp) => {
        if ([301, 302, 307, 308].includes(resp.statusCode) && resp.headers.location) {
          resp.resume();
          return resolve(download(resp.headers.location, dest, redirects + 1));
        }
        if (resp.statusCode !== 200) {
          resp.resume();
          return reject(new Error("HTTP " + resp.statusCode));
        }
        const expected = parseInt(resp.headers["content-length"] || "0", 10);
        const file = fs.createWriteStream(dest);
        let written = 0;
        resp.on("data", (c) => (written += c.length));
        resp.pipe(file);
        file.on("finish", () => file.close(() => {
          // Guard against a truncated download producing a broken exe.
          if (expected && written < expected) {
            return reject(new Error(`Incomplete download (${written}/${expected} bytes)`));
          }
          if (written < 1_000_000) return reject(new Error("Downloaded file is too small — aborting."));
          resolve(written);
        }));
        file.on("error", reject);
      })
      .on("error", reject);
  });
}

// Pull the latest release's build number + exe asset URL from GitHub.
async function getLatestRelease() {
  const rel = JSON.parse(await fetchText(LATEST_RELEASE_API));
  const tag = rel.tag_name || "v0";
  const build = parseInt(String(tag).replace(/^v/, ""), 10) || 0;
  const asset = (rel.assets || []).find((a) => a.name === "TripPlanner.exe");
  return { build, tag, name: rel.name || tag, exeUrl: asset && asset.browser_download_url, htmlUrl: rel.html_url };
}

// --- routes ----------------------------------------------------------------

// Activity log: every trip's changelog merged with account sign-ups, newest
// first. Gives the admin one place to see who did what across the whole app.
// Trip-activity rows carry tripId + activityId so the admin can prune them.
router.get("/logs", (req, res) => {
  const events = [];
  for (const t of db.getTrips()) {
    for (const a of Array.isArray(t.activity) ? t.activity : []) {
      events.push({
        ts: a.ts, who: a.userName || "someone", text: a.text || "",
        trip: t.title || "", slug: t.slug || "",
        tripId: t.id, activityId: a.id, // present only for deletable trip events
      });
    }
  }
  for (const u of db.getUsers()) {
    if (u.createdAt) {
      events.push({ ts: u.createdAt, who: u.displayName, text: u.isAdmin ? "created the admin account" : "created an account", trip: "", slug: "" });
    }
  }
  events.sort((a, b) => String(b.ts).localeCompare(String(a.ts)));
  res.json({ logs: events.slice(0, 200) });
});

// --- Trip overrides (admin-only; the ONE place permissions are overridable) -
//
// The regular trip page is strictly creator-based. These endpoints are the
// admin's escape hatch: list every trip, delete any of them, flip sharing,
// remove anyone, or prune a stray activity entry — regardless of who owns it.

// A compact view of a trip for the admin console's trip table.
function adminTrip(t) {
  const members = (Array.isArray(t.members) ? t.members : [])
    .map((id) => db.findUserById(id))
    .filter(Boolean)
    .map((u) => ({ id: u.id, displayName: u.displayName }));
  return {
    id: t.id,
    slug: t.slug,
    title: t.title,
    emoji: t.emoji || "🚗",
    theme: t.theme || "red",
    date: t.date || "",
    creatorName: t.createdByName || "",
    creatorId: t.createdBy || null,
    shareWithEveryone: !!t.shareWithEveryone,
    members,
    memberCount: members.length,
  };
}

// Every trip in the app (override view — bypasses board membership).
router.get("/trips", (req, res) => {
  const trips = db
    .getTrips()
    .slice()
    .sort((a, b) => (a.date || a.createdAt || "").localeCompare(b.date || b.createdAt || ""))
    .map(adminTrip);
  res.json({ trips });
});

// Delete any trip.
router.delete("/trips/:id", (req, res) => {
  const t = db.findTripById(req.params.id);
  if (!t) return res.status(404).json({ error: "Trip not found." });
  db.deleteTrip(t.id);
  res.json({ ok: true });
});

// Flip a trip's public/private sharing.
router.put("/trips/:id/access", (req, res) => {
  const t = db.findTripById(req.params.id);
  if (!t) return res.status(404).json({ error: "Trip not found." });
  db.updateTrip(t.id, { shareWithEveryone: !!(req.body || {}).shareWithEveryone });
  res.json({ trip: adminTrip(db.findTripById(t.id)) });
});

// Remove anyone from any trip (the creator included — handy if an account is
// being cleaned up). Returns the refreshed trip row.
router.delete("/trips/:id/members/:userId", (req, res) => {
  const t = db.findTripById(req.params.id);
  if (!t) return res.status(404).json({ error: "Trip not found." });
  const members = (Array.isArray(t.members) ? t.members : []).filter((id) => id !== req.params.userId);
  db.updateTrip(t.id, { members });
  res.json({ trip: adminTrip(db.findTripById(t.id)) });
});

// Prune a single activity entry from a trip's changelog.
router.delete("/trips/:id/activity/:activityId", (req, res) => {
  const t = db.findTripById(req.params.id);
  if (!t) return res.status(404).json({ error: "Trip not found." });
  const activity = (Array.isArray(t.activity) ? t.activity : []).filter((a) => a.id !== req.params.activityId);
  db.updateTrip(t.id, { activity });
  res.json({ ok: true });
});

// The Yonge Street itinerary, ported from the rich custom toronto.html page
// into the editable modular stop format ({time, title, place, note}). These
// are the 8 "active" stops from that page's plan, in order, with sensible
// clock times built around Gyukatsu's hard noon open. The add-on shelf
// (Wahoo / karaoke / Eaton round-two) is left off so the migrated plan
// mirrors what the custom page showed by default.
const TORONTO_STOPS = [
  { time: "10:00", title: "HTO Park", place: "339 Queens Quay W, Toronto",
    note: "A waterfront park to open the day — nothing else is open before ~10–11a, so you burn the early hour by the lake. CN Tower right behind you for photos." },
  { time: "10:45", title: "CF Toronto Eaton Centre", place: "220 Yonge St, Toronto",
    note: "Your big shopping block while everyone's fresh. Uniqlo, H&M, and the large MINISO at 220 Yonge. Take the PATH up from the lake so you arrive indoors." },
  { time: "12:00", title: "Gyukatsu Kyoto Katsugyu", place: "134 Dundas St E, Toronto",
    note: "Grill-your-own Japanese beef katsu at your seat — a fun group lunch. Small room, fills fast. Hit the noon open to skip the line; lunch service ends 3p sharp." },
  { time: "13:15", title: "OHYO Spree Claw Machines", place: "340 Yonge St, Toronto",
    note: "Bright claw-machine arcade right on Yonge (4.9★). Cheap, fast, very on-theme — a quick win on the way north before IKEA." },
  { time: "13:45", title: "IKEA Toronto Downtown", place: "382 Yonge St, Toronto",
    note: "The downtown walk-through IKEA (not the full warehouse). Quick loop for the novelty; Swedish snacks if you want them. Two doors from 401 Games." },
  { time: "14:30", title: "401 Games", place: "431 Yonge St, Toronto",
    note: "Steps from IKEA. TCG, Pokémon, board games — deep selection and staff who actually know it. Easy to lose 45 min here." },
  { time: "15:15", title: "Souper Hot Pot", place: "476 Yonge St, Toronto",
    note: "The hot pot. Individual pots with a self-serve ingredient bar, so everyone builds their own broth. Budget-friendly, rarely a long wait. Near College station for the ride back." },
  { time: "16:45", title: "Snowday Bingsu", place: "449 Church St, Toronto",
    note: "Korean shaved-ice dessert, one block east on Church. A cool-down before the heavy dinner. Opens 1p, so it lands mid-afternoon." },
];

// Migrate the old seeded Toronto trip into the editable modular system.
// Ports the itinerary into real stops, drops the custom pageFile (so it
// renders the generic trip page with all the new features), keeps members
// and the join code, then deletes the old trip. Idempotent-ish: if Toronto
// is already modular (no pageFile), it's a no-op.
router.post("/migrate-toronto", (req, res) => {
  const crypto = require("crypto");
  const old = db.getTrips().find((t) => t.slug === "toronto");
  if (!old) return res.status(404).json({ error: "Toronto trip not found." });
  if (!old.pageFile) {
    return res.json({ ok: true, alreadyModular: true, message: "Toronto is already on the modular system.", trip: adminTrip(old) });
  }

  const now = new Date().toISOString();
  const members = Array.isArray(old.members) ? [...old.members] : [];
  // Keep any stops the crew already added on top of the seeded plan.
  const portedStops = TORONTO_STOPS.map((s, i) => ({
    id: crypto.randomUUID(), time: s.time, title: s.title, place: s.place, note: s.note,
    done: false, order: i,
  }));
  const existingStops = (Array.isArray(old.stops) ? old.stops : []).map((s, i) => ({
    ...s, order: (typeof s.order === "number" ? s.order : portedStops.length + i),
  }));

  const newTrip = {
    id: crypto.randomUUID(),
    slug: "toronto",
    title: old.title || "Toronto",
    subtitle: old.subtitle || "the Yonge Street run",
    date: old.date || "2026-06-24",
    emoji: old.emoji || "🏙️",
    theme: old.theme || "red",
    tags: Array.isArray(old.tags) ? [...old.tags] : ["Day trip", "Yonge St run", "Hot pot", "GO train"],
    crew: [], // legacy display-only names are dropped; only real accounts are members
    members,
    stops: [...portedStops, ...existingStops],
    activity: [
      ...(Array.isArray(old.activity) ? old.activity : []),
      { id: crypto.randomUUID(), ts: now, userId: null, userName: "system", text: "migrated to the editable trip system" },
    ],
    proposals: Array.isArray(old.proposals) ? [...old.proposals] : [],
    mapUrl: old.mapUrl || "",
    // No pageFile → served by the generic, fully-editable trip page.
    joinCode: old.joinCode || crypto.randomBytes(5).toString("hex"),
    shareWithEveryone: !!old.shareWithEveryone,
    createdBy: old.createdBy || null,
    createdByName: old.createdByName || "seed",
    createdAt: old.createdAt || now,
    updatedAt: now,
  };

  db.addTrip(newTrip);
  db.deleteTrip(old.id);

  res.json({
    ok: true,
    message: `Migrated Toronto to the editable system with ${portedStops.length} stops. ${members.length} member(s) kept access.`,
    trip: adminTrip(newTrip),
  });
});

router.post("/shutdown", (req, res) => {
  res.json({ ok: true, message: "Shutting down. Run Start Trip Planner.bat (or the exe) to turn it back on." });
  setTimeout(() => process.kill(process.pid, "SIGTERM"), 250);
});

router.get("/check-update", async (req, res) => {
  try {
    const latest = await getLatestRelease();
    res.json({
      currentVersion: APP_VERSION,
      currentBuild: APP_BUILD,
      latestBuild: latest.build,
      releaseName: latest.name,
      releaseUrl: latest.htmlUrl,
      hasUpdate: latest.build > APP_BUILD,
      isPackaged,
      canSelfUpdate: isPackaged && !!latest.exeUrl,
    });
  } catch (err) {
    res.json({ hasUpdate: false, currentVersion: APP_VERSION, currentBuild: APP_BUILD, error: err.message });
  }
});

// Download the latest release exe and swap-and-restart. Packaged only.
router.post("/apply-update", async (req, res) => {
  if (!isPackaged) {
    return res.status(400).json({ error: "Running from source — update with: git pull, then restart." });
  }
  try {
    const latest = await getLatestRelease();
    if (latest.build <= APP_BUILD) {
      return res.json({ ok: true, upToDate: true, message: "Already on the latest build." });
    }
    if (!latest.exeUrl) return res.status(500).json({ error: "Latest release has no TripPlanner.exe asset." });

    const exeName = path.basename(process.execPath); // e.g. TripPlanner.exe
    // Write next to the real exe — NOT into the read-only pkg snapshot.
    const newPath = path.join(EXE_DIR, "TripPlanner-new.exe");
    const batPath = path.join(EXE_DIR, "apply-update.bat");

    console.log(`\n  ⏬ Update: downloading build ${latest.build} …`);
    const bytes = await download(latest.exeUrl, newPath);
    console.log(`  ⏬ Update: downloaded ${(bytes / 1048576).toFixed(1)} MB → swapping & relaunching`);

    // Self-healing updater: back up the current exe, swap in the new one, start
    // it, and if it doesn't come up in a few seconds, roll back to the backup so
    // the site never gets stuck on a bad build (the Bad Gateway problem). Every
    // step is logged to update-log.txt next to the exe.
    const bat = [
      "@echo off",
      'cd /d "%~dp0"',
      "set LOG=update-log.txt",
      `echo [%date% %time%] update to build ${latest.build} starting > "%LOG%"`,
      ":waitexit",
      `tasklist /fi "imagename eq ${exeName}" | find /i "${exeName}" >nul && (timeout /t 1 /nobreak >nul & goto waitexit)`,
      'echo [%time%] old process exited >> "%LOG%"',
      "timeout /t 2 /nobreak >nul",
      `if not exist "TripPlanner-new.exe" ( echo [%time%] ERROR: no new exe, aborting >> "%LOG%" & start "" "${exeName}" & goto done )`,
      `if exist "${exeName}" copy /y "${exeName}" "TripPlanner-old.exe" >nul`,
      `move /y "TripPlanner-new.exe" "${exeName}" >nul`,
      'echo [%time%] swapped in new build >> "%LOG%"',
      `start "" "${exeName}"`,
      "timeout /t 7 /nobreak >nul",
      `tasklist /fi "imagename eq ${exeName}" | find /i "${exeName}" >nul`,
      "if errorlevel 1 (",
      '  echo [%time%] new build did NOT start - rolling back >> "%LOG%"',
      `  if exist "TripPlanner-old.exe" ( move /y "TripPlanner-old.exe" "${exeName}" >nul & start "" "${exeName}" )`,
      ") else (",
      '  echo [%time%] new build is running >> "%LOG%"',
      '  del "TripPlanner-old.exe" >nul 2>&1',
      ")",
      ":done",
      'start "" http://localhost:4040',
      'del "%~f0"',
    ].join("\r\n");
    fs.writeFileSync(batPath, bat, "utf8");

    const child = spawn("cmd.exe", ["/c", batPath], { detached: true, stdio: "ignore", cwd: EXE_DIR });
    child.unref();

    res.json({ ok: true, build: latest.build, message: `Updating to build ${latest.build}. The app restarts itself — if the new build won't boot, it rolls back automatically.` });
    setTimeout(() => process.exit(0), 600);
  } catch (err) {
    // Download/verify failed BEFORE we touched anything — the site stays up.
    console.log("  ✖ Update failed (site left running): " + err.message);
    res.status(500).json({ error: "Update failed (site left running): " + err.message });
  }
});

module.exports = router;
