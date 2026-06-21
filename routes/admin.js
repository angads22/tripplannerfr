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
const { isPackaged, APP_DIR } = require("../lib/paths");

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
        const file = fs.createWriteStream(dest);
        resp.pipe(file);
        file.on("finish", () => file.close(() => resolve()));
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
    const newPath = path.join(APP_DIR, "TripPlanner-new.exe");
    const batPath = path.join(APP_DIR, "apply-update.bat");

    await download(latest.exeUrl, newPath);

    const bat = [
      "@echo off",
      'cd /d "%~dp0"',
      "echo Updating Trip Planner, please wait...",
      ":wait",
      `tasklist /fi "imagename eq ${exeName}" | find /i "${exeName}" >nul && (timeout /t 1 /nobreak >nul & goto wait)`,
      `move /y "TripPlanner-new.exe" "${exeName}" >nul`,
      `start "" "${exeName}"`,
      "timeout /t 2 /nobreak >nul",
      'start "" http://localhost:4040',
      'del "%~f0"',
    ].join("\r\n");
    fs.writeFileSync(batPath, bat, "utf8");

    const child = spawn("cmd.exe", ["/c", batPath], { detached: true, stdio: "ignore", cwd: APP_DIR });
    child.unref();

    res.json({ ok: true, message: `Updating to build ${latest.build}. The app will restart on its own.` });
    setTimeout(() => process.exit(0), 600);
  } catch (err) {
    res.status(500).json({ error: "Update failed: " + err.message });
  }
});

module.exports = router;
