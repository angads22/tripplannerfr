"use strict";

// Schema-based input validation & sanitization.
//
// OWASP API3:2023 (Broken Object Property Level Authorization) and the classic
// "mass assignment" / injection problems both come down to trusting the shape
// of req.body. This module gives every write endpoint a small, declarative
// schema so we:
//   - reject anything that isn't a plain JSON object,
//   - reject unexpected / unknown fields (no silent mass-assignment),
//   - type-check every field (string / int / number / boolean / enum / array),
//   - enforce length and numeric range limits,
//   - trim & coerce into a clean object the handler can trust (req.valid).
//
// It is intentionally dependency-free and tiny — no ajv/joi — matching this
// app's "keep it light, ship as one exe" philosophy.

// A field schema looks like:
//   { type: "string", required: true, min: 3, max: 60, pattern: /.../, trim: true }
//   { type: "int", min: 0, max: 999 }
//   { type: "enum", values: ["a","b"] }
//   { type: "array", of: { type: "string", max: 40 }, max: 8 }
//   { type: "boolean" }
//   { type: "number", min: 0, max: 1e9 }
// Top-level: { fieldName: fieldSchema, ... }

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

// Validate one value against a field schema. Returns { ok, value } or
// { ok:false, error }.
function checkField(name, value, schema) {
  // Absent values: enforce `required`, otherwise skip (leaves field unset).
  if (value === undefined || value === null) {
    if (schema.required) return { ok: false, error: `${name} is required.` };
    return { ok: true, skip: true };
  }

  switch (schema.type) {
    case "string": {
      if (typeof value !== "string") return { ok: false, error: `${name} must be text.` };
      let s = schema.trim === false ? value : value.trim();
      if (schema.max != null && s.length > schema.max) {
        // Length-limit rather than reject, so a long paste is clipped not lost —
        // mirrors the existing str() behaviour throughout the app.
        s = s.slice(0, schema.max);
      }
      if (schema.required && s.length === 0) return { ok: false, error: `${name} can't be empty.` };
      if (schema.min != null && s.length > 0 && s.length < schema.min) {
        return { ok: false, error: `${name} must be at least ${schema.min} characters.` };
      }
      if (schema.pattern && s.length > 0 && !schema.pattern.test(s)) {
        return { ok: false, error: schema.patternMessage || `${name} has an invalid format.` };
      }
      return { ok: true, value: s };
    }
    case "int":
    case "number": {
      const n = schema.type === "int" ? parseInt(value, 10) : Number(value);
      if (!Number.isFinite(n)) return { ok: false, error: `${name} must be a number.` };
      let v = n;
      if (schema.min != null && v < schema.min) v = schema.min;
      if (schema.max != null && v > schema.max) v = schema.max;
      return { ok: true, value: v };
    }
    case "boolean": {
      return { ok: true, value: !!value };
    }
    case "enum": {
      const s = typeof value === "string" ? value.trim() : value;
      if (!schema.values.includes(s)) {
        return { ok: false, error: `${name} must be one of: ${schema.values.join(", ")}.` };
      }
      return { ok: true, value: s };
    }
    case "array": {
      if (!Array.isArray(value)) return { ok: false, error: `${name} must be a list.` };
      let arr = value;
      if (schema.max != null) arr = arr.slice(0, schema.max);
      const out = [];
      for (const el of arr) {
        const r = checkField(name + "[]", el, schema.of);
        if (!r.ok) return r;
        if (!r.skip) out.push(r.value);
      }
      return { ok: true, value: out };
    }
    default:
      return { ok: false, error: `${name} has an unsupported type.` };
  }
}

// Core validator: returns { ok, value } or { ok:false, error }.
// `opts.strict` (default true) rejects unknown fields outright.
function validate(body, schema, opts = {}) {
  const strict = opts.strict !== false;
  if (!isPlainObject(body)) return { ok: false, error: "Expected a JSON object." };

  if (strict) {
    const allowed = new Set(Object.keys(schema));
    for (const key of Object.keys(body)) {
      if (!allowed.has(key)) {
        return { ok: false, error: `Unexpected field: ${key}.` };
      }
    }
  }

  const out = {};
  for (const [name, fieldSchema] of Object.entries(schema)) {
    const r = checkField(name, body[name], fieldSchema);
    if (!r.ok) return r;
    if (!r.skip) out[name] = r.value;
  }
  return { ok: true, value: out };
}

// Express middleware factory: validates req.body and stashes the cleaned object
// on req.valid. On failure responds 400 with a clear message.
function body(schema, opts = {}) {
  return function validateBody(req, res, next) {
    const r = validate(req.body || {}, schema, opts);
    if (!r.ok) return res.status(400).json({ error: r.error });
    req.valid = r.value;
    next();
  };
}

module.exports = { validate, body, checkField, isPlainObject };
