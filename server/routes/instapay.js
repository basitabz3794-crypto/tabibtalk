const { createManualPaymentRouter } = require('./manual-payments');
const store = require('../data/store');

const router = createManualPaymentRouter(
  'instapay',
  async () => {
    const cfg = await store.getPaymentConfig();
    return {
      label: cfg.instapayLabel || '',
      ipa: cfg.instapayAddress || process.env.INSTAPAY_IPA,
      phone: cfg.instapayPhone || process.env.INSTAPAY_PHONE,
    };
  },
  'InstaPay'
);

module.exports = router;
