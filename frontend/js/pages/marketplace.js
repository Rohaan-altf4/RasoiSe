// Marketplace: kitchens near the customer with filters, sorting, search and a list/map view.

(async function () {
  const { esc, icon, money } = UI;
  const grid = document.getElementById('kitchenGrid');
  const state = { kitchens: [], filters: new Set(), sort: 'distance', q: '', cuisine: '', showOutside: false, view: 'list' };

  grid.innerHTML = UI.skeletonCards(6);
  await App.init({ active: 'home', search: true });
  const isCustomer = App.role === 'customer';
  if (isCustomer) document.getElementById('favFilter').hidden = false;

  // Map view only when maps are available on this page
  const viewMapBtn = document.getElementById('viewMap');
  const viewListBtn = document.getElementById('viewList');
  if (!window.Maps) viewMapBtn.parentElement.hidden = true;

  async function load() {
    grid.setAttribute('aria-busy', 'true');
    grid.innerHTML = UI.skeletonCards(6);
    const o = App.origin();
    const qs = o && App.role !== 'customer' ? `?lat=${o.lat}&lng=${o.lng}` : '';
    try {
      const res = await API.get('/api/kitchens' + qs);
      state.kitchens = res.kitchens;
      render();
    } catch (e) {
      grid.innerHTML = UI.errorState(e.message, '<button class="btn btn-secondary" data-action="retry">Try again</button>');
      UI.icons(grid);
    } finally {
      grid.setAttribute('aria-busy', 'false');
    }
    renderBanner();
    renderReorder();
  }

  function renderBanner() {
    const host = document.getElementById('locationBanner');
    if (App.origin()) { host.innerHTML = ''; return; }
    host.innerHTML = `
      <div class="alert alert-info" style="margin-bottom:var(--s5)">
        ${icon('map-pin')}
        <div><div class="a-title">Set your delivery location</div><div>We'll show how far each kitchen is and who delivers to you.</div></div>
        <button type="button" class="btn btn-primary btn-sm" data-action="set-location">Set location</button>
      </div>`;
    UI.icons(host);
  }

  // "Order again" row from recently delivered meals (customers only)
  async function renderReorder() {
    const host = document.getElementById('reorderRow');
    if (!isCustomer) return;
    try {
      const res = await API.get('/api/orders?scope=past');
      const seen = new Set();
      const recent = res.orders.filter(o => o.status === 'delivered' && o.kitchen && !seen.has(o.kitchenId) && seen.add(o.kitchenId)).slice(0, 4);
      if (!recent.length) { host.innerHTML = ''; return; }
      host.innerHTML = `
        <section style="margin-bottom:var(--s6)" aria-labelledby="reorderTitle">
          <h2 class="title" id="reorderTitle" style="margin-bottom:10px">Order again</h2>
          <div class="chip-scroll" style="gap:12px">
            ${recent.map(o => `
              <a class="card card-link flex items-center gap-3" style="padding:10px 12px;min-width:260px;text-decoration:none" href="/kitchen.html?id=${o.kitchenId}&reorder=${o.id}">
                ${UI.img(o.kitchen.coverUrl, '', '')}
                <span style="min-width:0;flex:1">
                  <span class="truncate" style="display:block;font-weight:600">${esc(o.kitchen.name)}</span>
                  <span class="text-xs text-subtle truncate" style="display:block">${esc(Object.values(o.choices || {}).slice(0, 2).join(', '))}</span>
                </span>
                <span class="btn btn-secondary btn-sm">${icon('rotate-ccw')}Reorder</span>
              </a>`).join('')}
          </div>
        </section>`;
      host.querySelectorAll('img').forEach(img => { img.style.cssText = 'width:48px;height:48px;border-radius:10px;object-fit:cover;flex-shrink:0'; });
      UI.icons(host);
    } catch (e) { host.innerHTML = ''; }
  }

  function filtered() {
    const q = state.q.toLowerCase();
    let list = state.kitchens.filter(k => {
      if (q) {
        const hay = [k.name, k.chefName, k.bio, (k.cuisines || []).join(' '), (k.todaysMenu || []).join(' '), k.location.locality].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (state.cuisine && !(k.cuisines || []).includes(state.cuisine)) return false;
      if (state.filters.has('walk') && !(k.distance != null && k.distance <= 1000)) return false;
      if (state.filters.has('veg') && k.dietType !== 'veg') return false;
      if (state.filters.has('today') && !(k.nextOpening && k.nextOpening.date === App.session.today)) return false;
      if (state.filters.has('dinner') && !k.slots.includes('dinner')) return false;
      if (state.filters.has('favourites') && !((App.user && App.user.favourites) || []).includes(k.id)) return false;
      return true;
    });
    const outside = list.filter(k => k.deliversToYou === false);
    if (!state.showOutside) list = list.filter(k => k.deliversToYou !== false);
    const by = {
      distance: (a, b) => (a.distance ?? 1e9) - (b.distance ?? 1e9),
      rating: (a, b) => (b.stats.rating ?? 0) - (a.stats.rating ?? 0) || (b.stats.reviewsCount - a.stats.reviewsCount),
      price: (a, b) => a.pricing.single - b.pricing.single
    }[state.sort];
    list.sort(by);
    return { list, outsideCount: outside.length };
  }

  function availability(k) {
    if (k.paused) return '<span class="chip-on-img">' + icon('circle-pause', 'icon-xs') + 'Not taking orders</span>';
    if (!k.nextOpening) return '<span class="chip-on-img">' + icon('circle-x', 'icon-xs') + 'Fully booked</span>';
    if (k.nextOpening.date !== App.session.today) return `<span class="chip-on-img">${icon('clock', 'icon-xs')}Next: ${k.nextOpening.date === addDays(App.session.today, 1) ? 'tomorrow' : UI.date(k.nextOpening.date, { weekday: 'short' })} ${k.nextOpening.slot}</span>`;
    return '';
  }

  function addDays(d, n) {
    const x = new Date(d + 'T00:00:00Z');
    x.setUTCDate(x.getUTCDate() + n);
    return x.toISOString().slice(0, 10);
  }

  function card(k) {
    const fav = ((App.user && App.user.favourites) || []).includes(k.id);
    const dist = k.distance != null ? `<span class="chip-on-img">${icon('footprints', 'icon-xs')}${UI.distance(k.distance)} · ${k.walkMinutes} min</span>` : '';
    const unavailable = k.paused || !k.nextOpening;
    return `
      <article class="kcard${unavailable ? ' is-unavailable' : ''}">
        ${isCustomer ? `<button type="button" class="fav-btn${fav ? ' is-on' : ''}" data-action="fav" data-id="${k.id}" aria-pressed="${fav}" aria-label="${fav ? 'Remove from' : 'Add to'} favourites">${icon('heart', 'icon-sm')}</button>` : ''}
        <a href="/kitchen.html?id=${k.id}" style="text-decoration:none;color:inherit">
          <div class="kcard-img">
            ${UI.img(k.coverUrl || (k.gallery || [])[0], `Food from ${k.name}`)}
            <div class="overlay-badges">${dist}${availability(k)}</div>
          </div>
          <div class="kcard-body">
            <div class="kcard-title"><h3 class="truncate">${esc(k.name)}</h3>${UI.ratingPill(k.stats.rating)}</div>
            <div class="kcard-meta flex items-center gap-2">
              ${UI.foodMark(k.dietType === 'veg' ? 'veg' : 'nonveg')}
              <span class="truncate">${esc([(k.cuisines || []).slice(0, 2).join(', ') || 'Home-style', k.location.locality].filter(Boolean).join(' · '))}</span>
            </div>
            ${k.todaysMenu.length ? `<div class="kcard-menu truncate">Today: ${esc(k.todaysMenu.slice(0, 3).join(', '))}</div>` : ''}
            <div class="flex items-center justify-between" style="margin-top:8px">
              <span class="text-sm"><strong>${money(k.pricing.single)}</strong><span class="text-subtle"> /meal · trial ${money(k.pricing.trial)}</span></span>
              ${k.deliversToYou === false ? '<span class="badge badge-warning">Outside delivery area</span>' : ''}
            </div>
          </div>
        </a>
      </article>`;
  }

  function render() {
    const { list, outsideCount } = filtered();
    const title = document.getElementById('resultsTitle');
    const o = App.origin();
    title.textContent = `${list.length} kitchen${list.length === 1 ? '' : 's'} ${o ? `delivering to ${o.label}` : 'in Andheri West'}`;
    if (!list.length) {
      const hasFilters = state.filters.size || state.q || state.cuisine;
      grid.innerHTML = `<div style="grid-column:1/-1">${UI.empty({
        icon: 'search-x',
        title: hasFilters ? 'No kitchens match' : 'No kitchens deliver here yet',
        body: hasFilters ? 'Try removing a filter or searching for something else.' : 'We\'re growing street by street. Try another saved address.',
        action: hasFilters ? '<button class="btn btn-secondary" data-action="clear-filters">Clear filters</button>' : '<button class="btn btn-secondary" data-action="set-location">Change location</button>'
      })}</div>`;
    } else {
      grid.innerHTML = list.map(card).join('');
    }
    const note = document.getElementById('hiddenNote');
    note.innerHTML = outsideCount && !state.showOutside
      ? `<p class="text-sm text-muted" style="margin-top:var(--s5);text-align:center">${outsideCount} more kitchen${outsideCount > 1 ? 's' : ''} nearby ${outsideCount > 1 ? "don't" : "doesn't"} deliver to this address. <button class="link" data-action="show-outside">Show anyway</button></p>`
      : (state.showOutside && outsideCount ? `<p class="text-sm text-muted" style="margin-top:var(--s5);text-align:center"><button class="link" data-action="show-outside">Hide kitchens outside your area</button></p>` : '');
    UI.icons(grid);
    UI.icons(note);
    renderCuisines();
    renderToday(list);
    if (state.view === 'map' && window.Maps) Maps.renderMarketplace(document.getElementById('marketMap'), list, App.origin());
  }

  // ---------- Cuisine shortcuts ----------
  // One tile per cuisine the kitchens cook, pictured with the best-rated kitchen's photo.
  function renderCuisines() {
    const host = document.getElementById('cuisineRow');
    const byCuisine = new Map();
    state.kitchens.filter(k => k.deliversToYou !== false || state.showOutside).forEach(k => (k.cuisines || []).forEach(c => {
      if (!byCuisine.has(c)) byCuisine.set(c, []);
      byCuisine.get(c).push(k);
    }));
    if (byCuisine.size < 2) { host.hidden = true; return; }
    host.hidden = false;
    const used = new Set(); // give each tile a different photo where the kitchens have one
    document.getElementById('cuisineList').innerHTML = [...byCuisine.entries()]
      .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
      .map(([c, ks]) => {
        const photos = ks.slice()
          .sort((a, b) => (b.stats.rating || 0) - (a.stats.rating || 0))
          .flatMap(k => [k.coverUrl, ...(k.gallery || [])])
          .filter(Boolean);
        const photo = photos.find(p => !used.has(p)) || photos[0];
        used.add(photo);
        return `<button type="button" class="cuisine-tile" data-cuisine="${esc(c)}" aria-pressed="${state.cuisine === c}">
          <span class="ct-img">${UI.img(photo, '')}</span>
          <span>${esc(c)}<span class="ct-count" style="display:block">${ks.length} kitchen${ks.length > 1 ? 's' : ''}</span></span>
        </button>`;
      }).join('');
  }

  document.getElementById('cuisineList').addEventListener('click', e => {
    const b = e.target.closest('[data-cuisine]');
    if (!b) return;
    state.cuisine = state.cuisine === b.dataset.cuisine ? '' : b.dataset.cuisine;
    render();
  });

  // ---------- What's cooking today ----------
  // Today's main dish (or special) from each kitchen in the current results.
  function renderToday(list) {
    const host = document.getElementById('todayRow');
    const cooking = list.filter(k => !k.paused && k.todaysMenu.length);
    if (!cooking.length || state.view === 'map') { host.hidden = true; return; }
    host.hidden = false;
    const openToday = k => k.nextOpening && k.nextOpening.date === App.session.today;
    document.getElementById('todayNote').textContent = cooking.some(openToday) ? '' : 'Orders for today have closed. Book for tomorrow.';
    document.getElementById('todayList').innerHTML = cooking.map(k => {
      const main = k.todaysSpecial ? k.todaysSpecial.name : k.todaysMenu[0];
      const rest = k.todaysMenu.slice(k.todaysSpecial ? 0 : 1, 3).join(' · ');
      return `<a class="dish-card" href="/kitchen.html?id=${k.id}">
        <div class="dc-img">${UI.img(k.coverUrl, main)}${k.todaysSpecial ? `<span class="chip-on-img">${icon('sparkles', 'icon-xs')}Special ${money(k.todaysSpecial.price)}</span>` : ''}</div>
        <div class="dc-body">
          <div class="dc-title flex items-center gap-2">${UI.foodMark(k.dietType === 'veg' ? 'veg' : 'nonveg')}<span class="truncate">${esc(main)}</span></div>
          <div class="dc-sub truncate">${esc(rest)}</div>
          <div class="dc-sub truncate" style="margin-top:6px;color:var(--ink-2)">${esc(k.name)} · ${money(k.pricing.single)}</div>
        </div>
      </a>`;
    }).join('');
    UI.icons(host);
  }

  // ---------- Events ----------
  document.querySelectorAll('[data-filter]').forEach(btn => btn.addEventListener('click', () => {
    const f = btn.dataset.filter;
    if (state.filters.has(f)) state.filters.delete(f); else state.filters.add(f);
    btn.classList.toggle('is-active', state.filters.has(f));
    btn.setAttribute('aria-pressed', String(state.filters.has(f)));
    if (f === 'walk' && !App.origin()) { UI.toast('Set your location to see walking distances.', { type: 'info' }); App.openLocationPicker(); }
    render();
  }));
  document.getElementById('sortSelect').addEventListener('change', e => {
    state.sort = e.target.value;
    if (state.sort === 'distance' && !App.origin()) App.openLocationPicker();
    render();
  });
  const mobileSearch = document.getElementById('mobileSearch');
  mobileSearch.addEventListener('input', () => { state.q = mobileSearch.value.trim(); render(); });
  App.on('search', q => { state.q = q; render(); });
  App.on('origin', load);

  viewListBtn.addEventListener('click', () => setView('list'));
  viewMapBtn.addEventListener('click', () => setView('map'));
  function setView(v) {
    state.view = v;
    viewListBtn.setAttribute('aria-pressed', String(v === 'list'));
    viewMapBtn.setAttribute('aria-pressed', String(v === 'map'));
    document.getElementById('mapView').hidden = v !== 'map';
    grid.hidden = v === 'map';
    render();
  }

  UI.on('retry', load);
  UI.on('set-location', () => App.openLocationPicker());
  UI.on('show-outside', () => { state.showOutside = !state.showOutside; render(); });
  UI.on('clear-filters', () => {
    state.filters.clear();
    state.cuisine = '';
    state.q = '';
    mobileSearch.value = '';
    const hs = document.getElementById('headerSearch');
    if (hs) hs.value = '';
    document.querySelectorAll('[data-filter]').forEach(b => { b.classList.remove('is-active'); b.setAttribute('aria-pressed', 'false'); });
    render();
  });
  UI.on('fav', async btn => {
    const id = Number(btn.dataset.id);
    try {
      const res = await API.post(`/api/me/favourites/${id}`);
      App.session.user.favourites = res.favourites;
      btn.classList.toggle('is-on', res.favourite);
      btn.setAttribute('aria-pressed', String(res.favourite));
      btn.setAttribute('aria-label', `${res.favourite ? 'Remove from' : 'Add to'} favourites`);
      UI.toast(res.favourite ? 'Added to favourites' : 'Removed from favourites');
      if (state.filters.has('favourites')) render();
    } catch (e) { UI.error(e); }
  });

  if (window.Live) Live.on('kitchens', load);
  load();

  // Fresh sign-up: ask for the delivery address straight away
  if (UI.qs('welcome') && isCustomer && !App.origin()) {
    UI.toast(`Welcome, ${App.user.name.split(' ')[0]}! Add your address to see who delivers to you.`, { type: 'info' });
    AddressBook.openEditor();
  }
})();
