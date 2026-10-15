// Wallet ledger. Balances are never stored; they are always summed from the ledger,
// so they cannot drift out of sync.
//
// A customer wallet has two parts:
//   available - money they can spend
//   reserved  - money set aside for meals that are booked but not yet delivered
//
// Entry kinds (customer):
//   topup    available +X                 money added (simulated payment)
//   reserve  available -X, reserved +X    a meal / add-on is booked
//   release  reserved -X,  available +X   refund of a booked meal (pause, cancel, holiday, ban)
//   charge   reserved -X                  meal delivered, money goes to the kitchen
//   refund   available +X                 goodwill / complaint refund on an already delivered meal
// Entry kinds (chef):
//   earning  available +X                 kitchen share of a delivered meal
//   clawback available -X                 kitchen share taken back after a complaint refund
//   payout   available -X                 money sent to the chef's UPI (simulated)

const db = require('../db');
const time = require('./time');

const COMMISSION = Number(process.env.PLATFORM_COMMISSION || 0.1); // platform keeps 10% by default

function post(d, { userId, kind, available = 0, reserved = 0, orderId = null, subscriptionId = null, ticketId = null, note = '' }) {
  const entry = {
    id: db.nextId('walletTransactions'),
    userId,
    kind,
    available: Math.round(available),
    reserved: Math.round(reserved),
    orderId,
    subscriptionId,
    ticketId,
    note,
    createdAt: time.nowISO()
  };
  d.walletTransactions.push(entry);
  return entry;
}

function balances(userId) {
  let available = 0;
  let reserved = 0;
  db.load().walletTransactions.forEach(t => {
    if (t.userId === userId) {
      available += t.available;
      reserved += t.reserved;
    }
  });
  return { available, reserved };
}

function ledger(userId, limit = 200) {
  return db.load().walletTransactions
    .filter(t => t.userId === userId)
    .sort((a, b) => b.id - a.id)
    .slice(0, limit);
}

// Book money for an order. Throws if the customer can't afford it.
function reserve(d, order, amount, note) {
  if (amount <= 0) return null;
  const { available } = balances(order.customerId);
  if (available < amount) {
    const err = new Error(`Not enough wallet balance. You need ₹${amount}, you have ₹${available}. Please top up.`);
    err.status = 402;
    err.code = 'LOW_BALANCE';
    throw err;
  }
  order.paid = (order.paid || 0) + amount;
  return post(d, {
    userId: order.customerId, kind: 'reserve', available: -amount, reserved: amount,
    orderId: order.id, subscriptionId: order.subscriptionId || null, note
  });
}

// Give back whatever is still reserved for an order (or part of it).
function release(d, order, note, amount = null) {
  const held = (order.paid || 0) - (order.refunded || 0);
  const value = amount == null ? held : Math.min(amount, held);
  if (value <= 0) return null;
  order.refunded = (order.refunded || 0) + value;
  return post(d, {
    userId: order.customerId, kind: 'release', available: value, reserved: -value,
    orderId: order.id, subscriptionId: order.subscriptionId || null, note
  });
}

// Meal delivered: take the reserved money and pay the kitchen its share.
function settleDelivered(d, order, kitchen) {
  const amount = (order.paid || 0) - (order.refunded || 0);
  if (amount <= 0) return;
  post(d, {
    userId: order.customerId, kind: 'charge', reserved: -amount,
    orderId: order.id, subscriptionId: order.subscriptionId || null,
    note: `Delivered: ${kitchen.name} (${order.code})`
  });
  const fee = Math.round(amount * COMMISSION);
  order.platformFee = fee;
  order.chefEarning = amount - fee;
  if (kitchen.ownerId) {
    post(d, {
      userId: kitchen.ownerId, kind: 'earning', available: amount - fee, orderId: order.id,
      note: `${order.code} delivered (₹${amount} - ₹${fee} platform fee)`
    });
  }
}

// Refund money on a meal that was already delivered (complaint / admin goodwill).
// The kitchen's share is clawed back in proportion; the platform absorbs its fee share.
function refundDelivered(d, order, kitchen, amount, note, ticketId = null) {
  const value = Math.round(amount);
  if (value <= 0) return;
  post(d, { userId: order.customerId, kind: 'refund', available: value, orderId: order.id, ticketId, note });
  order.goodwillRefund = (order.goodwillRefund || 0) + value;
  if (kitchen.ownerId && order.chefEarning) {
    const share = Math.min(order.chefEarning, Math.round(value * (1 - COMMISSION)));
    if (share > 0) {
      post(d, { userId: kitchen.ownerId, kind: 'clawback', available: -share, orderId: order.id, ticketId, note: `Refund on ${order.code}: ${note}` });
    }
  }
}

module.exports = { COMMISSION, post, balances, ledger, reserve, release, settleDelivered, refundDelivered };
