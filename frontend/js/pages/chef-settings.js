// Chef settings: menu builder (weekly courses with choices, dish library, add-ons, specials),
// profile & photos, prices & capacity, delivery area, days off, payouts.

(async function () {
  const { esc, icon, money } = UI;
  await App.init({ active: 'chef-settings', requireRole: ['chef'] });

  const root = document.getElementById('settingsRoot');
  const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const CUISINES = ['North Indian', 'Gujarati', 'Punjabi', 'Maharashtrian', 'South Indian', 'Bengali', 'Rajasthani', 'Sindhi', 'Jain', 'Healthy', 'Parsi', 'Konkani'];
  let k = null;
  let menu = null;      // working copy for the builder
  let menuDirty = false;
  let menuDay = 'monday';

  async function load() {
    try {
      const res = await API.get('/api/chef/kitchen');
      k = res.kitchen;
      if (!menuDirty) menu = JSON.parse(JSON.stringify(k.menu));
      document.getElementById('previewLink').href = `/kitchen.html?id=${k.id}`;
      showTab();
    } catch (e) {
      root.innerHTML = UI.errorState(e.message);
      UI.icons(root);
    } finally {
      root.setAttribute('aria-busy', 'false');
    }
  }

  function currentTab() { return (location.hash.replace('#', '') || 'menu').split('/')[0]; }

  function showTab() {
    const t = currentTab();
    document.querySelectorAll('[data-tab]').forEach(a => a.setAttribute('aria-selected', String(a.dataset.tab === t)));
    ({ menu: renderMenu, profile: renderProfile, pricing: renderPricing, delivery: renderDelivery, holidays: renderHolidays, payouts: renderPayouts }[t] || renderMenu)();
    UI.icons(root);
  }
  window.addEventListener('hashchange', () => {
    if (menuDirty && currentTab() !== 'menu') UI.toast('You have unsaved menu changes. Go back to Menu to save them.', { type: 'info' });
    showTab();
  });
  window.addEventListener('beforeunload', e => { if (menuDirty) { e.preventDefault(); e.returnValue = ''; } });

  async function saveKitchen(body, btn, msg = 'Saved') {
    return UI.busy(btn, async () => {
      try {
        const res = await API.put('/api/chef/kitchen', body);
        k = res.kitchen;
        UI.toast(msg);
        return true;
      } catch (err) { UI.error(err); return false; }
    });
  }

  async function uploadPhoto(file) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Photos must be JPG, PNG or WebP.');
    if (file.size > 5 * 1024 * 1024) throw new Error('Photos must be under 5 MB.');
    const fd = new FormData();
    fd.append('photo', file);
    return (await API.upload('/api/chef/upload', fd)).url;
  }

  // ======================= MENU =======================
  function renderMenu() {
    const day = menu.weekly[menuDay] || { courses: [] };
    const dishNames = menu.dishes.map(d => d.name);
    root.innerHTML = `
      <div class="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-5">
        <section class="card card-pad" aria-labelledby="weekTitle" style="min-width:0">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h2 class="h3" id="weekTitle">Weekly menu</h2>
            <div class="flex items-center gap-2">
              <label class="sr-only" for="presetSel">Load a ready-made menu</label>
              <select id="presetSel" class="select" style="min-height:36px;width:auto"><option value="">Load a ready menu…</option>${Object.entries(MenuPresets).map(([key, p]) => `<option value="${key}">${esc(p.label)}</option>`).join('')}</select>
            </div>
          </div>
          <p class="text-sm text-muted" style="margin:6px 0 12px">Add up to 3 options to any item and customers choose one before ${UI.time12(k.cutoffTime)}.</p>
          <div class="tabs" role="tablist" aria-label="Day">${DAYS.map(d => `<button type="button" role="tab" class="tab" data-mday="${d}" aria-selected="${d === menuDay}">${d.slice(0, 3)[0].toUpperCase() + d.slice(1, 3)}${(k.offDays || []).includes(d) ? ' <span class="count">off</span>' : ''}</button>`).join('')}</div>
          <datalist id="dishList">${dishNames.map(n => `<option value="${esc(n)}">`).join('')}</datalist>
          <div id="courseList" style="display:grid;gap:12px;margin-top:14px">
            ${day.courses.length ? day.courses.map((c, i) => `
              <div class="panel" data-ci="${i}">
                <div class="flex gap-2 items-center">
                  <label class="sr-only" for="cl-${i}">Item name</label>
                  <input id="cl-${i}" class="input" data-clabel value="${esc(c.label)}" placeholder="e.g. Sabzi" style="max-width:180px;min-height:38px;font-weight:600" maxlength="30">
                  <span class="text-xs text-subtle" style="flex:1">${c.options.length > 1 ? 'Customer picks one' : ''}</span>
                  <button type="button" class="btn btn-ghost btn-icon btn-sm" data-cdel aria-label="Remove ${esc(c.label)}">${icon('trash-2')}</button>
                </div>
                <div style="display:grid;gap:6px;margin-top:8px">
                  ${[0, 1, 2].map(j => (j < c.options.length || j === c.options.length) && j < 3 ? `
                    <div class="flex items-center gap-2">
                      <span class="text-xs text-subtle" style="width:44px">${j === 0 ? 'Dish' : 'or'}</span>
                      <label class="sr-only" for="co-${i}-${j}">${j === 0 ? 'Dish' : 'Alternative dish'}</label>
                      <input id="co-${i}-${j}" class="input" data-copt="${j}" list="dishList" value="${esc(c.options[j] || '')}" placeholder="${j === 0 ? 'e.g. Paneer bhurji' : 'Add a choice (optional)'}" maxlength="60" style="min-height:38px">
                    </div>` : '').join('')}
                </div>
              </div>`).join('') : '<p class="text-sm text-muted">Nothing on this day yet. Add items or load a ready menu.</p>'}
          </div>
          <div class="flex flex-wrap gap-2" style="margin-top:12px">
            <button type="button" class="btn btn-secondary btn-sm" id="addCourse">${icon('plus')}Add item</button>
            <button type="button" class="btn btn-ghost btn-sm" id="copyDay">${icon('copy')}Copy ${menuDay[0].toUpperCase() + menuDay.slice(1, 3)} to other days</button>
          </div>
        </section>

        <div style="display:grid;gap:var(--s5);align-content:start;min-width:0">
          <section class="card card-pad" aria-labelledby="specTitle">
            <h2 class="title" id="specTitle">Specials</h2>
            <p class="text-xs text-subtle" style="margin:4px 0 10px">A dish for one day that customers can add as an extra.</p>
            <div style="display:grid;gap:8px">${menu.specials.map((s, i) => `
              <div class="panel text-sm flex items-start justify-between gap-2"><span><strong>${esc(s.name)}</strong> · ${money(s.price)}<span class="text-xs text-subtle" style="display:block">${UI.date(s.date)}${s.description ? ' · ' + esc(s.description) : ''}</span></span><button type="button" class="btn btn-ghost btn-icon btn-sm" data-sdel="${i}" aria-label="Remove special">${icon('x')}</button></div>`).join('') || '<p class="text-sm text-muted" style="margin:0">No specials planned.</p>'}</div>
            <details style="margin-top:10px"><summary class="link text-sm">Add a special</summary>
              <div style="display:grid;gap:8px;margin-top:8px">
                <input class="input" id="spDate" type="date" min="${App.session.today}" value="${App.session.today}" aria-label="Date">
                <input class="input" id="spName" placeholder="e.g. Puran poli" maxlength="60" aria-label="Dish name">
                <div class="input-group"><span class="prefix">₹</span><input class="input num" id="spPrice" inputmode="numeric" placeholder="Price" style="padding-left:30px" aria-label="Price"></div>
                <input class="input" id="spDesc" placeholder="Short description (optional)" maxlength="160" aria-label="Description">
                <button type="button" class="btn btn-secondary btn-sm" id="addSpecial">Add special</button>
              </div>
            </details>
          </section>

          <section class="card card-pad" aria-labelledby="addTitle">
            <h2 class="title" id="addTitle">Paid extras</h2>
            <div style="display:grid;gap:8px;margin-top:10px" id="addonList">
              ${menu.addons.map((a, i) => `
                <div class="flex gap-2 items-center" data-ai="${i}">
                  <input class="input" data-aname value="${esc(a.name)}" maxlength="50" style="min-height:38px" aria-label="Extra name">
                  <div class="input-group" style="width:96px;flex-shrink:0"><span class="prefix">₹</span><input class="input num" data-aprice value="${a.price}" inputmode="numeric" style="padding-left:26px;min-height:38px" aria-label="Price"></div>
                  <button type="button" class="btn btn-ghost btn-icon btn-sm" data-adel aria-label="Remove extra">${icon('x')}</button>
                </div>`).join('')}
            </div>
            <button type="button" class="btn btn-ghost btn-sm" id="addAddon" style="margin-top:8px">${icon('plus')}Add extra</button>
          </section>
        </div>
      </div>

      <section class="card card-pad" style="margin-top:var(--s5)" aria-labelledby="dishTitle">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div><h2 class="h3" id="dishTitle">Dish details</h2><p class="text-sm text-muted" style="margin:4px 0 0">Tag dishes once and the tags show wherever they appear on your menu.</p></div>
          <button type="button" class="btn btn-secondary btn-sm" id="addDish">${icon('plus')}Add dish</button>
        </div>
        <div style="display:grid;gap:10px;margin-top:12px" id="dishList2">
          ${menu.dishes.length ? menu.dishes.map((d, i) => `
            <div class="panel" data-di="${i}">
              <div class="grid grid-cols-1 sm:grid-cols-[72px_minmax(0,1fr)] gap-3">
                <label style="cursor:pointer" title="Change photo">
                  ${UI.img(d.photo, d.name)}
                  <input type="file" accept="image/jpeg,image/png,image/webp" class="sr-only" data-dphoto aria-label="Photo for ${esc(d.name)}">
                </label>
                <div style="display:grid;gap:8px;min-width:0">
                  <div class="flex gap-2">
                    <input class="input" data-dname value="${esc(d.name)}" maxlength="60" style="min-height:38px;font-weight:600" aria-label="Dish name">
                    <button type="button" class="btn btn-ghost btn-icon btn-sm" data-ddel aria-label="Remove dish">${icon('trash-2')}</button>
                  </div>
                  <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    <select class="select" data-dtype style="min-height:38px" aria-label="Type" ${k.dietType === 'veg' ? 'disabled' : ''}>
                      ${[['veg', 'Veg'], ['egg', 'Egg'], ['nonveg', 'Non-veg']].map(([v, l]) => `<option value="${v}" ${d.type === v ? 'selected' : ''}>${l}</option>`).join('')}
                    </select>
                    <select class="select" data-dspice style="min-height:38px" aria-label="Spice">
                      ${['mild', 'medium', 'spicy'].map(v => `<option value="${v}" ${d.spice === v ? 'selected' : ''}>${v[0].toUpperCase() + v.slice(1)}</option>`).join('')}
                    </select>
                    <input class="input" data-dallergens value="${esc((d.allergens || []).join(', '))}" placeholder="Allergens e.g. nuts, dairy" style="min-height:38px" aria-label="Allergens">
                  </div>
                </div>
              </div>
            </div>`).join('') : '<p class="text-sm text-muted" style="margin:0">No dishes tagged yet. Add the dishes you cook often, especially anything spicy, non-veg or with nuts.</p>'}
        </div>
      </section>

      <div class="card card-pad flex flex-wrap items-center justify-between gap-3" style="margin-top:var(--s5);position:sticky;bottom:12px;box-shadow:var(--shadow-md)">
        <span class="text-sm ${menuDirty ? 'text-warning' : 'text-muted'}">${menuDirty ? `${icon('circle-dot', 'icon-xs')} Unsaved changes` : 'Customers with upcoming meals are notified when you save changes to the weekly menu.'}</span>
        <div class="flex gap-2">
          ${menuDirty ? '<button type="button" class="btn btn-ghost" id="discardMenu">Discard</button>' : ''}
          <button type="button" class="btn btn-primary" id="saveMenu" ${menuDirty ? '' : 'disabled'}>Save menu</button>
        </div>
      </div>`;
    root.querySelectorAll('[data-di] img').forEach(img => { img.style.cssText = 'width:72px;height:72px;border-radius:12px;object-fit:cover'; });
    wireMenu();
  }

  function dirty() {
    if (!menuDirty) {
      menuDirty = true;
      const bar = root.querySelector('#saveMenu');
      if (bar) { bar.disabled = false; }
    }
  }

  function readCourses() {
    const day = menu.weekly[menuDay] = menu.weekly[menuDay] || { courses: [] };
    root.querySelectorAll('[data-ci]').forEach(el => {
      const c = day.courses[Number(el.dataset.ci)];
      if (!c) return;
      c.label = el.querySelector('[data-clabel]').value.trim();
      c.options = [...el.querySelectorAll('[data-copt]')].map(i => i.value.trim()).filter(Boolean);
      if (!c.id || c.id.startsWith('new')) c.id = (c.label || 'item').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30) + '-' + Math.random().toString(36).slice(2, 5);
    });
  }

  function readAddons() {
    root.querySelectorAll('[data-ai]').forEach(el => {
      const a = menu.addons[Number(el.dataset.ai)];
      a.name = el.querySelector('[data-aname]').value.trim();
      a.price = Number(el.querySelector('[data-aprice]').value) || 0;
    });
  }

  function readDishes() {
    root.querySelectorAll('[data-di]').forEach(el => {
      const d = menu.dishes[Number(el.dataset.di)];
      d.name = el.querySelector('[data-dname]').value.trim();
      d.type = k.dietType === 'veg' ? 'veg' : el.querySelector('[data-dtype]').value;
      d.spice = el.querySelector('[data-dspice]').value;
      d.allergens = el.querySelector('[data-dallergens]').value.split(',').map(s => s.trim()).filter(Boolean);
    });
  }

  function readAll() { readCourses(); readAddons(); readDishes(); }

  function wireMenu() {
    root.querySelectorAll('[data-mday]').forEach(b => b.addEventListener('click', () => { readAll(); menuDay = b.dataset.mday; renderMenu(); UI.icons(root); }));
    root.querySelector('#addCourse').addEventListener('click', () => {
      readAll();
      const day = menu.weekly[menuDay] = menu.weekly[menuDay] || { courses: [] };
      if (day.courses.length >= 8) return UI.toast('Up to 8 items per day.', { type: 'error' });
      day.courses.push({ id: 'new-' + Date.now(), label: '', options: [] });
      dirty(); renderMenu(); UI.icons(root);
      const inputs = root.querySelectorAll('[data-clabel]');
      inputs[inputs.length - 1].focus();
    });
    root.querySelectorAll('[data-cdel]').forEach(b => b.addEventListener('click', () => {
      readAll();
      menu.weekly[menuDay].courses.splice(Number(b.closest('[data-ci]').dataset.ci), 1);
      dirty(); renderMenu(); UI.icons(root);
    }));
    root.querySelector('#copyDay').addEventListener('click', async () => {
      readAll();
      const yes = await UI.confirm({ title: `Copy ${menuDay} to every other day?`, body: 'This replaces the items on the other six days. You can still change them before saving.', confirmText: 'Copy' });
      if (!yes) return;
      DAYS.forEach(d => { if (d !== menuDay) menu.weekly[d] = JSON.parse(JSON.stringify(menu.weekly[menuDay])); });
      dirty(); renderMenu(); UI.icons(root);
      UI.toast('Copied. Remember to save.');
    });
    root.querySelector('#presetSel').addEventListener('change', async e => {
      const key = e.target.value;
      if (!key) return;
      const yes = await UI.confirm({ title: `Load the ${MenuPresets[key].label} menu?`, body: 'This replaces your whole weekly menu (dishes, extras and specials stay). You can edit it before saving.', confirmText: 'Load menu' });
      e.target.value = '';
      if (!yes) return;
      readAll();
      menu.weekly = JSON.parse(JSON.stringify(MenuPresets[key].weekly));
      dirty(); renderMenu(); UI.icons(root);
    });
    root.querySelector('#addAddon').addEventListener('click', () => { readAll(); menu.addons.push({ id: '', name: '', price: 20 }); dirty(); renderMenu(); UI.icons(root); });
    root.querySelectorAll('[data-adel]').forEach(b => b.addEventListener('click', () => { readAll(); menu.addons.splice(Number(b.closest('[data-ai]').dataset.ai), 1); dirty(); renderMenu(); UI.icons(root); }));
    root.querySelector('#addDish').addEventListener('click', () => { readAll(); menu.dishes.unshift({ id: '', name: '', type: 'veg', spice: 'medium', allergens: [], photo: '' }); dirty(); renderMenu(); UI.icons(root); root.querySelector('[data-dname]').focus(); });
    root.querySelectorAll('[data-ddel]').forEach(b => b.addEventListener('click', () => { readAll(); menu.dishes.splice(Number(b.closest('[data-di]').dataset.di), 1); dirty(); renderMenu(); UI.icons(root); }));
    root.querySelectorAll('[data-dphoto]').forEach(inp => inp.addEventListener('change', async () => {
      const f = inp.files[0];
      if (!f) return;
      try {
        readAll();
        const url = await uploadPhoto(f);
        menu.dishes[Number(inp.closest('[data-di]').dataset.di)].photo = url;
        dirty(); renderMenu(); UI.icons(root);
      } catch (err) { UI.error(err); }
    }));
    root.querySelectorAll('[data-sdel]').forEach(b => b.addEventListener('click', () => { readAll(); menu.specials.splice(Number(b.dataset.sdel), 1); dirty(); renderMenu(); UI.icons(root); }));
    root.querySelector('#addSpecial').addEventListener('click', () => {
      const date = root.querySelector('#spDate').value;
      const name = root.querySelector('#spName').value.trim();
      const price = Number(root.querySelector('#spPrice').value);
      if (!date || !name || !(price > 0)) return UI.toast('Add a date, a name and a price.', { type: 'error' });
      readAll();
      menu.specials = menu.specials.filter(s => s.date !== date);
      menu.specials.push({ date, name, price, description: root.querySelector('#spDesc').value.trim() });
      menu.specials.sort((a, b) => a.date.localeCompare(b.date));
      dirty(); renderMenu(); UI.icons(root);
    });
    const discard = root.querySelector('#discardMenu');
    if (discard) discard.addEventListener('click', () => { menu = JSON.parse(JSON.stringify(k.menu)); menuDirty = false; renderMenu(); UI.icons(root); });
    root.querySelector('#saveMenu').addEventListener('click', e => saveMenu(e.currentTarget));
  }

  function onMenuInput(e) {
    if (currentTab() !== 'menu') return;
    if (e.target.matches('[data-clabel],[data-copt],[data-aname],[data-aprice],[data-dname],[data-dallergens],select[data-dtype],select[data-dspice]')) {
      if (!menuDirty) {
        menuDirty = true;
        const btn = root.querySelector('#saveMenu');
        if (btn) btn.disabled = false;
      }
    }
  }
  root.addEventListener('input', onMenuInput);
  root.addEventListener('change', e => { if (e.target.matches('select[data-dtype],select[data-dspice]')) onMenuInput(e); });

  async function saveMenu(btn) {
    readAll();
    // Basic checks before sending
    for (const d of DAYS) {
      const bad = (menu.weekly[d].courses || []).find(c => !c.label || !c.options.length);
      if (bad) { menuDay = d; renderMenu(); UI.icons(root); return UI.toast(`Every item on ${d} needs a name and at least one dish.`, { type: 'error' }); }
    }
    if (menu.addons.some(a => !a.name)) return UI.toast('Give every extra a name (or remove it).', { type: 'error' });
    menu.dishes = menu.dishes.filter(d => d.name);
    await UI.busy(btn, async () => {
      try {
        const res = await API.put('/api/chef/menu', { dishes: menu.dishes, addons: menu.addons, weekly: menu.weekly, specials: menu.specials });
        k.menu = res.menu;
        menu = JSON.parse(JSON.stringify(res.menu));
        menuDirty = false;
        UI.toast(res.notified ? `Menu saved. ${res.notified} customer${res.notified > 1 ? 's were' : ' was'} told about the change.` : 'Menu saved');
        renderMenu();
        UI.icons(root);
      } catch (err) { UI.error(err); }
    });
  }

  // ======================= PROFILE & PHOTOS =======================
  function renderProfile() {
    root.innerHTML = `
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <form class="card card-pad" id="profileForm" novalidate>
          <h2 class="h3">Kitchen profile</h2>
          <div class="field" style="margin-top:14px"><label class="field-label" for="kName">Kitchen name</label><input id="kName" name="name" class="input" value="${esc(k.name)}" maxlength="60"><p class="field-error"></p></div>
          <div class="field"><label class="field-label" for="kChef">Your name as shown</label><input id="kChef" name="chefName" class="input" value="${esc(k.chefName)}" maxlength="60"></div>
          <div class="field"><label class="field-label" for="kBio">One-line description</label><input id="kBio" name="bio" class="input" value="${esc(k.bio)}" maxlength="160" placeholder="e.g. Light Gujarati food, less oil"></div>
          <div class="field"><label class="field-label" for="kStory">Your story</label><textarea id="kStory" name="story" class="textarea" maxlength="1200" placeholder="Who taught you to cook? What do neighbours love about your food?">${esc(k.story)}</textarea></div>
          <fieldset class="field" style="border:0;padding:0;margin:16px 0 0"><legend class="field-label" style="margin-bottom:6px">You cook</legend>
            <div class="chips">${[['veg', 'Only veg'], ['egg', 'Veg & egg'], ['nonveg', 'Veg & non-veg']].map(([v, l]) => `<label class="chip"><input type="radio" name="dietType" value="${v}" ${k.dietType === v ? 'checked' : ''}>${l}</label>`).join('')}</div>
          </fieldset>
          <fieldset class="field" style="border:0;padding:0;margin:16px 0 0"><legend class="field-label" style="margin-bottom:6px">Cuisine (up to 3)</legend>
            <div class="chips">${CUISINES.map(c => `<label class="chip"><input type="checkbox" name="cuisines" value="${c}" ${(k.cuisines || []).includes(c) ? 'checked' : ''}>${c}</label>`).join('')}</div>
          </fieldset>
          <div class="form-grid cols-2" style="margin-top:16px">
            <div class="field"><label class="field-label" for="kFssai">FSSAI number</label><input id="kFssai" name="fssai" class="input" inputmode="numeric" maxlength="14" value="${esc(k.fssai)}" placeholder="14 digits"><p class="field-hint">Shown on your storefront.</p><p class="field-error"></p></div>
            <div class="field"><label class="field-label" for="kPhone">Kitchen phone</label><input id="kPhone" name="phone" class="input" inputmode="numeric" maxlength="10" value="${esc(k.phone)}"><p class="field-error"></p></div>
          </div>
          <button type="submit" class="btn btn-primary" style="margin-top:16px">Save profile</button>
        </form>
        <section class="card card-pad" aria-labelledby="photoTitle">
          <h2 class="h3" id="photoTitle">Photos</h2>
          <p class="text-sm text-muted" style="margin:4px 0 14px">Real photos of your food in daylight sell best. Up to 8 in the gallery.</p>
          <div class="field-label">Cover photo</div>
          <div class="kcard-img" style="margin-top:6px">${UI.img(k.coverUrl, 'Cover photo')}</div>
          <label class="btn btn-secondary btn-sm" style="margin-top:8px">${icon('upload')}Change cover<input type="file" accept="image/jpeg,image/png,image/webp" class="sr-only" id="coverInput"></label>
          <div class="field-label" style="margin-top:18px">Gallery</div>
          <div class="grid grid-cols-3 gap-2" style="margin-top:6px">
            ${(k.gallery || []).map((g, i) => `<div style="position:relative">${UI.img(g, `Gallery photo ${i + 1}`)}<button type="button" class="fav-btn" style="top:4px;right:4px;width:28px;height:28px" data-gdel="${i}" aria-label="Remove photo ${i + 1}">${icon('x', 'icon-xs')}</button></div>`).join('')}
            ${(k.gallery || []).length < 8 ? `<label class="panel flex flex-col items-center justify-center text-xs text-subtle" style="aspect-ratio:1;cursor:pointer;border-style:dashed">${icon('image-plus')}Add<input type="file" accept="image/jpeg,image/png,image/webp" class="sr-only" id="galleryInput"></label>` : ''}
          </div>
        </section>
      </div>`;
    root.querySelectorAll('.grid-cols-3 img').forEach(img => { img.style.cssText = 'aspect-ratio:1;width:100%;object-fit:cover;border-radius:10px'; });
    const f = root.querySelector('#profileForm');
    f.addEventListener('submit', async e => {
      e.preventDefault();
      UI.clearErrors(f);
      const cuisines = [...f.querySelectorAll('[name="cuisines"]:checked')].map(c => c.value);
      if (cuisines.length > 3) return UI.toast('Pick up to 3 cuisines.', { type: 'error' });
      if (f.fssai.value && !/^\d{14}$/.test(f.fssai.value.trim())) return UI.setFieldError(f, 'fssai', 'FSSAI numbers are 14 digits.');
      if (f.name.value.trim().length < 3) return UI.setFieldError(f, 'name', 'At least 3 characters.');
      await saveKitchen({ name: f.name.value, chefName: f.chefName.value, bio: f.bio.value, story: f.story.value, dietType: f.dietType.value, cuisines, fssai: f.fssai.value.trim(), phone: f.phone.value.trim() }, f.querySelector('[type=submit]'), 'Profile saved');
    });
    root.querySelector('#coverInput').addEventListener('change', async e => {
      try {
        const url = await uploadPhoto(e.target.files[0]);
        const res = await API.put('/api/chef/photos', { coverUrl: url });
        k = res.kitchen;
        UI.toast('Cover photo updated');
        renderProfile(); UI.icons(root);
      } catch (err) { UI.error(err); }
    });
    const gi = root.querySelector('#galleryInput');
    if (gi) gi.addEventListener('change', async e => {
      try {
        const url = await uploadPhoto(e.target.files[0]);
        const res = await API.put('/api/chef/photos', { gallery: [...(k.gallery || []), url] });
        k = res.kitchen;
        UI.toast('Photo added');
        renderProfile(); UI.icons(root);
      } catch (err) { UI.error(err); }
    });
    root.querySelectorAll('[data-gdel]').forEach(b => b.addEventListener('click', async () => {
      try {
        const g = (k.gallery || []).filter((_, i) => i !== Number(b.dataset.gdel));
        const res = await API.put('/api/chef/photos', { gallery: g });
        k = res.kitchen;
        renderProfile(); UI.icons(root);
      } catch (err) { UI.error(err); }
    }));
  }

  // ======================= PRICING & CAPACITY =======================
  function renderPricing() {
    root.innerHTML = `
      <form class="card card-pad" id="priceForm" novalidate style="max-width:720px">
        <h2 class="h3">Prices</h2>
        <div class="form-grid cols-2" style="margin-top:14px">
          ${[['single', 'One meal', ''], ['trial', '1-day trial', 'One per customer'], ['plan5', '5-day plan (22 meals)', 'plan5'], ['plan7', '7-day plan (30 meals)', 'plan7']].map(([n, l, h]) => `
            <div class="field"><label class="field-label" for="pr-${n}">${l}</label><div class="input-group"><span class="prefix">₹</span><input id="pr-${n}" name="${n}" class="input num" inputmode="numeric" value="${k.pricing[n]}" style="padding-left:30px"></div><p class="field-hint" data-hint="${n}">${h === 'plan5' ? `${money(Math.round(k.pricing.plan5 / 22))}/meal` : h === 'plan7' ? `${money(Math.round(k.pricing.plan7 / 30))}/meal` : h}</p><p class="field-error"></p></div>`).join('')}
        </div>
        <hr class="divider">
        <h2 class="h3">Slots & capacity</h2>
        <fieldset class="field" style="border:0;padding:0;margin:14px 0 0"><legend class="field-label" style="margin-bottom:6px">You cook</legend>
          <div class="chips"><label class="chip"><input type="checkbox" name="slots" value="lunch" ${k.slots.includes('lunch') ? 'checked' : ''}>Lunch</label><label class="chip"><input type="checkbox" name="slots" value="dinner" ${k.slots.includes('dinner') ? 'checked' : ''}>Dinner</label></div>
        </fieldset>
        <div class="form-grid cols-2" style="margin-top:16px">
          <div class="field"><label class="field-label" for="cap">Max meals per slot</label><input id="cap" name="capacity" class="input num" type="number" min="1" max="300" value="${k.capacity}"><p class="field-hint">New bookings stop when you're full.</p><p class="field-error"></p></div>
          <div class="field"><label class="field-label" for="cut">Daily cutoff</label><input id="cut" name="cutoffTime" class="input" type="time" min="05:00" max="11:00" value="${k.cutoffTime}"><p class="field-hint">After this, the day's orders are locked and you start cooking.</p><p class="field-error"></p></div>
        </div>
        <button type="submit" class="btn btn-primary" style="margin-top:16px">Save</button>
      </form>`;
    const f = root.querySelector('#priceForm');
    ['plan5', 'plan7'].forEach(n => f[n].addEventListener('input', () => {
      root.querySelector(`[data-hint="${n}"]`).textContent = `${money(Math.round(Number(f[n].value) / (n === 'plan5' ? 22 : 30)))}/meal`;
    }));
    f.addEventListener('submit', async e => {
      e.preventDefault();
      UI.clearErrors(f);
      const slots = [...f.querySelectorAll('[name="slots"]:checked')].map(c => c.value);
      if (!slots.length) return UI.toast('Cook at least lunch or dinner.', { type: 'error' });
      const cap = Number(f.capacity.value);
      if (!(cap >= 1 && cap <= 300)) return UI.setFieldError(f, 'capacity', 'Between 1 and 300.');
      if (f.cutoffTime.value > '11:00') return UI.setFieldError(f, 'cutoffTime', 'Latest cutoff is 11:00 AM.');
      await saveKitchen({ pricing: { single: Number(f.single.value), trial: Number(f.trial.value), plan5: Number(f.plan5.value), plan7: Number(f.plan7.value) }, slots, capacity: cap, cutoffTime: f.cutoffTime.value }, f.querySelector('[type=submit]'), 'Prices and capacity saved');
      renderPricing(); UI.icons(root);
    });
  }

  // ======================= DELIVERY AREA =======================
  async function renderDelivery() {
    const cfg = await API.get('/api/config');
    root.innerHTML = `
      <form class="card card-pad" id="delForm" novalidate style="max-width:820px">
        <h2 class="h3">Kitchen location & delivery radius</h2>
        <p class="text-sm text-muted" style="margin:4px 0 14px">Customers only see you if their address is inside your circle. Your exact address is never shown; customers see the area only.</p>
        <div id="delMapHost"></div>
        <div class="field" id="delLocalityField" ${window.Maps ? 'hidden' : ''}>
          <label class="field-label" for="delLoc">Area</label>
          <select id="delLoc" name="locality" class="select">${cfg.localities.map(l => `<option value="${esc(l.name)}" ${k.location.locality === l.name ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select>
        </div>
        <div class="field" style="margin-top:14px"><label class="field-label" for="delAddr">Building & street</label><input id="delAddr" name="address" class="input" value="${esc(k.location.address)}" maxlength="200"></div>
        <div class="field" style="margin-top:14px">
          <label class="field-label" for="delRadius">Deliver within <strong id="delRadiusOut">${(k.radiusM / 1000).toFixed(1)} km</strong></label>
          <input id="delRadius" name="radius" type="range" min="500" max="5000" step="250" value="${k.radiusM}" style="width:100%;accent-color:var(--brand-saffron)">
        </div>
        <button type="submit" class="btn btn-primary" style="margin-top:16px">Save delivery area</button>
      </form>`;
    const f = root.querySelector('#delForm');
    let pinned = { lat: k.location.lat, lng: k.location.lng, formatted: k.location.address, locality: k.location.locality };
    if (window.Maps) Maps.kitchenPicker(root.querySelector('#delMapHost'), pinned, k.radiusM, p => { pinned = p; });
    f.radius.addEventListener('input', () => {
      root.querySelector('#delRadiusOut').textContent = `${(f.radius.value / 1000).toFixed(1)} km`;
      if (window.Maps && Maps.setPickerRadius) Maps.setPickerRadius(Number(f.radius.value));
    });
    f.addEventListener('submit', async e => {
      e.preventDefault();
      let location;
      if (window.Maps) location = { lat: pinned.lat, lng: pinned.lng, address: f.address.value || pinned.formatted, locality: pinned.locality || k.location.locality };
      else {
        const l = cfg.localities.find(x => x.name === f.locality.value);
        const same = l.name === k.location.locality;
        location = { lat: same ? k.location.lat : l.lat, lng: same ? k.location.lng : l.lng, address: f.address.value, locality: l.name };
      }
      await saveKitchen({ location, radiusM: Number(f.radius.value) }, f.querySelector('[type=submit]'), 'Delivery area saved');
    });
  }

  // ======================= DAYS OFF =======================
  function renderHolidays() {
    const upcoming = (k.holidays || []).filter(h => h.date >= App.session.today);
    root.innerHTML = `
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <section class="card card-pad" aria-labelledby="weekOffTitle">
          <h2 class="h3" id="weekOffTitle">Weekly days off</h2>
          <p class="text-sm text-muted" style="margin:4px 0 12px">Plans skip these days automatically. Turning a day off cancels and refunds any meals already booked on it.</p>
          <div class="chips">${DAYS.map(d => `<label class="chip"><input type="checkbox" name="off" value="${d}" ${(k.offDays || []).includes(d) ? 'checked' : ''}>${d[0].toUpperCase() + d.slice(1, 3)}</label>`).join('')}</div>
          <button type="button" class="btn btn-primary" id="saveOff" style="margin-top:14px">Save weekly days off</button>
        </section>
        <section class="card card-pad" aria-labelledby="holTitle">
          <h2 class="h3" id="holTitle">Holidays</h2>
          <p class="text-sm text-muted" style="margin:4px 0 12px">Not cooking on a date? Customers with meals that day are told and refunded straight away.</p>
          <form id="holForm" class="flex flex-wrap gap-2 items-end" novalidate>
            <div class="field" style="flex:0 0 160px"><label class="field-label" for="hDate">Date</label><input id="hDate" name="date" type="date" class="input" min="${App.session.today}"></div>
            <div class="field" style="flex:1;min-width:160px"><label class="field-label" for="hReason">Reason (shown to customers)</label><input id="hReason" name="reason" class="input" maxlength="80" placeholder="e.g. Family function"></div>
            <button type="submit" class="btn btn-secondary">Add holiday</button>
          </form>
          <div style="margin-top:14px">
            ${upcoming.length ? upcoming.map(h => `<div class="list-row"><span style="flex:1"><strong>${UI.date(h.date, { weekday: 'short', day: 'numeric', month: 'short' })}</strong>${h.reason ? `<span class="text-sm text-muted"> · ${esc(h.reason)}</span>` : ''}</span><button type="button" class="btn btn-ghost btn-sm" data-hdel="${h.date}">Remove</button></div>`).join('') : '<p class="text-sm text-muted" style="margin:0">No holidays planned.</p>'}
          </div>
        </section>
        <section class="card card-pad" aria-labelledby="pauseTitle">
          <h2 class="h3" id="pauseTitle">Pause new orders</h2>
          <p class="text-sm text-muted" style="margin:4px 0 12px">For a busy week: stop new bookings without cancelling meals already booked.</p>
          <label class="switch"><input type="checkbox" id="pauseToggle" ${k.paused ? 'checked' : ''}><span class="track"></span><span>${k.paused ? 'Paused: not taking new orders' : 'Taking new orders'}</span></label>
        </section>
      </div>`;
    root.querySelector('#saveOff').addEventListener('click', async e => {
      const offDays = [...root.querySelectorAll('[name="off"]:checked')].map(c => c.value);
      const added = offDays.filter(d => !(k.offDays || []).includes(d));
      if (added.length) {
        const yes = await UI.confirm({ title: 'Close on these days every week?', body: `Any meals already booked on ${added.join(', ')} will be cancelled and refunded to customers.`, confirmText: 'Save' });
        if (!yes) return;
      }
      UI.busy(e.currentTarget, async () => {
        try {
          const res = await API.put('/api/chef/offdays', { offDays });
          k.offDays = res.offDays;
          UI.toast(res.affected ? `Saved. ${res.affected} meal${res.affected > 1 ? 's' : ''} refunded (${money(res.refunded)}).` : 'Weekly days off saved');
        } catch (err) { UI.error(err); }
      });
    });
    const hf = root.querySelector('#holForm');
    hf.addEventListener('submit', async e => {
      e.preventDefault();
      if (!hf.date.value) return UI.toast('Pick a date.', { type: 'error' });
      const yes = await UI.confirm({ title: `Take ${UI.date(hf.date.value)} off?`, body: 'Customers with meals that day are notified and refunded right away.', confirmText: 'Mark holiday' });
      if (!yes) return;
      UI.busy(hf.querySelector('button'), async () => {
        try {
          const res = await API.post('/api/chef/holidays', { date: hf.date.value, reason: hf.reason.value });
          UI.toast(res.affected ? `Holiday added. ${res.affected} meal${res.affected > 1 ? 's' : ''} refunded (${money(res.refunded)}).` : 'Holiday added');
          await load();
        } catch (err) { UI.error(err); }
      });
    });
    root.querySelectorAll('[data-hdel]').forEach(b => b.addEventListener('click', () => UI.busy(b, async () => {
      try {
        await API.del(`/api/chef/holidays/${b.dataset.hdel}`);
        UI.toast('Holiday removed. Customers can book that day again.');
        await load();
      } catch (err) { UI.error(err); }
    })));
    root.querySelector('#pauseToggle').addEventListener('change', async e => {
      try {
        const res = await API.post('/api/chef/pause', { paused: e.target.checked });
        k = { ...res.kitchen, menu: k.menu };
        UI.toast(k.paused ? 'New orders paused' : 'Taking orders again');
        renderHolidays(); UI.icons(root);
      } catch (err) { e.target.checked = !e.target.checked; UI.error(err); }
    });
  }

  // ======================= PAYOUTS =======================
  function renderPayouts() {
    root.innerHTML = `
      <form class="card card-pad" id="upiForm" novalidate style="max-width:560px">
        <h2 class="h3">Payouts</h2>
        <p class="text-sm text-muted" style="margin:4px 0 14px">Earnings from delivered meals collect in your RasoiSe balance. Withdraw any time to this UPI id.</p>
        <div class="field"><label class="field-label" for="upi">UPI id</label><input id="upi" name="upi" class="input" value="${esc(k.upi)}" placeholder="e.g. asha@okaxis" autocomplete="off"><p class="field-error"></p></div>
        <div class="flex flex-wrap gap-2" style="margin-top:14px">
          <button type="submit" class="btn btn-primary">Save UPI id</button>
          <a class="btn btn-secondary" href="/chef-dashboard.html#earnings">See earnings</a>
        </div>
      </form>`;
    const f = root.querySelector('#upiForm');
    f.addEventListener('submit', async e => {
      e.preventDefault();
      UI.clearErrors(f);
      const v = f.upi.value.trim();
      if (v && !/^[\w.\-]{2,}@[a-zA-Z]{2,}$/.test(v)) return UI.setFieldError(f, 'upi', 'UPI ids look like name@bank.');
      await saveKitchen({ upi: v }, f.querySelector('[type=submit]'), 'UPI id saved');
    });
  }

  load();
})();
