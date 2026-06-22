"use strict";

// A lightweight friend system: send a request, the other person accepts, and
// you become friends. Friends make it quick to add familiar people to trips.
// Stored right on the user record (no extra tables — this app is file-backed):
//   user.friends      : [userId]  accepted friends
//   user.friendReqIn  : [userId]  requests waiting for ME to accept
//   user.friendReqOut : [userId]  requests I've sent, waiting on them

const express = require("express");
const db = require("../lib/db");
const { requireAuth } = require("../lib/auth-middleware");

const router = express.Router();
router.use(requireAuth);

const arr = (x) => (Array.isArray(x) ? x : []);
const uniq = (a) => [...new Set(a)];
function pub(u) {
  return u ? { id: u.id, username: u.username, displayName: u.displayName, avatarEmoji: u.avatarEmoji || "", avatarColor: u.avatarColor || "", avatarImage: u.avatarImage || "" } : null;
}
const resolve = (ids) => arr(ids).map((id) => db.findUserById(id)).filter(Boolean).map(pub);

// Search everyone by username or display name (for finding people to add).
// Returns each match with your current relationship status so the UI shows the
// right button.
router.get("/search", (req, res) => {
  const me = db.findUserById(req.user.id);
  const q = String(req.query.q || "").trim().toLowerCase();
  if (!q) return res.json({ results: [] });
  const fr = new Set(arr(me.friends));
  const inc = new Set(arr(me.friendReqIn));
  const out = new Set(arr(me.friendReqOut));
  const results = db
    .getUsers()
    .filter((u) => u.id !== me.id && (String(u.username).toLowerCase().includes(q) || String(u.displayName || "").toLowerCase().includes(q)))
    .slice(0, 25)
    .map((u) => ({ ...pub(u), status: fr.has(u.id) ? "friend" : inc.has(u.id) ? "incoming" : out.has(u.id) ? "outgoing" : "none" }));
  res.json({ results });
});

// My friends + pending requests (in and out).
router.get("/", (req, res) => {
  const me = db.findUserById(req.user.id);
  res.json({
    friends: resolve(me.friends),
    incoming: resolve(me.friendReqIn),
    outgoing: resolve(me.friendReqOut),
  });
});

// Make two people friends and clear any pending requests between them.
function makeFriends(aId, bId) {
  const a = db.findUserById(aId);
  const b = db.findUserById(bId);
  db.updateUser(aId, {
    friends: uniq([...arr(a.friends), bId]),
    friendReqIn: arr(a.friendReqIn).filter((x) => x !== bId),
    friendReqOut: arr(a.friendReqOut).filter((x) => x !== bId),
  });
  db.updateUser(bId, {
    friends: uniq([...arr(b.friends), aId]),
    friendReqIn: arr(b.friendReqIn).filter((x) => x !== aId),
    friendReqOut: arr(b.friendReqOut).filter((x) => x !== aId),
  });
}

// Send a friend request by username or userId. If they already requested me,
// we just become friends (mutual).
router.post("/request", (req, res) => {
  const me = db.findUserById(req.user.id);
  const body = req.body || {};
  const target = body.userId ? db.findUserById(body.userId) : db.findUserByUsername(body.username);
  if (!target) return res.status(404).json({ error: "No account with that username." });
  if (target.id === me.id) return res.status(400).json({ error: "You can't add yourself." });
  if (arr(me.friends).includes(target.id)) return res.status(409).json({ error: `You're already friends with ${target.displayName}.` });

  if (arr(me.friendReqIn).includes(target.id)) {
    makeFriends(me.id, target.id);
    return res.json({ ok: true, status: "friends" });
  }
  if (arr(me.friendReqOut).includes(target.id)) return res.status(409).json({ error: "You've already sent them a request." });

  db.updateUser(me.id, { friendReqOut: uniq([...arr(me.friendReqOut), target.id]) });
  db.updateUser(target.id, { friendReqIn: uniq([...arr(target.friendReqIn), me.id]) });
  res.json({ ok: true, status: "requested" });
});

// Accept an incoming request.
router.post("/accept", (req, res) => {
  const me = db.findUserById(req.user.id);
  const id = (req.body || {}).userId;
  if (!id || !arr(me.friendReqIn).includes(id) || !db.findUserById(id)) {
    return res.status(404).json({ error: "No pending request from that person." });
  }
  makeFriends(me.id, id);
  res.json({ ok: true, status: "friends" });
});

// Decline an incoming request, or cancel one I sent.
router.post("/decline", (req, res) => {
  const me = db.findUserById(req.user.id);
  const id = (req.body || {}).userId;
  db.updateUser(me.id, {
    friendReqIn: arr(me.friendReqIn).filter((x) => x !== id),
    friendReqOut: arr(me.friendReqOut).filter((x) => x !== id),
  });
  const target = db.findUserById(id);
  if (target) {
    db.updateUser(target.id, {
      friendReqIn: arr(target.friendReqIn).filter((x) => x !== me.id),
      friendReqOut: arr(target.friendReqOut).filter((x) => x !== me.id),
    });
  }
  res.json({ ok: true });
});

// Unfriend.
router.delete("/:userId", (req, res) => {
  const me = db.findUserById(req.user.id);
  const id = req.params.userId;
  db.updateUser(me.id, { friends: arr(me.friends).filter((x) => x !== id) });
  const target = db.findUserById(id);
  if (target) db.updateUser(target.id, { friends: arr(target.friends).filter((x) => x !== me.id) });
  res.json({ ok: true });
});

module.exports = router;
