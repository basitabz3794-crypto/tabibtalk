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

// A streak used to be strictly two people, stored as `a` and `b`. It now holds
// a members list so three or more can keep one together. Records written under
// the old shape are read through this, so existing streaks keep working with no
// migration and no risk to anyone mid-streak.
function membersOf(rec) {
  if (Array.isArray(rec.members) && rec.members.length) return rec.members.slice();
  return [rec.a, rec.b].filter(Boolean);
}

// A ceiling, because every extra person makes the streak harder to keep: with
// "everyone must study today", one quiet member ends it for all of them. Eight
// is generous without being unkeepable.
const MAX_MEMBERS = 8;

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
// `daysByMember` is { userId -> Set of 'YYYY-MM-DD' }. Every member has to be
// covered on a day for it to count — with three people that is a harder promise
// than with two, which is the nature of a group streak.
function computeShared(rec, daysByMember, now) {
  const freezes = rec.freezes || {};
  const members = membersOf(rec);
  const covered = (userId, ds) =>
    (daysByMember[userId] || new Set()).has(ds) ||
    Object.values(freezes[userId] || {}).indexOf(ds) >= 0;
  const allCovered = (ds) => members.every(m => covered(m, ds));

  const today = dayStr(now);
  const bothToday = allCovered(today);

  let count = 0;
  for (let i = 1; i < 400; i++) {
    const ds = dayStr(now - i * DAY);
    if (allCovered(ds)) count++;
    else break;
  }
  if (bothToday) count++;

  // Who still has to study today to keep it alive.
  const waitingOn = members.filter(m => !covered(m, today));

  return {
    days: count,
    bothToday,
    waitingOn,
    members,
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
      const members = membersOf(rec);
      const daysByMember = {};
      members.forEach(m => { daysByMember[m] = studyDays(progress[m]); });
      const s = computeShared(rec, daysByMember, now);

      // The longest this streak has ever run. A streak's length is worked out
      // from study days every time it is read, so a broken one silently falls
      // back to zero and what it reached is gone. Remembering the high-water
      // mark is what lets a student see they once kept twelve days, and lets a
      // break be shown as a break rather than as a streak that never happened.
      if (s.days > (rec.bestDays || 0)) {
        rec = Object.assign({}, rec, { bestDays: s.days, bestAt: new Date().toISOString() });
        await store.saveSharedStreak(rec.id, rec);
      }

      const others = members.filter(m => m !== me);
      const people = await Promise.all(others.map(id => store.findUserById(id)));
      const partners = people.filter(Boolean).map(p => ({
        id: p.id, name: firstName(p), college: (p.college || '').trim(),
        owesToday: s.waitingOn.indexOf(p.id) >= 0,
      }));

      return {
        id: rec.id,
        isGroup: members.length > 2,
        memberCount: members.length,
        // Kept for a two-person streak so nothing that reads `partner` breaks.
        partner: partners.length === 1 ? partners[0] : null,
        partners,
        canAddMore: members.length < MAX_MEMBERS,
        days: s.days,
        bestDays: rec.bestDays || s.days,
        // A run that was longer than the current one means it broke and started
        // again — worth saying, rather than quietly showing the smaller number.
        brokeFrom: (rec.bestDays || 0) > s.days ? (rec.bestDays || 0) : null,
        bothToday: s.bothToday,
        atRisk: s.atRisk,
        waitingOnMe: s.waitingOn.indexOf(me) >= 0,
        waitingOnPartner: s.waitingOn.some(id => id !== me),
        freezeAvailable: !freezeUsedThisWeek(rec, me, now),
        startedAt: rec.startedAt,
      };
    }));
    res.json({
      streaks: out.filter(s => s.partners.length),
      canShare: canShareStreak(meUser && meUser.tier),
      tier: meUser && meUser.tier,
      maxMembers: MAX_MEMBERS,
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
  // Inviting into an EXISTING streak turns it into a group. Only a member may
  // do that, and only up to the ceiling.
  const streakId = (req.body || {}).streakId;
  let target = null;
  if (streakId) {
    target = await store.findSharedStreak(streakId);
    if (!target) return res.status(404).json({ error: 'That streak no longer exists.' });
    const members = membersOf(target);
    if (members.indexOf(me) < 0) return res.status(403).json({ error: 'That is not your streak.' });
    if (members.indexOf(toId) >= 0) return res.json({ ok: true, already: true });
    if (members.length >= MAX_MEMBERS) {
      return res.status(409).json({ error: 'A streak can hold up to ' + MAX_MEMBERS + ' people.' });
    }
  } else if (await store.findSharedStreak(pairKey(me, toId))) {
    return res.json({ ok: true, already: true });
  }

  const existing = await store.pendingStreakInviteBetween(me, toId);
  if (existing) return res.json({ ok: true, inviteId: existing.id, already: true });

  const now = new Date().toISOString();
  const inv = await store.createStreakInvite({
    id: nanoid(), fromId: me, toId, streakId: streakId || null,
    status: 'pending', createdAt: now,
  });
  const groupSize = target ? membersOf(target).length : 1;
  await store.addUserNotification(toId, {
    id: nanoid(),
    type: 'streak-invite',
    title: target
      ? firstName(meUser) + ' invited you to a streak with ' + groupSize + ' others'
      : firstName(meUser) + ' wants to keep a streak with you',
    body: 'Everyone has to study each day — if one person misses, everyone loses it.',
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

  // Joining an existing streak makes it a group; otherwise start a new pair.
  if (inv.streakId) {
    const rec = await store.findSharedStreak(inv.streakId);
    if (!rec) return res.status(404).json({ error: 'That streak no longer exists.' });
    const members = membersOf(rec);
    if (members.indexOf(me) < 0) {
      if (members.length >= MAX_MEMBERS) {
        return res.status(409).json({ error: 'That streak is already full.' });
      }
      members.push(me);
      // Written as `members` from here on; a and b are dropped so there is one
      // shape rather than two half-truths.
      const next = Object.assign({}, rec, { members });
      delete next.a; delete next.b;
      await store.saveSharedStreak(rec.id, next);
    }
    // Everyone already in it hears about the new arrival.
    await Promise.all(members.filter(m => m !== me).map(m => store.addUserNotification(m, {
      id: nanoid(), type: 'streak-started',
      title: firstName(meUser) + ' joined your streak',
      body: 'Everyone has to study each day to keep it going.',
      fromId: me, createdAt: now, readAt: null, actioned: null,
    })));
    return res.json({ ok: true, status: 'joined', members: members.length });
  }

  const key = pairKey(me, inv.fromId);
  await store.saveSharedStreak(key, {
    id: key, members: [me, inv.fromId].sort(),
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
  if (membersOf(rec).indexOf(me) < 0) return res.status(403).json({ error: 'That is not your streak.' });

  const now = Date.now();
  if (freezeUsedThisWeek(rec, me, now)) {
    return res.status(409).json({ error: 'You have already used your freeze this week. It refreshes on Monday.' });
  }
  const freezes = rec.freezes || {};
  freezes[me] = Object.assign({}, freezes[me], { [weekKey(now)]: dayStr(now) });
  await store.saveSharedStreak(rec.id, Object.assign({}, rec, { freezes }));

  // Everyone else in the streak is told it is safe for today.
  const meUser = await store.findUserById(me);
  const stamp = new Date().toISOString();
  await Promise.all(membersOf(rec).filter(m => m !== me).map(m => store.addUserNotification(m, {
    id: nanoid(), type: 'streak-freeze',
    title: firstName(meUser) + ' used a freeze today',
    body: 'Your streak is safe for today.',
    fromId: me, createdAt: stamp, readAt: null, actioned: null,
  })));
  res.json({ ok: true });
});

// ---- End a shared streak ----
router.delete('/:id', requireLogin, async (req, res) => {
  const me = req.session.userId;
  const rec = await store.findSharedStreak(req.params.id);
  if (!rec) return res.json({ ok: true });
  const members = membersOf(rec);
  if (members.indexOf(me) < 0) return res.status(403).json({ error: 'That is not your streak.' });

  const stamp = new Date().toISOString();

  // Leaving a group of three or more only removes you — the others keep theirs.
  // A pair has nothing left to be a streak, so it ends.
  if (members.length > 2) {
    const rest = members.filter(m => m !== me);
    const next = Object.assign({}, rec, { members: rest });
    delete next.a; delete next.b;
    await store.saveSharedStreak(rec.id, next);

    // Kept for the person who walked away, so their own history still shows the
    // streak they were part of and how far it got while they were in it.
    await store.archiveSharedStreak(Object.assign({}, rec, {
      id: rec.id + '__left__' + me,
      members: [me],
      alsoWith: rest,
      endedAt: stamp,
      endedBy: me,
      outcome: 'left',
    }));
    return res.json({ ok: true, left: true, remaining: rest.length });
  }

  // Moved rather than dropped, so both people keep the record of it.
  await store.archiveSharedStreak(Object.assign({}, rec, {
    endedAt: stamp, endedBy: me, outcome: 'ended',
  }));
  await store.deleteSharedStreak(rec.id);
  res.json({ ok: true, ended: true });
});

// ---- Streaks that are over ----
// What a student kept and for how long, after the streak itself is gone.
router.get('/history', requireLogin, async (req, res) => {
  try {
    const me = req.session.userId;
    const rows = await store.listStreakHistory(me);
    const out = await Promise.all(rows.map(async (rec) => {
      const others = (Array.isArray(rec.alsoWith) ? rec.alsoWith : membersOf(rec)).filter(m => m !== me);
      const people = await Promise.all(others.map(id => store.findUserById(id)));
      return {
        id: rec.id,
        partners: people.filter(Boolean).map(p => ({ id: p.id, name: firstName(p), college: (p.college || '').trim() })),
        isGroup: others.length > 1,
        bestDays: rec.bestDays || 0,
        startedAt: rec.startedAt || null,
        endedAt: rec.endedAt || null,
        outcome: rec.outcome || 'ended',
        endedByMe: rec.endedBy === me,
      };
    }));
    res.json({ history: out.filter(s => s.partners.length) });
  } catch (err) {
    console.error('[streaks] history failed:', err.message);
    res.status(500).json({ error: 'Could not load your streak history.' });
  }
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
      const byMember = {};
      membersOf(rec).forEach(m => { byMember[m] = studyDays(progress[m]); });
      const s = computeShared(rec, byMember, now);
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
module.exports.membersOf = membersOf;
module.exports.MAX_MEMBERS = MAX_MEMBERS;
module.exports.canShareStreak = canShareStreak;
