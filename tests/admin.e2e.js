// Administrative grants, end to end: giving somebody days by hand, extending a
// subscription, and the trail both leave behind.
//
//   node tests/admin.e2e.js
//
// Creates its own throwaway @e2e.invalid accounts and removes them all before
// it exits, including when it fails.

const h = require('./helpers');
const { P, state, section } = h.recorder();
const store = h.store;
const STAMP = Date.now();
const KEY = process.env.ADMIN_KEY;
const DAY = 86400000;

const admin = async (path, opts = {}) => {
  const headers = Object.assign({ 'Content-Type': 'application/json', 'x-admin-key': KEY }, opts.headers || {});
  const res = await fetch(h.BASE + '/api/admin' + path, Object.assign({}, opts, { headers }));
  let j = null;
  try { j = JSON.parse(await res.text()); } catch (e) { /* not json */ }
  return { status: res.status, j };
};
const act = (id, body) => admin('/users/' + id + '/action', { method: 'POST', body: JSON.stringify(body) });
const expiryOf = async (id, d) => {
  const u = await store.findUserById(id);
  const ent = (u.entitlements || {})[d || 'eg'] || {};
  return ent.planExpiresAt ? Date.parse(ent.planExpiresAt) : null;
};

(async () => {
  if (!KEY) throw new Error('ADMIN_KEY is not set — cannot exercise the admin routes.');

  console.log('creating 3 throwaway accounts...');
  const [aA, bA, cA] = await Promise.all([h.mint('ad1', STAMP), h.mint('ad2', STAMP), h.mint('ad3', STAMP)]);
  const A = await h.signIn(aA, 'Gifted Student');
  const B = await h.signIn(bA, 'Paying Student');
  const C = await h.signIn(cA, 'Lifetime Student');

  section('the door');
  P('no key, no entry', (await fetch(h.BASE + '/api/admin/referrals')).status === 403);
  P('a wrong key is refused',
    (await fetch(h.BASE + '/api/admin/referrals', { headers: { 'x-admin-key': 'not-the-key' } })).status === 403);

  section('giving days to somebody with nothing');
  let r = await act(A.user.id, { action: 'gift', days: 5, dialect: 'eg', reason: 'Helped test the app' });
  P('the gift is accepted', r.status === 200 && r.j.ok === true, 'status=' + r.status);
  let end = await expiryOf(A.user.id);
  P('five days from today', Math.abs(end - (Date.now() + 5 * DAY)) < 120000);
  let fresh = await store.findUserById(A.user.id);
  P('and it is real access, not just a date', fresh.tier !== 'explorer' && fresh.tier !== 'basic', 'tier=' + fresh.tier);

  section('the gift is on the record');
  let led = await store.listRewardsFor(A.user.id);
  const gift = led.find(l => l.type === 'admin-gift');
  P('a ledger row was written', !!gift);
  P('it says how many days', gift && gift.days === 5);
  P('it names the administrator', !!(gift && gift.adminId));
  P('it keeps the reason typed at the time', gift && gift.reason === 'Helped test the app');
  P('it says which dialect', gift && gift.dialect === 'eg');
  P('the student was told', ((await A.call('/api/notifications/me')).j.personal || [])
    .some(n => n.type === 'admin-gift'));

  section('giving days to somebody who already has time');
  await act(B.user.id, { action: 'activate', planId: 'advanced-monthly', dialect: 'eg' });
  const before = await expiryOf(B.user.id);
  await act(B.user.id, { action: 'gift', days: 7, dialect: 'eg', reason: 'Apology for downtime' });
  const after = await expiryOf(B.user.id);
  P('the days are added on top', Math.abs(after - (before + 7 * DAY)) < 120000,
    'moved ' + Math.round((after - before) / DAY) + ' days');
  P('paid time is never truncated', after > before);

  section('a gift must not be a downgrade');
  const tierBefore = (await store.findUserById(B.user.id)).tier;
  await act(B.user.id, { action: 'gift', days: 1, dialect: 'eg', planId: 'student-monthly' });
  P('a lesser plan does not knock them down',
    (await store.findUserById(B.user.id)).tier === tierBefore, 'tier=' + (await store.findUserById(B.user.id)).tier);

  section('lifetime');
  await act(C.user.id, { action: 'activate', planId: 'lifetime', dialect: 'eg' });
  r = await act(C.user.id, { action: 'gift', days: 30, dialect: 'eg' });
  P('there is nothing to extend, and it says so', r.status === 400, 'status=' + r.status);
  P('the message explains why', /lifetime/i.test((r.j || {}).error || ''), (r.j || {}).error);

  section('nonsense is refused');
  P('zero days', (await act(A.user.id, { action: 'gift', days: 0 })).status === 400);
  P('ten years of days', (await act(A.user.id, { action: 'gift', days: 99999 })).status === 400);
  P('an unknown student', (await act('no-such-user', { action: 'gift', days: 1 })).status === 404);

  section('extending a subscription by hand');
  const beforeExt = await expiryOf(B.user.id);
  await act(B.user.id, { action: 'extend', days: 3, dialect: 'eg', reason: 'Goodwill' });
  P('the expiry moves out by three days',
    Math.abs((await expiryOf(B.user.id)) - (beforeExt + 3 * DAY)) < 120000);
  let bells = (await B.call('/api/notifications/me')).j.personal || [];
  P('the student is told it was extended', bells.some(n => n.type === 'admin-extend'));
  P('the message says how many days', bells.some(n => n.type === 'admin-extend' && /3 days/.test(n.title || '')));
  P('and carries the reason', bells.some(n => n.type === 'admin-extend' && n.body === 'Goodwill'));

  await act(B.user.id, { action: 'reduce', days: 1, dialect: 'eg', reason: 'Correcting an error' });
  bells = (await B.call('/api/notifications/me')).j.personal || [];
  P('a reduction is not announced', !bells.some(n => /reduc|shorten|removed/i.test(n.title || '')));
  P('but it is still on the audit trail',
    ((await admin('/audit?userId=' + B.user.id)).j.entries || []).some(e => e.action === 'reduce' && e.days === -1));

  section('the audit trail');
  const trail = (await admin('/audit?userId=' + B.user.id)).j;
  const entries = (trail || {}).entries || [];
  P('the extension was recorded', entries.some(e => e.action === 'extend'));
  const ext = entries.find(e => e.action === 'extend');
  P('it says who', !!(ext && ext.adminId));
  P('it says when', !!(ext && ext.createdAt));
  P('it says how many days', ext && ext.days === 3);
  P('it keeps the reason', ext && ext.reason === 'Goodwill');
  P('it records the expiry before', !!(ext && ext.previousExpiry));
  P('and the expiry after', !!(ext && ext.newExpiry));
  P('which really did move', ext && Date.parse(ext.newExpiry) > Date.parse(ext.previousExpiry));
  P('the gift was recorded too', entries.length >= 1
    && ((await admin('/audit?userId=' + A.user.id)).j.entries || []).some(e => e.action === 'gift'));
  P('naming the dialect it applied to',
    ((await admin('/audit?userId=' + A.user.id)).j.entries || []).every(e => e.dialect));

  section('what the hub can see about referrals');
  const overview = (await admin('/referrals')).j;
  P('an overview loads', !!overview && Array.isArray(overview.inviters));
  P('with totals', !!(overview.totals && typeof overview.totals.referrals === 'number'));
  P('gifted days are counted separately from earned ones',
    overview.totals.giftedDays >= 5, 'gifted=' + overview.totals.giftedDays);
  P('the rules are reported rather than assumed',
    overview.monthlyCap === 10 && overview.signupDays === 1 && overview.paidDays === 7);

  const one = (await admin('/users/' + A.user.id + '/referrals')).j;
  P('one student can be looked at on their own', !!one && Array.isArray(one.invited));
  P('their gifted days show', one.daysGifted === 5, 'gifted=' + one.daysGifted);
  P('their ledger is readable', (one.ledger || []).some(l => l.type === 'admin-gift'));
  P('the reason travels with it', (one.ledger || []).some(l => l.reason === 'Helped test the app'));
})()
  .catch(err => { state.failed++; console.error('\nERROR: ' + err.message + '\n' + err.stack); })
  .then(async () => {
    if (!(await h.cleanup())) { state.failed++; console.log('  FAIL  cleanup left test accounts behind'); }
    console.log('\n' + state.passed + ' passed, ' + state.failed + ' failed\n');
    process.exit(state.failed ? 1 : 0);
  });
