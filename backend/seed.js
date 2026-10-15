// Demo data: 7 live kitchens + 1 waiting for approval (real Andheri West spots), 6 customers,
// a week of plans/orders/deliveries, reviews (one low rating that flags a kitchen),
// complaints (one resolved with a refund, one escalated) and an upcoming chef holiday.
//
// Everything goes through the same wallet/order functions the app uses, so every rupee
// reconciles. Stop the server first, then:  npm run seed
// (The admin account is created from .env when the server starts.)

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const fs = require('fs');
const vm = require('vm');
const db = require('./db');
const time = require('./lib/time');
const wallet = require('./lib/wallet');
const meals = require('./lib/meals');
const auth = require('./lib/auth');
const { newKitchen, newMenu, defaultPreferences, defaultAddons, course } = require('./lib/models');

const PASSWORD = 'demo1234';
const hash = auth.hashPassword(PASSWORD);
const U = id => `https://images.unsplash.com/photo-${id}?w=1200&auto=format&fit=crop&q=75`;
const today = time.today();
const day = n => time.addDays(today, n);

// Reuse the browser presets so seeded menus match the chef quick-start menus
const presetCode = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'js', 'menu-presets.js'), 'utf8');
const sandbox = { window: {} };
vm.runInNewContext(presetCode, sandbox);
const PRESETS = sandbox.window.MenuPresets;

function weekly(map) {
  const out = {};
  Object.entries(map).forEach(([d, items]) => {
    out[d] = { courses: items.map(([id, label, ...opts]) => course(id, label, opts)) };
  });
  return out;
}

const SOUTH = weekly({
  monday: [['main', 'Main', 'Idli Sambar', 'Pongal'], ['side', 'Curry', 'Beans Poriyal'], ['rice', 'Rice', 'Lemon Rice + Curd Rice'], ['extra', 'Sides', 'Coconut Chutney + Papad']],
  tuesday: [['main', 'Main', 'Rasam Rice'], ['side', 'Curry', 'Cabbage Thoran'], ['rice', 'Rice', 'Steamed Rice + Chapati'], ['extra', 'Sides', 'Payasam']],
  wednesday: [['main', 'Main', 'Bisi Bele Bath', 'Vegetable Upma'], ['side', 'Curry', 'Potato Fry'], ['rice', 'Rice', 'Curd Rice'], ['extra', 'Sides', 'Boondi + Pickle']],
  thursday: [['main', 'Main', 'Sambar'], ['side', 'Curry', 'Avial'], ['rice', 'Rice', 'Rice + Chapati'], ['extra', 'Sides', 'Appalam']],
  friday: [['main', 'Main', 'Masala Dosa', 'Rava Dosa'], ['side', 'Curry', 'Kurma'], ['rice', 'Rice', 'Tomato Rice'], ['extra', 'Sides', 'Chutney trio']],
  saturday: [['main', 'Main', 'More Kuzhambu'], ['side', 'Curry', 'Beetroot Poriyal'], ['rice', 'Rice', 'Rice + Chapati'], ['extra', 'Sides', 'Kesari']],
  sunday: [['main', 'Main', 'Vada Sambar'], ['side', 'Curry', 'Vegetable Stew'], ['rice', 'Rice', 'Appam + Rice'], ['extra', 'Sides', 'Payasam']]
});

const KONKAN = weekly({
  monday: [['main', 'Main', 'Surmai Curry', 'Kala Vatana Usal'], ['side', 'Sabzi', 'Bhendi Fry'], ['rice', 'Rice & roti', 'Rice + Chapati'], ['extra', 'Sides', 'Sol Kadhi']],
  tuesday: [['main', 'Main', 'Kombdi Rassa', 'Matki Usal'], ['side', 'Sabzi', 'Batata Bhaji'], ['rice', 'Rice & roti', 'Rice + Bhakri'], ['extra', 'Sides', 'Koshimbir']],
  wednesday: [['main', 'Main', 'Bangda Fry + Amti', 'Varan Bhaat'], ['side', 'Sabzi', 'Cabbage Bhaji'], ['rice', 'Rice & roti', 'Rice + Chapati'], ['extra', 'Sides', 'Sol Kadhi']],
  thursday: [['main', 'Main', 'Egg Curry', 'Pithla'], ['side', 'Sabzi', 'Methi Bhaji'], ['rice', 'Rice & roti', 'Rice + Bhakri'], ['extra', 'Sides', 'Thecha']],
  friday: [['main', 'Main', 'Prawns Masala', 'Vangi Bhaji'], ['side', 'Sabzi', 'Tondli Fry'], ['rice', 'Rice & roti', 'Rice + Chapati'], ['extra', 'Sides', 'Sol Kadhi']],
  saturday: [['main', 'Main', 'Kombdi Vade', 'Misal'], ['side', 'Sabzi', 'Batata Bhaji'], ['rice', 'Rice & roti', 'Rice'], ['extra', 'Sides', 'Koshimbir']],
  sunday: [['main', 'Main', 'Pomfret Thali', 'Puran Poli'], ['side', 'Sabzi', 'Bharli Vangi'], ['rice', 'Rice & roti', 'Rice + Chapati'], ['extra', 'Sides', 'Sol Kadhi']]
});

const MUGHLAI = weekly({
  monday: [['main', 'Main', 'Chicken Biryani', 'Veg Biryani'], ['side', 'Side', 'Mirchi Ka Salan'], ['extra', 'Sides', 'Raita + Salad']],
  tuesday: [['main', 'Main', 'Chicken Korma', 'Paneer Korma'], ['side', 'Dal', 'Dal Gosht', 'Dal Fry'], ['bread', 'Roti & rice', 'Roti + Jeera Rice'], ['extra', 'Sides', 'Salad']],
  wednesday: [['main', 'Main', 'Mutton Pulao', 'Veg Pulao'], ['side', 'Side', 'Dalcha'], ['extra', 'Sides', 'Raita']],
  thursday: [['main', 'Main', 'Keema Matar', 'Aloo Matar'], ['side', 'Dal', 'Dal Tadka'], ['bread', 'Roti & rice', 'Roti + Rice'], ['extra', 'Sides', 'Kachumber']],
  friday: [['main', 'Main', 'Chicken Biryani', 'Veg Biryani'], ['side', 'Side', 'Bagara Baingan'], ['extra', 'Sides', 'Phirni']],
  saturday: [['main', 'Main', 'Nihari', 'Paneer Do Pyaza'], ['bread', 'Roti & rice', 'Khameeri Roti + Rice'], ['extra', 'Sides', 'Salad']],
  sunday: [['main', 'Main', 'Chicken Dum Biryani', 'Veg Dum Biryani'], ['side', 'Side', 'Mirchi Ka Salan'], ['extra', 'Sides', 'Double Ka Meetha']]
});

const SINDHI = weekly({
  monday: [['sabzi', 'Sabzi', 'Sai Bhaji', 'Aloo Tuk'], ['dal', 'Dal', 'Dal Pakwan Dal'], ['bread', 'Roti & rice', 'Phulka + Rice'], ['sides', 'Sides', 'Papad + Pickle']],
  tuesday: [['sabzi', 'Sabzi', 'Bhindi Basar'], ['dal', 'Dal', 'Moong Dal'], ['bread', 'Roti & rice', 'Phulka + Rice'], ['sides', 'Sides', 'Raita']],
  wednesday: [['sabzi', 'Sabzi', 'Sindhi Kadhi'], ['dal', 'Dal', 'Chana Dal'], ['bread', 'Roti & rice', 'Rice + Koki'], ['sides', 'Sides', 'Aloo Tuk']],
  thursday: [['sabzi', 'Sabzi', 'Dal Palak', 'Seyal Bhindi'], ['dal', 'Dal', 'Toor Dal'], ['bread', 'Roti & rice', 'Phulka + Rice'], ['sides', 'Sides', 'Papad']],
  friday: [['sabzi', 'Sabzi', 'Kadhi Chawal'], ['dal', 'Dal', 'Moong Dal'], ['bread', 'Roti & rice', 'Phulka'], ['sides', 'Sides', 'Aloo Tuk']],
  saturday: [['sabzi', 'Sabzi', 'Sai Bhaji'], ['dal', 'Dal', 'Masoor Dal'], ['bread', 'Roti & rice', 'Phulka + Rice'], ['sides', 'Sides', 'Pickle']],
  sunday: [['sabzi', 'Sabzi', 'Dal Pakwan'], ['dal', 'Dal', 'Chana Dal'], ['bread', 'Roti & rice', 'Pakwan + Rice'], ['sides', 'Sides', 'Mithi Lola']]
});

const KITCHENS = [
  { key: 'annapurna', name: 'Annapurna Kitchen', chef: 'Asha Sharma', email: 'asha@rasoise.demo', phone: '9876543210', loc: [19.1428, 72.8252, 'Lokhandwala', 'Lokhandwala Complex, Andheri West'], diet: 'veg', cuisines: ['Gujarati', 'North Indian'], fssai: '21524005001234', pricing: { single: 110, trial: 80, plan5: 2090, plan7: 2790 }, slots: ['lunch', 'dinner'], capacity: 30, radiusM: 2500, offDays: ['sunday'], cover: U('1546833999-b9f581a1996d'), gallery: [U('1631452180519-c014fe946bc7'), U('1601050690597-df0568f70950')], bio: 'Light Gujarati and North Indian food, less oil, fresh phulkas.', story: 'I have cooked for my family of six for 25 years. My kadhi and thepla are what neighbours ask for most. Everything is made the same morning in small batches.', menu: PRESETS.gujarati.weekly, upi: 'asha.sharma@okaxis' },
  { key: 'nanak', name: "Nanak's Rasoi", chef: 'Harpreet Kaur', email: 'harpreet@rasoise.demo', phone: '9812345678', loc: [19.1355, 72.8150, 'Versova', 'Yari Road, Versova'], diet: 'veg', cuisines: ['Punjabi'], fssai: '21524005004321', pricing: { single: 120, trial: 90, plan5: 2310, plan7: 3000 }, slots: ['lunch', 'dinner'], capacity: 25, radiusM: 2000, offDays: [], cover: U('1631452180519-c014fe946bc7'), gallery: [U('1596797038530-2c107229654b'), U('1546833999-b9f581a1996d')], bio: 'Maa di dal, soft tawa rotis and seasonal sarson da saag.', story: 'Punjabi home food the way my mother-in-law taught me in Ludhiana. No cream from a packet, no colour. Just slow-cooked dal and fresh rotis.', menu: PRESETS.punjabi.weekly, upi: 'harpreet.kaur@oksbi' },
  { key: 'konkan', name: 'Konkan Ghar', chef: 'Sunita Naik', email: 'sunita@rasoise.demo', phone: '9820011223', loc: [19.1295, 72.8215, 'Seven Bungalows', 'Seven Bungalows, Andheri West'], diet: 'nonveg', cuisines: ['Maharashtrian', 'Konkani'], fssai: '21524005007788', pricing: { single: 140, trial: 110, plan5: 2750, plan7: 3600 }, slots: ['lunch', 'dinner'], capacity: 20, radiusM: 3000, offDays: ['monday'], cover: U('1574653853027-5382a3d23a15'), gallery: [U('1625398407796-82650a8c135f')], bio: 'Malvani fish curries, sol kadhi and bhakri from a Konkan family kitchen.', story: 'My family is from Malvan. Fish comes from Versova jetty every morning. There is always a veg option the same day.', menu: KONKAN, upi: 'sunita.naik@okicici', dishes: [['Surmai Curry', 'nonveg', 'spicy', ['fish']], ['Kombdi Rassa', 'nonveg', 'spicy'], ['Bangda Fry + Amti', 'nonveg', 'spicy', ['fish']], ['Egg Curry', 'egg', 'medium', ['egg']], ['Prawns Masala', 'nonveg', 'spicy', ['shellfish']], ['Kombdi Vade', 'nonveg', 'medium'], ['Pomfret Thali', 'nonveg', 'medium', ['fish']], ['Misal', 'veg', 'spicy']] },
  { key: 'amma', name: "Amma's Kitchen", chef: 'Lakshmi Iyer', email: 'lakshmi@rasoise.demo', phone: '9833445566', loc: [19.1495, 72.8355, 'Oshiwara', 'Oshiwara, Andheri West'], diet: 'veg', cuisines: ['South Indian'], fssai: '', pricing: { single: 100, trial: 75, plan5: 1980, plan7: 2600 }, slots: ['lunch'], capacity: 20, radiusM: 2000, offDays: [], cover: U('1589301760014-d929f3979dbc'), gallery: [U('1668236543090-82eba5ee5976'), U('1630383249896-424e482df921')], bio: 'Tamil home meals: sambar, rasam, poriyal and curd rice.', story: 'Simple Iyer-style meals, cooked in a little coconut oil. Dosa batter is ground at home twice a week.', menu: SOUTH, upi: 'lakshmi.iyer@okhdfcbank', dishes: [['Masala Dosa', 'veg', 'mild'], ['Rava Dosa', 'veg', 'mild'], ['Bisi Bele Bath', 'veg', 'medium', ['peanuts']], ['Payasam', 'veg', 'mild', ['dairy', 'cashew']]] },
  { key: 'sindhi', name: 'Sindhi Swaad', chef: 'Kavita Lalwani', email: 'kavita@rasoise.demo', phone: '9867012345', loc: [19.1262, 72.8262, 'Four Bungalows', 'Four Bungalows, Andheri West'], diet: 'veg', cuisines: ['Sindhi'], fssai: '21524005009911', pricing: { single: 115, trial: 85, plan5: 2200, plan7: 2900 }, slots: ['lunch', 'dinner'], capacity: 15, radiusM: 2000, offDays: ['sunday'], cover: U('1626777552726-4a6b54c97e46'), gallery: [U('1606491956689-2ea866880c84')], bio: 'Sai bhaji, Sindhi kadhi and koki, the way my nani made it.', story: 'Sindhi food is hard to find outside a Sindhi home. I cook it the old way, with plenty of greens.', menu: SINDHI, upi: 'kavita.l@okaxis' },
  { key: 'bawarchi', name: 'Bawarchi Bibi', chef: 'Rukhsana Shaikh', email: 'rukhsana@rasoise.demo', phone: '9819876543', loc: [19.1468, 72.8380, 'Oshiwara', 'Near Link Road, Oshiwara'], diet: 'nonveg', cuisines: ['Mughlai'], fssai: '21524005002468', pricing: { single: 160, trial: 120, plan5: 3100, plan7: 4100 }, slots: ['lunch', 'dinner'], capacity: 20, radiusM: 3000, offDays: [], cover: U('1631515243349-e0cb75fb8d3a'), gallery: [U('1617692855027-33b14f061079'), U('1610057099431-d73a1c9d2f2f')], bio: 'Home-style dum biryani, korma and Friday nihari.', story: 'Biryani on wood-fire dum like at family weddings, but in tiffin portions. Every day has a veg option too.', menu: MUGHLAI, upi: 'rukhsana.shaikh@okicici', dishes: [['Chicken Biryani', 'nonveg', 'medium'], ['Chicken Korma', 'nonveg', 'medium', ['cashew', 'dairy']], ['Dal Gosht', 'nonveg', 'medium'], ['Mutton Pulao', 'nonveg', 'medium'], ['Keema Matar', 'nonveg', 'spicy'], ['Nihari', 'nonveg', 'spicy'], ['Chicken Dum Biryani', 'nonveg', 'medium'], ['Phirni', 'veg', 'mild', ['dairy']]] },
  { key: 'ritu', name: 'Healthy Thali by Ritu', chef: 'Ritu Mehta', email: 'ritu@rasoise.demo', phone: '9821234567', loc: [19.1400, 72.8230, 'Lokhandwala', 'Lokhandwala Back Road'], diet: 'veg', cuisines: ['Healthy', 'Jain'], fssai: '21524005003579', pricing: { single: 130, trial: 99, plan5: 2530, plan7: 3300 }, slots: ['lunch'], capacity: 25, radiusM: 2500, offDays: ['saturday', 'sunday'], cover: U('1585937421612-70a008356fbe'), gallery: [U('1567188040759-fb8a883dc6d8')], bio: 'Low-oil, high-protein thalis. Jain option every day.', story: 'I am a nutritionist. These are the meals I plan for my clients: millet rotis, sprouts, lots of vegetables, no maida.', menu: PRESETS.comfort.weekly, upi: 'ritu.mehta@okhdfcbank' }
];

const CUSTOMERS = [
  { key: 'neha', name: 'Neha Kulkarni', email: 'neha@rasoise.demo', phone: '9876500011', addr: ['Home', 'B-402, 4th floor', 'Silver Oaks CHS', 'opposite Lokhandwala market', 19.1433, 72.8268], prefs: { diet: 'veg', spice: 'mild', rotiCount: 3 } },
  { key: 'rohan', name: 'Rohan Desai', email: 'rohan@rasoise.demo', phone: '9876500022', addr: ['Work', '3rd floor, Office 304', 'Laxmi Industrial Estate', 'near Andheri Link Road', 19.1352, 72.8233], prefs: { diet: 'veg', rotiCount: 4, rice: false } },
  { key: 'priya', name: 'Priya Menon', email: 'priya@rasoise.demo', phone: '9876500033', addr: ['Home', 'Flat 1102', 'Oberoi Springs', 'Oshiwara', 19.1478, 72.8340], prefs: { diet: 'veg', spice: 'medium', allergies: ['peanuts'] } },
  { key: 'aditya', name: 'Aditya Rao', email: 'aditya@rasoise.demo', phone: '9876500044', addr: ['Home', 'Bungalow 7', 'Seven Bungalows Road', 'near Versova metro', 19.1302, 72.8205], prefs: { diet: 'nonveg', spice: 'spicy', rotiCount: 4 } },
  { key: 'farah', name: 'Farah Khan', email: 'farah@rasoise.demo', phone: '9876500055', addr: ['Home', 'A-12', 'Samarth Vaibhav', 'Oshiwara', 19.1452, 72.8362], prefs: { diet: 'nonveg' } },
  { key: 'vikram', name: 'Vikram Shah', email: 'vikram@rasoise.demo', phone: '9876500066', addr: ['Home', '7th floor, 702', 'Lokhandwala Residency', 'Lokhandwala Back Road', 19.1408, 72.8241], prefs: { diet: 'jain', noOnionGarlic: true, rotiCount: 2 } }
];

// Set timestamps on everything created since `mark` so history looks like it happened on `iso`
function mark(d) {
  return { wt: d.walletTransactions.length, n: d.notifications.length, o: d.orders.length };
}
function backdate(d, m, iso) {
  d.walletTransactions.slice(m.wt).forEach(t => { t.createdAt = iso; });
  d.notifications.slice(m.n).forEach(n => { n.createdAt = iso; n.read = true; });
  d.orders.slice(m.o).forEach(o => { o.createdAt = iso; o.updatedAt = iso; o.statusHistory.forEach(h => { h.at = iso; }); });
}
const isoAt = (date, hh, mm = 0) => new Date(Date.parse(`${date}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00+05:30`)).toISOString();

function deliver(d, o, k) {
  const steps = [['preparing', 9, 30], ['out_for_delivery', 12, 15], ['delivered', 12, 50]];
  if (o.slot === 'dinner') steps.forEach(s => { s[1] += 7; });
  steps.forEach(([st, h, m]) => o.statusHistory.push({ status: st, at: isoAt(o.date, h, m), by: 'chef' }));
  o.status = 'delivered';
  o.outForDeliveryAt = isoAt(o.date, steps[1][1], steps[1][2]);
  o.deliveredAt = isoAt(o.date, steps[2][1], steps[2][2]);
  const before = d.walletTransactions.length;
  wallet.settleDelivered(d, o, k);
  d.walletTransactions.slice(before).forEach(t => { t.createdAt = o.deliveredAt; });
}

function run() {
  const data = db.emptyData();
  db.replace(data);
  const d = db.load();
  const users = {};
  const kitchens = {};

  // Chefs + kitchens + menus
  KITCHENS.forEach((s, i) => {
    const u = {
      id: db.nextId('users'), role: 'chef', name: s.chef, email: s.email, phone: s.phone, passwordHash: hash,
      status: 'active', createdAt: isoAt(day(-60 + i), 11), preferences: null, addresses: [], defaultAddressId: null, favourites: [], kitchenId: null
    };
    d.users.push(u);
    const k = newKitchen({
      id: db.nextId('kitchens'), ownerId: u.id, name: s.name, chefName: s.chef, bio: s.bio, story: s.story,
      coverUrl: s.cover, gallery: s.gallery, cuisines: s.cuisines, fssai: s.fssai, dietType: s.diet, pricing: s.pricing,
      slots: s.slots, capacity: s.capacity, radiusM: s.radiusM, offDays: s.offDays, upi: s.upi, phone: s.phone, email: s.email,
      location: { lat: s.loc[0], lng: s.loc[1], locality: s.loc[2], address: s.loc[3] },
      status: 'approved', statusNote: 'Kitchen visit done. Welcome to RasoiSe!', createdAt: u.createdAt, approvedAt: isoAt(day(-58 + i), 15)
    });
    d.kitchens.push(k);
    u.kitchenId = k.id;
    const menu = newMenu(k.id, JSON.parse(JSON.stringify(s.menu)));
    menu.addons = defaultAddons();
    menu.dishes = (s.dishes || []).map(([name, type, spice, allergens], j) => ({ id: `d${j + 1}`, name, type, spice, allergens: allergens || [], photo: '', description: '' }));
    d.menus.push(menu);
    users[s.key] = u;
    kitchens[s.key] = k;
  });
  // Today's special at Annapurna
  d.menus[0].specials.push({ date: today, name: 'Methi Thepla (4 pcs)', description: 'With chhundo and curd', price: 60 });

  // A kitchen waiting for approval
  const pendingChef = { id: db.nextId('users'), role: 'chef', name: 'Meera Joshi', email: 'meera@rasoise.demo', phone: '9867543210', passwordHash: hash, status: 'active', createdAt: isoAt(day(-1), 18), preferences: null, addresses: [], defaultAddressId: null, favourites: [], kitchenId: null };
  d.users.push(pendingChef);
  const pk = newKitchen({ id: db.nextId('kitchens'), ownerId: pendingChef.id, name: "Meera's Pulao House", chefName: 'Meera Joshi', bio: 'Maharashtrian pulao, varan bhaat and amti.', coverUrl: U('1645177628172-a94c1f96e6db'), cuisines: ['Maharashtrian'], dietType: 'veg', pricing: { single: 100, trial: 80, plan5: 1980, plan7: 2600 }, location: { lat: 19.1512, lng: 72.8318, locality: 'Oshiwara', address: 'Oshiwara, Andheri West' }, status: 'pending', phone: pendingChef.phone, email: pendingChef.email, createdAt: pendingChef.createdAt });
  d.kitchens.push(pk);
  pendingChef.kitchenId = pk.id;
  const pm = newMenu(pk.id, JSON.parse(JSON.stringify(PRESETS.north_indian.weekly)));
  pm.addons = defaultAddons();
  d.menus.push(pm);
  d.notifications.push({ id: db.nextId('notifications'), userId: pendingChef.id, type: 'kitchen_pending', title: 'Application received', body: 'We will review your kitchen within a day.', link: 'chef-settings.html', read: false, createdAt: pendingChef.createdAt });

  // Customers with an address, preferences and a wallet top-up a week ago
  CUSTOMERS.forEach((c, i) => {
    const [label, flat, building, landmark, lat, lng] = c.addr;
    const u = {
      id: db.nextId('users'), role: 'customer', name: c.name, email: c.email, phone: c.phone, passwordHash: hash,
      status: 'active', createdAt: isoAt(day(-20 + i), 20),
      preferences: { ...defaultPreferences(), ...c.prefs },
      addresses: [{ id: 1, label, customLabel: '', flat, building, landmark, formatted: `${building}, ${landmark}, Andheri West, Mumbai`, lat, lng }],
      defaultAddressId: 1, favourites: [], kitchenId: null
    };
    d.users.push(u);
    users[c.key] = u;
    const e = wallet.post(d, { userId: u.id, kind: 'topup', available: 6000, note: 'Wallet top-up (SIM-SEED)' });
    e.createdAt = isoAt(day(-8), 19);
  });
  users.neha.favourites = [kitchens.annapurna.id, kitchens.ritu.id];
  users.aditya.favourites = [kitchens.konkan.id];

  // ---------- Plans (start in the past, run into the future) ----------
  function plan(customerKey, kitchenKey, planType, slot, startOffset, choiceFor) {
    const u = users[customerKey];
    const k = kitchens[kitchenKey];
    const start = day(startOffset);
    const dates = meals.planDates(k, planType, start);
    const slots = slot === 'both' ? ['lunch', 'dinner'] : [slot];
    const total = (planType === '5day' ? k.pricing.plan5 : k.pricing.plan7) * slots.length;
    const prices = meals.splitPrice(total, dates.length * slots.length);
    const sub = {
      id: db.nextId('subscriptions'), code: '', customerId: u.id, kitchenId: k.id, plan: planType, slot,
      startDate: dates[0], endDate: dates[dates.length - 1], mealsTotal: dates.length * slots.length, price: total,
      status: 'active', autoRenew: true, addressId: 1, previousId: null, createdAt: isoAt(day(startOffset - 1), 21)
    };
    sub.code = 'SUB-' + (100 + sub.id);
    d.subscriptions.push(sub);
    let i = 0;
    dates.forEach(date => slots.forEach(s => {
      const m = mark(d);
      const o = meals.createOrder(d, {
        customer: u, kitchen: k, type: 'subscription', date, slot: s, choices: choiceFor ? choiceFor(date) : {},
        addons: [], note: '', address: u.addresses[0], amount: prices[i++], subscriptionId: sub.id, skipBookableCheck: true
      });
      backdate(d, m, sub.createdAt);
      if (date < today) deliver(d, o, k);
    }));
    return sub;
  }

  plan('neha', 'annapurna', '5day', 'lunch', -7);
  plan('rohan', 'nanak', '7day', 'lunch', -5);
  plan('priya', 'amma', '5day', 'lunch', -4);
  plan('aditya', 'konkan', '7day', 'dinner', -6);
  plan('vikram', 'ritu', '5day', 'lunch', -3);

  // ---------- Single meals & trials ----------
  function single(customerKey, kitchenKey, type, offset, slot, addons = []) {
    const u = users[customerKey];
    const k = kitchens[kitchenKey];
    const date = day(offset);
    const m = mark(d);
    const o = meals.createOrder(d, {
      customer: u, kitchen: k, type, date, slot, choices: {}, addons, note: '', address: u.addresses[0],
      amount: type === 'trial' ? k.pricing.trial : k.pricing.single, skipBookableCheck: true
    });
    backdate(d, m, isoAt(time.addDays(date, -1), 20));
    if (date < today) deliver(d, o, k);
    return o;
  }

  const nehaTrial = single('neha', 'nanak', 'trial', -6, 'lunch');
  const priyaSindhi = single('priya', 'sindhi', 'single', -2, 'dinner', [{ id: 'curd', qty: 1 }]);
  const farah1 = single('farah', 'bawarchi', 'trial', -3, 'dinner');
  const farah2 = single('farah', 'bawarchi', 'single', -1, 'dinner', [{ id: 'extra-roti', qty: 1 }]);
  single('rohan', 'sindhi', 'trial', 1, 'dinner');
  single('farah', 'konkan', 'trial', 2, 'lunch');
  single('neha', 'ritu', 'trial', 1, 'lunch');

  // Neha paused one upcoming plan meal (money back in her wallet)
  const nehaNext = d.orders.find(o => o.customerId === users.neha.id && o.subscriptionId && o.date === meals.planDates(kitchens.annapurna, '5day', day(2), 1)[0]);
  if (nehaNext) {
    nehaNext.status = 'paused';
    nehaNext.statusHistory.push({ status: 'paused', at: isoAt(day(-1), 21), by: 'customer' });
    const e = wallet.release(d, nehaNext, `Paused: Annapurna Kitchen, ${nehaNext.date} lunch`);
    e.createdAt = isoAt(day(-1), 21);
  }

  // ---------- Reviews ----------
  function review(order, rating, comment, tags, extra = {}) {
    const c = d.users.find(u => u.id === order.customerId);
    const r = {
      id: db.nextId('reviews'), kitchenId: order.kitchenId, orderId: order.id, orderType: order.type, customerId: c.id,
      customerName: `${c.name.split(' ')[0]} ${c.name.split(' ')[1][0]}.`, rating, hygiene: extra.hygiene || rating, taste: extra.taste || rating,
      tags, comment, reply: extra.reply ? { body: extra.reply, at: isoAt(order.date, 21) } : null, createdAt: isoAt(order.date, 14, 10)
    };
    d.reviews.push(r);
    order.reviewId = r.id;
    return r;
  }
  const delivered = (cKey, kKey) => d.orders.filter(o => o.customerId === users[cKey].id && o.kitchenId === kitchens[kKey].id && o.status === 'delivered');

  review(nehaTrial, 5, 'Proper maa di dal and the rotis were still soft at 1 pm. Ordered a trial, will be back for a plan.', ['Tastes like home', 'Fresh & hot'], { reply: 'Thank you Neha ji! Do come back.' });
  const nd = delivered('neha', 'annapurna');
  review(nd[0], 5, 'The kadhi is exactly like my Gujarati neighbour aunty makes. Light and not too sweet.', ['Tastes like home', 'Low oil'], { reply: 'So happy you liked it!' });
  review(nd[2] || nd[1], 4, 'Very good food. Rice was a little less one day, otherwise perfect.', ['Low oil', 'On time']);
  const rd = delivered('rohan', 'nanak');
  review(rd[0], 5, 'Office lunch sorted. Rajma chawal on Wednesday is the highlight of my week.', ['Good portions', 'On time']);
  review(rd[2] || rd[1], 4, 'Tasty and filling. Wish there was a salad on more days.', ['Good portions']);
  const pd = delivered('priya', 'amma');
  review(pd[0], 5, 'Rasam tastes like home in Chennai. Amma remembered I can\'t eat peanuts. Thank you!', ['Tastes like home', 'Clean packaging'], { reply: 'Thank you kanna. Always no peanuts for you.' });
  review(priyaSindhi, 5, 'Had Sindhi kadhi for the first time. Loved the koki too!', ['Fresh & hot', 'Good portions']);
  const ad = delivered('aditya', 'konkan');
  review(ad[0], 5, 'Surmai curry was fantastic, fresh fish and real kokum in the sol kadhi.', ['Tastes like home', 'Good portions']);
  review(ad[1], 3, 'Food was good but delivery was 30 minutes late.', ['Late delivery'], { taste: 4 });
  const vd = delivered('vikram', 'ritu');
  review(vd[0], 5, 'Finally a Jain tiffin that isn\'t boring. Millet rotis are great.', ['Low oil', 'Clean packaging']);
  review(farah1, 4, 'Biryani was really good, generous chicken pieces.', ['Good portions']);
  const low = review(farah2, 2, 'Rotis were cold and the korma was very oily today. Container lid was also loose.', ['Too oily', 'Cold food', 'Packaging leaked'], { hygiene: 2 });
  kitchens.bawarchi.flags.push({ reviewId: low.id, rating: 2, hygiene: 2, reason: `2★ review on ${farah2.code}`, at: low.createdAt, resolved: false });

  // ---------- Complaints ----------
  const late = ad[1];
  const t1 = {
    id: db.nextId('tickets'), code: '', orderId: late.id, customerId: users.aditya.id, kitchenId: kitchens.konkan.id, category: 'late', status: 'resolved',
    messages: [
      { id: 1, authorId: users.aditya.id, role: 'customer', authorName: 'Aditya Rao', body: 'Dinner came at 8:55 pm, almost 30 minutes after the slot. Fish was lukewarm.', at: isoAt(late.date, 21, 5) },
      { id: 2, authorId: users.konkan.id, role: 'chef', authorName: 'Sunita Naik', body: 'Very sorry Aditya ji, my delivery boy had a puncture. It will not happen again.', at: isoAt(late.date, 21, 30) },
      { id: 3, authorId: null, role: 'admin', authorName: 'RasoiSe support', body: 'Resolved by RasoiSe support with a ₹60 refund to the wallet. Thanks for your patience.', at: isoAt(time.addDays(late.date, 1), 10), system: true }
    ],
    refund: { amount: 60, at: isoAt(time.addDays(late.date, 1), 10), by: 'RasoiSe support' }, resolution: 'Partial refund for the late delivery.',
    createdAt: isoAt(late.date, 21, 5), updatedAt: isoAt(time.addDays(late.date, 1), 10), resolvedAt: isoAt(time.addDays(late.date, 1), 10)
  };
  t1.code = 'TK-' + (500 + t1.id);
  d.tickets.push(t1);
  const m1 = mark(d);
  wallet.refundDelivered(d, late, kitchens.konkan, 60, 'Complaint ' + t1.code + ': Arrived late', t1.id);
  backdate(d, m1, t1.resolvedAt);

  const t2 = {
    id: db.nextId('tickets'), code: '', orderId: farah2.id, customerId: users.farah.id, kitchenId: kitchens.bawarchi.id, category: 'hygiene', status: 'escalated',
    messages: [
      { id: 1, authorId: users.farah.id, role: 'customer', authorName: 'Farah Khan', body: 'The korma container lid was loose and gravy had leaked into the bag. Rotis were cold too.', at: isoAt(day(-1), 21, 10) },
      { id: 2, authorId: users.bawarchi.id, role: 'chef', authorName: 'Rukhsana Shaikh', body: 'I am sorry. We changed to new containers this week. I will check every lid myself.', at: isoAt(day(-1), 22) }
    ],
    refund: null, createdAt: isoAt(day(-1), 21, 10), updatedAt: isoAt(day(-1), 22)
  };
  t2.code = 'TK-' + (500 + t2.id);
  d.tickets.push(t2);

  // ---------- Upcoming holiday (Amma's kitchen) ----------
  const holidayDate = day(4);
  kitchens.amma.holidays.push({ date: holidayDate, reason: 'Temple visit in Chembur' });
  d.orders.filter(o => o.kitchenId === kitchens.amma.id && o.date === holidayDate && o.status === 'scheduled').forEach(o => {
    const e = wallet.release(d, o, `Kitchen holiday: Amma's Kitchen, ${o.date} ${o.slot}`);
    if (e) e.createdAt = isoAt(day(-1), 17);
    o.status = 'holiday';
    o.cancelReason = 'Temple visit in Chembur';
    o.statusHistory.push({ status: 'holiday', at: isoAt(day(-1), 17), by: 'chef' });
  });

  // ---------- Audit trail ----------
  const audit = (action, actor, target, detail, iso) => d.auditLog.push({ id: db.nextId('auditLog'), action, actorId: null, actorName: actor, target, detail, createdAt: iso });
  KITCHENS.forEach((s, i) => audit('KITCHEN_APPROVED', 'RasoiSe Admin (admin)', s.name, 'Kitchen visit done. Approved.', isoAt(day(-58 + i), 15)));
  audit('TICKET_RESOLVED', 'RasoiSe Admin (admin)', 'Konkan Ghar', `${t1.code}, refunded ₹60. Partial refund for the late delivery.`, t1.resolvedAt);
  audit('KITCHEN_FLAGGED', 'Farah Khan (customer)', 'Bawarchi Bibi', `2★ (hygiene 2★) review on ${farah2.code}: "${low.comment.slice(0, 80)}"`, low.createdAt);
  audit('TICKET_ESCALATED', 'Farah Khan (customer)', 'Bawarchi Bibi', `${t2.code} (hygiene) raised on ${farah2.code}.`, t2.createdAt);
  audit('KITCHEN_HOLIDAY', "Lakshmi Iyer (chef)", "Amma's Kitchen", `${holidayDate}: plan meals refunded.`, isoAt(day(-1), 17));
  audit('CHEF_REGISTER', 'Meera Joshi (chef)', "Meera's Pulao House", 'Meera Joshi applied to cook as "Meera\'s Pulao House" (Oshiwara).', pendingChef.createdAt);

  db.save();
  console.log(`Seeded ${d.kitchens.length} kitchens, ${d.users.length} users, ${d.orders.length} orders, ${d.reviews.length} reviews, ${d.tickets.length} tickets.`);
  console.log(`Demo password for every seeded chef and customer: ${PASSWORD}`);
}

run();
