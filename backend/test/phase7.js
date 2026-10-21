// Notice period, make-up days, skip limits, "won't be home", no-shows, freeze plan,
// cook emergency cancellations + strikes, and a full ledger reconciliation.
// The runner sets the clock to Tue 20 Oct 2026, 7:00 AM IST:
//   - Wed 21 lunch (starts 12:30) can still be changed until Tue 20, 12:30 PM (24 h notice)
//   - Tue 20 lunch closed on Mon 19, 12:30 PM

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Client = require('./client');

const BASE = process.env.BASE || 'http://localhost:3000';
let passed = 0;
function ok(cond, msg) { assert.ok(cond, msg); passed++; console.log('  ✓', msg); }
const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const stamp = () => String(Date.now()).slice(-9);

async function newCustomer(name, lat = 19.1415, lng = 72.8240, money = 20000) {
  const c = new Client(BASE);
  await c.post('/api/auth/signup', { name, phone: '9' + stamp(), password: 'password123' });
  await c.post('/api/me/addresses', { label: 'Home', flat: '12', lat, lng });
  await c.post('/api/wallet/topup', { amount: Math.min(money, 10000) });
  if (money > 10000) await c.post('/api/wallet/topup', { amount: money - 10000 });
  return c;
}

(async () => {
  const anon = new Client(BASE);
  const today = (await anon.get('/api/config')).data.today;
  const tomorrow = addDays(today, 1);
  const kitchens = (await anon.get('/api/kitchens')).data.kitchens;
  const anna = kitchens.find(k => k.name === 'Annapurna Kitchen');
  const nanak = kitchens.find(k => k.name === "Nanak's Rasoi");
  const ritu = kitchens.find(k => k.name === 'Healthy Thali by Ritu');
  const admin = new Client(BASE);
  await admin.post('/api/auth/login', { identifier: 'admin@rasoise.in', password: process.env.ADMIN_PASSWORD || 'RasoiAdmin@2026' });
  const asha = new Client(BASE); await asha.post('/api/auth/login', { identifier: 'asha@rasoise.demo', password: 'demo1234' });
  const harpreet = new Client(BASE); await harpreet.post('/api/auth/login', { identifier: 'harpreet@rasoise.demo', password: 'demo1234' });
  const ritaChef = new Client(BASE); await ritaChef.post('/api/auth/login', { identifier: 'ritu@rasoise.demo', password: 'demo1234' });

  // ---------- Deadline ----------
  console.log('24-hour notice deadline');
  const c = await newCustomer('Deadline Tester');
  let r = await c.post('/api/subscriptions', { kitchenId: anna.id, plan: '5day', slot: 'lunch', startDate: tomorrow });
  ok(r.status === 201 && r.data.subscription.mealsTotal === 22, 'starts a 5-day plan from tomorrow');
  const sub = r.data.subscription;
  const firstEnd = sub.lastDate;
  r = await c.get(`/api/calendar?from=${tomorrow}&to=${tomorrow}`);
  const wed = r.data.orders[0];
  ok(wed.deadline === `${today}T07:00:00.000Z`, 'Wed lunch deadline is Tue 12:30 PM IST (24 h before 12:30)');
  ok(/Tue 20 Oct, 12:30 PM/.test(wed.deadlineLabel) && wed.changeable && wed.editable, 'deadline label reads "Tue 20 Oct, 12:30 PM" and the meal is still changeable');

  // ---------- Make-up day ----------
  console.log('Skip becomes a make-up day');
  const w0 = (await c.get('/api/wallet')).data.balances;
  r = await c.post(`/api/orders/${wed.id}/pause`);
  ok(r.status === 200 && r.data.order.skipCredit === 'makeup', 'skipping with notice earns a make-up day');
  const w1 = (await c.get('/api/wallet')).data.balances;
  ok(w1.available === w0.available && w1.reserved === w0.reserved, 'money stays reserved (no cash moved)');
  r = await c.get('/api/subscriptions');
  const s1 = r.data.subscriptions.find(x => x.id === sub.id);
  ok(s1.lastDate > firstEnd && s1.counts.makeupDays === 1 && s1.skipsLeft === 3, `plan now ends ${s1.lastDate} (was ${firstEnd}), 3 make-up days left`);
  r = await c.get(`/api/calendar?from=${tomorrow}&to=${s1.lastDate}`);
  const skipped = r.data.orders.find(o => o.id === wed.id);
  const makeup = r.data.orders.find(o => o.isMakeup);
  ok(skipped.makeupDate === makeup.date && makeup.date === s1.lastDate, 'calendar links the skipped day to its make-up day');
  const wd = new Date(makeup.date + 'T00:00:00Z').getUTCDay();
  ok(wd !== 0 && wd !== 6, 'make-up day skips the weekend on a 5-day plan');

  console.log('Next open day skips holidays and full days');
  const nextAfter = addDays(s1.lastDate, 1);
  const skipWeekend = d => { let x = d; while ([0, 6].includes(new Date(x + 'T00:00:00Z').getUTCDay())) x = addDays(x, 1); return x; };
  const h = skipWeekend(nextAfter);
  r = await asha.post('/api/chef/holidays', { date: h, reason: 'Wedding in the family' });
  ok(r.status === 200, `cook marks ${h} as a holiday`);
  r = await c.get(`/api/calendar?from=${tomorrow}&to=${tomorrow}`);
  const thu = (await c.get(`/api/calendar?from=${addDays(tomorrow, 1)}&to=${addDays(tomorrow, 1)}`)).data.orders[0];
  r = await c.post(`/api/orders/${thu.id}/pause`);
  r = await c.get(`/api/calendar?from=${tomorrow}&to=${addDays(today, 90)}`);
  const m2 = r.data.orders.find(o => o.makeupOf === thu.id);
  ok(m2 && m2.date !== h && m2.date > h, `second make-up day jumps over the holiday (${m2 && m2.date})`);

  console.log('Resume removes the make-up day again');
  r = await c.post(`/api/orders/${thu.id}/resume`);
  ok(r.status === 200, 'resumes the skipped meal before the deadline');
  r = await c.get('/api/subscriptions');
  const sAfter = r.data.subscriptions.find(x => x.id === sub.id);
  ok(sAfter.skipsLeft === 3, 'make-up credit is given back');
  ok(sAfter.lastDate === s1.lastDate, `plan end moves back to ${s1.lastDate} (not stuck on the cancelled make-up day)`);
  r = await c.get(`/api/calendar?from=${tomorrow}&to=${addDays(today, 90)}`);
  ok(r.data.orders.find(o => o.makeupOf === thu.id).status === 'cancelled', 'its make-up day is cancelled');

  console.log('Skip limit');
  r = await c.get(`/api/calendar?from=${addDays(tomorrow, 1)}&to=${addDays(today, 40)}`);
  const plan = r.data.orders.filter(o => o.subscriptionId === sub.id && o.status === 'scheduled' && !o.isMakeup).slice(0, 4);
  for (const o of plan.slice(0, 3)) await c.post(`/api/orders/${o.id}/pause`);
  r = await c.get('/api/subscriptions');
  ok(r.data.subscriptions.find(x => x.id === sub.id).skipsLeft === 0, 'four skips use up the 4 make-up days');
  const w2 = (await c.get('/api/wallet')).data.balances;
  const earnBefore = (await asha.get('/api/chef/earnings')).data.balances.available;
  r = await c.post(`/api/orders/${plan[3].id}/pause`);
  ok(r.status === 200 && r.data.order.skipCredit === 'none', 'fifth skip still stops the delivery but earns no credit');
  const w3 = (await c.get('/api/wallet')).data.balances;
  ok(w3.reserved === w2.reserved - plan[3].total && w3.available === w2.available, 'that meal is charged from reserved money');
  const earnAfter = (await asha.get('/api/chef/earnings')).data.balances.available;
  ok(earnAfter > earnBefore, 'the cook keeps her earning (she was told in time)');
  r = await asha.get(`/api/chef/manifest?date=${plan[3].date}`);
  ok(!r.data.orders.some(o => o.id === plan[3].id && o.status === 'scheduled'), 'meal is off the cook\'s prep list');

  console.log('Too late to change');
  r = await asha.put('/api/chef/kitchen', { noticeHours: 10 });
  ok(r.status === 400, 'notice period must be 12, 24 or 48 hours');
  const rohan = new Client(BASE); await rohan.post('/api/auth/login', { identifier: 'rohan@rasoise.demo', password: 'demo1234' });
  r = await rohan.get(`/api/calendar?from=${today}&to=${tomorrow}`);
  const rToday = r.data.orders.find(o => o.date === today && o.status === 'scheduled');
  const rTomorrow = r.data.orders.find(o => o.date === tomorrow && o.status === 'scheduled');
  ok(!rToday.changeable && !rToday.editable, 'today\'s meal is locked (deadline was yesterday 12:30 PM)');
  r = await rohan.post(`/api/orders/${rToday.id}/pause`);
  ok(r.status === 400 && r.data.code === 'DEADLINE_PASSED', 'skip after the deadline is refused');
  r = await rohan.put(`/api/orders/${rToday.id}`, { note: 'late change' });
  ok(r.status === 400 && r.data.code === 'DEADLINE_PASSED', 'edits after the deadline are refused');
  r = await rohan.post(`/api/orders/${rTomorrow.id}/away`);
  ok(r.status === 400 && r.data.code === 'CAN_STILL_SKIP', '"I won\'t be home" is only for meals past the deadline');

  console.log('"I won\'t be home" and keep for pickup');
  const wr0 = (await rohan.get('/api/wallet')).data.balances;
  r = await rohan.post(`/api/orders/${rToday.id}/away`);
  ok(r.status === 200 && r.data.order.customerAway, 'customer tells the cook they won\'t be home');
  r = await harpreet.get(`/api/chef/manifest?date=${today}`);
  ok(r.data.orders.find(o => o.id === rToday.id).customerAway, 'cook sees it on the manifest');
  r = await harpreet.post(`/api/chef/orders/${rToday.id}/pickup`);
  ok(r.status === 200 && r.data.order.keepForPickup, 'cook keeps the meal for pickup');
  ok((await rohan.get('/api/wallet')).data.balances.reserved === wr0.reserved, 'meal is still paid (no credit)');

  console.log('Holiday mode longer than 7 days → freeze');
  r = await c.post('/api/meals/holiday', { from: addDays(today, 3), to: addDays(today, 12), action: 'pause' });
  ok(r.status === 400 && r.data.code === 'USE_FREEZE', 'holiday mode over 7 days points to "Freeze plan"');

  console.log('Freeze plan');
  const f = await newCustomer('Freeze Tester', 19.1352, 72.8160);
  r = await f.post('/api/subscriptions', { kitchenId: nanak.id, plan: '7day', slot: 'lunch', startDate: tomorrow });
  const fsub = r.data.subscription;
  const fw0 = (await f.get('/api/wallet')).data.balances;
  const away = { from: addDays(today, 3), to: addDays(today, 12) };
  r = await f.post(`/api/subscriptions/${fsub.id}/freeze`, away);
  ok(r.status === 200 && r.data.moved >= 25, `freeze moves ${r.data.moved} remaining meals`);
  const newEnd = r.data.endDate;
  r = await f.get(`/api/calendar?from=${away.from}&to=${away.to}`);
  ok(!r.data.orders.some(o => o.subscriptionId === fsub.id && o.status === 'scheduled'), 'nothing is delivered while away');
  r = await f.get('/api/subscriptions');
  ok(r.data.subscriptions[0].lastDate === newEnd && newEnd > fsub.lastDate, `plan now ends ${newEnd} (was ${fsub.lastDate})`);
  const fw1 = (await f.get('/api/wallet')).data.balances;
  ok(fw1.available === fw0.available && fw1.reserved === fw0.reserved, 'freeze moves no money');
  r = await f.post(`/api/subscriptions/${fsub.id}/freeze`, { from: addDays(today, 15), to: addDays(today, 17) });
  ok(r.status === 400 && r.data.code === 'FREEZE_USED', 'only one freeze per month');

  console.log('Cook emergency cancellations and strikes');
  r = await rohan.get(`/api/calendar?from=${today}&to=${today}`);
  const rohanWallet0 = (await rohan.get('/api/wallet')).data.balances;
  const hEarn0 = (await harpreet.get('/api/chef/earnings')).data.balances.available;
  r = await harpreet.post(`/api/chef/orders/${rToday.id}/cancel`, {});
  ok(r.status === 400 && r.data.code === 'REASON_REQUIRED', 'late cancel without a reason is refused');
  r = await harpreet.post(`/api/chef/orders/${rToday.id}/cancel`, { reason: 'Gas cylinder ran out' });
  ok(r.status === 200 && r.data.late && r.data.makeups === 1 && r.data.goodwill === 20, 'emergency cancel: make-up day + ₹20 goodwill');
  const rohanWallet1 = (await rohan.get('/api/wallet')).data.balances;
  ok(rohanWallet1.available === rohanWallet0.available + 20, 'customer gets the ₹20 goodwill credit');
  const hEarn1 = (await harpreet.get('/api/chef/earnings')).data.balances.available;
  ok(hEarn1 === hEarn0 - 20, 'goodwill is taken from the cook\'s earnings');
  r = await rohan.get('/api/notifications');
  ok(r.data.notifications.some(n => /Gas cylinder/.test(n.body) && /goodwill/.test(n.body)), 'customer is told why, with the make-up day and credit');
  // Two more late single-order cancellations → third strike → automatic warning
  const s2 = await newCustomer('Strike Tester', 19.1352, 72.8160);
  const singles = [];
  for (const slot of ['lunch', 'dinner']) {
    r = await s2.post('/api/orders', { kitchenId: nanak.id, type: 'single', date: today, slot });
    singles.push(r.data.order);
  }
  for (const o of singles) await harpreet.post(`/api/chef/orders/${o.id}/cancel`, { reason: 'Unwell today, sorry' });
  r = await admin.get('/api/admin/kitchens');
  ok(r.data.kitchens.find(k => k.id === nanak.id).strikesThisMonth === 3, 'three late cancellations = three strikes');
  r = await harpreet.get('/api/notifications');
  ok(r.data.notifications.some(n => n.type === 'kitchen_warning' && /late cancellations/.test(n.title)), 'cook gets an automatic warning');
  r = await admin.get('/api/notifications');
  ok(r.data.notifications.some(n => /3 late cancellations/.test(n.title)), 'admin is alerted');
  r = await anon.get(`/api/kitchens/${nanak.id}`);
  const rel = r.data.kitchen.stats.reliability;
  ok(rel && rel.percent < 100, `kitchen page shows reliability (${rel && rel.percent}% of booked meals delivered)`);
  const td = r.data.kitchen.todaysDish;
  ok(!td || (td.name && ['veg', 'egg', 'nonveg'].includes(td.type) && typeof td.photo === 'string'),
    `today's dish comes with its own type and photo field (${td ? `${td.name}, ${td.type}` : 'nothing cooking today'})`);

  console.log('Cook holiday with notice: no strike');
  const strikesBefore = (await admin.get('/api/admin/kitchens')).data.kitchens.find(k => k.id === anna.id).strikesThisMonth;
  r = await asha.post('/api/chef/holidays', { date: skipWeekend(addDays(today, 6)) });
  ok(r.status === 200 && !r.data.late, 'holiday with notice needs no reason');
  ok((await admin.get('/api/admin/kitchens')).data.kitchens.find(k => k.id === anna.id).strikesThisMonth === strikesBefore, 'and gives no strike');

  console.log('Customer not available (no-shows)');
  const n = await newCustomer('NoShow Tester', 19.1410, 72.8235);
  const ns = [];
  r = await n.post('/api/orders', { kitchenId: anna.id, type: 'single', date: today, slot: 'lunch' }); ns.push([asha, r.data.order]);
  r = await n.post('/api/orders', { kitchenId: anna.id, type: 'single', date: today, slot: 'dinner' }); ns.push([asha, r.data.order]);
  r = await n.post('/api/orders', { kitchenId: ritu.id, type: 'single', date: today, slot: 'lunch' }); ns.push([ritaChef, r.data.order]);
  const nw0 = (await n.get('/api/wallet')).data.balances;
  for (const [chef, o] of ns) {
    r = await chef.post(`/api/chef/orders/${o.id}/not-available`);
  }
  ok(r.status === 200 && r.data.order.status === 'delivered' && r.data.order.outcome === 'not_available', 'not available counts as delivered');
  const nw1 = (await n.get('/api/wallet')).data.balances;
  ok(nw1.reserved === nw0.reserved - ns.reduce((s, [, o]) => s + o.amount, 0), 'and the meals are charged');
  r = await n.get('/api/notifications');
  ok(r.data.notifications.some(x => /3 missed deliveries/.test(x.body)), 'third no-show warns the customer');
  r = await admin.get('/api/admin/users?q=NoShow');
  ok(r.data.users[0].noShowsThisMonth === 3 && r.data.users[0].flagged, 'customer is flagged to admin');

  console.log('Ledger reconciles');
  // Read what is actually stored: the JSON file, or MongoDB (proving the writes really landed there)
  let data;
  if (process.env.MONGODB_URI) {
    await new Promise(res => setTimeout(res, 500)); // let the last queued write finish
    const { MongoClient } = require('mongodb');
    const mc = new MongoClient(process.env.MONGODB_URI);
    await mc.connect();
    const mdb = mc.db(process.env.MONGODB_DB);
    data = {};
    for (const c of ['users', 'orders', 'walletTransactions']) data[c] = await mdb.collection(c).find({}).toArray();
    await mc.close();
  } else {
    data = JSON.parse(fs.readFileSync(path.resolve(path.join(__dirname, '..'), process.env.DB_FILE), 'utf8'));
  }
  let bad = 0;
  data.users.filter(u => u.role === 'customer').forEach(u => {
    const ledger = data.walletTransactions.filter(t => t.userId === u.id);
    const reserved = ledger.reduce((s, t) => s + t.reserved, 0);
    const available = ledger.reduce((s, t) => s + t.available, 0);
    const held = data.orders.filter(o => o.customerId === u.id && !o.charged && ['scheduled', 'preparing', 'out_for_delivery'].includes(o.status))
      .reduce((s, o) => s + (o.paid || 0) - (o.refunded || 0), 0);
    if (reserved !== held || available < 0 || reserved < 0) bad++;
  });
  ok(bad === 0, 'every customer: reserved money = money held on undelivered meals, nothing negative');
  const topups = data.walletTransactions.filter(t => t.kind === 'topup').reduce((s, t) => s + t.available, 0);
  const goodwill = data.walletTransactions.filter(t => t.kind === 'refund').reduce((s, t) => s + t.available, 0);
  const custIds = new Set(data.users.filter(u => u.role === 'customer').map(u => u.id));
  const custTotal = data.walletTransactions.filter(t => custIds.has(t.userId)).reduce((s, t) => s + t.available + t.reserved, 0);
  const charged = -data.walletTransactions.filter(t => t.kind === 'charge').reduce((s, t) => s + t.reserved, 0);
  ok(custTotal === topups + goodwill - charged, 'customer money in = money left + money spent on meals');

  console.log(`\nAll ${passed} checks passed.`);
})().catch(err => {
  console.error('\n✗ FAILED:', err.message);
  process.exitCode = 1;
});
