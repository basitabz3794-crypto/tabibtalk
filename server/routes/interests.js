// The in-app promo box ("advertisement") and the interest responses it collects.
//
// The box content is fully admin-editable (Admin Hub -> Developer -> Advertisement
// box), so it can promote anything — not just the original Medical German teaser.
// When a user taps its call-to-action we record who they are, so the admin has a
// contactable lead list under Admin Hub -> Interests.

const express = require('express');
const { nanoid } = require('nanoid');
const store = require('../data/store');

const router = express.Router();

// Shipped defaults. The admin's saved values (store.adConfig) win over these,
// field by field, so a partially-filled form still renders a complete box.
const AD_DEFAULTS = {
  enabled: true,
  adId: 'medical-german',
  badge: 'Coming Soon',
  titlePre: 'Medical ',
  titleAccent: 'German',
  titlePost: 'Trilingual',
  subtitle: 'The same trilingual magic — now for medical German. English · Deutsch · Arabic. Launching soon!',
  ctaLabel: 'Can’t wait ✨',
  teaserBadge: 'New · Coming Soon',
  confirmText: '✅ You’re on the list — we’ll email you when Medical German launches!',
};

function effectiveAd() {
  const cfg = store.getAdConfig() || {};
  const out = { ...AD_DEFAULTS };
  Object.keys(AD_DEFAULTS).forEach(k => {
    const v = cfg[k];
    if (k === 'enabled') { if (typeof v === 'boolean') out.enabled = v; return; }
    if (v !== undefined && v !== null && String(v).trim() !== '') out[k] = v;
  });
  // A blank adId would collapse every campaign's leads into one bucket.
  if (!out.adId) out.adId = AD_DEFAULTS.adId;
  return out;
}

// ---- Public: the box the app renders ----
router.get('/ad', (req, res) => {
  res.json({ ad: effectiveAd() });
});

// ---- Record an interest response ----
// Requires a signed-in user: the whole point is capturing name/email/phone.
router.post('/', (req, res) => {
  const userId = req.session && req.session.userId;
  if (!userId) return res.status(401).json({ error: 'Please sign in first.' });
  const user = store.findUserById(userId);
  if (!user) return res.status(401).json({ error: 'Please sign in first.' });

  const ad = effectiveAd();
  const adId = (req.body && req.body.adId) || ad.adId;

  // One response per person per campaign — tapping twice shouldn't duplicate the lead.
  const existing = store.findInterest(userId, adId);
  if (existing) return res.json({ ok: true, already: true });

  const rec = {
    id: nanoid(),
    userId,
    adId,
    adTitle: `${ad.titlePre}${ad.titleAccent} ${ad.titlePost}`.replace(/\s+/g, ' ').trim(),
    // Snapshot the contact details as they were when they responded.
    name: user.name || '',
    email: user.email || '',
    phone: user.phone || '',
    college: user.college || '',
    tier: user.tier || 'explorer',
    createdAt: new Date().toISOString(),
  };
  store.createInterest(rec);
  res.json({ ok: true });
});

// ---- Has the signed-in user already responded to this campaign? ----
router.get('/me', (req, res) => {
  const userId = req.session && req.session.userId;
  if (!userId) return res.json({ responded: false });
  const adId = req.query.adId || effectiveAd().adId;
  res.json({ responded: !!store.findInterest(userId, adId) });
});

module.exports = router;
module.exports.effectiveAd = effectiveAd;
module.exports.AD_DEFAULTS = AD_DEFAULTS;
