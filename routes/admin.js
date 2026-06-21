"use strict";

// Admin-only server controls. The reliable on/off is still the Start/Stop
// .bat files, but this lets the owner shut the server down from the console.

const express = require("express");
const { requireAdmin } = require("../lib/auth-middleware");

const router = express.Router();
router.use(requireAdmin);

router.post("/shutdown", (req, res) => {
  res.json({ ok: true, message: "Shutting down. You'll need to run Start Trip Planner.bat to turn it back on." });
  // Give the response time to flush, then exit cleanly.
  setTimeout(() => process.kill(process.pid, "SIGTERM"), 250);
});

module.exports = router;
