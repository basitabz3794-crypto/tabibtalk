const express = require('express');
const store = require('../data/store');

const router = express.Router();

function requireLogin(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Please log in first.' });
  next();
}

// ---- List broadcast notifications for the signed-in user, with an unread count ----
router.get('/me', requireLogin, (req, res) => {
  const user = store.findUserById(req.session.userId);
  const all = store.listNotifications().slice(0, 30); // most recent first, capped
  const lastSeen = user.lastNotifSeenAt ? new Date(user.lastNotifSeenAt).getTime() : 0;
  const unreadCount = all.filter(n => new Date(n.createdAt).getTime() > lastSeen).length;
  res.json({ notifications: all, unreadCount });
});

// ---- Mark all current notifications as read (called when the user opens the bell) ----
router.post('/mark-read', requireLogin, (req, res) => {
  store.updateUser(req.session.userId, { lastNotifSeenAt: new Date().toISOString() });
  res.json({ ok: true });
});

module.exports = router;
