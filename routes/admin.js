"use strict";

// Admin-only server controls. The reliable on/off is still the Start/Stop
// .bat files, but this lets the owner shut the server down from the console.

const express = require("express");
const { requireAdmin } = require("../lib/auth-middleware");

const router = express.Router();
router.use(requireAdmin);

router.post("/shutdown", (req, res) => {
  res.json({ ok: true, message: "Shutting down. You'll need to run Start Trip Planner.bat to turn it back on." });
  setTimeout(() => process.kill(process.pid, "SIGTERM"), 250);
});

router.get("/check-update", async (req, res) => {
  try {
    const https = require("https");
    const response = await new Promise((resolve, reject) => {
      https.get("https://api.github.com/repos/angads22/tripplannerfr/releases/latest",
        { headers: { "User-Agent": "TripPlanner" } }, resolve).on("error", reject);
    });
    if (response.statusCode !== 200) return res.json({ hasUpdate: false });

    let body = "";
    for await (const chunk of response) body += chunk;
    const release = JSON.parse(body);
    const latestTag = release.tag_name || "v0";
    const exeAsset = release.assets?.find(a => a.name === "TripPlanner.exe");

    res.json({
      hasUpdate: latestTag > "v0",
      latestTag,
      downloadUrl: exeAsset?.browser_download_url || `https://github.com/angads22/tripplannerfr/releases/tag/${latestTag}`,
      currentVersion: "v1"
    });
  } catch (err) {
    res.json({ hasUpdate: false, error: err.message });
  }
});

module.exports = router;
