// Customer side: profile & preferences, addresses, favourites, wallet,
// on-demand / trial orders, subscriptions and the per-day meal calendar.

const express = require('express');
const db = require('../db');
const time = require('../lib/time');
const meals = require('../lib/meals');
const wallet = require('../lib/wallet');
const payments = require('../lib/payments');
const auth = require('../lib/auth');
const { notify, refresh } = require('../lib/notify');
const { hasCoords } = require('../lib/geo');
const { publicKitchen } = require('../lib/stats');

const router = express.Router();
const customerOnly = auth.requireRole('customer');
const { httpError } = meals;

function me(d, req) {
  return d.users.find(u => u.id === req.user.id);
}

function kitchenOr404(d, id) {
  const k = d.kitchens.find(x => x.id === Number(id));
  if (!k) throw httpError(404, 'Kitchen not found.');
  return k;
}

function ownOrder(d, req, id) {
  const o = d.orders.find(x => x.id === Number(id));
  if (!o || o.customerId !== req.user.id) throw httpError(404, 'Order not found.');
  return o;
}

function fmtDate(date) {
  return new Date(date + 'T00:00:00Z').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

function mealLabel(o) {
  return `${fmtDate(o.date)} ${o.slot}`;
}

function addHistory(o, status, by) {
  o.status = status;
  o.updatedAt = time.nowISO();
  o.statusHistory.push({ status, at: time.nowISO(), by });
}

// ---------- Profile & preferences ----------

const DIETS = ['veg', 'jain', 'egg', 'nonveg'];
const SPICE = ['mild', 'medium', 'spicy'];
const SLOTS = ['lunch', 'dinner', 'both'];

function cleanPreferences(p = {}, current = {}) {
  const out = { ...current };
  if (p.diet !== undefined) out.diet = DIETS.includes(p.diet) ? p.diet : 'veg';
  if (p.noOnionGarlic !== undefined) out.noOnionGarlic = !!p.noOnionGarlic;
  if (p.spice !== undefined) out.spice = SPICE.includes(p.spice) ? p.spice : 'medium';
  if (p.allergies !== undefined) {
    const list = Array.isArray(p.allergies) ? p.allergies : String(p.allergies).split(',');
    out.allergies = list.map(s => String(s).trim()).filter(Boolean).slice(0, 10).map(s => s.slice(0, 40));
  }
  if (p.rotiCount !== undefined) out.rotiCount = Math.max(0, Math.min(8, parseInt(p.rotiCount, 10) || 0));
  if (p.rice !== undefined) out.rice = !!p.rice;
  if (p.defaultSlot !== undefined) out.defaultSlot = SLOTS.includes(p.defaultSlot) ? p.defaultSlot : 'lunch';
  return out;
}

router.put('/me/profile', customerOnly, (req, res) => {
  const body = req.body || {};
  const user = db.transaction(d => {
    const u = me(d, req);
    if (body.name !== undefined) {
      if (String(body.name).trim().length < 2) throw httpError(400, 'Please enter your name.');
      u.name = String(body.name).trim();
    }
    if (body.email !== undefined && body.email !== u.email) {
      const e = String(body.email).trim().toLowerCase();
      if (e && !auth.EMAIL_RE.test(e)) throw httpError(400, 'That email doesn\'t look right.');
      if (e && d.users.some(x => x.id !== u.id && x.email === e)) throw httpError(400, 'This email is already used by another account.');
      if (!e && !u.phone) throw httpError(400, 'Keep at least an email or a mobile number.');
      u.email = e;
    }
    if (body.phone !== undefined && body.phone !== u.phone) {
      const p = auth.normalisePhone(body.phone);
      if (p && !auth.PHONE_RE.test(p)) throw httpError(400, 'Enter a 10-digit mobile number.');
      if (p && d.users.some(x => x.id !== u.id && x.phone === p)) throw httpError(400, 'This number is already used by another account.');
      if (!p && !u.email) throw httpError(400, 'Keep at least an email or a mobile number.');
      u.phone = p;
    }
    if (body.preferences) {
      u.preferences = cleanPreferences(body.preferences, u.preferences || {});
      // Upcoming meals that are still open pick up the new preferences
      const touched = new Set();
      d.orders.forEach(o => {
        const k = d.kitchens.find(x => x.id === o.kitchenId);
        if (o.customerId === u.id && o.status === 'scheduled' && k && time.isBeforeCutoff(o.date, k.cutoffTime)) {
          o.prefs = meals.prefsSnapshot(u);
          touched.add(k.ownerId);
        }
      });
      refresh([...touched], ['orders']);
    }
    return u;
  });
  res.json({ user: auth.publicUser(user) });
});

// ---------- Addresses ----------

const LABELS = ['Home', 'Work', 'Other'];

function cleanAddress(body = {}) {
  const a = {
    label: LABELS.includes(body.label) ? body.label : 'Other',
    customLabel: body.label === 'Other' ? String(body.customLabel || '').slice(0, 30) : '',
    flat: String(body.flat || '').trim().slice(0, 80),
    building: String(body.building || '').trim().slice(0, 120),
    landmark: String(body.landmark || '').trim().slice(0, 120),
    formatted: String(body.formatted || '').trim().slice(0, 250),
    lat: Number(body.lat),
    lng: Number(body.lng)
  };
  if (!a.flat) throw httpError(400, 'Please add your flat / house number.');
  if (!hasCoords(a)) throw httpError(400, 'Please pin the location on the map.');
  return a;
}

router.post('/me/addresses', customerOnly, (req, res) => {
  const user = db.transaction(d => {
    const u = me(d, req);
    if ((u.addresses || []).length >= 10) throw httpError(400, 'You can save up to 10 addresses.');
    const nextId = (u.addresses || []).reduce((m, a) => Math.max(m, a.id), 0) + 1;
    const a = { id: nextId, ...cleanAddress(req.body) };
    u.addresses = [...(u.addresses || []), a];
    if (!u.defaultAddressId || req.body.makeDefault) u.defaultAddressId = a.id;
    return u;
  });
  res.status(201).json({ user: auth.publicUser(user) });
});

router.put('/me/addresses/:id', customerOnly, (req, res) => {
  const user = db.transaction(d => {
    const u = me(d, req);
    const a = (u.addresses || []).find(x => x.id === Number(req.params.id));
    if (!a) throw httpError(404, 'Address not found.');
    Object.assign(a, cleanAddress(req.body));
    if (req.body.makeDefault) u.defaultAddressId = a.id;
    return u;
  });
  res.json({ user: auth.publicUser(user) });
});

router.delete('/me/addresses/:id', customerOnly, (req, res) => {
  const user = db.transaction(d => {
    const u = me(d, req);
    const id = Number(req.params.id);
    u.addresses = (u.addresses || []).filter(a => a.id !== id);
    if (u.defaultAddressId === id) u.defaultAddressId = u.addresses[0] ? u.addresses[0].id : null;
    return u;
  });
  res.json({ user: auth.publicUser(user) });
});

router.post('/me/addresses/:id/default', customerOnly, (req, res) => {
  const user = db.transaction(d => {
    const u = me(d, req);
    if (!(u.addresses || []).some(a => a.id === Number(req.params.id))) throw httpError(404, 'Address not found.');
    u.defaultAddressId = Number(req.params.id);
    return u;
  });
  res.json({ user: auth.publicUser(user) });
});

// ---------- Favourites ----------

router.post('/me/favourites/:kitchenId', customerOnly, (req, res) => {
  const result = db.transaction(d => {
    const u = me(d, req);
    const id = Number(req.params.kitchenId);
    kitchenOr404(d, id);
    const list = u.favourites || [];
    const on = !list.includes(id);
    u.favourites = on ? [...list, id] : list.filter(x => x !== id);
    return { favourite: on, favourites: u.favourites };
  });
  res.json(result);
});

router.get('/me/favourites', customerOnly, (req, res) => {
  const d = db.load();
  const from = meals.findAddress(req.user, null);
  const list = (req.user.favourites || [])
    .map(id => d.kitchens.find(k => k.id === id && k.status === 'approved'))
    .filter(Boolean)
    .map(k => publicKitchen(d, k, from));
  res.json({ kitchens: list });
});

// ---------- Wallet ----------

router.get('/wallet', auth.requireRole('customer', 'chef'), (req, res) => {
  res.json({ balances: wallet.balances(req.user.id), ledger: wallet.ledger(req.user.id) });
});

router.post('/wallet/topup', customerOnly, (req, res) => {
  const amount = Math.round(Number((req.body || {}).amount));
  if (!Number.isFinite(amount) || amount < 50 || amount > 10000) {
    return res.status(400).json({ error: 'Top up between ₹50 and ₹10,000.' });
  }
  const payment = payments.createTopUp(req.user, amount);
  if (payment.status !== 'captured') return res.status(402).json({ error: 'Payment did not go through. Please try again.' });
  db.transaction(d => {
    wallet.post(d, { userId: req.user.id, kind: 'topup', available: amount, note: `Wallet top-up (${payment.providerRef})` });
    // A top-up clears any low-balance warning for today
    d.subscriptions.forEach(s => { if (s.customerId === req.user.id) s.lowBalanceWarnedOn = null; });
  });
  refresh(req.user.id, ['wallet']);
  res.json({ balances: wallet.balances(req.user.id), ledger: wallet.ledger(req.user.id) });
});

// ---------- On-demand & trial orders ----------

router.post('/orders', customerOnly, (req, res) => {
  const b = req.body || {};
  const order = db.transaction(d => {
    const u = me(d, req);
    const k = kitchenOr404(d, b.kitchenId);
    const type = b.type === 'trial' ? 'trial' : 'single';
    if (type === 'trial') {
      const had = d.orders.some(o => o.customerId === u.id && o.kitchenId === k.id && o.type === 'trial' && o.status !== 'cancelled');
      if (had) throw httpError(400, `You've already had a trial with ${k.name}. Order a single meal or start a plan.`, 'TRIAL_USED');
    }
    const address = meals.findAddress(u, Number(b.addressId) || null);
    meals.checkDeliveryArea(k, address);
    const price = type === 'trial' ? k.pricing.trial : k.pricing.single;
    const o = meals.createOrder(d, {
      customer: u, kitchen: k, type, date: b.date, slot: b.slot, choices: b.choices,
      addons: b.addons, note: b.note, address, amount: price
    });
    const what = type === 'trial' ? 'Trial meal' : 'Meal';
    notify(d, u.id, { type: 'order_confirmed', title: `${what} booked with ${k.name}`, body: `${o.code} · ${mealLabel(o)} · ₹${meals.orderTotal(o)} reserved from your wallet.`, link: `orders.html?id=${o.id}` });
    notify(d, k.ownerId, { type: 'new_order', title: `New ${type === 'trial' ? 'trial' : 'order'}: ${o.code}`, body: `${u.name} · ${mealLabel(o)}`, link: `chef-dashboard.html?date=${o.date}` });
    refresh([u.id], ['orders', 'wallet']);
    refresh([k.ownerId], ['orders']);
    return o;
  });
  res.status(201).json({ order, balances: wallet.balances(req.user.id) });
});

function orderView(d, o, viewer) {
  const k = d.kitchens.find(x => x.id === o.kitchenId);
  const review = d.reviews.find(r => r.orderId === o.id) || null;
  const tickets = d.tickets.filter(t => t.orderId === o.id).map(t => ({ id: t.id, code: t.code, status: t.status, category: t.category }));
  const customer = d.users.find(u => u.id === o.customerId);
  const open = k && o.status === 'scheduled' && time.isBeforeCutoff(o.date, k.cutoffTime);
  return {
    ...o,
    total: meals.orderTotal(o),
    kitchen: k ? { id: k.id, name: k.name, chefName: k.chefName, coverUrl: k.coverUrl, cutoffTime: k.cutoffTime, slots: k.slots, // Customers get the kitchen spot rounded to ~100 m, like on the storefront
    location: hasCoords(k.location) ? (viewer.role === 'customer'
      ? { lat: Math.round(k.location.lat * 1000) / 1000, lng: Math.round(k.location.lng * 1000) / 1000 }
      : { lat: k.location.lat, lng: k.location.lng }) : null, phone: viewer.role !== 'customer' || ['out_for_delivery', 'preparing'].includes(o.status) ? k.phone : undefined } : null,
    customerName: customer ? customer.name : '',
    customerPhone: viewer.role !== 'customer' && customer ? customer.phone : undefined,
    dietaryNotes: meals.dietaryNotes(o),
    editable: !!open,
    canReview: viewer.role === 'customer' && o.status === 'delivered' && !review,
    canComplain: viewer.role === 'customer' && ['delivered', 'out_for_delivery', 'preparing', 'cancelled'].includes(o.status),
    review: review ? { id: review.id, rating: review.rating, comment: review.comment, reply: review.reply } : null,
    tickets
  };
}

router.get('/orders', customerOnly, (req, res) => {
  const d = db.load();
  const scope = req.query.scope || 'all';
  const today = time.today();
  let list = d.orders.filter(o => o.customerId === req.user.id);
  if (scope === 'upcoming') list = list.filter(o => o.date >= today && !['delivered', 'cancelled'].includes(o.status));
  if (scope === 'past') list = list.filter(o => o.date < today || ['delivered', 'cancelled'].includes(o.status));
  if (scope === 'active') list = list.filter(o => ['preparing', 'out_for_delivery'].includes(o.status));
  list.sort((a, b) => scope === 'upcoming' ? (a.date + a.slot).localeCompare(b.date + b.slot) : (b.date + b.slot).localeCompare(a.date + a.slot) || b.id - a.id);
  res.json({ orders: list.slice(0, 200).map(o => orderView(d, o, req.user)) });
});

router.get('/orders/:id', auth.requireAuth, (req, res) => {
  const d = db.load();
  const o = d.orders.find(x => x.id === Number(req.params.id));
  const k = o && d.kitchens.find(x => x.id === o.kitchenId);
  const allowed = o && (req.user.role === 'admin' || o.customerId === req.user.id || (k && k.ownerId === req.user.id));
  if (!allowed) return res.status(404).json({ error: 'Order not found.' });
  res.json({ order: orderView(d, o, req.user) });
});

// Change dish choices, add-ons, note, slot or address for one meal (before cutoff).
router.put('/orders/:id', customerOnly, (req, res) => {
  const b = req.body || {};
  const order = db.transaction(d => {
    const u = me(d, req);
    const o = ownOrder(d, req, req.params.id);
    const k = kitchenOr404(d, o.kitchenId);
    if (o.status !== 'scheduled') throw httpError(400, 'Only scheduled meals can be changed.');
    if (!time.isBeforeCutoff(o.date, k.cutoffTime)) throw httpError(400, `Changes for ${fmtDate(o.date)} closed at ${time.fmt12(k.cutoffTime)}.`, 'CUTOFF_PASSED');

    const changes = [];
    if (b.slot && b.slot !== o.slot) {
      if (!['lunch', 'dinner'].includes(b.slot)) throw httpError(400, 'Choose lunch or dinner.');
      const reason = meals.closedReason(k, o.date, b.slot);
      if (reason) throw httpError(400, reason);
      if (meals.capacityLeft(d, k, o.date, b.slot) <= 0) throw httpError(409, `${k.name} is full for ${b.slot} that day.`, 'FULL');
      if (d.orders.some(x => x.id !== o.id && x.customerId === u.id && x.kitchenId === k.id && x.date === o.date && x.slot === b.slot && meals.ACTIVE.includes(x.status) && x.subscriptionId && x.subscriptionId === o.subscriptionId)) {
        throw httpError(400, `You already have ${b.slot} from this plan that day.`);
      }
      changes.push(`slot → ${b.slot}`);
      o.slot = b.slot;
    }
    if (b.addressId && Number(b.addressId) !== (o.address && o.address.id)) {
      const a = (u.addresses || []).find(x => x.id === Number(b.addressId));
      if (!a) throw httpError(404, 'Address not found.');
      meals.checkDeliveryArea(k, a);
      o.address = meals.addressSnapshot(a);
      changes.push('address');
    }
    const dm = meals.dayMenu(d, k, o.date);
    if (b.choices) {
      const next = meals.cleanChoices(dm.courses, { ...o.choices, ...b.choices });
      if (JSON.stringify(next) !== JSON.stringify(o.choices)) changes.push('dish choice');
      o.choices = next;
      o.mealType = meals.mealType(d, k, next);
    }
    if (b.note !== undefined) {
      o.note = String(b.note || '').slice(0, 200);
      changes.push('note');
    }
    if (b.addons) {
      const priced = meals.priceAddons(dm, b.addons);
      const diff = priced.total - (o.addonsTotal || 0);
      if (diff > 0) wallet.reserve(d, o, diff, `Add-ons for ${o.code}`);
      if (diff < 0) wallet.release(d, o, `Add-ons removed from ${o.code}`, -diff);
      o.addons = priced.items;
      o.addonsTotal = priced.total;
      changes.push('add-ons');
    }
    o.updatedAt = time.nowISO();
    if (changes.some(c => c !== 'note')) {
      notify(d, k.ownerId, { type: 'order_changed', title: `${u.name} updated ${o.code}`, body: `${mealLabel(o)}: ${changes.join(', ')}`, link: `chef-dashboard.html?date=${o.date}` });
    }
    refresh([k.ownerId], ['orders']);
    refresh([u.id], ['orders', 'wallet']);
    return o;
  });
  res.json({ order: orderView(db.load(), order, req.user), balances: wallet.balances(req.user.id) });
});

// Pause one meal before cutoff: money goes back to available balance.
function pauseOrder(d, u, o, k) {
  if (o.status !== 'scheduled') throw httpError(400, 'Only scheduled meals can be paused.');
  if (!time.isBeforeCutoff(o.date, k.cutoffTime)) throw httpError(400, `Too late to pause: changes for ${fmtDate(o.date)} closed at ${time.fmt12(k.cutoffTime)}.`, 'CUTOFF_PASSED');
  addHistory(o, 'paused', 'customer');
  return wallet.release(d, o, `Paused: ${k.name}, ${mealLabel(o)}`);
}

function resumeOrder(d, u, o, k) {
  if (o.status !== 'paused') throw httpError(400, 'This meal is not paused.');
  if (k.status !== 'approved') throw httpError(400, 'This kitchen is no longer taking orders.');
  if (!time.isBeforeCutoff(o.date, k.cutoffTime)) throw httpError(400, `Too late to resume: changes for ${fmtDate(o.date)} closed at ${time.fmt12(k.cutoffTime)}.`, 'CUTOFF_PASSED');
  const reason = meals.closedReason(k, o.date, o.slot);
  if (reason) throw httpError(400, reason);
  if (meals.capacityLeft(d, k, o.date, o.slot) <= 0) throw httpError(409, `${k.name} is full for ${o.slot} that day.`, 'FULL');
  const amount = meals.orderTotal(o);
  // A resumed meal is booked fresh, so reset what was paid/refunded on it
  o.paid = 0;
  o.refunded = 0;
  wallet.reserve(d, o, amount, `Resumed: ${k.name}, ${mealLabel(o)}`);
  addHistory(o, 'scheduled', 'customer');
}

router.post('/orders/:id/pause', customerOnly, (req, res) => {
  const order = db.transaction(d => {
    const u = me(d, req);
    const o = ownOrder(d, req, req.params.id);
    const k = kitchenOr404(d, o.kitchenId);
    if (o.type !== 'subscription') throw httpError(400, 'Single and trial orders can be cancelled instead.');
    const entry = pauseOrder(d, u, o, k);
    const amount = entry ? entry.available : 0;
    notify(d, u.id, { type: 'meal_paused', title: `Paused ${mealLabel(o)}`, body: `₹${amount} is back in your wallet.`, link: 'calendar.html' });
    notify(d, k.ownerId, { type: 'meal_paused', title: `${u.name} paused ${mealLabel(o)}`, body: `${o.code} removed from that day's prep.`, link: `chef-dashboard.html?date=${o.date}` });
    refresh([u.id], ['orders', 'wallet']);
    refresh([k.ownerId], ['orders']);
    return o;
  });
  res.json({ order, balances: wallet.balances(req.user.id) });
});

router.post('/orders/:id/resume', customerOnly, (req, res) => {
  const order = db.transaction(d => {
    const u = me(d, req);
    const o = ownOrder(d, req, req.params.id);
    const k = kitchenOr404(d, o.kitchenId);
    resumeOrder(d, u, o, k);
    notify(d, k.ownerId, { type: 'meal_resumed', title: `${u.name} resumed ${mealLabel(o)}`, body: `${o.code} is back on that day's prep.`, link: `chef-dashboard.html?date=${o.date}` });
    refresh([u.id], ['orders', 'wallet']);
    refresh([k.ownerId], ['orders']);
    return o;
  });
  res.json({ order, balances: wallet.balances(req.user.id) });
});

router.post('/orders/:id/cancel', customerOnly, (req, res) => {
  const order = db.transaction(d => {
    const u = me(d, req);
    const o = ownOrder(d, req, req.params.id);
    const k = kitchenOr404(d, o.kitchenId);
    if (o.type === 'subscription') throw httpError(400, 'Plan meals can be paused, or cancel the whole plan from "Manage plan".');
    if (o.status !== 'scheduled') throw httpError(400, 'This order can no longer be cancelled.');
    if (!time.isBeforeCutoff(o.date, k.cutoffTime)) throw httpError(400, `Too late to cancel: the kitchen started prep (cutoff ${time.fmt12(k.cutoffTime)}).`, 'CUTOFF_PASSED');
    addHistory(o, 'cancelled', 'customer');
    o.cancelReason = 'Cancelled by you';
    const entry = wallet.release(d, o, `Cancelled: ${o.code}`);
    notify(d, u.id, { type: 'order_cancelled', title: `${o.code} cancelled`, body: `₹${entry ? entry.available : 0} is back in your wallet.`, link: 'orders.html' });
    notify(d, k.ownerId, { type: 'order_cancelled', title: `${o.code} cancelled by ${u.name}`, body: mealLabel(o), link: `chef-dashboard.html?date=${o.date}` });
    refresh([u.id], ['orders', 'wallet']);
    refresh([k.ownerId], ['orders']);
    return o;
  });
  res.json({ order, balances: wallet.balances(req.user.id) });
});

// Holiday mode: pause (or resume) every plan meal in a date range.
router.post('/meals/holiday', customerOnly, (req, res) => {
  const { from, to, action } = req.body || {};
  if (!time.isValidDate(from) || !time.isValidDate(to) || to < from) return res.status(400).json({ error: 'Choose a valid date range.' });
  if (time.diffDays(from, to) > 60) return res.status(400).json({ error: 'Holiday mode can cover up to 60 days at a time.' });
  const result = db.transaction(d => {
    const u = me(d, req);
    const done = [];
    const skipped = [];
    let refunded = 0;
    const chefs = new Map();
    d.orders
      .filter(o => o.customerId === u.id && o.type === 'subscription' && o.date >= from && o.date <= to)
      .forEach(o => {
        const k = d.kitchens.find(x => x.id === o.kitchenId);
        try {
          if (action === 'resume') {
            if (o.status !== 'paused') return;
            resumeOrder(d, u, o, k);
          } else {
            if (o.status !== 'scheduled') return;
            const e = pauseOrder(d, u, o, k);
            refunded += e ? e.available : 0;
          }
          done.push(o.id);
          chefs.set(k.ownerId, (chefs.get(k.ownerId) || 0) + 1);
        } catch (err) {
          if (err.code === 'LOW_BALANCE') throw err;
          skipped.push({ id: o.id, date: o.date, reason: err.message });
        }
      });
    if (!done.length && !skipped.length) throw httpError(400, action === 'resume' ? 'No paused plan meals in those dates.' : 'No scheduled plan meals in those dates.');
    chefs.forEach((count, chefId) => {
      notify(d, chefId, {
        type: action === 'resume' ? 'meal_resumed' : 'meal_paused',
        title: `${u.name} ${action === 'resume' ? 'resumed' : 'paused'} ${count} meal${count > 1 ? 's' : ''}`,
        body: `${fmtDate(from)} – ${fmtDate(to)}`, link: 'chef-dashboard.html'
      });
    });
    if (done.length) {
      notify(d, u.id, {
        type: 'holiday', title: action === 'resume' ? `Resumed ${done.length} meals` : `Holiday mode: ${done.length} meals paused`,
        body: action === 'resume' ? `${fmtDate(from)} – ${fmtDate(to)}` : `₹${refunded} is back in your wallet.`, link: 'calendar.html'
      });
    }
    refresh([u.id], ['orders', 'wallet']);
    refresh([...chefs.keys()], ['orders']);
    return { changed: done.length, skipped, refunded };
  });
  res.json({ ...result, balances: wallet.balances(req.user.id) });
});

// ---------- Subscriptions ----------

function nextStartDate(k) {
  const today = time.today();
  return time.isBeforeCutoff(today, k.cutoffTime) ? today : time.addDays(today, 1);
}

// Build (and charge) a subscription. Used by start, renew and change-plan.
function createSubscription(d, u, k, { plan, slot, startDate, addressId, autoRenew = true, previousId = null }) {
  if (!meals.PLAN_MEALS[plan]) throw httpError(400, 'Choose the 5-day or 7-day plan.');
  if (!['lunch', 'dinner', 'both'].includes(slot)) throw httpError(400, 'Choose lunch, dinner or both.');
  if (!time.isValidDate(startDate)) throw httpError(400, 'Choose a start date.');
  if (k.status !== 'approved') throw httpError(400, 'This kitchen is not taking orders.');
  if (k.paused) throw httpError(400, `${k.name} has paused new orders for now.`);
  const slots = slot === 'both' ? ['lunch', 'dinner'] : [slot];
  slots.forEach(s => { if (!k.slots.includes(s)) throw httpError(400, `${k.name} doesn't serve ${s}.`); });
  if (!time.isBeforeCutoff(startDate, k.cutoffTime)) throw httpError(400, `Start date must be after today's ${time.fmt12(k.cutoffTime)} cutoff.`, 'CUTOFF_PASSED');

  const address = meals.findAddress(u, Number(addressId) || null);
  meals.checkDeliveryArea(k, address);

  const dates = meals.planDates(k, plan, startDate);
  if (dates.length < meals.PLAN_MEALS[plan]) throw httpError(400, 'Not enough open days ahead for this plan. Try a later start date.');
  const unitPrice = plan === '5day' ? k.pricing.plan5 : k.pricing.plan7;
  const total = unitPrice * slots.length;
  const { available } = wallet.balances(u.id);
  if (available < total) {
    throw httpError(402, `This plan costs ₹${total}. Your wallet has ₹${available}. Please top up ₹${total - available} more.`, 'LOW_BALANCE');
  }
  const prices = meals.splitPrice(total, dates.length * slots.length);

  const id = db.nextId('subscriptions');
  const sub = {
    id,
    code: 'SUB-' + (100 + id),
    customerId: u.id,
    kitchenId: k.id,
    plan,
    slot,
    startDate: dates[0],
    endDate: dates[dates.length - 1],
    mealsTotal: dates.length * slots.length,
    price: total,
    status: 'active',
    autoRenew: !!autoRenew,
    addressId: address.id,
    previousId,
    createdAt: time.nowISO()
  };
  d.subscriptions.push(sub);

  let i = 0;
  dates.forEach(date => {
    slots.forEach(s => {
      if (meals.capacityLeft(d, k, date, s) <= 0) {
        throw httpError(409, `${k.name} is fully booked for ${s} on ${fmtDate(date)}. Try a later start date.`, 'FULL');
      }
      meals.createOrder(d, {
        customer: u, kitchen: k, type: 'subscription', date, slot: s,
        choices: {}, addons: [], note: '', address,
        amount: prices[i++], subscriptionId: sub.id, skipBookableCheck: true
      });
    });
  });
  return sub;
}

// Cancel every meal of a plan that can still be cancelled. Returns refunded amount.
function cancelRemaining(d, sub, k, reason) {
  let refunded = 0;
  d.orders.filter(o => o.subscriptionId === sub.id).forEach(o => {
    const canStop = (o.status === 'scheduled' && time.isBeforeCutoff(o.date, k.cutoffTime)) || o.status === 'paused';
    if (!canStop) return;
    if (o.status === 'scheduled') {
      const e = wallet.release(d, o, `${reason}: ${k.name}, ${mealLabel(o)}`);
      refunded += e ? e.available : 0;
    }
    addHistory(o, 'cancelled', 'customer');
    o.cancelReason = reason;
  });
  return refunded;
}

function subView(d, s) {
  const k = d.kitchens.find(x => x.id === s.kitchenId);
  const orders = d.orders.filter(o => o.subscriptionId === s.id);
  const count = st => orders.filter(o => o.status === st).length;
  const upcoming = orders.filter(o => ['scheduled', 'preparing', 'out_for_delivery'].includes(o.status)).sort((a, b) => a.date.localeCompare(b.date));
  return {
    ...s,
    planLabel: meals.PLAN_LABEL[s.plan],
    kitchen: k ? { id: k.id, name: k.name, chefName: k.chefName, coverUrl: k.coverUrl, status: k.status, pricing: k.pricing, cutoffTime: k.cutoffTime } : null,
    counts: {
      delivered: count('delivered'), scheduled: upcoming.length, paused: count('paused'),
      cancelled: count('cancelled'), holiday: count('holiday')
    },
    nextMeal: upcoming[0] ? { id: upcoming[0].id, date: upcoming[0].date, slot: upcoming[0].slot, status: upcoming[0].status } : null,
    lastDate: orders.reduce((m, o) => (o.date > m ? o.date : m), s.endDate)
  };
}

router.post('/subscriptions', customerOnly, (req, res) => {
  const b = req.body || {};
  const sub = db.transaction(d => {
    const u = me(d, req);
    const k = kitchenOr404(d, b.kitchenId);
    const s = createSubscription(d, u, k, {
      plan: b.plan, slot: b.slot || 'lunch', startDate: b.startDate || nextStartDate(k), addressId: b.addressId, autoRenew: b.autoRenew !== false
    });
    notify(d, u.id, { type: 'subscription_started', title: `Your ${meals.PLAN_LABEL[s.plan]} with ${k.name} is on`, body: `${s.mealsTotal} meals from ${fmtDate(s.startDate)} · ₹${s.price} reserved.`, link: 'calendar.html' });
    notify(d, k.ownerId, { type: 'new_subscription', title: `New subscriber: ${u.name}`, body: `${meals.PLAN_LABEL[s.plan]}, ${s.slot}, from ${fmtDate(s.startDate)} (${s.mealsTotal} meals)`, link: 'chef-dashboard.html' });
    refresh([u.id], ['orders', 'wallet', 'subscriptions']);
    refresh([k.ownerId], ['orders']);
    return s;
  });
  res.status(201).json({ subscription: subView(db.load(), sub), balances: wallet.balances(req.user.id) });
});

router.get('/subscriptions', customerOnly, (req, res) => {
  const d = db.load();
  const list = d.subscriptions.filter(s => s.customerId === req.user.id).sort((a, b) => b.id - a.id).map(s => subView(d, s));
  res.json({ subscriptions: list });
});

router.put('/subscriptions/:id', customerOnly, (req, res) => {
  const sub = db.transaction(d => {
    const s = d.subscriptions.find(x => x.id === Number(req.params.id) && x.customerId === req.user.id);
    if (!s) throw httpError(404, 'Plan not found.');
    if (req.body.autoRenew !== undefined) s.autoRenew = !!req.body.autoRenew;
    return s;
  });
  res.json({ subscription: subView(db.load(), sub) });
});

router.post('/subscriptions/:id/cancel', customerOnly, (req, res) => {
  const result = db.transaction(d => {
    const u = me(d, req);
    const s = d.subscriptions.find(x => x.id === Number(req.params.id) && x.customerId === u.id);
    if (!s) throw httpError(404, 'Plan not found.');
    if (s.status !== 'active') throw httpError(400, 'This plan is not active.');
    const k = kitchenOr404(d, s.kitchenId);
    const refunded = cancelRemaining(d, s, k, 'Plan cancelled');
    s.status = 'cancelled';
    s.cancelledAt = time.nowISO();
    notify(d, u.id, { type: 'subscription_cancelled', title: `Plan with ${k.name} cancelled`, body: `₹${refunded} for the remaining meals is back in your wallet.`, link: 'calendar.html' });
    notify(d, k.ownerId, { type: 'subscription_cancelled', title: `${u.name} cancelled their plan`, body: `${s.code}: remaining meals removed from prep.`, link: 'chef-dashboard.html' });
    refresh([u.id], ['orders', 'wallet', 'subscriptions']);
    refresh([k.ownerId], ['orders']);
    return { refunded, subscription: s };
  });
  res.json({ refunded: result.refunded, subscription: subView(db.load(), result.subscription), balances: wallet.balances(req.user.id) });
});

router.post('/subscriptions/:id/renew', customerOnly, (req, res) => {
  const sub = db.transaction(d => {
    const u = me(d, req);
    const s = d.subscriptions.find(x => x.id === Number(req.params.id) && x.customerId === u.id);
    if (!s) throw httpError(404, 'Plan not found.');
    const k = kitchenOr404(d, s.kitchenId);
    const lastDate = d.orders.filter(o => o.subscriptionId === s.id).reduce((m, o) => (o.date > m ? o.date : m), s.endDate);
    let start = time.addDays(lastDate, 1);
    if (start < nextStartDate(k)) start = nextStartDate(k);
    const plan = req.body.plan || s.plan;
    const created = createSubscription(d, u, k, { plan, slot: req.body.slot || s.slot, startDate: start, addressId: s.addressId, autoRenew: s.autoRenew, previousId: s.id });
    s.renewedById = created.id;
    if (s.status === 'active' && lastDate < time.today()) s.status = 'completed';
    notify(d, u.id, { type: 'subscription_renewed', title: `Plan renewed with ${k.name}`, body: `${created.mealsTotal} meals from ${fmtDate(created.startDate)} · ₹${created.price} reserved.`, link: 'calendar.html' });
    notify(d, k.ownerId, { type: 'new_subscription', title: `${u.name} renewed their plan`, body: `${meals.PLAN_LABEL[created.plan]} from ${fmtDate(created.startDate)}`, link: 'chef-dashboard.html' });
    refresh([u.id], ['orders', 'wallet', 'subscriptions']);
    refresh([k.ownerId], ['orders']);
    return created;
  });
  res.status(201).json({ subscription: subView(db.load(), sub), balances: wallet.balances(req.user.id) });
});

// Upgrade / downgrade: refund what's left on the current plan and start the new plan
// from the next open day. Both happen together or not at all.
router.post('/subscriptions/:id/change', customerOnly, (req, res) => {
  const b = req.body || {};
  const result = db.transaction(d => {
    const u = me(d, req);
    const s = d.subscriptions.find(x => x.id === Number(req.params.id) && x.customerId === u.id);
    if (!s) throw httpError(404, 'Plan not found.');
    if (s.status !== 'active') throw httpError(400, 'Only an active plan can be changed.');
    const k = kitchenOr404(d, s.kitchenId);
    const plan = b.plan || s.plan;
    const slot = b.slot || s.slot;
    if (plan === s.plan && slot === s.slot) throw httpError(400, 'That is already your plan.');
    const refunded = cancelRemaining(d, s, k, 'Plan changed');
    s.status = 'changed';
    // Start after any meal that is already locked in today
    let start = nextStartDate(k);
    const locked = d.orders.filter(o => o.subscriptionId === s.id && ['scheduled', 'preparing', 'out_for_delivery'].includes(o.status));
    if (locked.length) start = time.addDays(locked.reduce((m, o) => (o.date > m ? o.date : m), start), 1);
    const created = createSubscription(d, u, k, { plan, slot, startDate: start, addressId: b.addressId || s.addressId, autoRenew: s.autoRenew, previousId: s.id });
    s.renewedById = created.id;
    notify(d, u.id, { type: 'subscription_changed', title: `Plan changed to ${meals.PLAN_LABEL[plan]}`, body: `₹${refunded} refunded for the old plan, ₹${created.price} reserved for the new one.`, link: 'calendar.html' });
    notify(d, k.ownerId, { type: 'subscription_changed', title: `${u.name} changed their plan`, body: `Now ${meals.PLAN_LABEL[plan]}, ${slot}, from ${fmtDate(created.startDate)}`, link: 'chef-dashboard.html' });
    refresh([u.id], ['orders', 'wallet', 'subscriptions']);
    refresh([k.ownerId], ['orders']);
    return { refunded, created };
  });
  res.json({ refunded: result.refunded, subscription: subView(db.load(), result.created), balances: wallet.balances(req.user.id) });
});

// ---------- Calendar ----------

router.get('/calendar', customerOnly, (req, res) => {
  const d = db.load();
  const from = time.isValidDate(req.query.from) ? req.query.from : time.addDays(time.today(), -7);
  const to = time.isValidDate(req.query.to) ? req.query.to : time.addDays(time.today(), 35);
  const orders = d.orders
    .filter(o => o.customerId === req.user.id && o.date >= from && o.date <= to)
    .sort((a, b) => (a.date + a.slot).localeCompare(b.date + b.slot))
    .map(o => {
      const v = orderView(d, o, req.user);
      const k = d.kitchens.find(x => x.id === o.kitchenId);
      v.courses = k ? meals.dayMenu(d, k, o.date).courses : [];
      v.availableAddons = k ? meals.dayMenu(d, k, o.date).addons : [];
      v.special = k ? meals.dayMenu(d, k, o.date).special : null;
      return v;
    });
  // Holidays of kitchens the customer has meals with
  const kitchenIds = [...new Set(d.orders.filter(o => o.customerId === req.user.id).map(o => o.kitchenId))];
  const holidays = [];
  kitchenIds.forEach(id => {
    const k = d.kitchens.find(x => x.id === id);
    if (!k) return;
    k.holidays.filter(h => h.date >= from && h.date <= to).forEach(h => holidays.push({ kitchenId: k.id, kitchenName: k.name, date: h.date, reason: h.reason }));
  });
  res.json({ from, to, today: time.today(), orders, holidays });
});

module.exports = { router, createSubscription, cancelRemaining, subView, orderView, fmtDate, mealLabel, addHistory, nextStartDate };
