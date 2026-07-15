const { createManualPaymentRouter } = require('./manual-payments');
const store = require('../data/store');

const router = createManualPaymentRouter(
  'instapay',
  () => {
    const cfg = store.getPaymentConfig();
    return {
      label: cfg.instapayLabel || '',
      ipa: cfg.instapayAddress || process.env.INSTAPAY_IPA,
      phone: cfg.instapayPhone || process.env.INSTAPAY_PHONE,
    };
  },
  'InstaPay'
);

module.exports = router;
