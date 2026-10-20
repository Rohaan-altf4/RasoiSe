// Chef registration wizard: account -> kitchen -> delivery area -> price & menu -> submit.
// Creates the chef account + a pending kitchen; admin approves it before it goes live.

(async function () {
  const { esc, icon, money } = UI;
  const session = await App.init({ active: 'partner' });
  const form = document.getElementById('wizard');

  if (session.user) {
    if (session.user.role === 'chef') { location.replace('/chef-dashboard.html'); return; }
    form.hidden = true;
    const note = document.getElementById('signedInNote');
    note.hidden = false;
    note.innerHTML = `<div class="alert alert-info">${icon('info')}<div>You're signed in as <strong>${esc(session.user.name)}</strong> (${esc(session.user.role)}). Sign out first to register a kitchen with a separate partner account.</div><button class="btn btn-secondary btn-sm" id="soBtn">Sign out</button></div>`;
    UI.icons(note);
    document.getElementById('soBtn').addEventListener('click', async () => { await API.post('/api/auth/logout'); location.reload(); });
    return;
  }

  const config = await API.get('/api/config');
  let step = 1;
  let preset = 'north_indian';
  let pinned = null; // { lat, lng, formatted } from the map, when maps are available

  // Cuisine chips
  const CUISINES = ['North Indian', 'Gujarati', 'Punjabi', 'Maharashtrian', 'South Indian', 'Bengali', 'Rajasthani', 'Sindhi', 'Jain', 'Healthy'];
  document.getElementById('cuisineChips').innerHTML = CUISINES.map(c => `<label class="chip"><input type="checkbox" name="cuisines" value="${c}">${c}</label>`).join('');

  // Locality list (replaced by a map pin when maps are loaded)
  const loc = document.getElementById('locality');
  loc.innerHTML += config.localities.map(l => `<option value="${esc(l.name)}">${esc(l.name)}</option>`).join('');
  if (window.Maps) {
    document.getElementById('localityField').hidden = true;
    Maps.kitchenPicker(document.getElementById('kitchenPinHost'), null, Number(form.radius.value), p => { pinned = p; });
  }

  // Radius label
  const radius = form.radius;
  function syncRadius() {
    document.getElementById('radiusOut').textContent = `${(radius.value / 1000).toFixed(1)} km`;
    document.getElementById('radiusMins').textContent = Math.round((radius.value * 1.3) / 80);
    if (window.Maps && Maps.setPickerRadius) Maps.setPickerRadius(Number(radius.value));
  }
  radius.addEventListener('input', syncRadius);
  syncRadius();

  // Cover photo preview
  form.cover.addEventListener('change', () => {
    const f = form.cover.files[0];
    const field = form.cover.closest('.field');
    field.classList.remove('has-error');
    if (!f) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(f.type)) { form.cover.value = ''; return UI.setFieldError(form, 'cover', 'Photos must be JPG, PNG or WebP.'); }
    if (f.size > 5 * 1024 * 1024) { form.cover.value = ''; return UI.setFieldError(form, 'cover', 'Photo must be under 5 MB.'); }
    document.getElementById('coverPreview').src = URL.createObjectURL(f);
  });

  // Price hints
  function priceHints() {
    const p5 = Number(form.plan5.value);
    const p7 = Number(form.plan7.value);
    document.getElementById('p5hint').textContent = p5 ? `${money(Math.round(p5 / 22))} per meal` : '';
    document.getElementById('p7hint').textContent = p7 ? `${money(Math.round(p7 / 30))} per meal` : '';
  }
  ['plan5', 'plan7'].forEach(n => form[n].addEventListener('input', priceHints));
  form.single.addEventListener('change', () => {
    const s = Number(form.single.value);
    if (s >= 40) {
      form.trial.value = Math.round(s * 0.8 / 5) * 5;
      form.plan5.value = Math.round(s * 22 * 0.86 / 10) * 10;
      form.plan7.value = Math.round(s * 30 * 0.84 / 10) * 10;
      priceHints();
    }
  });
  priceHints();

  // Menu preset preview
  function renderPresets() {
    document.getElementById('presetChips').innerHTML = Object.entries(MenuPresets).map(([k, p]) =>
      `<button type="button" class="chip${k === preset ? ' is-active' : ''}" aria-pressed="${k === preset}" data-preset="${k}">${esc(p.label)}</button>`).join('');
    const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    const w = MenuPresets[preset].weekly;
    const picked = document.querySelector('input[name="dietType"]:checked');
    const diet = picked ? picked.value : 'veg';
    document.getElementById('menuPreview').innerHTML = `<table class="table"><thead><tr><th>Day</th><th>Sabzi</th><th>Dal</th><th>Roti & rice</th><th>Thali</th></tr></thead><tbody>
      ${days.map(d => `<tr><td style="font-weight:600;text-transform:capitalize">${d.slice(0, 3)}</td>${w[d].courses.slice(0, 3).map(c => `<td>${esc(c.options.join(' / '))}</td>`).join('')}<td>${UI.thaliTag(UI.menuType(w[d].courses, [], diet))}</td></tr>`).join('')}
    </tbody></table>`;
  }
  document.getElementById('presetChips').addEventListener('click', e => {
    const b = e.target.closest('[data-preset]');
    if (b) { preset = b.dataset.preset; renderPresets(); }
  });
  renderPresets();
  // The thali column depends on whether the kitchen cooks egg / non-veg
  document.querySelectorAll('input[name="dietType"]').forEach(r => r.addEventListener('change', renderPresets));

  // ---------- Step validation ----------
  function validate(n) {
    UI.clearErrors(form);
    const errs = [];
    const err = (name, msg) => { UI.setFieldError(form, name, msg); errs.push(name); };
    if (n === 1) {
      if (form.name.value.trim().length < 2) err('name', 'Please enter your name.');
      if (!/^[6-9]\d{9}$/.test(form.phone.value.trim())) err('phone', 'Enter a 10-digit mobile number starting with 6–9.');
      if (form.email.value && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(form.email.value.trim())) err('email', 'That email doesn\'t look right.');
      if (form.password.value.length < 8) err('password', 'At least 8 characters.');
    }
    if (n === 2) {
      if (form.kitchenName.value.trim().length < 3) err('kitchenName', 'Give your kitchen a name (3+ characters).');
      if (form.fssai.value && !/^\d{14}$/.test(form.fssai.value.trim())) err('fssai', 'FSSAI numbers are 14 digits.');
      if (form.querySelectorAll('[name="cuisines"]:checked').length > 3) { document.getElementById('cuisineErr').closest('.field').classList.add('has-error'); errs.push('cuisines'); }
    }
    if (n === 3) {
      if (window.Maps ? !pinned : !loc.value) {
        if (window.Maps) { UI.toast('Drop the pin on your kitchen first.', { type: 'error' }); errs.push('pin'); } else err('locality', 'Choose your area.');
      }
      if (!form.querySelectorAll('[name="slots"]:checked').length) { document.getElementById('slotErr').closest('.field').classList.add('has-error'); errs.push('slots'); }
      const cap = Number(form.capacity.value);
      if (!(cap >= 1 && cap <= 300)) err('capacity', 'Between 1 and 300.');
    }
    if (n === 4) {
      const rng = (name, min, max, label) => { const v = Number(form[name].value); if (!(v >= min && v <= max)) err(name, `${label} should be between ₹${min} and ₹${max}.`); };
      rng('single', 40, 1000, 'Meal price');
      rng('trial', 30, 1000, 'Trial price');
      rng('plan5', 500, 30000, 'Plan price');
      rng('plan7', 700, 40000, 'Plan price');
    }
    const first = form.querySelector('.has-error input, .has-error select');
    if (first) first.focus();
    return !errs.length;
  }

  function show(n) {
    step = n;
    form.querySelectorAll('[data-step]').forEach(fs => { fs.hidden = Number(fs.dataset.step) !== n; });
    for (let i = 1; i <= 4; i++) {
      form.querySelector(`[data-bar="${i}"]`).style.width = i <= n ? '100%' : '0';
      form.querySelector(`[data-steplabel="${i}"]`).className = i <= n ? 'text-xs' : 'text-xs text-subtle';
    }
    document.getElementById('backBtn').hidden = n === 1;
    document.getElementById('nextBtn').hidden = n === 4;
    document.getElementById('submitBtn').hidden = n !== 4;
    document.getElementById('intro').hidden = n > 1;
    if (n === 3 && window.Maps && Maps.invalidate) Maps.invalidate();
    form.scrollIntoView({ block: 'start', behavior: 'smooth' });
    const first = form.querySelector(`[data-step="${n}"] input:not([type=hidden]):not(.sr-only), [data-step="${n}"] select`);
    if (first) setTimeout(() => first.focus({ preventScroll: true }), 50);
  }

  document.getElementById('nextBtn').addEventListener('click', () => { if (validate(step)) show(step + 1); });
  document.getElementById('backBtn').addEventListener('click', () => show(step - 1));
  form.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT' && step < 4) { e.preventDefault(); document.getElementById('nextBtn').click(); }
  });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (!validate(4)) return;
    const box = document.getElementById('submitError');
    box.hidden = true;
    const l = config.localities.find(x => x.name === loc.value);
    const location = pinned
      ? { lat: pinned.lat, lng: pinned.lng, address: form.address.value || pinned.formatted, locality: pinned.locality || '' }
      : { lat: l.lat, lng: l.lng, address: form.address.value, locality: l.name };
    const fd = new FormData();
    fd.append('name', form.name.value.trim());
    fd.append('phone', form.phone.value.trim());
    fd.append('email', form.email.value.trim());
    fd.append('password', form.password.value);
    fd.append('kitchenName', form.kitchenName.value.trim());
    fd.append('bio', form.bio.value.trim());
    fd.append('dietType', form.dietType.value);
    fd.append('cuisines', JSON.stringify([...form.querySelectorAll('[name="cuisines"]:checked')].map(c => c.value)));
    fd.append('fssai', form.fssai.value.trim());
    fd.append('location', JSON.stringify(location));
    fd.append('radiusM', form.radius.value);
    fd.append('slots', JSON.stringify([...form.querySelectorAll('[name="slots"]:checked')].map(c => c.value)));
    fd.append('capacity', form.capacity.value);
    fd.append('pricing', JSON.stringify({ single: Number(form.single.value), trial: Number(form.trial.value), plan5: Number(form.plan5.value), plan7: Number(form.plan7.value) }));
    fd.append('menu', JSON.stringify({ weekly: MenuPresets[preset].weekly }));
    if (form.cover.files[0]) fd.append('cover', form.cover.files[0]);

    await UI.busy(document.getElementById('submitBtn'), async () => {
      try {
        const res = await API.upload('/api/chef/register', fd);
        await App.refreshSession(); // header now shows the new chef account
        form.hidden = true;
        document.getElementById('intro').hidden = true;
        const done = document.getElementById('done');
        done.hidden = false;
        done.innerHTML = `
          <div class="card card-pad" style="padding:var(--s8);text-align:center">
            <div class="es-icon" style="width:64px;height:64px;border-radius:50%;background:var(--success-bg);color:var(--success);display:flex;align-items:center;justify-content:center;margin:0 auto 12px">${icon('check', 'icon-lg')}</div>
            <h1 class="h2">Application sent!</h1>
            <p class="text-muted" style="max-width:420px;margin:8px auto 0"><strong>${esc(res.kitchen.name)}</strong> is waiting for a quick check by the RasoiSe team, usually within a day. You'll get a notification here as soon as you're live.</p>
            <div class="panel text-sm" style="text-align:left;margin:20px auto 0;max-width:420px">
              <strong>While you wait</strong>
              <ul style="margin:6px 0 0;padding-left:18px">
                <li>Fine-tune your menu, add dish photos and extras</li>
                <li>Add your UPI id so earnings reach you</li>
                <li>Mark any days you won't cook</li>
              </ul>
            </div>
            <div class="flex flex-wrap gap-2 justify-center" style="margin-top:20px">
              <a class="btn btn-primary" href="/chef-settings.html">Set up my menu</a>
              <a class="btn btn-secondary" href="/chef-dashboard.html">Go to dashboard</a>
            </div>
          </div>`;
        UI.icons(done);
        window.scrollTo(0, 0);
      } catch (err) {
        if (err.fields) {
          // Jump back to the step with the problem
          const stepOf = { name: 1, phone: 1, email: 1, password: 1 };
          const key = Object.keys(err.fields)[0];
          if (stepOf[key]) { show(stepOf[key]); UI.showApiErrors(form, err); return; }
        }
        box.textContent = err.message;
        box.hidden = false;
      }
    });
  });
})();
