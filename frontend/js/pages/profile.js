// Profile: food preferences, saved addresses, favourites, account details and password.

(async function () {
  const { esc, icon, money } = UI;
  await App.init({ active: 'profile', requireRole: ['customer'] });

  const prefForm = document.getElementById('prefForm');
  const accForm = document.getElementById('accForm');

  function fillPrefs() {
    const p = App.user.preferences || {};
    prefForm.querySelectorAll('[name="diet"]').forEach(r => { r.checked = r.value === (p.diet || 'veg'); });
    prefForm.querySelectorAll('[name="spice"]').forEach(r => { r.checked = r.value === (p.spice || 'medium'); });
    prefForm.noOnionGarlic.checked = !!p.noOnionGarlic;
    prefForm.rice.checked = p.rice !== false;
    prefForm.rotiCount.value = String(p.rotiCount == null ? 4 : p.rotiCount);
    if (![...prefForm.rotiCount.options].some(o => o.value === prefForm.rotiCount.value)) prefForm.rotiCount.value = '4';
    prefForm.defaultSlot.value = p.defaultSlot || 'lunch';
    prefForm.allergies.value = (p.allergies || []).join(', ');
    syncJain();
  }

  // Jain food has no onion-garlic by definition
  function syncJain() {
    const jain = prefForm.diet.value === 'jain';
    if (jain) prefForm.noOnionGarlic.checked = true;
    prefForm.noOnionGarlic.disabled = jain;
  }
  prefForm.querySelectorAll('[name="diet"]').forEach(r => r.addEventListener('change', syncJain));

  prefForm.addEventListener('submit', async e => {
    e.preventDefault();
    const preferences = {
      diet: prefForm.diet.value, noOnionGarlic: prefForm.noOnionGarlic.checked, spice: prefForm.spice.value,
      rotiCount: Number(prefForm.rotiCount.value), rice: prefForm.rice.checked, defaultSlot: prefForm.defaultSlot.value,
      allergies: prefForm.allergies.value
    };
    await UI.busy(prefForm.querySelector('[type=submit]'), async () => {
      try {
        const res = await API.put('/api/me/profile', { preferences });
        App.session.user = res.user;
        UI.toast('Preferences saved. Kitchens will see them on your upcoming meals.');
      } catch (err) { UI.error(err); }
    });
  });

  function fillAccount() {
    accForm.name.value = App.user.name;
    accForm.phone.value = App.user.phone || '';
    accForm.email.value = App.user.email || '';
  }

  accForm.addEventListener('submit', async e => {
    e.preventDefault();
    UI.clearErrors(accForm);
    const body = { name: accForm.name.value.trim(), phone: accForm.phone.value.trim(), email: accForm.email.value.trim() };
    if (body.name.length < 2) return UI.setFieldError(accForm, 'name', 'Please enter your name.');
    if (body.phone && !/^[6-9]\d{9}$/.test(body.phone)) return UI.setFieldError(accForm, 'phone', 'Enter a 10-digit mobile number.');
    await UI.busy(accForm.querySelector('[type=submit]'), async () => {
      try {
        const res = await API.put('/api/me/profile', body);
        App.session.user = res.user;
        await App.refreshSession();
        UI.toast('Details saved');
      } catch (err) { UI.error(err); }
    });
  });

  const pwForm = document.getElementById('pwForm');
  pwForm.addEventListener('submit', async e => {
    e.preventDefault();
    UI.clearErrors(pwForm);
    if (!pwForm.current.value) return UI.setFieldError(pwForm, 'current', 'Enter your current password.');
    if (pwForm.next.value.length < 8) return UI.setFieldError(pwForm, 'next', 'At least 8 characters.');
    await UI.busy(pwForm.querySelector('[type=submit]'), async () => {
      try {
        await API.post('/api/auth/password', { current: pwForm.current.value, next: pwForm.next.value });
        pwForm.reset();
        UI.toast('Password updated');
      } catch (err) { UI.setFieldError(pwForm, 'current', err.message); }
    });
  });

  function renderAddresses() {
    const host = document.getElementById('addrList');
    const list = App.user.addresses || [];
    if (!list.length) {
      host.innerHTML = '<p class="text-sm text-muted" style="margin:0">No saved addresses. Add one to see which kitchens deliver to you.</p>';
      return;
    }
    host.innerHTML = list.map(a => `
      <div class="list-row">
        <span class="avatar" style="background:var(--muted-bg)">${icon(AddressBook.labelIcon(a.label), 'icon-sm')}</span>
        <div style="flex:1;min-width:0">
          <div class="flex items-center gap-2"><strong>${esc(AddressBook.addrTitle(a))}</strong>${a.id === App.user.defaultAddressId ? '<span class="badge badge-saffron">Default</span>' : ''}</div>
          <div class="text-sm text-muted clamp-2">${esc(AddressBook.addrLine(a))}</div>
        </div>
        <div class="flex gap-1">
          ${a.id !== App.user.defaultAddressId ? `<button type="button" class="btn btn-ghost btn-sm" data-default="${a.id}">Make default</button>` : ''}
          <button type="button" class="btn btn-secondary btn-sm" data-edit="${a.id}">Edit</button>
        </div>
      </div>`).join('');
    UI.icons(host);
  }

  document.getElementById('addrList').addEventListener('click', async e => {
    const ed = e.target.closest('[data-edit]');
    const df = e.target.closest('[data-default]');
    if (ed) {
      const a = App.user.addresses.find(x => x.id === Number(ed.dataset.edit));
      await AddressBook.openEditor(a, { makeDefault: false });
      renderAddresses();
    }
    if (df) {
      try {
        const res = await API.post(`/api/me/addresses/${df.dataset.default}/default`);
        App.session.user = res.user;
        await App.refreshSession();
        renderAddresses();
        UI.toast('Default address updated');
      } catch (err) { UI.error(err); }
    }
  });
  document.getElementById('addAddress').addEventListener('click', async () => {
    await AddressBook.openEditor(null, { makeDefault: !(App.user.addresses || []).length });
    renderAddresses();
  });

  async function renderFavourites() {
    const host = document.getElementById('favList');
    host.innerHTML = UI.skeletonRows(2);
    try {
      const res = await API.get('/api/me/favourites');
      if (!res.kitchens.length) {
        host.innerHTML = `<p class="text-sm text-muted" style="margin:0">Tap the ${icon('heart', 'icon-xs')} on a kitchen to save it here.</p>`;
        UI.icons(host);
        return;
      }
      host.innerHTML = res.kitchens.map(k => `
        <div class="list-row">
          <a href="/kitchen.html?id=${k.id}" style="flex:1;min-width:0;text-decoration:none">
            <strong class="truncate" style="display:block">${esc(k.name)}</strong>
            <span class="text-xs text-subtle">${k.stats.rating != null ? `★ ${k.stats.rating} · ` : ''}${money(k.pricing.single)}/meal${k.distance != null ? ` · ${UI.distance(k.distance)}` : ''}</span>
          </a>
          <a class="btn btn-secondary btn-sm" href="/kitchen.html?id=${k.id}">Order</a>
          <button type="button" class="btn btn-ghost btn-icon btn-sm" data-unfav="${k.id}" aria-label="Remove ${esc(k.name)} from favourites">${icon('x')}</button>
        </div>`).join('');
      UI.icons(host);
    } catch (e) {
      host.innerHTML = `<p class="text-sm text-danger">${esc(e.message)}</p>`;
    }
  }
  document.getElementById('favList').addEventListener('click', async e => {
    const b = e.target.closest('[data-unfav]');
    if (!b) return;
    try {
      const res = await API.post(`/api/me/favourites/${b.dataset.unfav}`);
      App.session.user.favourites = res.favourites;
      renderFavourites();
    } catch (err) { UI.error(err); }
  });

  document.getElementById('signOut').addEventListener('click', () => App.signOut());
  App.on('origin', renderAddresses);

  fillPrefs();
  fillAccount();
  renderAddresses();
  renderFavourites();
  if (location.hash === '#addresses') document.getElementById('addresses').scrollIntoView();
})();
