// Friendships.
//
// Send a request, the other person answers it from their notification bell, and
// once accepted both sides can see each other in My Account. Either side can
// unfriend, which removes it for both.
//
// Every decision here is made on the server from the session's own user id. A
// browser cannot befriend on someone else's behalf, answer a request addressed
// to another student, or unfriend a pair it is not part of.

const express = require('express');
const { nanoid } = require('nanoid');
const store = require('../data/store');

const router = express.Router();

function requireLogin(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Please log in first.' });
  next();
}

function firstName(u) {
  return ((u && u.name) || '').trim().split(/\s+/)[0] || 'Student';
}

// The small amount of a person shown in a friends list or a request card.
function brief(u) {
  return u ? { id: u.id, name: firstName(u), college: (u.college || '').trim() } : null;
}

// Close any request still open between two people, in either direction, and
// take the buttons off whatever card is showing it.
//
// A request should never outlive the question it asks. Two people can end up
// friends while an older request between them is still pending — they crossed
// over, or they unfriended and re-added — and that leaves a card in someone's
// bell inviting them to befriend a person they are already friends with.
// Answering it would then have no effect, which is worse than it not being
// there. Called wherever a friendship starts or is found to already exist.
async function resolveStaleRequests(a, b, outcome, exceptId) {
  const all = await store.listPendingRequestsBetween(a, b);
  await Promise.all(all.map(async (r) => {
    if (exceptId && r.id === exceptId) return;
    await store.updateFriendRequest(r.id, {
      status: outcome, respondedAt: new Date().toISOString(),
    });
    // The card lives with whoever was asked.
    const cards = await store.listUserNotifications(r.toId);
    const card = cards.find(n => n.requestId === r.id && !n.actioned);
    if (card) {
      await store.patchUserNotification(r.toId, card.id, {
        actioned: 'accepted',        // they are friends — that is the outcome
        readAt: card.readAt || new Date().toISOString(),
      });
    }
  }));
}

// ---- Where do I stand with this person? ----
// Drives the single button on their profile: Add friend / Requested / Respond /
// Friends. Computed rather than stored, so it cannot go stale.
router.get('/status/:id', requireLogin, async (req, res) => {
  const me = req.session.userId, them = req.params.id;
  if (me === them) return res.json({ status: 'self' });
  if (await store.areFriends(me, them)) return res.json({ status: 'friends' });
  const pending = await store.pendingRequestBetween(me, them);
  if (!pending) return res.json({ status: 'none' });
  return res.json({
    status: pending.fromId === me ? 'requested' : 'awaiting-me',
    requestId: pending.id,
  });
});

// ---- Send a friend request ----
router.post('/request', requireLogin, async (req, res) => {
  const me = req.session.userId;
  const toId = (req.body || {}).toId;
  if (!toId) return res.status(400).json({ error: 'Who would you like to add?' });
  if (toId === me) return res.status(400).json({ error: 'You cannot add yourself.' });

  const [meUser, them] = await Promise.all([store.findUserById(me), store.findUserById(toId)]);
  if (!them || (them.status || 'active') === 'banned') {
    return res.status(404).json({ error: 'That student could not be found.' });
  }
  if (await store.areFriends(me, toId)) {
    // Already friends, so any request still sitting open between the two of us
    // is meaningless. Close it rather than leaving a card in someone's bell
    // asking them to befriend a person they are already friends with.
    await resolveStaleRequests(me, toId, 'superseded');
    return res.json({ ok: true, status: 'friends' });
  }
  // One open request at a time between two people, whichever way it points —
  // so tapping twice, or both people adding each other at once, cannot produce
  // two competing requests.
  const existing = await store.pendingRequestBetween(me, toId);
  if (existing) {
    return res.json({
      ok: true,
      status: existing.fromId === me ? 'requested' : 'awaiting-me',
      requestId: existing.id,
    });
  }

  const now = new Date().toISOString();
  const reqRec = await store.createFriendRequest({
    id: nanoid(), fromId: me, toId, status: 'pending', createdAt: now,
  });

  // Delivered to that student's own bell, with the buttons to answer it.
  await store.addUserNotification(toId, {
    id: nanoid(),
    type: 'friend-request',
    title: firstName(meUser) + ' would like to be your friend',
    body: (meUser.college || '').trim(),
    requestId: reqRec.id,
    fromId: me,
    createdAt: now,
    readAt: null,
    actioned: null,
  });

  res.json({ ok: true, status: 'requested', requestId: reqRec.id });
});

// ---- Accept or decline ----
router.post('/respond', requireLogin, async (req, res) => {
  const me = req.session.userId;
  const { requestId, accept } = req.body || {};
  const reqRec = await store.findFriendRequest(requestId);
  if (!reqRec) return res.status(404).json({ error: 'That request no longer exists.' });
  // Only the person it was sent to may answer it.
  if (reqRec.toId !== me) return res.status(403).json({ error: 'That request is not yours to answer.' });
  if (reqRec.status !== 'pending') {
    return res.json({ ok: true, status: reqRec.status, alreadyAnswered: true });
  }

  const now = new Date().toISOString();
  await store.updateFriendRequest(reqRec.id, {
    status: accept ? 'accepted' : 'rejected',
    respondedAt: now,
  });

  // Mark the notification answered so the buttons are replaced by the outcome
  // rather than staying live on an already-decided request.
  const mine = await store.listUserNotifications(me);
  const card = mine.find(n => n.requestId === reqRec.id);
  if (card) {
    await store.patchUserNotification(me, card.id, {
      actioned: accept ? 'accepted' : 'rejected',
      readAt: card.readAt || now,
    });
  }

  if (!accept) return res.json({ ok: true, status: 'rejected' });

  // Written under both people, so each can list their friends with one read.
  await Promise.all([
    store.addFriendEdge(me, reqRec.fromId, { since: now }),
    store.addFriendEdge(reqRec.fromId, me, { since: now }),
  ]);

  // Now that they are friends, close anything else still open between them —
  // a crossed request, or one left over from before they last unfriended.
  await resolveStaleRequests(me, reqRec.fromId, 'superseded', reqRec.id);

  // Tell the sender it was accepted. A decline is deliberately NOT announced —
  // there is no kind way to send that, and it invites pestering.
  const meUser = await store.findUserById(me);
  await store.addUserNotification(reqRec.fromId, {
    id: nanoid(),
    type: 'friend-accepted',
    title: firstName(meUser) + ' accepted your friend request',
    body: (meUser.college || '').trim(),
    fromId: me,
    createdAt: now,
    readAt: null,
    actioned: null,
  });

  res.json({ ok: true, status: 'friends' });
});

// ---- Ignore a request ----
// Distinct from declining. A decline is an answer; ignoring is choosing not to
// give one. Neither is announced to the sender, but the sender's own list shows
// which happened, so they are not left waiting on something already dealt with.
router.post('/ignore', requireLogin, async (req, res) => {
  const me = req.session.userId;
  const reqRec = await store.findFriendRequest((req.body || {}).requestId);
  if (!reqRec) return res.status(404).json({ error: 'That request no longer exists.' });
  if (reqRec.toId !== me) return res.status(403).json({ error: 'That request is not yours to answer.' });
  if (reqRec.status !== 'pending') return res.json({ ok: true, status: reqRec.status, alreadyAnswered: true });

  const now = new Date().toISOString();
  await store.updateFriendRequest(reqRec.id, { status: 'ignored', respondedAt: now });
  const mine = await store.listUserNotifications(me);
  const card = mine.find(n => n.requestId === reqRec.id);
  if (card) await store.patchUserNotification(me, card.id, { actioned: 'ignored', readAt: card.readAt || now });
  res.json({ ok: true, status: 'ignored' });
});

// Searching means scanning every account, and a student types several letters
// before they find who they mean. Reading the whole table for each of those is
// a round trip we can skip: names and colleges do not change between
// keystrokes. Half a minute old is fresh enough here — the only cost of a stale
// entry is that somebody who signed up in the last few seconds is not yet
// findable, and they will be on the next search.
let searchCache = { at: 0, users: null };
const SEARCH_CACHE_MS = 30000;
async function searchableUsers() {
  const now = Date.now();
  if (searchCache.users && (now - searchCache.at) < SEARCH_CACHE_MS) return searchCache.users;
  const users = await store.listAllUsers();
  searchCache = { at: now, users };
  return users;
}

// ---- Find someone ----
// Matches on name or college, because a student looking for a classmate knows
// one or the other. Banned accounts and the searcher themselves are left out,
// and so is anyone already a friend — there is nothing to do with them here.
//
// Results carry a first name and a college and nothing else, the same shape a
// profile card shows, so searching reveals no more than looking at a post does.
router.get('/search', requireLogin, async (req, res) => {
  const me = req.session.userId;
  const q = String(req.query.q || '').trim().toLowerCase();
  if (q.length < 2) return res.json({ results: [] });

  const [all, friendIds] = await Promise.all([
    searchableUsers(),
    store.listFriendIds(me),
  ]);
  const already = new Set(friendIds.map(f => f.id));

  const hits = all.filter((u) => {
    if (!u || u.id === me || already.has(u.id)) return false;
    if ((u.status || 'active') === 'banned') return false;
    const name = String(u.name || '').toLowerCase();
    const college = String(u.college || '').toLowerCase();
    return name.indexOf(q) >= 0 || college.indexOf(q) >= 0;
  });

  // Someone whose name starts with what was typed is far more likely to be who
  // was meant than someone who merely contains it somewhere.
  hits.sort((a, b) => {
    const an = String(a.name || '').toLowerCase(), bn = String(b.name || '').toLowerCase();
    const as = an.indexOf(q) === 0 ? 0 : 1, bs = bn.indexOf(q) === 0 ? 0 : 1;
    return as !== bs ? as - bs : an.localeCompare(bn);
  });

  // Pending requests come back with each result so the button can say Requested
  // or Respond instead of offering to send a second one.
  const top = hits.slice(0, 20);
  const states = await Promise.all(top.map(u => store.pendingRequestBetween(me, u.id)));
  res.json({
    results: top.map((u, i) => Object.assign(brief(u), {
      status: !states[i] ? 'none' : (states[i].fromId === me ? 'requested' : 'awaiting-me'),
      requestId: states[i] ? states[i].id : null,
    })),
  });
});

// ---- Requests I sent, and requests sent to me ----
router.get('/requests', requireLogin, async (req, res) => {
  const me = req.session.userId;
  const [sent, received] = await Promise.all([
    store.listRequestsSentBy(me),
    store.listRequestsSentTo(me),
  ]);

  const ids = [...new Set(sent.map(r => r.toId).concat(received.map(r => r.fromId)))];
  const people = await Promise.all(ids.map(id => store.findUserById(id)));
  const by = {};
  ids.forEach((id, i) => { by[id] = brief(people[i]); });

  // 'superseded' is an internal tidy-up — the two are friends by some other
  // route — so it is shown as what it means rather than as jargon.
  const label = s => (s === 'pending' ? 'Sent'
    : s === 'accepted' || s === 'superseded' ? 'Accepted'
    : s === 'rejected' ? 'Rejected'
    : s === 'ignored' ? 'Ignored' : s);

  res.json({
    sent: sent.map(r => ({
      id: r.id, person: by[r.toId], status: r.status, label: label(r.status),
      createdAt: r.createdAt, respondedAt: r.respondedAt || null,
    })).filter(r => r.person),
    received: received.map(r => ({
      id: r.id, person: by[r.fromId], status: r.status,
      label: r.status === 'pending' ? 'Waiting for you' : label(r.status),
      createdAt: r.createdAt, respondedAt: r.respondedAt || null,
    })).filter(r => r.person),
  });
});

// ---- My friends ----
router.get('/', requireLogin, async (req, res) => {
  const edges = await store.listFriendIds(req.session.userId);
  const people = await Promise.all(edges.map(e => store.findUserById(e.id)));
  const friends = edges.map((e, i) => {
    const b = brief(people[i]);
    return b ? Object.assign(b, { since: e.since }) : null;
  }).filter(Boolean);
  friends.sort((a, b) => a.name.localeCompare(b.name));
  res.json({ friends });
});

// ---- Unfriend ----
// Removes both sides. Silent by design: the other person is not notified that
// they were removed.
router.delete('/:id', requireLogin, async (req, res) => {
  const me = req.session.userId, them = req.params.id;
  await Promise.all([
    store.removeFriendEdge(me, them),
    store.removeFriendEdge(them, me),
  ]);
  res.json({ ok: true });
});

module.exports = router;
