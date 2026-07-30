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
// tt_dialect is here because it is not progress at all — it is which course the
// student is in, and the account records that authoritatively in user.dialect
// (see /api/auth/dialect). Storing a second copy in the progress blob meant a
// stale copy could be hydrated back over the dialect the student had just
// picked, resetting them to Egyptian and making every dialect appear to share
// its streak, bookmarks and resume point.
const EXCLUDE = new Set(['tt_tier', 'tt_device_id', 'tt_dialect']);

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
  //
  // `dialect` is returned because this is the FIRST call the app makes, and it
  // is synchronous — so it is the only chance to know which dialect this
  // account learns in BEFORE any progress is read or written.
  //
  // tt_dialect is deliberately not synced as progress (it is not progress), so
  // a device that has never been used for this account knows nothing about it.
  // Without this, such a device — a new phone, a cleared iPad — ran as Egyptian
  // for the first moments of every visit, and computeStreak()/addTime() fire on
  // load, so it wrote a Khaleeji student's activity into EGYPTIAN's keys before
  // anything could correct it. That is how progress leaked between dialects on
  // phones and tablets while desktops looked fine.
  const store = require('../data/store');
  let dialect = null;
  try {
    const user = await store.findUserById(req.session.userId);
    if (user) dialect = user.dialect || 'eg';
  } catch (e) { /* fall through — the app still works, just without the hint */ }

  try {
    res.json({ state: await readProgress(req.session.userId), userId: req.session.userId, dialect });
  } catch (err) {
    // Never hard-fail the app over a progress read — the page still hydrates
    // from localStorage and will sync again on the next write.
    console.error('[progress] read failed:', err.message);
    res.json({ state: {}, userId: req.session.userId, dialect });
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
