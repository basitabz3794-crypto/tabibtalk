// Weekly leaderboard — one board, shared by every dialect.
//
// Score is computed server-side from the same per-account progress the app
// already syncs (see /api/progress) — no new writes, no separate score
// bookkeeping to drift out of date. The week runs Monday 00:00 UTC to Sunday.
//
// This week's points =
//     study time    · 1 point per minute studied this week   (tt_time)
//   + test attempts · score% / 10 per attempt this week      (tt_scores)
//   + streak bonus  · current streak × 5, if active this week (tt_streak)
//
// DIALECTS: streak, study time and test scores are stored per dialect by the
// app — Egyptian under the bare key, the others under 'tt_streak__hejazi' and
// friends. The board is deliberately NOT split: a student who studies in more
// than one dialect has all of it counted, so the three dialects compete
// together and nobody is pushed down the table for spreading their week over
// two of them. Each row names the dialect(s) that actually earned the points.
//
// Only nickname + emoji (from onboarding) are exposed — never emails or real
// names, since every signed-in user can see this list. Awards for the top 10
// are Duolingo-league-inspired.

const express = require('express');
const store = require('../data/store');
const firebase = require('../data/firebase');
const { DIALECTS } = require('../data/plans');

const router = express.Router();

function requireLogin(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Please log in first.' });
  next();
}

// Short labels — these sit inline after a nickname, so they stay compact.
const DIALECT_LABEL = { eg: 'Egyptian', hejazi: 'Hejazi', khaleeji: 'Khaleeji' };

// Where one dialect's copy of a progress key lives. Egyptian keeps the bare
// key so pre-dialect accounts need no migration; see the matching scoping
// layer in app.html.
function keyFor(base, dialect) {
  return dialect === 'eg' ? base : base + '__' + dialect;
}

const AWARDS = [
  { emoji: '💎', title: 'Diamond Champion' },
  { emoji: '🖤', title: 'Obsidian Master' },
  { emoji: '🤍', title: 'Pearl Prodigy' },
  { emoji: '💜', title: 'Amethyst Achiever' },
  { emoji: '💚', title: 'Emerald Expert' },
  { emoji: '❤️', title: 'Ruby Riser' },
  { emoji: '💙', title: 'Sapphire Scholar' },
  { emoji: '🥇', title: 'Gold Guardian' },
  { emoji: '🥈', title: 'Silver Striver' },
  { emoji: '🥉', title: 'Bronze Challenger' },
];

// Monday 00:00 UTC of the current week, plus a human key like "2026-W29".
function weekWindow(now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dow = (d.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  d.setUTCDate(d.getUTCDate() - dow);
  const start = d.getTime();
  // ISO week number
  const jan4 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round((start - (jan4.getTime() - ((jan4.getUTCDay() + 6) % 7) * 86400000)) / (7 * 86400000));
  return { start, key: `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}` };
}

function safeParse(v, fallback) {
  try { const x = JSON.parse(v); return x == null ? fallback : x; } catch (e) { return fallback; }
}

// One dialect's points for the week, read from that dialect's own three keys.
function scoreForDialect(state, dialect, weekStartMs) {
  const out = { minutes: 0, testPts: 0, streakBonus: 0, score: 0 };

  // Study time: tt_time is { 'YYYY-MM-DD': seconds }.
  const time = safeParse(state[keyFor('tt_time', dialect)], {});
  if (time && typeof time === 'object') {
    for (const [day, sec] of Object.entries(time)) {
      const t = Date.parse(day + 'T00:00:00Z');
      if (Number.isFinite(t) && t >= weekStartMs) out.minutes += Math.floor((Number(sec) || 0) / 60);
    }
  }

  // Tests: tt_scores is { subject: [ { pct, at, ... } ] }.
  const scores = safeParse(state[keyFor('tt_scores', dialect)], {});
  if (scores && typeof scores === 'object') {
    for (const attempts of Object.values(scores)) {
      if (!Array.isArray(attempts)) continue;
      for (const a of attempts) {
        if (a && Number(a.at) >= weekStartMs) out.testPts += Math.round((Number(a.pct) || 0) / 10);
      }
    }
  }

  // Streak: tt_streak is { streak, last: 'YYYY-MM-DD' }. Counts if the streak
  // reached into this week (last active on/after the Sunday before it).
  const st = safeParse(state[keyFor('tt_streak', dialect)], null);
  if (st && st.last) {
    const last = Date.parse(st.last + 'T00:00:00Z');
    if (Number.isFinite(last) && last >= weekStartMs - 86400000) {
      out.streakBonus = (Number(st.streak) || 0) * 5;
    }
  }

  out.score = out.minutes + out.testPts + out.streakBonus;
  return out;
}

// One user's weekly points across every dialect they studied in, plus which
// dialects contributed. `dialects` is ordered by points earned (largest
// first), so the dialect a student mainly works in reads first.
function scoreFor(state, weekStartMs) {
  const out = { minutes: 0, testPts: 0, streakBonus: 0, score: 0, dialects: [], byDialect: {} };
  if (!state) return out;

  const earned = [];
  DIALECTS.forEach((d) => {
    const s = scoreForDialect(state, d, weekStartMs);
    out.minutes += s.minutes;
    out.testPts += s.testPts;
    out.streakBonus += s.streakBonus;
    out.score += s.score;
    if (s.score > 0) { out.byDialect[d] = s.score; earned.push([d, s.score]); }
  });

  earned.sort((a, b) => b[1] - a[1] || DIALECTS.indexOf(a[0]) - DIALECTS.indexOf(b[0]));
  out.dialects = earned.map(([d]) => d);
  return out;
}

// One computation per minute per server instance is plenty — every request in
// between serves the cached board. `all` (which carries userIds for the "me"
// lookup) stays server-side; only the id-free `payload` is ever sent.
let cache = { at: 0, key: '', payload: null, all: [] };

function meView(entry) {
  if (!entry) return null;
  return {
    rank: entry.rank,
    score: entry.score,
    minutes: entry.minutes,
    testPts: entry.testPts,
    streakBonus: entry.streakBonus,
    award: entry.award || null,
    // Own row only: a student may see their own per-dialect split.
    dialects: (entry.dialects || []).map((d) => DIALECT_LABEL[d] || d),
    byDialect: Object.keys(entry.byDialect || {}).reduce((acc, d) => {
      acc[DIALECT_LABEL[d] || d] = entry.byDialect[d];
      return acc;
    }, {}),
  };
}

router.get('/', requireLogin, async (req, res) => {
  const { start, key } = weekWindow();
  if (cache.payload && cache.key === key && Date.now() - cache.at < 60000) {
    return res.json({ ...cache.payload, me: meView(cache.all.find(e => e.userId === req.session.userId)) });
  }

  const [users, progress] = await Promise.all([store.listAllUsers(), firebase.getAllProgress()]);

  const all = users
    .filter(u => (u.status || 'active') !== 'banned')
    .map(u => {
      const state = progress[u.id] || {};
      const s = scoreFor(state, start);
      const ob = safeParse(state.tt_onboard, {});
      return {
        userId: u.id,
        nick: (ob.nick || (u.name || '').trim().split(/\s+/)[0] || 'Student').slice(0, 24),
        emoji: ob.emoji || '🩺',
        ...s,
      };
    })
    .filter(e => e.score > 0)
    .sort((a, b) => b.score - a.score);

  all.forEach((e, i) => {
    e.rank = i + 1;
    if (i < AWARDS.length) e.award = AWARDS[i];
  });

  const payload = {
    week: key,
    weekStart: new Date(start).toISOString(),
    // Public rows carry nickname + emoji + total + the contributing dialects
    // only — never account ids, and never the per-dialect point split, which
    // would say more about another student's habits than the board needs to.
    top: all.slice(0, 10).map(({ userId, byDialect, dialects, ...pub }) => ({
      ...pub,
      dialects: (dialects || []).map((d) => DIALECT_LABEL[d] || d),
    })),
  };
  cache = { at: Date.now(), key, payload, all };

  res.json({ ...payload, me: meView(all.find(e => e.userId === req.session.userId)) });
});

module.exports = router;
