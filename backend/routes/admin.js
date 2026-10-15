// Admin console API. Every route here is admin-only.

const express = require('express');
const db = require('../db');
const time = require('../lib/time');
const meals = require('../lib/meals');
const wallet = require('../lib/wallet');
const auth = require('../lib/auth');
const { notify, refresh, audit } = require('../lib/notify');
const { kitchenStats } = require('../lib/stats');
const { orderView, fmtDate, mealLabel, addHistory } = require('./customer');

const router = express.Router();
router.use('/admin', auth.requireRole('admin'));
const { httpError } = meals;

function kitchenOr404(d, id) {
  const k = d.kitchens.find(x => x.id === Number(id));
  if (!k) throw httpError(404, 'Kitchen not found.');
  return k;
}

function note(req, field = 'note', required = false) {
  const v = String((req.body || {})[field] || '').trim().slice(0, 500);
  if (required && v.length < 5) throw httpError(400, 'Please write a short reason (it is sent to the chef).');
  return v;
}

function startOfDayISO(date) {
  // IST midnight in UTC
  return new Date(Date.parse(date + 'T00:00:00Z') - 330 * 60000).toISOString();
}

// ---------- Overview ----------

router.get('/admin/stats', (req, res) => {
  const d = db.load();
  const today = time.today();
  const since = startOfDayISO(today);
  const customerIds = new Set(d.users.filter(u => u.role === 'customer').map(u => u.id));
  const returnedToday = d.walletTransactions
    .filter(t => customerIds.has(t.userId) && ['release', 'refund'].includes(t.kind) && t.createdAt >= since && !/^(Paused|Resumed|Add-ons removed)/.test(t.note))
    .reduce((s, t) => s + t.available, 0);
  const todays = d.orders.filter(o => o.date === today);
  res.json({
    activeKitchens: d.kitchens.filter(k => k.status === 'approved' && !k.paused).length,
    pendingApprovals: d.kitchens.filter(k => k.status === 'pending').length,
    bannedKitchens: d.kitchens.filter(k => k.status === 'banned').length,
    flaggedKitchens: d.kitchens.filter(k => k.flags.some(f => !f.resolved)).length,
    openTickets: d.tickets.filter(t => t.status !== 'resolved').length,
    escalatedTickets: d.tickets.filter(t => t.status === 'escalated').length,
    refundsToday: returnedToday,
    mealsToday: todays.filter(o => meals.ACTIVE.includes(o.status)).length,
    deliveredToday: todays.filter(o => o.status === 'delivered').length,
    customers: customerIds.size,
    activeSubscriptions: d.subscriptions.filter(s => s.status === 'active').length
  });
});

// ---------- Kitchens ----------

function adminKitchen(d, k) {
  const owner = d.users.find(u => u.id === k.ownerId);
  return {
    ...k,
    ownerName: owner ? owner.name : '',
    ownerEmail: owner ? owner.email : '',
    stats: kitchenStats(d, k.id),
    openFlags: k.flags.filter(f => !f.resolved).length,
    activeSubscribers: d.subscriptions.filter(s => s.kitchenId === k.id && s.status === 'active').length
  };
}

router.get('/admin/kitchens', (req, res) => {
  const d = db.load();
  const q = String(req.query.q || '').toLowerCase().trim();
  const status = req.query.status;
  let list = d.kitchens.map(k => adminKitchen(d, k));
  if (status === 'flagged') list = list.filter(k => k.openFlags > 0);
  else if (status && status !== 'all') list = list.filter(k => k.status === status);
  if (q) list = list.filter(k => `${k.name} ${k.chefName} ${k.ownerEmail} ${k.location.locality} ${k.phone}`.toLowerCase().includes(q));
  list.sort((a, b) => (b.openFlags - a.openFlags) || (a.status === 'pending' ? -1 : 0) || a.name.localeCompare(b.name));
  res.json({ kitchens: list });
});

router.get('/admin/kitchens/:id', (req, res) => {
  const d = db.load();
  const k = kitchenOr404(d, req.params.id);
  const reviews = d.reviews.filter(r => r.kitchenId === k.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json({ kitchen: adminKitchen(d, k), menu: meals.getMenu(d, k.id), reviews });
});

router.post('/admin/kitchens/:id/approve', (req, res) => {
  const k = db.transaction(d => {
    const k = kitchenOr404(d, req.params.id);
    if (k.status === 'approved') throw httpError(400, 'Already approved.');
    if (k.status === 'banned') throw httpError(400, 'This kitchen is banned. Unban it instead.');
    const msg = note(req);
    k.status = 'approved';
    k.statusNote = msg;
    k.approvedAt = time.nowISO();
    notify(d, k.ownerId, { type: 'kitchen_approved', title: `${k.name} is live on RasoiSe!`, body: msg || 'Neighbours can now find and order from your kitchen.', link: 'chef-dashboard.html' });
    refresh([k.ownerId], ['kitchen']);
    audit(d, req.user, 'KITCHEN_APPROVED', k.name, msg || 'Approved.');
    return k;
  });
  res.json({ kitchen: adminKitchen(db.load(), k) });
});

router.post('/admin/kitchens/:id/reject', (req, res) => {
  const k = db.transaction(d => {
    const k = kitchenOr404(d, req.params.id);
    if (k.status !== 'pending') throw httpError(400, 'Only pending kitchens can be rejected.');
    const msg = note(req, 'note', true);
    k.status = 'rejected';
    k.statusNote = msg;
    notify(d, k.ownerId, { type: 'kitchen_rejected', title: 'Your kitchen application needs changes', body: msg, link: 'chef-settings.html' });
    refresh([k.ownerId], ['kitchen']);
    audit(d, req.user, 'KITCHEN_REJECTED', k.name, msg);
    return k;
  });
  res.json({ kitchen: adminKitchen(db.load(), k) });
});

// Chef fixed things after a rejection: put it back in the queue
router.post('/admin/kitchens/:id/reopen', (req, res) => {
  const k = db.transaction(d => {
    const k = kitchenOr404(d, req.params.id);
    if (k.status !== 'rejected') throw httpError(400, 'Only rejected kitchens can be reopened.');
    k.status = 'pending';
    audit(d, req.user, 'KITCHEN_REOPENED', k.name, 'Moved back to pending review.');
    return k;
  });
  res.json({ kitchen: adminKitchen(db.load(), k) });
});

router.post('/admin/kitchens/:id/warn', (req, res) => {
  const k = db.transaction(d => {
    const k = kitchenOr404(d, req.params.id);
    const reason = note(req, 'reason', true);
    k.warnings.push({ reason, at: time.nowISO(), by: req.user.name });
    notify(d, k.ownerId, { type: 'kitchen_warning', title: 'Warning from RasoiSe', body: reason, link: 'chef-dashboard.html' });
    audit(d, req.user, 'KITCHEN_WARNED', k.name, reason);
    return k;
  });
  res.json({ kitchen: adminKitchen(db.load(), k) });
});

router.post('/admin/kitchens/:id/clear-flags', (req, res) => {
  const k = db.transaction(d => {
    const k = kitchenOr404(d, req.params.id);
    const open = k.flags.filter(f => !f.resolved);
    if (!open.length) throw httpError(400, 'No open flags.');
    open.forEach(f => { f.resolved = true; f.resolvedAt = time.nowISO(); });
    audit(d, req.user, 'FLAGS_CLEARED', k.name, `${open.length} flag(s) reviewed and cleared. ${note(req)}`.trim());
    return k;
  });
  res.json({ kitchen: adminKitchen(db.load(), k) });
});

// Ban: stop the kitchen, refund every meal that hasn't been delivered, end subscriptions.
router.post('/admin/kitchens/:id/ban', (req, res) => {
  const result = db.transaction(d => {
    const k = kitchenOr404(d, req.params.id);
    if (k.status === 'banned') throw httpError(400, 'Already banned.');
    const reason = note(req, 'reason', true);
    k.status = 'banned';
    k.statusNote = reason;
    k.bannedAt = time.nowISO();

    const perCustomer = new Map();
    let total = 0;
    let mealsCancelled = 0;
    d.orders.filter(o => o.kitchenId === k.id && ['scheduled', 'preparing', 'out_for_delivery', 'paused'].includes(o.status)).forEach(o => {
      let amount = 0;
      if (o.status !== 'paused') {
        const e = wallet.release(d, o, `Refund: ${k.name} removed from RasoiSe (${mealLabel(o)})`);
        amount = e ? e.available : 0;
      }
      addHistory(o, 'cancelled', 'admin');
      o.cancelReason = 'Kitchen removed from RasoiSe';
      mealsCancelled++;
      total += amount;
      perCustomer.set(o.customerId, (perCustomer.get(o.customerId) || 0) + amount);
    });
    d.subscriptions.filter(s => s.kitchenId === k.id && s.status === 'active').forEach(s => {
      s.status = 'cancelled';
      s.cancelledAt = time.nowISO();
      s.cancelReason = 'Kitchen removed by RasoiSe';
    });
    perCustomer.forEach((amount, customerId) => {
      notify(d, customerId, {
        type: 'kitchen_banned', title: `${k.name} is no longer on RasoiSe`,
        body: `Your upcoming meals were cancelled and ₹${amount} is back in your wallet. Sorry about this. Find another kitchen nearby.`,
        link: 'index.html'
      });
    });
    refresh([...perCustomer.keys()], ['orders', 'wallet', 'subscriptions']);
    notify(d, k.ownerId, { type: 'kitchen_banned', title: 'Your kitchen has been suspended', body: reason, link: 'chef-dashboard.html' });
    refresh([k.ownerId], ['kitchen', 'orders']);
    audit(d, req.user, 'KITCHEN_BANNED', k.name, `${reason} · ${mealsCancelled} meals cancelled, ₹${total} refunded to ${perCustomer.size} customers.`);
    return { kitchen: k, refunded: total, customers: perCustomer.size, mealsCancelled };
  });
  res.json({ ...result, kitchen: adminKitchen(db.load(), result.kitchen) });
});

router.post('/admin/kitchens/:id/unban', (req, res) => {
  const k = db.transaction(d => {
    const k = kitchenOr404(d, req.params.id);
    if (k.status !== 'banned') throw httpError(400, 'This kitchen is not banned.');
    const msg = note(req);
    k.status = 'approved';
    k.statusNote = msg;
    delete k.bannedAt;
    notify(d, k.ownerId, { type: 'kitchen_unbanned', title: 'Your kitchen is live again', body: msg || 'You can take orders again. Please keep up the hygiene standards.', link: 'chef-dashboard.html' });
    refresh([k.ownerId], ['kitchen']);
    audit(d, req.user, 'KITCHEN_UNBANNED', k.name, msg || 'Ban lifted.');
    return k;
  });
  res.json({ kitchen: adminKitchen(db.load(), k) });
});

// ---------- Users & orders ----------

router.get('/admin/users', (req, res) => {
  const d = db.load();
  const q = String(req.query.q || '').toLowerCase().trim();
  const role = req.query.role;
  const list = d.users
    .filter(u => (!role || role === 'all' || u.role === role) && (!q || `${u.name} ${u.email} ${u.phone}`.toLowerCase().includes(q)))
    .map(u => ({
      ...auth.publicUser(u),
      wallet: u.role === 'admin' ? null : wallet.balances(u.id),
      orders: d.orders.filter(o => o.customerId === u.id).length,
      kitchenName: u.kitchenId ? (d.kitchens.find(k => k.id === u.kitchenId) || {}).name : null
    }))
    .sort((a, b) => b.id - a.id);
  res.json({ users: list.slice(0, 300) });
});

router.get('/admin/orders', (req, res) => {
  const d = db.load();
  const q = String(req.query.q || '').toLowerCase().trim();
  const { status, kitchenId, date } = req.query;
  let list = d.orders.filter(o =>
    (!status || status === 'all' || o.status === status) &&
    (!kitchenId || o.kitchenId === Number(kitchenId)) &&
    (!date || o.date === date));
  if (q) {
    list = list.filter(o => {
      const c = d.users.find(u => u.id === o.customerId);
      const k = d.kitchens.find(x => x.id === o.kitchenId);
      return `${o.code} ${c ? c.name : ''} ${k ? k.name : ''}`.toLowerCase().includes(q);
    });
  }
  list.sort((a, b) => (b.date + b.slot).localeCompare(a.date + a.slot) || b.id - a.id);
  res.json({ total: list.length, orders: list.slice(0, 200).map(o => orderView(d, o, req.user)) });
});

// Goodwill / complaint refund on a single order
router.post('/admin/orders/:id/refund', (req, res) => {
  const result = db.transaction(d => {
    const o = d.orders.find(x => x.id === Number(req.params.id));
    if (!o) throw httpError(404, 'Order not found.');
    const k = kitchenOr404(d, o.kitchenId);
    const reason = note(req, 'reason', true);
    const amount = refundOrder(d, o, k, Number(req.body.amount), reason, null, req.user);
    return { amount };
  });
  res.json(result);
});

// Shared by order refunds and ticket resolutions. Returns the amount refunded.
function refundOrder(d, o, k, amountInput, reason, ticketId, actor) {
  const total = meals.orderTotal(o);
  let amount = Math.round(amountInput || total);
  if (!(amount > 0)) throw httpError(400, 'Enter a refund amount.');
  if (o.status === 'delivered') {
    const already = o.goodwillRefund || 0;
    if (amount > total - already) throw httpError(400, `You can refund up to ₹${total - already} on this order.`);
    wallet.refundDelivered(d, o, k, amount, reason, ticketId);
  } else if (['scheduled', 'preparing', 'out_for_delivery'].includes(o.status)) {
    const held = (o.paid || 0) - (o.refunded || 0);
    amount = Math.min(amount, held);
    if (amount <= 0) throw httpError(400, 'Nothing left to refund on this order.');
    wallet.release(d, o, `Refund: ${reason}`, amount);
    if (amount >= held) {
      addHistory(o, 'cancelled', 'admin');
      o.cancelReason = reason;
    }
  } else {
    throw httpError(400, 'This order was already refunded.');
  }
  notify(d, o.customerId, { type: 'refund', title: `₹${amount} refunded for ${o.code}`, body: reason, link: `orders.html?id=${o.id}` });
  refresh([o.customerId], ['wallet', 'orders']);
  refresh([k.ownerId], ['orders', 'earnings']);
  audit(d, actor, 'ORDER_REFUND', k.name, `₹${amount} on ${o.code}: ${reason}`);
  return amount;
}

router.get('/admin/refunds', (req, res) => {
  const d = db.load();
  const customerIds = new Set(d.users.filter(u => u.role === 'customer').map(u => u.id));
  const list = d.walletTransactions
    .filter(t => customerIds.has(t.userId) && (t.kind === 'refund' || (t.kind === 'release' && !/^(Paused|Add-ons removed)/.test(t.note))))
    .sort((a, b) => b.id - a.id)
    .slice(0, 300)
    .map(t => {
      const u = d.users.find(x => x.id === t.userId);
      const o = t.orderId ? d.orders.find(x => x.id === t.orderId) : null;
      const k = o ? d.kitchens.find(x => x.id === o.kitchenId) : null;
      return { ...t, amount: t.available, customerName: u ? u.name : '', orderCode: o ? o.code : null, kitchenName: k ? k.name : null };
    });
  res.json({ refunds: list, total: list.reduce((s, t) => s + t.amount, 0) });
});

router.get('/admin/audit', (req, res) => {
  const d = db.load();
  const q = String(req.query.q || '').toLowerCase();
  const list = d.auditLog
    .filter(a => !q || `${a.action} ${a.actorName} ${a.target} ${a.detail}`.toLowerCase().includes(q))
    .sort((a, b) => b.id - a.id)
    .slice(0, 300);
  res.json({ entries: list });
});

module.exports = { router, refundOrder };
