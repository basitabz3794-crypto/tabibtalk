const express = require('express');
const { nanoid } = require('nanoid');
const store = require('../data/store');
const { requireAdmin } = require('./manual-payments');
const { isExpired, PLANS, accessTierForPlan, computeExpiry } = require('../data/plans');

const router = express.Router();

// ---- Existing: all pending proofs across every method ----
router.get('/pending', requireAdmin, (req, res) => {
  res.json({ proofs: store.listPendingManualProofs() });
});

// ---- Analytics overview: the numbers the admin hub shows at the top ----
router.get('/overview', requireAdmin, (req, res) => {
  const users = store.listAllUsers();
  const proofs = store.listAllManualProofs();

  // A subscription is "active" if approved AND not expired.
  const approved = proofs.filter(p => p.status === 'approved');
  const activeSubs = [];
  const suspendedSubs = []; // approved but plan duration elapsed
  approved.forEach(p => {
    const user = store.findUserById(p.userId);
    const expiresAt = user && user.planExpiresAt;
    // Match the proof's plan to the user's current plan to avoid double-counting old proofs
    const isCurrent = user && user.planId === p.planId;
    if (!isCurrent) return;
    if (expiresAt && isExpired(expiresAt)) suspendedSubs.push({ proof: p, user });
    else activeSubs.push({ proof: p, user });
  });

  const tierCounts = {};
  users.forEach(u => { tierCounts[u.tier] = (tierCounts[u.tier] || 0) + 1; });

  const planCounts = {};
  approved.forEach(p => { planCounts[p.planId] = (planCounts[p.planId] || 0) + 1; });

  res.json({
    totals: {
      users: users.length,
      pending: proofs.filter(p => p.status === 'pending').length,
      approved: approved.length,
      rejected: proofs.filter(p => p.status === 'rejected').length,
      active: activeSubs.length,
      suspended: suspendedSubs.length,
      recommendations: store.listRecommendations().length,
      resetRequests: store.listResetRequests('pending').length,
      flaggedDevices: store.listAllDevices().filter(d => d.flagged).length,
    },
    tierCounts,
    planCounts,
  });
});

// ---- All users, enriched with their subscription state ----
router.get('/users', requireAdmin, (req, res) => {
  const users = store.listAllUsers().map(u => {
    const expired = u.planExpiresAt && isExpired(u.planExpiresAt);
    return {
      id: u.id, name: u.name || '', email: u.email,
      phone: u.phone || '', college: u.college || '',
      nationality: u.nationality || '', grade: u.grade || '',
      tier: u.tier, planId: u.planId || null,
      planActivatedAt: u.planActivatedAt || null, planExpiresAt: u.planExpiresAt || null,
      status: u.status || 'active',
      subState: !u.planId ? 'none' : (expired ? 'suspended' : 'active'),
      deviceCount: store.listDevicesForUser(u.id).filter(d => !d.blocked).length,
      createdAt: u.createdAt,
    };
  });
  res.json({ users });
});

// ---- All proofs grouped by state, each with screenshot + plan + user info ----
router.get('/subscriptions', requireAdmin, (req, res) => {
  const enrich = (p) => {
    const user = store.findUserById(p.userId) || {};
    const plan = PLANS[p.planId] || {};
    const expired = user.planExpiresAt && isExpired(user.planExpiresAt) && user.planId === p.planId;
    return {
      id: p.id, method: p.method, planId: p.planId,
      planName: plan.name ? `${plan.name}${plan.period ? ' · ' + plan.period : ''}` : p.planId,
      status: p.status, screenshotPath: p.screenshotPath, referenceNote: p.referenceNote || '',
      submittedAt: p.submittedAt, reviewedAt: p.reviewedAt || null,
      userEmail: user.email || '(deleted user)', userName: user.name || '',
      planExpiresAt: user.planExpiresAt || null,
      expired: !!expired,
    };
  };
  const all = store.listAllManualProofs().map(enrich);
  res.json({
    active: all.filter(p => p.status === 'approved' && !p.expired),
    suspended: all.filter(p => p.status === 'approved' && p.expired),
    pending: all.filter(p => p.status === 'pending'),
    approved: all.filter(p => p.status === 'approved'),
    rejected: all.filter(p => p.status === 'rejected'),
  });
});

// ---- Password reset requests to action ----
router.get('/reset-requests', requireAdmin, (req, res) => {
  const reqs = store.listResetRequests().map(r => ({
    id: r.id, email: r.email, status: r.status,
    requestedAt: r.requestedAt, token: r.token,
  }));
  res.json({ requests: reqs });
});

// ---- Admin marks a reset request as "link sent" and gets the reset link to send ----
router.post('/reset-requests/:id/send-link', requireAdmin, (req, res) => {
  const r = store.findResetRequest(req.params.id);
  if (!r) return res.status(404).json({ error: 'Reset request not found.' });
  store.updateResetRequest(r.id, { status: 'link_sent', linkSentAt: new Date().toISOString() });
  const base = process.env.APP_URL || '';
  res.json({ ok: true, resetLink: `${base}/reset-password.html?token=${r.token}`, email: r.email });
});

// ---- Recommendations / feedback ----
router.get('/recommendations', requireAdmin, (req, res) => {
  res.json({ recommendations: store.listRecommendations() });
});

// ---- Device history (all, or per user) ----
router.get('/devices', requireAdmin, (req, res) => {
  const userId = req.query.userId;
  const devices = userId ? store.listDevicesForUser(userId) : store.listAllDevices();
  const enriched = devices.map(d => {
    const u = store.findUserById(d.userId) || {};
    return { ...d, userEmail: u.email || '(deleted)', userName: u.name || '' };
  });
  res.json({ devices: enriched });
});

// ---- Flag a device as a violation ----
router.post('/devices/:userId/:deviceId/flag', requireAdmin, (req, res) => {
  const updated = store.updateDevice(req.params.userId, req.params.deviceId, {
    flagged: true, flagReason: (req.body && req.body.reason) || 'Flagged by admin', flaggedAt: new Date().toISOString(),
  });
  if (!updated) return res.status(404).json({ error: 'Device not found.' });
  res.json({ ok: true });
});

// ---- Full admin subscription + account controls (items 12 & 15) ----
// Every action writes the complete plan state so My Account / dashboard / access
// all reflect it immediately on the next /api/auth/me (no manual refresh needed).
router.post('/users/:id/action', requireAdmin, (req, res) => {
  const { action, planId, days } = req.body || {};
  const user = store.findUserById(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  const now = new Date().toISOString();

  function setPlan(newPlanId, activatedAt) {
    const start = activatedAt || now;
    store.updateUser(user.id, {
      tier: accessTierForPlan(newPlanId),
      planId: newPlanId,
      planActivatedAt: start,
      planExpiresAt: computeExpiry(newPlanId, start),
      subStatus: 'active',
      status: user.status === 'banned' ? 'banned' : user.status,
    });
  }

  function shiftExpiry(deltaDays) {
    const cur = user.planExpiresAt ? new Date(user.planExpiresAt).getTime() : Date.now();
    const next = new Date(cur + deltaDays * 86400000).toISOString();
    store.updateUser(user.id, { planExpiresAt: next, subStatus: 'active' });
  }

  switch (action) {
    case 'suspend': // stop access now, but remember the plan so it can be reactivated
      store.updateUser(user.id, { tier: 'explorer', subStatus: 'suspended', suspendedAt: now });
      break;
    case 'reactivate': // restore access to the plan on file (if any)
      if (user.planId) store.updateUser(user.id, { tier: accessTierForPlan(user.planId), subStatus: 'active', suspendedAt: null });
      else return res.status(400).json({ error: 'This user has no plan to reactivate.' });
      break;
    case 'activate': // manually turn on a specific plan
    case 'upgrade':
    case 'downgrade':
    case 'change': // upgrade/downgrade/change all mean "set this plan"
      if (!planId || !PLANS[planId]) return res.status(400).json({ error: 'A valid planId is required.' });
      setPlan(planId, user.planActivatedAt && action === 'change' ? user.planActivatedAt : now);
      break;
    case 'extend':
      shiftExpiry(Math.abs(Number(days) || 0));
      break;
    case 'reduce':
      shiftExpiry(-Math.abs(Number(days) || 0));
      break;
    case 'expire': // force the plan to end right now -> revert to explorer
      store.updateUser(user.id, { tier: 'explorer', subStatus: 'expired', planExpiresAt: now });
      break;
    case 'ban':
      store.updateUser(user.id, { status: 'banned', bannedAt: now });
      break;
    case 'unban':
      store.updateUser(user.id, { status: 'active', bannedAt: null });
      break;
    default:
      return res.status(400).json({ error: 'Unknown action.' });
  }
  res.json({ ok: true, user: store.findUserById(user.id) });
});

// ---- Send a broadcast notification to every user (shows up in their notification bell) ----
router.post('/notifications/send', requireAdmin, (req, res) => {
  const { message } = req.body || {};
  if (!message || !message.trim()) return res.status(400).json({ error: 'Please write a message before sending.' });
  const { nanoid } = require('nanoid');
  const notif = store.createNotification({
    id: nanoid(), message: message.trim().slice(0, 2000), createdAt: new Date().toISOString(),
  });
  res.json({ ok: true, notification: notif });
});

// ---- History of everything the admin has broadcast ----
router.get('/notifications', requireAdmin, (req, res) => {
  res.json({ notifications: store.listNotifications() });
});

// ---- Log of every phrase share (item 4: Admin Logging) ----
router.get('/shares', requireAdmin, (req, res) => {
  res.json({ shares: store.listShares() });
});

// ---- Developer section: read/edit live plan pricing & duration ----
router.get('/plan-config', requireAdmin, (req, res) => {
  const { getEffectivePlans } = require('../data/plans');
  res.json(getEffectivePlans());
});

router.post('/plan-config/:planId', requireAdmin, (req, res) => {
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
  store.setPlanOverride(planId, patch);
  res.json({ ok: true });
});

// ---- Developer section: global currency conversion rates ----
// These drive the INR/EGP figures shown for every plan on the public pricing
// page and at checkout. Blank values fall back to the reference rates in plans.js.
router.get('/fx-config', requireAdmin, (req, res) => {
  const { getFxRates, USD_TO_INR, USD_TO_EGP } = require('../data/plans');
  const cfg = store.getFxConfig();
  const effective = getFxRates();
  res.json({
    // what the admin explicitly saved ('' = not set, using the default)
    usdToInr: cfg.usdToInr != null && cfg.usdToInr !== '' ? cfg.usdToInr : '',
    usdToEgp: cfg.usdToEgp != null && cfg.usdToEgp !== '' ? cfg.usdToEgp : '',
    // what pricing actually uses right now, plus the fallbacks for reference
    effective,
    defaults: { usdToInr: USD_TO_INR, usdToEgp: USD_TO_EGP },
  });
});

router.post('/fx-config', requireAdmin, (req, res) => {
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
  store.setFxConfig(patch);
  const { getFxRates } = require('../data/plans');
  res.json({ ok: true, effective: getFxRates() });
});

// ---- Interests: who responded to the in-app advertisement box ----
// Each row is a contactable lead: name, email and phone as captured at the
// moment the person tapped the box's call-to-action.
router.get('/interests', requireAdmin, (req, res) => {
  const interests = store.listInterests().map(i => {
    // Fall back to the live account if an older record predates a field.
    const u = store.findUserById(i.userId) || {};
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
router.get('/ad-config', requireAdmin, (req, res) => {
  const { effectiveAd, AD_DEFAULTS } = require('./interests');
  res.json({ ad: effectiveAd(), defaults: AD_DEFAULTS, saved: store.getAdConfig() });
});

router.post('/ad-config', requireAdmin, (req, res) => {
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
  store.setAdConfig(patch);
  const { effectiveAd } = require('./interests');
  res.json({ ok: true, ad: effectiveAd() });
});

// ---- Developer section: read/edit payment gateway display fields ----
router.get('/payment-config', requireAdmin, (req, res) => {
  const cfg = store.getPaymentConfig();
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

router.post('/payment-config', requireAdmin, (req, res) => {
  const allowed = ['paypalLabel', 'paypalEmail', 'instapayLabel', 'instapayAddress', 'instapayPhone', 'upiLabel', 'upiId', 'upiPayeeName'];
  const patch = {};
  allowed.forEach((k) => {
    if (req.body && req.body[k] !== undefined) patch[k] = String(req.body[k]).slice(0, 300);
  });
  store.setPaymentConfig(patch);
  res.json({ ok: true });
});

// ---- Accounts: every approved payment, with earnings analysis ----
// Each approved proof becomes a recorded transaction: who paid, when, which
// plan, how much (shown in all three currencies), and the payment screenshot.
router.get('/accounts', requireAdmin, (req, res) => {
  const { getEffectivePlans, convert } = require('../data/plans');
  const { plans, fx } = getEffectivePlans();

  const approved = store.listAllManualProofs().filter(p => p.status === 'approved');

  const records = approved.map(p => {
    const user = store.findUserById(p.userId) || {};
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
      screenshotPath: p.screenshotPath || '',
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
