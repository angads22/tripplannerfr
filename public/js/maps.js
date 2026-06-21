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

  // A precise embed when we have coordinates, else fall back to a text query.
  function embedLatLng(lat, lon) {
    return lat == null || lon == null ? "" : "https://www.google.com/maps?q=" + lat + "," + lon + "&output=embed";
  }

  // --- Keyless travel-time estimation --------------------------------------
  // Google's Directions API needs a key, so to stay keyless we geocode each
  // place with OpenStreetMap (Nominatim) and estimate the time from straight-
  // line distance and a per-mode average speed. These are estimates, not
  // turn-by-turn routing — good enough to schedule a friends trip.

  const SPEED = { walk: 4.8, bike: 15, drive: 35, transit: 22, bus: 18, train: 50, ferry: 25 }; // km/h
  const OVERHEAD = { walk: 0, bike: 1, drive: 3, transit: 6, bus: 6, train: 8, ferry: 10 };     // minutes
  const ROADFACTOR = { walk: 1.25, bike: 1.3, drive: 1.35, transit: 1.3, bus: 1.35, train: 1.15, ferry: 1.05 };

  const _geo = {}; // session cache: query -> {lat,lon}

  async function geocode(query) {
    const q = String(query == null ? "" : query).trim();
    if (!q) return null;
    if (_geo[q]) return _geo[q];
    const url = "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&accept-language=en&q=" + enc(q);
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error("Geocoding failed (" + res.status + ")");
    const arr = await res.json();
    if (!Array.isArray(arr) || !arr.length) return null;
    const out = { lat: parseFloat(arr[0].lat), lon: parseFloat(arr[0].lon) };
    if (!isFinite(out.lat) || !isFinite(out.lon)) return null;
    _geo[q] = out;
    return out;
  }

  // Accepts a {lat,lon}, a {query}, or a bare string.
  async function resolve(place) {
    if (place && place.lat != null && place.lon != null) return { lat: place.lat, lon: place.lon };
    const q = place && typeof place === "object" ? place.query : place;
    return geocode(q);
  }

  function haversineKm(a, b) {
    const R = 6371, rad = (d) => (d * Math.PI) / 180;
    const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  }

  function estimateMinutes(km, mode) {
    const m = SPEED[mode] ? mode : "drive";
    const dist = km * (ROADFACTOR[m] || 1.3);
    return Math.max(1, Math.round((dist / SPEED[m]) * 60) + (OVERHEAD[m] || 0));
  }

  // Geocode both ends (using cached coords when given) and estimate the leg.
  async function travelEstimate(from, to, mode) {
    const a = await resolve(from);
    const b = await resolve(to);
    if (!a || !b) return null;
    const km = haversineKm(a, b);
    return { durationMin: estimateMinutes(km, mode), distanceKm: km, a, b };
  }

  // --- Time helpers --------------------------------------------------------
  // "HH:MM" + minutes -> "HH:MM" (wraps past midnight).
  function addMinutes(hhmm, min) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm == null ? "" : hhmm).trim());
    if (!m) return "";
    let total = (+m[1] * 60 + +m[2] + (Math.round(min) || 0)) % 1440;
    if (total < 0) total += 1440;
    return String(Math.floor(total / 60)).padStart(2, "0") + ":" + String(total % 60).padStart(2, "0");
  }

  function fmtDur(min) {
    min = Math.round(min || 0);
    if (min <= 0) return "";
    if (min < 60) return min + " min";
    const h = Math.floor(min / 60), m = min % 60;
    return m ? `${h}h ${m}m` : `${h}h`;
  }

  // "HH:MM" (24h) -> "H:MM AM/PM"; passes other strings through unchanged.
  function fmtTime(t) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(t == null ? "" : t).trim());
    if (!m) return String(t == null ? "" : t);
    let h = +m[1];
    const ap = h >= 12 ? "PM" : "AM";
    h = h % 12 || 12;
    return `${h}:${m[2]} ${ap}`;
  }

  return {
    searchUrl, embedUrl, dirUrl, stopQuery, embedLatLng,
    geocode, travelEstimate, estimateMinutes, haversineKm,
    addMinutes, fmtDur, fmtTime,
  };
})();
