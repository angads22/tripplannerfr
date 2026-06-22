"use strict";

// Wrap an async Express handler so a thrown error or rejected promise is handed
// to Express's error middleware instead of becoming an *unhandled rejection*.
//
// Why this matters: on Node 18 an unhandled promise rejection terminates the
// whole process, and Express 4 does NOT catch errors thrown inside an
// `async (req, res)` handler. So a single hiccup (e.g. a transient file lock
// while saving db.json during "delete account") would take the entire site
// down. Wrapping every async route in `ah(...)` turns that into a clean 500.
function ah(fn) {
  return function (req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = { ah };
