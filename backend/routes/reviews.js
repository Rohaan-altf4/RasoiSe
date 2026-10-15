// Reviews: only for delivered orders, one per order. Chefs can post one public reply.
// A rating of 2★ or lower flags the kitchen for admin review.

const express = require('express');
const db = require('../db');
const time = require('../lib/time');
const auth = require('../lib/auth');
const { httpError } = require('../lib/meals');
const { notify, refresh, adminIds, audit } = require('../lib/notify');

const router = express.Router();

const TAGS = ['Tastes like home', 'Fresh & hot', 'Low oil', 'Good portions', 'Clean packaging', 'On time', 'Too spicy', 'Too oily', 'Late delivery', 'Packaging leaked', 'Small portion', 'Cold food'];

function rating(v) {
  const n = Math.round(Number(v));
  return n >= 1 && n <= 5 ? n : null;
}

router.get('/reviews/tags', (req, res) => res.json({ tags: TAGS }));

router.post('/reviews', auth.requireRole('customer'), (req, res) => {
  const b = req.body || {};
  const review = db.transaction(d => {
    const o = d.orders.find(x => x.id === Number(b.orderId) && x.customerId === req.user.id);
    if (!o) throw httpError(404, 'Order not found.');
    if (o.status !== 'delivered') throw httpError(400, 'You can review a meal once it has been delivered.');
    if (d.reviews.some(r => r.orderId === o.id)) throw httpError(400, 'You have already reviewed this meal.');
    const r = rating(b.rating);
    if (!r) throw httpError(400, 'Please pick a star rating.');
    const comment = String(b.comment || '').trim();
    if (comment.length < 10) throw httpError(400, 'Tell other neighbours a little more (at least 10 characters).');
    const k = d.kitchens.find(x => x.id === o.kitchenId);
    const u = d.users.find(x => x.id === req.user.id);

    const rev = {
      id: db.nextId('reviews'),
      kitchenId: k.id,
      orderId: o.id,
      orderType: o.type,
      customerId: u.id,
      customerName: u.name.split(' ')[0] + (u.name.split(' ')[1] ? ' ' + u.name.split(' ')[1][0] + '.' : ''),
      rating: r,
      hygiene: rating(b.hygiene) || r,
      taste: rating(b.taste) || r,
      tags: (Array.isArray(b.tags) ? b.tags : []).filter(t => TAGS.includes(t)).slice(0, 6),
      comment: comment.slice(0, 1000),
      reply: null,
      createdAt: time.nowISO()
    };
    d.reviews.push(rev);
    o.reviewId = rev.id;

    notify(d, k.ownerId, { type: 'new_review', title: `${rev.rating}★ review from ${rev.customerName}`, body: rev.comment.slice(0, 120), link: 'chef-dashboard.html#reviews' });
    refresh([k.ownerId], ['reviews']);

    if (r <= 2 || rev.hygiene <= 2) {
      k.flags.push({ reviewId: rev.id, rating: r, hygiene: rev.hygiene, reason: `${r}★ review on ${o.code}`, at: time.nowISO(), resolved: false });
      notify(d, adminIds(d), { type: 'kitchen_flagged', title: `${k.name} flagged: ${r}★ review`, body: `"${rev.comment.slice(0, 100)}" · ${o.code}`, link: 'admin-console.html#kitchens' });
      refresh(adminIds(d), ['kitchens']);
      audit(d, u, 'KITCHEN_FLAGGED', k.name, `${r}★ (hygiene ${rev.hygiene}★) review on ${o.code}: "${rev.comment.slice(0, 90)}"`);
    }
    return rev;
  });
  res.status(201).json({ review });
});

router.post('/reviews/:id/reply', auth.requireRole('chef'), (req, res) => {
  const body = String((req.body || {}).body || '').trim();
  if (body.length < 2) return res.status(400).json({ error: 'Write a short reply.' });
  const review = db.transaction(d => {
    const r = d.reviews.find(x => x.id === Number(req.params.id));
    const k = r && d.kitchens.find(x => x.id === r.kitchenId);
    if (!r || !k || k.ownerId !== req.user.id) throw httpError(404, 'Review not found.');
    if (r.reply) throw httpError(400, 'You have already replied to this review.');
    r.reply = { body: body.slice(0, 600), at: time.nowISO() };
    if (r.customerId) {
      notify(d, r.customerId, { type: 'review_reply', title: `${k.name} replied to your review`, body: r.reply.body.slice(0, 120), link: `kitchen.html?id=${k.id}#reviews` });
    }
    return r;
  });
  res.json({ review });
});

router.get('/chef/reviews', auth.requireRole('chef'), (req, res) => {
  const d = db.load();
  const list = d.reviews
    .filter(r => r.kitchenId === req.user.kitchenId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(r => {
      const o = r.orderId ? d.orders.find(x => x.id === r.orderId) : null;
      return { ...r, orderCode: o ? o.code : null, orderDate: o ? o.date : null };
    });
  res.json({ reviews: list });
});

module.exports = router;
