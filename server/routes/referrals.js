// Referrals.
//
// A student shares a link; when someone joins through it and finishes setting
// up their account, the inviter earns a day of subscription time. If that
// person later pays for a plan, the inviter earns seven more.
//
// Nothing here trusts the browser. The link carries an opaque token and nothing
// else — no account id, no dialect that could be edited, no reward amount. The
// token is resolved server-side, and every reward is written to the ledger
// before it is granted, which is what stops the same reward being paid twice.

const express = require('express');
const { nanoid } = require('nanoid');
const store = require('../data/store');
const rewards = require('../data/rewards');
const { normaliseDialect } = require('../data/plans');

const router = express.Router();

function requireLogin(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Please log in first.' });
  next();
}

// A token long enough that guessing one is not worth anyone's time, and opaque
// so it reveals nothing about who issued it.
function newToken() { return nanoid(22); }

// The inviter's link for one dialect, created the first time they ask for it.
// One token per dialect, so the same link can be shared again and again and the
// dialect the invite was made in travels with it.
async function tokenFor(userId, dialect) {
  const d = normaliseDialect(dialect);
  const existing = await store.findTokenForUserDialect(userId, d);
  if (existing) return existing;
  const rec = { token: newToken(), userId, dialect: d, createdAt: new Date().toISOString() };
  await store.saveReferralToken(rec.token, rec);
  return rec;
}

// How many rewarded referrals this inviter has had this calendar month.
// Counted from the ledger rather than a running total, so it cannot drift out
// of step with what was actually paid out.
async function rewardedThisMonth(userId, when) {
  const month = rewards.monthKey(when);
  const rows = await store.listRewardsFor(userId);
  return rows.filter(r =>
    r.type === 'referral-signup' && rewards.monthKey(r.createdAt) === month
  ).length;
}

// ---- Everything the invite screen needs ----
router.get('/me', requireLogin, async (req, res) => {
  try {
    const me = req.session.userId;
    const user = await store.findUserById(me);
    if (!user) return res.status(401).json({ error: 'Please log in first.' });

    const dialect = normaliseDialect(req.query.dialect || user.dialect);
    const cfg = await store.getSiteConfig();
    const tok = await tokenFor(me, dialect);

    const [mine, ledger] = await Promise.all([
      store.listReferralsBy(me),
      store.listRewardsFor(me),
    ]);

    const month = rewards.monthKey();
    const referralRows = ledger.filter(r => r.type === 'referral-signup' || r.type === 'referral-paid');
    const daysEarned = referralRows.reduce((sum, r) => sum + (Number(r.days) || 0), 0);
    const rewardedNow = referralRows.filter(r =>
      r.type === 'referral-signup' && rewards.monthKey(r.createdAt) === month).length;

    res.json({
      // The link itself. Built from the request so it is correct on any domain.
      link: (req.protocol + '://' + req.get('host') + '/login.html?ref=' + tok.token),
      // Shown alongside the link for anyone who would rather type it.
      code: tok.token.slice(0, 8).toUpperCase(),
      dialect,
      rewardPlan: rewards.rewardPlanLabel(cfg, dialect),
      signupDays: rewards.SIGNUP_REWARD_DAYS,
      paidDays: rewards.PAID_REWARD_DAYS,
      monthlyCap: rewards.MONTHLY_REWARD_CAP,
      // Attribution vs reward are reported separately on purpose: someone over
      // the cap should still see that their invites landed.
      totalReferrals: mine.length,
      rewardedThisMonth: rewardedNow,
      slotsLeftThisMonth: Math.max(0, rewards.MONTHLY_REWARD_CAP - rewardedNow),
      daysEarned,
      paidReferrals: referralRows.filter(r => r.type === 'referral-paid').length,
      history: referralRows.slice(0, 20).map(r => ({
        type: r.type, days: r.days, planId: r.planId,
        dialect: r.dialect, createdAt: r.createdAt,
      })),
    });
  } catch (err) {
    console.error('[referrals] me failed:', err.message);
    res.status(500).json({ error: 'Could not load your invite details.' });
  }
});

// ---- What a link points at ----
// Called by the signup screen so it can say who invited you. Returns only a
// first name and the dialect — never the inviter's account id.
router.get('/resolve/:token', async (req, res) => {
  const rec = await store.findReferralToken(req.params.token);
  if (!rec) return res.status(404).json({ error: 'That invite link is not valid.' });
  const inviter = await store.findUserById(rec.userId);
  if (!inviter || (inviter.status || 'active') === 'banned') {
    return res.status(404).json({ error: 'That invite link is no longer active.' });
  }
  res.json({
    ok: true,
    inviterName: ((inviter.name || '').trim().split(/\s+/)[0] || 'A student'),
    dialect: rec.dialect,
  });
});

// ---- Attribution + the signup reward ----
//
// Called once, by the signup flow, after the new account has been created AND
// its profile completed. Clicking a link does nothing on its own — this is the
// only place attribution happens, which is what stops a reward being paid for a
// visit that never became an account.
//
// Safe to call more than once: the referral is keyed by the referred account,
// and the reward is guarded by its own timestamp.
async function attributeSignup(referredUser, token) {
  if (!token || !referredUser) return { attributed: false, reason: 'no-token' };

  const tok = await store.findReferralToken(token);
  if (!tok) return { attributed: false, reason: 'unknown-token' };

  // You cannot invite yourself.
  if (tok.userId === referredUser.id) return { attributed: false, reason: 'self-referral' };

  // One attribution per account, ever. Keyed by the referred id, so a second
  // attempt finds the first and stops rather than overwriting it.
  const existing = await store.findReferralByReferred(referredUser.id);
  if (existing) return { attributed: false, reason: 'already-attributed', referral: existing };

  const inviter = await store.findUserById(tok.userId);
  if (!inviter || (inviter.status || 'active') === 'banned') {
    return { attributed: false, reason: 'inviter-unavailable' };
  }

  const now = new Date().toISOString();
  const referral = {
    id: nanoid(),
    referrerId: tok.userId,
    referredId: referredUser.id,
    token: tok.token,
    dialect: tok.dialect,
    createdAt: now,
    signupRewardedAt: null,
    paidRewardedAt: null,
  };
  await store.saveReferral(referredUser.id, referral);

  const granted = await grantReferralReward(referral, 'referral-signup', rewards.SIGNUP_REWARD_DAYS, null);
  return { attributed: true, referral, reward: granted };
}

// The one place referral days are actually paid out.
//
// Both reward kinds come through here so the cap, the ledger and the
// duplicate guard cannot be implemented twice and drift apart.
async function grantReferralReward(referral, type, days, paymentId) {
  const cfg = await store.getSiteConfig();
  const inviter = await store.findUserById(referral.referrerId);
  if (!inviter) return { granted: false, reason: 'inviter-missing' };

  // A repeated payment event finds its own earlier row and stops here. This is
  // what makes approving the same proof twice harmless.
  if (paymentId) {
    const seen = await store.findRewardByPayment(paymentId);
    if (seen) return { granted: false, reason: 'already-rewarded-for-payment' };
  }

  // Each referral pays each kind of reward at most once.
  const stamp = type === 'referral-paid' ? 'paidRewardedAt' : 'signupRewardedAt';
  const current = await store.findReferralByReferred(referral.referredId);
  if (current && current[stamp]) return { granted: false, reason: 'already-rewarded' };

  // The monthly cap applies to signup rewards. Attribution above the cap is
  // still recorded — only the days stop — so nobody loses credit for inviting.
  if (type === 'referral-signup') {
    const used = await rewardedThisMonth(referral.referrerId);
    if (used >= rewards.MONTHLY_REWARD_CAP) {
      await store.patchReferral(referral.referredId, { cappedAt: new Date().toISOString() });
      return { granted: false, reason: 'monthly-cap-reached', cap: rewards.MONTHLY_REWARD_CAP };
    }
  }

  const planId = rewards.rewardPlanFor(cfg, referral.dialect);
  const patch = rewards.extendPatch(inviter, referral.dialect, days, planId, cfg);

  // Lifetime holders have nothing to extend. The referral is still recorded and
  // still counts; there is simply no time to add.
  if (!patch) {
    await store.patchReferral(referral.referredId, { [stamp]: new Date().toISOString() });
    return { granted: false, reason: 'lifetime-nothing-to-extend' };
  }

  const row = rewards.ledgerRow({
    userId: referral.referrerId,
    type, days, planId,
    dialect: referral.dialect,
    source: type === 'referral-paid' ? 'referred user purchased a plan' : 'referred user completed signup',
    referralId: referral.id,
    referrerId: referral.referrerId,
    referredId: referral.referredId,
    paymentId: paymentId || null,
  });

  // Ledger first, then the grant. If the process died between the two the worst
  // case is a recorded reward that was not applied — visible and fixable —
  // rather than time granted with no record, which would be invisible.
  await store.addRewardLedger(row);
  await store.updateUser(referral.referrerId, patch);
  await store.patchReferral(referral.referredId, { [stamp]: new Date().toISOString() });

  // Tell the inviter, using the bell they already have.
  await store.addUserNotification(referral.referrerId, {
    id: nanoid(),
    type: 'referral-reward',
    title: days + ' day' + (days === 1 ? '' : 's') + ' added to your subscription',
    body: type === 'referral-paid'
      ? 'Someone you invited upgraded to a paid plan.'
      : 'Someone you invited finished setting up their account.',
    createdAt: new Date().toISOString(), readAt: null, actioned: null,
  });

  return { granted: true, days, planId, ledgerId: row.id };
}

// Called when a payment is approved, for the buyer. Does nothing unless that
// buyer arrived through a referral and the plan they bought is a paid one.
async function rewardPaidReferral(buyerId, planId, paymentId) {
  if (!rewards.isPaidPlan(planId)) return { granted: false, reason: 'not-a-paid-plan' };
  const referral = await store.findReferralByReferred(buyerId);
  if (!referral) return { granted: false, reason: 'not-referred' };
  return grantReferralReward(referral, 'referral-paid', rewards.PAID_REWARD_DAYS, paymentId);
}

module.exports = router;
module.exports.attributeSignup = attributeSignup;
module.exports.rewardPaidReferral = rewardPaidReferral;
module.exports.tokenFor = tokenFor;
module.exports.rewardedThisMonth = rewardedThisMonth;
