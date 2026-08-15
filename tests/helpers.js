// Shared plumbing for the end-to-end tests.
//
// These drive the real server against the real database, so everything here
// exists to make that safe: throwaway identities on an @e2e.invalid domain that
// can never be a real student's address, and a cleanup that selects on nothing
// but that suffix.

require('dotenv').config();
const { getAuth } = require('firebase-admin/auth');
const firebase = require('../server/data/firebase');
const store = require('../server/data/store');

const BASE = process.env.E2E_BASE || 'http://localhost:3199';
const KEY = process.env.FIREBASE_API_KEY;

// A browser-ish client that remembers its session cookie, so several of these
// can be held at once to act as different students.
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

async function refresh(refreshToken) {
  const res = await fetch('https://securetoken.googleapis.com/v1/token?key=' + KEY, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(refreshToken),
  });
  const j = await res.json();
  if (!j.id_token) throw new Error('could not refresh test token: ' + JSON.stringify(j));
  return j.id_token;
}

// Creates a throwaway identity. Unverified is what a real signup looks like the
// moment the form is submitted; most tests want one that can get through the
// verification gate, so `verified` is the usual choice.
//
// The server gates on the email_verified claim inside the token, so marking the
// account verified is not enough on its own — the token minted a moment ago
// still says false. Refreshing is what puts the claim in hand.
async function mint(tag, stamp, verified = true) {
  if (!KEY) throw new Error('FIREBASE_API_KEY is not set — cannot create test identities.');
  const email = 'e2e-' + tag + '.' + stamp + '@e2e.invalid';
  const res = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=' + KEY, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Test' + stamp + '!aA', returnSecureToken: true }),
  });
  const j = await res.json();
  if (!j.idToken) throw new Error('could not create test identity: ' + JSON.stringify(j));

  const acct = { email, uid: j.localId, idToken: j.idToken, refreshToken: j.refreshToken };
  if (!verified) return acct;
  await firebase.setEmailVerified(acct.uid);
  acct.idToken = await refresh(acct.refreshToken);
  return acct;
}

const profile = (name, extra) => Object.assign({
  name, phone: '+10000000000', college: 'E2E Test University',
  nationality: 'Testland', grade: '1', dialect: 'eg',
}, extra || {});

// Signs a minted identity in and returns { call, user } — the client to act
// through, and the account record the server created.
async function signIn(account, name, extra) {
  const call = client();
  const res = await call('/api/auth/firebase-session', {
    method: 'POST', body: JSON.stringify({ idToken: account.idToken, profile: profile(name, extra) }),
  });
  return { call, user: res.j, status: res.status };
}

// Removes every trace of the test accounts. Selects on the @e2e.invalid suffix
// and nothing else, so it can never reach a real student. Listed from the
// database rather than from the caller's own array, so anything an earlier
// aborted run left behind is cleared too.
async function cleanup() {
  const db = firebase.database();
  const users = (await store.listAllUsers()).filter(u => /@e2e\.invalid$/i.test(u.email || ''));
  const ids = new Set(users.map(u => u.id));

  for (const u of users) {
    for (const p of ['users', 'progress', 'userNotifications', 'referrals', 'friends', 'appState']) {
      await db.ref(p + '/' + u.id).remove();
    }
  }
  for (const path of ['rewardLedger', 'referralTokens', 'manualProofs', 'devices',
                      'notifications', 'shares', 'feed', 'weekResults']) {
    const val = (await db.ref(path).once('value')).val() || {};
    for (const [k, r] of Object.entries(val)) {
      if (r && ids.has(r.userId)) await db.ref(path + '/' + k).remove();
    }
  }
  // Requests and shared streaks reference people by other field names.
  const reqs = (await db.ref('friendRequests').once('value')).val() || {};
  for (const [k, r] of Object.entries(reqs)) {
    if (r && (ids.has(r.fromId) || ids.has(r.toId))) await db.ref('friendRequests/' + k).remove();
  }
  const streaks = (await db.ref('sharedStreaks').once('value')).val() || {};
  for (const [k, r] of Object.entries(streaks)) {
    const members = (r && r.members) || [r && r.a, r && r.b];
    if (members.some(m => ids.has(m))) await db.ref('sharedStreaks/' + k).remove();
  }

  const auth = getAuth();
  const identities = (await firebase.listAuthUsers(5000))
    .filter(u => /@e2e\.invalid$/i.test(u.email || ''));
  for (const u of identities) {
    try { await auth.deleteUser(u.uid); } catch (e) { /* already gone */ }
  }

  const leftUsers = (await store.listAllUsers()).filter(u => /@e2e\.invalid$/i.test(u.email || ''));
  const leftAuth = (await firebase.listAuthUsers(5000)).filter(u => /@e2e\.invalid$/i.test(u.email || ''));
  console.log('\ncleanup: ' + users.length + ' accounts and ' + identities.length + ' identities removed'
    + ' (' + leftUsers.length + ' accounts, ' + leftAuth.length + ' identities left behind)');
  return leftUsers.length === 0 && leftAuth.length === 0;
}

// A tiny result recorder, so each test file reads as a list of statements.
function recorder() {
  const state = { passed: 0, failed: 0 };
  const P = (label, ok, extra) => {
    if (ok) state.passed++; else state.failed++;
    console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label + (extra !== undefined ? '   (' + extra + ')' : ''));
  };
  return { P, state, section: t => console.log('\n--- ' + t + ' ---') };
}

module.exports = { BASE, KEY, client, mint, refresh, profile, signIn, cleanup, recorder, store, firebase };
