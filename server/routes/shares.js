const express = require('express');
const { nanoid } = require('nanoid');
const store = require('../data/store');

const router = express.Router();

function requireLogin(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Please log in first.' });
  next();
}

// How many phrases each tier may share, in total, per account.
const SHARE_LIMITS = {
  explorer: 0,
  student: 2,
  professional: 5,
  lifetime: 5,
};

router.post('/record', requireLogin, async (req, res) => {
  const { phraseEn, phraseAr, phraseFr } = req.body || {};
  if (!phraseEn && !phraseAr) return res.status(400).json({ error: 'Nothing to share.' });

  const user = await store.findUserById(req.session.userId);
  const limit = SHARE_LIMITS[user.tier] != null ? SHARE_LIMITS[user.tier] : 0;
  const used = await store.countSharesForUser(user.id);

  if (used >= limit) {
    return res.status(403).json({
      error: limit === 0
        ? 'Sharing phrases isn\'t available on your current plan.'
        : `You've reached your sharing limit (${limit}) for your plan.`,
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
  const limit = SHARE_LIMITS[user.tier] != null ? SHARE_LIMITS[user.tier] : 0;
  const used = await store.countSharesForUser(user.id);
  res.json({ limit, used, remaining: Math.max(0, limit - used) });
});

module.exports = router;
