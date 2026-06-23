"use strict";

// OWASP-aligned HTTP security headers, set by hand so we don't pull in `helmet`
// (keeping the dependency-light, single-exe philosophy). Applied to every
// response in server.js.
//
// References: OWASP Secure Headers Project. We keep the policy compatible with
// this app's actual needs:
//   - the frontend is plain HTML/CSS/JS we ship ourselves (no inline-script
//     framework), but the pages DO use small inline style="" attributes and a
//     few inline <script> bodies, plus Google Fonts — so the CSP allows
//     'unsafe-inline' for styles and self+inline for scripts. This still blocks
//     the big wins: foreign script origins, framing, and object/embed.
//   - trips can set a cover image by URL and avatars are data: URLs, so img-src
//     allows https + data:.

// Content-Security-Policy tuned to what the app legitimately loads.
const CSP = [
  "default-src 'self'",
  // Scripts: our own files + the small inline bootstrap blocks in the HTML.
  "script-src 'self' 'unsafe-inline'",
  // Styles: our stylesheet + Google Fonts CSS + inline style="" attributes.
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  // Images: self, data: (avatars/emoji favicon), and any https cover URL.
  "img-src 'self' data: https:",
  // XHR/fetch stay same-origin (the API is local).
  "connect-src 'self'",
  // Lock down the dangerous sinks.
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

function securityHeaders(req, res, next) {
  // Stop MIME-type sniffing.
  res.setHeader("X-Content-Type-Options", "nosniff");
  // Defense-in-depth against clickjacking (frame-ancestors covers modern UAs).
  res.setHeader("X-Frame-Options", "DENY");
  // Don't leak full URLs (which can carry a trip's join code) to other origins.
  res.setHeader("Referrer-Policy", "no-referrer");
  // Drop powerful browser features the app never uses.
  res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=(), payment=()");
  res.setHeader("Content-Security-Policy", CSP);
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");

  // HSTS only over HTTPS (behind the Cloudflare tunnel). Never send it on plain
  // localhost HTTP, where it would wrongly pin the dev box to https.
  if (req.secure || req.headers["x-forwarded-proto"] === "https") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
}

module.exports = { securityHeaders, CSP };
