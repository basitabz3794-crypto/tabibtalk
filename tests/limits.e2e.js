// Rate limits, streak history, and the referral patterns the hub flags.
//
//   node tests/limits.e2e.js
//
// Creates its own throwaway @e2e.invalid accounts and removes them all before
// it exits, including when it fails.
//
// Note on the limits: they are counted in the SERVER's memory, so this drives
// them over HTTP rather than calling the middleware directly — testing the
// thing that is actually deployed, not a second copy of it.

const h = require('./helpers');
const { P, state, section } = h.recorder();
const store = h.store;
const STAMP = Date.now();
const KEY = process.env.ADMIN_KEY;

const admin = async (path) => {
  const res = await fetch(h.BASE + '/api/admin' + path, { headers: { 'x-admin-key': KEY } });
  let j = null;
  try { j = JSON.parse(await res.text()); } catch (e) {}
  return { status: res.status, j };
};

// Fires n requests one after another and reports what came back.
async function hammer(call, path, n) {
  const codes = [];
  for (let i = 0; i < n; i++) codes.push((await call(path)).status);
  return codes;
}

(async () => {
  if (!KEY) throw new Error('ADMIN_KEY is not set.');

  console.log('creating 3 throwaway accounts...');
  const [aA, bA, cA] = await Promise.all([h.mint('lim1', STAMP), h.mint('lim2', STAMP), h.mint('lim3', STAMP)]);
  const A = await h.signIn(aA, 'Limit Tester');
  const B = await h.signIn(bA, 'Second Student');
  const C = await h.signIn(cA, 'Third Student');

  section('an anonymous caller checking invite links');
  const anon = h.client();
  const codes = await hammer(anon, '/api/referrals/resolve/definitely-not-a-real-token', 75);
  const ok = codes.filter(c => c === 404).length;
  const blocked = codes.filter(c => c === 429).length;
  P('a reasonable number get through', ok >= 55 && ok <= 61, ok + ' answered');
  P('the flood is stopped', blocked > 0, blocked + ' refused');
  P('nothing else broke', codes.every(c => c === 404 || c === 429));

  const retry = await anon('/api/referrals/resolve/definitely-not-a-real-token');
  P('it says how long to wait', retry.status === 429 && retry.j.retryAfter > 0, 'retryAfter=' + (retry.j || {}).retryAfter);
  P('and says so in words', /wait/i.test((retry.j || {}).error || ''));

  section('one student is not held back by another');
  // The limit above was spent by an anonymous caller, counted by address.
  // A logged-in student is counted by account, so they are unaffected.
  P('a logged-in student can still search',
    (await A.call('/api/friends/search?q=Second')).status === 200);
  P('and another one can too', (await B.call('/api/friends/search?q=Third')).status === 200);

  section('searching over and over');
  // A fresh account, so the count starts at zero and the number below means
  // what it says rather than depending on what earlier sections used up.
  const sA = await h.mint('lim4', STAMP);
  const S = await h.signIn(sA, 'Searching Student');
  const searchCodes = await hammer(S.call, '/api/friends/search?q=stu', 46);
  P('forty searches a minute all get through', searchCodes.slice(0, 40).every(c => c === 200),
    searchCodes.slice(0, 40).filter(c => c === 200).length + '/40');
  P('but a sweep beyond that is stopped', searchCodes.some(c => c === 429));
  P('a different student is unaffected', (await B.call('/api/friends/search?q=stu')).status === 200);

  section('friend requests');
  P('one request is fine',
    (await A.call('/api/friends/request', { method: 'POST', body: JSON.stringify({ toId: C.user.id }) })).status === 200);

  section('a streak that ends is kept');
  const now = new Date().toISOString();
  const streakId = 'e2e-streak-' + STAMP;
  await store.saveSharedStreak(streakId, {
    id: streakId, members: [A.user.id, B.user.id], startedAt: now, bestDays: 12, freezes: {},
  });
  let live = (await A.call('/api/streaks')).j;
  P('it shows while it is running', (live.streaks || []).some(s => s.id === streakId));
  P('its best run is reported', (live.streaks || []).some(s => s.id === streakId && s.bestDays === 12));
  P('and a broken run says what it reached',
    (live.streaks || []).some(s => s.id === streakId && s.brokeFrom === 12));

  await A.call('/api/streaks/' + streakId, { method: 'DELETE' });
  P('it is gone from the live list', !((await A.call('/api/streaks')).j.streaks || []).some(s => s.id === streakId));

  let hist = (await A.call('/api/streaks/history')).j.history || [];
  P('but kept in history', hist.some(s => s.id === streakId));
  P('with the run it reached', hist.some(s => s.id === streakId && s.bestDays === 12));
  P('and who it was with', hist.some(s => (s.partners || []).some(p => p.id === B.user.id)));
  P('the other person keeps it too',
    ((await B.call('/api/streaks/history')).j.history || []).some(s => s.id === streakId));
  P('and knows they did not end it',
    ((await B.call('/api/streaks/history')).j.history || []).some(s => s.id === streakId && s.endedByMe === false));

  section('leaving a group');
  const groupId = 'e2e-group-' + STAMP;
  await store.saveSharedStreak(groupId, {
    id: groupId, members: [A.user.id, B.user.id, C.user.id], startedAt: now, bestDays: 5, freezes: {},
  });
  await A.call('/api/streaks/' + groupId, { method: 'DELETE' });
  P('the others keep theirs', ((await B.call('/api/streaks')).j.streaks || []).some(s => s.id === groupId));
  P('and the one who left keeps the record',
    ((await A.call('/api/streaks/history')).j.history || []).some(s => s.outcome === 'left'));
  P('it is out of their live list', !((await A.call('/api/streaks')).j.streaks || []).some(s => s.id === groupId));

  section('somebody farming their own invite link');
  // One person, one browser, four accounts made in a row through their own
  // link, none of which ever studies. This is the shape the check exists for.
  const DEVICE = 'e2e-shared-browser-' + STAMP;
  const farmerA = await h.mint('farm0', STAMP);
  const FARMER = await h.signIn(farmerA, 'Farmer Zero', null, DEVICE);
  const token = (await FARMER.call('/api/referrals/me?dialect=eg')).j.link.split('ref=')[1];

  for (let i = 1; i <= 4; i++) {
    const g = await h.mint('farm' + i, STAMP);
    await h.signIn(g, 'Fake Account ' + i, { ref: token }, DEVICE);
  }

  // And an honest inviter: a different browser, one friend, who studies.
  const honestA = await h.mint('honest0', STAMP);
  const HONEST = await h.signIn(honestA, 'Honest Student', null, 'e2e-honest-browser-' + STAMP);
  const honestToken = (await HONEST.call('/api/referrals/me?dialect=eg')).j.link.split('ref=')[1];
  const friendA = await h.mint('honest1', STAMP);
  const FRIEND = await h.signIn(friendA, 'Real Friend', { ref: honestToken }, 'e2e-friend-browser-' + STAMP);
  await FRIEND.call('/api/progress/save', {
    method: 'POST',
    body: JSON.stringify({ patch: { tt_days: JSON.stringify([new Date().toISOString().slice(0, 10)]) } }),
  });

  section('patterns the hub flags');
  const sus = await admin('/referrals/suspicious');
  P('the check runs', sus.status === 200 && Array.isArray(sus.j.flagged), 'checked ' + sus.j.checked);
  P('it needs the admin key', (await fetch(h.BASE + '/api/admin/referrals/suspicious')).status === 403);
  P('it says plainly that these are not findings', /not proof/i.test(sus.j.note || ''));
  P('and that nothing was acted on', /blocked or reversed/i.test(sus.j.note || ''));

  const farmer = (sus.j.flagged || []).find(f => f.inviter.id === FARMER.user.id);
  P('the farmer is flagged', !!farmer, farmer ? 'score ' + farmer.score : 'not flagged');
  P('for using their own browser', !!farmer
    && farmer.reasons.some(r => r.code === 'same-device-as-inviter'));
  P('for the accounts sharing one browser', !!farmer
    && farmer.reasons.some(r => r.code === 'invitees-share-a-device'));
  P('for signing them all up at once', !!farmer
    && farmer.reasons.some(r => r.code === 'signup-burst'));
  P('and for none of them ever studying', !!farmer
    && farmer.reasons.some(r => r.code === 'nobody-ever-studied'));
  P('it is raised as serious', !!farmer && farmer.level === 'high', farmer && farmer.level);
  P('each invitee is listed with what was seen', !!farmer
    && farmer.invitees.length === 4
    && farmer.invitees.every(i => i.sameDeviceAsInviter === true && i.everStudied === false));

  const honest = (sus.j.flagged || []).find(f => f.inviter.id === HONEST.user.id);
  P('the honest inviter is left alone', !honest, honest ? 'flagged: ' + honest.level : 'not flagged');
  P('every flag carries its reasons',
    (sus.j.flagged || []).every(f => Array.isArray(f.reasons) && f.reasons.length && f.reasons.every(r => r.detail)));
  P('and a level to sort by',
    (sus.j.flagged || []).every(f => ['low', 'medium', 'high'].indexOf(f.level) >= 0));
  P('the worst is listed first',
    (sus.j.flagged || []).every((f, i, a) => i === 0 || a[i - 1].score >= f.score));
})()
  .catch(err => { state.failed++; console.error('\nERROR: ' + err.message + '\n' + err.stack); })
  .then(async () => {
    // The streak records are keyed by hand above, so they are removed by hand
    // too — helpers only knows how to find ones whose members it recognises.
    try {
      const db = h.firebase.database();
      await db.ref('sharedStreaks/e2e-group-' + STAMP).remove();
      await db.ref('streakHistory/e2e-streak-' + STAMP).remove();
      const hist = (await db.ref('streakHistory').once('value')).val() || {};
      for (const k of Object.keys(hist)) if (k.indexOf('e2e-') === 0) await db.ref('streakHistory/' + k).remove();
    } catch (e) { console.error('streak cleanup: ' + e.message); }

    if (!(await h.cleanup())) { state.failed++; console.log('  FAIL  cleanup left test accounts behind'); }
    console.log('\n' + state.passed + ' passed, ' + state.failed + ' failed\n');
    process.exit(state.failed ? 1 : 0);
  });
