// Reward rules — the arithmetic and the policy, with no network involved.
//
// These are the rules that decide how much subscription time an account gets
// and in which plan. They run in a second and need nothing configured, so they
// can be run before every deploy. The live end-to-end behaviour (attribution,
// caps, idempotent payments) is covered separately in referrals.e2e.js.

const assert = require('assert');
const rewards = require('../server/data/rewards');
const entitlements = require('../server/data/entitlements');

let passed = 0, failed = 0;
function t(label, fn) {
  try { fn(); passed++; console.log('  PASS  ' + label); }
  catch (e) { failed++; console.log('  FAIL  ' + label + '\n          ' + e.message); }
}

const DAY = 86400000;
// Egyptian runs the Basic/Advanced page; Hejazi is left on the classic one.
const CFG = { newPlans: true, dialects: { hejazi: { newPlans: false } } };
const iso = ms => new Date(ms).toISOString();
const userWith = (dialect, ent) => ({ id: 'u1', dialect, entitlements: { [dialect]: ent } });

console.log('\n--- which plan a reward is paid in ---');
t('a Basic/Advanced dialect rewards in Advanced', () => {
  assert.strictEqual(rewards.rewardPlanFor(CFG, 'eg'), 'advanced-monthly');
});
t('a classic dialect rewards in Student', () => {
  assert.strictEqual(rewards.rewardPlanFor(CFG, 'hejazi'), 'student-monthly');
});
t('the plan is never hard-coded — it follows the config', () => {
  const flipped = { newPlans: false, dialects: { hejazi: { newPlans: true } } };
  assert.strictEqual(rewards.rewardPlanFor(flipped, 'eg'), 'student-monthly');
  assert.strictEqual(rewards.rewardPlanFor(flipped, 'hejazi'), 'advanced-monthly');
});
t('a label is offered for the invite screen', () => {
  assert.ok(rewards.rewardPlanLabel(CFG, 'eg').length > 0);
});

console.log('\n--- adding days ---');
t('someone with nothing gets the reward plan from today', () => {
  const p = rewards.extendPatch(userWith('eg', {}), 'eg', 1, 'advanced-monthly', CFG);
  const got = entitlements.forDialect({ entitlements: p.entitlements }, 'eg', CFG);
  assert.strictEqual(got.tier, 'advanced');
  assert.ok(Math.abs(Date.parse(got.planExpiresAt) - (Date.now() + DAY)) < 5000);
});
t('time is added on top of time already held, not instead of it', () => {
  const end = Date.now() + 30 * DAY;
  const u = userWith('eg', { tier: 'advanced', planId: 'advanced-monthly', planExpiresAt: iso(end), subStatus: 'active' });
  const p = rewards.extendPatch(u, 'eg', 7, 'advanced-monthly', CFG);
  const got = entitlements.forDialect({ entitlements: p.entitlements }, 'eg', CFG);
  assert.ok(Math.abs(Date.parse(got.planExpiresAt) - (end + 7 * DAY)) < 5000,
    'expected 37 days out, got ' + got.planExpiresAt);
});
t('an expired subscription restarts from today rather than the past', () => {
  const u = userWith('eg', { tier: 'advanced', planId: 'advanced-monthly', planExpiresAt: iso(Date.now() - 40 * DAY) });
  const p = rewards.extendPatch(u, 'eg', 1, 'advanced-monthly', CFG);
  const got = entitlements.forDialect({ entitlements: p.entitlements }, 'eg', CFG);
  assert.ok(Date.parse(got.planExpiresAt) > Date.now(), 'reward landed in the past');
  assert.ok(Math.abs(Date.parse(got.planExpiresAt) - (Date.now() + DAY)) < 5000);
});
t('a reward never knocks someone down a tier', () => {
  // Holds Advanced; the reward is only worth Student. Keep Advanced, add the day.
  const end = Date.now() + 10 * DAY;
  const u = userWith('eg', { tier: 'advanced', planId: 'advanced-monthly', planExpiresAt: iso(end), subStatus: 'active' });
  const p = rewards.extendPatch(u, 'eg', 1, 'student-monthly', CFG);
  const got = entitlements.forDialect({ entitlements: p.entitlements }, 'eg', CFG);
  assert.strictEqual(got.tier, 'advanced', 'was downgraded to ' + got.tier);
  assert.ok(Math.abs(Date.parse(got.planExpiresAt) - (end + DAY)) < 5000);
});
t('a reward does upgrade someone holding less', () => {
  const end = Date.now() + 10 * DAY;
  const u = userWith('eg', { tier: 'basic', planId: 'basic-monthly', planExpiresAt: iso(end), subStatus: 'active' });
  const p = rewards.extendPatch(u, 'eg', 1, 'advanced-monthly', CFG);
  const got = entitlements.forDialect({ entitlements: p.entitlements }, 'eg', CFG);
  assert.strictEqual(got.tier, 'advanced');
});
t('lifetime is left alone — there is nothing to extend', () => {
  const u = userWith('eg', { tier: 'lifetime', planId: 'lifetime', planExpiresAt: null });
  assert.strictEqual(rewards.extendPatch(u, 'eg', 7, 'advanced-monthly', CFG), null);
});
t('days land on the dialect they were earned in, and no other', () => {
  const u = { id: 'u1', dialect: 'eg', entitlements: {} };
  const p = rewards.extendPatch(u, 'hejazi', 5, 'student-monthly', CFG);
  const merged = { entitlements: p.entitlements };
  assert.ok(entitlements.forDialect(merged, 'hejazi', CFG).planExpiresAt, 'hejazi got nothing');
  const eg = entitlements.forDialect(merged, 'eg', CFG);
  assert.ok(!eg.planExpiresAt || eg.tier === 'explorer', 'egyptian was touched');
});

console.log('\n--- what each referral is worth ---');
t('finishing signup is worth one day', () => assert.strictEqual(rewards.SIGNUP_REWARD_DAYS, 1));
t('a purchase is worth seven days', () => assert.strictEqual(rewards.PAID_REWARD_DAYS, 7));
t('ten rewarded referrals a month', () => assert.strictEqual(rewards.MONTHLY_REWARD_CAP, 10));

console.log('\n--- which purchases earn the larger reward ---');
t('Advanced, Student, Professional and Lifetime all count', () => {
  ['advanced-monthly', 'student-monthly', 'professional-monthly', 'lifetime']
    .forEach(p => assert.ok(rewards.isPaidPlan(p), p + ' should count'));
});
t('Basic does not count', () => assert.ok(!rewards.isPaidPlan('basic-monthly')));
t('an unknown plan does not count', () => assert.ok(!rewards.isPaidPlan('nonsense')));

console.log('\n--- the month a reward counts against ---');
t('months are UTC, so they do not shift with the reader', () => {
  assert.strictEqual(rewards.monthKey('2026-03-31T23:30:00.000Z'), '2026-03');
  assert.strictEqual(rewards.monthKey('2026-04-01T00:30:00.000Z'), '2026-04');
});
t('single-digit months are padded so keys sort', () => {
  assert.strictEqual(rewards.monthKey('2026-07-15T00:00:00.000Z'), '2026-07');
});

console.log('\n--- the ledger row ---');
t('every row carries an id and a timestamp', () => {
  const r = rewards.ledgerRow({ userId: 'u1', type: 'referral-signup', days: 1 });
  assert.ok(r.id && r.createdAt);
});
t('rows have a slot for whatever made them, so a duplicate is detectable', () => {
  const r = rewards.ledgerRow({});
  ['paymentId', 'referralId', 'adminId', 'reason', 'dialect', 'planId'].forEach(
    k => assert.ok(k in r, 'missing ' + k));
});
t('two rows never share an id', () => {
  assert.notStrictEqual(rewards.ledgerRow({}).id, rewards.ledgerRow({}).id);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
process.exit(failed ? 1 : 0);
