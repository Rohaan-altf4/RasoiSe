// Numbers computed from real data (ratings, meals served, hygiene...). Nothing here is stored.

const time = require('./time');
const meals = require('./meals');
const { SERVICE_AREA } = require('./models');
const { haversineMeters, walkingMinutes, hasCoords } = require('./geo');

function round1(n) {
  return Math.round(n * 10) / 10;
}

// Share of booked meals in the last 30 days the kitchen actually delivered (customer skips
// don't count against the cook; her own cancellations do). null until there are 5 meals.
function reliability(d, kitchenId) {
  const from = time.addDays(time.today(), -30);
  const today = time.today();
  const relevant = d.orders.filter(o => o.kitchenId === kitchenId && o.date >= from && o.date <= today &&
    (o.status === 'delivered' || o.cookCancelled));
  if (relevant.length < 5) return null;
  const delivered = relevant.filter(o => o.status === 'delivered').length;
  return { percent: Math.round((delivered / relevant.length) * 100), meals: relevant.length };
}

function kitchenStats(d, kitchenId) {
  const reviews = d.reviews.filter(r => r.kitchenId === kitchenId && !r.hidden);
  const counts = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
  let sum = 0;
  let hyg = 0;
  let taste = 0;
  reviews.forEach(r => {
    counts[Math.max(1, Math.min(5, Math.round(r.rating)))]++;
    sum += r.rating;
    hyg += r.hygiene || r.rating;
    taste += r.taste || r.rating;
  });
  const n = reviews.length;
  return {
    reviewsCount: n,
    rating: n ? round1(sum / n) : null,
    hygiene: n ? round1(hyg / n) : null,
    taste: n ? round1(taste / n) : null,
    ratingCounts: counts,
    mealsServed: d.orders.filter(o => o.kitchenId === kitchenId && o.status === 'delivered').length,
    reliability: reliability(d, kitchenId),
    openTickets: d.tickets.filter(t => t.kitchenId === kitchenId && t.status !== 'resolved').length
  };
}

// First date (from today) when this kitchen can still take an order, with the slot.
function nextOpening(d, kitchen) {
  for (let i = 0; i < 14; i++) {
    const date = time.addDays(time.today(), i);
    if (!time.isBeforeCutoff(date, kitchen.cutoffTime)) continue;
    for (const slot of ['lunch', 'dinner']) {
      if (!kitchen.slots.includes(slot)) continue;
      if (meals.closedReason(kitchen, date, slot)) continue;
      if (meals.capacityLeft(d, kitchen, date, slot) > 0) return { date, slot };
    }
  }
  return null;
}

// What customers (and the public) may see about a kitchen. No email/phone/UPI/flags.
function publicKitchen(d, k, from = null) {
  const s = kitchenStats(d, k.id);
  const distance = from && hasCoords(from) ? haversineMeters(from, k.location) : null;
  const today = time.today();
  const dm = meals.dayMenu(d, k, today);
  // Today's main dish with its own photo and veg/non-veg type (from the cook's dish list), so
  // cards never pair a dish name with an unrelated photo
  const dishList = meals.getMenu(d, k.id).dishes || [];
  const mainName = dm.special ? dm.special.name : ((dm.courses[0] || {}).options || [])[0];
  const mainDish = mainName ? dishList.find(x => x.name.toLowerCase() === mainName.toLowerCase()) : null;
  return {
    id: k.id,
    name: k.name,
    chefName: k.chefName,
    bio: k.bio,
    story: k.story,
    coverUrl: k.coverUrl,
    gallery: k.gallery,
    cuisines: k.cuisines,
    fssai: k.fssai,
    dietType: k.dietType,
    pricing: k.pricing,
    slots: k.slots,
    capacity: k.capacity,
    cutoffTime: k.cutoffTime,
    noticeHours: k.noticeHours,
    slotTimes: k.slotTimes,
    skipLimits: k.skipLimits,
    radiusM: k.radiusM,
    // Home kitchens are people's homes: share the spot rounded to ~100 m, not the exact door.
    location: {
      lat: hasCoords(k.location) ? Math.round(k.location.lat * 1000) / 1000 : null,
      lng: hasCoords(k.location) ? Math.round(k.location.lng * 1000) / 1000 : null,
      locality: k.location.locality,
      address: k.location.locality ? `${k.location.locality}, ${SERVICE_AREA.name}` : ''
    },
    offDays: k.offDays,
    holidays: k.holidays.filter(h => h.date >= today),
    paused: k.paused,
    status: k.status,
    stats: s,
    distance,
    walkMinutes: walkingMinutes(distance),
    deliversToYou: distance == null ? null : distance <= k.radiusM,
    nextOpening: k.paused ? null : nextOpening(d, k),
    todaysMenu: dm.courses.map(c => c.options[0]).filter(Boolean),
    todaysSpecial: dm.special,
    todaysDish: mainName ? {
      name: mainName,
      photo: (mainDish && mainDish.photo) || (dm.special && dm.special.photo) || '',
      type: k.dietType === 'veg' ? 'veg' : (mainDish ? mainDish.type : (dm.special && dm.special.type) || 'veg')
    } : null
  };
}

module.exports = { kitchenStats, publicKitchen, nextOpening, round1 };
