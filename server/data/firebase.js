// Firebase Admin SDK wiring.
//
// Two jobs:
//   1. Verify the ID tokens the browser gets from Firebase Auth, so the rest of
//      the server can keep using its own session/user records unchanged.
//   2. Read/write per-user progress in the Realtime Database.
//
// Progress is written from HERE rather than from the browser on purpose:
//   - app.html hydrates progress synchronously before first paint; a browser-side
//     Firebase read is async and would make the streak flash a default value.
//   - Going through the server means a user can't forge their own streak/scores,
//     so the RTDB rules can deny client access entirely (the Admin SDK bypasses
//     rules, since it authenticates as a service account).
//
// If FIREBASE_SERVICE_ACCOUNT_JSON is not set, this module stays disabled and
// the caller falls back to the local JSON store — so the app still boots for
// local development without Firebase credentials.

// firebase-admin v13+ dropped the old `admin.credential.cert` / `admin.auth()`
// namespace in favour of these modular entry points.
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getDatabase } = require('firebase-admin/database');

let app = null;
let initError = null;

function init() {
  if (app || initError) return app;

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw || !raw.trim()) {
    initError = new Error('FIREBASE_SERVICE_ACCOUNT_JSON is not set');
    return null;
  }

  try {
    const serviceAccount = JSON.parse(raw);
    app = getApps().length ? getApps()[0] : initializeApp({
      credential: cert(serviceAccount),
      databaseURL: process.env.FIREBASE_DATABASE_URL,
    });
    return app;
  } catch (err) {
    // A bad/missing key shouldn't crash the whole server — auth routes will
    // report it clearly instead, and everything non-Firebase keeps working.
    initError = err;
    console.error('[firebase] Admin SDK failed to initialise:', err.message);
    return null;
  }
}

function isEnabled() {
  return init() !== null;
}

function whyDisabled() {
  init();
  return initError ? initError.message : null;
}

// ---- Auth ----

// Verify a Firebase ID token from the browser. Returns the decoded token
// ({ uid, email, email_verified, ... }) or throws.
async function verifyIdToken(idToken) {
  if (!isEnabled()) throw new Error('Firebase is not configured on this server.');
  return getAuth(init()).verifyIdToken(idToken, true /* checkRevoked */);
}

// Invalidate every refresh token this user holds. Combined with the
// checkRevoked flag in verifyIdToken, this makes logout effective everywhere.
async function revokeTokens(uid) {
  if (!isEnabled()) return;
  return getAuth(init()).revokeRefreshTokens(uid);
}

// Look up a Firebase Auth user by email (used to link pre-Firebase accounts).
async function getAuthUserByEmail(email) {
  if (!isEnabled()) throw new Error('Firebase is not configured on this server.');
  try {
    return await getAuth(init()).getUserByEmail(email);
  } catch (err) {
    if (err.code === 'auth/user-not-found') return null;
    throw err;
  }
}

// The Realtime Database handle. store.js builds the rest of the app's
// collections on top of this.
function database() {
  if (!isEnabled()) throw new Error('Firebase is not configured on this server.');
  return getDatabase(init());
}

// ---- Per-user progress (Realtime Database) ----
// Stored at progress/{userId} as a flat map of the app's own 'tt_' keys, which
// is exactly the shape the local JSON store used — so route code is unchanged.

function progressRef(userId) {
  return getDatabase(init()).ref(`progress/${userId}`);
}

async function getProgress(userId) {
  if (!isEnabled()) throw new Error('Firebase is not configured on this server.');
  const snapshot = await progressRef(userId).once('value');
  return snapshot.val() || {};
}

async function mergeProgress(userId, patch) {
  if (!isEnabled()) throw new Error('Firebase is not configured on this server.');
  if (!patch || !Object.keys(patch).length) return {};
  // update() merges the given keys and leaves the rest of the node alone.
  await progressRef(userId).update(patch);
  return patch;
}

module.exports = {
  isEnabled, whyDisabled, database,
  verifyIdToken, getAuthUserByEmail, revokeTokens,
  getProgress, mergeProgress,
};
