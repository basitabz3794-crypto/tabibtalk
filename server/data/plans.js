// Single source of truth for plans. The access-control middleware and every
// payment method (InstaPay, UPI, PayPal) read plan names/prices from here,
// so pricing/tier changes only need to happen in one place.
//
// Each paid plan carries:
//   - launch/regular price + billing period (shown on the pricing page)
//   - accessTier: which access level it grants once activated. Every billing
//     variant of Student maps to accessTier 'student'; every Professional
//     variant and Lifetime map to a full-access tier. This keeps access
//     control correct no matter which billing period the user chose.

// Reference FX rates (mid-July 2026, rounded for display). These are only the
// FALLBACK: the admin can override them live from the Developer section
// ("Live plan configuration" -> currency conversion rates), which writes to
// store.fxConfig. getFxRates() below merges the two.
const USD_TO_INR = 95.5;
const USD_TO_EGP = 49.6;
const REF_RATES = { usdToInr: USD_TO_INR, usdToEgp: USD_TO_EGP };

// Resolves the effective rates: admin-configured values win, but only when they
// are real positive numbers — a blank or junk value falls back to the reference
// rate rather than silently pricing everything at 0.
async function getFxRates() {
  const store = require('./store');
  let cfg = {};
  try { cfg = (await store.getFxConfig()) || {}; } catch (e) { cfg = {}; }
  const inr = Number(cfg.usdToInr);
  const egp = Number(cfg.usdToEgp);
  return {
    usdToInr: Number.isFinite(inr) && inr > 0 ? inr : USD_TO_INR,
    usdToEgp: Number.isFinite(egp) && egp > 0 ? egp : USD_TO_EGP,
  };
}

// Converted prices are rounded UP to a clean nearby number, so users never see
// an awkward figure like ₹478 or E£4,910 — they see ₹480 and E£4,950 instead.
// Rounding up (never down) also means the displayed price never undercuts the
// real USD amount. Step scales with magnitude so big numbers stay tidy.
function roundUpNice(n) {
  if (!n || n <= 0) return 0;
  const step = n < 1000 ? 10 : 50;
  return Math.ceil(n / step) * step;
}

// `rates` is REQUIRED when calling this outside an async context (e.g. the PLANS
// table below): getFxRates() now hits the network, so there is no synchronous
// fallback. Pass a pre-resolved getFxRates() result when converting in a loop.
function convert(usd, rates) {
  const fx = rates || REF_RATES;
  return {
    usd,
    inr: roundUpNice(usd * fx.usdToInr),
    egp: roundUpNice(usd * fx.usdToEgp),
  };
}

const PLANS = {
  explorer: {
    id: 'explorer', name: 'Explorer', audience: 'explorer',
    price: 'Free', billing: null, priceNow: 0, priceWas: 0,
    accessTier: 'explorer',
  },

  // ---- Student (launch pricing — no comparison to a prior "standard" price) ----
  'student-monthly': {
    id: 'student-monthly', name: 'Student', audience: 'student',
    billing: 'monthly', period: '1 month', priceWas: 5, priceNow: 5, ...convert(5, REF_RATES),
    offerNote: 'launch price', accessTier: 'student',
  },
  'student-6m': {
    id: 'student-6m', name: 'Student', audience: 'student',
    billing: 'six_month', period: '6 months', priceWas: 30, priceNow: 30, ...convert(30, REF_RATES),
    offerNote: 'launch price', accessTier: 'student',
  },
  'student-12m': {
    id: 'student-12m', name: 'Student', audience: 'student',
    billing: 'yearly', period: '12 months', priceWas: 50, priceNow: 50, ...convert(50, REF_RATES),
    offerNote: 'launch price', accessTier: 'student',
  },

  // ---- Professional (launch pricing) ----
  'professional-monthly': {
    id: 'professional-monthly', name: 'Professional', audience: 'professional',
    billing: 'monthly', period: '1 month', priceWas: 10, priceNow: 10, ...convert(10, REF_RATES),
    offerNote: 'launch price', accessTier: 'professional',
  },
  'professional-6m': {
    id: 'professional-6m', name: 'Professional', audience: 'professional',
    billing: 'six_month', period: '6 months', priceWas: 45, priceNow: 45, ...convert(45, REF_RATES),
    offerNote: 'launch price', accessTier: 'professional',
  },
  'professional-yearly': {
    id: 'professional-yearly', name: 'Professional', audience: 'professional',
    billing: 'yearly', period: '12 months', priceWas: 70, priceNow: 70, ...convert(70, REF_RATES),
    offerNote: 'launch price', accessTier: 'professional',
  },

  // ---- Lifetime (launch pricing) ----
  lifetime: {
    id: 'lifetime', name: 'Lifetime', audience: 'lifetime',
    billing: 'one_time', period: 'one-time', priceWas: 99, priceNow: 99, ...convert(99, REF_RATES),
    offerNote: 'pay once, yours forever', accessTier: 'lifetime',
  },
};

// Access tiers that unlock full content (mirrors isLocked() logic in the app).
const FULL_ACCESS_TIERS = ['professional', 'lifetime'];

function isFullAccess(tier) {
  return FULL_ACCESS_TIERS.includes(tier);
}

// Given any plan id, return the access tier it grants (defaults to explorer).
function accessTierForPlan(planId) {
  const plan = PLANS[planId];
  return plan ? plan.accessTier : 'explorer';
}

// How many days each plan lasts from activation. Lifetime never expires (null).
const PLAN_DURATION_DAYS = {
  'student-monthly': 30, 'student-6m': 180, 'student-12m': 365,
  'professional-monthly': 30, 'professional-6m': 180, 'professional-yearly': 365,
  'lifetime': null, 'explorer': null,
};

// Compute an ISO expiry date from an activation date + plan id (null = never expires).
// Respects any admin override set in the Developer section (overridden days win).
async function computeExpiry(planId, activatedAtISO) {
  const store = require('./store');
  const overrides = await store.getPlanOverrides();
  const ov = overrides[planId];
  const days = (ov && ov.days != null) ? ov.days : PLAN_DURATION_DAYS[planId];
  if (days == null) return null; // lifetime / explorer: no expiry
  const start = new Date(activatedAtISO || Date.now());
  return new Date(start.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

// Is a subscription expired as of now?
function isExpired(expiresAtISO) {
  if (!expiresAtISO) return false; // no expiry set = not expired
  return new Date(expiresAtISO).getTime() < Date.now();
}

// Merges the base PLANS with any live admin overrides (Developer section):
// price and/or duration can be changed without a deploy. Used by both the
// public /api/plans/config endpoint and the admin Developer panel itself.
async function getEffectivePlans() {
  const store = require('./store');
  const overrides = await store.getPlanOverrides();
  const fx = await getFxRates(); // resolved once, reused for every plan below
  const plans = {};
  const durationsDays = {};
  Object.keys(PLANS).forEach((id) => {
    const base = PLANS[id];
    const ov = overrides[id] || {};
    const priceNow = ov.priceNow != null ? ov.priceNow : base.priceNow;
    const days = ov.days != null ? ov.days : PLAN_DURATION_DAYS[id];
    const offerNote = (ov.label != null && ov.label !== '') ? ov.label : base.offerNote;
    durationsDays[id] = days;
    plans[id] = {
      ...base,
      priceNow,
      priceWas: priceNow, // launch pricing has no "was" comparison
      offerNote,
      ...convert(priceNow, fx),
    };
  });
  return { plans, durationsDays, fx };
}

module.exports = { PLANS, getFxRates, FULL_ACCESS_TIERS, isFullAccess, accessTierForPlan, PLAN_DURATION_DAYS, computeExpiry, isExpired, convert, roundUpNice, USD_TO_INR, USD_TO_EGP, getEffectivePlans };
