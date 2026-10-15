// Payment gateway adapter. Right now every top-up succeeds instantly (simulated).
//
// To plug in Razorpay later:
//   1. createTopUp(): call razorpay.orders.create({ amount: amount * 100, currency: 'INR' })
//      and return { status: 'created', providerRef: order.id } to the browser checkout.
//   2. Add POST /api/wallet/razorpay-webhook that verifies the signature and then calls
//      wallet.post({ kind: 'topup', ... }) exactly like the simulated path below.
//   3. Payouts: swap simulatePayout() for RazorpayX payouts to the chef's UPI id.

const crypto = require('crypto');

const PROVIDER = process.env.PAYMENT_PROVIDER || 'simulated';

function createTopUp(user, amount) {
  return {
    provider: PROVIDER,
    status: 'captured',
    providerRef: 'SIM-' + crypto.randomBytes(5).toString('hex').toUpperCase(),
    amount
  };
}

function simulatePayout(upi, amount) {
  return {
    provider: PROVIDER,
    status: 'paid',
    providerRef: 'UPI-' + crypto.randomBytes(5).toString('hex').toUpperCase(),
    upi,
    amount
  };
}

module.exports = { createTopUp, simulatePayout, PROVIDER };
