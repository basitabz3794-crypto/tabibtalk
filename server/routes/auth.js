const express = require('express');
const { nanoid } = require('nanoid');
const store = require('../data/store');
const firebase = require('../data/firebase');
const { computeExpiry, isExpired, accessTierForPlan } = require('../data/plans');

const router = express.Router();
const MAX_DEVICES = 2;

// Build the safe public view of a user (never leaks the password hash).
function publicUser(user) {
  return {
    id: user.id, email: user.email, name: user.name || '',
    phone: user.phone || '', college: user.college || '',
    nationality: user.nationality || '', grade: user.grade || '',
    tier: user.tier, planId: user.planId || null,
    planActivatedAt: user.planActivatedAt || null, planExpiresAt: user.planExpiresAt || null,
    status: user.status || 'active', // active | suspended | banned
    createdAt: user.createdAt,
  };
}

// Re-evaluate a user's effective state: expire subscriptions whose time is up.
async function reconcileUser(user) {
  if (!user) return user;
  // Lifetime and explorer never expire. Paid tiers expire to 'explorer'.
  if (user.planExpiresAt && isExpired(user.planExpiresAt) && user.tier !== 'explorer' && user.tier !== 'lifetime') {
    const updated = await store.updateUser(user.id, { tier: 'explorer', subStatus: 'expired' });
    return updated;
  }
  return user;
}

// Register (or re-touch) the calling device; enforce the max-2-devices rule.
// Returns { ok } or { blocked, reason }.
async function registerDevice(user, req) {
  const deviceId = req.headers['x-device-id'];
  if (!deviceId) return { ok: true }; // no fingerprint sent (e.g. API client) — don't block
  const existing = await store.findDevice(user.id, deviceId);
  const now = new Date().toISOString();
  if (existing) {
    await store.updateDevice(user.id, deviceId, { lastSeen: now, count: (existing.count || 1) + 1 });
    return { ok: true };
  }
  const devices = await store.listDevicesForUser(user.id);
  const activeDevices = devices.filter(d => !d.blocked);
  if (activeDevices.length >= MAX_DEVICES) {
    // Record the over-limit attempt as a flagged device for the admin to see.
    await store.createDevice({
      id: nanoid(), userId: user.id, deviceId, firstSeen: now, lastSeen: now, count: 1,
      userAgent: req.headers['user-agent'] || '', blocked: true, flagged: true,
      flagReason: 'Exceeded 2-device limit',
    });
    return { blocked: true, reason: `This account is already active on ${MAX_DEVICES} devices. Using more devices isn't allowed and has been flagged.` };
  }
  await store.createDevice({
    id: nanoid(), userId: user.id, deviceId, firstSeen: now, lastSeen: now, count: 1,
    userAgent: req.headers['user-agent'] || '', blocked: false, flagged: false,
  });
  return { ok: true };
}

// ---- Firebase session exchange (replaces the old bcrypt signup/login) ----
//
// Firebase Auth owns identity now: the browser signs up / logs in against
// Firebase (which sends the verification and password-reset emails for us),
// then posts the resulting ID token here. We verify it and establish the same
// express-session this app already used, so every other route — plans,
// payments, devices, admin — keeps working unchanged.
//
// `profile` is only used the first time we see an account (i.e. at signup),
// where it carries the extra fields Firebase doesn't store for us.
router.post('/firebase-session', async (req, res) => {
  if (!firebase.isEnabled()) {
    console.error('[auth] Firebase not configured:', firebase.whyDisabled());
    return res.status(503).json({ error: 'Sign-in is temporarily unavailable. Please try again shortly.' });
  }

  const { idToken, profile } = req.body || {};
  if (!idToken) return res.status(400).json({ error: 'Missing sign-in token. Please try again.' });

  let decoded;
  try {
    decoded = await firebase.verifyIdToken(idToken);
  } catch (err) {
    return res.status(401).json({ error: 'Your sign-in session is invalid or has expired. Please log in again.' });
  }

  const email = (decoded.email || '').trim();
  if (!email) return res.status(400).json({ error: 'This account has no email address.' });

  // Link by firebaseUid first, then by email so accounts created before the
  // Firebase migration attach to their existing record (and keep their plan).
  let user = (await store.findUserByFirebaseUid(decoded.uid)) || (await store.findUserByEmail(email));

  if (!user) {
    // A Firebase account with no record here means a signup that never
    // finished (the profile POST failed). Logging in can't fix that on its
    // own, so say what will, rather than asking for a name on a login form.
    if (!profile) {
      return res.status(409).json({
        error: 'We couldn\'t find your account details. Please use the "Create account" tab with this email and password to finish setting up your account.',
        needsProfile: true,
      });
    }

    // First time we've seen this account — signup. Require the profile fields.
    const p = profile;
    const required = { name: 'your name', phone: 'your phone number', college: 'your college name', nationality: 'your nationality', grade: 'your year/grade in college' };
    for (const [field, label] of Object.entries(required)) {
      if (!p[field] || !String(p[field]).trim()) return res.status(400).json({ error: `Please enter ${label}.` });
    }
    user = await store.createUser({
      id: nanoid(),
      firebaseUid: decoded.uid,
      email,
      name: String(p.name).trim(),
      phone: String(p.phone).trim(),
      college: String(p.college).trim(),
      nationality: String(p.nationality).trim(),
      grade: String(p.grade).trim(),
      tier: 'explorer', // signing up grants the free Explorer tier (prerequisite for buying any plan)
      planId: null, planActivatedAt: null, planExpiresAt: null,
      status: 'active',
      createdAt: new Date().toISOString(),
    });
  } else if (user.firebaseUid !== decoded.uid) {
    // Existing pre-Firebase account signing in through Firebase for the first
    // time: link the records and drop the now-unused bcrypt hash.
    user = await store.updateUser(user.id, { firebaseUid: decoded.uid, passwordHash: undefined, email });
  }

  // Gate on email verification. Done AFTER the record exists so a user who
  // closes the tab mid-signup doesn't lose the details they typed.
  if (!decoded.email_verified) {
    return res.status(403).json({ error: 'Please verify your email first. Check your inbox for the verification link.', needsVerification: true });
  }

  if (user.status === 'banned') return res.status(403).json({ error: 'This account has been banned. Please contact support.' });

  // Enforce device limit before establishing the session.
  const dev = await registerDevice(user, req);
  if (dev.blocked) return res.status(403).json({ error: dev.reason });

  user = await reconcileUser(user);
  req.session.userId = user.id;
  res.json(publicUser(user));
});

// ---- Log out ----
// Also revokes the user's Firebase refresh tokens, so signing out here can't
// leave a usable Firebase session behind in the browser (app.html logs out
// without loading the Firebase SDK, so this has to happen server-side).
router.post('/logout', async (req, res) => {
  const user = req.session.userId ? await store.findUserById(req.session.userId) : null;
  if (user && user.firebaseUid && firebase.isEnabled()) {
    try { await firebase.revokeTokens(user.firebaseUid); }
    catch (err) { console.error('[auth] token revoke failed:', err.message); }
  }
  req.session.destroy(() => res.json({ ok: true }));
});

// ---- Current user ----
router.get('/me', async (req, res) => {
  if (!req.session.userId) return res.json({ user: null });
  let user = await store.findUserById(req.session.userId);
  if (!user) return res.json({ user: null });
  if (user.status === 'banned') { req.session.destroy(() => {}); return res.json({ user: null, banned: true }); }
  user = await reconcileUser(user);
  res.json({ user: publicUser(user) });
});

// ---- Password reset ----
// Deliberately not implemented here any more. Firebase Auth owns passwords now
// and sends the reset email itself (see sendPasswordResetEmail in
// /js/firebase-auth.js), so there's no admin step and no second password
// system to keep in sync. The admin panel's reset-request list stays in place
// for historical requests, but nothing new is written to it.

module.exports = { router, publicUser, reconcileUser, registerDevice, MAX_DEVICES };
