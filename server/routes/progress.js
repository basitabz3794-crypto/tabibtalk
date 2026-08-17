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

// ---- Progress that only ever accumulates ----
//
// Most keys here are last-write-wins, which is right for things that genuinely
// change: a streak resets when it breaks, a bookmark can be removed, a resume
// point moves. But three of them only ever grow, and for those last-write-wins
// is a way to lose work:
//
//   tt_path   which lesson sections have been passed
//   tt_days   which days were studied
//   tt_time   how long was spent on each day
//
// Nothing in the app un-completes a lesson or un-studies a day. So a save that
// arrives holding LESS than what is stored is not new information — it is a
// browser that started from an incomplete picture, and taking it at face value
// deletes real work. This happened: a student on an iPhone whose progress read
// failed began a session blank, finished one lesson, and the save replaced a
// full record with that single lesson.
//
// Merging these on the server makes that impossible rather than unlikely, and
// also settles the two-device case, where whoever saves last would otherwise
// erase the other. Anything that does not parse into the expected shape falls
// straight through to the incoming value, so this can never make things worse
// than the plain write it replaces.
const MONOTONIC = { tt_path: 'passed', tt_days: 'days', tt_time: 'time' };

// Keys carry a __hejazi / __khaleeji suffix for the other dialects.
function baseKey(k) { return String(k).split('__')[0]; }

function mergeMonotonic(kind, storedRaw, incomingRaw) {
  let stored, incoming;
  try { stored = JSON.parse(storedRaw); incoming = JSON.parse(incomingRaw); }
  catch (e) { return incomingRaw; }
  if (stored === null || stored === undefined) return incomingRaw;

  try {
    if (kind === 'days') {
      // A list of 'YYYY-MM-DD'. Union, so a day studied is never un-studied.
      if (!Array.isArray(stored) || !Array.isArray(incoming)) return incomingRaw;
      const all = stored.concat(incoming).map(String);
      return JSON.stringify([...new Set(all)].sort());
    }

    if (kind === 'time') {
      // { 'YYYY-MM-DD': seconds }. The larger count for a day is the true one —
      // a browser that missed part of a session must not shorten it.
      if (typeof stored !== 'object' || typeof incoming !== 'object') return incomingRaw;
      const out = Object.assign({}, stored);
      for (const [day, secs] of Object.entries(incoming)) {
        const a = Number(out[day]) || 0, b = Number(secs) || 0;
        out[day] = Math.max(a, b);
      }
      return JSON.stringify(out);
    }

    // 'passed': { courseKey: { passed: [ids] } }. Union per course, so a
    // section once completed stays completed.
    if (typeof stored !== 'object' || typeof incoming !== 'object') return incomingRaw;
    const out = {};
    for (const key of new Set(Object.keys(stored).concat(Object.keys(incoming)))) {
      const a = (stored[key] && Array.isArray(stored[key].passed)) ? stored[key].passed : [];
      const b = (incoming[key] && Array.isArray(incoming[key].passed)) ? incoming[key].passed : [];
      const merged = [...new Set(a.concat(b).map(String))];
      // Anything else the record carries is kept from whichever side has it,
      // with the incoming side winning, so this stays a merge and not a filter.
      out[key] = Object.assign({}, stored[key] || {}, incoming[key] || {}, { passed: merged });
    }
    return JSON.stringify(out);
  } catch (e) {
    return incomingRaw;
  }
}

// Progress lives in Firebase. There's no local fallback any more: the whole
// database moved there when the app went to Vercel, whose filesystem is
// read-only, so there is nowhere local left to fall back to.
async function readProgress(userId) {
  return firebase.getProgress(userId);
}

async function writeProgress(userId, patch) {
  // Only read back when the patch actually touches a key that needs merging —
  // most saves do not, and those stay a single write.
  const needsMerge = Object.keys(patch).filter(k => MONOTONIC[baseKey(k)]);
  if (needsMerge.length) {
    const current = await firebase.getProgress(userId);
    for (const k of needsMerge) {
      if (typeof current[k] === 'string') {
        patch[k] = mergeMonotonic(MONOTONIC[baseKey(k)], current[k], patch[k]);
      }
    }
  }
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
