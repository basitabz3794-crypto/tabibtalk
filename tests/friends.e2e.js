// Friends, end to end: finding someone, asking, and every way that can be
// answered. Run the server first, then:  node tests/friends.e2e.js
//
// Creates its own throwaway @e2e.invalid accounts and removes them all before
// it exits, including when it fails.

const h = require('./helpers');
const { P, state, section } = h.recorder();
const STAMP = Date.now();
const store = h.store;

(async () => {
  console.log('creating 4 throwaway accounts...');
  const [aA, bA, cA, dA] = await Promise.all([
    h.mint('fa', STAMP), h.mint('fb', STAMP), h.mint('fc', STAMP), h.mint('fd', STAMP),
  ]);
  const A = await h.signIn(aA, 'Amira Saleh', { college: 'Alexandria Faculty of Medicine' });
  const B = await h.signIn(bA, 'Bilal Nasser', { college: 'Ain Shams Faculty of Medicine' });
  const C = await h.signIn(cA, 'Carine Haddad', { college: 'Alexandria Faculty of Medicine' });
  const D = await h.signIn(dA, 'Dina Fawzy', { college: 'Ain Shams Faculty of Medicine' });

  section('finding someone');
  let r = (await A.call('/api/friends/search?q=Bilal')).j;
  P('a student is found by name', (r.results || []).some(x => x.id === B.user.id));
  P('only a first name comes back', (r.results || []).every(x => !/\s/.test(x.name)),
    (r.results[0] || {}).name);
  P('no email is exposed', JSON.stringify(r).indexOf('@e2e.invalid') < 0);

  r = (await A.call('/api/friends/search?q=Ain Shams')).j;
  P('a student is found by college', (r.results || []).some(x => x.id === B.user.id));

  r = (await A.call('/api/friends/search?q=Amira')).j;
  P('you never find yourself', !(r.results || []).some(x => x.id === A.user.id));

  P('one letter searches nothing', ((await A.call('/api/friends/search?q=a')).j.results || []).length === 0);
  P('an empty search returns nothing', ((await A.call('/api/friends/search?q=')).j.results || []).length === 0);
  P('a stranger must be logged in', (await h.client()('/api/friends/search?q=Bilal')).status === 401);

  section('asking');
  let sent = (await A.call('/api/friends/request', {
    method: 'POST', body: JSON.stringify({ toId: B.user.id }),
  })).j;
  P('the request is sent', sent.ok === true && sent.status === 'requested');

  let mine = (await A.call('/api/friends/requests')).j;
  P('the sender sees it as Sent', (mine.sent || []).some(x => x.person.id === B.user.id && x.label === 'Sent'));

  let theirs = (await B.call('/api/friends/requests')).j;
  P('the other student sees it waiting',
    (theirs.received || []).some(x => x.person.id === A.user.id && x.label === 'Waiting for you'));

  P('searching now shows Requested rather than a second Add',
    ((await A.call('/api/friends/search?q=Bilal')).j.results || [])
      .some(x => x.id === B.user.id && x.status === 'requested'));

  const twice = (await A.call('/api/friends/request', {
    method: 'POST', body: JSON.stringify({ toId: B.user.id }),
  })).j;
  P('asking twice makes only one request', twice.requestId === sent.requestId || twice.status === 'requested');
  P('still one request on record', ((await A.call('/api/friends/requests')).j.sent || [])
    .filter(x => x.person.id === B.user.id).length === 1);

  P('you cannot ask yourself',
    (await A.call('/api/friends/request', { method: 'POST', body: JSON.stringify({ toId: A.user.id }) })).status === 400);

  section('answering: accepted');
  const pending = (await B.call('/api/friends/requests')).j.received.find(x => x.person.id === A.user.id);
  P('a bystander cannot answer it',
    (await C.call('/api/friends/respond', {
      method: 'POST', body: JSON.stringify({ requestId: pending.id, accept: true }),
    })).status === 403);

  await B.call('/api/friends/respond', { method: 'POST', body: JSON.stringify({ requestId: pending.id, accept: true }) });
  P('both are now friends', ((await A.call('/api/friends')).j.friends || []).some(f => f.id === B.user.id)
    && ((await B.call('/api/friends')).j.friends || []).some(f => f.id === A.user.id));
  P('the sender sees Accepted', ((await A.call('/api/friends/requests')).j.sent || [])
    .some(x => x.person.id === B.user.id && x.label === 'Accepted'));
  P('a friend no longer appears in search',
    !((await A.call('/api/friends/search?q=Bilal')).j.results || []).some(x => x.id === B.user.id));
  P('the sender was told', ((await A.call('/api/notifications/me')).j.personal || [])
    .some(n => n.type === 'friend-accepted'));

  section('answering: declined');
  const toC = (await A.call('/api/friends/request', { method: 'POST', body: JSON.stringify({ toId: C.user.id }) })).j;
  await C.call('/api/friends/respond', { method: 'POST', body: JSON.stringify({ requestId: toC.requestId, accept: false }) });
  P('the sender sees Rejected', ((await A.call('/api/friends/requests')).j.sent || [])
    .some(x => x.person.id === C.user.id && x.label === 'Rejected'));
  P('they are not friends', !((await A.call('/api/friends')).j.friends || []).some(f => f.id === C.user.id));
  P('a decline is never announced', !((await A.call('/api/notifications/me')).j.personal || [])
    .some(n => /reject|declin/i.test((n.title || '') + (n.body || ''))));

  section('answering: ignored');
  const toD = (await A.call('/api/friends/request', { method: 'POST', body: JSON.stringify({ toId: D.user.id }) })).j;
  await D.call('/api/friends/ignore', { method: 'POST', body: JSON.stringify({ requestId: toD.requestId }) });
  P('the sender sees Ignored', ((await A.call('/api/friends/requests')).j.sent || [])
    .some(x => x.person.id === D.user.id && x.label === 'Ignored'));
  P('it stops waiting on the other side', !((await D.call('/api/friends/requests')).j.received || [])
    .some(x => x.id === toD.requestId && x.status === 'pending'));
  P('answering it again changes nothing',
    (await D.call('/api/friends/ignore', { method: 'POST', body: JSON.stringify({ requestId: toD.requestId }) })).j.alreadyAnswered === true);
  P('an ignored person can be asked again later',
    (await A.call('/api/friends/request', { method: 'POST', body: JSON.stringify({ toId: D.user.id }) })).j.status === 'requested');

  section('unfriending');
  await A.call('/api/friends/' + B.user.id, { method: 'DELETE' });
  P('removed from the remover', !((await A.call('/api/friends')).j.friends || []).some(f => f.id === B.user.id));
  P('and from the other side too', !((await B.call('/api/friends')).j.friends || []).some(f => f.id === A.user.id));
  P('they can be found again', ((await A.call('/api/friends/search?q=Bilal')).j.results || [])
    .some(x => x.id === B.user.id));

  section('streaks kept together');
  const streaks = (await A.call('/api/streaks')).j;
  P('the panel can read them', streaks && Array.isArray(streaks.streaks), 'tier=' + streaks.tier);
  P('a plan decides whether they are offered', typeof streaks.canShare === 'boolean');
})()
  .catch(err => { state.failed++; console.error('\nERROR: ' + err.message + '\n' + err.stack); })
  .then(async () => {
    if (!(await h.cleanup())) { state.failed++; console.log('  FAIL  cleanup left test accounts behind'); }
    console.log('\n' + state.passed + ' passed, ' + state.failed + ' failed\n');
    process.exit(state.failed ? 1 : 0);
  });
