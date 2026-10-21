// Default shapes for records, so every kitchen / menu / user looks the same
// whether it came from sign-up, the seed script or the legacy migration.

const DAY_NAMES = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

// The area RasoiSe serves. Change it here: the server, /api/config and every page (via /js/area.js) use it.
const SERVICE_AREA = { name: 'Andheri West', city: 'Mumbai', center: { lat: 19.1364, lng: 72.8296 } };

// Approximate centres of the neighbourhoods we serve (used when only a locality name is known).
const LOCALITIES = {
  'Lokhandwala': { lat: 19.1424, lng: 72.8264 },
  'Versova': { lat: 19.1316, lng: 72.8155 },
  'Oshiwara': { lat: 19.1491, lng: 72.8345 },
  'Seven Bungalows': { lat: 19.1290, lng: 72.8230 },
  'Four Bungalows': { lat: 19.1265, lng: 72.8265 },
  [SERVICE_AREA.name]: SERVICE_AREA.center
};

function defaultPreferences() {
  return {
    diet: 'veg',            // veg | jain | egg | nonveg
    noOnionGarlic: false,
    spice: 'medium',        // mild | medium | spicy
    allergies: [],
    rotiCount: 4,
    rice: true,
    defaultSlot: 'lunch',   // lunch | dinner | both
    cookCancel: 'makeup'    // if the kitchen cancels a plan meal: makeup | refund
  };
}

function newKitchen(fields = {}) {
  return {
    id: fields.id,
    ownerId: fields.ownerId || null,
    name: fields.name || 'Home Kitchen',
    chefName: fields.chefName || '',
    bio: fields.bio || '',
    story: fields.story || '',
    coverUrl: fields.coverUrl || '',
    gallery: fields.gallery || [],
    cuisines: fields.cuisines || [],
    fssai: fields.fssai || '',
    dietType: fields.dietType || 'veg',          // veg | egg | nonveg
    pricing: Object.assign({ single: 100, trial: 80, plan5: 1760, plan7: 2400 }, fields.pricing || {}),
    slots: fields.slots || ['lunch'],
    capacity: fields.capacity || 25,             // meals per slot per day
    cutoffTime: fields.cutoffTime || '08:00',    // changes for a day close at this time (IST)
    radiusM: fields.radiusM || 2000,
    location: Object.assign({ lat: null, lng: null, address: '', locality: '' }, fields.location || {}),
    offDays: fields.offDays || [],               // weekly closed days, e.g. ['sunday']
    holidays: fields.holidays || [],             // [{ date, reason }]
    paused: !!fields.paused,
    status: fields.status || 'pending',          // pending | approved | rejected | banned
    statusNote: fields.statusNote || '',
    warnings: fields.warnings || [],
    flags: fields.flags || [],
    upi: fields.upi || '',
    phone: fields.phone || '',
    email: fields.email || '',
    createdAt: fields.createdAt || new Date().toISOString(),
    approvedAt: fields.approvedAt || null,
    ...kitchenRuleDefaults(fields)
  };
}

// Notice and skip rules (added later; also filled in for kitchens saved before they existed)
function kitchenRuleDefaults(k = {}) {
  return {
    noticeHours: [12, 24, 48].includes(k.noticeHours) ? k.noticeHours : 24,  // changes close this long before a meal
    slotTimes: Object.assign({ lunch: '12:30', dinner: '19:30' }, k.slotTimes || {}),
    skipLimits: Object.assign({ plan5: 4, plan7: 6 }, k.skipLimits || {}),  // make-up days per plan
    goodwillCredit: Number.isFinite(k.goodwillCredit) ? k.goodwillCredit : 20, // paid by the cook on late cancels
    strikes: Array.isArray(k.strikes) ? k.strikes : []                        // late cancellations by the cook
  };
}

// Bring older saved records up to date with safe defaults
function upgradeRecords(data) {
  (data.kitchens || []).forEach(k => Object.assign(k, kitchenRuleDefaults(k)));
  (data.subscriptions || []).forEach(s => {
    if (s.skipsUsed == null) s.skipsUsed = 0;
    if (!Array.isArray(s.freezes)) s.freezes = [];
  });
  (data.users || []).forEach(u => {
    if (u.role === 'customer' && u.preferences && !u.preferences.cookCancel) u.preferences.cookCancel = 'makeup';
    if (!Array.isArray(u.noShows)) u.noShows = [];
  });
}

// A day's menu is a list of "courses" (Sabzi, Dal, Roti & rice...). Each course has one or
// more options; when there are several, the customer picks one before the cutoff.
function course(id, label, options) {
  return { id, label, options: options.filter(Boolean) };
}

function legacyDayToCourses(day = {}) {
  return [
    course('sabzi', 'Sabzi', [day.main]),
    course('dal', 'Dal / curry', [day.dal]),
    course('bread', 'Roti & rice', [day.breadRice]),
    course('sides', 'Sides', [day.sides])
  ].filter(c => c.options.length > 0);
}

function newMenu(kitchenId, weekly = {}) {
  const menu = { kitchenId, dishes: [], addons: [], weekly: {}, specials: [] };
  DAY_NAMES.forEach(d => { menu.weekly[d] = weekly[d] || { courses: [] }; });
  return menu;
}

function defaultAddons() {
  return [
    { id: 'extra-roti', name: 'Extra roti (2)', price: 15 },
    { id: 'curd', name: 'Fresh curd', price: 20 },
    { id: 'sweet', name: 'Sweet of the day', price: 30 },
    { id: 'salad', name: 'Salad bowl', price: 25 }
  ];
}

module.exports = {
  DAY_NAMES, LOCALITIES, SERVICE_AREA, defaultPreferences, newKitchen, newMenu, course, kitchenRuleDefaults, upgradeRecords,
  legacyDayToCourses, defaultAddons
};
