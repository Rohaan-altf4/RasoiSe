// Photos for the demo kitchens and their dishes (free Unsplash photos, each checked by eye to
// actually show that food). Dishes with no matching photo are left without one on purpose:
// the homepage then shows the kitchen's own photo under the kitchen's name instead of
// putting a wrong picture next to a dish name.

const U = id => `https://images.unsplash.com/photo-${id}?w=1200&auto=format&fit=crop&q=75`;

const KITCHEN_PHOTOS = {
  'Annapurna Kitchen': { cover: U('1589778655375-3e622a9fc91c'), gallery: [U('1742281257687-092746ad6021'), U('1714799263291-272975db795a')] },
  "Nanak's Rasoi": { cover: U('1631452180519-c014fe946bc7'), gallery: [U('1788602564560-9bcbf0f9acb6'), U('1789983665266-f1a6ea13b311')] },
  'Konkan Ghar': { cover: U('1786222084052-fb6f27bfb135'), gallery: [U('1620894580123-466ad3a0ca06'), U('1632660345494-9cc2607f89c2')] },
  'Sindhi Swaad': { cover: U('1626777552726-4a6b54c97e46'), gallery: [] },
  'Healthy Thali by Ritu': { cover: U('1743674453123-93356ade2891'), gallery: [U('1680993032090-1ef7ea9b51e5')] }
};

// Photos the first version of the demo data used, which didn't match their kitchen. Only these
// are replaced in an existing database, so a photo a cook uploaded is never overwritten.
const OLD_DEMO_PHOTOS = [
  '1546833999-b9f581a1996d', '1631452180519-c014fe946bc7', '1601050690597-df0568f70950', '1596797038530-2c107229654b',
  '1574653853027-5382a3d23a15', '1625398407796-82650a8c135f', '1606491956689-2ea866880c84',
  '1585937421612-70a008356fbe', '1567188040759-fb8a883dc6d8'
].map(U);

const DISH_PHOTOS = {
  // Gujarati
  'Bateta Nu Shaak': '1652545296892-3787063f8b4d', 'Bateta Rasawala': '1652545296893-ff9227b3512e', 'Ringan No Olo': '1777613112774-1a64a2c2d337',
  // Punjabi and North Indian
  'Shahi Paneer': '1631452180539-96aca7d48617', 'Butter Paneer': '1631452180519-c014fe946bc7', 'Paneer Butter Masala': '1631452180519-c014fe946bc7',
  'Kadhai Paneer': '1631292784640-2b24be784d5d', 'Paneer Do Pyaza': '1588166524941-3bf61a9c41db', 'Amritsari Chole': '1788602564560-9bcbf0f9acb6',
  'Kadhi Pakora': '1789992252185-3faaeea5c045', 'Bhindi Masala': '1788621138183-dda1ef14b032', 'Bhindi Do Pyaza': '1788621138183-dda1ef14b032',
  'Baingan Bharta': '1777613112774-1a64a2c2d337', 'Lauki Chana Dal': '1736680056444-02b10f16a245',
  // Konkani and Maharashtrian
  'Surmai Curry': '1654863404432-cac67587e25d', 'Kombdi Rassa': '1764304733301-3a9f335f0c67', 'Prawns Masala': '1632660345494-9cc2607f89c2',
  'Egg Curry': '1764315197254-94385571df22', 'Misal': '1665156958464-90a8b463e1e6', 'Varan Bhaat': '1755090154817-58d9d36ec988',
  // South Indian
  'Idli Sambar': '1680359871322-aabe6b33eff5', 'Sambar': '1736239092819-da2e9b4b5c6b', 'Vada Sambar': '1630383249896-424e482df921',
  'Masala Dosa': '1668236543090-82eba5ee5976', 'Rava Dosa': '1743517894265-c86ab035adef', 'Vegetable Upma': '1630409349197-b733a524b24e',
  // Sindhi
  'Bhindi Basar': '1616144089518-05e4b9482b46', 'Seyal Bhindi': '1616144089518-05e4b9482b46', 'Kadhi Chawal': '1727018742095-14c9a05aa71a',
  // Mughlai
  'Chicken Biryani': '1631515243349-e0cb75fb8d3a', 'Chicken Dum Biryani': '1782541370275-6761522e39d1', 'Veg Biryani': '1736680056325-ba2ade6250a3',
  'Veg Dum Biryani': '1642821373181-696a54913e93', 'Veg Pulao': '1697155406055-2db32d47ca07', 'Mutton Pulao': '1633945274309-2c16c9682a8c',
  'Chicken Korma': '1708782344490-9026aaa5eec7', 'Nihari': '1545247181-516773cae754'
};

function typeOf(name, kitchen) {
  if (kitchen.dietType === 'veg') return 'veg';
  if (/egg/i.test(name)) return 'egg';
  return /chicken|mutton|keema|nihari|kombdi|prawn|fish|surmai|bangda|pomfret|gosht/i.test(name) ? 'nonveg' : 'veg';
}

// Set the kitchen and dish photos. With onlyOld, kitchen photos are replaced only where they are
// still one of the old demo photos, and dish photos only where the dish has none.
function apply(d, { onlyOld = false } = {}) {
  let kitchensChanged = 0;
  let dishesChanged = 0;
  d.kitchens.forEach(k => {
    const p = KITCHEN_PHOTOS[k.name];
    if (p) {
      const coverIsOld = !onlyOld || OLD_DEMO_PHOTOS.includes(k.coverUrl);
      const galleryIsOld = !onlyOld || (k.gallery || []).every(g => OLD_DEMO_PHOTOS.includes(g));
      if (coverIsOld && k.coverUrl !== p.cover) { k.coverUrl = p.cover; kitchensChanged++; }
      if (galleryIsOld && JSON.stringify(k.gallery) !== JSON.stringify(p.gallery)) { k.gallery = p.gallery.slice(); kitchensChanged++; }
    }
    const menu = d.menus.find(m => m.kitchenId === k.id);
    if (!menu) return;
    menu.dishes = menu.dishes || [];
    const onMenu = new Set();
    Object.values(menu.weekly || {}).forEach(day => (day.courses || []).forEach(c => (c.options || []).forEach(o => onMenu.add(o))));
    onMenu.forEach(name => {
      const id = DISH_PHOTOS[name];
      if (!id) return;
      let dish = menu.dishes.find(x => x.name.toLowerCase() === name.toLowerCase());
      if (!dish) {
        dish = { id: `p${menu.dishes.length + 1}`, name, type: typeOf(name, k), spice: 'medium', allergens: [], photo: '', description: '' };
        menu.dishes.push(dish);
      }
      if (!dish.photo || !onlyOld) { if (dish.photo !== U(id)) dishesChanged++; dish.photo = U(id); }
    });
  });
  return { kitchensChanged, dishesChanged };
}

module.exports = { apply, KITCHEN_PHOTOS, DISH_PHOTOS };
