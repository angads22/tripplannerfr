"use strict";

// In-memory sliding-window rate limiter. No external dependencies.
//
// Keeps an append-only list of request timestamps per key (default: req.ip).
// On each call it prunes entries older than `windowMs`, then allows or blocks.
// A background interval sweeps idle keys so the Map doesn't grow unbounded.

const store = new Map(); // key → number[] (unix-ms timestamps, oldest first)

function prune(times, windowMs) {
  const cutoff = Date.now() - windowMs;
  let i = 0;
  while (i < times.length && times[i] <= cutoff) i++;
  return i > 0 ? times.slice(i) : times;
}

// Drop keys with no activity in the last hour.
setInterval(() => {
  const horizon = Date.now() - 3_600_000;
  for (const [key, times] of store) {
    if (!times.length || times[times.length - 1] < horizon) store.delete(key);
  }
}, 60_000).unref(); // unref so the timer doesn't block process exit

/**
 * Returns Express middleware that enforces at most `max` requests per
 * `windowMs` milliseconds.
 *
 * @param {object} opts
 * @param {number}   opts.windowMs  Window length in milliseconds.
 * @param {number}   opts.max       Maximum requests allowed in the window.
 * @param {string}  [opts.message]  Human-readable error text for the 429 body.
 * @param {function}[opts.keyFn]    (req) => string key; defaults to req.ip.
 */
function rateLimit({ windowMs, max, message = "Too many requests — please slow down and try again.", keyFn }) {
  return function rateLimitMiddleware(req, res, next) {
    const key = keyFn ? keyFn(req) : (req.ip || "unknown");
    const now  = Date.now();

    const times = prune(store.get(key) || [], windowMs);

    if (times.length >= max) {
      const retryAfter = Math.max(1, Math.ceil((times[0] + windowMs - now) / 1000));
      res.set("Retry-After", String(retryAfter));
      return res.status(429).json({ error: message, retryAfter });
    }

    times.push(now);
    store.set(key, times);
    next();
  };
}

module.exports = { rateLimit };
