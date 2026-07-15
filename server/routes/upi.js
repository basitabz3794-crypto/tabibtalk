const { createManualPaymentRouter } = require('./manual-payments');
const store = require('../data/store');

const router = createManualPaymentRouter(
  'upi',
  async () => {
    const cfg = await store.getPaymentConfig();
    return {
      label: cfg.upiLabel || '',
      upiId: cfg.upiId || process.env.UPI_ID,
      payeeName: cfg.upiPayeeName || process.env.UPI_PAYEE_NAME,
    };
  },
  'UPI'
);

module.exports = router;
