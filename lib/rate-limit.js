"use strict";

// A tiny, dependency-free, in-memory rate limiter.
//
// Why hand-rolled instead of `express-rate-limit`? This app is deliberately
// dependency-light and ships as a single `pkg` binary — fewer deps means fewer
// antivirus false positives and a smaller attack surface. The app is a single
// process with no database, so an in-memory fixed-window counter is exactly the
// right tool: no Redis, no extra moving parts.
//
// OWASP guidance (API4:2023 — Unrestricted Resource Consumption) calls for
// throttling on every public entry point. We key by client IP *and*, when the
// caller is logged in, by user id — so one abusive account can't burn the
// shared IP budget for everyone behind the same NAT/tunnel, and an
// unauthenticated flood is still bounded per source IP.

// Each bucket: { count, resetAt }. Kept in a Map and swept periodically so the
// process doesn't grow unbounded under a wide spray of source IPs.
const buckets = new Map();

// Sweep expired buckets every minute. `unref()` so this timer never keeps the
// process alive on its own (important for clean shutdown / the on-off buttons).
const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [key, b] of buckets) {
    if (b.resetAt <= now) buckets.delete(key);
  }
}, 60 * 1000);
if (sweeper.unref) sweeper.unref();

// Best-effort client IP. Express's req.ip already honours `trust proxy`, which
// server.js sets to 1 for the Cloudflare tunnel, so this is the real client
// address rather than the proxy's.
function clientIp(req) {
  return req.ip || (req.connection && req.connection.remoteAddress) || "unknown";
}

/**
 * Build a rate-limiting middleware.
 *
 * @param {object} opts
 * @param {number} opts.windowMs  Sliding window length in ms.
 * @param {number} opts.max       Max requests per key per window.
 * @param {string} [opts.message] 429 body message.
 * @param {boolean} [opts.byUser] Also scope the key to the logged-in user id.
 * @param {string} [opts.name]    Label for the bucket namespace (so different
 *                                limiters don't share counters).
 */
function rateLimit(opts) {
  const windowMs = opts.windowMs;
  const max = opts.max;
  const message = opts.message || "Too many requests — slow down and try again in a moment.";
  const name = opts.name || "default";
  const byUser = !!opts.byUser;

  return function rateLimiter(req, res, next) {
    // Compose the bucket key: namespace + IP (+ user id when available/asked).
    const uid = byUser && req.session && req.session.userId ? req.session.userId : "";
    const key = name + "|" + clientIp(req) + "|" + uid;

    const now = Date.now();
    let b = buckets.get(key);
    if (!b || b.resetAt <= now) {
      b = { count: 0, resetAt: now + windowMs };
      buckets.set(key, b);
    }
    b.count++;

    const remaining = Math.max(0, max - b.count);
    const resetSecs = Math.ceil((b.resetAt - now) / 1000);

    // Standard-ish informational headers so well-behaved clients can back off.
    res.setHeader("RateLimit-Limit", String(max));
    res.setHeader("RateLimit-Remaining", String(remaining));
    res.setHeader("RateLimit-Reset", String(resetSecs));

    if (b.count > max) {
      // Graceful 429: tell the caller exactly how long to wait. JSON for the
      // API so the frontend's fetch wrapper surfaces a clean message.
      res.setHeader("Retry-After", String(resetSecs));
      return res.status(429).json({ error: message, retryAfter: resetSecs });
    }
    next();
  };
}

// Test/maintenance hook: wipe all counters (used by nothing in prod, handy for
// resetting between automated checks).
function _resetAll() {
  buckets.clear();
}

module.exports = { rateLimit, _resetAll };
