// Kitchen storefront: profile, weekly menu, reviews, and booking (single meal, 1-day trial, monthly plan).

(async function () {
  const { esc, icon, money } = UI;
  const root = document.getElementById('kitchenRoot');
  const id = Number(UI.qs('id'));

  await App.init({ active: 'home' });
  const role = App.role;

  if (!id) {
    root.innerHTML = UI.empty({ icon: 'store', title: 'Kitchen not found', body: 'This link is missing the kitchen.', action: '<a class="btn btn-primary" href="/index.html">See kitchens near you</a>' });
    UI.icons(root);
    return;
  }

  let k = null;
  let days = [];
  let reviews = { stats: {}, reviews: [] };
  let reviewFilter = 'all';
  const book = { mode: 'single', date: null, slot: null, choices: {}, addons: {}, note: '', addressId: null, plan: '5day', planSlot: 'lunch', start: null, autoRenew: true };

  async function load() {
    try {
      const [kr, av, rv] = await Promise.all([
        API.get(`/api/kitchens/${id}`),
        API.get(`/api/kitchens/${id}/availability?days=14`).catch(() => ({ days: [] })),
        API.get(`/api/kitchens/${id}/reviews`)
      ]);
      k = kr.kitchen;
      days = av.days;
      reviews = rv;
      document.title = `${k.name} · RasoiSe`;
      initBooking();
      render();
    } catch (e) {
      root.innerHTML = e.status === 404
        ? UI.empty({ icon: 'store', title: 'Kitchen not found', body: 'It may have closed or moved. Find another kitchen nearby.', action: '<a class="btn btn-primary" href="/index.html">See kitchens near you</a>' })
        : UI.errorState(e.message, '<button class="btn btn-secondary" onclick="location.reload()">Try again</button>');
      UI.icons(root);
    } finally {
      root.setAttribute('aria-busy', 'false');
    }
  }

  // ---------- Booking state ----------
  function bookableDays() {
    return days.filter(d => d.slots.lunch.bookable || d.slots.dinner.bookable);
  }

  function initBooking() {
    const u = App.user;
    if (u && u.role === 'customer') {
      book.addressId = u.defaultAddressId || ((u.addresses || [])[0] || {}).id || null;
      const pref = (u.preferences || {}).defaultSlot;
      if (pref && pref !== 'both') book.planSlot = pref;
      if (pref === 'both' && k.slots.length === 2) book.planSlot = 'both';
    }
    const first = bookableDays()[0];
    book.date = first ? first.date : null;
    book.slot = first ? (first.slots.lunch.bookable ? 'lunch' : 'dinner') : null;
    if (!k.slots.includes(book.planSlot) && book.planSlot !== 'both') book.planSlot = k.slots[0];
    book.start = first ? first.date : null;

    // Reorder: prefill from a past order (?reorder=ID)
    const reorderId = Number(UI.qs('reorder'));
    if (reorderId && role === 'customer') {
      API.get(`/api/orders/${reorderId}`).then(r => {
        const o = r.order;
        if (o.kitchenId !== k.id) return;
        book.mode = 'single';
        book.choices = { ...o.choices };
        (o.addons || []).forEach(a => { book.addons[a.id] = a.qty; });
        if (o.note) book.note = o.note;
        if (k.slots.includes(o.slot)) {
          const d = bookableDays().find(x => x.slots[o.slot].bookable);
          if (d) { book.date = d.date; book.slot = o.slot; }
        }
        renderBooking();
        UI.toast('We filled in your last order. Check the date and place it.', { type: 'info' });
      }).catch(() => {});
    }
  }

  function dayInfo(date) {
    return days.find(d => d.date === date) || null;
  }

  function dayLabel(date) {
    const t = App.session.today;
    const tm = addDays(t, 1);
    if (date === t) return 'Today';
    if (date === tm) return 'Tomorrow';
    return UI.date(date, { weekday: 'short', day: 'numeric' });
  }

  function addDays(d, n) {
    const x = new Date(d + 'T00:00:00Z');
    x.setUTCDate(x.getUTCDate() + n);
    return x.toISOString().slice(0, 10);
  }

  // The thali's veg / non-veg tag for a day's courses, or for the dishes picked so far
  const dayTag = courses => UI.thaliTag(UI.menuType(courses, k.menu.dishes || [], k.dietType));
  const pickedTag = courses => UI.thaliTag(UI.thaliType(courses.map(c => book.choices[c.id] || c.options[0]), k.menu.dishes || [], k.dietType));

  function dishMeta(name) {
    return (k.menu.dishes || []).find(x => x.name.toLowerCase() === String(name).toLowerCase()) || null;
  }

  // ---------- Page ----------
  function render() {
    const s = k.stats;
    const photos = [k.coverUrl, ...(k.gallery || [])].filter(Boolean);
    const isOwner = role === 'chef' && App.session.kitchen && App.session.kitchen.id === k.id;
    root.innerHTML = `
      ${k.status !== 'approved' ? `<div class="alert alert-warning" style="margin-bottom:16px">${icon('eye')}<div><div class="a-title">Preview</div>This kitchen is ${esc(UI.statusLabel(k.status).toLowerCase())} and not visible to customers yet.</div></div>` : ''}
      <section class="grid grid-cols-1 gap-3 ${photos.length > 1 ? 'lg:grid-cols-[2fr_1fr]' : ''}">
        <div class="kcard-img" style="aspect-ratio:${photos.length > 1 ? '16/8' : '16/6'}">${UI.img(photos[0], `Food from ${k.name}`, '', '(max-width: 1024px) 100vw, 66vw')}</div>
        ${photos.length > 1 ? `<div class="hidden lg:grid ${photos.length === 2 ? 'grid-cols-1' : 'grid-cols-2'} gap-3">${photos.slice(1, 5).map((p, i) => `<button type="button" class="kcard-img" style="aspect-ratio:${photos.length === 2 ? 'auto' : '1'};border:0;padding:0;cursor:pointer" data-action="photo" data-src="${esc(p)}" aria-label="View photo ${i + 2}">${UI.img(p, '')}</button>`).join('')}</div>` : ''}
      </section>
      ${photos.length > 1 ? `<div class="chip-scroll lg:hidden" style="margin-top:10px">${photos.map((p, i) => `<button type="button" style="border:0;padding:0;border-radius:10px;overflow:hidden;width:72px;height:56px;flex-shrink:0;cursor:pointer" data-action="photo" data-src="${esc(p)}" aria-label="View photo ${i + 1}">${UI.img(p, '')}</button>`).join('')}</div>` : ''}

      <div class="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_380px]" style="margin-top:var(--s6)">
        <div style="min-width:0">
          <div class="flex items-start justify-between gap-3">
            <div style="min-width:0">
              <h1 class="h1">${esc(k.name)}</h1>
              <p class="text-muted" style="margin:6px 0 0">by ${esc(k.chefName || 'Home chef')}${k.location.locality ? ` · ${esc(k.location.locality)}` : ''}${k.distance != null ? ` · ${UI.distance(k.distance)} (${k.walkMinutes} min walk)` : ''}</p>
            </div>
            ${role === 'customer' ? `<button type="button" class="btn btn-secondary btn-icon" data-action="fav" aria-pressed="${!!k.isFavourite}" aria-label="${k.isFavourite ? 'Remove from' : 'Save to'} favourites">${icon('heart')}</button>` : ''}
          </div>
          <div class="flex flex-wrap items-center gap-2" style="margin-top:12px">
            ${UI.ratingPill(s.rating)} <a class="text-sm link" href="#reviews">${s.reviewsCount} review${s.reviewsCount === 1 ? '' : 's'}</a>
            ${UI.kitchenDietTag(k.dietType)}
            ${(k.cuisines || []).map(c => `<span class="badge badge-neutral">${esc(c)}</span>`).join('')}
          </div>
          <dl class="grid grid-cols-2 sm:grid-cols-4 gap-3" style="margin:var(--s5) 0 0">
            ${stat('Meals served', s.mealsServed.toLocaleString('en-IN'))}
            ${stat('Hygiene', s.hygiene != null ? `${s.hygiene} / 5` : 'No ratings yet')}
            ${stat('Order by', `${UI.time12(k.cutoffTime)} same day`)}
            ${stat('Delivers within', `${(k.radiusM / 1000).toFixed(1)} km`)}
          </dl>
          ${s.reliability ? `<p class="text-sm" style="margin:10px 0 0">${icon('shield-check', 'icon-xs')} <span>Delivered ${s.reliability.percent}% of booked meals in the last 30 days</span></p>` : ''}
          ${k.fssai ? `<p class="text-xs text-subtle" style="margin:10px 0 0">${icon('badge-check', 'icon-xs')} FSSAI licence ${esc(k.fssai)}</p>` : ''}
          ${k.deliversToYou === false ? `<div class="alert alert-warning" style="margin-top:16px">${icon('map-pin-off')}<div>This kitchen delivers within ${(k.radiusM / 1000).toFixed(1)} km. Your address is ${UI.distance(k.distance)} away.</div><button class="btn btn-secondary btn-sm" data-action="change-address">Change address</button></div>` : ''}
          ${k.paused ? `<div class="alert alert-info" style="margin-top:16px">${icon('circle-pause')}<div>${esc(k.chefName || 'The chef')} has paused new orders for now. Existing plans continue as usual.</div></div>` : ''}

          ${k.bio || k.story ? `
          <section style="margin-top:var(--s8)" aria-labelledby="aboutTitle">
            <h2 class="h3" id="aboutTitle">About the kitchen</h2>
            ${k.bio ? `<p style="margin:8px 0 0;font-weight:500">${esc(k.bio)}</p>` : ''}
            ${k.story ? `<p class="text-muted" style="margin:8px 0 0;white-space:pre-line">${esc(k.story)}</p>` : ''}
          </section>` : ''}

          <section style="margin-top:var(--s8)" aria-labelledby="menuTitle">
            <div class="section-head" style="margin-bottom:12px"><h2 class="h3" id="menuTitle">This week's menu</h2><span class="text-xs text-subtle">Where there's a choice, you pick before ${UI.time12(k.cutoffTime)}</span></div>
            <div class="tabs" role="tablist" aria-label="Days" id="menuTabs"></div>
            <div id="menuDay" class="card card-pad" style="margin-top:12px"></div>
            ${(k.menu.addons || []).length ? `
            <div style="margin-top:16px">
              <h3 class="title" style="font-size:var(--t-base)">Add-ons</h3>
              <div class="flex flex-wrap gap-2" style="margin-top:8px">${k.menu.addons.map(a => `<span class="badge badge-neutral">${esc(a.name)} · ${money(a.price)}</span>`).join('')}</div>
            </div>` : ''}
          </section>

          <section id="reviews" style="margin-top:var(--s8);scroll-margin-top:80px" aria-labelledby="reviewsTitle"></section>
          <section id="kitchenMapSection" style="margin-top:var(--s8)" hidden aria-labelledby="mapTitle">
            <h2 class="h3" id="mapTitle">Where it's cooked</h2>
            <p class="text-sm text-muted" id="mapCaption" style="margin:4px 0 12px"></p>
            <div class="map-box" id="kitchenMap"></div>
          </section>
        </div>

        <aside id="booking" style="scroll-margin-top:80px;min-width:0">
          <div class="card" style="position:sticky;top:calc(var(--header-h) + 16px)">
            <div id="bookingCard"></div>
          </div>
        </aside>
      </div>`;
    UI.icons(root);
    renderMenuTabs();
    renderReviews();
    renderBooking();
    if (window.Maps) Maps.renderKitchenMap(document.getElementById('kitchenMapSection'), k, App.origin());

    const sticky = document.getElementById('stickyCta');
    if (role === 'customer' || role === 'guest') {
      sticky.hidden = false;
      document.getElementById('stickyPrice').textContent = `${money(k.pricing.single)} · trial ${money(k.pricing.trial)}`;
    }
    if (location.hash === '#reviews') document.getElementById('reviews').scrollIntoView();
    if (isOwner) UI.toast('This is how customers see your kitchen.', { type: 'info' });
  }

  function stat(label, value) {
    return `<div class="panel"><dt class="stat-label">${label}</dt><dd class="title" style="margin:2px 0 0;font-size:var(--t-base)">${value}</dd></div>`;
  }

  // ---------- Weekly menu tabs ----------
  let menuDayIdx = 0;
  function renderMenuTabs() {
    const tabs = document.getElementById('menuTabs');
    const week = Array.from({ length: 7 }, (_, i) => addDays(App.session.today, i));
    tabs.innerHTML = week.map((d, i) => `<button type="button" role="tab" class="tab" aria-selected="${i === menuDayIdx}" data-i="${i}">${dayLabel(d)}</button>`).join('');
    tabs.querySelectorAll('[data-i]').forEach(b => b.addEventListener('click', () => { menuDayIdx = Number(b.dataset.i); renderMenuTabs(); }));
    const date = week[menuDayIdx];
    const key = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][new Date(date + 'T00:00:00Z').getUTCDay()];
    const courses = ((k.menu.weekly[key] || {}).courses) || [];
    const special = (k.menu.specials || []).find(s => s.date === date);
    const holiday = (k.holidays || []).find(h => h.date === date);
    const off = (k.offDays || []).includes(key);
    const box = document.getElementById('menuDay');
    if (holiday || off) {
      box.innerHTML = `<p class="text-muted" style="margin:0">${icon('palmtree', 'icon-sm')} Kitchen closed${holiday && holiday.reason ? `: ${esc(holiday.reason)}` : ''}.</p>`;
    } else if (!courses.length) {
      box.innerHTML = '<p class="text-muted" style="margin:0">The chef hasn\'t set the menu for this day yet.</p>';
    } else {
      box.innerHTML = `
        <div style="margin-bottom:12px">${dayTag(courses)}</div>
        <ul style="list-style:none;margin:0;padding:0;display:grid;gap:12px">
          ${courses.map(c => `
            <li class="flex gap-3">
              <span class="label-caps" style="width:96px;flex-shrink:0;padding-top:2px">${esc(c.label)}</span>
              <span style="flex:1">${c.options.map(o => {
                const m = dishMeta(o);
                return `<span class="flex items-center gap-2" style="margin-bottom:2px"><span style="font-weight:500" translate="no">${esc(o)}</span>${m && m.spice === 'spicy' ? '<span class="badge badge-danger" style="font-size:11px">Spicy</span>' : ''}${m && m.allergens && m.allergens.length ? `<span class="text-xs text-subtle">Contains ${esc(m.allergens.join(', '))}</span>` : ''}</span>`;
              }).join(c.options.length > 1 ? '<span class="text-xs text-subtle" style="display:block;margin:-2px 0 2px">or</span>' : '')}</span>
            </li>`).join('')}
        </ul>
        ${special ? `<div class="panel" style="margin-top:14px;display:flex;gap:10px;align-items:center">${icon('sparkles', 'text-saffron')}<div><strong>Today's special: ${esc(special.name)}</strong> · ${money(special.price)}<div class="text-xs text-muted">${esc(special.description || 'Add it to your meal as an extra.')}</div></div></div>` : ''}`;
    }
    UI.icons(tabs.parentElement);
  }

  // ---------- Reviews ----------
  function renderReviews() {
    const host = document.getElementById('reviews');
    const s = reviews.stats;
    const all = reviews.reviews;
    const list = all.filter(r => reviewFilter === 'all' || (reviewFilter === 'low' ? r.rating <= 3 : r.rating === Number(reviewFilter)));
    const bar = n => {
      const c = s.ratingCounts[n] || 0;
      const pct = s.reviewsCount ? Math.round((c / s.reviewsCount) * 100) : 0;
      return `<div class="flex items-center gap-2 text-xs"><span style="width:22px">${n}★</span><div class="progress" style="flex:1"><span style="width:${pct}%"></span></div><span class="num text-subtle" style="width:24px;text-align:right">${c}</span></div>`;
    };
    host.innerHTML = `
      <div class="section-head"><h2 class="h3" id="reviewsTitle">Reviews</h2><span id="writeReviewSlot"></span></div>
      ${s.reviewsCount ? `
      <div class="card card-pad grid gap-5 sm:grid-cols-[160px_1fr]">
        <div>
          <div class="flex items-baseline gap-1"><span style="font-size:36px;font-weight:700" class="num">${s.rating.toFixed(1)}</span><span class="text-subtle">/ 5</span></div>
          ${UI.stars(s.rating)}
          <div class="text-xs text-subtle" style="margin-top:4px">${s.reviewsCount} review${s.reviewsCount > 1 ? 's' : ''}</div>
          <div class="text-xs text-muted" style="margin-top:8px">Hygiene ${s.hygiene} · Taste ${s.taste}</div>
        </div>
        <div style="display:grid;gap:6px;align-content:center">${[5, 4, 3, 2, 1].map(bar).join('')}</div>
      </div>
      <div class="chips" style="margin:14px 0" role="group" aria-label="Filter reviews">
        ${[['all', 'All'], ['5', '5★'], ['4', '4★'], ['low', '3★ and below']].map(([v, l]) => `<button type="button" class="chip${reviewFilter === v ? ' is-active' : ''}" aria-pressed="${reviewFilter === v}" data-rf="${v}">${l}</button>`).join('')}
      </div>
      <div style="display:grid;gap:12px">
        ${list.length ? list.map(reviewCard).join('') : '<p class="text-muted text-sm">No reviews with this rating.</p>'}
      </div>` : UI.empty({ icon: 'message-square', title: 'No reviews yet', body: 'Be one of the first neighbours to try this kitchen.' })}`;
    host.querySelectorAll('[data-rf]').forEach(b => b.addEventListener('click', () => { reviewFilter = b.dataset.rf; renderReviews(); }));
    UI.icons(host);
    renderWriteReview();
  }

  function reviewCard(r) {
    return `
      <article class="card card-pad">
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-2"><span class="avatar">${esc(r.customerName[0] || '?')}</span><div><div style="font-weight:600">${esc(r.customerName)}</div><div class="text-xs text-subtle">${UI.relTime(r.createdAt)}${r.verified ? ` · Ordered ${r.orderType === 'subscription' ? 'on a plan' : r.orderType === 'trial' ? 'a trial' : 'a meal'}` : ''}</div></div></div>
          ${UI.ratingPill(r.rating)}
        </div>
        <p style="margin:10px 0 0">${esc(r.comment)}</p>
        ${r.tags && r.tags.length ? `<div class="flex flex-wrap gap-1" style="margin-top:8px">${r.tags.map(t => `<span class="badge badge-neutral">${esc(t)}</span>`).join('')}</div>` : ''}
        ${r.reply ? `<div class="panel" style="margin-top:12px"><div class="text-xs" style="font-weight:600">${icon('chef-hat', 'icon-xs')} Reply from ${esc(k.chefName || k.name)}</div><p class="text-sm" style="margin:4px 0 0">${esc(r.reply.body)}</p></div>` : ''}
      </article>`;
  }

  // Show "Rate your meal" if the customer has a delivered meal here without a review
  async function renderWriteReview() {
    if (role !== 'customer') return;
    try {
      const res = await API.get('/api/orders?scope=past');
      const pending = res.orders.filter(o => o.kitchenId === k.id && o.canReview);
      const slot = document.getElementById('writeReviewSlot');
      if (!pending.length || !slot) return;
      slot.innerHTML = `<button type="button" class="btn btn-secondary btn-sm">${icon('star')}Rate your last meal</button>`;
      UI.icons(slot);
      slot.querySelector('button').addEventListener('click', async () => {
        const r = await Review.open(pending[0]);
        if (r) {
          reviews = await API.get(`/api/kitchens/${id}/reviews`);
          renderReviews();
        }
      });
    } catch (e) { /* not critical */ }
  }

  // ---------- Booking card ----------
  function renderBooking() {
    const host = document.getElementById('bookingCard');
    if (!host) return;
    if (role === 'chef' || role === 'admin') {
      host.innerHTML = `<div class="card-pad"><h2 class="h3">Ordering</h2><p class="text-sm text-muted" style="margin:6px 0 0">Customers order meals, trials and plans here. You're signed in as ${role === 'chef' ? 'a chef' : 'an admin'}.</p></div>`;
      return;
    }
    const tabs = `
      <div class="segmented" role="tablist" aria-label="Order type" style="margin-bottom:16px">
        ${[['single', 'Meal'], ['trial', '1-day trial'], ['plan', 'Monthly plan']].map(([m, l]) => `<button type="button" role="tab" aria-selected="${book.mode === m}" data-mode="${m}">${l}</button>`).join('')}
      </div>`;
    host.innerHTML = `<div class="card-pad">${tabs}<div id="bookBody"></div></div>`;
    host.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => { book.mode = b.dataset.mode; renderBooking(); }));
    const body = host.querySelector('#bookBody');
    if (k.status !== 'approved') body.innerHTML = '<p class="text-sm text-muted">Ordering opens once the kitchen is approved.</p>';
    else if (k.paused) body.innerHTML = `<p class="text-sm text-muted">${icon('circle-pause', 'icon-sm')} Not taking new orders right now. Save it to your favourites and check back soon.</p>`;
    else if (book.mode === 'plan') renderPlan(body);
    else renderMeal(body);
    UI.icons(host);
  }

  function addressSection() {
    const u = App.user;
    if (!u) return '';
    const list = u.addresses || [];
    if (!list.length) {
      return `<div class="field" style="margin-top:16px"><span class="field-label">Deliver to</span><button type="button" class="btn btn-secondary btn-block" data-action="add-address">${icon('map-pin-plus')}Add delivery address</button></div>`;
    }
    return `
      <div class="field" style="margin-top:16px">
        <label class="field-label" for="bookAddr">Deliver to</label>
        <div class="flex gap-2">
          <select id="bookAddr" class="select" style="flex:1">${list.map(a => `<option value="${a.id}" ${a.id === book.addressId ? 'selected' : ''}>${esc(AddressBook.addrTitle(a))}: ${esc([a.flat, a.building].filter(Boolean).join(', '))}</option>`).join('')}</select>
          <button type="button" class="btn btn-secondary btn-icon" data-action="add-address" aria-label="Add address">${icon('plus')}</button>
        </div>
      </div>`;
  }

  function renderMeal(body) {
    const trialUsed = book.mode === 'trial' && k.hadTrial;
    if (trialUsed) {
      body.innerHTML = `<div class="alert alert-info">${icon('info')}<div>You've already had your trial here. Order a single meal or start a plan.</div></div>
        <button type="button" class="btn btn-secondary btn-block" style="margin-top:12px" data-mode-switch="single">Order a meal instead</button>`;
      body.querySelector('[data-mode-switch]').addEventListener('click', () => { book.mode = 'single'; renderBooking(); });
      return;
    }
    const list = days.slice(0, 14);
    if (!bookableDays().length) {
      body.innerHTML = '<p class="text-sm text-muted">Fully booked for the next two weeks. Check back soon.</p>';
      return;
    }
    const info = dayInfo(book.date);
    const price = book.mode === 'trial' ? k.pricing.trial : k.pricing.single;
    const courses = info ? info.courses : [];
    const addonsList = [...(k.menu.addons || [])];
    if (info && info.special) addonsList.push({ id: 'special', name: `Special: ${info.special.name}`, price: info.special.price });
    const addonsTotal = addonsList.reduce((s, a) => s + (book.addons[a.id] || 0) * a.price, 0);
    const total = price + addonsTotal;

    body.innerHTML = `
      <p class="text-sm text-muted" style="margin:0 0 12px">${book.mode === 'trial' ? `Try one meal for ${money(k.pricing.trial)} before you subscribe. One trial per kitchen.` : 'One home-cooked meal, delivered fresh.'}</p>
      <div class="field">
        <span class="field-label" id="dateLbl">Day</span>
        <div class="chip-scroll" role="radiogroup" aria-labelledby="dateLbl">
          ${list.map(d => {
            const ok = d.slots.lunch.bookable || d.slots.dinner.bookable;
            return `<button type="button" role="radio" aria-checked="${book.date === d.date}" class="chip${book.date === d.date ? ' is-active' : ''}" data-date="${d.date}" ${ok ? '' : 'disabled style="opacity:.45;cursor:not-allowed"'} title="${ok ? '' : esc(reasonFor(d))}">${dayLabel(d.date)}</button>`;
          }).join('')}
        </div>
      </div>
      <div class="field" style="margin-top:14px">
        <span class="field-label" id="slotLbl">Slot</span>
        <div class="grid grid-cols-2 gap-2" role="radiogroup" aria-labelledby="slotLbl">
          ${['lunch', 'dinner'].map(s => {
            const st = info ? info.slots[s] : null;
            const ok = st && st.bookable;
            const sub = !st || !st.offered ? 'Not offered' : st.closed ? 'Closed' : st.cutoffPassed ? 'Order closed' : st.left <= 0 ? 'Full' : st.left <= 5 ? `${st.left} left` : (s === 'lunch' ? '12:30–1:30 PM' : '7:30–8:30 PM');
            return `<label class="option-card${ok ? '' : ' is-disabled'}" style="padding:10px 12px"><input type="radio" name="bslot" value="${s}" ${book.slot === s && ok ? 'checked' : ''} ${ok ? '' : 'disabled'}><span style="font-weight:600;display:flex;gap:6px;align-items:center">${icon(s === 'lunch' ? 'sun' : 'moon', 'icon-sm')}${s === 'lunch' ? 'Lunch' : 'Dinner'}</span><span class="text-xs text-subtle">${sub}</span></label>`;
          }).join('')}
        </div>
      </div>
      ${courses.length ? `
      <div class="field" style="margin-top:14px">
        <div class="flex flex-wrap items-center justify-between gap-2" style="margin-bottom:6px"><span class="field-label" style="margin:0">Your thali</span><span id="thaliTagBox">${pickedTag(courses)}</span></div>
        <div style="display:grid;gap:10px">
          ${courses.map(c => c.options.length > 1 ? `
            <fieldset style="border:0;padding:0;margin:0">
              <legend class="text-xs text-subtle" style="margin-bottom:4px">${esc(c.label)}: pick one</legend>
              <div class="chips">${c.options.map((o, i) => `<label class="chip"><input type="radio" name="ch-${esc(c.id)}" value="${esc(o)}" ${((book.choices[c.id] || c.options[0]) === o) ? 'checked' : ''}>${esc(o)}</label>`).join('')}</div>
            </fieldset>` : `<div class="flex items-center gap-2 text-sm"><span class="text-subtle" style="width:84px">${esc(c.label)}</span><span>${esc(c.options[0])}</span></div>`).join('')}
        </div>
      </div>` : ''}
      ${addonsList.length ? `
      <details style="margin-top:14px" ${addonsTotal ? 'open' : ''}>
        <summary class="field-label" style="cursor:pointer">Add extras ${addonsTotal ? `(${money(addonsTotal)})` : ''}</summary>
        <div style="display:grid;gap:8px;margin-top:8px">
          ${addonsList.map(a => `
            <div class="flex items-center justify-between gap-2 text-sm">
              <span>${esc(a.name)} <span class="text-subtle">${money(a.price)}</span></span>
              <span class="qty" role="group" aria-label="${esc(a.name)} quantity">
                <button type="button" data-addon="${esc(a.id)}" data-d="-1" aria-label="Remove one">−</button>
                <span aria-live="polite">${book.addons[a.id] || 0}</span>
                <button type="button" data-addon="${esc(a.id)}" data-d="1" aria-label="Add one">+</button>
              </span>
            </div>`).join('')}
        </div>
      </details>` : ''}
      <div class="field" style="margin-top:14px">
        <label class="field-label" for="bookNote">Note for the chef</label>
        <input id="bookNote" class="input" maxlength="200" placeholder="e.g. less oil, ring the bell twice" value="${esc(book.note)}">
      </div>
      ${addressSection()}
      <div style="margin-top:16px">
        <div class="kv"><span>${book.mode === 'trial' ? 'Trial meal' : 'Meal'}</span><span class="num">${money(price)}</span></div>
        ${addonsTotal ? `<div class="kv"><span>Extras</span><span class="num">${money(addonsTotal)}</span></div>` : ''}
        <div class="kv"><span>Delivery</span><span class="text-success">Free</span></div>
        <div class="kv total"><span>Total</span><span class="num">${money(total)}</span></div>
      </div>
      ${ctaHtml(total, book.mode === 'trial' ? `Book trial · ${money(total)}` : `Place order · ${money(total)}`)}
      ${book.date && book.slot && pastDeadline(book.date, book.slot)
        ? `<p class="text-xs text-warning" style="margin:10px 0 0;text-align:center">${icon('lock', 'icon-xs')} <span>This meal is inside the ${k.noticeHours}-hour notice window. Once booked it can't be cancelled.</span></p>`
        : `<p class="text-xs text-subtle" style="margin:10px 0 0;text-align:center"><span>Cancel free up to ${k.noticeHours} hours before the meal.</span></p>`}`;

    body.querySelectorAll('[data-date]').forEach(b => b.addEventListener('click', () => {
      book.date = b.dataset.date;
      const d = dayInfo(book.date);
      if (!d.slots[book.slot] || !d.slots[book.slot].bookable) book.slot = d.slots.lunch.bookable ? 'lunch' : 'dinner';
      book.choices = {};
      if (!(dayInfo(book.date).special)) delete book.addons.special;
      renderBooking();
    }));
    body.querySelectorAll('[name="bslot"]').forEach(r => r.addEventListener('change', () => { book.slot = r.value; }));
    body.querySelectorAll('input[type=radio][name^="ch-"]').forEach(r => r.addEventListener('change', () => {
      book.choices[r.name.slice(3)] = r.value;
      const box = body.querySelector('#thaliTagBox');
      if (box) box.innerHTML = pickedTag(dayInfo(book.date).courses || []);
    }));
    body.querySelectorAll('[data-addon]').forEach(b => b.addEventListener('click', () => {
      const cur = book.addons[b.dataset.addon] || 0;
      book.addons[b.dataset.addon] = Math.max(0, Math.min(5, cur + Number(b.dataset.d)));
      renderBooking();
    }));
    const note = body.querySelector('#bookNote');
    note.addEventListener('input', () => { book.note = note.value; });
    wireCommon(body);
    const cta = body.querySelector('[data-cta]');
    if (cta) cta.addEventListener('click', () => placeOrder(cta, total));
  }

  function reasonFor(d) {
    const s = d.slots.lunch.offered ? d.slots.lunch : d.slots.dinner;
    if (s.closed) return s.closed;
    if (s.cutoffPassed) return 'Orders for this day have closed';
    return 'Fully booked';
  }

  function ctaHtml(total, label) {
    if (!App.user) return `<a class="btn btn-primary btn-lg btn-block" style="margin-top:12px" href="/login.html?next=${encodeURIComponent(location.pathname + location.search)}">Sign in to order</a>`;
    const bal = App.session.wallet ? App.session.wallet.available : 0;
    const short = total - bal;
    return `
      <div class="flex items-center justify-between text-sm" style="margin-top:12px"><span class="text-muted">${icon('wallet', 'icon-sm')} Wallet</span><span class="num" style="font-weight:600">${money(bal)}</span></div>
      ${short > 0 ? `<button type="button" class="btn btn-dark btn-lg btn-block" style="margin-top:10px" data-action="topup" data-need="${short}">Add ${money(short)} to wallet</button>` : `<button type="button" class="btn btn-primary btn-lg btn-block" style="margin-top:10px" data-cta>${label}</button>`}`;
  }

  function wireCommon(body) {
    const sel = body.querySelector('#bookAddr');
    if (sel) sel.addEventListener('change', () => { book.addressId = Number(sel.value); });
  }

  // ---------- Plans ----------
  function planDatesPreview(start, plan) {
    const out = [];
    let d = start;
    let guard = 0;
    while (out.length < (plan === '5day' ? 22 : 30) && guard < 120) {
      const wd = new Date(d + 'T00:00:00Z').getUTCDay();
      const key = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][wd];
      const weekend = plan === '5day' && (wd === 0 || wd === 6);
      if (!weekend && !(k.offDays || []).includes(key) && !(k.holidays || []).some(h => h.date === d)) out.push(d);
      d = addDays(d, 1);
      guard++;
    }
    return out;
  }

  function renderPlan(body) {
    const slots = book.planSlot === 'both' ? 2 : 1;
    const unit = book.plan === '5day' ? k.pricing.plan5 : k.pricing.plan7;
    const total = unit * slots;
    const dates = book.start ? planDatesPreview(book.start, book.plan) : [];
    const firstDay = bookableDays()[0];
    body.innerHTML = `
      <p class="text-sm text-muted" style="margin:0 0 12px">Fresh food every day.</p>
      ${policyHtml()}
      <div class="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Plan">
        ${[['5day', 'Mon–Fri', 22, k.pricing.plan5], ['7day', 'Every day', 30, k.pricing.plan7]].map(([p, l, n, price]) => `
          <label class="option-card" style="padding:12px">
            <input type="radio" name="bplan" value="${p}" ${book.plan === p ? 'checked' : ''}>
            <span style="font-weight:700;display:block">${p === '5day' ? '5-day' : '7-day'} plan</span>
            <span class="text-xs text-subtle" style="display:block">${l} · ${n} meals</span>
            <span style="display:block;margin-top:6px;font-weight:700" class="num">${money(price)}</span>
            <span class="text-xs text-success">${money(Math.round(price / n))}/meal</span>
          </label>`).join('')}
      </div>
      <div class="field" style="margin-top:14px">
        <span class="field-label" id="pslotLbl">Meals</span>
        <div class="segmented" role="radiogroup" aria-labelledby="pslotLbl">
          ${['lunch', 'dinner', 'both'].filter(s => s === 'both' ? k.slots.length === 2 : k.slots.includes(s)).map(s => `<button type="button" role="radio" aria-checked="${book.planSlot === s}" aria-pressed="${book.planSlot === s}" data-pslot="${s}">${s === 'both' ? 'Lunch + dinner' : s[0].toUpperCase() + s.slice(1)}</button>`).join('')}
        </div>
      </div>
      <div class="field" style="margin-top:14px">
        <label class="field-label" for="planStart">Start from</label>
        <input id="planStart" type="date" class="input" value="${book.start || ''}" min="${firstDay ? firstDay.date : App.session.today}">
        ${dates.length ? `<p class="field-hint">${dates.length} days: ${UI.date(dates[0])} to ${UI.date(dates[dates.length - 1])}${(k.offDays || []).length ? ` · closed ${k.offDays.map(d => d.slice(0, 3)).join(', ')}` : ''}</p>` : ''}
      </div>
      ${addressSection()}
      <label class="switch" style="margin-top:14px"><input type="checkbox" id="autoRenew" ${book.autoRenew ? 'checked' : ''}><span class="track"></span><span class="text-sm">Renew automatically from wallet</span></label>
      <div style="margin-top:16px">
        <div class="kv"><span>${book.plan === '5day' ? '5-day' : '7-day'} plan${slots === 2 ? ' × 2 meals a day' : ''}</span><span class="num">${money(total)}</span></div>
        <div class="kv"><span>Delivery</span><span class="text-success">Free</span></div>
        <div class="kv total"><span>Total</span><span class="num">${money(total)}</span></div>
      </div>
      ${ctaHtml(total, `Start plan · ${money(total)}`)}
      <p class="text-xs text-subtle" style="margin:10px 0 0;text-align:center">Cancel anytime. Unused meals are refunded to your wallet.</p>`;

    body.querySelectorAll('[name="bplan"]').forEach(r => r.addEventListener('change', () => { book.plan = r.value; renderBooking(); }));
    body.querySelectorAll('[data-pslot]').forEach(b => b.addEventListener('click', () => { book.planSlot = b.dataset.pslot; renderBooking(); }));
    const start = body.querySelector('#planStart');
    start.addEventListener('change', () => { book.start = start.value; renderBooking(); });
    body.querySelector('#autoRenew').addEventListener('change', e => { book.autoRenew = e.target.checked; });
    wireCommon(body);
    const cta = body.querySelector('[data-cta]');
    if (cta) cta.addEventListener('click', () => startPlan(cta, total));
  }

  // ---------- Actions ----------
  async function needAddress() {
    if (book.addressId) return true;
    const a = await AddressBook.ensure();
    if (!a) return false;
    book.addressId = a.id;
    return true;
  }

  async function placeOrder(btn, total) {
    if (!book.date || !book.slot) { UI.toast('Pick a day and slot first.', { type: 'error' }); return; }
    if (!(await needAddress())) return;
    const info = dayInfo(book.date);
    const choices = {};
    (info.courses || []).forEach(c => { choices[c.id] = book.choices[c.id] || c.options[0]; });
    const addons = Object.entries(book.addons).filter(([, q]) => q > 0).map(([aid, qty]) => ({ id: aid, qty }));
    await UI.busy(btn, async () => {
      try {
        const res = await API.post('/api/orders', { kitchenId: k.id, type: book.mode === 'trial' ? 'trial' : 'single', date: book.date, slot: book.slot, choices, addons, note: book.note, addressId: book.addressId });
        App.setWallet(res.balances);
        location.href = `/orders.html?id=${res.order.id}&placed=1`;
      } catch (e) {
        handleBookingError(e);
      }
    });
  }

  // When a meal's change window closes: slot start minus the kitchen's notice period (IST).
  function pastDeadline(date, slot) {
    const t = (k.slotTimes || {})[slot] || (slot === 'lunch' ? '12:30' : '19:30');
    return Date.parse(`${date}T${t}:00+05:30`) - (k.noticeHours || 24) * 3600e3 < Date.now();
  }

  function policyHtml() {
    const lim = k.skipLimits || { plan5: 4, plan7: 6 };
    return `<div class="panel text-sm" style="margin:0 0 14px">
        <strong style="display:block;margin-bottom:6px">${icon('info', 'icon-xs')} How changes work</strong>
        <ul style="margin:0;padding-left:18px;display:grid;gap:4px">
          <li>Skip, change or cancel a meal up to ${k.noticeHours || 24} hours before it.</li>
          <li>A skipped meal becomes a make-up day at the end of your plan. Up to ${lim.plan5} on a 22-meal plan, ${lim.plan7} on a 30-meal plan.</li>
          <li>Away for more than a week? Freeze the plan once a month.</li>
          <li>Cancel the plan anytime. Unused meals and make-up days are refunded to your wallet.</li>
        </ul>
      </div>`;
  }

  async function startPlan(btn) {
    if (!book.start) { UI.toast('Choose a start date.', { type: 'error' }); return; }
    let seen = false;
    try { seen = localStorage.getItem('rasoi_policy_ok') === '1'; } catch (e) { /* storage blocked */ }
    if (!seen) {
      const yes = await UI.confirm({ title: 'Before you start', body: `Changes need ${k.noticeHours || 24} hours' notice. Skipped meals move to the end of your plan as make-up days. Late changes and missed deliveries are still charged.`, confirmText: 'Got it, continue', cancelText: 'Go back' });
      if (!yes) return;
      try { localStorage.setItem('rasoi_policy_ok', '1'); } catch (e) { /* storage blocked */ }
    }
    if (!(await needAddress())) return;
    await UI.busy(btn, async () => {
      try {
        const res = await API.post('/api/subscriptions', { kitchenId: k.id, plan: book.plan, slot: book.planSlot, startDate: book.start, addressId: book.addressId, autoRenew: book.autoRenew });
        App.setWallet(res.balances);
        location.href = `/calendar.html?started=${res.subscription.id}`;
      } catch (e) {
        handleBookingError(e);
      }
    });
  }

  async function handleBookingError(e) {
    if (e.code === 'LOW_BALANCE') {
      // Balance changed in another tab: refresh it and offer a top-up
      await App.refreshSession();
      UI.error(e);
      renderBooking();
      return;
    }
    if (e.code === 'NO_ADDRESS' || e.code === 'NO_COORDS') { AddressBook.openEditor(); return; }
    UI.error(e, 'Couldn\'t book');
    if (['FULL', 'CUTOFF_PASSED', 'CLOSED'].includes(e.code)) {
      const av = await API.get(`/api/kitchens/${id}/availability?days=14`).catch(() => null);
      if (av) { days = av.days; initBookingDates(); renderBooking(); }
    }
  }

  function initBookingDates() {
    const first = bookableDays()[0];
    if (!dayInfo(book.date) || !(dayInfo(book.date).slots[book.slot] || {}).bookable) {
      book.date = first ? first.date : null;
      book.slot = first ? (first.slots.lunch.bookable ? 'lunch' : 'dinner') : null;
    }
  }

  UI.on('topup', async btn => {
    const bal = await Wallet.openTopUp(Number(btn.dataset.need));
    if (bal) renderBooking();
  });
  UI.on('add-address', async () => {
    const user = await AddressBook.openEditor();
    if (user) {
      book.addressId = user.defaultAddressId;
      const kr = await API.get(`/api/kitchens/${id}`);
      k = kr.kitchen;
      render();
    }
  });
  UI.on('change-address', () => App.openLocationPicker());
  UI.on('photo', btn => {
    const main = root.querySelector('.kcard-img img');
    if (main) main.src = btn.dataset.src;
  });
  UI.on('fav', async btn => {
    try {
      const res = await API.post(`/api/me/favourites/${k.id}`);
      k.isFavourite = res.favourite;
      App.session.user.favourites = res.favourites;
      btn.setAttribute('aria-pressed', String(res.favourite));
      btn.setAttribute('aria-label', res.favourite ? 'Remove from favourites' : 'Save to favourites');
      UI.toast(res.favourite ? 'Saved to favourites' : 'Removed from favourites');
    } catch (e) { UI.error(e); }
  });
  App.on('origin', async () => {
    const kr = await API.get(`/api/kitchens/${id}`);
    k = kr.kitchen;
    initBooking();
    render();
  });

  load();
})();
