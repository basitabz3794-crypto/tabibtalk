const express = require('express');
const store = require('../data/store');

const router = express.Router();

function requireLogin(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Please log in first.' });
  next();
}

// ---- Everything in this student's bell, with an unread count ----
//
// Two sources, one surface: the admin's broadcasts (shared by everyone, read
// state tracked by a single lastNotifSeenAt timestamp) and this student's own
// personal notifications — friend requests and the like — which carry their own
// readAt because each is answered individually.
router.get('/me', requireLogin, async (req, res) => {
  const user = await store.findUserById(req.session.userId);
  const [broadcasts, personal] = await Promise.all([
    store.listNotifications(),
    store.listUserNotifications(req.session.userId),
  ]);

  const lastSeen = user.lastNotifSeenAt ? new Date(user.lastNotifSeenAt).getTime() : 0;
  const bc = broadcasts.slice(0, 30);
  const unreadBroadcasts = bc.filter(n => new Date(n.createdAt).getTime() > lastSeen).length;
  const unreadPersonal = personal.filter(n => !n.readAt).length;

  res.json({
    notifications: bc,
    personal: personal.slice(0, 30),
    unreadCount: unreadBroadcasts + unreadPersonal,
  });
});

// ---- Mark everything read (called when the user opens the bell) ----
router.post('/mark-read', requireLogin, async (req, res) => {
  await Promise.all([
    store.updateUser(req.session.userId, { lastNotifSeenAt: new Date().toISOString() }),
    // Personal ones are marked individually, so an unanswered friend request
    // stops counting as unread without losing its Accept/Decline buttons.
    store.markUserNotificationsRead(req.session.userId),
  ]);
  res.json({ ok: true });
});

module.exports = router;
