const express = require('express');
const { nanoid } = require('nanoid');
const store = require('../data/store');
const firebase = require('../data/firebase');
const { requireAdmin } = require('./manual-payments');
const { reconcileAllUsers } = require('./auth');
const { isExpired, PLANS, accessTierForPlan, computeExpiry } = require('../data/plans');

const router = express.Router();

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
      subState: !u.planId ? 'none' : (expired ? 'suspended' : 'active'),
      deviceCount: allDevices.filter(d => d.userId === u.id && !d.blocked).length,
      maxDevices: Number(u.maxDevices) > 0 ? Number(u.maxDevices) : 2,
      createdAt: u.createdAt,
    };
  });
  res.json({ users });
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
  await store.updateUser(user.id, { maxDevices: n === 2 ? undefined : n }); // 2 = back to default
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
      const cur = Number(user && user.maxDevices) > 0 ? Number(user.maxDevices) : 2;
      await store.updateUser(appeal.userId, { maxDevices: cur + 1 });
    }
  } else if (resolution === 'raise-limit') {
    const n = Number(maxDevices);
    if (!Number.isInteger(n) || n < 1 || n > 10) return res.status(400).json({ error: 'Device limit must be 1-10.' });
    await store.updateUser(appeal.userId, { maxDevices: n === 2 ? undefined : n });
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
router.get('/site-config', requireAdmin, async (req, res) => {
  const cfg = await store.getSiteConfig();
  res.json({ plansEnabled: cfg.plansEnabled !== false, newPlans: cfg.newPlans === true });
});
router.post('/site-config', requireAdmin, async (req, res) => {
  const body = req.body || {};
  const patch = {};
  if (body.plansEnabled !== undefined) patch.plansEnabled = body.plansEnabled !== false;
  if (body.newPlans !== undefined) patch.newPlans = body.newPlans === true;
  await store.setSiteConfig(patch);
  const cfg = await store.getSiteConfig();
  res.json({ ok: true, plansEnabled: cfg.plansEnabled !== false, newPlans: cfg.newPlans === true });
});

// ---- Full admin subscription + account controls (items 12 & 15) ----
// Every action writes the complete plan state so My Account / dashboard / access
// all reflect it immediately on the next /api/auth/me (no manual refresh needed).
router.post('/users/:id/action', requireAdmin, async (req, res) => {
  const { action, planId, days } = req.body || {};
  const user = await store.findUserById(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  const now = new Date().toISOString();

  async function setPlan(newPlanId, activatedAt) {
    const start = activatedAt || now;
    await store.updateUser(user.id, {
      tier: accessTierForPlan(newPlanId),
      planId: newPlanId,
      planActivatedAt: start,
      planExpiresAt: await computeExpiry(newPlanId, start),
      subStatus: 'active',
      status: user.status === 'banned' ? 'banned' : user.status,
    });
  }

  async function shiftExpiry(deltaDays) {
    const cur = user.planExpiresAt ? new Date(user.planExpiresAt).getTime() : Date.now();
    const next = new Date(cur + deltaDays * 86400000).toISOString();
    await store.updateUser(user.id, { planExpiresAt: next, subStatus: 'active' });
  }

  switch (action) {
    case 'suspend': // stop access now, but remember the plan so it can be reactivated
      await store.updateUser(user.id, { tier: 'explorer', subStatus: 'suspended', suspendedAt: now });
      break;
    case 'reactivate': // restore access to the plan on file (if any)
      if (user.planId) await store.updateUser(user.id, { tier: accessTierForPlan(user.planId), subStatus: 'active', suspendedAt: null });
      else return res.status(400).json({ error: 'This user has no plan to reactivate.' });
      break;
    case 'activate': // manually turn on a specific plan
    case 'upgrade':
    case 'downgrade':
    case 'change': // upgrade/downgrade/change all mean "set this plan"
      if (!planId || !PLANS[planId]) return res.status(400).json({ error: 'A valid planId is required.' });
      await setPlan(planId, user.planActivatedAt && action === 'change' ? user.planActivatedAt : now);
      break;
    case 'extend':
      await shiftExpiry(Math.abs(Number(days) || 0));
      break;
    case 'reduce':
      await shiftExpiry(-Math.abs(Number(days) || 0));
      break;
    case 'expire': // force the plan to end right now -> revert to explorer
      await store.updateUser(user.id, { tier: 'explorer', subStatus: 'expired', planExpiresAt: now });
      break;
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
  res.json({ ok: true, user: await store.findUserById(user.id) });
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

// ---- Log of every phrase share (item 4: Admin Logging) ----
router.get('/shares', requireAdmin, async (req, res) => {
  res.json({ shares: await store.listShares() });
});

// ---- Developer section: read/edit live plan pricing & duration ----
router.get('/plan-config', requireAdmin, async (req, res) => {
  const { getEffectivePlans } = require('../data/plans');
  res.json(await getEffectivePlans());
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
  await store.setPlanOverride(planId, patch);
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
