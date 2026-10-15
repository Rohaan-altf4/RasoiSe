// Complaint tickets on an order: a message thread between customer, chef and admin.
// Status flow: open -> chef_responded -> (escalated) -> resolved
// Hygiene complaints go straight to admin (escalated).

const express = require('express');
const db = require('../db');
const time = require('../lib/time');
const auth = require('../lib/auth');
const meals = require('../lib/meals');
const { notify, refresh, adminIds, audit } = require('../lib/notify');
const { refundOrder } = require('./admin');

const router = express.Router();
const { httpError } = meals;

const CATEGORIES = {
  late: 'Arrived late',
  wrong_item: 'Wrong item',
  missing: 'Missing item or meal',
  hygiene: 'Hygiene or freshness',
  quality: 'Taste or quantity',
  other: 'Something else'
};

function canSee(d, user, t) {
  if (user.role === 'admin') return true;
  if (user.role === 'customer') return t.customerId === user.id;
  if (user.role === 'chef') return t.kitchenId === user.kitchenId;
  return false;
}

function ticketView(d, t, full = false) {
  const o = d.orders.find(x => x.id === t.orderId);
  const k = d.kitchens.find(x => x.id === t.kitchenId);
  const c = d.users.find(x => x.id === t.customerId);
  const last = t.messages[t.messages.length - 1];
  const view = {
    ...t,
    categoryLabel: CATEGORIES[t.category] || t.category,
    orderCode: o ? o.code : '',
    orderDate: o ? o.date : '',
    orderSlot: o ? o.slot : '',
    orderTotal: o ? meals.orderTotal(o) : 0,
    orderStatus: o ? o.status : '',
    refundable: o ? Math.max(0, meals.orderTotal(o) - (o.goodwillRefund || 0) - (o.status === 'delivered' ? 0 : (o.refunded || 0))) : 0,
    kitchenName: k ? k.name : '',
    customerName: c ? c.name : '',
    lastMessage: last ? { body: last.body.slice(0, 140), role: last.role, at: last.at } : null
  };
  if (!full) delete view.messages;
  return view;
}

function message(user, body) {
  return { id: Date.now() + Math.floor(Math.random() * 1000), authorId: user.id, role: user.role, authorName: user.name, body, at: time.nowISO() };
}

// Who should hear about a new message, besides the author
function partiesFor(d, t, author) {
  const k = d.kitchens.find(x => x.id === t.kitchenId);
  const ids = [t.customerId, k && k.ownerId];
  if (t.status === 'escalated' || t.messages.some(m => m.role === 'admin')) ids.push(...adminIds(d));
  return ids.filter(id => id && id !== author.id);
}

function linkFor(d, userId, t) {
  const u = d.users.find(x => x.id === userId);
  if (!u) return '';
  if (u.role === 'admin') return `admin-console.html#tickets/${t.id}`;
  if (u.role === 'chef') return `chef-dashboard.html#tickets/${t.id}`;
  return `orders.html?ticket=${t.id}`;
}

function notifyParties(d, t, author, title, body) {
  partiesFor(d, t, author).forEach(uid => {
    notify(d, uid, { type: 'ticket', title, body, link: linkFor(d, uid, t) });
  });
  refresh([...partiesFor(d, t, author), author.id], ['tickets']);
}

router.get('/tickets/categories', (req, res) => {
  res.json({ categories: Object.entries(CATEGORIES).map(([id, label]) => ({ id, label })) });
});

router.post('/tickets', auth.requireRole('customer'), (req, res) => {
  const b = req.body || {};
  const ticket = db.transaction(d => {
    const o = d.orders.find(x => x.id === Number(b.orderId) && x.customerId === req.user.id);
    if (!o) throw httpError(404, 'Order not found.');
    if (!CATEGORIES[b.category]) throw httpError(400, 'Choose what went wrong.');
    const body = String(b.message || '').trim();
    if (body.length < 10) throw httpError(400, 'Tell us a little more (at least 10 characters).');
    if (time.diffDays(o.date, time.today()) > 7) throw httpError(400, 'Complaints can be raised within 7 days of the meal.');
    if (d.tickets.some(t => t.orderId === o.id && t.status !== 'resolved')) throw httpError(400, 'You already have an open complaint on this order.');
    const u = d.users.find(x => x.id === req.user.id);
    const k = d.kitchens.find(x => x.id === o.kitchenId);
    const id = db.nextId('tickets');
    const t = {
      id,
      code: 'TK-' + (500 + id),
      orderId: o.id,
      customerId: u.id,
      kitchenId: k.id,
      category: b.category,
      status: b.category === 'hygiene' ? 'escalated' : 'open',
      messages: [message(u, body.slice(0, 1000))],
      refund: null,
      createdAt: time.nowISO(),
      updatedAt: time.nowISO()
    };
    d.tickets.push(t);
    notify(d, k.ownerId, { type: 'ticket', title: `Complaint on ${o.code}: ${CATEGORIES[t.category]}`, body: `${u.name}: ${body.slice(0, 120)}`, link: `chef-dashboard.html#tickets/${t.id}` });
    if (t.status === 'escalated') {
      notify(d, adminIds(d), { type: 'ticket', title: `Hygiene complaint on ${k.name}`, body: `${t.code} · ${o.code}: ${body.slice(0, 120)}`, link: `admin-console.html#tickets/${t.id}` });
      audit(d, u, 'TICKET_ESCALATED', k.name, `${t.code} (hygiene) raised on ${o.code}.`);
    }
    notify(d, u.id, { type: 'ticket', title: `We've got your complaint (${t.code})`, body: t.status === 'escalated' ? 'The RasoiSe team will look into it today.' : `${k.name} has been told and will reply here.`, link: `orders.html?ticket=${t.id}` });
    refresh([k.ownerId, u.id, ...(t.status === 'escalated' ? adminIds(d) : [])], ['tickets']);
    return t;
  });
  res.status(201).json({ ticket: ticketView(db.load(), ticket, true) });
});

router.get('/tickets', auth.requireAuth, (req, res) => {
  const d = db.load();
  const status = req.query.status;
  const list = d.tickets
    .filter(t => canSee(d, req.user, t) && (!status || status === 'all' || (status === 'active' ? t.status !== 'resolved' : t.status === status)))
    .sort((a, b) => (a.status === 'resolved') - (b.status === 'resolved') || b.updatedAt.localeCompare(a.updatedAt))
    .map(t => ticketView(d, t));
  res.json({ tickets: list });
});

router.get('/tickets/:id', auth.requireAuth, (req, res) => {
  const d = db.load();
  const t = d.tickets.find(x => x.id === Number(req.params.id));
  if (!t || !canSee(d, req.user, t)) return res.status(404).json({ error: 'Complaint not found.' });
  res.json({ ticket: ticketView(d, t, true) });
});

router.post('/tickets/:id/messages', auth.requireAuth, (req, res) => {
  const body = String((req.body || {}).body || '').trim();
  if (body.length < 2) return res.status(400).json({ error: 'Write a message first.' });
  const ticket = db.transaction(d => {
    const t = d.tickets.find(x => x.id === Number(req.params.id));
    if (!t || !canSee(d, req.user, t)) throw httpError(404, 'Complaint not found.');
    if (t.status === 'resolved') throw httpError(400, 'This complaint is closed.');
    const u = d.users.find(x => x.id === req.user.id);
    t.messages.push(message(u, body.slice(0, 1000)));
    t.updatedAt = time.nowISO();
    if (u.role === 'chef' && t.status === 'open') t.status = 'chef_responded';
    notifyParties(d, t, u, `${u.role === 'admin' ? 'RasoiSe support' : u.name} replied on ${t.code}`, body.slice(0, 120));
    return t;
  });
  res.json({ ticket: ticketView(db.load(), ticket, true) });
});

router.post('/tickets/:id/escalate', auth.requireRole('customer', 'chef'), (req, res) => {
  const ticket = db.transaction(d => {
    const t = d.tickets.find(x => x.id === Number(req.params.id));
    if (!t || !canSee(d, req.user, t)) throw httpError(404, 'Complaint not found.');
    if (t.status === 'resolved') throw httpError(400, 'This complaint is closed.');
    if (t.status === 'escalated') throw httpError(400, 'Already with the RasoiSe team.');
    const u = d.users.find(x => x.id === req.user.id);
    t.status = 'escalated';
    t.updatedAt = time.nowISO();
    t.messages.push({ ...message(u, `${u.name} asked the RasoiSe team to step in.`), system: true });
    const k = d.kitchens.find(x => x.id === t.kitchenId);
    notify(d, adminIds(d), { type: 'ticket', title: `Escalated: ${t.code} (${k.name})`, body: CATEGORIES[t.category], link: `admin-console.html#tickets/${t.id}` });
    notifyParties(d, t, u, `${t.code} sent to RasoiSe support`, 'Our team will reply in this thread.');
    audit(d, u, 'TICKET_ESCALATED', k.name, `${t.code} escalated by ${u.role}.`);
    return t;
  });
  res.json({ ticket: ticketView(db.load(), ticket, true) });
});

// Admin resolves (optionally with a refund). Customers can close their own complaint.
router.post('/tickets/:id/resolve', auth.requireRole('admin', 'customer'), (req, res) => {
  const b = req.body || {};
  const ticket = db.transaction(d => {
    const t = d.tickets.find(x => x.id === Number(req.params.id));
    if (!t || !canSee(d, req.user, t)) throw httpError(404, 'Complaint not found.');
    if (t.status === 'resolved') throw httpError(400, 'Already resolved.');
    const u = d.users.find(x => x.id === req.user.id);
    const note = String(b.note || '').trim().slice(0, 500);
    const o = d.orders.find(x => x.id === t.orderId);
    const k = d.kitchens.find(x => x.id === t.kitchenId);
    let refunded = 0;
    if (u.role === 'admin' && Number(b.refundAmount) > 0) {
      refunded = refundOrder(d, o, k, Number(b.refundAmount), `Complaint ${t.code}: ${CATEGORIES[t.category]}`, t.id, u);
      t.refund = { amount: refunded, at: time.nowISO(), by: u.name };
    }
    t.status = 'resolved';
    t.resolvedAt = time.nowISO();
    t.resolution = note;
    t.updatedAt = time.nowISO();
    const text = u.role === 'customer'
      ? `${u.name} marked this as resolved.`
      : `Resolved by RasoiSe support${refunded ? ` with a ₹${refunded} refund to the wallet` : ''}.${note ? ' ' + note : ''}`;
    t.messages.push({ ...message(u, text), system: true });
    notifyParties(d, t, u, `${t.code} resolved${refunded ? `: ₹${refunded} refunded` : ''}`, note || text);
    if (u.role === 'admin') audit(d, u, 'TICKET_RESOLVED', k.name, `${t.code}${refunded ? `, refunded ₹${refunded}` : ''}. ${note}`.trim());
    return t;
  });
  res.json({ ticket: ticketView(db.load(), ticket, true) });
});

module.exports = { router, CATEGORIES };
