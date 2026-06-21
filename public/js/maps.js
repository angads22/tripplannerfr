"use strict";

// Keyless Google Maps links — no API key, no billing. Shared by the trip
// viewer and the builder (loaded before each). A place query is just the
// stop's location text (or its name as a fallback).

const Maps = (function () {
  const enc = (s) => encodeURIComponent(String(s == null ? "" : s).trim());

  // A clickable "open in Google Maps" search link.
  function searchUrl(query) {
    const q = enc(query);
    return q ? "https://www.google.com/maps/search/?api=1&query=" + q : "";
  }

  // A lazy, keyless embeddable map iframe src for a place.
  function embedUrl(query) {
    const q = enc(query);
    return q ? "https://www.google.com/maps?q=" + q + "&output=embed" : "";
  }

  // Driving/transit directions from one place to another.
  function dirUrl(from, to) {
    const o = enc(from);
    const d = enc(to);
    if (!d) return "";
    return "https://www.google.com/maps/dir/?api=1" + (o ? "&origin=" + o : "") + "&destination=" + d;
  }

  // The best query string for a stop.
  function stopQuery(stop) {
    return (stop && (stop.location || stop.name)) || "";
  }

  return { searchUrl, embedUrl, dirUrl, stopQuery };
})();
