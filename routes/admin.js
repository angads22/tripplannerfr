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

// Migrate the old seeded Toronto trip to the new system.
// Copies members and data, deletes the old trip.
router.post("/migrate-toronto", (req, res) => {
  const crypto = require("crypto");
  const old = db.getTrips().find((t) => t.slug === "toronto");
  if (!old) return res.status(404).json({ error: "Toronto trip not found." });

  const now = new Date().toISOString();
  const members = Array.isArray(old.members) ? [...old.members] : [];
  const newTrip = {
    id: crypto.randomUUID(),
    slug: "toronto",
    title: old.title || "Toronto",
    subtitle: old.subtitle || "the Yonge Street run",
    date: old.date || "2026-06-24",
    emoji: old.emoji || "🏙️",
    theme: old.theme || "red",
    tags: Array.isArray(old.tags) ? [...old.tags] : [],
    crew: Array.isArray(old.crew) ? [...old.crew] : [],
    members,
    stops: Array.isArray(old.stops) ? [...old.stops] : [],
    activity: Array.isArray(old.activity) ? [...old.activity] : [],
    proposals: Array.isArray(old.proposals) ? [...old.proposals] : [],
    mapUrl: old.mapUrl || "",
    pageFile: old.pageFile || "toronto.html",
    joinCode: old.joinCode || crypto.randomBytes(5).toString("hex"),
    shareWithEveryone: false,
    createdBy: old.createdBy || null,
    createdByName: old.createdByName || "seed",
    createdAt: old.createdAt || now,
    updatedAt: now,
  };

  db.addTrip(newTrip);
  db.deleteTrip(old.id);

  res.json({
    ok: true,
    message: `Migrated Toronto trip. ${members.length} member(s) retained access.`,
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
