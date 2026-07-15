const express = require('express');
const { getEffectivePlans } = require('../data/plans');

const router = express.Router();

// ---- Public plan list (safe to expose to the frontend) ----
// Reflects any live overrides set by the admin's Developer section.
router.get('/config', (req, res) => {
  const { plans } = getEffectivePlans();
  res.json({ plans });
});

module.exports = router;
