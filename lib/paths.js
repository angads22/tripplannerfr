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

// Folder that contains public/ and content/ (READ). __dirname resolves to the
// app root — in dev that's the project root; in a pkg exe it's the bundled,
// read-only snapshot (e.g. C:\snapshot\tripplannerfr). Only ever READ from here.
const APP_DIR = path.join(__dirname, "..");

// The REAL folder the app runs from on disk — next to the .exe when packaged,
// or the project root in dev. Anything we WRITE (data/, the downloaded update
// exe, the update .bat) must go here, NOT into the read-only snapshot.
const EXE_DIR = isPackaged ? path.dirname(process.execPath) : APP_DIR;

// data/ is written next to the exe when packaged, or in project root in dev.
const DATA_DIR = path.join(EXE_DIR, "data");
const PUBLIC_DIR = path.join(APP_DIR, "public");
const CONTENT_DIR = path.join(APP_DIR, "content");

module.exports = { isPackaged, APP_DIR, EXE_DIR, DATA_DIR, PUBLIC_DIR, CONTENT_DIR };
