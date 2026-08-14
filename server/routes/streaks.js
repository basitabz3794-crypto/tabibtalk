// Shared streaks.
//
// Two friends keep a streak together: it survives only while BOTH of them study
// each day, so missing a day costs your partner too. That is the whole point of
// it, and it is why it cannot be computed in a browser — neither student's
// device can be trusted to report the other's activity.
//
// Nothing new is recorded to make this work. Every account already stores the
// days it studied (tt_days, plus the per-dialect tt_days__hejazi and
// tt_days__khaleeji), so the shared streak is derived from records that already
// exist and cannot be edited from a browser. Studying in ANY dialect counts —
// the streak is between two people, not between two courses.

const express = require('express');
const { nanoid } = require('nanoid');
const store = require('../data/store');
const firebase = require('../data/firebase');

const router = express.Router();

// Studying together is a paid feature. The two free baselines cannot start or
// join one, checked here rather than only hidden in the interface.
const LOCKED_TIERS = ['explorer', 'basic'];
function canShareStreak(tier) { return LOCKED_TIERS.indexOf(tier) < 0; }

function requireLogin(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Please log in first.' });
  next();
}

function firstName(u) {
  return ((u && u.name) || '').trim().split(/\s+/)[0] || 'Student';
}

// One record per pair whichever way round it is created, so inviting someone
// who already invited you cannot produce two competing streaks.
function pairKey(a, b) { return [a, b].sort().join('__'); }

const DAY = 86400000;
function dayStr(t) { return new Date(t).toISOString().slice(0, 10); }

// Every day this account studied, in any dialect.
function studyDays(state) {
  const out = new Set();
  Object.keys(state || {}).forEach((k) => {
    if (k.indexOf('tt_days') !== 0) return;
    try {
      const arr = JSON.parse(state[k]);
      if (Array.isArray(arr)) arr.forEach(d => out.add(String(d)));
    } catch (e) { /* a malformed entry simply contributes nothing */ }
  });
  return out;
}

// ISO-ish week key, used to allow one freeze per person per week.
function weekKey(t) {
  const d = new Date(t);
  const u = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  u.setUTCDate(u.getUTCDate() - ((u.getUTCDay() + 6) % 7));
  const jan4 = new Date(Date.UTC(u.getUTCFullYear(), 0, 4));
  const wk = 1 + Math.round((u.getTime() - (jan4.getTime() - ((jan4.getUTCDay() + 6) % 7) * DAY)) / (7 * DAY));
  return `${u.getUTCFullYear()}-W${String(wk).padStart(2, '0')}`;
}

// The heart of it: walk back day by day, and stop the moment a day is not
// covered by both people.
//
// Today is treated gently. A day only breaks the streak once it is over, so
// counting starts at yesterday and today is added as a bonus if both have
// already studied — otherwise opening the app in the morning would look like
// the streak had just been lost.
function computeShared(rec, aDays, bDays, now) {
  const freezes = rec.freezes || {};
  const covered = (userId, days, ds) =>
    days.has(ds) || Object.values(freezes[userId] || {}).indexOf(ds) >= 0;

  const today = dayStr(now);
  const bothToday = covered(rec.a, aDays, today) && covered(rec.b, bDays, today);

  let count = 0;
  for (let i = 1; i < 400; i++) {
    const ds = dayStr(now - i * DAY);
    if (covered(rec.a, aDays, ds) && covered(rec.b, bDays, ds)) count++;
    else break;
  }
  if (bothToday) count++;

  // Who still has to study today to keep it alive.
  const waitingOn = [];
  if (!covered(rec.a, aDays, today)) waitingOn.push(rec.a);
  if (!covered(rec.b, bDays, today)) waitingOn.push(rec.b);

  return {
    days: count,
    bothToday,
    waitingOn,
    // At risk once a streak exists and someone still has not studied today.
    atRisk: count > 0 && waitingOn.length > 0,
  };
}

function freezeUsedThisWeek(rec, userId, now) {
  return !!((rec.freezes || {})[userId] || {})[weekKey(now)];
}

// ---- My shared streaks ----
router.get('/', requireLogin, async (req, res) => {
  try {
    const me = req.session.userId;
    const [recs, progress, meUser] = await Promise.all([
      store.listSharedStreaks(me),
      firebase.getAllProgress(),
      store.findUserById(me),
    ]);
    const now = Date.now();
    const out = await Promise.all(recs.map(async (rec) => {
      const otherId = rec.a === me ? rec.b : rec.a;
      const other = await store.findUserById(otherId);
      const s = computeShared(rec, studyDays(progress[rec.a]), studyDays(progress[rec.b]), now);
      return {
        id: rec.id,
        partner: other ? { id: other.id, name: firstName(other), college: (other.college || '').trim() } : null,
        days: s.days,
        bothToday: s.bothToday,
        atRisk: s.atRisk,
        waitingOnMe: s.waitingOn.indexOf(me) >= 0,
        waitingOnPartner: s.waitingOn.indexOf(otherId) >= 0,
        freezeAvailable: !freezeUsedThisWeek(rec, me, now),
        startedAt: rec.startedAt,
      };
    }));
    res.json({
      streaks: out.filter(s => s.partner),
      canShare: canShareStreak(meUser && meUser.tier),
      tier: meUser && meUser.tier,
    });
  } catch (err) {
    console.error('[streaks] list failed:', err.message);
    res.status(500).json({ error: 'Could not load your shared streaks.' });
  }
});

// ---- Invite a friend ----
router.post('/invite', requireLogin, async (req, res) => {
  const me = req.session.userId;
  const toId = (req.body || {}).toId;
  if (!toId || toId === me) return res.status(400).json({ error: 'Choose a friend to invite.' });

  const [meUser, them] = await Promise.all([store.findUserById(me), store.findUserById(toId)]);
  if (!them) return res.status(404).json({ error: 'That student could not be found.' });
  if (!canShareStreak(meUser.tier)) {
    return res.status(403).json({ error: 'Studying a streak together is part of the paid plans. Upgrade to invite a friend.' });
  }
  // Only friends, so an invitation cannot be used to contact a stranger.
  if (!(await store.areFriends(me, toId))) {
    return res.status(403).json({ error: 'You can only share a streak with a friend.' });
  }
  if (await store.findSharedStreak(pairKey(me, toId))) {
    return res.json({ ok: true, already: true });
  }
  const existing = await store.pendingStreakInviteBetween(me, toId);
  if (existing) return res.json({ ok: true, inviteId: existing.id, already: true });

  const now = new Date().toISOString();
  const inv = await store.createStreakInvite({
    id: nanoid(), fromId: me, toId, status: 'pending', createdAt: now,
  });
  await store.addUserNotification(toId, {
    id: nanoid(),
    type: 'streak-invite',
    title: firstName(meUser) + ' wants to keep a streak with you',
    body: 'You both have to study each day — if one of you misses, you both lose it.',
    inviteId: inv.id,
    fromId: me,
    createdAt: now, readAt: null, actioned: null,
  });
  res.json({ ok: true, inviteId: inv.id });
});

// ---- Accept or decline an invitation ----
router.post('/respond', requireLogin, async (req, res) => {
  const me = req.session.userId;
  const { inviteId, accept } = req.body || {};
  const inv = await store.findStreakInvite(inviteId);
  if (!inv) return res.status(404).json({ error: 'That invitation no longer exists.' });
  if (inv.toId !== me) return res.status(403).json({ error: 'That invitation is not yours to answer.' });
  if (inv.status !== 'pending') return res.json({ ok: true, alreadyAnswered: true, status: inv.status });

  const meUser = await store.findUserById(me);
  if (accept && !canShareStreak(meUser.tier)) {
    return res.status(403).json({ error: 'Studying a streak together is part of the paid plans.' });
  }

  const now = new Date().toISOString();
  await store.updateStreakInvite(inv.id, { status: accept ? 'accepted' : 'rejected', respondedAt: now });

  const mine = await store.listUserNotifications(me);
  const card = mine.find(n => n.inviteId === inv.id);
  if (card) await store.patchUserNotification(me, card.id, { actioned: accept ? 'accepted' : 'rejected', readAt: card.readAt || now });

  if (!accept) return res.json({ ok: true, status: 'rejected' });

  const key = pairKey(me, inv.fromId);
  await store.saveSharedStreak(key, {
    id: key, a: [me, inv.fromId].sort()[0], b: [me, inv.fromId].sort()[1],
    startedAt: now, freezes: {},
  });
  await store.addUserNotification(inv.fromId, {
    id: nanoid(), type: 'streak-started',
    title: firstName(meUser) + ' is keeping a streak with you',
    body: 'Study every day to keep it going — you both need to.',
    fromId: me, createdAt: now, readAt: null, actioned: null,
  });
  res.json({ ok: true, status: 'started' });
});

// ---- Use this week's freeze ----
// Covers today for the person who used it, so a missed day does not cost their
// partner the streak. One per person per week.
router.post('/:id/freeze', requireLogin, async (req, res) => {
  const me = req.session.userId;
  const rec = await store.findSharedStreak(req.params.id);
  if (!rec) return res.status(404).json({ error: 'That streak no longer exists.' });
  if (rec.a !== me && rec.b !== me) return res.status(403).json({ error: 'That is not your streak.' });

  const now = Date.now();
  if (freezeUsedThisWeek(rec, me, now)) {
    return res.status(409).json({ error: 'You have already used your freeze this week. It refreshes on Monday.' });
  }
  const freezes = rec.freezes || {};
  freezes[me] = Object.assign({}, freezes[me], { [weekKey(now)]: dayStr(now) });
  await store.saveSharedStreak(rec.id, Object.assign({}, rec, { freezes }));

  const otherId = rec.a === me ? rec.b : rec.a;
  const meUser = await store.findUserById(me);
  await store.addUserNotification(otherId, {
    id: nanoid(), type: 'streak-freeze',
    title: firstName(meUser) + ' used a freeze today',
    body: 'Your streak together is safe for today.',
    fromId: me, createdAt: new Date().toISOString(), readAt: null, actioned: null,
  });
  res.json({ ok: true });
});

// ---- End a shared streak ----
router.delete('/:id', requireLogin, async (req, res) => {
  const me = req.session.userId;
  const rec = await store.findSharedStreak(req.params.id);
  if (!rec) return res.json({ ok: true });
  if (rec.a !== me && rec.b !== me) return res.status(403).json({ error: 'That is not your streak.' });
  await store.deleteSharedStreak(rec.id);
  res.json({ ok: true });
});

// ---- Warn a partner whose streak is about to lapse ----
// Event-driven rather than scheduled: there is no cron here, so the check runs
// when someone opens their streak page. It notifies the partner at most once a
// day, so it cannot become a stream of reminders.
router.post('/nudge', requireLogin, async (req, res) => {
  try {
    const me = req.session.userId;
    const [recs, progress] = await Promise.all([
      store.listSharedStreaks(me), firebase.getAllProgress(),
    ]);
    const now = Date.now();
    const today = dayStr(now);
    let sent = 0;
    for (const rec of recs) {
      const s = computeShared(rec, studyDays(progress[rec.a]), studyDays(progress[rec.b]), now);
      if (!s.atRisk || s.days < 1) continue;
      for (const uid of s.waitingOn) {
        if (uid === me) continue;              // never nudge yourself
        if ((rec.warned || {})[uid] === today) continue;   // once a day, per person
        await store.addUserNotification(uid, {
          id: nanoid(), type: 'streak-warning',
          title: 'Your ' + s.days + '-day streak is at risk',
          body: 'Study today to keep it going — your partner is counting on it.',
          createdAt: new Date().toISOString(), readAt: null, actioned: null,
        });
        const warned = Object.assign({}, rec.warned, { [uid]: today });
        await store.saveSharedStreak(rec.id, Object.assign({}, rec, { warned }));
        sent++;
      }
    }
    res.json({ ok: true, sent });
  } catch (err) {
    console.error('[streaks] nudge failed:', err.message);
    res.json({ ok: false });
  }
});

module.exports = router;
module.exports.computeShared = computeShared;
module.exports.studyDays = studyDays;
module.exports.pairKey = pairKey;
module.exports.canShareStreak = canShareStreak;
