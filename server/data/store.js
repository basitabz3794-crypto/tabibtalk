// A minimal JSON-file "database". Good enough to run today with zero setup;
// swap this module out for Postgres/Mongo later without touching route logic much,
// since everything else only calls the functions exported here.

const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'db.json');

function load() {
  if (!fs.existsSync(DB_PATH)) {
    const initial = { users: [], manualProofs: [], resetRequests: [], recommendations: [], devices: [], notifications: [], shares: [], planOverrides: {}, paymentConfig: {}, fxConfig: {}, interests: [], adConfig: {} };
    fs.writeFileSync(DB_PATH, JSON.stringify(initial, null, 2));
    return initial;
  }
  const data = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  // Backward-compatible migrations for older databases
  if (!data.manualProofs) {
    data.manualProofs = (data.instapayProofs || []).map(p => ({ ...p, method: p.method || 'instapay' }));
  }
  if (!data.resetRequests) data.resetRequests = [];
  if (!data.recommendations) data.recommendations = [];
  if (!data.devices) data.devices = [];
  if (!data.notifications) data.notifications = [];
  if (!data.shares) data.shares = [];
  if (!data.planOverrides) data.planOverrides = {};
  if (!data.paymentConfig) data.paymentConfig = {};
  if (!data.fxConfig) data.fxConfig = {};
  if (!data.interests) data.interests = [];
  if (!data.adConfig) data.adConfig = {};
  return data;
}

function save(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

// ---------- Users ----------
function findUserByEmail(email) {
  const db = load();
  return db.users.find(u => u.email.toLowerCase() === String(email).toLowerCase());
}

function findUserById(id) {
  const db = load();
  return db.users.find(u => u.id === id);
}

// Firebase Auth is the source of truth for identity; this maps a Firebase uid
// back to the local record that holds tier/plan/device state.
function findUserByFirebaseUid(uid) {
  if (!uid) return undefined;
  const db = load();
  return db.users.find(u => u.firebaseUid === uid);
}

function createUser(user) {
  const db = load();
  db.users.push(user);
  save(db);
  return user;
}

function updateUser(id, patch) {
  const db = load();
  const idx = db.users.findIndex(u => u.id === id);
  if (idx === -1) return null;
  db.users[idx] = { ...db.users[idx], ...patch };
  save(db);
  return db.users[idx];
}

function listAllUsers() {
  const db = load();
  return db.users.slice().reverse();
}

// ---------- Manual payment proofs (InstaPay, UPI, PayPal, any future method) ----------
function createManualProof(proof) {
  const db = load();
  db.manualProofs = db.manualProofs || [];
  db.manualProofs.push(proof);
  save(db);
  return proof;
}

function listPendingManualProofs(method) {
  const db = load();
  const all = db.manualProofs || [];
  return method ? all.filter(p => p.status === 'pending' && p.method === method) : all.filter(p => p.status === 'pending');
}

function listAllManualProofs(method) {
  const db = load();
  const all = (db.manualProofs || []).slice().reverse();
  return method ? all.filter(p => p.method === method) : all;
}

function findManualProof(id) {
  const db = load();
  return (db.manualProofs || []).find(p => p.id === id);
}

function updateManualProof(id, patch) {
  const db = load();
  db.manualProofs = db.manualProofs || [];
  const idx = db.manualProofs.findIndex(p => p.id === id);
  if (idx === -1) return null;
  db.manualProofs[idx] = { ...db.manualProofs[idx], ...patch };
  save(db);
  return db.manualProofs[idx];
}

// ---------- Password reset requests ----------
function createResetRequest(reqObj) {
  const db = load();
  db.resetRequests.push(reqObj);
  save(db);
  return reqObj;
}
function listResetRequests(status) {
  const db = load();
  const all = db.resetRequests.slice().reverse();
  return status ? all.filter(r => r.status === status) : all;
}
function findResetRequest(id) {
  const db = load();
  return db.resetRequests.find(r => r.id === id);
}
function findResetRequestByToken(token) {
  const db = load();
  return db.resetRequests.find(r => r.token === token);
}
function updateResetRequest(id, patch) {
  const db = load();
  const idx = db.resetRequests.findIndex(r => r.id === id);
  if (idx === -1) return null;
  db.resetRequests[idx] = { ...db.resetRequests[idx], ...patch };
  save(db);
  return db.resetRequests[idx];
}

// ---------- Recommendations / feedback ----------
function createRecommendation(rec) {
  const db = load();
  db.recommendations.push(rec);
  save(db);
  return rec;
}
function listRecommendations() {
  const db = load();
  return db.recommendations.slice().reverse();
}

// ---------- Device tracking (max-2-devices enforcement + history) ----------
function listDevicesForUser(userId) {
  const db = load();
  return db.devices.filter(d => d.userId === userId);
}
function findDevice(userId, deviceId) {
  const db = load();
  return db.devices.find(d => d.userId === userId && d.deviceId === deviceId);
}
function createDevice(dev) {
  const db = load();
  db.devices.push(dev);
  save(db);
  return dev;
}
function updateDevice(userId, deviceId, patch) {
  const db = load();
  const idx = db.devices.findIndex(d => d.userId === userId && d.deviceId === deviceId);
  if (idx === -1) return null;
  db.devices[idx] = { ...db.devices[idx], ...patch };
  save(db);
  return db.devices[idx];
}
function listAllDevices() {
  const db = load();
  return db.devices.slice().reverse();
}

// ---------- Deprecated InstaPay-only aliases (kept for compatibility) ----------
function createInstapayProof(proof) { return createManualProof({ ...proof, method: proof.method || 'instapay' }); }
function listPendingInstapayProofs() { return listPendingManualProofs('instapay'); }
function listAllInstapayProofs() { return listAllManualProofs('instapay'); }
function findInstapayProof(id) { return findManualProof(id); }
function updateInstapayProof(id, patch) { return updateManualProof(id, patch); }

// ---------- Per-user app state (streak, time spent, course progress, bookmarks, saved
// questions — everything the app stores client-side under its 'tt_' key prefix) ----------
function getAppState(userId) {
  const user = findUserById(userId);
  return (user && user.appState) || {};
}
function mergeAppState(userId, patch) {
  const user = findUserById(userId);
  if (!user) return null;
  const merged = { ...(user.appState || {}), ...patch };
  return updateUser(userId, { appState: merged });
}

// ---------- Broadcast notifications (admin -> every user) ----------
function createNotification(notif) {
  const db = load();
  db.notifications.push(notif);
  save(db);
  return notif;
}
function listNotifications() {
  const db = load();
  return db.notifications.slice().reverse();
}

// ---------- Phrase shares (rate-limited per tier, logged for admin) ----------
function createShare(share) {
  const db = load();
  db.shares = db.shares || [];
  db.shares.push(share);
  save(db);
  return share;
}
function countSharesForUser(userId) {
  const db = load();
  return (db.shares || []).filter(s => s.userId === userId).length;
}
function listShares() {
  const db = load();
  return (db.shares || []).slice().reverse();
}

// ---------- Plan config overrides (admin "Developer" section: live price/duration edits) ----------
function getPlanOverrides() {
  const db = load();
  return db.planOverrides || {};
}
function setPlanOverride(planId, patch) {
  const db = load();
  db.planOverrides = db.planOverrides || {};
  db.planOverrides[planId] = { ...(db.planOverrides[planId] || {}), ...patch };
  save(db);
  return db.planOverrides[planId];
}

// ---------- Payment gateway config (admin "Developer" section: live PayPal/InstaPay/UPI edits) ----------
function getPaymentConfig() {
  const db = load();
  return db.paymentConfig || {};
}
function setPaymentConfig(patch) {
  const db = load();
  db.paymentConfig = { ...(db.paymentConfig || {}), ...patch };
  save(db);
  return db.paymentConfig;
}

// ---------- Advertisement interests ----------
// Every "I'm interested" tap on the in-app promo box. Captured with the user's
// contact details at the moment they responded, so the admin has something
// actionable even if the person later edits their profile.
function createInterest(rec) {
  const db = load();
  db.interests = db.interests || [];
  db.interests.push(rec);
  save(db);
  return rec;
}
function listInterests() {
  const db = load();
  return (db.interests || []).slice().reverse();
}
function findInterest(userId, adId) {
  const db = load();
  return (db.interests || []).find(i => i.userId === userId && i.adId === adId);
}

// ---------- Advertisement box config (admin-editable) ----------
function getAdConfig() {
  const db = load();
  return db.adConfig || {};
}
function setAdConfig(patch) {
  const db = load();
  db.adConfig = { ...(db.adConfig || {}), ...patch };
  save(db);
  return db.adConfig;
}

// ---------- FX config ----------
// Admin-editable USD->INR / USD->EGP conversion rates. Empty by default, in
// which case plans.js falls back to its built-in reference rates.
function getFxConfig() {
  const db = load();
  return db.fxConfig || {};
}
function setFxConfig(patch) {
  const db = load();
  db.fxConfig = { ...(db.fxConfig || {}), ...patch };
  save(db);
  return db.fxConfig;
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
  // deprecated aliases
  createInstapayProof, listPendingInstapayProofs, listAllInstapayProofs, findInstapayProof, updateInstapayProof,
};
