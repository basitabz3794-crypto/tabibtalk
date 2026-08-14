const express = require('express');
const { nanoid } = require('nanoid');
const store = require('../data/store');

const router = express.Router();

function requireLogin(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Please log in first.' });
  next();
}

// How many phrases each tier may share PER WEEK.
//
// This used to be a lifetime cap per account, which meant a long-standing
// subscriber eventually ran out for good. It is now a rolling seven-day
// allowance, so it refreshes continuously and matches how long a Feed post
// stays visible — a phrase counts against the allowance for exactly as long as
// it is on the Feed.
const SHARE_WINDOW_DAYS = 7;
const SHARE_LIMITS = {
  explorer: 1,
  basic: 3,
  student: 5,
  professional: 10,
  advanced: 10,
  lifetime: 10,
};
// Unknown/absent tier falls back to the free baseline rather than to zero, so a
// tier added later can never silently lock sharing out entirely.
function limitFor(tier) {
  return SHARE_LIMITS[tier] != null ? SHARE_LIMITS[tier] : SHARE_LIMITS.explorer;
}
router.post('/record', requireLogin, async (req, res) => {
  const { phraseEn, phraseAr, phraseFr } = req.body || {};
  if (!phraseEn && !phraseAr) return res.status(400).json({ error: 'Nothing to share.' });

  const user = await store.findUserById(req.session.userId);
  const limit = limitFor(user.tier);
  const used = await store.countRecentSharesForUser(user.id, SHARE_WINDOW_DAYS);

  if (used >= limit) {
    return res.status(403).json({
      error: `You've used all ${limit} of your shares for this week. Your allowance refreshes as your earlier shares pass seven days old.`,
      limit, used,
    });
  }

  const share = await store.createShare({
    id: nanoid(),
    userId: user.id,
    userEmail: user.email,
    userName: user.name || '',
    tier: user.tier,
    phraseEn: (phraseEn || '').slice(0, 500),
    phraseAr: (phraseAr || '').slice(0, 500),
    phraseFr: (phraseFr || '').slice(0, 500),
    createdAt: new Date().toISOString(),
  });

  res.json({ ok: true, remaining: limit - used - 1, share });
});

// Lets the frontend show "X of Y shares used" without needing to attempt a share first.
router.get('/status', requireLogin, async (req, res) => {
  const user = await store.findUserById(req.session.userId);
  const limit = limitFor(user.tier);
  const used = await store.countRecentSharesForUser(user.id, SHARE_WINDOW_DAYS);
  res.json({ limit, used, remaining: Math.max(0, limit - used), windowDays: SHARE_WINDOW_DAYS });
});

module.exports = router;
// Exported so the Feed route enforces exactly the same allowance — one
// definition of who may share how often, rather than two that can drift.
module.exports.SHARE_LIMITS = SHARE_LIMITS;
module.exports.SHARE_WINDOW_DAYS = SHARE_WINDOW_DAYS;
module.exports.limitFor = limitFor;
