// Saved addresses: switcher (pick where to deliver), editor (add/edit), and the guest locality picker.
// The editor uses Maps (js/maps.js) when it is loaded on the page; otherwise a locality list.

// "Lokhandwala market" → "near Lokhandwala market". Landmarks already written as "near ...",
// "opposite ..." etc. are shown as typed, so addresses never read "near near".
function landmarkText(l) {
  const s = String(l || '').trim();
  if (!s) return '';
  return /^(near|opp|opposite|behind|next to|beside|in front of|above|below|off)\b/i.test(s) ? s : `near ${s}`;
}

// One line for an address: flat, building, landmark, then the map's text, skipping any part the
// map text already contains (so nothing is printed twice).
function addressText(a) {
  if (!a) return '';
  const full = String(a.formatted || '');
  const has = p => p && full.toLowerCase().includes(String(p).toLowerCase().replace(/^near /, ''));
  return [a.flat, has(a.building) ? '' : a.building, has(a.landmark) ? '' : landmarkText(a.landmark), full].filter(Boolean).join(', ');
}

(function () {
  const { esc, icon } = UI;
  let config = null;

  async function getConfig() {
    if (!config) config = await API.get('/api/config');
    return config;
  }

  function addrTitle(a) {
    return a.label === 'Other' && a.customLabel ? a.customLabel : a.label;
  }

  function addrLine(a) {
    return addressText(a);
  }

  function labelIcon(label) {
    return label === 'Home' ? 'house' : label === 'Work' ? 'briefcase' : 'map-pin';
  }

  // ---------- Switcher ----------
  function openSwitcher() {
    const u = App.session.user;
    const list = u.addresses || [];
    const dlg = document.createElement('dialog');
    dlg.className = 'modal';
    dlg.innerHTML = `
      <div class="modal-head">
        <div><h2 class="h3">Deliver to</h2><p class="text-sm text-muted" style="margin:4px 0 0">Distances and delivery areas use this address.</p></div>
        <button class="icon-btn" data-close aria-label="Close">${icon('x')}</button>
      </div>
      <div class="modal-body">
        ${list.length ? `<div style="display:grid;gap:10px" role="radiogroup" aria-label="Saved addresses">
          ${list.map(a => `
            <label class="option-card" style="display:flex;gap:12px;align-items:flex-start">
              <input type="radio" name="addr" value="${a.id}" ${a.id === u.defaultAddressId ? 'checked' : ''}>
              <span class="avatar" style="background:var(--muted-bg)">${icon(labelIcon(a.label), 'icon-sm')}</span>
              <span style="flex:1;min-width:0">
                <span style="font-weight:600;display:block">${esc(addrTitle(a))}</span>
                <span class="text-sm text-muted clamp-2">${esc(addrLine(a))}</span>
              </span>
              <button type="button" class="btn btn-ghost btn-sm" data-edit="${a.id}">Edit</button>
            </label>`).join('')}
        </div>` : UI.empty({ icon: 'map-pin', title: 'No saved addresses yet', body: 'Add where you want your meals delivered.' })}
        <button type="button" class="btn btn-secondary btn-block" id="addAddrBtn" style="margin-top:14px">${icon('plus')}Add a new address</button>
      </div>`;
    document.body.appendChild(dlg);
    dlg.addEventListener('close', () => setTimeout(() => dlg.remove(), 250));
    UI.openModal(dlg);

    dlg.querySelectorAll('input[name="addr"]').forEach(r => r.addEventListener('change', async () => {
      try {
        const res = await API.post(`/api/me/addresses/${r.value}/default`);
        App.session.user = res.user;
        await App.refreshSession();
        App.emit('origin');
        UI.toast('Delivery address updated');
        dlg.close();
      } catch (e) { UI.error(e); }
    }));
    dlg.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', e => {
      e.preventDefault();
      dlg.close();
      openEditor(list.find(a => a.id === Number(b.dataset.edit)));
    }));
    dlg.querySelector('#addAddrBtn').addEventListener('click', () => { dlg.close(); openEditor(); });
  }

  // ---------- Editor ----------
  // Resolves with the updated user, or null if closed.
  function openEditor(existing = null, { makeDefault = true } = {}) {
    return new Promise(async resolve => {
      const cfg = await getConfig();
      const a = existing || {};
      const dlg = document.createElement('dialog');
      dlg.className = 'modal modal-lg';
      const hasMaps = !!window.Maps;
      dlg.innerHTML = `
        <form novalidate>
          <div class="modal-head">
            <div><h2 class="h3">${existing ? 'Edit address' : 'Add delivery address'}</h2>
            <p class="text-sm text-muted" style="margin:4px 0 0">${hasMaps ? 'Search or drag the pin to your building entrance.' : 'Pick your area, then add flat details.'}</p></div>
            <button type="button" class="icon-btn" data-close aria-label="Close">${icon('x')}</button>
          </div>
          <div class="modal-body">
            <div id="addrPickerHost"></div>
            ${hasMaps ? '' : `
            <div class="field">
              <label class="field-label" for="addrLocality">Area <span class="req">*</span></label>
              <select id="addrLocality" class="select" name="locality">
                <option value="">Choose your area</option>
                ${cfg.localities.map(l => `<option value="${esc(l.name)}" ${a.formatted && a.formatted.startsWith(l.name) ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}
              </select>
              <p class="field-error">Choose your area.</p>
            </div>`}
            <div class="form-grid cols-2" style="margin-top:16px">
              <div class="field">
                <label class="field-label" for="addrFlat">Flat / house no. & floor <span class="req">*</span></label>
                <input id="addrFlat" name="flat" class="input" value="${esc(a.flat || '')}" placeholder="e.g. B-402, 4th floor" autocomplete="address-line1">
                <p class="field-error">Add your flat or house number.</p>
              </div>
              <div class="field">
                <label class="field-label" for="addrBuilding">Building / society</label>
                <input id="addrBuilding" name="building" class="input" value="${esc(a.building || '')}" placeholder="e.g. Silver Oaks CHS" autocomplete="address-line2">
              </div>
            </div>
            <div class="field" style="margin-top:16px">
              <label class="field-label" for="addrLandmark">Landmark</label>
              <input id="addrLandmark" name="landmark" class="input" value="${esc(a.landmark || '')}" placeholder="e.g. opposite Lokhandwala market">
            </div>
            <fieldset class="field" style="margin-top:16px;border:0;padding:0">
              <legend class="field-label" style="margin-bottom:6px">Save as</legend>
              <div class="chips">
                ${['Home', 'Work', 'Other'].map(l => `<label class="chip"><input type="radio" name="label" value="${l}" ${(a.label || 'Home') === l ? 'checked' : ''}>${icon(labelIcon(l), 'icon-sm')}${l}</label>`).join('')}
              </div>
              <input name="customLabel" class="input" placeholder="Name this place (e.g. Mom's house)" value="${esc(a.customLabel || '')}" style="margin-top:8px;${a.label === 'Other' ? '' : 'display:none'}" maxlength="30" aria-label="Custom label">
            </fieldset>
          </div>
          <div class="modal-foot">
            ${existing ? `<button type="button" class="btn btn-danger" id="addrDelete" style="margin-right:auto">${icon('trash-2')}Delete</button>` : ''}
            <button type="button" class="btn btn-secondary" data-close>Cancel</button>
            <button type="submit" class="btn btn-primary">Save address</button>
          </div>
        </form>`;
      document.body.appendChild(dlg);
      let result = null;
      dlg.addEventListener('close', () => { setTimeout(() => dlg.remove(), 250); resolve(result); });
      UI.openModal(dlg);

      const form = dlg.querySelector('form');
      const customLabel = form.querySelector('[name="customLabel"]');
      form.querySelectorAll('[name="label"]').forEach(r => r.addEventListener('change', () => {
        customLabel.style.display = form.label.value === 'Other' ? '' : 'none';
      }));

      // Location: map picker if available, else the locality list
      let picked = a.lat ? { lat: a.lat, lng: a.lng, formatted: a.formatted || '' } : null;
      if (hasMaps) {
        Maps.addressPicker(dlg.querySelector('#addrPickerHost'), picked, loc => { picked = loc; });
      }

      form.addEventListener('submit', async e => {
        e.preventDefault();
        UI.clearErrors(form);
        let loc = picked;
        if (!hasMaps) {
          const l = cfg.localities.find(x => x.name === form.locality.value);
          if (!l) { UI.setFieldError(form, 'locality', 'Choose your area.'); return; }
          loc = { lat: l.lat, lng: l.lng, formatted: `${l.name}, ${RASOI_AREA.name}, ${RASOI_AREA.city}` };
        }
        if (!loc) { UI.toast('Pin your location on the map first.', { type: 'error' }); return; }
        if (!form.flat.value.trim()) { UI.setFieldError(form, 'flat', 'Add your flat or house number.'); form.flat.focus(); return; }
        const body = {
          label: form.label.value, customLabel: customLabel.value, flat: form.flat.value, building: form.building.value,
          landmark: form.landmark.value, formatted: loc.formatted, lat: loc.lat, lng: loc.lng, makeDefault
        };
        const btn = form.querySelector('[type="submit"]');
        await UI.busy(btn, async () => {
          try {
            const res = existing ? await API.put(`/api/me/addresses/${existing.id}`, body) : await API.post('/api/me/addresses', body);
            result = res.user;
            App.session.user = res.user;
            await App.refreshSession();
            App.emit('origin');
            UI.toast(existing ? 'Address updated' : 'Address saved');
            dlg.close();
          } catch (err) { UI.error(err); }
        });
      });

      const del = dlg.querySelector('#addrDelete');
      if (del) del.addEventListener('click', async () => {
        const yes = await UI.confirm({ title: 'Delete this address?', body: 'Upcoming meals already booked to it will still be delivered there.', confirmText: 'Delete', danger: true });
        if (!yes) return;
        try {
          const res = await API.del(`/api/me/addresses/${existing.id}`);
          result = res.user;
          await App.refreshSession();
          App.emit('origin');
          UI.toast('Address deleted');
          dlg.close();
        } catch (err) { UI.error(err); }
      });
    });
  }

  // ---------- Guest picker ----------
  async function openGuest() {
    const cfg = await getConfig();
    const dlg = document.createElement('dialog');
    dlg.className = 'modal';
    dlg.innerHTML = `
      <div class="modal-head">
        <div><h2 class="h3">Where should we deliver?</h2><p class="text-sm text-muted" style="margin:4px 0 0">Pick your area to see distances. Sign in to save exact addresses.</p></div>
        <button class="icon-btn" data-close aria-label="Close">${icon('x')}</button>
      </div>
      <div class="modal-body">
        ${window.Maps ? `<button type="button" class="btn btn-secondary btn-block" id="guestGeo" style="margin-bottom:14px">${icon('locate-fixed')}Use my current location</button>` : ''}
        <div class="chips">
          ${cfg.localities.map(l => `<button type="button" class="chip" data-loc="${esc(l.name)}">${icon('map-pin', 'icon-sm')}${esc(l.name)}</button>`).join('')}
        </div>
      </div>
      <div class="modal-foot"><a class="btn btn-dark" href="/login.html?next=${encodeURIComponent(location.pathname)}">Sign in to save addresses</a></div>`;
    document.body.appendChild(dlg);
    dlg.addEventListener('close', () => setTimeout(() => dlg.remove(), 250));
    UI.openModal(dlg);
    dlg.querySelectorAll('[data-loc]').forEach(b => b.addEventListener('click', () => {
      const l = cfg.localities.find(x => x.name === b.dataset.loc);
      App.setGuestOrigin({ lat: l.lat, lng: l.lng, label: l.name, sub: `${RASOI_AREA.name}, ${RASOI_AREA.city}` });
      dlg.close();
    }));
    const geo = dlg.querySelector('#guestGeo');
    if (geo) geo.addEventListener('click', () => UI.busy(geo, async () => {
      try {
        const pos = await Maps.currentPosition();
        App.setGuestOrigin({ lat: pos.lat, lng: pos.lng, label: 'Current location', sub: 'Near you' });
        dlg.close();
      } catch (e) { UI.error(e); }
    }));
  }

  // Make sure a customer has an address before booking. Resolves to the default address or null.
  async function ensure() {
    const u = App.session.user;
    if (u && (u.addresses || []).length) return (u.addresses.find(x => x.id === u.defaultAddressId) || u.addresses[0]);
    const user = await openEditor(null);
    return user ? (user.addresses.find(x => x.id === user.defaultAddressId) || user.addresses[0]) : null;
  }

  window.AddressBook = { openSwitcher, openEditor, openGuest, ensure, addrTitle, addrLine, labelIcon };
})();
