// Phase 1 API checks: auth, wallet, single/trial orders, subscription, pause cutoff,
// dispatch + settlement, admin ban with refunds, role enforcement.
// Run with: npm test (seeds a throwaway DB and starts its own server)

const assert = require('assert');
const Client = require('./client');

const BASE = process.env.BASE || 'http://localhost:3000';
let passed = 0;
function ok(cond, msg) { assert.ok(cond, msg); passed++; console.log('  ✓', msg); }

(async () => {
  const cust = new Client(BASE);
  const chef = new Client(BASE);
  const admin = new Client(BASE);
  const anon = new Client(BASE);

  console.log('Auth & roles');
  let r = await anon.get('/api/admin/stats');
  ok(r.status === 401, 'logged-out user gets 401 on admin API');
  r = await anon.get('/calendar.html');
  ok(r.status === 302 && r.headers.get('location').startsWith('/login.html'), 'logged-out user is redirected from calendar page');

  const email = `test${Date.now()}@example.com`;
  r = await cust.post('/api/auth/signup', { name: 'Test Customer', email, password: 'short' });
  ok(r.status === 400, 'short password rejected');
  r = await cust.post('/api/auth/signup', { name: 'Test Customer', email, phone: '9' + String(Date.now()).slice(-9), password: 'password123' });
  ok(r.status === 201 && r.data.user.role === 'customer', 'customer signs up');
  r = await cust.get('/api/admin/stats');
  ok(r.status === 403, 'customer cannot reach admin API');

  r = await admin.post('/api/auth/login', { identifier: 'admin@rasoise.in', password: 'wrong-pass' });
  ok(r.status === 401, 'wrong admin password rejected');
  r = await admin.post('/api/auth/login', { identifier: 'admin@rasoise.in', password: process.env.ADMIN_PASSWORD || 'RasoiAdmin@2026' });
  ok(r.status === 200 && r.data.user.role === 'admin', 'admin signs in');

  const today = (await anon.get('/api/config')).data.today;
  const tomorrow = new Date(Date.parse(today + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
  console.log('Address, wallet');
  r = await cust.post('/api/me/addresses', { label: 'Home', flat: 'B-402', building: 'Silver Oaks', lat: 19.1430, lng: 72.8270 });
  ok(r.status === 201 && r.data.user.addresses.length === 1, 'address saved');
  r = await cust.post('/api/orders', { kitchenId: 1, type: 'trial', date: tomorrow, slot: 'lunch' });
  ok(r.status === 402 && r.data.code === 'LOW_BALANCE', 'order blocked on empty wallet');
  r = await cust.post('/api/wallet/topup', { amount: 5000 });
  ok(r.status === 200 && r.data.balances.available === 5000, 'top-up of ₹5000');

  console.log('Orders');
  r = await cust.post('/api/orders', { kitchenId: 1, type: 'trial', date: today, slot: 'lunch' });
  ok(r.status === 201, 'trial booked for today before cutoff');
  const trial = r.data.order;
  r = await cust.post('/api/orders', { kitchenId: 1, type: 'trial', date: today, slot: 'lunch' });
  ok(r.status === 400 && r.data.code === 'TRIAL_USED', 'second trial with same kitchen blocked');
  r = await cust.post('/api/orders', { kitchenId: 1, type: 'single', date: today, slot: 'lunch', addons: [{ id: 'curd', qty: 1 }] });
  ok(r.status === 201 && r.data.order.addonsTotal === 20, 'single meal with add-on booked');
  const single = r.data.order;

  console.log('Subscription');
  r = await cust.post('/api/subscriptions', { kitchenId: 1, plan: '5day', slot: 'lunch', startDate: today });
  ok(r.status === 201 && r.data.subscription.mealsTotal === 22, '5-day plan creates 22 meals');
  const sub = r.data.subscription;
  r = await cust.get('/api/wallet');
  const reserved = r.data.balances.reserved;
  ok(reserved === trial.amount + single.amount + 20 + sub.price, `wallet reserved matches bookings (₹${reserved})`);

  r = await cust.get('/api/calendar');
  const tomorrowMeal = r.data.orders.find(o => o.subscriptionId === sub.id && o.date > today);
  r = await cust.post(`/api/orders/${tomorrowMeal.id}/pause`);
  ok(r.status === 200 && r.data.order.status === 'paused', 'pause a future plan meal');
  r = await cust.post(`/api/orders/${tomorrowMeal.id}/resume`);
  ok(r.status === 200 && r.data.order.status === 'scheduled', 'resume it again');

  console.log('Chef dispatch');
  r = await chef.post('/api/auth/login', { identifier: 'asha@rasoise.demo', password: 'demo1234' });
  ok(r.status === 200 && r.data.user.role === 'chef', 'migrated chef signs in');
  r = await chef.get(`/api/chef/manifest?date=${today}`);
  ok(r.status === 200 && r.data.counts.total >= 3, `manifest shows today's meals (${r.data.counts.total})`);
  const earnedBefore = (await chef.get('/api/chef/earnings')).data.balances.available;
  r = await chef.post(`/api/chef/orders/${trial.id}/status`, { status: 'delivered' });
  ok(r.status === 200 && r.data.order.status === 'delivered', 'chef marks trial delivered');
  r = await chef.get('/api/chef/earnings');
  ok(r.data.balances.available - earnedBefore === Math.round(trial.amount * 0.9), 'chef earned 90% of the trial');
  r = await cust.get('/api/wallet');
  ok(r.data.balances.reserved === reserved - trial.amount, 'delivery deducted from customer reserved balance');

  console.log('Review');
  r = await cust.post('/api/reviews', { orderId: trial.id, rating: 2, comment: 'Dal was cold and the box leaked a bit.' });
  ok(r.status === 201, 'customer reviews delivered order');
  r = await admin.get('/api/admin/kitchens?status=flagged');
  ok(r.data.kitchens.some(k => k.id === 1), '2★ review flags the kitchen for admin');

  console.log('Admin ban');
  r = await cust.get('/api/wallet');
  const before = r.data.balances;
  r = await admin.post('/api/admin/kitchens/1/ban', { reason: 'Repeated hygiene complaints' });
  ok(r.status === 200 && r.data.refunded > 0, `ban refunds customers (₹${r.data.refunded})`);
  r = await cust.get('/api/wallet');
  ok(r.data.balances.reserved === 0 && r.data.balances.available === before.available + before.reserved, 'all reserved money returned to available');
  r = await cust.get('/api/subscriptions');
  ok(r.data.subscriptions[0].status === 'cancelled', 'subscription cancelled by ban');
  r = await anon.get('/api/kitchens');
  ok(!r.data.kitchens.some(k => k.id === 1), 'banned kitchen hidden from marketplace');
  r = await admin.post('/api/admin/kitchens/1/unban', { note: 'Inspection passed' });
  ok(r.status === 200 && r.data.kitchen.status === 'approved', 'admin unbans');

  console.log(`\nAll ${passed} checks passed.`);
})().catch(err => {
  console.error('\n✗ FAILED:', err.message);
  process.exitCode = 1;
});
