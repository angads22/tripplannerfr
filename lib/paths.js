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
const APP_DIR = isPackaged ? path.dirname(process.execPath) : path.join(__dirname, "..");

const DATA_DIR = path.join(APP_DIR, "data");
const PUBLIC_DIR = path.join(APP_DIR, "public");
const CONTENT_DIR = path.join(APP_DIR, "content");

module.exports = { isPackaged, APP_DIR, DATA_DIR, PUBLIC_DIR, CONTENT_DIR };
