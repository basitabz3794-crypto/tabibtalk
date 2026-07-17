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
  // Lifetime, explorer and (free) basic never expire. Paid tiers expire to
  // their mode's free tier: Advanced falls back to Basic, the classic paid
  // tiers fall back to Explorer.
  if (user.planExpiresAt && isExpired(user.planExpiresAt)
      && user.tier !== 'explorer' && user.tier !== 'lifetime' && user.tier !== 'basic') {
    const fallbackTier = user.tier === 'advanced' ? 'basic' : 'explorer';
    const updated = await store.updateUser(user.id, { tier: fallbackTier, subStatus: 'expired' });
    return updated;
  }
  return user;
}

// Batch version — used by the admin overview so the numbers always reflect the
// current state, without waiting for each user to log in and trigger their own
// reconcile. Idempotent: users already on the correct tier are untouched.
async function reconcileAllUsers(users) {
  if (!users || !users.length) return users || [];
  const out = [];
  for (const u of users) out.push(await reconcileUser(u));
  return out;
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
  // Admin can raise an individual account's limit ("permit a third device or
  // more") — user.maxDevices overrides the global default when set.
  const limit = Number(user.maxDevices) > 0 ? Number(user.maxDevices) : MAX_DEVICES;
  if (activeDevices.length >= limit) {
    // Record the over-limit attempt as a flagged device for the admin to see.
    await store.createDevice({
      id: nanoid(), userId: user.id, deviceId, firstSeen: now, lastSeen: now, count: 1,
      userAgent: req.headers['user-agent'] || '', blocked: true, flagged: true,
      flagReason: `Exceeded ${limit}-device limit`,
    });
    return { blocked: true, limit, reason: `This account is already active on ${limit} devices. Using more devices isn't allowed and has been flagged.` };
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

  // Enforce device limit before establishing the session. deviceBlocked lets
  // the login page offer the "explain your situation" appeal box instead of a
  // dead end.
  const dev = await registerDevice(user, req);
  if (dev.blocked) return res.status(403).json({ error: dev.reason, deviceBlocked: true });

  user = await reconcileUser(user);
  req.session.userId = user.id;
  res.json(publicUser(user));
});

// ---- Device-limit appeal ----
// Filed from the login page when the max-devices rule blocks a sign-in. There
// is no session at that point (login failed), so ownership is proven with the
// Firebase ID token from the password check that just succeeded — nobody can
// file appeals against an account they can't sign in to. One pending appeal
// per account; the admin resolves it in Devices & Violations.
router.post('/device-appeal', async (req, res) => {
  if (!firebase.isEnabled()) {
    return res.status(503).json({ error: 'Appeals are temporarily unavailable. Please email us instead.' });
  }
  const { idToken, message } = req.body || {};
  const text = String(message || '').trim();
  if (!idToken) return res.status(400).json({ error: 'Please log in again before sending your appeal.' });
  if (!text) return res.status(400).json({ error: 'Please describe your situation so we can verify it.' });

  let decoded;
  try { decoded = await firebase.verifyIdToken(idToken); }
  catch (err) { return res.status(401).json({ error: 'Your sign-in expired — please enter your password again, then resend the appeal.' }); }

  const user = (await store.findUserByFirebaseUid(decoded.uid)) || (await store.findUserByEmail(decoded.email || ''));
  if (!user) return res.status(404).json({ error: 'We couldn\'t find your account.' });

  const existing = (await store.listDeviceAppeals('pending')).find(a => a.userId === user.id);
  if (existing) {
    return res.json({ ok: true, message: 'You already have an appeal waiting for review — we\'ll get back to you soon.' });
  }

  await store.createDeviceAppeal({
    id: nanoid(),
    userId: user.id,
    email: user.email,
    name: user.name || '',
    deviceId: req.headers['x-device-id'] || '',
    userAgent: req.headers['user-agent'] || '',
    message: text.slice(0, 1000),
    status: 'pending', // pending -> resolved | dismissed
    submittedAt: new Date().toISOString(),
  });

  res.json({ ok: true, message: 'Thanks — your appeal has been sent. We\'ll review it and unblock the device or raise your limit if everything checks out.' });
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

module.exports = { router, publicUser, reconcileUser, reconcileAllUsers, registerDevice, MAX_DEVICES };
