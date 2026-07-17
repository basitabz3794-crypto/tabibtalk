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
  createNotification, listNotifications,
  createShare, countSharesForUser, listShares,
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
