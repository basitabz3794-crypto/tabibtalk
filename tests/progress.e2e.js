// Progress must never go backwards.
//
//   node tests/progress.e2e.js
//
// The case this exists for: a student on a phone whose progress read failed
// started a session with nothing, completed one lesson, and the save replaced a
// full record with that single lesson. Everything below drives the real save
// route, because the merge that prevents it lives on the server.

const h = require('./helpers');
const { P, state, section } = h.recorder();
const STAMP = Date.now();
const firebase = h.firebase;

const save = (call, patch) => call('/api/progress/save', {
  method: 'POST', body: JSON.stringify({ patch }),
});
const read = async (call) => (await call('/api/progress/me')).j.state || {};
const passedIn = (st, course) => {
  try { return ((JSON.parse(st.tt_path || '{}')[course] || {}).passed || []).map(String).sort(); }
  catch (e) { return []; }
};

(async () => {
  console.log('creating a throwaway account...');
  const acct = await h.mint('prog', STAMP);
  const A = await h.signIn(acct, 'Progress Student');
  const call = A.call;

  section('a full course record');
  const full = JSON.stringify({
    history: { passed: ['0', '1', '2', '3', 'final'] },
    er: { passed: ['0', '1', '2', '3', '4'] },
    obgyn: { passed: ['0', '1'] },
  });
  await save(call, { tt_path: full, tt_days: JSON.stringify(['2026-08-01', '2026-08-02']) });
  let st = await read(call);
  P('it is stored', passedIn(st, 'history').length === 5, passedIn(st, 'history').join(','));

  section('a browser that started blank saves one lesson');
  // Exactly what happened: the page could not read the account, ran empty, and
  // wrote back a record containing only the lesson just finished.
  await save(call, { tt_path: JSON.stringify({ pediatrics: { passed: ['0'] } }) });
  st = await read(call);
  P('the finished course is still finished', passedIn(st, 'history').join(',') === '0,1,2,3,final',
    passedIn(st, 'history').join(',') || '(GONE)');
  P('the other course survived too', passedIn(st, 'er').length === 5);
  P('and the new lesson was added', passedIn(st, 'pediatrics').join(',') === '0');

  section('the final-quiz unlock');
  P('the section that unlocks it is intact', passedIn(st, 'history').indexOf('final') >= 0);
  await save(call, { tt_path: JSON.stringify({ history: { passed: ['0'] } }) });
  st = await read(call);
  P('a stale save cannot take it away', passedIn(st, 'history').indexOf('final') >= 0,
    passedIn(st, 'history').join(','));

  section('two devices at once');
  // Each knows about its own work and nothing of the other's. Whoever saves
  // last used to win outright.
  await save(call, { tt_path: JSON.stringify({ vocab: { passed: ['0', '1'] } }) });
  await save(call, { tt_path: JSON.stringify({ vocab: { passed: ['2', '3'] } }) });
  st = await read(call);
  P('both devices keep their work', passedIn(st, 'vocab').join(',') === '0,1,2,3',
    passedIn(st, 'vocab').join(','));

  section('saves that overlap');
  // The failure this exists for: saves overlap all the time — the debounced
  // flush racing the page-hide beacon, or a second tab — and a read-then-write
  // merge lets them overwrite each other. A student who passed five sections
  // came back to three that way.
  await save(call, { tt_path: JSON.stringify({ race: { passed: ['0'] } }) });
  await Promise.all(Array.from({ length: 10 }, (_, i) =>
    save(call, { tt_path: JSON.stringify({ race: { passed: [String(i + 1)] } }) })));
  await new Promise(r => setTimeout(r, 1500));
  st = await read(call);
  const race = passedIn(st, 'race');
  P('every one of eleven concurrent saves survives', race.length === 11,
    race.length + '/11 kept: ' + race.join(','));

  section('days studied');
  await save(call, { tt_days: JSON.stringify(['2026-08-05']) });
  st = await read(call);
  const days = JSON.parse(st.tt_days || '[]');
  P('an earlier day is not forgotten', days.indexOf('2026-08-01') >= 0, days.join(','));
  P('and the new one is there', days.indexOf('2026-08-05') >= 0);
  P('with no duplicates', new Set(days).size === days.length);

  section('time spent');
  await save(call, { tt_time: JSON.stringify({ '2026-08-01': 1800 }) });
  await save(call, { tt_time: JSON.stringify({ '2026-08-01': 600, '2026-08-02': 300 }) });
  st = await read(call);
  const time = JSON.parse(st.tt_time || '{}');
  P('a shorter report cannot shrink a day', time['2026-08-01'] === 1800, time['2026-08-01']);
  P('and a new day is recorded', time['2026-08-02'] === 300);

  section('things that legitimately change are untouched');
  await save(call, { tt_streak: '12' });
  await save(call, { tt_streak: '1' });
  st = await read(call);
  P('a broken streak really does reset', st.tt_streak === '1', st.tt_streak);
  await save(call, { tt_bm: JSON.stringify(['a', 'b', 'c']) });
  await save(call, { tt_bm: JSON.stringify(['a', 'c']) });
  st = await read(call);
  P('a removed bookmark stays removed', JSON.parse(st.tt_bm || '[]').length === 2,
    st.tt_bm);
  await save(call, { tt_last: JSON.stringify({ page: 'er' }) });
  await save(call, { tt_last: JSON.stringify({ page: 'obgyn' }) });
  st = await read(call);
  P('the resume point still moves', /obgyn/.test(st.tt_last || ''), st.tt_last);

  section('each dialect keeps its own');
  await save(call, { tt_path__hejazi: JSON.stringify({ history: { passed: ['0'] } }) });
  await save(call, { tt_path__hejazi: JSON.stringify({ history: { passed: ['1'] } }) });
  st = await read(call);
  let hej = [];
  try { hej = (JSON.parse(st.tt_path__hejazi || '{}').history || {}).passed || []; } catch (e) {}
  P('hejazi merges the same way', hej.map(String).sort().join(',') === '0,1', hej.join(','));
  P('and egyptian is unaffected', passedIn(st, 'history').indexOf('final') >= 0);

  section('nonsense cannot corrupt a record');
  await save(call, { tt_path: 'not json at all' });
  st = await read(call);
  P('a malformed save is taken as-is rather than crashing', typeof st.tt_path === 'string');
  await save(call, { tt_path: full });
  st = await read(call);
  P('and a good save puts it right again', passedIn(st, 'history').length === 5);
})()
  .catch(err => { state.failed++; console.error('\nERROR: ' + err.message + '\n' + err.stack); })
  .then(async () => {
    if (!(await h.cleanup())) { state.failed++; console.log('  FAIL  cleanup left test accounts behind'); }
    console.log('\n' + state.passed + ' passed, ' + state.failed + ' failed\n');
    process.exit(state.failed ? 1 : 0);
  });
