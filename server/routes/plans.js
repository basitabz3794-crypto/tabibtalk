const express = require('express');
const { getEffectivePlans, computeExpiry, accessTierForPlan } = require('../data/plans');
const store = require('../data/store');

const router = express.Router();

function requireLogin(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Please log in first.' });
  next();
}

// ---- Public plan list (safe to expose to the frontend) ----
// Reflects any live overrides set by the admin's Developer section.
router.get('/config', async (req, res) => {
  const { plans } = await getEffectivePlans();
  res.json({ plans });
});

// ---- Subscribe to the free Basic plan (new-plans mode) ----
// One click on the plans page: activates the Basic subscription server-side,
// which is what lets "Open Website" go straight in from then on. Guarded so
// it can't be used to dodge payment: it only works while the new plan
// structure is live AND Basic's current price really is 0 (the admin can
// price Basic later, at which point this endpoint refuses and the normal
// payment flow applies).
router.post('/subscribe-basic', requireLogin, async (req, res) => {
  const cfg = await store.getSiteConfig();
  if (cfg.newPlans !== true || cfg.plansEnabled === false) {
    return res.status(400).json({ error: 'The Basic plan is not available right now.' });
  }
  const { plans } = await getEffectivePlans();
  const basic = plans['basic-monthly'];
  if (!basic || Number(basic.priceNow) !== 0) {
    return res.status(400).json({ error: 'The Basic plan is a paid plan now — please use the payment options on this page.' });
  }
  const user = await store.findUserById(req.session.userId);
  if (!user) return res.status(404).json({ error: 'Account not found.' });
  // Never DOWNGRADE anyone by accident: paid tiers keep what they paid for.
  if (['advanced', 'professional', 'lifetime', 'student'].includes(user.tier)) {
    return res.json({ ok: true, tier: user.tier, note: 'You already have a higher plan.' });
  }
  const activatedAt = new Date().toISOString();
  await store.updateUser(user.id, {
    tier: accessTierForPlan('basic-monthly'),
    planId: 'basic-monthly',
    planActivatedAt: activatedAt,
    planExpiresAt: await computeExpiry('basic-monthly', activatedAt), // null while free
    subStatus: 'active',
  });
  res.json({ ok: true, tier: 'basic' });
});

module.exports = router;
