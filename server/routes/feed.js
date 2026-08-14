// The Tabib Talk Feed.
//
// Students share a phrase to the Feed; it is visible to everyone for seven
// days and then quietly stops appearing. Nothing is deleted — the original
// lesson phrase is untouched, and a bookmark someone made from a post keeps
// working forever, because bookmarks copy the phrase into that user's own
// bookmark list rather than pointing at the post.
//
// Sharing to the Feed spends the SAME weekly allowance as any other share, and
// is recorded in the same `shares` log, so there is one definition of who may
// share how often instead of two that drift apart.

const express = require('express');
const { nanoid } = require('nanoid');
const store = require('../data/store');
const { normaliseDialect } = require('../data/plans');
const sharesRoutes = require('./shares');

const router = express.Router();

// How long a post stays on the Feed.
const FEED_DAYS = 7;

function requireLogin(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Please log in first.' });
  next();
}

// A post carries the phrase itself rather than a reference to a lesson row.
//
// That is deliberate. The lesson content is edited over time and differs per
// dialect, and a post must keep showing what was actually shared — if the
// source phrase were reworded, a reference would silently rewrite history and
// break the Arabic/Franco pairing the sharer intended. The text is small, so
// storing it is cheaper than the reliability problem the alternative creates.
function publicPost(p, likes, meId) {
  const likeMap = (likes && likes[p.id]) || {};
  const likeIds = Object.keys(likeMap);
  return {
    id: p.id,
    // Who posted it, so their name can open their profile. This is a
    // deliberate reversal of the earlier rule that no account id ever left the
    // server: profiles are now a feature, and a name has to resolve to
    // somebody. It is only ever usable to read the same public profile the
    // name already implies — university, likes received and places won — and
    // /api/profile requires a signed-in caller.
    userRef: p.userId,
    name: p.userName || 'A student',
    dialect: p.dialect || 'eg',
    phraseEn: p.phraseEn || '',
    phraseAr: p.phraseAr || '',
    phraseFr: p.phraseFr || '',
    lesson: p.lesson || '',
    createdAt: p.createdAt,
    likes: likeIds.length,
    // Whether THIS caller has liked it. Never the list of who — that would
    // expose one student's activity to everyone.
    likedByMe: !!(meId && likeMap[meId]),
  };
}

// ---- The feed: the last seven days, newest first ----
router.get('/', requireLogin, async (req, res) => {
  try {
    // Two reads total regardless of how many posts there are — the like counts
    // come from one snapshot rather than a query per post.
    const [posts, likes] = await Promise.all([
      store.listFeedPosts(FEED_DAYS),
      store.getAllFeedLikes(),
    ]);
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    res.json({
      posts: posts.slice(0, limit).map(p => publicPost(p, likes, req.session.userId)),
      windowDays: FEED_DAYS,
    });
  } catch (err) {
    console.error('[feed] list failed:', err.message);
    res.status(500).json({ error: 'Could not load the feed right now.' });
  }
});

// ---- Share a phrase to the feed ----
router.post('/share', requireLogin, async (req, res) => {
  const { phraseEn, phraseAr, phraseFr, lesson, dialect } = req.body || {};
  if (!phraseEn && !phraseAr) return res.status(400).json({ error: 'Nothing to share.' });

  const user = await store.findUserById(req.session.userId);
  if (!user) return res.status(401).json({ error: 'Please log in first.' });

  // Same allowance as every other share, enforced here on the server. The
  // button is also disabled while a share is in flight, but that is a courtesy
  // — this is what actually holds.
  const limit = sharesRoutes.limitFor(user.tier);
  const used = await store.countRecentSharesForUser(user.id, sharesRoutes.SHARE_WINDOW_DAYS);
  if (used >= limit) {
    return res.status(403).json({
      error: `You've used all ${limit} of your shares for this week. Your allowance refreshes as your earlier shares pass seven days old.`,
      limit, used,
    });
  }

  const en = String(phraseEn || '').slice(0, 500);
  const ar = String(phraseAr || '').slice(0, 500);
  const fr = String(phraseFr || '').slice(0, 500);

  // Idempotency for the repeated-tap case: if this student already posted this
  // exact phrase in the last two minutes, return that post instead of creating
  // a second one. A genuine re-share later is still allowed — the product does
  // not forbid sharing the same phrase again another day.
  const recent = await store.listFeedPosts(1);
  const dup = recent.find(p =>
    p.userId === user.id &&
    p.phraseEn === en && p.phraseAr === ar &&
    Date.now() - Date.parse(p.createdAt || 0) < 120000
  );
  if (dup) {
    const likes = await store.getAllFeedLikes();
    return res.json({ ok: true, duplicate: true, post: publicPost(dup, likes, user.id), remaining: Math.max(0, limit - used) });
  }

  const now = new Date().toISOString();   // server-generated, never trusted from the client
  const post = await store.createFeedPost({
    id: nanoid(),
    userId: user.id,
    userName: (user.name || '').trim().split(/\s+/)[0] || 'A student',
    dialect: normaliseDialect(dialect || user.dialect),
    phraseEn: en, phraseAr: ar, phraseFr: fr,
    lesson: String(lesson || '').slice(0, 120),
    createdAt: now,
  });

  // Recorded in the same share log the allowance counts, so a Feed share and a
  // social share cost the same and appear together in the admin log.
  await store.createShare({
    id: nanoid(),
    userId: user.id, userEmail: user.email, userName: user.name || '',
    tier: user.tier, target: 'feed',
    phraseEn: en, phraseAr: ar, phraseFr: fr,
    createdAt: now,
  });

  const likes = await store.getAllFeedLikes();
  res.json({ ok: true, post: publicPost(post, likes, user.id), remaining: Math.max(0, limit - used - 1) });
});

// ---- Like / unlike ----
// The like is stored under the liker's own user id, so two people liking at the
// same moment write different keys and neither can overwrite the other, and the
// same person liking twice is a no-op rather than a double count. No
// read-modify-write, so there is no lost update to guard against.
router.post('/:id/like', requireLogin, async (req, res) => {
  try {
    const post = await store.findFeedPost(req.params.id);
    if (!post) return res.status(404).json({ error: 'That post is no longer available.' });

    const liked = !!(req.body && req.body.liked);
    await store.setFeedLike(post.id, req.session.userId, liked);

    // Re-read so the number returned is the true count, not an optimistic guess.
    const likes = await store.getAllFeedLikes();
    const map = likes[post.id] || {};
    res.json({ ok: true, likes: Object.keys(map).length, likedByMe: !!map[req.session.userId] });
  } catch (err) {
    console.error('[feed] like failed:', err.message);
    res.status(500).json({ error: 'Could not save that just now.' });
  }
});

module.exports = router;
