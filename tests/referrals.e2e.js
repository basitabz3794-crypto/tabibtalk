// Referrals, end to end, against a running server and the real database.
//
// This drives the actual signup route with real Firebase identities, because
// the rules that matter here — attribution, the monthly cap, a payment that
// arrives twice — only exist once records are being written. Unit tests cannot
// see any of it.
//
//   node server/index.js            (in one terminal; PORT=3199 by default here)
//   node tests/referrals.e2e.js
//
// It creates its own throwaway @e2e.invalid accounts and deletes every one of
// them, plus everything they wrote, before it exits — including when it fails.

require('dotenv').config();
const { getAuth } = require('firebase-admin/auth');
const firebase = require('../server/data/firebase');
const store = require('../server/data/store');

const BASE = process.env.E2E_BASE || 'http://localhost:3199';
const KEY = process.env.FIREBASE_API_KEY;
const INVITEES = 12;              // enough to cross the 10-a-month cap
const STAMP = Date.now();

let passed = 0, failed = 0;
const P = (label, ok, extra) => {
  if (ok) passed++; else failed++;
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label + (extra !== undefined ? '   (' + extra + ')' : ''));
};

// A browser-ish client that remembers its session cookie.
function client() {
  let cookie = '';
  return async (path, opts = {}) => {
    const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    if (cookie) headers.Cookie = cookie;
    const res = await fetch(BASE + path, Object.assign({}, opts, { headers }));
    const set = res.headers.get('set-cookie');
    if (set) cookie = String(set).split(';')[0];
    let json = null;
    try { json = JSON.parse(await res.text()); } catch (e) { /* not json */ }
    return { status: res.status, j: json };
  };
}

// Creates a throwaway identity that can actually get through signup.
//
// The server gates on the email_verified claim inside the token, so marking the
// account verified is not enough on its own — the token minted a moment earlier
// still says false. Refreshing it afterwards is what puts the claim in hand.
// Exchanges a refresh token for a fresh ID token, which is how a newly
// verified account gets a token that actually carries the verified claim.
async function refresh(refreshToken) {
  const res = await fetch('https://securetoken.googleapis.com/v1/token?key=' + KEY, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(refreshToken),
  });
  const j = await res.json();
  if (!j.id_token) throw new Error('could not refresh test token: ' + JSON.stringify(j));
  return j.id_token;
}

// Creates a throwaway identity. Unverified by default is what a real signup
// looks like the moment the form is submitted; most tests want one that can get
// through the verification gate, so `verified` is the usual choice.
async function mint(tag, verified = true) {
  const email = 'e2e-' + tag + '.' + STAMP + '@e2e.invalid';
  const res = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=' + KEY, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Test' + STAMP + '!aA', returnSecureToken: true }),
  });
  const j = await res.json();
  if (!j.idToken) throw new Error('could not create test identity: ' + JSON.stringify(j));

  const acct = { email, uid: j.localId, idToken: j.idToken, refreshToken: j.refreshToken };
  if (!verified) return acct;

  // The server gates on the email_verified claim inside the token, so marking
  // the account verified is not enough on its own — the token minted a moment
  // ago still says false. Refreshing is what puts the claim in hand.
  await firebase.setEmailVerified(acct.uid);
  acct.idToken = await refresh(acct.refreshToken);
  return acct;
}

const profile = (name, ref) => ({
  name, phone: '+10000000000', college: 'E2E Test University',
  nationality: 'Testland', grade: '1', dialect: 'eg', ref,
});

// Removes every trace of this run. Matches on the @e2e.invalid suffix only, so
// it can never reach a real account.
async function cleanup(accounts) {
  const db = firebase.database();
  const all = await store.listAllUsers();
  const mine = all.filter(u => /@e2e\.invalid$/i.test(u.email || ''));
  const ids = new Set(mine.map(u => u.id));

  for (const u of mine) {
    for (const p of ['users', 'progress', 'userNotifications', 'referrals', 'friends', 'appState']) {
      await db.ref(p + '/' + u.id).remove();
    }
  }
  for (const path of ['rewardLedger', 'referralTokens', 'manualProofs', 'devices', 'notifications', 'shares', 'feed', 'weekResults']) {
    const val = (await db.ref(path).once('value')).val() || {};
    for (const [k, r] of Object.entries(val)) {
      if (r && ids.has(r.userId)) await db.ref(path + '/' + k).remove();
    }
  }
  // Sweep the identities from Firebase Auth as well. Listed from Auth rather
  // than from this run's own array, so anything an earlier aborted run left
  // behind is cleared too. The suffix match is the only thing selecting them.
  const auth = getAuth();
  const identities = (await firebase.listAuthUsers(5000))
    .filter(u => /@e2e\.invalid$/i.test(u.email || ''));
  for (const u of identities) {
    try { await auth.deleteUser(u.uid); } catch (e) { /* already gone */ }
  }

  const left = (await store.listAllUsers()).filter(u => /@e2e\.invalid$/i.test(u.email || ''));
  const leftAuth = (await firebase.listAuthUsers(5000)).filter(u => /@e2e\.invalid$/i.test(u.email || ''));
  console.log('\ncleanup: ' + mine.length + ' accounts and ' + identities.length + ' identities removed'
    + ' (' + left.length + ' accounts, ' + leftAuth.length + ' identities left behind)');
  return left.length === 0 && leftAuth.length === 0;
}

const accounts = [];

(async () => {
  if (!KEY) throw new Error('FIREBASE_API_KEY is not set — cannot create test identities.');
  const referrals = require('../server/routes/referrals');

  console.log('creating ' + (INVITEES + 1) + ' throwaway accounts...');
  const inv = await mint('inv'); accounts.push(inv);
  const guests = [];
  for (let i = 1; i <= INVITEES; i++) { const g = await mint('n' + i); accounts.push(g); guests.push(g); }

  const INV = client();
  const me0 = (await INV('/api/auth/firebase-session', {
    method: 'POST', body: JSON.stringify({ idToken: inv.idToken, profile: profile('Inviter One') }),
  })).j;

  console.log('\n--- the invite link ---');
  let me = (await INV('/api/referrals/me?dialect=eg')).j;
  P('a link is issued', /\?ref=/.test(me.link || ''));
  P('it carries no account id', (me.link || '').indexOf(me0.id) < 0);
  P('the reward plan comes from the dialect config', !!me.rewardPlan, me.rewardPlan);
  P('the cap is reported to the user', me.monthlyCap === 10 && me.slotsLeftThisMonth === 10);
  P('a short code is offered too', (me.code || '').length >= 6, me.code);
  const token = me.link.split('ref=')[1];

  console.log('\n--- following a link ---');
  const seen = (await client()('/api/referrals/resolve/' + token)).j;
  P('shows a first name only', seen.inviterName === 'Inviter', seen.inviterName);
  P('carries the dialect it was made in', seen.dialect === 'eg');
  P('leaks no account id', JSON.stringify(seen).indexOf(me0.id) < 0);
  P('an invented token is refused', (await client()('/api/referrals/resolve/not-a-real-token')).status === 404);

  console.log('\n--- a visit is not a signup ---');
  const before = (await INV('/api/referrals/me?dialect=eg')).j.daysEarned;
  await client()('/api/referrals/resolve/' + token);
  await client()('/api/referrals/resolve/' + token);
  P('clicking the link earns nothing', (await INV('/api/referrals/me?dialect=eg')).j.daysEarned === before);

  console.log('\n--- inviting yourself ---');
  await INV('/api/auth/firebase-session', {
    method: 'POST', body: JSON.stringify({ idToken: inv.idToken, profile: profile('Inviter One', token) }),
  });
  P('is refused', !(await store.findReferralByReferred(me0.id)));

  console.log('\n--- someone joins through the link ---');
  const G1 = client();
  const g1 = (await G1('/api/auth/firebase-session', {
    method: 'POST', body: JSON.stringify({ idToken: guests[0].idToken, profile: profile('Guest One', token) }),
  })).j;
  const rec = await store.findReferralByReferred(g1.id);
  P('the referral is recorded', !!rec && rec.referrerId === me0.id);
  P('against the dialect it was made in', rec.dialect === 'eg');
  P('and stamped as rewarded', !!rec.signupRewardedAt);
  me = (await INV('/api/referrals/me?dialect=eg')).j;
  P('the inviter earns one day', me.daysEarned === 1, 'days=' + me.daysEarned);
  P('nine slots left this month', me.slotsLeftThisMonth === 9);
  const invUser = await store.findUserById(me0.id);
  P('the day is real access, not just a number', invUser.tier !== 'explorer', 'tier=' + invUser.tier);
  P('and expires about a day out', Math.abs(Date.parse(invUser.planExpiresAt) - (Date.now() + 86400000)) < 300000);

  console.log('\n--- that person signs in again ---');
  await G1('/api/auth/firebase-session', {
    method: 'POST', body: JSON.stringify({ idToken: guests[0].idToken, profile: profile('Guest One', token) }),
  });
  P('no second day is paid', (await INV('/api/referrals/me?dialect=eg')).j.daysEarned === 1);

  console.log('\n--- signing up with email and password ---');
  // The real path, and the one that used to lose the referral entirely. The
  // signup POST stops at the verification gate; the student only comes back
  // later, through a plain login that carries no profile and no link.
  const unver = await mint('unverified', false);
  accounts.push(unver);
  const U = client();
  const blocked = await U('/api/auth/firebase-session', {
    method: 'POST', body: JSON.stringify({ idToken: unver.idToken, profile: profile('Unverified One', token) }),
  });
  P('an unverified signup is held at the gate', blocked.status === 403, 'status=' + blocked.status);
  const daysBefore = (await INV('/api/referrals/me?dialect=eg')).j.daysEarned;
  const unverUser = await store.findUserByEmail(unver.email);
  P('the account exists, so nothing typed is lost', !!unverUser);
  P('but no referral is recorded yet', !(await store.findReferralByReferred(unverUser.id)));
  P('and the inviter is paid nothing', daysBefore === 1, 'days=' + daysBefore);

  // They click the link in their email, then come back and log in normally.
  await firebase.setEmailVerified(unver.uid);
  unver.idToken = await refresh(unver.refreshToken);
  const back = await U('/api/auth/firebase-session', {
    method: 'POST', body: JSON.stringify({ idToken: unver.idToken }),   // no profile, no ref
  });
  P('verifying and logging back in works', back.status === 200, 'status=' + back.status);
  P('the invite survived the round trip', !!(await store.findReferralByReferred(unverUser.id)));
  P('and the inviter is paid now', (await INV('/api/referrals/me?dialect=eg')).j.daysEarned === 2,
    'days=' + (await INV('/api/referrals/me?dialect=eg')).j.daysEarned);

  console.log('\n--- ' + INVITEES + ' people join in one month ---');
  for (let i = 1; i < INVITEES; i++) {
    await client()('/api/auth/firebase-session', {
      method: 'POST', body: JSON.stringify({ idToken: guests[i].idToken, profile: profile('Guest ' + (i + 1), token) }),
    });
  }
  me = (await INV('/api/referrals/me?dialect=eg')).j;
  P('exactly ten are rewarded', me.rewardedThisMonth === 10, 'rewarded=' + me.rewardedThisMonth);
  P('no slots remain', me.slotsLeftThisMonth === 0);
  P('but every one of the ' + (INVITEES + 1) + ' still counts as a referral',
    me.totalReferrals === INVITEES + 1, 'referrals=' + me.totalReferrals);
  P('and only ten days were paid', me.daysEarned === 10, 'days=' + me.daysEarned);

  console.log('\n--- one of them buys a plan ---');
  const payId = 'e2e-proof-' + STAMP;
  await store.createManualProof({
    id: payId, method: 'instapay', userId: g1.id, planId: 'advanced-monthly',
    dialect: 'eg', status: 'pending', submittedAt: new Date().toISOString(),
  });
  const paid = await referrals.rewardPaidReferral(g1.id, 'advanced-monthly', payId);
  P('seven days are paid', paid.granted === true && paid.days === 7, 'days=' + paid.days);
  me = (await INV('/api/referrals/me?dialect=eg')).j;
  P('seventeen days in total', me.daysEarned === 17, 'days=' + me.daysEarned);
  P('the purchase is counted separately from the cap', me.paidReferrals === 1);

  console.log('\n--- the same payment is processed twice ---');
  const again = await referrals.rewardPaidReferral(g1.id, 'advanced-monthly', payId);
  P('the second time pays nothing', again.granted === false, again.reason);
  P('the total is unchanged', (await INV('/api/referrals/me?dialect=eg')).j.daysEarned === 17);

  console.log('\n--- a free plan ---');
  const free = await referrals.rewardPaidReferral(g1.id, 'basic-monthly', 'e2e-free-' + STAMP);
  P('earns no purchase reward', free.granted === false, free.reason);

  console.log('\n--- the ledger ---');
  const ledger = await store.listRewardsFor(me0.id);
  P('one row per day granted', ledger.length === 11, ledger.length + ' rows');
  P('every row says which plan and dialect', ledger.every(r => r.planId && r.dialect));
  P('the purchase row names the payment', ledger.some(r => r.type === 'referral-paid' && r.paymentId === payId));
  P('the inviter was told', ((await INV('/api/notifications/me')).j.personal || [])
    .some(n => n.type === 'referral-reward'));
})()
  .catch(err => { failed++; console.error('\nERROR: ' + err.message + '\n' + err.stack); })
  .then(async () => {
    const clean = await cleanup(accounts);
    if (!clean) { failed++; console.log('  FAIL  cleanup left test accounts behind'); }
    console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
    process.exit(failed ? 1 : 0);
  });
