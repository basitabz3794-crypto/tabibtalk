const express = require('express');

const firebase = require('../data/firebase');

const router = express.Router();

function requireLogin(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Please log in first.' });
  next();
}

// Only accept the app's own 'tt_' prefixed keys, and never the ones that must
// stay device/browser-specific — keeps this endpoint from being used to store
// arbitrary data or to clobber tier/device state from the client.
const EXCLUDE = new Set(['tt_tier', 'tt_device_id']);

function cleanPatch(patch) {
  const clean = {};
  for (const [k, v] of Object.entries(patch)) {
    if (typeof k === 'string' && k.indexOf('tt_') === 0 && !EXCLUDE.has(k) && typeof v === 'string') {
      clean[k] = v;
    }
  }
  return clean;
}

// Progress lives in Firebase. There's no local fallback any more: the whole
// database moved there when the app went to Vercel, whose filesystem is
// read-only, so there is nowhere local left to fall back to.
async function readProgress(userId) {
  return firebase.getProgress(userId);
}

async function writeProgress(userId, patch) {
  return firebase.mergeProgress(userId, patch);
}

// ---- Get the signed-in user's saved app state (streak, progress, bookmarks, etc.) ----
router.get('/me', requireLogin, async (req, res) => {
  // userId is returned so the browser can tell WHOSE progress this is and wipe
  // a previous account's leftover localStorage before hydrating — otherwise a
  // second account opened in the same browser inherits (and then re-uploads)
  // the first account's streak/scores/etc.
  try {
    res.json({ state: await readProgress(req.session.userId), userId: req.session.userId });
  } catch (err) {
    // Never hard-fail the app over a progress read — the page still hydrates
    // from localStorage and will sync again on the next write.
    console.error('[progress] read failed:', err.message);
    res.json({ state: {}, userId: req.session.userId });
  }
});

// ---- Save/merge a batch of app-state keys for the signed-in user ----
router.post('/save', requireLogin, async (req, res) => {
  const { patch } = req.body || {};
  if (!patch || typeof patch !== 'object') return res.status(400).json({ error: 'A patch object is required.' });

  try {
    await writeProgress(req.session.userId, cleanPatch(patch));
    res.json({ ok: true });
  } catch (err) {
    console.error('[progress] save failed:', err.message);
    res.status(500).json({ error: 'Could not save your progress right now.' });
  }
});

module.exports = router;
