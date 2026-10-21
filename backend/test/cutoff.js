// After-cutoff checks. The runner starts the server at 9:00 AM IST on the same day,
// so today's 8:00 AM cutoff has passed. (Priya's Amma's Kitchen plan has lunch on weekdays.)

const assert = require('assert');
const Client = require('./client');

const BASE = process.env.BASE || 'http://localhost:3000';
let passed = 0;
function ok(cond, msg) { assert.ok(cond, msg); passed++; console.log('  ✓', msg); }

(async () => {
  const c = new Client(BASE);
  await c.post('/api/auth/login', { identifier: 'priya@rasoise.demo', password: 'demo1234' });
  const today = (await c.get('/api/config')).data.today;

  console.log('After the 8 AM cutoff');
  let r = await c.get(`/api/calendar?from=${today}&to=${today}`);
  const meal = r.data.orders.find(o => o.status === 'scheduled');
  ok(meal && !meal.editable, 'today\'s plan meal is locked in the calendar');
  r = await c.post(`/api/orders/${meal.id}/pause`);
  ok(r.status === 400 && r.data.code === 'DEADLINE_PASSED', 'skipping today\'s meal after the notice deadline is refused');
  r = await c.put(`/api/orders/${meal.id}`, { note: 'too late' });
  ok(r.status === 400 && r.data.code === 'DEADLINE_PASSED', 'editing today\'s meal after the deadline is refused');
  const kitchens = (await c.get('/api/kitchens')).data.kitchens;
  const ritu = kitchens.find(k => k.name === 'Healthy Thali by Ritu');
  r = await c.post('/api/orders', { kitchenId: ritu.id, type: 'single', date: today, slot: 'lunch' });
  ok(r.status === 400 && r.data.code === 'CUTOFF_PASSED', 'ordering for today after cutoff is refused');
  ok(!ritu.nextOpening || ritu.nextOpening.date > today, 'marketplace shows the next opening as a later day');

  const chef = new Client(BASE);
  await chef.post('/api/auth/login', { identifier: 'harpreet@rasoise.demo', password: 'demo1234' });
  r = await chef.get(`/api/chef/manifest?date=${today}`);
  ok(r.data.cutoffPassed === true, 'chef manifest says today\'s orders are locked');

  console.log(`\nAll ${passed} checks passed.`);
})().catch(err => {
  console.error('\n✗ FAILED:', err.message);
  process.exitCode = 1;
});
