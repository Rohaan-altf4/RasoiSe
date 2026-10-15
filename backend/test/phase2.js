// Phase 2 API checks: notifications, live events (SSE), complaint tickets with refund,
// chef holidays, review reply, chef registration + approval.
// Run with: npm test

const assert = require('assert');
const http = require('http');
const Client = require('./client');

const BASE = process.env.BASE || 'http://localhost:3000';
let passed = 0;
function ok(cond, msg) { assert.ok(cond, msg); passed++; console.log('  ✓', msg); }

// Open an SSE stream and collect events
function listen(client) {
  const events = [];
  const url = new URL(BASE + '/api/events');
  const req = http.get({ hostname: url.hostname, port: url.port, path: url.pathname, headers: { cookie: client.cookie } }, res => {
    let buf = '';
    res.on('data', chunk => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n\n')) > -1) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const ev = /event: (\w+)/.exec(block);
        const data = /data: (.*)/.exec(block);
        if (ev && data) events.push({ event: ev[1], data: JSON.parse(data[1]) });
      }
    });
  });
  return { events, close: () => req.destroy() };
}
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const cust = new Client(BASE);
  const chef = new Client(BASE);
  const admin = new Client(BASE);
  const today = (await cust.get('/api/config')).data.today;
  const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

  await cust.post('/api/auth/signup', { name: 'Ticket Tester', phone: '8' + String(Date.now()).slice(-9), password: 'password123' });
  await cust.post('/api/me/addresses', { label: 'Home', flat: 'A-1', lat: 19.132, lng: 72.816 });
  await cust.post('/api/wallet/topup', { amount: 6000 });
  await chef.post('/api/auth/login', { identifier: 'harpreet@rasoise.demo', password: 'demo1234' });
  await admin.post('/api/auth/login', { identifier: 'admin@rasoise.in', password: process.env.ADMIN_PASSWORD || 'RasoiAdmin@2026' });

  console.log('Live events');
  const chefStream = listen(chef);
  const custStream = listen(cust);
  await wait(300);
  let r = await cust.post('/api/orders', { kitchenId: 2, type: 'single', date: today, slot: 'lunch' });
  ok(r.status === 201, 'customer orders from Nanak\'s Rasoi');
  const order = r.data.order;
  await wait(400);
  ok(chefStream.events.some(e => e.event === 'notification' && e.data.type === 'new_order'), 'chef receives a live new-order notification');
  ok(chefStream.events.some(e => e.event === 'refresh' && e.data.topics.includes('orders')), 'chef page is told to refresh orders');

  console.log('Dispatch tracker');
  for (const st of ['preparing', 'out_for_delivery', 'delivered']) {
    r = await chef.post(`/api/chef/orders/${order.id}/status`, { status: st });
    ok(r.status === 200, `chef sets ${st}`);
  }
  await wait(300);
  ok(custStream.events.filter(e => e.event === 'notification' && e.data.type === 'order_status').length === 3, 'customer gets 3 live status notifications');
  r = await cust.get(`/api/orders/${order.id}`);
  ok(r.data.order.statusHistory.length === 4 && r.data.order.canReview, 'order history has every step and can be reviewed');

  console.log('Review & reply');
  r = await cust.post('/api/reviews', { orderId: order.id, rating: 5, comment: 'Saag was lovely, just like home.' });
  ok(r.status === 201, 'customer reviews');
  r = await chef.post(`/api/reviews/${r.data.review.id}/reply`, { body: 'Thank you ji! Come again.' });
  ok(r.status === 200 && r.data.review.reply, 'chef posts a public reply');
  r = await cust.get('/api/notifications');
  ok(r.data.notifications.some(n => n.type === 'review_reply'), 'customer notified of the reply');

  console.log('Complaint ticket');
  r = await cust.post('/api/tickets', { orderId: order.id, category: 'missing', message: 'The raita was missing from my box.' });
  ok(r.status === 201 && r.data.ticket.status === 'open', 'customer raises a complaint');
  const t = r.data.ticket;
  r = await cust.post('/api/tickets', { orderId: order.id, category: 'late', message: 'Second complaint same order.' });
  ok(r.status === 400, 'only one open complaint per order');
  r = await chef.post(`/api/tickets/${t.id}/messages`, { body: 'So sorry! Packing slip-up.' });
  ok(r.data.ticket.status === 'chef_responded', 'chef reply moves status to chef responded');
  r = await cust.post(`/api/tickets/${t.id}/escalate`);
  ok(r.data.ticket.status === 'escalated', 'customer escalates to admin');
  r = await admin.get('/api/notifications');
  ok(r.data.notifications.some(n => n.type === 'ticket' && /Escalated/.test(n.title)), 'admin notified of escalation');
  const before = (await cust.get('/api/wallet')).data.balances.available;
  const chefBefore = (await chef.get('/api/chef/earnings')).data.balances.available;
  r = await admin.post(`/api/tickets/${t.id}/resolve`, { refundAmount: 50, note: 'Refunded for the missing raita.' });
  ok(r.status === 200 && r.data.ticket.status === 'resolved' && r.data.ticket.refund.amount === 50, 'admin resolves with ₹50 refund');
  ok((await cust.get('/api/wallet')).data.balances.available === before + 50, 'refund lands in customer wallet');
  ok((await chef.get('/api/chef/earnings')).data.balances.available === chefBefore - 45, 'kitchen share (90%) clawed back');

  console.log('Chef holiday');
  r = await cust.post('/api/subscriptions', { kitchenId: 2, plan: '7day', slot: 'lunch', startDate: addDays(today, 1) });
  ok(r.status === 201, 'customer subscribes to 7-day plan');
  const hDate = addDays(today, 3);
  const w1 = (await cust.get('/api/wallet')).data.balances;
  r = await chef.post('/api/chef/holidays', { date: hDate, reason: 'Family function' });
  ok(r.status === 200 && r.data.affected >= 1, `holiday cancels ${r.data.affected} meal(s)`);
  const w2 = (await cust.get('/api/wallet')).data.balances;
  ok(w2.available > w1.available, 'customer refunded for the holiday');
  r = await cust.get(`/api/calendar?from=${hDate}&to=${hDate}`);
  ok(r.data.orders.some(o => o.status === 'holiday') && r.data.holidays.length === 1, 'calendar shows the chef holiday');
  r = await chef.post('/api/chef/holidays', { date: addDays(today, -1) });
  ok(r.status === 400, 'cannot add a holiday in the past');

  console.log('Pause cutoff');
  r = await cust.get(`/api/calendar?from=${addDays(today, 1)}&to=${addDays(today, 1)}`);
  const tomorrow = r.data.orders.find(o => o.status === 'scheduled');
  r = await cust.post(`/api/orders/${tomorrow.id}/pause`);
  ok(r.status === 200, 'pausing tomorrow\'s meal works before cutoff');
  r = await chef.get(`/api/chef/manifest?date=${addDays(today, 1)}`);
  ok(r.data.counts.paused === 1, 'chef manifest shows the paused meal');

  console.log('Chef registration & approval');
  const fd = new FormData();
  const stamp = String(Date.now()).slice(-9);
  fd.append('name', 'Meera Iyer'); fd.append('phone', '7' + stamp); fd.append('password', 'password123');
  fd.append('kitchenName', 'Meera\'s Kitchen'); fd.append('location', JSON.stringify({ lat: 19.149, lng: 72.834, locality: 'Oshiwara' }));
  fd.append('pricing', JSON.stringify({ single: 110, trial: 90, plan5: 2100, plan7: 2800 }));
  const newChef = new Client(BASE);
  r = await newChef.req('POST', '/api/chef/register', fd, true);
  ok(r.status === 201 && r.data.kitchen.status === 'pending', 'new chef registers, kitchen pending');
  const kid = r.data.kitchen.id;
  r = await cust.get('/api/kitchens');
  ok(!r.data.kitchens.some(k => k.id === kid), 'pending kitchen hidden from marketplace');
  r = await admin.get('/api/notifications');
  ok(r.data.notifications.some(n => n.type === 'kitchen_pending'), 'admin gets the approval request');
  r = await chef.post(`/api/admin/kitchens/${kid}/approve`, {});
  ok(r.status === 403, 'chef cannot approve kitchens');
  r = await admin.post(`/api/admin/kitchens/${kid}/approve`, { note: 'Welcome!' });
  ok(r.status === 200, 'admin approves');
  r = await newChef.get('/api/notifications');
  ok(r.data.notifications.some(n => n.type === 'kitchen_approved'), 'chef notified of approval');
  r = await cust.get('/api/kitchens');
  ok(r.data.kitchens.some(k => k.id === kid), 'approved kitchen now in marketplace');

  chefStream.close();
  custStream.close();
  console.log(`\nAll ${passed} checks passed.`);
})().catch(err => {
  console.error('\n✗ FAILED:', err.message);
  process.exitCode = 1;
});
