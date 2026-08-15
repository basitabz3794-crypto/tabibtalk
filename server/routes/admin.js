const express = require('express');
const { nanoid } = require('nanoid');
const store = require('../data/store');
const firebase = require('../data/firebase');
const { requireAdmin } = require('./manual-payments');
const { reconcileAllUsers } = require('./auth');
const { isExpired, PLANS, accessTierForPlan, computeExpiry, baselineTier, DIALECTS, normaliseDialect, configForDialect } = require('../data/plans');
const entitlements = require('../data/entitlements');
const rewards = require('../data/rewards');

const router = express.Router();

// Who is doing this. There is no admin login — the hub is held behind a shared
// key — so the best available answer is the name the hub sends and the address
// it came from. Recorded rather than left blank, so the trail still says
// something about origin while there is only one administrator.
function actor(req) {
  return {
    adminId: String(req.headers['x-admin-name'] || 'admin'),
    ip: String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim() || null,
  };
}

// Every administrative change to somebody's access leaves a row here: who did
// it, to whom, what changed, and why. Written after the change succeeds, so the
// trail never claims something that did not happen. Never allowed to fail the
// action itself — a missing audit row is bad, but refusing a legitimate change
// because the log write failed is worse.
async function audit(req, fields) {
  try {
    const who = actor(req);
    await store.addAdminAudit(Object.assign({
      id: nanoid(),
      createdAt: new Date().toISOString(),
      adminId: who.adminId,
      ip: who.ip,
      userId: null, action: null, dialect: null, days: null,
      planId: null, reason: null, previousExpiry: null, newExpiry: null,
    }, fields));
  } catch (e) {
    console.error('[admin] audit write failed:', e.message);
  }
}

// ---- Existing: all pending proofs across every method ----
router.get('/pending', requireAdmin, async (req, res) => {
  res.json({ proofs: await store.listPendingManualProofs() });
});

// ---- Analytics overview: the numbers the admin hub shows at the top ----
// Every hit refreshes the picture: expired paid tiers are downgraded to
// explorer in-place before the counts are computed, so the "active
// subscriptions" tile never lags behind the real state.
router.get('/overview', requireAdmin, async (req, res) => {
  // Each collection is fetched once and joined in memory. Looking users up one
  // at a time inside the loop below would be a separate network round-trip per
  // proof now that the store is remote.
  const [rawUsers, proofs, recommendations, pendingResets, devices, pendingAppeals] = await Promise.all([
    store.listAllUsers(),
    store.listAllManualProofs(),
    store.listRecommendations(),
    store.listResetRequests('pending'),
    store.listAllDevices(),
    store.listDeviceAppeals('pending'),
  ]);
  // Downgrade expired paid tiers first, so the analytics are always fresh.
  const users = await reconcileAllUsers(rawUsers);
  const usersById = new Map(users.map(u => [u.id, u]));

  const pending  = proofs.filter(p => p.status === 'pending');
  const approved = proofs.filter(p => p.status === 'approved');
  const rejected = proofs.filter(p => p.status === 'rejected');
  const verifiedTotal = approved.length + rejected.length; // "how many transactions did the admin actually review"

  // A subscription is "active" if approved AND not expired AND the user is still
  // on that same plan (so an old proof from a plan they've since replaced isn't
  // counted).
  const activeSubs = [];
  const expiredSubs = [];
  approved.forEach(p => {
    const user = usersById.get(p.userId);
    if (!user) return;
    const isCurrent = user.planId === p.planId;
    if (!isCurrent) return;
    if (user.planExpiresAt && isExpired(user.planExpiresAt)) expiredSubs.push({ proof: p, user });
    else if (user.status === 'banned') expiredSubs.push({ proof: p, user }); // treat a banned account as inactive
    else activeSubs.push({ proof: p, user });
  });

  // Users signed up + tiers
  const tierCounts = {};
  users.forEach(u => { tierCounts[u.tier] = (tierCounts[u.tier] || 0) + 1; });

  // Active subs broken down by tier + specific plan id (with human duration
  // labels), so the admin sees "Professional: 12 (monthly 8 / 6-month 3 /
  // yearly 1)" rather than a bare "12".
  const PLAN_DURATION_HUMAN = {
    'student-monthly': 'Monthly', 'student-6m': '6-month', 'student-12m': '12-month',
    'professional-monthly': 'Monthly', 'professional-6m': '6-month', 'professional-yearly': 'Yearly',
    'lifetime': 'Lifetime',
    'basic-monthly': 'Monthly', 'advanced-monthly': 'Monthly',
  };
  const activeByTier = { student: 0, professional: 0, lifetime: 0, basic: 0, advanced: 0 };
  const activeByPlan = {}; // planId -> count
  activeSubs.forEach(({ user }) => {
    const t = user.tier;
    if (activeByTier[t] !== undefined) activeByTier[t]++;
    if (user.planId) activeByPlan[user.planId] = (activeByPlan[user.planId] || 0) + 1;
  });

  // Plans expiring in the next 14 days (renewals due soon), and paid accounts
  // whose plan already expired but haven't logged in since — those are
  // downgraded above, but we still want the admin to see them as "needs
  // renewal" so they can nudge the user.
  const SOON_MS = 14 * 24 * 60 * 60 * 1000;
  const nowMs = Date.now();
  const renewalsDue = [];
  users.forEach(u => {
    if (!u.planExpiresAt) return;
    if (u.tier === 'lifetime' || u.tier === 'explorer') return;
    const exp = new Date(u.planExpiresAt).getTime();
    const days = Math.round((exp - nowMs) / 86400000);
    if (days <= 14) {
      renewalsDue.push({
        id: u.id, name: u.name || '', email: u.email, phone: u.phone || '',
        tier: u.tier, planId: u.planId,
        planExpiresAt: u.planExpiresAt, daysUntilExpiry: days,
      });
    }
  });
  // Also flag anyone whose plan just expired (now on explorer with subStatus:'expired')
  // — reconcile just moved them there, so their tier is 'explorer' but they still
  // have a planId hinting at what they were on.
  users.forEach(u => {
    if (u.subStatus === 'expired' && u.planId) {
      if (renewalsDue.find(r => r.id === u.id)) return;
      renewalsDue.push({
        id: u.id, name: u.name || '', email: u.email, phone: u.phone || '',
        tier: u.tier, planId: u.planId,
        planExpiresAt: u.planExpiresAt, daysUntilExpiry: -1,
      });
    }
  });
  renewalsDue.sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry);

  // Who is actually paying, per dialect. Counted on the dialect the payment was
  // MADE for rather than whichever one the student happens to be reading today,
  // because that is the dialect the money belongs to. Signups are counted
  // separately so the admin can see interest and revenue side by side.
  const activeByDialect = {};
  const signupsByDialect = {};
  DIALECTS.forEach(function (d) { activeByDialect[d] = 0; signupsByDialect[d] = 0; });
  users.forEach(function (u) {
    const d = normaliseDialect(u.dialect);
    signupsByDialect[d]++;
  });
  activeSubs.forEach(function (x) {
    const d = normaliseDialect(x.proof.dialect || x.user.dialect);
    activeByDialect[d]++;
  });

  const planCounts = {};
  approved.forEach(p => { planCounts[p.planId] = (planCounts[p.planId] || 0) + 1; });

  res.json({
    totals: {
      users: users.length,
      pending: pending.length,
      approved: approved.length,
      rejected: rejected.length,
      // Payments submitted = every transaction id ever received (pending + reviewed).
      submitted: proofs.length,
      // Payments verified = admin actioned it (approved or rejected).
      verified: verifiedTotal,
      // Live subscription state, reconciled just above.
      active: activeSubs.length,
      expired: expiredSubs.length,
      recommendations: recommendations.length,
      resetRequests: pendingResets.length,
      flaggedDevices: devices.filter(d => d.flagged).length,
      deviceAppeals: pendingAppeals.length,
      renewalsDue: renewalsDue.length,
    },
    tierCounts,
    planCounts,
    activeByTier,
    activeByPlan,
    activeByDialect,
    signupsByDialect,
    planDurationLabels: PLAN_DURATION_HUMAN,
    renewalsDue,
  });
});

// ---- All users, enriched with their subscription state ----
router.get('/users', requireAdmin, async (req, res) => {
  const [allUsers, allDevices] = await Promise.all([store.listAllUsers(), store.listAllDevices()]);
  const users = allUsers.map(u => {
    const expired = u.planExpiresAt && isExpired(u.planExpiresAt);
    return {
      id: u.id, name: u.name || '', email: u.email,
      phone: u.phone || '', college: u.college || '',
      nationality: u.nationality || '', grade: u.grade || '',
      tier: u.tier, planId: u.planId || null,
      planActivatedAt: u.planActivatedAt || null, planExpiresAt: u.planExpiresAt || null,
      status: u.status || 'active',
      dialect: u.dialect || 'eg',
      subState: !u.planId ? 'none' : (expired ? 'suspended' : 'active'),
      deviceCount: allDevices.filter(d => d.userId === u.id && !d.blocked).length,
      maxDevices: Number(u.maxDevices) > 0 ? Number(u.maxDevices) : 3,
      createdAt: u.createdAt,
    };
  });
  res.json({ users });
});

// ---- One user, in depth: current plan with dates + full payment history ----
// Powers the click-through detail modal in the Users tab.
router.get('/users/:id/detail', requireAdmin, async (req, res) => {
  const user = await store.findUserById(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  const [allProofs, devices, allAppeals] = await Promise.all([
    store.listAllManualProofs(),
    store.listDevicesForUser(user.id),
    store.listDeviceAppeals(),
  ]);
  // Pull the live email-verification status from Firebase so the admin can see
  // who is stuck (registered but never verified) and act on it. Non-fatal: if
  // Firebase is unavailable we just report it as unknown rather than 500.
  let emailVerified = null; // null = unknown
  try {
    if (firebase.isEnabled()) {
      const fbUser = user.firebaseUid
        ? await firebase.getAuthUser(user.firebaseUid)
        : await firebase.getAuthUserByEmail(user.email);
      if (fbUser) emailVerified = fbUser.emailVerified === true;
    }
  } catch (err) { console.error('[admin] email-verified lookup failed:', err.message); }
  res.json({
    user: {
      id: user.id, name: user.name || '', email: user.email,
      phone: user.phone || '', college: user.college || '',
      nationality: user.nationality || '', grade: user.grade || '',
      tier: user.tier, planId: user.planId || null,
      planActivatedAt: user.planActivatedAt || null,
      planExpiresAt: user.planExpiresAt || null,
      subStatus: user.subStatus || null,
      status: user.status || 'active',
      dialect: user.dialect || 'eg',
      // What this account holds in EACH dialect, so the admin can see and manage
      // all three rather than only the one the student is currently sitting in.
      dialects: await (async () => {
        const cfg = await store.getSiteConfig();
        const out = {};
        DIALECTS.forEach((d) => {
          const e = entitlements.forDialect(user, d, cfg);
          out[d] = {
            tier: e.tier, planId: e.planId, planExpiresAt: e.planExpiresAt,
            subStatus: e.subStatus,
            // Which pricing page this dialect runs, so the UI only offers plans
            // that dialect actually sells.
            newPlans: configForDialect(cfg, d).newPlans === true,
          };
        });
        return out;
      })(),
      emailVerified,
      maxDevices: Number(user.maxDevices) > 0 ? Number(user.maxDevices) : 3,
      createdAt: user.createdAt,
    },
    proofs: allProofs.filter(p => p.userId === user.id),
    deviceCount: devices.filter(d => !d.blocked).length,
    appeals: allAppeals.filter(a => a.userId === user.id).length,
  });
});

// ---- Every sign-in account (Firebase Auth roster) + analytics ----
// The admin hub's normal Users tab only shows accounts that finished the app-side
// profile. This reads the full Firebase Auth list — the real record of everyone
// who ever authenticated (email OR Google) — so nobody is invisible, including
// Google users who signed in but didn't finish the "Almost there" details form.
router.get('/auth-users', requireAdmin, async (req, res) => {
  if (!firebase.isEnabled()) return res.status(503).json({ error: 'Firebase is not configured.' });
  try {
    const [authUsers, dbUsers] = await Promise.all([firebase.listAuthUsers(), store.listAllUsers()]);
    const byUid = {}, byEmail = {};
    dbUsers.forEach((u) => {
      if (u.firebaseUid) byUid[u.firebaseUid] = u;
      if (u.email) byEmail[String(u.email).toLowerCase()] = u;
    });
    const rows = authUsers.map((a) => {
      const rec = byUid[a.uid] || byEmail[String(a.email || '').toLowerCase()] || null;
      const isGoogle = a.providers.includes('google.com');
      const isPassword = a.providers.includes('password');
      const method = isGoogle ? (isPassword ? 'google + email' : 'google') : 'email';
      return {
        email: a.email,
        method,
        emailVerified: a.emailVerified,
        // Who can actually get in: Google users are auto-verified; email users
        // must have verified their address.
        canSignIn: a.emailVerified || isGoogle,
        signedIn: !!a.lastSignInTime,
        inAdminHub: !!rec,          // has a completed app-side record
        tier: rec ? rec.tier : null,
        name: rec ? (rec.name || '') : '',
        createdAt: a.creationTime,
        lastSignIn: a.lastSignInTime,
      };
    });
    // Newest sign-in first.
    rows.sort((x, y) => new Date(y.lastSignIn || y.createdAt || 0) - new Date(x.lastSignIn || x.createdAt || 0));
    const stats = {
      total: rows.length,
      signedIn: rows.filter((r) => r.signedIn).length,
      google: rows.filter((r) => r.method.indexOf('google') === 0).length,
      email: rows.filter((r) => r.method === 'email').length,
      canSignIn: rows.filter((r) => r.canSignIn).length,
      verified: rows.filter((r) => r.emailVerified).length,
      notInHub: rows.filter((r) => !r.inAdminHub).length,
    };
    res.json({ stats, users: rows });
  } catch (err) {
    console.error('[admin] auth-users failed:', err.message);
    res.status(500).json({ error: 'Could not load the sign-in accounts right now.' });
  }
});

// ---- Admin: unblock a student whose verification email never arrived ----
// Firebase's Admin SDK cannot SEND the verification email (only the browser can,
// and that's the throttled path that's failing), so this marks the account
// verified directly — a one-click, delivery-independent way to let a trusted
// student in. It also returns a fresh verification link the admin can forward
// (e.g. over WhatsApp) if they'd rather the student confirm it themselves.
router.post('/users/:id/verify-email', requireAdmin, async (req, res) => {
  if (!firebase.isEnabled()) return res.status(503).json({ error: 'Firebase is not configured, so email verification cannot be changed here.' });
  const user = await store.findUserById(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  try {
    const fbUser = user.firebaseUid
      ? await firebase.getAuthUser(user.firebaseUid)
      : await firebase.getAuthUserByEmail(user.email);
    if (!fbUser) return res.status(404).json({ error: 'No Firebase account found for this email.' });
    await firebase.setEmailVerified(fbUser.uid);
    let link = null;
    try { link = await firebase.generateVerificationLink(user.email); } catch (e) { /* link is a bonus; verify already succeeded */ }
    res.json({ ok: true, emailVerified: true, email: user.email, link });
  } catch (err) {
    console.error('[admin] verify-email failed:', err.message);
    res.status(500).json({ error: 'Could not verify this account right now. Please try again.' });
  }
});

// ---- All proofs grouped by state, each with screenshot + plan + user info ----
router.get('/subscriptions', requireAdmin, async (req, res) => {
  const [proofs, users] = await Promise.all([store.listAllManualProofs(), store.listAllUsers()]);
  const usersById = new Map(users.map(u => [u.id, u]));
  const enrich = (p) => {
    const user = usersById.get(p.userId) || {};
    const plan = PLANS[p.planId] || {};
    const expired = user.planExpiresAt && isExpired(user.planExpiresAt) && user.planId === p.planId;
    return {
      id: p.id, method: p.method, planId: p.planId,
      planName: plan.name ? `${plan.name}${plan.period ? ' · ' + plan.period : ''}` : p.planId,
      status: p.status, transactionId: p.transactionId || '', referenceNote: p.referenceNote || '',
      submittedAt: p.submittedAt, reviewedAt: p.reviewedAt || null,
      userEmail: user.email || '(deleted user)', userName: user.name || '',
      // What was ACTUALLY paid: the dialect the student learns in, the currency
      // they paid in, and the amount in that currency — all captured at
      // submission time. Proofs predating this carry none, so the hub shows a
      // dash rather than guessing.
      dialect: p.dialect || user.dialect || 'eg',
      paidCurrency: p.currency || null,
      paidAmount: (p.amount === 0 || p.amount) ? p.amount : null,
      planExpiresAt: user.planExpiresAt || null,
      expired: !!expired,
    };
  };
  const all = proofs.map(enrich);
  res.json({
    active: all.filter(p => p.status === 'approved' && !p.expired),
    suspended: all.filter(p => p.status === 'approved' && p.expired),
    pending: all.filter(p => p.status === 'pending'),
    approved: all.filter(p => p.status === 'approved'),
    rejected: all.filter(p => p.status === 'rejected'),
  });
});

// ---- Password reset requests to action ----
router.get('/reset-requests', requireAdmin, async (req, res) => {
  const reqs = (await store.listResetRequests()).map(r => ({
    id: r.id, email: r.email, status: r.status,
    requestedAt: r.requestedAt, token: r.token,
  }));
  res.json({ requests: reqs });
});

// ---- Admin marks a reset request as "link sent" and gets the reset link to send ----
router.post('/reset-requests/:id/send-link', requireAdmin, async (req, res) => {
  const r = await store.findResetRequest(req.params.id);
  if (!r) return res.status(404).json({ error: 'Reset request not found.' });
  await store.updateResetRequest(r.id, { status: 'link_sent', linkSentAt: new Date().toISOString() });
  const base = process.env.APP_URL || '';
  res.json({ ok: true, resetLink: `${base}/reset-password.html?token=${r.token}`, email: r.email });
});

// ---- Recommendations / feedback ----
router.get('/recommendations', requireAdmin, async (req, res) => {
  res.json({ recommendations: await store.listRecommendations() });
});

// ---- Device history (all, or per user) ----
router.get('/devices', requireAdmin, async (req, res) => {
  const userId = req.query.userId;
  const [devices, users] = await Promise.all([
    userId ? store.listDevicesForUser(userId) : store.listAllDevices(),
    store.listAllUsers(),
  ]);
  const usersById = new Map(users.map(u => [u.id, u]));
  const enriched = devices.map(d => {
    const u = usersById.get(d.userId) || {};
    return { ...d, userEmail: u.email || '(deleted)', userName: u.name || '' };
  });
  res.json({ devices: enriched });
});

// ---- Flag a device as a violation ----
router.post('/devices/:userId/:deviceId/flag', requireAdmin, async (req, res) => {
  const updated = await store.updateDevice(req.params.userId, req.params.deviceId, {
    flagged: true, flagReason: (req.body && req.body.reason) || 'Flagged by admin', flaggedAt: new Date().toISOString(),
  });
  if (!updated) return res.status(404).json({ error: 'Device not found.' });
  res.json({ ok: true });
});

// ---- Permit a device: clear both the block AND the flag. Used to grant a
// legitimate third device (e.g. the user got a new phone and the old two are
// still on file) or to un-flag a false positive. The 2-device gate is
// enforced on the NEXT login attempt; clearing `blocked` here lets that
// device slot count as free again. ----
router.post('/devices/:userId/:deviceId/permit', requireAdmin, async (req, res) => {
  const updated = await store.updateDevice(req.params.userId, req.params.deviceId, {
    blocked: false, flagged: false, flagReason: null,
    permittedAt: new Date().toISOString(),
    permittedReason: (req.body && req.body.reason) || 'Permitted by admin',
  });
  if (!updated) return res.status(404).json({ error: 'Device not found.' });
  res.json({ ok: true });
});

// ---- Set an account's device limit ----
// The global rule is 2 devices; this raises (or restores) the cap for ONE
// account — the durable way to "permit a third device or more", since it also
// stops that user's future sign-ins being flagged again and again.
router.post('/users/:id/device-limit', requireAdmin, async (req, res) => {
  const user = await store.findUserById(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  const n = Number((req.body || {}).maxDevices);
  if (!Number.isInteger(n) || n < 1 || n > 10) {
    return res.status(400).json({ error: 'Device limit must be a whole number between 1 and 10.' });
  }
  await store.updateUser(user.id, { maxDevices: n === 3 ? undefined : n }); // 2 = back to default
  res.json({ ok: true, maxDevices: n });
});

// ---- Device-limit appeals (filed from the login page when blocked) ----
router.get('/device-appeals', requireAdmin, async (req, res) => {
  res.json({ appeals: await store.listDeviceAppeals() });
});

// Resolve an appeal. `resolution` says what the admin decided:
//   permit-device — unblock the specific device the appeal came from
//   raise-limit   — bump the account's device cap to `maxDevices`
//   dismiss       — no action, just close it
router.post('/device-appeals/:id/resolve', requireAdmin, async (req, res) => {
  const appeal = await store.findDeviceAppeal(req.params.id);
  if (!appeal) return res.status(404).json({ error: 'Appeal not found.' });
  const { resolution, maxDevices } = req.body || {};

  if (resolution === 'permit-device') {
    if (!appeal.deviceId) return res.status(400).json({ error: 'This appeal has no device fingerprint to permit — raise the limit instead.' });
    const dev = await store.findDevice(appeal.userId, appeal.deviceId);
    if (dev) {
      await store.updateDevice(appeal.userId, appeal.deviceId, {
        blocked: false, flagged: false, flagReason: null,
        permittedAt: new Date().toISOString(), permittedReason: 'Appeal approved by admin',
      });
    } else {
      // The block happened before the device row existed (or it was cleaned
      // up) — raising the cap by one gives the same outcome.
      const user = await store.findUserById(appeal.userId);
      const cur = Number(user && user.maxDevices) > 0 ? Number(user.maxDevices) : 3;
      await store.updateUser(appeal.userId, { maxDevices: cur + 1 });
    }
  } else if (resolution === 'raise-limit') {
    const n = Number(maxDevices);
    if (!Number.isInteger(n) || n < 1 || n > 10) return res.status(400).json({ error: 'Device limit must be 1-10.' });
    await store.updateUser(appeal.userId, { maxDevices: n === 3 ? undefined : n });
  } else if (resolution !== 'dismiss') {
    return res.status(400).json({ error: 'Unknown resolution.' });
  }

  await store.updateDeviceAppeal(appeal.id, {
    status: resolution === 'dismiss' ? 'dismissed' : 'resolved',
    resolution, resolvedAt: new Date().toISOString(),
  });
  res.json({ ok: true });
});

// ---- Site switches (Developer): plans kill-switch + new plan structure ----
// Returns the GLOBAL kill switch plus the plans mode of every dialect, so the
// Developer tab can render one row per dialect.
function siteConfigView(cfg) {
  const out = { plansEnabled: cfg.plansEnabled !== false, newPlans: cfg.newPlans === true, dialects: {} };
  DIALECTS.forEach(function (d) { out.dialects[d] = { newPlans: configForDialect(cfg, d).newPlans }; });
  return out;
}
router.get('/site-config', requireAdmin, async (req, res) => {
  res.json(siteConfigView(await store.getSiteConfig()));
});
router.post('/site-config', requireAdmin, async (req, res) => {
  const body = req.body || {};
  const patch = {};
  // plansEnabled is global — one kill switch for the whole payment surface.
  if (body.plansEnabled !== undefined) patch.plansEnabled = body.plansEnabled !== false;
  // newPlans is per dialect. Egyptian keeps writing the legacy flat field so
  // older installs and any cached client keep reading the same value; the
  // other dialects are stored under dialects.<id>.
  if (body.newPlans !== undefined) {
    const d = normaliseDialect(body.dialect);
    if (d === 'eg') {
      patch.newPlans = body.newPlans === true;
    } else {
      const cur = await store.getSiteConfig();
      const dialects = Object.assign({}, cur.dialects || {});
      dialects[d] = Object.assign({}, dialects[d] || {}, { newPlans: body.newPlans === true });
      patch.dialects = dialects;
    }
  }
  await store.setSiteConfig(patch);
  res.json(Object.assign({ ok: true }, siteConfigView(await store.getSiteConfig())));
});

// ---- Full admin subscription + account controls (items 12 & 15) ----
// Every action writes the complete plan state so My Account / dashboard / access
// all reflect it immediately on the next /api/auth/me (no manual refresh needed).
router.post('/users/:id/action', requireAdmin, async (req, res) => {
  const { action, planId, days } = req.body || {};
  const user = await store.findUserById(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  const now = new Date().toISOString();
  const cfg = await store.getSiteConfig();

  // Which dialect this action applies to. Defaults to the dialect the account
  // is currently in, so existing calls behave exactly as before — but the admin
  // can now name any dialect and manage all three from one place, instead of
  // only being able to touch whichever one the student happens to be sitting in.
  const target = req.body && req.body.dialect ? normaliseDialect(req.body.dialect) : normaliseDialect(user.dialect);

  // Read before anything changes, so the audit row can say what it was as well
  // as what it became.
  const beforeEnt = entitlements.forDialect(user, target, cfg);

  // Revoking a plan drops the student to the free baseline of the TARGET
  // dialect's plans page — Basic under new-plans, Explorer under the classic
  // page. Read per dialect, not globally: the global value is Egyptian's, so
  // suspending a Hejazi subscriber used to park them on 'basic', a tier the
  // classic page Hejazi runs does not even sell.
  const revokeTier = baselineTier(configForDialect(cfg, target));

  // Everything below writes through entitlements.grant(…, target, …) so a plan
  // stays parked on the dialect it belongs to, and the flat fields only move if
  // that dialect is the one the student is currently in.
  function currentEnt() { return entitlements.forDialect(user, target, cfg); }

  async function setPlan(newPlanId, activatedAt) {
    const start = activatedAt || now;
    const planPatch = entitlements.grant(user, target, {
      tier: accessTierForPlan(newPlanId),
      planId: newPlanId,
      planActivatedAt: start,
      planExpiresAt: await computeExpiry(newPlanId, start),
      subStatus: 'active',
    }, cfg);
    planPatch.status = user.status === 'banned' ? 'banned' : user.status;
    await store.updateUser(user.id, planPatch);
  }

  async function shiftExpiry(deltaDays) {
    // Reads and writes the TARGET dialect's expiry rather than the flat field,
    // which belongs to whichever dialect the student is currently in.
    const ent = currentEnt();
    const cur = ent.planExpiresAt ? new Date(ent.planExpiresAt).getTime() : Date.now();
    const next = new Date(cur + deltaDays * 86400000).toISOString();
    await store.updateUser(user.id, entitlements.grant(user, target, {
      tier: ent.tier, planId: ent.planId, planActivatedAt: ent.planActivatedAt,
      planExpiresAt: next, subStatus: 'active',
    }, cfg));
  }

  switch (action) {
    case 'suspend': { // stop access now, but remember the plan so it can be reactivated
      const ent = currentEnt();
      await store.updateUser(user.id, Object.assign(
        entitlements.grant(user, target, { tier: revokeTier, planId: ent.planId,
          planActivatedAt: ent.planActivatedAt, planExpiresAt: ent.planExpiresAt,
          subStatus: 'suspended' }, cfg),
        { suspendedAt: now }));
      break;
    }
    case 'reactivate': { // restore access to the plan on file (if any)
      const ent = currentEnt();
      if (!ent.planId) return res.status(400).json({ error: 'This user has no plan to reactivate in ' + target + '.' });
      await store.updateUser(user.id, Object.assign(
        entitlements.grant(user, target, { tier: accessTierForPlan(ent.planId), planId: ent.planId,
          planActivatedAt: ent.planActivatedAt, planExpiresAt: ent.planExpiresAt,
          subStatus: 'active' }, cfg),
        { suspendedAt: null }));
      break;
    }
    case 'activate': // manually turn on a specific plan
    case 'upgrade':
    case 'downgrade':
    case 'change': // upgrade/downgrade/change all mean "set this plan"
      if (!planId || !PLANS[planId]) return res.status(400).json({ error: 'A valid planId is required.' });
      await setPlan(planId, user.planActivatedAt && action === 'change' ? user.planActivatedAt : now);
      break;
    case 'extend': {
      const n = Math.abs(Number(days) || 0);
      await shiftExpiry(n);
      // Worth telling them: their subscription now runs longer than it did.
      // A reduction is deliberately not announced here — that is a
      // conversation, not a notification.
      if (n) {
        await store.addUserNotification(user.id, {
          id: nanoid(),
          type: 'admin-extend',
          title: 'Your subscription was extended by ' + n + ' day' + (n === 1 ? '' : 's'),
          body: String((req.body && req.body.reason) || '').slice(0, 300) || 'Added by the Tabib Talk team.',
          createdAt: now, readAt: null, actioned: null,
        });
      }
      break;
    }
    case 'reduce':
      await shiftExpiry(-Math.abs(Number(days) || 0));
      break;
    case 'gift': {
      // Days given as a gift, rather than an adjustment to a plan already held.
      //
      // Deliberately routed through the same code a referral reward uses, so a
      // gift behaves exactly like earned days: it extends from whichever is
      // later — now or the current expiry — never truncates time already paid
      // for, never knocks the student down a tier, and grants the dialect's own
      // reward plan to somebody who holds nothing.
      const n = Math.abs(Number(days) || 0);
      if (!n) return res.status(400).json({ error: 'How many days would you like to give?' });
      if (n > 3650) return res.status(400).json({ error: 'That is more than ten years — please check the number.' });

      const giftPlan = planId && PLANS[planId] ? planId : rewards.rewardPlanFor(cfg, target);
      const patch = rewards.extendPatch(user, target, n, giftPlan, cfg);
      if (!patch) {
        return res.status(400).json({ error: 'This student already has lifetime access in ' + target + ' — there is nothing to extend.' });
      }

      // The ledger is what makes a gift accountable: it says who gave it, how
      // many days, on which plan, and the reason typed at the time.
      const who = actor(req);
      await store.addRewardLedger(rewards.ledgerRow({
        userId: user.id, type: 'admin-gift', days: n, planId: giftPlan, dialect: target,
        source: 'given by an administrator', adminId: who.adminId,
        reason: String((req.body && req.body.reason) || '').slice(0, 300) || null,
      }));
      await store.updateUser(user.id, patch);

      await store.addUserNotification(user.id, {
        id: nanoid(),
        type: 'admin-gift',
        title: n + ' day' + (n === 1 ? '' : 's') + ' added to your subscription',
        body: String((req.body && req.body.reason) || '').slice(0, 300) || 'A gift from the Tabib Talk team.',
        createdAt: now, readAt: null, actioned: null,
      });
      break;
    }
    case 'expire': { // force the plan to end right now -> revert to the free baseline
      const ent = currentEnt();
      await store.updateUser(user.id, entitlements.grant(user, target, {
        tier: revokeTier, planId: ent.planId, planActivatedAt: ent.planActivatedAt,
        planExpiresAt: now, subStatus: 'expired',
      }, cfg));
      break;
    }
    case 'ban':
      await store.updateUser(user.id, { status: 'banned', bannedAt: now });
      // A ban must take effect immediately, not on the next login. Kill every
      // existing express-session that belongs to this user AND revoke all of
      // their Firebase refresh tokens, so a still-open tab loses access on its
      // next request and any second-device sign-in is refused.
      try {
        const store2 = req.app.locals.sessionStore;
        if (store2 && store2.destroyByUserId) await store2.destroyByUserId(user.id);
        if (user.firebaseUid && firebase.isEnabled()) await firebase.revokeTokens(user.firebaseUid);
      } catch (e) { console.error('[admin] ban cleanup failed:', e.message); }
      break;
    case 'unban':
      await store.updateUser(user.id, { status: 'active', bannedAt: null });
      break;
    default:
      return res.status(400).json({ error: 'Unknown action.' });
  }
  const updated = await store.findUserById(user.id);

  // Recorded after the change went through, so the trail never claims something
  // that did not happen.
  const afterEnt = entitlements.forDialect(updated, target, cfg);
  await audit(req, {
    userId: user.id, action, dialect: target,
    days: (action === 'extend' || action === 'reduce' || action === 'gift')
      ? (action === 'reduce' ? -Math.abs(Number(days) || 0) : Math.abs(Number(days) || 0)) : null,
    planId: afterEnt.planId || planId || null,
    reason: String((req.body && req.body.reason) || '').slice(0, 300) || null,
    previousExpiry: beforeEnt.planExpiresAt || null,
    newExpiry: afterEnt.planExpiresAt || null,
    previousTier: beforeEnt.tier || null,
    newTier: afterEnt.tier || null,
  });

  // `dialect` echoes which dialect was acted on, and `dialects` is the full
  // per-dialect picture, so the admin hub can refresh the row it just changed
  // without needing a second request.
  const perDialect = {};
  DIALECTS.forEach((d) => {
    const e = entitlements.forDialect(updated, d, cfg);
    perDialect[d] = { tier: e.tier, planId: e.planId, planExpiresAt: e.planExpiresAt, subStatus: e.subStatus };
  });
  res.json({ ok: true, dialect: target, user: updated, dialects: perDialect });
});

// ---- Referrals: who invited whom, and what it cost ----
//
// Built from the ledger rather than from running totals on accounts, so the
// figures here are the record of what was actually granted and cannot drift
// away from it.
router.get('/referrals', requireAdmin, async (req, res) => {
  const [referrals, ledger, users] = await Promise.all([
    store.listAllReferrals(),
    store.listAllRewards(),
    store.listAllUsers(),
  ]);
  const byId = {};
  users.forEach(u => { byId[u.id] = u; });
  const brief = id => (byId[id]
    ? { id, name: byId[id].name || '', email: byId[id].email || '', college: byId[id].college || '' }
    : { id, name: '(deleted account)', email: '', college: '' });

  const month = rewards.monthKey();
  const inviters = {};
  referrals.forEach((r) => {
    const row = inviters[r.referrerId] || (inviters[r.referrerId] = {
      inviter: brief(r.referrerId), total: 0, thisMonth: 0,
      daysEarned: 0, paid: 0, referred: [],
    });
    row.total += 1;
    if (rewards.monthKey(r.createdAt) === month) row.thisMonth += 1;
    row.referred.push({
      person: brief(r.referredId), dialect: r.dialect, joinedAt: r.createdAt,
      rewarded: !!r.signupRewardedAt, paidRewarded: !!r.paidRewardedAt,
      cappedAt: r.cappedAt || null,
    });
  });
  // Days come from the ledger, which is the only place a grant is recorded.
  ledger.forEach((l) => {
    if (l.type !== 'referral-signup' && l.type !== 'referral-paid') return;
    const row = inviters[l.userId];
    if (!row) return;
    row.daysEarned += Number(l.days) || 0;
    if (l.type === 'referral-paid') row.paid += 1;
  });

  const list = Object.values(inviters).sort((a, b) => b.total - a.total);
  res.json({
    inviters: list,
    totals: {
      referrals: referrals.length,
      inviters: list.length,
      daysGranted: ledger.filter(l => l.type === 'referral-signup' || l.type === 'referral-paid')
        .reduce((s, l) => s + (Number(l.days) || 0), 0),
      paidConversions: ledger.filter(l => l.type === 'referral-paid').length,
      giftedDays: ledger.filter(l => l.type === 'admin-gift').reduce((s, l) => s + (Number(l.days) || 0), 0),
    },
    monthlyCap: rewards.MONTHLY_REWARD_CAP,
    signupDays: rewards.SIGNUP_REWARD_DAYS,
    paidDays: rewards.PAID_REWARD_DAYS,
  });
});

// ---- One student's referral picture, for their row in the hub ----
router.get('/users/:id/referrals', requireAdmin, async (req, res) => {
  const id = req.params.id;
  const [sent, ledger, wasReferred] = await Promise.all([
    store.listReferralsBy(id),
    store.listRewardsFor(id),
    store.findReferralByReferred(id),
  ]);
  const ids = sent.map(r => r.referredId).concat(wasReferred ? [wasReferred.referrerId] : []);
  const people = await Promise.all(ids.map(x => store.findUserById(x)));
  const byId = {};
  ids.forEach((x, i) => { byId[x] = people[i]; });
  const brief = x => (byId[x]
    ? { id: x, name: byId[x].name || '', email: byId[x].email || '' }
    : { id: x, name: '(deleted account)', email: '' });

  const month = rewards.monthKey();
  res.json({
    invited: sent.map(r => ({
      person: brief(r.referredId), dialect: r.dialect, joinedAt: r.createdAt,
      rewarded: !!r.signupRewardedAt, paidRewarded: !!r.paidRewardedAt, cappedAt: r.cappedAt || null,
    })),
    invitedBy: wasReferred ? {
      person: brief(wasReferred.referrerId), dialect: wasReferred.dialect, joinedAt: wasReferred.createdAt,
    } : null,
    rewardedThisMonth: ledger.filter(l => l.type === 'referral-signup'
      && rewards.monthKey(l.createdAt) === month).length,
    monthlyCap: rewards.MONTHLY_REWARD_CAP,
    daysEarned: ledger.filter(l => l.type === 'referral-signup' || l.type === 'referral-paid')
      .reduce((s, l) => s + (Number(l.days) || 0), 0),
    daysGifted: ledger.filter(l => l.type === 'admin-gift').reduce((s, l) => s + (Number(l.days) || 0), 0),
    ledger: ledger.slice(0, 50).map(l => ({
      type: l.type, days: l.days, planId: l.planId, dialect: l.dialect,
      source: l.source, reason: l.reason, adminId: l.adminId,
      paymentId: l.paymentId, createdAt: l.createdAt,
    })),
  });
});

// ---- The audit trail ----
// Every administrative change to somebody's access, newest first.
router.get('/audit', requireAdmin, async (req, res) => {
  const [rows, users] = await Promise.all([store.listAdminAudit(), store.listAllUsers()]);
  const byId = {};
  users.forEach(u => { byId[u.id] = u; });
  const limit = Math.min(Number(req.query.limit) || 200, 1000);
  const filtered = req.query.userId ? rows.filter(r => r.userId === req.query.userId) : rows;
  res.json({
    entries: filtered.slice(0, limit).map(r => Object.assign({}, r, {
      user: byId[r.userId]
        ? { id: r.userId, name: byId[r.userId].name || '', email: byId[r.userId].email || '' }
        : { id: r.userId, name: '(deleted account)', email: '' },
    })),
    total: filtered.length,
  });
});

// ---- Send a broadcast notification to every user (shows up in their notification bell) ----
router.post('/notifications/send', requireAdmin, async (req, res) => {
  const { message } = req.body || {};
  if (!message || !message.trim()) return res.status(400).json({ error: 'Please write a message before sending.' });
  const { nanoid } = require('nanoid');
  const notif = await store.createNotification({
    id: nanoid(), message: message.trim().slice(0, 2000), createdAt: new Date().toISOString(),
  });
  res.json({ ok: true, notification: notif });
});

// ---- History of everything the admin has broadcast ----
router.get('/notifications', requireAdmin, async (req, res) => {
  res.json({ notifications: await store.listNotifications() });
});

// ---- Delete one broadcast from the history ----
// Removes it from the admin's list and from every user's notification bell,
// since the bell reads the same collection. Old announcements pile up otherwise
// and there was no way to clear them.
router.delete('/notifications/:id', requireAdmin, async (req, res) => {
  const ok = await store.deleteNotification(req.params.id);
  if (!ok) return res.status(404).json({ error: 'That message no longer exists.' });
  res.json({ ok: true });
});

// ---- Log of every phrase share (item 4: Admin Logging) ----
router.get('/shares', requireAdmin, async (req, res) => {
  res.json({ shares: await store.listShares() });
});

// ---- Developer section: read/edit live plan pricing & duration ----
router.get('/plan-config', requireAdmin, async (req, res) => {
  const { getEffectivePlans } = require('../data/plans');
  // Shows the prices in force for one dialect, so the Developer table can be
  // switched between them. No dialect = the shared prices.
  res.json(await getEffectivePlans(req.query.dialect));
});

router.post('/plan-config/:planId', requireAdmin, async (req, res) => {
  const { planId } = req.params;
  const { priceNow, days, label } = req.body || {};
  if (!PLANS[planId]) return res.status(404).json({ error: 'Unknown plan.' });
  const patch = {};
  if (priceNow !== undefined && priceNow !== '') {
    const n = Number(priceNow);
    if (Number.isNaN(n) || n < 0) return res.status(400).json({ error: 'Price must be a positive number.' });
    patch.priceNow = n;
  }
  if (days !== undefined && days !== '') {
    const d = Number(days);
    if (Number.isNaN(d) || d <= 0) return res.status(400).json({ error: 'Duration must be a positive number of days.' });
    patch.days = d;
  }
  if (label !== undefined) {
    patch.label = String(label).slice(0, 200);
  }
  // A price can be set for ONE dialect or shared across all of them. Passing a
  // dialect writes 'planId@dialect', which wins over the shared entry for that
  // dialect only; omitting it edits the shared price as before.
  const priceDialect = req.body && req.body.dialect;
  const key = priceDialect && priceDialect !== 'all'
    ? require('../data/plans').overrideKey(planId, normaliseDialect(priceDialect))
    : planId;
  await store.setPlanOverride(key, patch);
  res.json({ ok: true });
});

// ---- Developer section: global currency conversion rates ----
// These drive the INR/EGP figures shown for every plan on the public pricing
// page and at checkout. Blank values fall back to the reference rates in plans.js.
router.get('/fx-config', requireAdmin, async (req, res) => {
  const { getFxRates, USD_TO_INR, USD_TO_EGP } = require('../data/plans');
  const [cfg, effective] = await Promise.all([store.getFxConfig(), getFxRates()]);
  res.json({
    // what the admin explicitly saved ('' = not set, using the default)
    usdToInr: cfg.usdToInr != null && cfg.usdToInr !== '' ? cfg.usdToInr : '',
    usdToEgp: cfg.usdToEgp != null && cfg.usdToEgp !== '' ? cfg.usdToEgp : '',
    // what pricing actually uses right now, plus the fallbacks for reference
    effective,
    defaults: { usdToInr: USD_TO_INR, usdToEgp: USD_TO_EGP },
  });
});

router.post('/fx-config', requireAdmin, async (req, res) => {
  const { usdToInr, usdToEgp } = req.body || {};
  const patch = {};
  // A blank value intentionally clears the override and restores the default.
  const parseRate = (v, label) => {
    if (v === undefined) return undefined;
    if (v === '' || v === null) return '';
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) throw new Error(`${label} must be a positive number.`);
    return n;
  };
  try {
    const inr = parseRate(usdToInr, 'USD to INR rate');
    const egp = parseRate(usdToEgp, 'USD to EGP rate');
    if (inr !== undefined) patch.usdToInr = inr;
    if (egp !== undefined) patch.usdToEgp = egp;
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  await store.setFxConfig(patch);
  const { getFxRates } = require('../data/plans');
  res.json({ ok: true, effective: await getFxRates() });
});

// ---- Interests: who responded to the in-app advertisement box ----
// Each row is a contactable lead: name, email and phone as captured at the
// moment the person tapped the box's call-to-action.
router.get('/interests', requireAdmin, async (req, res) => {
  const [allInterests, users] = await Promise.all([store.listInterests(), store.listAllUsers()]);
  const usersById = new Map(users.map(u => [u.id, u]));
  const interests = allInterests.map(i => {
    // Fall back to the live account if an older record predates a field.
    const u = usersById.get(i.userId) || {};
    return {
      id: i.id,
      name: i.name || u.name || '',
      email: i.email || u.email || '(deleted user)',
      phone: i.phone || u.phone || '',
      college: i.college || u.college || '',
      tier: i.tier || u.tier || '',
      adId: i.adId || '',
      adTitle: i.adTitle || '',
      createdAt: i.createdAt,
    };
  });
  const byAd = {};
  interests.forEach(i => { byAd[i.adTitle || i.adId] = (byAd[i.adTitle || i.adId] || 0) + 1; });
  res.json({ interests, total: interests.length, byAd });
});

// ---- Developer section: the advertisement box itself ----
router.get('/ad-config', requireAdmin, async (req, res) => {
  const { effectiveAd, AD_DEFAULTS } = require('./interests');
  const [ad, saved] = await Promise.all([effectiveAd(), store.getAdConfig()]);
  res.json({ ad, defaults: AD_DEFAULTS, saved });
});

router.post('/ad-config', requireAdmin, async (req, res) => {
  const { AD_DEFAULTS } = require('./interests');
  const body = req.body || {};
  const patch = {};
  Object.keys(AD_DEFAULTS).forEach(k => {
    if (body[k] === undefined) return;
    if (k === 'enabled') { patch.enabled = !!body[k]; return; }
    patch[k] = String(body[k]).slice(0, 400);
  });
  // Changing the campaign id starts a fresh lead bucket, so keep it sane.
  if (patch.adId !== undefined) {
    const clean = String(patch.adId).trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '');
    if (!clean) return res.status(400).json({ error: 'Campaign id must contain at least one letter or number.' });
    patch.adId = clean;
  }
  await store.setAdConfig(patch);
  const { effectiveAd } = require('./interests');
  res.json({ ok: true, ad: await effectiveAd() });
});

// ---- Developer section: read/edit payment gateway display fields ----
router.get('/payment-config', requireAdmin, async (req, res) => {
  const cfg = await store.getPaymentConfig();
  res.json({
    paypalLabel: cfg.paypalLabel || '',
    paypalEmail: cfg.paypalEmail || process.env.PAYPAL_EMAIL || '',
    instapayLabel: cfg.instapayLabel || '',
    instapayAddress: cfg.instapayAddress || process.env.INSTAPAY_IPA || '',
    instapayPhone: cfg.instapayPhone || process.env.INSTAPAY_PHONE || '',
    upiLabel: cfg.upiLabel || '',
    upiId: cfg.upiId || process.env.UPI_ID || '',
    upiPayeeName: cfg.upiPayeeName || process.env.UPI_PAYEE_NAME || '',
  });
});

router.post('/payment-config', requireAdmin, async (req, res) => {
  const allowed = ['paypalLabel', 'paypalEmail', 'instapayLabel', 'instapayAddress', 'instapayPhone', 'upiLabel', 'upiId', 'upiPayeeName'];
  const patch = {};
  allowed.forEach((k) => {
    if (req.body && req.body[k] !== undefined) patch[k] = String(req.body[k]).slice(0, 300);
  });
  await store.setPaymentConfig(patch);
  res.json({ ok: true });
});

// ---- Accounts: every approved payment, with earnings analysis ----
// Each approved proof becomes a recorded transaction: who paid, when, which
// plan, how much (shown in all three currencies), and the payment transaction id.
router.get('/accounts', requireAdmin, async (req, res) => {
  const { getEffectivePlans, convert } = require('../data/plans');
  const [{ plans, fx }, allProofs, users] = await Promise.all([
    getEffectivePlans(),
    store.listAllManualProofs(),
    store.listAllUsers(),
  ]);
  const usersById = new Map(users.map(u => [u.id, u]));

  const approved = allProofs.filter(p => p.status === 'approved');

  const records = approved.map(p => {
    const user = usersById.get(p.userId) || {};
    const plan = plans[p.planId] || {};
    const usd = plan.priceNow != null ? plan.priceNow : 0;
    const money = convert(usd, fx); // {usd, inr, egp} — already rounded to clean numbers
    return {
      id: p.id,
      method: p.method,
      planId: p.planId,
      planName: plan.name ? `${plan.name}${plan.period ? ' · ' + plan.period : ''}` : p.planId,
      userName: user.name || '',
      userEmail: user.email || '(deleted user)',
      // What was ACTUALLY paid: the dialect the student learns in, the currency
      // they paid in, and the amount in that currency — all captured at
      // submission time. Proofs predating this carry none, so the hub shows a
      // dash rather than guessing.
      dialect: p.dialect || user.dialect || 'eg',
      paidCurrency: p.currency || null,
      paidAmount: (p.amount === 0 || p.amount) ? p.amount : null,
      paidAt: p.reviewedAt || p.submittedAt, // approval time = when the money was confirmed
      transactionId: p.transactionId || '',
      usd: money.usd, inr: money.inr, egp: money.egp,
    };
  }).sort((a, b) => new Date(b.paidAt) - new Date(a.paidAt));

  // ---- Earnings analysis ----
  const now = Date.now();
  const DAY = 86400000;
  const sumUsd = (list) => list.reduce((t, r) => t + (r.usd || 0), 0);

  const inWindow = (days) => records.filter(r => (now - new Date(r.paidAt).getTime()) <= days * DAY);

  const last7 = inWindow(7);
  const last30 = inWindow(30);

  // Weekly buckets — last 8 weeks, oldest first (for a trend chart)
  const weekly = [];
  for (let i = 7; i >= 0; i--) {
    const end = now - (i * 7 * DAY);
    const start = end - (7 * DAY);
    const bucket = records.filter(r => {
      const t = new Date(r.paidAt).getTime();
      return t > start && t <= end;
    });
    weekly.push({
      label: i === 0 ? 'This week' : `${i}w ago`,
      count: bucket.length,
      usd: sumUsd(bucket),
    });
  }

  // Monthly buckets — last 6 calendar months, oldest first
  const monthly = [];
  const nowDate = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(nowDate.getFullYear(), nowDate.getMonth() - i, 1);
    const nextMonth = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    const bucket = records.filter(r => {
      const t = new Date(r.paidAt);
      return t >= d && t < nextMonth;
    });
    monthly.push({
      label: d.toLocaleString('en', { month: 'short', year: '2-digit' }),
      count: bucket.length,
      usd: sumUsd(bucket),
    });
  }

  // Breakdowns — which methods and plans actually bring in the money
  const byMethod = {};
  const byPlan = {};
  records.forEach(r => {
    byMethod[r.method] = (byMethod[r.method] || 0) + (r.usd || 0);
    byPlan[r.planName] = (byPlan[r.planName] || 0) + (r.usd || 0);
  });

  const totalUsd = sumUsd(records);

  res.json({
    records,
    summary: {
      totalUsd,
      totalInr: convert(totalUsd, fx).inr,
      totalEgp: convert(totalUsd, fx).egp,
      totalPayments: records.length,
      last7Usd: sumUsd(last7), last7Count: last7.length,
      last30Usd: sumUsd(last30), last30Count: last30.length,
      avgUsd: records.length ? Math.round((totalUsd / records.length) * 100) / 100 : 0,
    },
    weekly,
    monthly,
    byMethod,
    byPlan,
  });
});

module.exports = router;
