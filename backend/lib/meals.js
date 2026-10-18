// Meal & order rules shared by customer, chef and admin routes:
// what's on the menu for a date, whether a kitchen is open, capacity, cutoff, pricing,
// creating orders and building a subscription's meal dates.

const db = require('../db');
const time = require('./time');
const wallet = require('./wallet');
const { haversineMeters, hasCoords } = require('./geo');

// Statuses that use up a kitchen's capacity
const ACTIVE = ['scheduled', 'preparing', 'out_for_delivery', 'delivered'];
const CHEF_FLOW = ['scheduled', 'preparing', 'out_for_delivery', 'delivered'];

const PLAN_MEALS = { '5day': 22, '7day': 30 };
const PLAN_LABEL = { '5day': '5-day plan (Mon–Fri)', '7day': '7-day plan (Mon–Sun)' };
const SLOT_LABEL = { lunch: 'Lunch', dinner: 'Dinner' };

function httpError(status, message, code) {
  const err = new Error(message);
  err.status = status;
  if (code) err.code = code;
  return err;
}

function getMenu(d, kitchenId) {
  return d.menus.find(m => m.kitchenId === kitchenId) || { kitchenId, dishes: [], addons: [], weekly: {}, specials: [] };
}

// Why a kitchen can't serve this date/slot, or null when it can.
function closedReason(kitchen, date, slot) {
  if (slot && !kitchen.slots.includes(slot)) return `${kitchen.name} doesn't serve ${slot}.`;
  if (kitchen.offDays.includes(time.dayKey(date))) return `${kitchen.name} is closed on ${capitalise(time.dayKey(date))}s.`;
  const holiday = kitchen.holidays.find(h => h.date === date);
  if (holiday) return `${kitchen.name} is on holiday that day${holiday.reason ? ` (${holiday.reason})` : ''}.`;
  return null;
}

function capitalise(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function dayMenu(d, kitchen, date) {
  const menu = getMenu(d, kitchen.id);
  const day = menu.weekly[time.dayKey(date)] || { courses: [] };
  const special = (menu.specials || []).find(s => s.date === date) || null;
  return { courses: day.courses || [], special, addons: menu.addons || [] };
}

function usedCapacity(d, kitchenId, date, slot, excludeOrderId = null) {
  return d.orders.filter(o =>
    o.kitchenId === kitchenId && o.date === date && o.slot === slot &&
    ACTIVE.includes(o.status) && o.id !== excludeOrderId
  ).length;
}

function capacityLeft(d, kitchen, date, slot, excludeOrderId = null) {
  return Math.max(0, kitchen.capacity - usedCapacity(d, kitchen.id, date, slot, excludeOrderId));
}

// Only accept known options. When nothing was picked, choose the first option that suits
// the customer's diet (e.g. a veg customer gets Paneer, not Chicken), else the first option.
function cleanChoices(courses, choices = {}, dishes = [], diet = null) {
  const allowed = { veg: ['veg'], jain: ['veg'], egg: ['veg', 'egg'], nonveg: ['veg', 'egg', 'nonveg'] }[diet] || null;
  const typeOf = name => {
    const d = dishes.find(x => x.name.toLowerCase() === String(name).toLowerCase());
    return d ? d.type : 'veg';
  };
  const out = {};
  courses.forEach(c => {
    const picked = choices[c.id];
    if (c.options.includes(picked)) out[c.id] = picked;
    else out[c.id] = (allowed && c.options.find(o => allowed.includes(typeOf(o)))) || c.options[0];
  });
  return out;
}

// addons input: [{ id, qty }] -> priced list from the kitchen's add-on list (+ the day's special)
function priceAddons(dm, input = []) {
  const items = [];
  (Array.isArray(input) ? input : []).forEach(a => {
    const qty = Math.max(0, Math.min(5, parseInt(a.qty, 10) || 0));
    if (!qty) return;
    let source = dm.addons.find(x => x.id === a.id);
    if (!source && dm.special && a.id === 'special') {
      source = { id: 'special', name: `Today's special: ${dm.special.name}`, price: dm.special.price };
    }
    if (source) items.push({ id: source.id, name: source.name, price: Number(source.price) || 0, qty });
  });
  const total = items.reduce((s, x) => s + x.price * x.qty, 0);
  return { items, total };
}

// veg / egg / nonveg, from the dish library tags of the chosen options
function mealType(d, kitchen, choices) {
  if (kitchen.dietType === 'veg') return 'veg';
  const dishes = getMenu(d, kitchen.id).dishes || [];
  let type = 'veg';
  Object.values(choices || {}).forEach(name => {
    const dish = dishes.find(x => x.name.toLowerCase() === String(name).toLowerCase());
    if (dish && dish.type === 'nonveg') type = 'nonveg';
    else if (dish && dish.type === 'egg' && type === 'veg') type = 'egg';
  });
  return type;
}

function findAddress(user, addressId) {
  const list = user.addresses || [];
  return list.find(a => a.id === addressId) || list.find(a => a.id === user.defaultAddressId) || list[0] || null;
}

function addressSnapshot(a) {
  if (!a) return null;
  return {
    id: a.id, label: a.label, flat: a.flat || '', building: a.building || '', landmark: a.landmark || '',
    formatted: a.formatted || '', lat: a.lat, lng: a.lng
  };
}

function checkDeliveryArea(kitchen, address) {
  if (!address) throw httpError(400, 'Please add a delivery address first.', 'NO_ADDRESS');
  if (!hasCoords(address)) throw httpError(400, 'Please pin your delivery address on the map.', 'NO_COORDS');
  if (!hasCoords(kitchen.location)) return null;
  const dist = haversineMeters(kitchen.location, address);
  if (dist > kitchen.radiusM) {
    throw httpError(400, `${kitchen.name} delivers within ${(kitchen.radiusM / 1000).toFixed(1)} km. Your address is ${(dist / 1000).toFixed(1)} km away.`, 'OUT_OF_RADIUS');
  }
  return dist;
}

function prefsSnapshot(user) {
  const p = user.preferences || {};
  return {
    diet: p.diet || 'veg', noOnionGarlic: !!p.noOnionGarlic, spice: p.spice || 'medium',
    allergies: p.allergies || [], rotiCount: p.rotiCount == null ? 4 : p.rotiCount, rice: p.rice !== false
  };
}

// Kitchen must be live and taking orders for this date/slot.
function assertBookable(d, kitchen, date, slot, excludeOrderId = null) {
  if (kitchen.status !== 'approved') throw httpError(400, 'This kitchen is not taking orders.', 'KITCHEN_UNAVAILABLE');
  if (kitchen.paused) throw httpError(400, `${kitchen.name} has paused new orders for now.`, 'KITCHEN_PAUSED');
  if (!time.isValidDate(date)) throw httpError(400, 'Please choose a valid date.');
  if (!['lunch', 'dinner'].includes(slot)) throw httpError(400, 'Please choose lunch or dinner.');
  if (!time.isBeforeCutoff(date, kitchen.cutoffTime)) {
    throw httpError(400, `Orders for ${date} closed at ${time.fmt12(kitchen.cutoffTime)}. Please pick a later date.`, 'CUTOFF_PASSED');
  }
  if (time.diffDays(time.today(), date) > 60) throw httpError(400, 'You can book up to 60 days ahead.');
  const reason = closedReason(kitchen, date, slot);
  if (reason) throw httpError(400, reason, 'CLOSED');
  if (capacityLeft(d, kitchen, date, slot, excludeOrderId) <= 0) {
    throw httpError(409, `${kitchen.name} is fully booked for ${SLOT_LABEL[slot].toLowerCase()} on ${date}.`, 'FULL');
  }
}

// Create one meal order and reserve its money. Throws on any rule violation.
function createOrder(d, { customer, kitchen, type, date, slot, choices, addons, note, address, amount, subscriptionId = null, skipBookableCheck = false }) {
  if (!skipBookableCheck) assertBookable(d, kitchen, date, slot);
  const dm = dayMenu(d, kitchen, date);
  const cleanC = cleanChoices(dm.courses, choices, getMenu(d, kitchen.id).dishes || [], (customer.preferences || {}).diet);
  const priced = priceAddons(dm, addons);
  const id = db.nextId('orders');
  const order = {
    id,
    code: 'RS' + (1000 + id),
    customerId: customer.id,
    kitchenId: kitchen.id,
    subscriptionId,
    type, // single | trial | subscription
    date,
    slot,
    status: 'scheduled',
    choices: cleanC,
    addons: priced.items,
    note: String(note || '').slice(0, 200),
    address: addressSnapshot(address),
    prefs: prefsSnapshot(customer),
    mealType: mealType(d, kitchen, cleanC),
    amount,
    addonsTotal: priced.total,
    paid: 0,
    refunded: 0,
    statusHistory: [{ status: 'scheduled', at: time.nowISO() }],
    createdAt: time.nowISO(),
    updatedAt: time.nowISO()
  };
  d.orders.push(order);
  const label = type === 'subscription' ? 'Plan meal' : type === 'trial' ? 'Trial meal' : 'Meal';
  wallet.reserve(d, order, amount + priced.total, `${label}: ${kitchen.name}, ${date} ${slot}`);
  return order;
}

// Dates a plan will deliver on, starting from `start`, skipping weekends (5-day plan),
// the kitchen's weekly off-days and holidays.
function planDates(kitchen, plan, start, count = PLAN_MEALS[plan]) {
  const dates = [];
  let date = start;
  let guard = 0;
  while (dates.length < count && guard < 200) {
    const wd = time.weekday(date);
    const weekendSkip = plan === '5day' && (wd === 0 || wd === 6);
    if (!weekendSkip && !closedReason(kitchen, date, null)) dates.push(date);
    date = time.addDays(date, 1);
    guard++;
  }
  return dates;
}

// Split a total into n whole-rupee parts that add back up exactly.
function splitPrice(total, n) {
  const base = Math.floor(total / n);
  let extra = total - base * n;
  return Array.from({ length: n }, () => base + (extra-- > 0 ? 1 : 0));
}

function dietaryNotes(order) {
  const p = order.prefs || {};
  const notes = [];
  if (p.diet === 'jain') notes.push('Jain');
  if (p.diet === 'egg') notes.push('Eggetarian');
  if (p.noOnionGarlic && p.diet !== 'jain') notes.push('No onion-garlic');
  if (p.spice && p.spice !== 'medium') notes.push(p.spice === 'mild' ? 'Mild spice' : 'Extra spicy');
  if (p.rotiCount != null) notes.push(`${p.rotiCount} roti`);
  if (p.rice === false) notes.push('No rice');
  if (p.allergies && p.allergies.length) notes.push('Allergy: ' + p.allergies.join(', '));
  return notes;
}

function orderTotal(o) {
  return (o.amount || 0) + (o.addonsTotal || 0);
}

// ---------- Notice period ----------
// Each slot starts at a set time (lunch 12:30, dinner 19:30). Changes to a meal (skip, resume,
// cancel, dishes, extras, slot, address) close the kitchen's notice period before that,
// e.g. 24 hours' notice: Saturday lunch can be changed until Friday 12:30 PM (India time).

function slotStart(kitchen, date, slot) {
  const times = kitchen.slotTimes || {};
  return time.istMoment(date, times[slot] || (slot === 'dinner' ? '19:30' : '12:30'));
}

function changeDeadline(kitchen, date, slot) {
  return new Date(slotStart(kitchen, date, slot).getTime() - (kitchen.noticeHours || 24) * 3600000);
}

function canChange(kitchen, date, slot) {
  return time.now() < changeDeadline(kitchen, date, slot);
}

function assertCanChange(kitchen, order, what = 'change') {
  if (canChange(kitchen, order.date, order.slot)) return;
  const by = time.fmtIST(changeDeadline(kitchen, order.date, order.slot));
  throw httpError(400, `Too late to ${what} this meal. Changes closed on ${by} (${kitchen.noticeHours || 24} hours' notice).`, 'DEADLINE_PASSED');
}

// Earliest deadline among the slots a kitchen serves on a date (used for whole-day closures)
function dayDeadline(kitchen, date) {
  const slots = (kitchen.slots && kitchen.slots.length) ? kitchen.slots : ['lunch'];
  return new Date(Math.min(...slots.map(s => changeDeadline(kitchen, date, s).getTime())));
}

// ---------- Make-up days ----------

// Last date this plan delivers on (including make-up days), ignoring cancelled meals
// Last date this plan still has a meal on. Recomputed from the meals (not the stored endDate)
// so it moves back again when a skip is resumed. A plan with no meals left keeps its old end.
function planLastDate(d, sub) {
  const last = d.orders
    .filter(o => o.subscriptionId === sub.id && ACTIVE.includes(o.status))
    .reduce((m, o) => (!m || o.date > m ? o.date : m), null);
  return last || sub.endDate || sub.startDate;
}

// First day after `after` this plan can deliver `slot`: skips weekends on a 5-day plan,
// the kitchen's off-days and holidays, days that are full, and days already booked on this plan.
function nextOpenDate(d, kitchen, sub, after, slot) {
  let date = time.addDays(after, 1);
  for (let i = 0; i < 120; i++, date = time.addDays(date, 1)) {
    const wd = time.weekday(date);
    if (sub.plan === '5day' && (wd === 0 || wd === 6)) continue;
    if (closedReason(kitchen, date, slot)) continue;
    if (capacityLeft(d, kitchen, date, slot) <= 0) continue;
    const taken = d.orders.some(o => o.subscriptionId === sub.id && o.date === date && o.slot === slot && ACTIVE.includes(o.status));
    if (taken) continue;
    return date;
  }
  throw httpError(409, `${kitchen.name} has no open day for a make-up meal in the next few months.`, 'NO_OPEN_DAY');
}

// How many make-up days a plan may earn from customer skips
function skipLimit(kitchen, sub) {
  const limits = kitchen.skipLimits || { plan5: 4, plan7: 6 };
  const per = sub.plan === '5day' ? limits.plan5 : limits.plan7;
  return per * (sub.slot === 'both' ? 2 : 1);
}

// Move a plan meal's money onto a new meal at the end of the plan. Returns the new order.
// Ledger: the old reservation is released and the same amount reserved on the new meal,
// so the customer's balance doesn't change and every rupee is still accounted for.
function addMakeupDay(d, kitchen, customer, order, sub, why) {
  const date = nextOpenDate(d, kitchen, sub, planLastDate(d, sub), order.slot);
  wallet.release(d, order, `${why}: ${kitchen.name}, ${order.date} ${order.slot}. Moved to make-up day ${date}`);
  const address = (customer.addresses || []).find(a => order.address && a.id === order.address.id) || findAddress(customer, null);
  const m = createOrder(d, {
    customer, kitchen, type: 'subscription', date, slot: order.slot, choices: {}, addons: [], note: order.note,
    address, amount: order.amount, subscriptionId: sub.id, skipBookableCheck: true
  });
  m.isMakeup = true;
  m.makeupOf = order.id;
  order.makeupOrderId = m.id;
  order.makeupDate = date;
  sub.endDate = planLastDate(d, sub);
  return m;
}

module.exports = {
  ACTIVE, CHEF_FLOW, PLAN_MEALS, PLAN_LABEL, SLOT_LABEL, httpError, getMenu, closedReason, dayMenu,
  usedCapacity, capacityLeft, cleanChoices, priceAddons, mealType, findAddress, addressSnapshot,
  checkDeliveryArea, prefsSnapshot, assertBookable, createOrder, planDates, splitPrice,
  dietaryNotes, orderTotal, slotStart, changeDeadline, canChange, assertCanChange, dayDeadline,
  planLastDate, nextOpenDate, skipLimit, addMakeupDay
};
