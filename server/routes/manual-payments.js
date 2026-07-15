const express = require('express');
const multer = require('multer');
const path = require('path');
const { nanoid } = require('nanoid');
const store = require('../data/store');
const { PLANS, accessTierForPlan, computeExpiry } = require('../data/plans');

function requireLogin(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Please log in first.' });
  next();
}

function requireAdmin(req, res, next) {
  // Simple shared-secret admin check for now — swap for a real admin role/login later.
  const key = req.headers['x-admin-key'] || req.query.adminKey;
  if (!process.env.ADMIN_KEY || key !== process.env.ADMIN_KEY) {
    return res.status(403).json({ error: 'Admin access required.' });
  }
  next();
}

const upload = multer({
  storage: multer.diskStorage({
    destination: path.join(__dirname, '..', '..', 'public', 'uploads'),
    filename: (req, file, cb) => cb(null, `${nanoid()}${path.extname(file.originalname)}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const ok = /image\/(png|jpe?g|webp)/.test(file.mimetype);
    cb(ok ? null : new Error('Please upload a PNG or JPG screenshot.'), ok);
  },
});

/**
 * Builds a manual-payment router for a single payment method (InstaPay, UPI, etc).
 * @param {string} method     unique method key, e.g. 'instapay' or 'upi'
 * @param {() => object} getDetails  returns the payment details to show the user (IPA, UPI ID, etc)
 * @param {string} label      human label used in default error messages, e.g. "InstaPay"
 */
function createManualPaymentRouter(method, getDetails, label) {
  const router = express.Router();

  // ---- Payment details users should pay to (shown on the checkout page) ----
  router.get('/details', (req, res) => {
    res.json(getDetails());
  });

  // ---- User submits proof of a payment they've made ----
  router.post('/submit-proof', requireLogin, upload.single('screenshot'), (req, res) => {
    const { planId, referenceNote } = req.body || {};
    if (!PLANS[planId]) return res.status(400).json({ error: 'Unknown plan.' });
    if (!req.file) return res.status(400).json({ error: `Please attach a screenshot of your ${label} payment.` });

    const proof = store.createManualProof({
      id: nanoid(),
      method,
      userId: req.session.userId,
      planId,
      referenceNote: referenceNote || '',
      screenshotPath: `/uploads/${req.file.filename}`,
      status: 'pending', // pending -> approved | rejected
      submittedAt: new Date().toISOString(),
    });

    res.json({ ok: true, proof });
  });

  // ---- User checks the status of their own submitted proofs for this method ----
  router.get('/my-proofs', requireLogin, (req, res) => {
    const all = store.listAllManualProofs(method).filter(p => p.userId === req.session.userId);
    res.json({ proofs: all });
  });

  // ---- ADMIN: list pending proofs to review for this method ----
  router.get('/admin/pending', requireAdmin, (req, res) => {
    res.json({ proofs: store.listPendingManualProofs(method) });
  });

  // ---- ADMIN: approve a proof -> upgrades the user's tier ----
  router.post('/admin/approve/:id', requireAdmin, (req, res) => {
    const proof = store.findManualProof(req.params.id);
    if (!proof || proof.method !== method) return res.status(404).json({ error: 'Proof not found.' });

    const activatedAt = new Date().toISOString();
    const expiresAt = computeExpiry(proof.planId, activatedAt); // null for lifetime
    store.updateManualProof(proof.id, { status: 'approved', reviewedAt: activatedAt });
    store.updateUser(proof.userId, {
      tier: accessTierForPlan(proof.planId),
      planId: proof.planId,
      planActivatedAt: activatedAt,
      planExpiresAt: expiresAt,
      subStatus: 'active',
    });

    res.json({ ok: true });
  });

  // ---- ADMIN: reject a proof ----
  router.post('/admin/reject/:id', requireAdmin, (req, res) => {
    const proof = store.findManualProof(req.params.id);
    if (!proof || proof.method !== method) return res.status(404).json({ error: 'Proof not found.' });

    store.updateManualProof(proof.id, {
      status: 'rejected',
      reviewedAt: new Date().toISOString(),
      rejectionReason: (req.body && req.body.reason) || '',
    });

    res.json({ ok: true });
  });

  return router;
}

module.exports = { createManualPaymentRouter, requireAdmin };
