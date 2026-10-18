// Phase 6: the four end-to-end flows from the brief plus edge cases
// (double clicks, empty wallet, full capacity, banned kitchen, logged-out access, invalid input).
// Runs at 7:00 AM IST (before cutoff). The after-cutoff checks are in cutoff.js (9:00 AM).

const assert = require('assert');
const Client = require('./client');

const BASE = process.env.BASE || 'http://localhost:3000';
let passed = 0;
function ok(cond, msg) { assert.ok(cond, msg); passed++; console.log('  ✓', msg); }
const login = (c, id) => c.post('/api/auth/login', { identifier: id, password: 'demo1234' });

(async () => {
  const anon = new Client(BASE);
  const today = (await anon.get('/api/config')).data.today;
  const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const admin = new Client(BASE);
  await admin.post('/api/auth/login', { identifier: 'admin@rasoise.in', password: process.env.ADMIN_PASSWORD || 'RasoiAdmin@2026' });

  // ---------- Flow 1 ----------
  console.log('Flow 1: sign up → address → find → single + trial → dispatch → track → review → reply');
  const c = new Client(BASE);
  let r = await c.post('/api/auth/signup', { name: 'Ishaan Verma', phone: '9' + String(Date.now()).slice(-9), email: `ishaan${Date.now()}@example.com`, password: 'password123' });
  ok(r.status === 201, 'customer signs up');
  r = await c.post('/api/me/addresses', { label: 'Home', flat: '601, Tower 2', building: 'Lokhandwala Residency', lat: 19.1410, lng: 72.8245 });
  ok(r.status === 201, 'address pinned on the map');
  r = await c.get('/api/kitchens');
  const ritu = r.data.kitchens.find(k => k.name === 'Healthy Thali by Ritu');
  const anna = r.data.kitchens.find(k => k.name === 'Annapurna Kitchen');
  ok(ritu && ritu.distance < 1000 && ritu.deliversToYou, `finds a kitchen ${ritu.distance} m away within walking distance`);
  ok(!r.data.kitchens.some(k => k.status !== 'approved'), 'only approved kitchens listed');
  await c.post('/api/wallet/topup', { amount: 8000 });
  r = await c.post('/api/orders', { kitchenId: ritu.id, type: 'single', date: today, slot: 'lunch', addons: [{ id: 'salad', qty: 1 }], note: 'Less salt please' });
  ok(r.status === 201, 'orders a single meal for today');
  const single = r.data.order;
  r = await c.post('/api/orders', { kitchenId: anna.id, type: 'trial', date: today, slot: 'lunch' });
  ok(r.status === 201, 'books a trial');
  const trial = r.data.order;
  const chefR = new Client(BASE); await login(chefR, 'ritu@rasoise.demo');
  const chefA = new Client(BASE); await login(chefA, 'asha@rasoise.demo');
  r = await chefR.get(`/api/chef/manifest?date=${today}`);
  const row = r.data.orders.find(o => o.id === single.id);
  ok(row && row.note === 'Less salt please' && row.addons.length === 1, 'chef sees the order with note and add-on');
  ok(r.data.route.some(x => x.orderId === single.id), 'order is on the chef\'s delivery route');
  for (const st of ['preparing', 'out_for_delivery']) await chefR.post(`/api/chef/orders/${single.id}/status`, { status: st });
  r = await c.get(`/api/orders/${single.id}`);
  ok(r.data.order.status === 'out_for_delivery' && r.data.order.outForDeliveryAt, 'customer tracker shows out for delivery');
  await chefR.post(`/api/chef/orders/${single.id}/status`, { status: 'delivered' });
  r = await chefA.post('/api/chef/dispatch', { date: today, slot: 'lunch', status: 'delivered' });
  ok(r.status === 200 && r.data.updated >= 1, `Annapurna dispatches all lunch orders (${r.data.updated})`);
  r = await c.get('/api/wallet');
  ok(r.data.balances.reserved === 0, 'both deliveries charged from reserved balance');
  r = await c.post('/api/reviews', { orderId: single.id, rating: 5, hygiene: 5, taste: 4, comment: 'Healthy and still tasty. Millet roti was soft.', tags: ['Low oil'] });
  ok(r.status === 201, 'customer reviews');
  r = await chefR.post(`/api/reviews/${r.data.review.id}/reply`, { body: 'Thank you Ishaan!' });
  ok(r.status === 200, 'chef replies');
  r = await anon.get(`/api/kitchens/${ritu.id}/reviews`);
  ok(r.data.reviews.some(x => x.reply && x.reply.body === 'Thank you Ishaan!'), 'reply is public on the storefront');

  // ---------- Flow 2 ----------
  console.log('Flow 2: subscribe → pick dishes → pause tomorrow → refund → prep counts');
  r = await c.post('/api/subscriptions', { kitchenId: anna.id, plan: '5day', slot: 'lunch', startDate: addDays(today, 1) });
  ok(r.status === 201, 'subscribes to Annapurna 5-day plan');
  r = await c.get(`/api/calendar?from=${addDays(today, 1)}&to=${addDays(today, 7)}`);
  const withChoice = r.data.orders.find(o => o.courses.some(cc => cc.options.length > 1));
  const course = withChoice.courses.find(cc => cc.options.length > 1);
  r = await c.put(`/api/orders/${withChoice.id}`, { choices: { [course.id]: course.options[1] } });
  ok(r.status === 200 && r.data.order.choices[course.id] === course.options[1], `picks "${course.options[1]}" for ${withChoice.date}`);
  r = await chefA.get(`/api/chef/manifest?date=${withChoice.date}`);
  ok((r.data.counts.choices[course.label] || {})[course.options[1]] >= 1, 'chef prep sheet counts the chosen dish');
  const firstMeal = (await c.get(`/api/calendar?from=${addDays(today, 1)}&to=${addDays(today, 7)}`)).data.orders.find(o => o.type === 'subscription' && o.status === 'scheduled');
  const before = await chefA.get(`/api/chef/manifest?date=${firstMeal.date}`);
  const w0 = (await c.get('/api/wallet')).data.balances.available;
  // Double click on pause: only one refund
  const [p1, p2] = await Promise.all([c.post(`/api/orders/${firstMeal.id}/pause`), c.post(`/api/orders/${firstMeal.id}/pause`)]);
  ok([p1.status, p2.status].sort().join() === '200,400', 'double-clicked pause: one succeeds, one is rejected');
  r = await c.get('/api/wallet');
  // Changed behaviour: a skip with notice moves the money to a make-up day instead of refunding it
  ok(r.data.balances.available === w0, 'skip keeps the money reserved (no cash refund)');
  ok(r.data.ledger[1].kind === 'release' && /Moved to make-up day/.test(r.data.ledger[1].note) && r.data.ledger[0].kind === 'reserve', 'ledger moves the money to the make-up day');
  const after = await chefA.get(`/api/chef/manifest?date=${firstMeal.date}`);
  ok(after.data.counts.total === before.data.counts.total - 1 && after.data.counts.paused === before.data.counts.paused + 1, 'chef prep count drops by one');

  // ---------- Flow 3 ----------
  console.log('Flow 3: complaint → chef reply → admin escalation & refund');
  r = await c.post('/api/tickets', { orderId: trial.id, category: 'wrong_item', message: 'Got Bajra rotla instead of the rotli I chose.' });
  ok(r.status === 201, 'customer raises a complaint');
  const tk = r.data.ticket;
  r = await chefA.post(`/api/tickets/${tk.id}/messages`, { body: 'Sorry, we ran out of rotli dough.' });
  ok(r.data.ticket.status === 'chef_responded', 'chef responds');
  r = await chefA.post(`/api/tickets/${tk.id}/escalate`);
  ok(r.data.ticket.status === 'escalated', 'chef asks admin to step in');
  r = await admin.post(`/api/tickets/${tk.id}/resolve`, { refundAmount: 9999 });
  ok(r.status === 400, 'refund above the order total is rejected');
  r = await admin.post(`/api/tickets/${tk.id}/resolve`, { refundAmount: 40, note: 'Half refunded.' });
  ok(r.status === 200 && r.data.ticket.refund.amount === 40, 'admin resolves with ₹40 refund');
  r = await admin.get('/api/admin/refunds');
  ok(r.data.refunds.some(x => x.ticketId === tk.id), 'refund shows in the refunds register');

  // ---------- Flow 4 ----------
  console.log('Flow 4: chef onboards → approved → on the map → banned → customers refunded');
  const nc = new Client(BASE);
  const fd = new FormData();
  fd.append('name', 'Gauri Patil'); fd.append('phone', '7' + String(Date.now()).slice(-9)); fd.append('password', 'password123');
  fd.append('kitchenName', 'Gauri\'s Varan Bhaat'); fd.append('dietType', 'veg');
  fd.append('location', JSON.stringify({ lat: 19.1405, lng: 72.8250, locality: 'Lokhandwala' }));
  fd.append('radiusM', '2000'); fd.append('slots', '["lunch"]'); fd.append('capacity', '10');
  fd.append('pricing', JSON.stringify({ single: 100, trial: 70, plan5: 1900, plan7: 2500 }));
  r = await nc.req('POST', '/api/chef/register', fd, true);
  ok(r.status === 201, 'new chef registers');
  const gid = r.data.kitchen.id;
  await admin.post(`/api/admin/kitchens/${gid}/approve`, {});
  r = await c.get('/api/kitchens');
  const g = r.data.kitchens.find(k => k.id === gid);
  ok(g && g.location.lat && g.distance != null, 'approved kitchen appears with map coordinates and distance');
  r = await c.post('/api/subscriptions', { kitchenId: gid, plan: '7day', slot: 'lunch', startDate: addDays(today, 1) });
  ok(r.status === 201, 'customer subscribes to the new kitchen');
  const w1 = (await c.get('/api/wallet')).data.balances;
  r = await admin.post(`/api/admin/kitchens/${gid}/ban`, { reason: 'Failed hygiene inspection' });
  ok(r.status === 200 && r.data.refunded === 2500, 'ban refunds the full ₹2500 plan');
  const w2 = (await c.get('/api/wallet')).data.balances;
  ok(w2.available === w1.available + 2500 && w2.reserved === w1.reserved - 2500, 'money moves from reserved back to available');
  r = await c.get('/api/notifications');
  ok(r.data.notifications.some(n => n.type === 'kitchen_banned'), 'customer notified about the ban');
  r = await nc.get('/api/notifications');
  ok(r.data.notifications.some(n => n.type === 'kitchen_banned' && n.body === 'Failed hygiene inspection'), 'chef notified with the reason');

  // ---------- Edge cases ----------
  console.log('Edge cases');
  r = await c.post('/api/orders', { kitchenId: gid, type: 'single', date: addDays(today, 1), slot: 'lunch' });
  ok(r.status === 400 && r.data.code === 'KITCHEN_UNAVAILABLE', 'banned kitchen cannot be ordered from');
  r = await anon.get(`/api/kitchens/${gid}`);
  ok(r.status === 404, 'banned kitchen page is not public');

  const broke = new Client(BASE);
  await broke.post('/api/auth/signup', { name: 'Empty Wallet', phone: '6' + String(Date.now()).slice(-9), password: 'password123' });
  await broke.post('/api/me/addresses', { label: 'Home', flat: '1', lat: 19.1415, lng: 72.8240 });
  r = await broke.post('/api/subscriptions', { kitchenId: anna.id, plan: '5day', slot: 'lunch', startDate: addDays(today, 1) });
  ok(r.status === 402 && r.data.code === 'LOW_BALANCE', 'empty wallet: plan blocked with a top-up message');

  // Full capacity: Sindhi Swaad has capacity 15; set to 1 and fill it
  const chefS = new Client(BASE); await login(chefS, 'kavita@rasoise.demo');
  const sindhi = (await anon.get('/api/kitchens')).data.kitchens.find(k => k.name === 'Sindhi Swaad');
  const fullDate = addDays(today, 9);
  await chefS.put('/api/chef/kitchen', { capacity: 1 });
  r = await c.post('/api/orders', { kitchenId: sindhi.id, type: 'single', date: fullDate, slot: 'dinner' });
  const avail = await anon.get(`/api/kitchens/${sindhi.id}/availability?days=14`);
  const fd2 = avail.data.days.find(x => x.date === fullDate);
  if (r.status === 201) ok(fd2.slots.dinner.left === 0 && !fd2.slots.dinner.bookable, 'slot shows as full after the last meal is booked');
  else ok(r.data.code === 'FULL' || r.data.code === 'CLOSED', 'slot already full/closed');
  await broke.post('/api/wallet/topup', { amount: 500 });
  r = await broke.post('/api/orders', { kitchenId: sindhi.id, type: 'single', date: fullDate, slot: 'dinner' });
  ok(r.status === 409 && r.data.code === 'FULL' || r.data.code === 'CLOSED', 'full kitchen auto-blocks new orders');
  await chefS.put('/api/chef/kitchen', { capacity: 15 });

  r = await anon.get('/api/orders');
  ok(r.status === 401, 'logged-out user gets 401 on orders API');
  for (const page of ['/calendar.html', '/orders.html', '/profile.html', '/chef-dashboard.html', '/admin-console.html']) {
    r = await anon.get(page);
    ok(r.status === 302 && r.headers.get('location').startsWith('/login.html'), `logged-out ${page} → login`);
  }
  r = await c.get('/chef-dashboard.html');
  ok(r.status === 302 && r.headers.get('location') === '/index.html', 'customer cannot open the chef dashboard');
  r = await chefA.get('/api/orders');
  ok(r.status === 403, 'chef cannot use customer order API');

  r = await c.post('/api/wallet/topup', { amount: 10 });
  ok(r.status === 400, 'top-up below ₹50 rejected');
  r = await c.post('/api/orders', { kitchenId: anna.id, type: 'single', date: 'not-a-date', slot: 'lunch' });
  ok(r.status === 400, 'invalid date rejected');
  r = await c.post('/api/orders', { kitchenId: anna.id, type: 'single', date: addDays(today, 1), slot: 'breakfast' });
  ok(r.status === 400, 'invalid slot rejected');
  r = await c.post('/api/orders', { kitchenId: anna.id, type: 'single', date: addDays(today, -1), slot: 'lunch' });
  ok(r.status === 400 && r.data.code === 'CUTOFF_PASSED', 'order for a past date rejected');
  r = await c.post('/api/me/addresses', { label: 'Home', flat: 'X' });
  ok(r.status === 400, 'address without a map pin rejected');
  r = await new Client(BASE).post('/api/auth/signup', { name: 'Bad', email: 'not-an-email', password: 'password123' });
  ok(r.status === 400 && r.data.fields.email, 'bad email rejected with a field error');
  r = await chefA.put('/api/chef/kitchen', { fssai: '1234' });
  ok(r.status === 400, 'FSSAI number must be 14 digits');
  r = await chefA.put('/api/chef/kitchen', { cutoffTime: '14:00' });
  ok(r.status === 400, 'cutoff later than 11 AM rejected');
  r = await c.post('/api/reviews', { orderId: trial.id, rating: 9, comment: 'Way too many stars here' });
  ok(r.status === 400, 'rating outside 1–5 rejected');
  r = await c.post('/api/reviews', { orderId: firstMeal.id, rating: 5, comment: 'Not delivered yet but reviewing' });
  ok(r.status === 400, 'cannot review an undelivered meal');

  console.log(`\nAll ${passed} checks passed.`);
})().catch(err => {
  console.error('\n✗ FAILED:', err.message);
  process.exitCode = 1;
});
