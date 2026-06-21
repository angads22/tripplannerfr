"use strict";

// Resolve where the app's files live, working both as `node server.js` and as
// a packaged .exe.
//
// - When packaged (process.pkg is set), the JS is inside the read-only binary,
//   so anything we READ that ships alongside the exe (public/, content/) and
//   anything we WRITE (data/) must resolve next to the .exe itself.
// - In normal dev, everything sits in the project root.

const path = require("path");

const isPackaged = !!process.pkg;

// Folder that contains public/ and content/ (read) and where data/ is written.
// __dirname works correctly in both dev and pkg-packaged contexts.
// In dev: lib/paths.js is in lib/, so .. goes to project root.
// In pkg: __dirname resolves to app root within the bundled snapshot.
const APP_DIR = path.join(__dirname, "..");

// data/ is written next to the exe when packaged, or in project root in dev
const DATA_DIR = isPackaged ? path.join(path.dirname(process.execPath), "data") : path.join(APP_DIR, "data");
const PUBLIC_DIR = path.join(APP_DIR, "public");
const CONTENT_DIR = path.join(APP_DIR, "content");

module.exports = { isPackaged, APP_DIR, DATA_DIR, PUBLIC_DIR, CONTENT_DIR };
