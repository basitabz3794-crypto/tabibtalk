// Public profile of another student.
//
// This is what opens when a name is tapped anywhere in the app — the Feed, the
// leaderboard, and later a friends list. It answers exactly three questions:
// where they study, how their phrases have been received, and what they have
// won. Nothing else about them is exposed.
//
// Everything here is derived server-side from records the student cannot edit,
// so none of it can be faked by a browser.

const express = require('express');
const store = require('../data/store');

const router = express.Router();

function requireLogin(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Please log in first.' });
  next();
}

// Only ever the first name, matching how the Feed and the leaderboard already
// address people. Full names are never published.
function firstName(user) {
  return (user.name || '').trim().split(/\s+/)[0] || 'Student';
}

router.get('/:id', requireLogin, async (req, res) => {
  try {
    const user = await store.findUserById(req.params.id);
    if (!user || (user.status || 'active') === 'banned') {
      return res.status(404).json({ error: 'That student could not be found.' });
    }

    const [allPosts, likes, history] = await Promise.all([
      // Every post they have ever made, not just the visible week — the total
      // is "likes they have ever received", so expired posts still count.
      store.listFeedPosts(36500),
      store.getAllFeedLikes(),
      store.listWeekResults(),
    ]);

    const theirPosts = allPosts.filter(p => p.userId === user.id);
    const likesReceived = theirPosts.reduce(
      (sum, p) => sum + Object.keys(likes[p.id] || {}).length, 0
    );

    // Every week they placed in the top ten, newest first. The week is carried
    // through so a profile can say which week and year a place was won, rather
    // than showing a medal with no context.
    const placings = [];
    history.forEach((wk) => {
      (wk.top || []).forEach((row) => {
        if (row.userId !== user.id) return;
        const d = new Date(wk.weekStart);
        placings.push({
          week: wk.week,
          year: isFinite(d) ? d.getUTCFullYear() : null,
          weekStart: wk.weekStart,
          rank: row.rank,
          score: row.score,
          award: row.award || null,
        });
      });
    });

    // "Best" is the highest place ever reached — the one worth showing first.
    const best = placings.reduce((b, p) => (!b || p.rank < b.rank ? p : b), null);

    res.json({
      profile: {
        id: user.id,
        name: firstName(user),
        college: (user.college || '').trim(),
        likesReceived,
        postCount: theirPosts.length,
        placings: placings.slice(0, 12),
        best,
        awardCount: placings.filter(p => p.award).length,
        isMe: user.id === req.session.userId,
      },
    });
  } catch (err) {
    console.error('[profile] failed:', err.message);
    res.status(500).json({ error: 'Could not load that profile right now.' });
  }
});

module.exports = router;
