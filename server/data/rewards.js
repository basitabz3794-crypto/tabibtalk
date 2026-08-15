// Subscription rewards: referral days, admin gifts and manual extensions.
//
// Everything that adds subscription time to an account goes through this file,
// for two reasons. First, so "which plan is a reward worth?" is answered in one
// place rather than guessed at by each caller. Second, so every grant leaves a
// ledger entry — which is what makes duplicate rewards detectable instead of
// silently doubling someone's access.

const { nanoid } = require('nanoid');
const {
  PLANS, accessTierForPlan, configForDialect, normaliseDialect, isExpired,
} = require('./plans');
const entitlements = require('./entitlements');

// ---- Which plan a reward is paid in ----
//
// Deliberately derived from the dialect's live configuration rather than named
// anywhere. A dialect running the Basic/Advanced page rewards in Advanced; one
// running the classic page rewards in Student. Switch a dialect's page in the
// admin hub and its rewards follow, with nothing to remember and nothing to
// edit here.
function rewardPlanFor(siteConfig, dialect) {
  const cfg = configForDialect(siteConfig, dialect);
  return cfg.newPlans === true ? 'advanced-monthly' : 'student-monthly';
}

// A human label for the plan a reward will be paid in, for the invite screen.
function rewardPlanLabel(siteConfig, dialect) {
  const id = rewardPlanFor(siteConfig, dialect);
  return (PLANS[id] && PLANS[id].name) || 'Advanced';
}

// ---- Adding days to an account ----
//
// Days are added to the entitlement for ONE dialect, matching how every
// purchase already works: access bought (or earned) for Egyptian is Egyptian's.
//
// Extending is done from whichever is later — now, or the current expiry — so a
// reward given to someone who already has time left adds to it instead of
// truncating it. Lifetime is never touched: there is nothing to extend, and
// overwriting it would be a downgrade.
function extendPatch(user, dialect, days, planId, siteConfig) {
  const d = normaliseDialect(dialect);
  const current = entitlements.forDialect(user, d, siteConfig);

  if (current.tier === 'lifetime') return null;   // nothing to add to

  const now = Date.now();
  const currentEnd = current.planExpiresAt ? Date.parse(current.planExpiresAt) : 0;
  const base = (currentEnd && currentEnd > now && !isExpired(current.planExpiresAt)) ? currentEnd : now;
  const newEnd = new Date(base + days * 86400000).toISOString();

  // A reward tops up whatever they already hold if it is the same or better;
  // otherwise it grants the reward plan itself. This stops a 1-day Student
  // reward from knocking somebody down off Advanced.
  const currentRank = TIER_RANK[current.tier] || 0;
  const rewardRank = TIER_RANK[accessTierForPlan(planId)] || 0;
  const keepExisting = currentRank >= rewardRank && currentEnd > now;

  const effectivePlan = keepExisting ? (current.planId || planId) : planId;

  return entitlements.grant(user, d, {
    tier: accessTierForPlan(effectivePlan),
    planId: effectivePlan,
    planActivatedAt: current.planActivatedAt || new Date().toISOString(),
    planExpiresAt: newEnd,
    subStatus: 'active',
  }, siteConfig);
}

// Ordering used only to decide whether a reward would be a downgrade.
const TIER_RANK = {
  explorer: 0, basic: 1, student: 2, advanced: 3, professional: 3, lifetime: 4,
};

// ---- The ledger ----
//
// One row per grant, ever. Nothing here is derived or recomputed: this is the
// record of what was actually given, who to, why, and on whose authority. It is
// also what makes a duplicate detectable — a payment that arrives twice finds
// its own earlier row and stops.
function ledgerRow(fields) {
  return Object.assign({
    id: nanoid(),
    createdAt: new Date().toISOString(),
    userId: null,          // who received the days
    type: null,            // referral-signup | referral-paid | admin-gift | admin-extend
    days: 0,
    planId: null,
    dialect: null,
    source: null,          // free text describing where it came from
    referralId: null,
    referrerId: null,
    referredId: null,
    paymentId: null,       // set for paid-referral rewards, and unique per payment
    adminId: null,         // set when an administrator did it by hand
    reason: null,
  }, fields);
}

// The calendar month a reward counts against, in UTC so it cannot shift with
// whoever happens to be looking.
function monthKey(when) {
  const d = when ? new Date(when) : new Date();
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
}

// How many rewarded referrals one inviter may earn in a calendar month.
// Attribution above this still happens — only the reward stops.
const MONTHLY_REWARD_CAP = 10;

// What each kind of referral is worth.
const SIGNUP_REWARD_DAYS = 1;
const PAID_REWARD_DAYS = 7;

// Which plans count as "they paid for something real", and so earn the larger
// reward. Read from the plan table rather than listed by name, so a plan added
// later is included automatically if it grants a paid tier.
function isPaidPlan(planId) {
  const tier = accessTierForPlan(planId);
  return ['student', 'professional', 'advanced', 'lifetime'].indexOf(tier) >= 0;
}

module.exports = {
  rewardPlanFor, rewardPlanLabel,
  extendPatch, ledgerRow, monthKey, isPaidPlan,
  MONTHLY_REWARD_CAP, SIGNUP_REWARD_DAYS, PAID_REWARD_DAYS,
  TIER_RANK,
};
