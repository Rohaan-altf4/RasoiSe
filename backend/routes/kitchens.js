// Public kitchen directory: list, details, daily menu availability and reviews.

const express = require('express');
const db = require('../db');
const time = require('../lib/time');
const meals = require('../lib/meals');
const { publicKitchen, kitchenStats } = require('../lib/stats');
const { hasCoords } = require('../lib/geo');

const router = express.Router();

// Where to measure distance from: ?lat&lng, else the signed-in customer's default address.
function originFor(req) {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  if (req.user && req.user.role === 'customer') {
    const a = meals.findAddress(req.user, req.query.addressId ? Number(req.query.addressId) : null);
    if (a && hasCoords(a)) return { lat: a.lat, lng: a.lng };
  }
  return null;
}

router.get('/', (req, res) => {
  const d = db.load();
  const from = originFor(req);
  const list = d.kitchens
    .filter(k => k.status === 'approved' && hasCoords(k.location))
    .map(k => publicKitchen(d, k, from));
  res.json({ kitchens: list, origin: from });
});

router.get('/:id', (req, res) => {
  const d = db.load();
  const k = d.kitchens.find(x => x.id === Number(req.params.id));
  // Owners and admins can preview a kitchen that isn't live yet
  const canPreview = req.user && (req.user.role === 'admin' || req.user.kitchenId === (k && k.id));
  if (!k || (k.status !== 'approved' && !canPreview)) {
    return res.status(404).json({ error: 'Kitchen not found.' });
  }
  const menu = meals.getMenu(d, k.id);
  const out = publicKitchen(d, k, originFor(req));
  out.menu = {
    weekly: menu.weekly,
    dishes: menu.dishes,
    addons: menu.addons,
    specials: (menu.specials || []).filter(s => s.date >= time.today())
  };
  if (req.user && req.user.role === 'customer') {
    out.isFavourite = (req.user.favourites || []).includes(k.id);
    out.hadTrial = d.orders.some(o => o.customerId === req.user.id && o.kitchenId === k.id && o.type === 'trial' && o.status !== 'cancelled');
  }
  res.json({ kitchen: out });
});

// Availability for the next N days: per date and slot, can it still be booked?
router.get('/:id/availability', (req, res) => {
  const d = db.load();
  const k = d.kitchens.find(x => x.id === Number(req.params.id));
  if (!k || k.status !== 'approved') return res.status(404).json({ error: 'Kitchen not found.' });
  const days = Math.min(30, Number(req.query.days) || 14);
  const out = [];
  for (let i = 0; i < days; i++) {
    const date = time.addDays(time.today(), i);
    const dm = meals.dayMenu(d, k, date);
    const slots = {};
    ['lunch', 'dinner'].forEach(slot => {
      const closed = meals.closedReason(k, date, slot);
      const left = meals.capacityLeft(d, k, date, slot);
      const open = time.isBeforeCutoff(date, k.cutoffTime);
      slots[slot] = {
        offered: k.slots.includes(slot),
        closed,
        left,
        cutoffPassed: !open,
        bookable: !k.paused && !closed && open && left > 0
      };
    });
    out.push({ date, courses: dm.courses, special: dm.special, slots });
  }
  res.json({ cutoffTime: k.cutoffTime, days: out });
});

router.get('/:id/reviews', (req, res) => {
  const d = db.load();
  const id = Number(req.params.id);
  const reviews = d.reviews
    .filter(r => r.kitchenId === id && !r.hidden)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(r => ({
      id: r.id, customerName: r.customerName, rating: r.rating, hygiene: r.hygiene, taste: r.taste,
      tags: r.tags, comment: r.comment, reply: r.reply, createdAt: r.createdAt,
      verified: !!r.orderId, orderType: r.orderType || null
    }));
  res.json({ stats: kitchenStats(d, id), reviews });
});

module.exports = router;
