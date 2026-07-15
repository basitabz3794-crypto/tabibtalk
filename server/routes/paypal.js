const { createManualPaymentRouter } = require('./manual-payments');
const store = require('../data/store');

const router = createManualPaymentRouter(
  'paypal',
  async () => {
    const cfg = await store.getPaymentConfig();
    return {
      label: cfg.paypalLabel || '',
      email: cfg.paypalEmail || process.env.PAYPAL_EMAIL,
      paypalMeLink: process.env.PAYPAL_ME_LINK,
    };
  },
  'PayPal'
);

module.exports = router;
