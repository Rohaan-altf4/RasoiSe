// Numbers computed from real data (ratings, meals served, hygiene...). Nothing here is stored.

const time = require('./time');
const meals = require('./meals');
const { haversineMeters, walkingMinutes, hasCoords } = require('./geo');

function round1(n) {
  return Math.round(n * 10) / 10;
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
    radiusM: k.radiusM,
    // Home kitchens are people's homes: share the spot rounded to ~100 m, not the exact door.
    location: {
      lat: hasCoords(k.location) ? Math.round(k.location.lat * 1000) / 1000 : null,
      lng: hasCoords(k.location) ? Math.round(k.location.lng * 1000) / 1000 : null,
      locality: k.location.locality,
      address: k.location.locality ? `${k.location.locality}, Andheri West` : ''
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
    todaysSpecial: dm.special
  };
}

module.exports = { kitchenStats, publicKitchen, nextOpening, round1 };
