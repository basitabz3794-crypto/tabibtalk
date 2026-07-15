const express = require('express');
const { nanoid } = require('nanoid');
const store = require('../data/store');

const router = express.Router();

function requireLogin(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Please log in first.' });
  next();
}

// ---- User submits a recommendation / piece of feedback ----
router.post('/submit', requireLogin, (req, res) => {
  const { message } = req.body || {};
  if (!message || !message.trim()) return res.status(400).json({ error: 'Please write something before submitting.' });
  const user = store.findUserById(req.session.userId);
  const rec = store.createRecommendation({
    id: nanoid(),
    userId: user.id,
    userEmail: user.email,
    userName: user.name || '',
    message: message.trim().slice(0, 4000),
    submittedAt: new Date().toISOString(),
  });
  res.json({ ok: true, id: rec.id });
});

module.exports = router;
