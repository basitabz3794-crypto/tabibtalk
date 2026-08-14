// The app's database, backed by the Firebase Realtime Database.
//
// This replaced a local JSON file (server/data/db.json). That worked fine on a
// normal server with a disk, but Vercel's filesystem is read-only and
// per-invocation, so every write failed there. Firebase gives us a real shared
// store that any number of serverless instances can use.
//
// Everything else calls only the functions exported here, so this is the one
// file that knows where data lives. The names and semantics match the old JSON
// version — the difference is that every function is now async, since a network
// round-trip is involved.
//
// Layout (collections are keyed by record id, not arrays — RTDB has no arrays):
//   users/{id}, manualProofs/{id}, resetRequests/{id}, recommendations/{id},
//   devices/{id}, notifications/{id}, shares/{id}, interests/{id}
//   planOverrides, paymentConfig, fxConfig, adConfig   (single config objects)
//   progress/{userId}                                  (per-user app state)
//   sessions/{sid}                                     (login sessions)

const firebase = require('./firebase');

function db() {
  if (!firebase.isEnabled()) {
    throw new Error('Firebase is not configured: ' + (firebase.whyDisabled() || 'unknown reason'));
  }
  return firebase.database();
}

// RTDB rejects `undefined`. For updates, undefined means "remove this field",
// which RTDB spells as null; for new records we just drop empty fields.
function forUpdate(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) out[k] = (v === undefined ? null : v);
  return out;
}
function forCreate(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) if (v !== undefined) out[k] = v;
  return out;
}

// ---------- Generic collection helpers ----------
async function getAll(path) {
  const snap = await db().ref(path).once('value');
  const val = snap.val() || {};
  return Object.values(val);
}
async function getOne(path, id) {
  if (!id) return undefined;
  const snap = await db().ref(`${path}/${id}`).once('value');
  return snap.val() || undefined;
}
async function putOne(path, id, record) {
  await db().ref(`${path}/${id}`).set(forCreate(record));
  return record;
}
async function patchOne(path, id, patch) {
  const ref = db().ref(`${path}/${id}`);
  const existing = (await ref.once('value')).val();
  if (!existing) return null;
  await ref.update(forUpdate(patch));
  return (await ref.once('value')).val();
}
// Returns false when there was nothing there, so callers can answer 404 rather
// than reporting a delete that never happened.
async function removeOne(path, id) {
  if (!id) return false;
  const ref = db().ref(`${path}/${id}`);
  const existing = (await ref.once('value')).val();
  if (!existing) return false;
  await ref.remove();
  return true;
}

// The JSON store returned newest-first by reversing insertion order. RTDB has
// no insertion order to rely on, so sort on each record's own timestamp.
function newestFirst(list, ...fields) {
  return list.slice().sort((a, b) => {
    const ta = fields.map(f => a[f]).find(Boolean) || '';
    const tb = fields.map(f => b[f]).find(Boolean) || '';
    return String(tb).localeCompare(String(ta));
  });
}

// ---------- Users ----------
// Queries use orderByChild, which works without an index but warns and filters
// server-side-less. Add this to your database rules to make them cheap:
//   "users": { ".indexOn": ["emailLower", "firebaseUid"] }
async function findUserByEmail(email) {
  if (!email) return undefined;
  const snap = await db().ref('users').orderByChild('emailLower').equalTo(String(email).toLowerCase().trim()).once('value');
  const val = snap.val() || {};
  return Object.values(val)[0];
}

async function findUserById(id) {
  return getOne('users', id);
}

// Firebase Auth is the source of truth for identity; this maps a Firebase uid
// back to the local record that holds tier/plan/device state.
async function findUserByFirebaseUid(uid) {
  if (!uid) return undefined;
  const snap = await db().ref('users').orderByChild('firebaseUid').equalTo(uid).once('value');
  const val = snap.val() || {};
  return Object.values(val)[0];
}

async function createUser(user) {
  // emailLower exists purely so lookups can be case-insensitive: RTDB queries
  // are exact-match, unlike the old JSON store's toLowerCase() comparison.
  const record = { ...user, emailLower: String(user.email || '').toLowerCase().trim() };
  await putOne('users', user.id, record);
  return record;
}

async function updateUser(id, patch) {
  const p = { ...patch };
  if (p.email) p.emailLower = String(p.email).toLowerCase().trim();
  return patchOne('users', id, p);
}

async function listAllUsers() {
  return newestFirst(await getAll('users'), 'createdAt');
}

// ---------- Manual payment proofs (InstaPay, UPI, PayPal, any future method) ----------
async function createManualProof(proof) {
  return putOne('manualProofs', proof.id, proof);
}
async function listPendingManualProofs(method) {
  const all = (await getAll('manualProofs')).filter(p => p.status === 'pending');
  return newestFirst(method ? all.filter(p => p.method === method) : all, 'submittedAt');
}
async function listAllManualProofs(method) {
  const all = await getAll('manualProofs');
  return newestFirst(method ? all.filter(p => p.method === method) : all, 'submittedAt');
}
async function findManualProof(id) {
  return getOne('manualProofs', id);
}
async function updateManualProof(id, patch) {
  return patchOne('manualProofs', id, patch);
}

// ---------- Password reset requests ----------
// Kept for the admin hub's history. Firebase Auth sends reset emails itself
// now, so nothing new is written here.
async function createResetRequest(reqObj) {
  return putOne('resetRequests', reqObj.id, reqObj);
}
async function listResetRequests(status) {
  const all = newestFirst(await getAll('resetRequests'), 'requestedAt');
  return status ? all.filter(r => r.status === status) : all;
}
async function findResetRequest(id) {
  return getOne('resetRequests', id);
}
async function findResetRequestByToken(token) {
  return (await getAll('resetRequests')).find(r => r.token === token);
}
async function updateResetRequest(id, patch) {
  return patchOne('resetRequests', id, patch);
}

// ---------- Recommendations / feedback ----------
async function createRecommendation(rec) {
  return putOne('recommendations', rec.id, rec);
}
async function listRecommendations() {
  return newestFirst(await getAll('recommendations'), 'submittedAt');
}

// ---------- Device tracking (max-2-devices enforcement + history) ----------
async function listDevicesForUser(userId) {
  return (await getAll('devices')).filter(d => d.userId === userId);
}
async function findDevice(userId, deviceId) {
  return (await getAll('devices')).find(d => d.userId === userId && d.deviceId === deviceId);
}
async function createDevice(dev) {
  return putOne('devices', dev.id, dev);
}
async function updateDevice(userId, deviceId, patch) {
  const dev = await findDevice(userId, deviceId);
  if (!dev) return null;
  return patchOne('devices', dev.id, patch);
}
async function listAllDevices() {
  return newestFirst(await getAll('devices'), 'firstSeen');
}

// ---------- Deprecated InstaPay-only aliases (kept for compatibility) ----------
async function createInstapayProof(proof) { return createManualProof({ ...proof, method: proof.method || 'instapay' }); }
async function listPendingInstapayProofs() { return listPendingManualProofs('instapay'); }
async function listAllInstapayProofs() { return listAllManualProofs('instapay'); }
async function findInstapayProof(id) { return findManualProof(id); }
async function updateInstapayProof(id, patch) { return updateManualProof(id, patch); }

// ---------- Per-user app state (streak, time spent, course progress, bookmarks,
// saved questions, test scores — everything the app stores client-side under its
// 'tt_' key prefix) ----------
async function getAppState(userId) {
  return firebase.getProgress(userId);
}
async function mergeAppState(userId, patch) {
  return firebase.mergeProgress(userId, patch);
}

// ---------- Broadcast notifications (admin -> every user) ----------
async function createNotification(notif) {
  return putOne('notifications', notif.id, notif);
}
async function listNotifications() {
  return newestFirst(await getAll('notifications'), 'createdAt');
}
async function deleteNotification(id) {
  return removeOne('notifications', id);
}

// ---------- Phrase shares (rate-limited per tier, logged for admin) ----------
async function createShare(share) {
  return putOne('shares', share.id, share);
}
async function countSharesForUser(userId) {
  return (await getAll('shares')).filter(s => s.userId === userId).length;
}
async function listShares() {
  return newestFirst(await getAll('shares'), 'createdAt');
}

// Shares made in the last `days` days. The sharing allowance is a rolling
// window rather than a lifetime cap, and it matches how long a Feed post stays
// visible: a phrase counts against the allowance for exactly as long as it is
// on the Feed.
async function countRecentSharesForUser(userId, days) {
  const since = Date.now() - days * 86400000;
  return (await getAll('shares')).filter(s =>
    s.userId === userId && Date.parse(s.createdAt || 0) >= since
  ).length;
}

// ---------- Personal notifications ----------
//
// The existing notifications collection is a BROADCAST from the admin to
// everyone, and the bell reads all of it. A friend request has to reach one
// person, so it lives under that person's id instead. Both are merged when the
// bell is opened, so there is one notification surface rather than two.
//
// Kept separate rather than adding a userId to the broadcast collection: every
// student would then have to read and filter the whole collection, which gets
// worse as the site grows.
async function addUserNotification(userId, notif) {
  await db().ref(`userNotifications/${userId}/${notif.id}`).set(notif);
  return notif;
}
async function listUserNotifications(userId) {
  const snap = await db().ref(`userNotifications/${userId}`).once('value');
  return newestFirst(Object.values(snap.val() || {}), 'createdAt');
}
async function patchUserNotification(userId, id, patch) {
  const ref = db().ref(`userNotifications/${userId}/${id}`);
  const cur = (await ref.once('value')).val();
  if (!cur) return null;
  await ref.update(patch);
  return Object.assign({}, cur, patch);
}
async function markUserNotificationsRead(userId) {
  const snap = await db().ref(`userNotifications/${userId}`).once('value');
  const all = snap.val() || {};
  const now = new Date().toISOString();
  const updates = {};
  Object.keys(all).forEach((k) => { if (!all[k].readAt) updates[`${k}/readAt`] = now; });
  if (Object.keys(updates).length) await db().ref(`userNotifications/${userId}`).update(updates);
  return Object.keys(updates).length;
}

// ---------- Friends ----------
//
// A friendship is stored twice, once under each person — friends/<a>/<b> and
// friends/<b>/<a>. Writing both sides means "who are my friends" is a single
// read of one node instead of a scan of every friendship in the system, and
// because the friend's id is the KEY, accepting the same request twice is
// idempotent rather than creating a duplicate.
async function addFriendEdge(userId, friendId, record) {
  await db().ref(`friends/${userId}/${friendId}`).set(record);
}
async function removeFriendEdge(userId, friendId) {
  await db().ref(`friends/${userId}/${friendId}`).remove();
}
async function listFriendIds(userId) {
  const snap = await db().ref(`friends/${userId}`).once('value');
  return Object.entries(snap.val() || {}).map(([id, v]) => ({ id, since: v && v.since }));
}
async function areFriends(a, b) {
  const snap = await db().ref(`friends/${a}/${b}`).once('value');
  return snap.exists();
}

async function createFriendRequest(reqRec) {
  return putOne('friendRequests', reqRec.id, reqRec);
}
async function findFriendRequest(id) {
  return getOne('friendRequests', id);
}
async function updateFriendRequest(id, patch) {
  return patchOne('friendRequests', id, patch);
}
// Any request still awaiting an answer between two people, in either
// direction — used to stop a second request being sent while one is open.
async function pendingRequestBetween(a, b) {
  const all = await getAll('friendRequests');
  return all.find(r => r.status === 'pending' &&
    ((r.fromId === a && r.toId === b) || (r.fromId === b && r.toId === a)));
}
async function listPendingRequestsFor(userId) {
  return (await getAll('friendRequests')).filter(r => r.status === 'pending' && r.toId === userId);
}

// ---------- Weekly results history ----------
//
// The leaderboard has always been computed live for the current week and then
// forgotten, so there was no record of who won what. A profile that shows "3rd
// place, week 33 of 2026" needs one, so each week's top ten is written down as
// it is computed.
//
// Keyed by the week ("2026-W33"), so re-computing the same week overwrites its
// own record rather than accumulating duplicates — the write is idempotent and
// costs one record per week.
async function saveWeekResult(week, record) {
  return putOne('awardHistory', week, record);
}
async function listWeekResults() {
  return newestFirst(await getAll('awardHistory'), 'weekStart');
}

// ---------- Tabib Talk Feed ----------
// A feed post is a share that was published internally. It is stored
// separately from `shares` so the existing share log and its limits are
// untouched, and so the Feed can be read without pulling unrelated records.
async function createFeedPost(post) {
  return putOne('feed', post.id, post);
}

// Only the visible window is ever read. Feed posts are never deleted — they
// simply stop being returned once they are older than `days`, so a bookmark
// made from one keeps working forever.
async function listFeedPosts(days) {
  const since = Date.now() - days * 86400000;
  const all = await getAll('feed');
  return newestFirst(all.filter(p => Date.parse(p.createdAt || 0) >= since), 'createdAt');
}

async function findFeedPost(id) {
  return getOne('feed', id);
}

// Likes are stored as feedLikes/<postId>/<userId> = timestamp.
//
// The user id IS the key, which is what makes this correct under concurrency:
// two people liking at the same moment write two different keys and neither can
// overwrite the other, and the same person liking twice writes the same key
// twice — so a double-tap or a retried request cannot inflate the count. No
// read-modify-write, so no lost updates and no transaction needed.
async function setFeedLike(postId, userId, liked) {
  const ref = db().ref(`feedLikes/${postId}/${userId}`);
  if (liked) await ref.set(new Date().toISOString());
  else await ref.remove();
  return liked;
}

// One read for every post's likes, so rendering the Feed is not N+1.
async function getAllFeedLikes() {
  const snap = await db().ref('feedLikes').once('value');
  return snap.val() || {};
}

// ---------- Single config objects ----------
async function getConfig(path) {
  const snap = await db().ref(path).once('value');
  return snap.val() || {};
}
async function patchConfig(path, patch) {
  await db().ref(path).update(forUpdate(patch));
  return getConfig(path);
}

// Plan config overrides (admin "Developer" section: live price/duration edits)
async function getPlanOverrides() { return getConfig('planOverrides'); }
async function setPlanOverride(planId, patch) {
  await db().ref(`planOverrides/${planId}`).update(forUpdate(patch));
  return getConfig(`planOverrides/${planId}`);
}

// Payment gateway config (admin "Developer" section: live PayPal/InstaPay/UPI edits)
async function getPaymentConfig() { return getConfig('paymentConfig'); }
async function setPaymentConfig(patch) { return patchConfig('paymentConfig', patch); }

// FX config: admin-editable USD->INR / USD->EGP rates. Empty by default, in
// which case plans.js falls back to its built-in reference rates.
async function getFxConfig() { return getConfig('fxConfig'); }
async function setFxConfig(patch) { return patchConfig('fxConfig', patch); }

// Advertisement box config (admin-editable)
async function getAdConfig() { return getConfig('adConfig'); }
async function setAdConfig(patch) { return patchConfig('adConfig', patch); }

// Site-wide switches (admin "Developer" section). Today just plansEnabled:
// when false, the plans/payment surface is hidden everywhere and every
// signed-in user is treated as lifetime by the app.
async function getSiteConfig() { return getConfig('siteConfig'); }
async function setSiteConfig(patch) { return patchConfig('siteConfig', patch); }

// ---------- Device-limit appeals ----------
// Filed from the login page when someone is blocked by the max-devices rule,
// so the admin can judge the story (new phone, cyber café, shared account…)
// in the Devices & Violations tab and permit the device or raise the limit.
async function createDeviceAppeal(appeal) {
  return putOne('deviceAppeals', appeal.id, appeal);
}
async function listDeviceAppeals(status) {
  const all = newestFirst(await getAll('deviceAppeals'), 'submittedAt');
  return status ? all.filter(a => a.status === status) : all;
}
async function findDeviceAppeal(id) {
  return getOne('deviceAppeals', id);
}
async function updateDeviceAppeal(id, patch) {
  return patchOne('deviceAppeals', id, patch);
}

// ---------- Advertisement interests ----------
// Every "I'm interested" tap on the in-app promo box, captured with the user's
// contact details at the moment they responded.
async function createInterest(rec) {
  return putOne('interests', rec.id, rec);
}
async function listInterests() {
  return newestFirst(await getAll('interests'), 'respondedAt', 'createdAt');
}
async function findInterest(userId, adId) {
  return (await getAll('interests')).find(i => i.userId === userId && i.adId === adId);
}

module.exports = {
  findUserByEmail, findUserById, findUserByFirebaseUid, createUser, updateUser, listAllUsers,
  createManualProof, listPendingManualProofs, listAllManualProofs, findManualProof, updateManualProof,
  createResetRequest, listResetRequests, findResetRequest, findResetRequestByToken, updateResetRequest,
  createRecommendation, listRecommendations,
  listDevicesForUser, findDevice, createDevice, updateDevice, listAllDevices,
  getAppState, mergeAppState,
  createNotification, listNotifications, deleteNotification,
  createShare, countSharesForUser, countRecentSharesForUser, listShares,
  createFeedPost, listFeedPosts, findFeedPost, setFeedLike, getAllFeedLikes,
  saveWeekResult, listWeekResults,
  addUserNotification, listUserNotifications, patchUserNotification, markUserNotificationsRead,
  addFriendEdge, removeFriendEdge, listFriendIds, areFriends,
  createFriendRequest, findFriendRequest, updateFriendRequest,
  pendingRequestBetween, listPendingRequestsFor,
  getPlanOverrides, setPlanOverride,
  getPaymentConfig, setPaymentConfig,
  getFxConfig, setFxConfig,
  createInterest, listInterests, findInterest,
  getAdConfig, setAdConfig,
  getSiteConfig, setSiteConfig,
  createDeviceAppeal, listDeviceAppeals, findDeviceAppeal, updateDeviceAppeal,
  // deprecated aliases
  createInstapayProof, listPendingInstapayProofs, listAllInstapayProofs, findInstapayProof, updateInstapayProof,
};
