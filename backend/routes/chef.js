// Chef side: registration, kitchen settings, menu builder, holidays, pause,
// daily manifest + prep counts, dispatch status, earnings and payouts.

const express = require('express');
const db = require('../db');
const time = require('../lib/time');
const meals = require('../lib/meals');
const wallet = require('../lib/wallet');
const payments = require('../lib/payments');
const auth = require('../lib/auth');
const upload = require('../lib/upload');
const { notify, refresh, adminIds, audit } = require('../lib/notify');
const { hasCoords, haversineMeters } = require('../lib/geo');
const { kitchenStats } = require('../lib/stats');
const { newKitchen, newMenu, defaultAddons, DAY_NAMES, course } = require('../lib/models');
const { validateAccount, buildUser, mePayload } = require('./auth');
const { orderView, fmtDate, mealLabel, addHistory } = require('./customer');

const router = express.Router();
const chefOnly = auth.requireRole('chef');
const { httpError } = meals;

function myKitchen(d, req) {
  const k = d.kitchens.find(x => x.id === req.user.kitchenId && x.ownerId === req.user.id);
  if (!k) throw httpError(404, 'You don\'t have a kitchen yet.');
  return k;
}

// ---------- Field cleaning ----------

const CUISINES = ['North Indian', 'Gujarati', 'Punjabi', 'Maharashtrian', 'South Indian', 'Bengali', 'Rajasthani', 'Sindhi', 'Konkani', 'Jain', 'Healthy', 'Parsi', 'Mughlai'];

function str(v, max = 200) {
  return String(v == null ? '' : v).trim().slice(0, max);
}

function intIn(v, min, max, fallback) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

function parseMaybeJSON(v, fallback) {
  if (v == null || v === '') return fallback;
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch { return fallback; }
}

// Applies allowed kitchen settings from a request body. Throws on invalid values.
function applyKitchenFields(k, b) {
  if (b.name !== undefined) {
    if (str(b.name).length < 3) throw httpError(400, 'Kitchen name should be at least 3 characters.');
    k.name = str(b.name, 60);
  }
  if (b.chefName !== undefined) k.chefName = str(b.chefName, 60);
  if (b.bio !== undefined) k.bio = str(b.bio, 160);
  if (b.story !== undefined) k.story = str(b.story, 1200);
  if (b.fssai !== undefined) {
    const f = str(b.fssai).replace(/\s/g, '');
    if (f && !/^\d{14}$/.test(f)) throw httpError(400, 'FSSAI licence numbers are 14 digits.');
    k.fssai = f;
  }
  if (b.dietType !== undefined) k.dietType = ['veg', 'egg', 'nonveg'].includes(b.dietType) ? b.dietType : 'veg';
  if (b.cuisines !== undefined) {
    const list = parseMaybeJSON(b.cuisines, String(b.cuisines).split(','));
    k.cuisines = (Array.isArray(list) ? list : []).map(c => str(c, 30)).filter(Boolean).slice(0, 5);
  }
  if (b.pricing !== undefined) {
    const p = parseMaybeJSON(b.pricing, {});
    const next = {
      single: intIn(p.single, 40, 1000, k.pricing.single),
      trial: intIn(p.trial, 30, 1000, k.pricing.trial),
      plan5: intIn(p.plan5, 500, 30000, k.pricing.plan5),
      plan7: intIn(p.plan7, 700, 40000, k.pricing.plan7)
    };
    k.pricing = next;
  }
  if (b.slots !== undefined) {
    const s = parseMaybeJSON(b.slots, String(b.slots).split(','));
    const list = (Array.isArray(s) ? s : []).filter(x => ['lunch', 'dinner'].includes(x));
    if (!list.length) throw httpError(400, 'Offer at least lunch or dinner.');
    k.slots = [...new Set(list)];
  }
  if (b.capacity !== undefined) k.capacity = intIn(b.capacity, 1, 300, k.capacity);
  if (b.cutoffTime !== undefined) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(str(b.cutoffTime))) throw httpError(400, 'Cutoff must be a time like 08:00.');
    if (time.toMinutes(b.cutoffTime) > time.toMinutes('11:00')) throw httpError(400, 'Cutoff can be 11:00 AM at the latest, so lunch can be cooked in time.');
    k.cutoffTime = str(b.cutoffTime);
  }
  if (b.radiusM !== undefined) k.radiusM = intIn(b.radiusM, 300, 8000, k.radiusM);
  if (b.noticeHours !== undefined) {
    const n = Number(b.noticeHours);
    if (![12, 24, 48].includes(n)) throw httpError(400, 'Notice period must be 12, 24 or 48 hours.');
    k.noticeHours = n;
  }
  if (b.skipLimits !== undefined) {
    const s = parseMaybeJSON(b.skipLimits, {});
    k.skipLimits = { plan5: intIn(s.plan5, 0, 22, k.skipLimits.plan5), plan7: intIn(s.plan7, 0, 30, k.skipLimits.plan7) };
  }
  if (b.location !== undefined) {
    const l = parseMaybeJSON(b.location, {});
    const loc = { lat: Number(l.lat), lng: Number(l.lng), address: str(l.address, 250), locality: str(l.locality, 60) };
    if (!hasCoords(loc)) throw httpError(400, 'Please pin your kitchen on the map.');
    k.location = loc;
  }
  if (b.upi !== undefined) {
    const u = str(b.upi, 60);
    if (u && !/^[\w.\-]{2,}@[a-zA-Z]{2,}$/.test(u)) throw httpError(400, 'UPI ids look like name@bank.');
    k.upi = u;
  }
  if (b.phone !== undefined) {
    const p = auth.normalisePhone(b.phone);
    if (p && !auth.PHONE_RE.test(p)) throw httpError(400, 'Enter a 10-digit mobile number.');
    k.phone = p;
  }
}

// ---------- Menu cleaning ----------

const SPICE = ['mild', 'medium', 'spicy'];

function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'item';
}

function cleanMenu(input, kitchen) {
  const dishes = (Array.isArray(input.dishes) ? input.dishes : []).slice(0, 150).map((x, i) => ({
    id: str(x.id, 40) || `dish-${i + 1}`,
    name: str(x.name, 60),
    type: kitchen.dietType === 'veg' ? 'veg' : (['veg', 'egg', 'nonveg'].includes(x.type) ? x.type : 'veg'),
    spice: SPICE.includes(x.spice) ? x.spice : 'medium',
    allergens: (Array.isArray(x.allergens) ? x.allergens : String(x.allergens || '').split(',')).map(a => str(a, 30)).filter(Boolean).slice(0, 8),
    photo: str(x.photo, 300),
    description: str(x.description, 160)
  })).filter(x => x.name);

  const addons = (Array.isArray(input.addons) ? input.addons : []).slice(0, 20).map(x => ({
    id: str(x.id, 40) || slugify(x.name),
    name: str(x.name, 50),
    price: intIn(x.price, 0, 500, 0)
  })).filter(x => x.name);

  const weekly = {};
  DAY_NAMES.forEach(day => {
    const src = (input.weekly && input.weekly[day] && input.weekly[day].courses) || [];
    weekly[day] = {
      courses: src.slice(0, 8).map((c, i) => {
        const options = (Array.isArray(c.options) ? c.options : []).map(o => str(o, 60)).filter(Boolean).slice(0, 3);
        return course(str(c.id, 30) || slugify(c.label) || `c${i}`, str(c.label, 30) || `Item ${i + 1}`, options);
      }).filter(c => c.options.length)
    };
  });

  const specials = (Array.isArray(input.specials) ? input.specials : []).slice(0, 60).map(s => ({
    date: s.date,
    name: str(s.name, 60),
    description: str(s.description, 160),
    price: intIn(s.price, 0, 1000, 0)
  })).filter(s => s.name && time.isValidDate(s.date) && s.date >= time.today());

  return { dishes, addons, weekly, specials };
}

// Customers with upcoming meals at this kitchen (they hear about menu / holiday changes).
function upcomingCustomers(d, kitchenId, from = time.today(), to = null) {
  return [...new Set(d.orders
    .filter(o => o.kitchenId === kitchenId && o.date >= from && (!to || o.date <= to) && ['scheduled', 'paused'].includes(o.status))
    .map(o => o.customerId))];
}

// ---------- Registration ----------

router.post('/chef/register', upload.fields([{ name: 'cover', maxCount: 1 }]), (req, res) => {
  const b = req.body || {};
  if (req.user) return res.status(400).json({ error: 'You are already signed in. Sign out to register a new kitchen.' });
  const errors = validateAccount({ name: b.name, email: b.email, phone: b.phone, password: b.password });
  if (!b.phone && !errors.phone) errors.phone = 'Customers and riders need a number to reach you.';
  if (Object.keys(errors).length) return res.status(400).json({ error: Object.values(errors)[0], fields: errors });

  const user = db.transaction(d => {
    const u = buildUser({ name: b.name, email: b.email, phone: b.phone, password: b.password, role: 'chef' });
    d.users.push(u);
    const k = newKitchen({ id: db.nextId('kitchens'), ownerId: u.id, chefName: u.name, phone: u.phone, email: u.email, status: 'pending' });
    applyKitchenFields(k, {
      name: b.kitchenName || `${u.name.split(' ')[0]}'s Rasoi`,
      bio: b.bio, fssai: b.fssai, dietType: b.dietType, cuisines: b.cuisines, pricing: b.pricing,
      slots: b.slots || '["lunch"]', capacity: b.capacity, radiusM: b.radiusM, location: b.location, upi: b.upi
    });
    if (!hasCoords(k.location)) throw httpError(400, 'Please pin your kitchen on the map.');
    const cover = req.files && req.files.cover && req.files.cover[0];
    if (cover) k.coverUrl = `/uploads/${cover.filename}`;
    d.kitchens.push(k);
    u.kitchenId = k.id;

    const menu = newMenu(k.id);
    const cleaned = cleanMenu({ ...parseMaybeJSON(b.menu, {}), addons: defaultAddons() }, k);
    Object.assign(menu, cleaned);
    d.menus.push(menu);

    audit(d, u, 'CHEF_REGISTER', k.name, `${u.name} applied to cook as "${k.name}" (${k.location.locality || require('../lib/models').SERVICE_AREA.name}).`);
    notify(d, adminIds(d), { type: 'kitchen_pending', title: `New kitchen waiting for approval`, body: `${k.name} by ${u.name}`, link: 'admin-console.html#approvals' });
    refresh(adminIds(d), ['kitchens']);
    notify(d, u.id, { type: 'kitchen_pending', title: 'Application received', body: 'We will review your kitchen within a day. You can set up your menu meanwhile.', link: 'chef-settings.html' });
    return u;
  });
  auth.createSession(res, user.id);
  res.status(201).json(mePayload(user));
});

// ---------- Kitchen profile & settings ----------

function privateKitchen(d, k) {
  return { ...k, stats: kitchenStats(d, k.id), menu: meals.getMenu(d, k.id) };
}

router.get('/chef/kitchen', chefOnly, (req, res) => {
  const d = db.load();
  res.json({ kitchen: privateKitchen(d, myKitchen(d, req)), cuisines: CUISINES });
});

router.put('/chef/kitchen', chefOnly, (req, res) => {
  const k = db.transaction(d => {
    const k = myKitchen(d, req);
    applyKitchenFields(k, req.body || {});
    audit(d, req.user, 'KITCHEN_UPDATED', k.name, 'Kitchen settings updated.');
    refresh([req.user.id], ['kitchen']);
    return k;
  });
  res.json({ kitchen: privateKitchen(db.load(), k) });
});

router.post('/chef/upload', chefOnly, upload.single('photo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Choose a photo to upload.' });
  res.status(201).json({ url: `/uploads/${req.file.filename}` });
});

// Cover + gallery are set by URL (upload first with /chef/upload)
router.put('/chef/photos', chefOnly, (req, res) => {
  const { coverUrl, gallery } = req.body || {};
  const isUpload = u => typeof u === 'string' && (u.startsWith('/uploads/') || /^https:\/\/images\.unsplash\.com\//.test(u));
  const k = db.transaction(d => {
    const k = myKitchen(d, req);
    if (coverUrl !== undefined) {
      if (coverUrl && !isUpload(coverUrl)) throw httpError(400, 'Upload the photo first.');
      k.coverUrl = coverUrl || '';
    }
    if (gallery !== undefined) k.gallery = (Array.isArray(gallery) ? gallery : []).filter(isUpload).slice(0, 8);
    return k;
  });
  res.json({ kitchen: privateKitchen(db.load(), k) });
});

router.put('/chef/menu', chefOnly, (req, res) => {
  const result = db.transaction(d => {
    const k = myKitchen(d, req);
    let menu = d.menus.find(m => m.kitchenId === k.id);
    if (!menu) { menu = newMenu(k.id); d.menus.push(menu); }
    const before = JSON.stringify(menu.weekly);
    Object.assign(menu, cleanMenu(req.body || {}, k));

    // Re-check choices on upcoming open meals (an option may have been removed)
    d.orders.forEach(o => {
      if (o.kitchenId === k.id && o.status === 'scheduled' && time.isBeforeCutoff(o.date, k.cutoffTime)) {
        const dm = meals.dayMenu(d, k, o.date);
        o.choices = meals.cleanChoices(dm.courses, o.choices);
        o.mealType = meals.mealType(d, k, o.choices);
      }
    });

    const weeklyChanged = before !== JSON.stringify(menu.weekly);
    if (weeklyChanged && k.status === 'approved') {
      const customers = upcomingCustomers(d, k.id);
      notify(d, customers, { type: 'menu_updated', title: `${k.name} updated their menu`, body: 'Check your upcoming meals and pick your dishes before the cutoff.', link: 'calendar.html' });
      refresh(customers, ['orders']);
      audit(d, req.user, 'MENU_UPDATED', k.name, `Weekly menu updated (${customers.length} customers notified).`);
    }
    return { menu, notified: weeklyChanged ? upcomingCustomers(d, k.id).length : 0 };
  });
  res.json(result);
});

// ---------- Cook cancellations ----------
// The same rules for cooks as for customers:
// - With enough notice: plan meals become a make-up day at the end of the plan (or a refund, if
//   the customer prefers refunds); single and trial meals are refunded.
// - With less notice: only as an emergency with a reason. Customers also get a small goodwill
//   credit, paid from the cook's earnings, and the cook gets a strike. 3 strikes in a month
//   means an automatic warning and admin is told.

function monthOf(iso) {
  return time.istParts(new Date(iso)).date.slice(0, 7);
}

function addStrike(d, k, reason, meals, actor) {
  const now = time.nowISO();
  k.strikes.push({ at: now, reason, meals });
  const thisMonth = k.strikes.filter(s => monthOf(s.at) === monthOf(now)).length;
  if (thisMonth >= 3 && !k.warnings.some(w => w.auto && monthOf(w.at) === monthOf(now))) {
    const text = `${thisMonth} late cancellations this month. Please give customers ${k.noticeHours} hours' notice.`;
    k.warnings.push({ reason: text, at: now, by: 'RasoiSe (automatic)', auto: true });
    notify(d, k.ownerId, { type: 'kitchen_warning', title: 'Warning: too many late cancellations', body: text, link: 'chef-dashboard.html' });
    notify(d, adminIds(d), { type: 'kitchen_flagged', title: `${k.name}: ${thisMonth} late cancellations this month`, body: reason, link: 'admin-console.html#kitchens' });
    audit(d, actor, 'KITCHEN_WARNED', k.name, `Automatic warning: ${text}`);
  }
  return thisMonth;
}

// Cancel some of a kitchen's meals. kind: 'holiday' (whole day) or 'order' (one meal).
function cookCancel(d, k, orders, { reason, actor, kind }) {
  const live = orders.filter(o => ['scheduled', 'preparing'].includes(o.status));
  const late = live.some(o => !meals.canChange(k, o.date, o.slot));
  if (late && String(reason || '').trim().length < 5) {
    throw httpError(400, `Less than ${k.noticeHours} hours' notice: this is an emergency cancellation. Please give a short reason for your customers.`, 'REASON_REQUIRED');
  }
  const result = { affected: 0, refunded: 0, makeups: 0, goodwill: 0, late, strikes: null };
  const perCustomer = new Map();
  live.forEach(o => {
    const customer = d.users.find(u => u.id === o.customerId);
    const sub = o.subscriptionId ? d.subscriptions.find(s => s.id === o.subscriptionId) : null;
    const lateOne = !meals.canChange(k, o.date, o.slot);
    const why = kind === 'holiday' ? 'Kitchen holiday' : 'Cancelled by the kitchen';
    let makeupDate = null;
    if (sub && sub.status === 'active' && (customer.preferences || {}).cookCancel !== 'refund') {
      makeupDate = meals.addMakeupDay(d, k, customer, o, sub, why).date;
      result.makeups++;
    } else {
      const e = wallet.release(d, o, `${why}: ${k.name}, ${mealLabel(o)}`);
      result.refunded += e ? e.available : 0;
    }
    if (lateOne && k.goodwillCredit > 0) {
      const g = k.goodwillCredit;
      wallet.post(d, { userId: o.customerId, kind: 'refund', available: g, orderId: o.id, note: `Goodwill credit: late cancellation by ${k.name}` });
      wallet.post(d, { userId: k.ownerId, kind: 'clawback', available: -g, orderId: o.id, note: `Goodwill credit to customer for late cancellation of ${o.code}` });
      result.goodwill += g;
    }
    addHistory(o, kind === 'holiday' ? 'holiday' : 'cancelled', 'chef');
    o.cancelReason = reason || why;
    o.cookCancelled = true;
    result.affected++;
    const c = perCustomer.get(o.customerId) || { makeup: [], refund: 0, goodwill: 0, meals: [] };
    if (makeupDate) c.makeup.push(makeupDate);
    if (!makeupDate) c.refund += meals.orderTotal(o);
    if (lateOne) c.goodwill += k.goodwillCredit;
    c.meals.push(mealLabel(o));
    perCustomer.set(o.customerId, c);
  });
  perCustomer.forEach((c, cid) => {
    const parts = [];
    if (c.makeup.length) parts.push(`Added as a make-up day on ${c.makeup.map(fmtDate).join(', ')}.`);
    if (c.refund) parts.push(`₹${c.refund} refunded to your wallet.`);
    if (c.goodwill) parts.push(`Plus ₹${c.goodwill} goodwill credit for the short notice.`);
    notify(d, cid, {
      type: 'kitchen_holiday', title: `${k.name} can't make ${c.meals.join(', ')}`,
      body: `${reason ? reason + '. ' : ''}${parts.join(' ')}`, link: 'calendar.html'
    });
  });
  refresh([...perCustomer.keys()], ['orders', 'wallet']);
  if (late) result.strikes = addStrike(d, k, reason, result.affected, actor);
  if (result.affected) {
    audit(d, actor, late ? 'KITCHEN_LATE_CANCEL' : 'KITCHEN_HOLIDAY', k.name,
      `${result.affected} meal(s) cancelled${late ? ' at short notice' : ''}: ${result.makeups} make-up day(s), ₹${result.refunded} refunded, ₹${result.goodwill} goodwill. ${reason || ''}`.trim());
  }
  return result;
}

// Close the kitchen on a date (holiday)
function closeDate(d, k, date, reason, actor) {
  return cookCancel(d, k, d.orders.filter(o => o.kitchenId === k.id && o.date === date), { reason, actor, kind: 'holiday' });
}

router.post('/chef/holidays', chefOnly, (req, res) => {
  const { date, reason } = req.body || {};
  const result = db.transaction(d => {
    const k = myKitchen(d, req);
    if (!time.isValidDate(date)) throw httpError(400, 'Choose a date.');
    if (date < time.today()) throw httpError(400, 'Choose today or a later date.');
    if (k.holidays.some(h => h.date === date)) throw httpError(400, 'That day is already marked as a holiday.');
    k.holidays.push({ date, reason: str(reason, 80) });
    k.holidays.sort((a, b) => a.date.localeCompare(b.date));
    const r = closeDate(d, k, date, str(reason, 80), req.user);
    // Plan customers without a meal that day still see the holiday on their calendar
    const subscribers = upcomingCustomers(d, k.id);
    refresh(subscribers, ['orders']);
    return r;
  });
  res.json(result);
});

router.delete('/chef/holidays/:date', chefOnly, (req, res) => {
  db.transaction(d => {
    const k = myKitchen(d, req);
    k.holidays = k.holidays.filter(h => h.date !== req.params.date);
    refresh(upcomingCustomers(d, k.id), ['orders']);
  });
  res.json({ ok: true });
});

// Weekly off-days, e.g. closed every Sunday
router.put('/chef/offdays', chefOnly, (req, res) => {
  const list = (Array.isArray((req.body || {}).offDays) ? req.body.offDays : []).filter(x => DAY_NAMES.includes(x));
  if (list.length > 5) return res.status(400).json({ error: 'Stay open at least 2 days a week.' });
  const result = db.transaction(d => {
    const k = myKitchen(d, req);
    const added = list.filter(x => !k.offDays.includes(x));
    k.offDays = list;
    let affected = 0;
    let refunded = 0;
    let makeups = 0;
    let kept = 0; // meals inside the notice period still go ahead
    if (added.length) {
      const dates = [...new Set(d.orders.filter(o => o.kitchenId === k.id && o.date >= time.today() && ['scheduled', 'paused'].includes(o.status) && added.includes(time.dayKey(o.date))).map(o => o.date))];
      dates.forEach(date => {
        if (time.now() >= meals.dayDeadline(k, date)) {
          kept += d.orders.filter(o => o.kitchenId === k.id && o.date === date && o.status === 'scheduled').length;
          return;
        }
        const r = closeDate(d, k, date, 'Kitchen closed on this weekday', req.user);
        affected += r.affected;
        refunded += r.refunded;
        makeups += r.makeups;
      });
    }
    return { offDays: k.offDays, affected, refunded, makeups, kept };
  });
  res.json(result);
});

router.post('/chef/pause', chefOnly, (req, res) => {
  const paused = !!(req.body || {}).paused;
  const k = db.transaction(d => {
    const k = myKitchen(d, req);
    k.paused = paused;
    audit(d, req.user, paused ? 'KITCHEN_PAUSED' : 'KITCHEN_RESUMED', k.name, paused ? 'New orders paused by chef.' : 'Taking orders again.');
    return k;
  });
  res.json({ kitchen: privateKitchen(db.load(), k) });
});

// ---------- Manifest & prep counts ----------

function prepCounts(d, k, orders) {
  const live = orders.filter(o => meals.ACTIVE.includes(o.status));
  const c = {
    total: live.length, veg: 0, egg: 0, nonveg: 0,
    paused: orders.filter(o => o.status === 'paused').length,
    cancelled: orders.filter(o => ['cancelled', 'holiday'].includes(o.status)).length,
    delivered: live.filter(o => o.status === 'delivered').length,
    rotis: 0, noRice: 0, jain: 0, noOnionGarlic: 0,
    spice: { mild: 0, medium: 0, spicy: 0 },
    allergies: {}, addons: {}, choices: {}
  };
  live.forEach(o => {
    c[o.mealType || 'veg']++;
    const p = o.prefs || {};
    c.rotis += Number(p.rotiCount == null ? 4 : p.rotiCount);
    if (p.rice === false) c.noRice++;
    if (p.diet === 'jain') c.jain++;
    if (p.noOnionGarlic || p.diet === 'jain') c.noOnionGarlic++;
    c.spice[p.spice || 'medium']++;
    (p.allergies || []).forEach(a => { c.allergies[a] = (c.allergies[a] || 0) + 1; });
    (o.addons || []).forEach(a => { c.addons[a.name] = (c.addons[a.name] || 0) + a.qty; });
    const dm = meals.dayMenu(d, k, o.date);
    dm.courses.forEach(course => {
      const picked = (o.choices || {})[course.id] || course.options[0];
      c.choices[course.label] = c.choices[course.label] || {};
      c.choices[course.label][picked] = (c.choices[course.label][picked] || 0) + 1;
    });
  });
  return c;
}

// Nearest-neighbour drop order starting from the kitchen. Good enough for 10–40 nearby drops.
function dropOrder(k, orders) {
  const left = orders.filter(o => o.address && hasCoords(o.address));
  const route = [];
  let here = k.location;
  while (left.length && hasCoords(here)) {
    let best = 0;
    let bestDist = Infinity;
    left.forEach((o, i) => {
      const dist = haversineMeters(here, o.address);
      if (dist < bestDist) { bestDist = dist; best = i; }
    });
    const next = left.splice(best, 1)[0];
    route.push({ orderId: next.id, legMeters: bestDist });
    here = next.address;
  }
  return route;
}

router.get('/chef/manifest', chefOnly, (req, res) => {
  const d = db.load();
  const k = myKitchen(d, req);
  const date = time.isValidDate(req.query.date) ? req.query.date : time.today();
  const slot = ['lunch', 'dinner'].includes(req.query.slot) ? req.query.slot : null;
  const orders = d.orders.filter(o => o.kitchenId === k.id && o.date === date && (!slot || o.slot === slot));
  const views = orders
    .map(o => orderView(d, o, req.user))
    .sort((a, b) => a.slot.localeCompare(b.slot) || a.id - b.id);
  const dm = meals.dayMenu(d, k, date);
  const active = orders.filter(o => ['scheduled', 'preparing', 'out_for_delivery'].includes(o.status));
  res.json({
    date,
    slot,
    today: time.today(),
    cutoffTime: k.cutoffTime,
    cutoffPassed: !time.isBeforeCutoff(date, k.cutoffTime),
    closed: meals.closedReason(k, date, null),
    menu: dm,
    counts: prepCounts(d, k, orders),
    orders: views,
    route: dropOrder(k, active),
    kitchenLocation: hasCoords(k.location) ? { lat: k.location.lat, lng: k.location.lng } : null
  });
});

// Upcoming days at a glance: meals per date and slot
router.get('/chef/schedule', chefOnly, (req, res) => {
  const d = db.load();
  const k = myKitchen(d, req);
  const days = [];
  for (let i = 0; i < 14; i++) {
    const date = time.addDays(time.today(), i);
    const row = { date, closed: meals.closedReason(k, date, null), holiday: k.holidays.find(h => h.date === date) || null, slots: {} };
    ['lunch', 'dinner'].forEach(slot => {
      const os = d.orders.filter(o => o.kitchenId === k.id && o.date === date && o.slot === slot);
      row.slots[slot] = {
        offered: k.slots.includes(slot),
        meals: os.filter(o => meals.ACTIVE.includes(o.status)).length,
        paused: os.filter(o => o.status === 'paused').length,
        capacity: k.capacity
      };
    });
    days.push(row);
  }
  res.json({ days, subscribers: d.subscriptions.filter(s => s.kitchenId === k.id && s.status === 'active').length });
});

const NEXT_LABEL = { preparing: 'is being prepared', out_for_delivery: 'is out for delivery', delivered: 'was delivered' };

function advance(d, k, o, status, actor) {
  const from = meals.CHEF_FLOW.indexOf(o.status);
  const to = meals.CHEF_FLOW.indexOf(status);
  if (from === -1) throw httpError(400, `${o.code} is ${o.status} and can't be dispatched.`);
  if (to <= from) throw httpError(400, `${o.code} is already ${o.status.replace(/_/g, ' ')}.`);
  if (o.date > time.today()) throw httpError(400, `${o.code} is for ${fmtDate(o.date)}. You can update it on the day.`);
  addHistory(o, status, 'chef');
  if (status === 'out_for_delivery') o.outForDeliveryAt = time.nowISO();
  if (status === 'delivered') {
    o.deliveredAt = time.nowISO();
    wallet.settleDelivered(d, o, k);
  }
  const verb = NEXT_LABEL[status];
  notify(d, o.customerId, {
    type: 'order_status', title: `Your ${o.slot} from ${k.name} ${verb}`,
    body: status === 'delivered' ? `${o.code}: enjoy your meal! Tap to rate it.` : `${o.code} · ${mealLabel(o)}`,
    link: `orders.html?id=${o.id}`
  });
  refresh([o.customerId], status === 'delivered' ? ['orders', 'wallet'] : ['orders']);
}

router.post('/chef/orders/:id/status', chefOnly, (req, res) => {
  const status = (req.body || {}).status;
  if (!['preparing', 'out_for_delivery', 'delivered'].includes(status)) return res.status(400).json({ error: 'Unknown status.' });
  const order = db.transaction(d => {
    const k = myKitchen(d, req);
    const o = d.orders.find(x => x.id === Number(req.params.id) && x.kitchenId === k.id);
    if (!o) throw httpError(404, 'Order not found.');
    advance(d, k, o, status, req.user);
    refresh([req.user.id], ['orders', 'earnings']);
    return o;
  });
  res.json({ order: orderView(db.load(), order, req.user) });
});

// Move every order of a date (and slot) to the next status in one go
router.post('/chef/dispatch', chefOnly, (req, res) => {
  const { date, slot, status } = req.body || {};
  if (!['preparing', 'out_for_delivery', 'delivered'].includes(status)) return res.status(400).json({ error: 'Unknown status.' });
  const result = db.transaction(d => {
    const k = myKitchen(d, req);
    const target = meals.CHEF_FLOW.indexOf(status);
    const list = d.orders.filter(o => o.kitchenId === k.id && o.date === (date || time.today()) && (!slot || o.slot === slot) &&
      meals.CHEF_FLOW.includes(o.status) && meals.CHEF_FLOW.indexOf(o.status) < target);
    if (!list.length) throw httpError(400, 'Nothing left to update for this slot.');
    list.forEach(o => advance(d, k, o, status, req.user));
    refresh([req.user.id], ['orders', 'earnings']);
    return { updated: list.length };
  });
  res.json(result);
});

function myOrder(d, req) {
  const k = myKitchen(d, req);
  const o = d.orders.find(x => x.id === Number(req.params.id) && x.kitchenId === k.id);
  if (!o) throw httpError(404, 'Order not found.');
  return { k, o };
}

// Cancel one meal (not the whole day). Same notice rules as holidays.
router.post('/chef/orders/:id/cancel', chefOnly, (req, res) => {
  const reason = str((req.body || {}).reason, 200);
  const result = db.transaction(d => {
    const { k, o } = myOrder(d, req);
    if (!['scheduled', 'preparing'].includes(o.status)) throw httpError(400, `${o.code} can't be cancelled now (${o.status.replace(/_/g, ' ')}).`);
    const r = cookCancel(d, k, [o], { reason, actor: req.user, kind: 'order' });
    refresh([req.user.id], ['orders', 'earnings']);
    return r;
  });
  res.json(result);
});

// The customer wasn't there to take the meal. Counts as delivered (and charged).
// Three in a calendar month: the customer is warned and admin is told.
router.post('/chef/orders/:id/not-available', chefOnly, (req, res) => {
  const order = db.transaction(d => {
    const { k, o } = myOrder(d, req);
    if (!['scheduled', 'preparing', 'out_for_delivery'].includes(o.status)) throw httpError(400, `${o.code} is already ${o.status.replace(/_/g, ' ')}.`);
    if (o.date > time.today()) throw httpError(400, `${o.code} is for ${fmtDate(o.date)}. You can update it on the day.`);
    addHistory(o, 'delivered', 'chef');
    o.outcome = 'not_available';
    o.deliveredAt = time.nowISO();
    wallet.settleDelivered(d, o, k, `Customer not available: ${k.name} (${o.code}), meal charged`);
    const u = d.users.find(x => x.id === o.customerId);
    u.noShows = [...(u.noShows || []), { orderId: o.id, at: time.nowISO() }];
    const month = time.today().slice(0, 7);
    const count = u.noShows.filter(n => time.istParts(new Date(n.at)).date.slice(0, 7) === month).length;
    notify(d, u.id, {
      type: 'order_status', title: `${k.name} couldn't reach you for ${mealLabel(o)}`,
      body: count >= 3 ? `That's ${count} missed deliveries this month. Please skip meals ${k.noticeHours} hours ahead, or tap "I won't be home".` : 'The meal is charged. If you will be away, skip ahead of time or tap "I won\'t be home".',
      link: `orders.html?id=${o.id}`
    });
    if (count >= 3 && !(u.flagged && u.flagged.month === month)) {
      u.flagged = { reason: `${count} missed deliveries in ${month}`, month, at: time.nowISO() };
      notify(d, adminIds(d), { type: 'kitchen_flagged', title: `Customer ${u.name}: ${count} missed deliveries this month`, body: `Latest: ${o.code} at ${k.name}`, link: 'admin-console.html#users' });
      audit(d, req.user, 'CUSTOMER_FLAGGED', u.name, `${count} missed deliveries in ${month}.`);
    }
    refresh([o.customerId], ['orders', 'wallet']);
    refresh([req.user.id], ['orders', 'earnings']);
    return o;
  });
  res.json({ order: orderView(db.load(), order, req.user) });
});

// Customer said "I won't be home": the cook can keep the meal for them to collect
router.post('/chef/orders/:id/pickup', chefOnly, (req, res) => {
  const order = db.transaction(d => {
    const { k, o } = myOrder(d, req);
    if (!['scheduled', 'preparing', 'out_for_delivery'].includes(o.status)) throw httpError(400, `${o.code} is already ${o.status.replace(/_/g, ' ')}.`);
    o.keepForPickup = true;
    notify(d, o.customerId, { type: 'order_status', title: `${k.name} is keeping your ${o.slot} for pickup`, body: `${mealLabel(o)}. Collect it from the kitchen when you're back today.`, link: `orders.html?id=${o.id}` });
    refresh([o.customerId], ['orders']);
    refresh([req.user.id], ['orders']);
    return o;
  });
  res.json({ order: orderView(db.load(), order, req.user) });
});

// ---------- Earnings & payouts ----------

router.get('/chef/earnings', chefOnly, (req, res) => {
  const d = db.load();
  const k = myKitchen(d, req);
  const ledger = wallet.ledger(req.user.id, 500);
  const sumKind = (kind, since) => ledger.filter(t => t.kind === kind && (!since || t.createdAt.slice(0, 10) >= since)).reduce((s, t) => s + t.available, 0);
  const delivered = d.orders.filter(o => o.kitchenId === k.id && o.status === 'delivered');
  const today = time.today();
  const series = [];
  for (let i = 13; i >= 0; i--) {
    const date = time.addDays(today, -i);
    const dayOrders = delivered.filter(o => o.date === date);
    series.push({ date, meals: dayOrders.length, earned: dayOrders.reduce((s, o) => s + (o.chefEarning || 0), 0) });
  }
  res.json({
    balances: wallet.balances(req.user.id),
    commission: wallet.COMMISSION,
    totals: {
      today: series[series.length - 1].earned,
      last7: series.slice(-7).reduce((s, x) => s + x.earned, 0),
      allTime: sumKind('earning'),
      clawbacks: -sumKind('clawback'),
      paidOut: -sumKind('payout'),
      mealsDelivered: delivered.length
    },
    series,
    ledger,
    upi: k.upi
  });
});

router.post('/chef/payout', chefOnly, (req, res) => {
  const result = db.transaction(d => {
    const k = myKitchen(d, req);
    if (!k.upi) throw httpError(400, 'Add your UPI id in Settings first.');
    const { available } = wallet.balances(req.user.id);
    const amount = req.body && req.body.amount ? Math.round(Number(req.body.amount)) : available;
    if (!Number.isFinite(amount) || amount < 1) throw httpError(400, 'Nothing to pay out yet.');
    if (amount > available) throw httpError(400, `You can withdraw up to ₹${available}.`);
    const p = payments.simulatePayout(k.upi, amount);
    wallet.post(d, { userId: req.user.id, kind: 'payout', available: -amount, note: `Paid to ${k.upi} (${p.providerRef})` });
    audit(d, req.user, 'CHEF_PAYOUT', k.name, `₹${amount} sent to ${k.upi} (${p.providerRef}).`);
    notify(d, req.user.id, { type: 'payout', title: `₹${amount} sent to ${k.upi}`, body: `Reference ${p.providerRef}`, link: 'chef-dashboard.html#earnings' });
    return { amount, ref: p.providerRef };
  });
  res.json({ ...result, balances: wallet.balances(req.user.id) });
});

module.exports = { router, closeDate, privateKitchen };
