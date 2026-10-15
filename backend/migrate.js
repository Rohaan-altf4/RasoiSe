// One-time migration from the old (v1) data.json shape:
//   { kitchens: [...], flaggedKitchens: [...], auditLogs: [...], reviews: [...] }
// to the v2 collections used by db.js.
//
// What happens to old data:
// - kitchens        -> kitchens + a menu each + a chef user account per unique email
// - reviews         -> reviews (kept as "legacy" reviews, they are not tied to an order)
// - auditLogs       -> auditLog
// - flaggedKitchens -> dropped. They were placeholder rows (Bandra/Powai kitchens with
//                      made-up complaint counts) that no real chef owned.
//
// Chef accounts created here get the password in MIGRATION_DEFAULT_PASSWORD (or "rasoise123").
// It is printed once so the owner can sign in and change it.
//
// Run directly with:  node migrate.js   (db.js also calls it automatically on first start)

const bcrypt = require('bcryptjs');
const { newKitchen, newMenu, legacyDayToCourses, LOCALITIES, DAY_NAMES, defaultAddons } = require('./lib/models');

function guessLocality(text = '') {
  const t = text.toLowerCase();
  return Object.keys(LOCALITIES).find(name => t.includes(name.toLowerCase())) || null;
}

function migrateLegacy(old, fresh) {
  const out = fresh;
  const password = process.env.MIGRATION_DEFAULT_PASSWORD || 'rasoise123';
  const passwordHash = bcrypt.hashSync(password, 10);
  const nowIso = new Date().toISOString();
  const usersByEmail = {};
  let userId = 0;
  let kitchenId = 0;
  const kitchenIdMap = {}; // old id -> new id

  (old.kitchens || []).forEach(k => {
    const email = (k.email || '').trim().toLowerCase();
    let owner = email && usersByEmail[email];
    let duplicate = false;

    if (!owner) {
      owner = {
        id: ++userId,
        role: 'chef',
        name: k.chef || k.name,
        email,
        phone: k.phone || '',
        passwordHash,
        createdAt: k.registeredAt || nowIso,
        status: 'active',
        kitchenId: null,
        preferences: null,
        addresses: [],
        favourites: []
      };
      out.users.push(owner);
      if (email) usersByEmail[email] = owner;
    } else {
      duplicate = true; // same chef registered more than once
    }

    const locality = guessLocality(`${k.sector} ${k.area}`) ;
    const known = (k.area || '').toLowerCase().includes('andheri');
    const coords = locality && known ? LOCALITIES[locality] : null;

    let status = 'approved';
    let statusNote = 'Migrated from the old directory.';
    if (duplicate) {
      status = 'rejected';
      statusNote = 'Duplicate registration (same chef email). Migrated as rejected.';
    } else if (!coords) {
      status = 'pending';
      statusNote = `Needs review: old record said "${k.area || 'unknown area'}, ${k.sector || ''}". Location must be pinned.`;
    }

    const price = Number(k.price) || 80;
    const kitchen = newKitchen({
      id: ++kitchenId,
      ownerId: owner.id,
      name: k.name,
      chefName: k.chef || '',
      coverUrl: k.photoUrl || '',
      cuisines: [],
      dietType: 'veg',
      pricing: { trial: price, single: price + 20, plan5: price * 22, plan7: price * 30 },
      location: {
        lat: coords ? coords.lat : null,
        lng: coords ? coords.lng : null,
        address: coords ? `${locality}, Andheri West, Mumbai` : '',
        locality: locality || ''
      },
      status,
      statusNote,
      phone: k.phone || '',
      email,
      createdAt: k.registeredAt || nowIso,
      approvedAt: status === 'approved' ? nowIso : null
    });
    out.kitchens.push(kitchen);
    kitchenIdMap[String(k.id)] = kitchen.id;
    if (!owner.kitchenId) owner.kitchenId = kitchen.id;

    const weekly = {};
    DAY_NAMES.forEach(d => { weekly[d] = { courses: legacyDayToCourses((k.weeklyMenu || {})[d]) }; });
    const menu = newMenu(kitchen.id, weekly);
    menu.addons = defaultAddons();
    out.menus.push(menu);
  });

  let reviewId = 0;
  (old.reviews || []).forEach(r => {
    const kid = kitchenIdMap[String(r.kitchenId)];
    if (!kid) return; // review for one of the placeholder kitchens
    out.reviews.push({
      id: ++reviewId,
      kitchenId: kid,
      orderId: null,
      customerId: null,
      customerName: r.customerName || 'Customer',
      rating: Number(r.rating) || 5,
      hygiene: Number(r.hygieneRating) || Number(r.rating) || 5,
      taste: Number(r.tasteRating) || Number(r.rating) || 5,
      tags: r.tags || [],
      comment: r.comment || '',
      legacy: true,
      reply: null,
      createdAt: r.createdAt || (r.date ? r.date + 'T12:00:00.000Z' : nowIso)
    });
  });

  let logId = 0;
  (old.auditLogs || []).slice().reverse().forEach(l => {
    out.auditLog.push({
      id: ++logId,
      action: l.action,
      actorId: null,
      actorName: 'Legacy system',
      target: l.kitchen || '',
      detail: l.detail || l.kitchen || '',
      createdAt: l.timestamp || nowIso
    });
  });
  out.auditLog.push({
    id: ++logId,
    action: 'DATA_MIGRATED',
    actorId: null,
    actorName: 'System',
    target: '',
    detail: `Migrated ${out.kitchens.length} kitchens, ${out.reviews.length} reviews. Dropped ${(old.flaggedKitchens || []).length} placeholder flagged kitchens.`,
    createdAt: nowIso
  });

  out.counters = { users: userId, kitchens: kitchenId, reviews: reviewId, auditLog: logId };
  console.log(`[migrate] Chef accounts created with password "${password}". Ask chefs to change it.`);
  return out;
}

module.exports = { migrateLegacy };

if (require.main === module) {
  require('dotenv').config({ path: require('path').join(__dirname, '.env') });
  require('./db').load(); // load() migrates automatically when it sees a v1 file
  console.log('Done.');
}
