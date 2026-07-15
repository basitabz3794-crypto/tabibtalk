const express = require('express');
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

/**
 * Builds a manual-payment router for a single payment method (InstaPay, UPI, etc).
 * @param {string} method     unique method key, e.g. 'instapay' or 'upi'
 * @param {() => object} getDetails  returns the payment details to show the user (IPA, UPI ID, etc)
 * @param {string} label      human label used in default error messages, e.g. "InstaPay"
 */
function createManualPaymentRouter(method, getDetails, label) {
  const router = express.Router();

  // ---- Payment details users should pay to (shown on the checkout page) ----
  router.get('/details', async (req, res) => {
    res.json(await getDetails());
  });

  // ---- User submits proof of a payment they've made ----
  // Proof is the transaction/reference id from their payment app, which the
  // admin checks against the real InstaPay/UPI/PayPal statement. (This used to
  // be a screenshot upload, but Vercel has no writable disk to keep files on.)
  router.post('/submit-proof', requireLogin, async (req, res) => {
    const { planId, transactionId, referenceNote } = req.body || {};
    if (!PLANS[planId]) return res.status(400).json({ error: 'Unknown plan.' });

    const txn = String(transactionId || '').trim();
    if (!txn) return res.status(400).json({ error: `Please enter the transaction ID from your ${label} payment.` });
    if (txn.length < 4 || txn.length > 100) {
      return res.status(400).json({ error: 'That transaction ID doesn\'t look right — please copy it exactly from your payment app.' });
    }

    const proof = await store.createManualProof({
      id: nanoid(),
      method,
      userId: req.session.userId,
      planId,
      transactionId: txn,
      referenceNote: String(referenceNote || '').slice(0, 500),
      status: 'pending', // pending -> approved | rejected
      submittedAt: new Date().toISOString(),
    });

    res.json({ ok: true, proof });
  });

  // ---- User checks the status of their own submitted proofs for this method ----
  router.get('/my-proofs', requireLogin, async (req, res) => {
    const all = (await store.listAllManualProofs(method)).filter(p => p.userId === req.session.userId);
    res.json({ proofs: all });
  });

  // ---- ADMIN: list pending proofs to review for this method ----
  router.get('/admin/pending', requireAdmin, async (req, res) => {
    res.json({ proofs: await store.listPendingManualProofs(method) });
  });

  // ---- ADMIN: approve a proof -> upgrades the user's tier ----
  router.post('/admin/approve/:id', requireAdmin, async (req, res) => {
    const proof = await store.findManualProof(req.params.id);
    if (!proof || proof.method !== method) return res.status(404).json({ error: 'Proof not found.' });

    const activatedAt = new Date().toISOString();
    const expiresAt = await computeExpiry(proof.planId, activatedAt); // null for lifetime
    await store.updateManualProof(proof.id, { status: 'approved', reviewedAt: activatedAt });
    await store.updateUser(proof.userId, {
      tier: accessTierForPlan(proof.planId),
      planId: proof.planId,
      planActivatedAt: activatedAt,
      planExpiresAt: expiresAt,
      subStatus: 'active',
    });

    res.json({ ok: true });
  });

  // ---- ADMIN: reject a proof ----
  router.post('/admin/reject/:id', requireAdmin, async (req, res) => {
    const proof = await store.findManualProof(req.params.id);
    if (!proof || proof.method !== method) return res.status(404).json({ error: 'Proof not found.' });

    await store.updateManualProof(proof.id, {
      status: 'rejected',
      reviewedAt: new Date().toISOString(),
      rejectionReason: String((req.body && req.body.reason) || '').slice(0, 500),
    });

    res.json({ ok: true });
  });

  return router;
}

module.exports = { createManualPaymentRouter, requireAdmin };
