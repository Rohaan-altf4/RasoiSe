// Chef dashboard: today's manifest + prep sheet + dispatch, upcoming days, complaints,
// reviews (with replies) and earnings/payouts. Built to be easy on a phone.

(async function () {
  const { esc, icon, money } = UI;
  await App.init({ active: 'chef-today', requireRole: ['chef'] });

  let kitchen = null;
  const state = { date: UI.qs('date') || App.session.today, slot: '', manifest: null };

  const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

  // ---------- Kitchen status strip ----------
  async function loadKitchen() {
    try {
      const res = await API.get('/api/chef/kitchen');
      kitchen = res.kitchen;
      renderStatus();
    } catch (e) {
      document.getElementById('kitchenStatus').innerHTML = `<div class="alert alert-danger">${icon('circle-alert')}<div>${esc(e.message)}</div></div>`;
      UI.icons(document.getElementById('kitchenStatus'));
    }
  }

  function renderStatus() {
    document.getElementById('kitchenName').textContent = kitchen.name;
    const host = document.getElementById('kitchenStatus');
    const parts = [];
    if (kitchen.status === 'pending') parts.push(`<div class="alert alert-warning">${icon('hourglass')}<div><div class="a-title">Waiting for approval</div>The RasoiSe team is checking your kitchen. Meanwhile, set up your menu, photos and UPI.</div><a class="btn btn-secondary btn-sm" href="/chef-settings.html">Set up kitchen</a></div>`);
    if (kitchen.status === 'rejected') parts.push(`<div class="alert alert-danger">${icon('circle-x')}<div><div class="a-title">Your application needs changes</div>${esc(kitchen.statusNote)}</div><a class="btn btn-secondary btn-sm" href="/chef-settings.html">Update kitchen</a></div>`);
    if (kitchen.status === 'banned') parts.push(`<div class="alert alert-danger">${icon('ban')}<div><div class="a-title">Your kitchen is suspended</div>${esc(kitchen.statusNote)} Contact RasoiSe support to appeal.</div></div>`);
    if (kitchen.status === 'approved' && kitchen.paused) parts.push(`<div class="alert alert-info">${icon('circle-pause')}<div><div class="a-title">New orders are paused</div>Existing orders and plans still need to be cooked.</div></div>`);
    const lastWarn = (kitchen.warnings || []).slice(-1)[0];
    if (lastWarn && Date.now() - new Date(lastWarn.at).getTime() < 14 * 86400000) parts.push(`<div class="alert alert-warning">${icon('triangle-alert')}<div><div class="a-title">Warning from RasoiSe · ${UI.relTime(lastWarn.at)}</div>${esc(lastWarn.reason)}</div></div>`);
    const month = App.session.today.slice(0, 7);
    const strikes = (kitchen.strikes || []).filter(x => new Date(Date.parse(x.at) + 19800e3).toISOString().slice(0, 7) === month).length;
    if (strikes) parts.push(`<div class="alert ${strikes >= 3 ? 'alert-danger' : 'alert-warning'}">${icon('calendar-x')}<div><div class="a-title"><span>Late cancellations this month: ${strikes} of 3</span></div><span>Cancelling with less than ${kitchen.noticeHours || 24} hours' notice gives customers a ₹${kitchen.goodwillCredit || 20} credit from your earnings. Three in a month brings a warning.</span></div></div>`);
    host.innerHTML = parts.length ? `<div style="display:grid;gap:10px;margin-bottom:var(--s4)">${parts.join('')}</div>` : '';
    UI.icons(host);
    const pb = document.getElementById('pauseBtn');
    pb.hidden = kitchen.status !== 'approved';
    pb.innerHTML = kitchen.paused ? `${icon('play')}Take orders again` : `${icon('pause')}Pause new orders`;
    UI.icons(pb);
  }

  document.getElementById('pauseBtn').addEventListener('click', async e => {
    const pausing = !kitchen.paused;
    if (pausing) {
      const yes = await UI.confirm({ title: 'Pause new orders?', body: 'Customers won\'t be able to book new meals or start plans. Meals already booked still need cooking.', confirmText: 'Pause orders' });
      if (!yes) return;
    }
    UI.busy(e.currentTarget, async () => {
      try {
        const res = await API.post('/api/chef/pause', { paused: pausing });
        kitchen = res.kitchen;
        renderStatus();
        UI.toast(pausing ? 'New orders paused' : 'You\'re taking orders again');
      } catch (err) { UI.error(err); }
    });
  });

  // ---------- Tabs (hash based so notifications can deep-link) ----------
  function currentTab() {
    const h = location.hash.replace('#', '');
    return h.split('/')[0] || 'today';
  }

  function showTab() {
    const t = currentTab();
    document.querySelectorAll('[data-tab]').forEach(a => a.setAttribute('aria-selected', String(a.dataset.tab === t)));
    document.querySelectorAll('[data-panel]').forEach(p => { p.hidden = p.dataset.panel !== t; });
    document.getElementById('pageTitle').textContent = { today: 'Today', upcoming: 'Upcoming', tickets: 'Complaints', reviews: 'Reviews', earnings: 'Earnings' }[t] || 'Today';
    ({ today: loadManifest, upcoming: loadUpcoming, tickets: loadTickets, reviews: loadReviews, earnings: loadEarnings }[t] || loadManifest)();
  }
  window.addEventListener('hashchange', showTab);

  // ---------- Today: manifest ----------
  const today = document.getElementById('tab-today');

  async function loadManifest() {
    if (!state.manifest) today.innerHTML = UI.skeletonRows(5);
    try {
      state.manifest = await API.get(`/api/chef/manifest?date=${state.date}${state.slot ? `&slot=${state.slot}` : ''}`);
      renderManifest();
    } catch (e) {
      today.innerHTML = UI.errorState(e.message, '<button class="btn btn-secondary" data-action="reload-manifest">Try again</button>');
      UI.icons(today);
    }
  }
  UI.on('reload-manifest', loadManifest);

  function dayTitle(d) {
    if (d === App.session.today) return 'Today';
    if (d === addDays(App.session.today, 1)) return 'Tomorrow';
    if (d === addDays(App.session.today, -1)) return 'Yesterday';
    return UI.date(d, { weekday: 'long' });
  }

  function metric(label, value, sub = '', tone = '') {
    return `<div class="card card-pad"><div class="stat"><span class="stat-label">${label}</span><span class="stat-value ${tone}">${value}</span>${sub ? `<span class="text-xs text-subtle">${sub}</span>` : ''}</div></div>`;
  }

  function renderManifest() {
    const m = state.manifest;
    const c = m.counts;
    const isToday = m.date === App.session.today;
    const future = m.date > App.session.today;
    const pending = m.orders.filter(o => ['scheduled', 'preparing', 'out_for_delivery'].includes(o.status));
    const next = (st) => m.orders.filter(o => o.status === st).length;
    const choiceRows = Object.entries(c.choices).filter(([, opts]) => Object.keys(opts).length);
    const flags = [
      c.jain ? `${c.jain} Jain` : '', c.noOnionGarlic ? `${c.noOnionGarlic} no onion-garlic` : '',
      c.noRice ? `${c.noRice} no rice` : '', c.spice.mild ? `${c.spice.mild} mild` : '', c.spice.spicy ? `${c.spice.spicy} extra spicy` : ''
    ].filter(Boolean);
    const allergies = Object.entries(c.allergies);

    today.innerHTML = `
      <div class="flex flex-wrap items-center justify-between gap-3 no-print" style="margin-bottom:var(--s4)">
        <div class="flex items-center gap-1">
          <button type="button" class="btn btn-ghost btn-icon btn-sm" data-day="-1" aria-label="Previous day">${icon('chevron-left')}</button>
          <label class="sr-only" for="mDate">Date</label>
          <input id="mDate" type="date" class="input" value="${m.date}" style="min-height:36px;width:auto">
          <button type="button" class="btn btn-ghost btn-icon btn-sm" data-day="1" aria-label="Next day">${icon('chevron-right')}</button>
          ${isToday ? '' : '<button type="button" class="btn btn-ghost btn-sm" data-day="0">Today</button>'}
        </div>
        <div class="segmented" role="group" aria-label="Slot" style="min-width:220px">
          ${[['', 'All'], ['lunch', 'Lunch'], ['dinner', 'Dinner']].map(([v, l]) => `<button type="button" data-slot="${v}" aria-pressed="${state.slot === v}">${l}</button>`).join('')}
        </div>
      </div>

      <div class="status-strip ${m.cutoffPassed ? 'alert-warning' : 'alert-success'}" style="border:1px solid;margin-bottom:var(--s4)">
        ${icon(m.cutoffPassed ? 'lock' : 'clock')}
        <span>${m.closed ? esc(m.closed) : m.cutoffPassed
          ? `<strong>${dayTitle(m.date)}'s orders are locked</strong> (cutoff ${UI.time12(m.cutoffTime)}). Cook for the numbers below.`
          : `<strong>Orders still open</strong> until ${UI.time12(m.cutoffTime)}${isToday ? ' today' : ` on ${UI.date(m.date)}`}. Numbers can change.`}</span>
      </div>

      <h2 class="sr-only">Prep counts for ${dayTitle(m.date)}</h2>
      <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        ${metric('Meals to cook', c.total, `${c.delivered} delivered`)}
        ${metric('Veg', c.veg, '', 'text-success')}
        ${metric('Egg / non-veg', c.egg + c.nonveg, c.nonveg ? `${c.nonveg} non-veg` : '')}
        ${metric('Rotis', c.rotis, 'from preferences')}
        ${metric('Paused / cancelled', c.paused + c.cancelled, 'not cooking these')}
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-4" style="margin-top:var(--s4)">
        <section class="card card-pad" aria-labelledby="prepTitle">
          <div class="flex items-center justify-between"><h2 class="title" id="prepTitle">Prep sheet</h2><button type="button" class="btn btn-ghost btn-sm no-print" onclick="window.print()">${icon('printer')}Print</button></div>
          ${m.menu.courses.length ? `
          <table class="table" style="margin-top:10px">
            <tbody>
              ${m.menu.courses.map(course => {
                const counts = c.choices[course.label] || {};
                return `<tr><td class="text-subtle" style="width:120px">${esc(course.label)}</td><td>${course.options.map(o => `<div class="flex justify-between gap-2"><span>${esc(o)}</span><strong class="num">${counts[o] || 0}</strong></div>`).join('')}</td></tr>`;
              }).join('')}
              ${Object.keys(c.addons).length ? `<tr><td class="text-subtle">Extras</td><td>${Object.entries(c.addons).map(([n, q]) => `<div class="flex justify-between"><span>${esc(n)}</span><strong class="num">${q}</strong></div>`).join('')}</td></tr>` : ''}
            </tbody>
          </table>` : `<p class="text-sm text-muted">No menu set for this day. <a class="link" href="/chef-settings.html#menu">Add it</a></p>`}
          ${flags.length || allergies.length ? `<div style="margin-top:12px" class="flex flex-wrap gap-2">${flags.map(f => `<span class="badge badge-warning">${esc(f)}</span>`).join('')}${allergies.map(([a, n]) => `<span class="badge badge-danger">${icon('triangle-alert')}${n} allergic to ${esc(a)}</span>`).join('')}</div>` : ''}
        </section>
        <section class="card card-pad no-print" id="routeCard" aria-labelledby="routeTitle">
          <h2 class="title" id="routeTitle">Dispatch</h2>
          ${future ? `<p class="text-sm text-muted">You can update statuses on the day.</p>` : pending.length ? `
            <p class="text-sm text-muted" style="margin:6px 0 12px">Move everything for ${state.slot || 'all slots'} to the next step in one tap. Customers are notified.</p>
            <div style="display:grid;gap:8px">
              <button type="button" class="btn btn-secondary btn-block" data-bulk="preparing" ${next('scheduled') ? '' : 'disabled'}>${icon('chef-hat')}Start cooking all (${next('scheduled')})</button>
              <button type="button" class="btn btn-secondary btn-block" data-bulk="out_for_delivery" ${next('scheduled') + next('preparing') ? '' : 'disabled'}>${icon('bike')}Send all out for delivery (${next('scheduled') + next('preparing')})</button>
              <button type="button" class="btn btn-success btn-block" data-bulk="delivered" ${pending.length ? '' : 'disabled'}>${icon('check-check')}Mark all delivered (${pending.length})</button>
            </div>` : `<p class="text-sm text-muted">${c.total ? 'All done for this day.' : 'No meals to send.'}</p>`}
          <div id="deliveryMapHost"></div>
        </section>
      </div>

      <section style="margin-top:var(--s5)" aria-labelledby="manTitle">
        <div class="section-head"><h2 class="h3" id="manTitle">Orders (${m.orders.length})</h2><span class="text-xs text-subtle no-print">${m.route.length ? 'Sorted by delivery route' : ''}</span></div>
        <div style="display:grid;gap:10px" id="manifestList">
          ${m.orders.length ? sortByRoute(m).map(orderCard).join('') : UI.empty({ icon: 'clipboard-list', title: `No orders ${dayTitle(m.date).toLowerCase() === 'today' ? 'today' : 'for this day'}`, body: kitchen && kitchen.status === 'approved' ? 'New orders and plan meals show up here as soon as they are booked.' : 'Orders start once your kitchen is approved.' })}
        </div>
      </section>`;
    UI.icons(today);
    wireManifest();
    if (window.Maps && m.kitchenLocation && !future) Maps.renderDeliveryMap(document.getElementById('deliveryMapHost'), m);
  }

  function sortByRoute(m) {
    const pos = new Map(m.route.map((r, i) => [r.orderId, i]));
    const order = { scheduled: 0, preparing: 0, out_for_delivery: 0, delivered: 2, paused: 3, cancelled: 3, holiday: 3 };
    return m.orders.slice().sort((a, b) => (order[a.status] - order[b.status]) || ((pos.has(a.id) ? pos.get(a.id) : 999) - (pos.has(b.id) ? pos.get(b.id) : 999)));
  }

  const NEXT = {
    scheduled: ['preparing', 'Start cooking', 'chef-hat', 'btn-secondary'],
    preparing: ['out_for_delivery', 'Out for delivery', 'bike', 'btn-primary'],
    out_for_delivery: ['delivered', 'Mark delivered', 'check', 'btn-success']
  };

  function orderCard(o) {
    const n = NEXT[o.status];
    const a = o.address || {};
    const inactive = ['paused', 'cancelled', 'holiday'].includes(o.status);
    const stop = state.manifest.route.findIndex(r => r.orderId === o.id);
    const canAct = n && state.manifest.date <= App.session.today;
    return `
      <article class="card" style="${inactive ? 'opacity:.6' : ''}" data-oid="${o.id}">
        <div class="card-pad">
          <div class="flex items-start justify-between gap-3">
            <div style="min-width:0">
              <div class="flex items-center gap-2 flex-wrap">
                ${stop > -1 && !inactive ? `<span class="badge badge-dark" title="Drop number">#${stop + 1}</span>` : ''}
                <strong>${esc(o.customerName)}</strong>${UI.foodMark(o.mealType)}
                <span class="text-xs text-subtle">${esc(o.code)} · ${o.slot} · ${o.type === 'subscription' ? 'plan' : o.type}</span>
                ${o.isMakeup ? `<span class="badge badge-saffron">${icon('calendar-plus')}Make-up day</span>` : ''}
                ${o.customerAway ? `<span class="badge badge-warning">${icon('door-closed')}Customer away</span>` : ''}
                ${o.keepForPickup ? `<span class="badge badge-neutral">${icon('package')}Keep for pickup</span>` : ''}
                ${o.outcome === 'not_available' ? `<span class="badge badge-neutral">${icon('user-x')}Not available</span>` : ''}
              </div>
              <div class="text-sm" style="margin-top:4px" translate="no">${esc([a.flat, a.building].filter(Boolean).join(', '))}${a.landmark ? `<span class="text-subtle"> · ${esc(a.landmark)}</span>` : ''}</div>
            </div>
            ${UI.statusBadge(o.status)}
          </div>
          ${inactive ? '' : `
          <div class="text-sm" style="margin-top:8px">${Object.values(o.choices || {}).map(esc).join(' · ')}</div>
          ${(o.addons || []).length ? `<div class="text-sm" style="margin-top:4px"><strong>+ ${o.addons.map(x => `${esc(x.name)} × ${x.qty}`).join(', ')}</strong></div>` : ''}
          ${o.dietaryNotes.length ? `<div class="flex flex-wrap gap-1" style="margin-top:8px">${o.dietaryNotes.map(d => `<span class="badge ${/Allergy/.test(d) ? 'badge-danger' : 'badge-warning'}">${esc(d)}</span>`).join('')}</div>` : ''}
          ${o.note ? `<div class="panel text-sm" style="margin-top:8px">${icon('message-square-text', 'icon-xs')} ${esc(o.note)}</div>` : ''}
          <div class="flex flex-wrap gap-2 no-print" style="margin-top:12px">
            ${canAct ? `<button type="button" class="btn ${n[3]} btn-sm" data-next="${n[0]}">${icon(n[2])}${n[1]}</button>` : ''}
            ${o.customerPhone ? `<a class="btn btn-ghost btn-sm" href="tel:+91${esc(o.customerPhone)}">${icon('phone')}Call</a>` : ''}
            ${canAct && o.status === 'out_for_delivery' ? `<button type="button" class="btn btn-ghost btn-sm" data-oact="not-available">${icon('user-x')}Not available</button>` : ''}
            ${o.customerAway && !o.keepForPickup && ['scheduled', 'preparing', 'out_for_delivery'].includes(o.status) ? `<button type="button" class="btn btn-ghost btn-sm" data-oact="pickup">${icon('package')}Keep for pickup</button>` : ''}
            ${['scheduled', 'preparing'].includes(o.status) && o.date >= App.session.today ? `<button type="button" class="btn btn-ghost btn-sm text-danger" data-oact="cancel">${icon('x')}Cancel meal</button>` : ''}
            ${a.lat ? `<a class="btn btn-ghost btn-sm" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${a.lat},${a.lng}&travelmode=driving">${icon('navigation')}Navigate</a>` : ''}
          </div>`}
        </div>
      </article>`;
  }

  function wireManifest() {
    today.querySelectorAll('[data-day]').forEach(b => b.addEventListener('click', () => {
      const n = Number(b.dataset.day);
      state.date = n === 0 ? App.session.today : addDays(state.date, n);
      history.replaceState({}, '', `?date=${state.date}#today`);
      loadManifest();
    }));
    const dateInput = today.querySelector('#mDate');
    dateInput.addEventListener('change', () => { if (dateInput.value) { state.date = dateInput.value; loadManifest(); } });
    today.querySelectorAll('[data-slot]').forEach(b => b.addEventListener('click', () => { state.slot = b.dataset.slot; loadManifest(); }));
    today.querySelectorAll('[data-next]').forEach(b => b.addEventListener('click', () => UI.busy(b, async () => {
      const id = Number(b.closest('[data-oid]').dataset.oid);
      try {
        await API.post(`/api/chef/orders/${id}/status`, { status: b.dataset.next });
        UI.toast(b.dataset.next === 'delivered' ? 'Delivered. Payment added to your earnings.' : 'Updated. The customer has been notified.');
        await loadManifest();
      } catch (err) { UI.error(err); }
    })));
    today.querySelectorAll('[data-oact]').forEach(b => b.addEventListener('click', () => orderAction(b)));
    today.querySelectorAll('[data-bulk]').forEach(b => b.addEventListener('click', async () => {
      const labels = { preparing: 'start cooking all meals', out_for_delivery: 'send all meals out for delivery', delivered: 'mark all meals delivered' };
      const yes = await UI.confirm({ title: 'Update all orders?', body: `This will ${labels[b.dataset.bulk]} for ${state.slot || 'every slot'} on ${UI.date(state.date)}. Every customer gets a notification.`, confirmText: 'Update all' });
      if (!yes) return;
      UI.busy(b, async () => {
        try {
          const res = await API.post('/api/chef/dispatch', { date: state.date, slot: state.slot || null, status: b.dataset.bulk });
          UI.toast(`${res.updated} order${res.updated === 1 ? '' : 's'} updated`);
          await loadManifest();
        } catch (err) { UI.error(err); }
      });
    }));
  }

  // Is this meal inside the kitchen's notice window? (slot start minus noticeHours, IST)
  function isLate(o) {
    const t = (kitchen.slotTimes || {})[o.slot] || (o.slot === 'lunch' ? '12:30' : '19:30');
    return Date.parse(`${o.date}T${t}:00+05:30`) - (kitchen.noticeHours || 24) * 3600e3 < Date.now();
  }

  async function orderAction(b) {
    const id = Number(b.closest('[data-oid]').dataset.oid);
    const o = state.manifest.orders.find(x => x.id === id);
    const act = b.dataset.oact;
    let body = {};
    if (act === 'not-available') {
      const yes = await UI.confirm({ title: 'Customer not available?', body: 'The meal counts as delivered and is paid to you. The customer is told. Three in a month and RasoiSe follows up with them.', confirmText: 'Mark not available' });
      if (!yes) return;
    }
    if (act === 'cancel') {
      const late = isLate(o);
      const reason = await UI.prompt({
        title: late ? 'Emergency cancellation' : 'Cancel this meal?',
        body: late
          ? `Less than ${kitchen.noticeHours || 24} hours' notice. The customer gets their money back plus a ₹${kitchen.goodwillCredit || 20} credit from your earnings, and this counts as a late cancellation.`
          : 'Plan customers get a make-up day at the end of their plan (or a refund if they prefer). Single orders are refunded.',
        label: 'Reason for the customer', placeholder: 'e.g. Family emergency', confirmText: 'Cancel meal', danger: true, required: late, minLength: late ? 5 : 0
      });
      if (reason == null) return;
      body = { reason };
    }
    UI.busy(b, async () => {
      try {
        const res = await API.post(`/api/chef/orders/${id}/${act}`, body);
        if (act === 'cancel') UI.toast(res.late ? `Cancelled. ₹${res.goodwill} goodwill credit given to the customer.` : 'Cancelled. The customer has been told.');
        else UI.toast(act === 'pickup' ? 'Noted. The customer knows to collect it.' : 'Marked as not available. Payment added to your earnings.');
        await Promise.all([loadManifest(), loadKitchen()]);
      } catch (err) { UI.error(err); }
    });
  }

  // ---------- Upcoming ----------
  const upcoming = document.getElementById('tab-upcoming');
  async function loadUpcoming() {
    upcoming.innerHTML = UI.skeletonRows(4);
    try {
      const res = await API.get('/api/chef/schedule');
      upcoming.innerHTML = `
        <div class="flex flex-wrap items-center justify-between gap-3" style="margin-bottom:12px">
          <p class="text-muted" style="margin:0">${res.subscribers} active plan${res.subscribers === 1 ? '' : 's'}. Tap a day to see its orders.</p>
          <a class="btn btn-secondary btn-sm" href="/chef-settings.html#holidays">${icon('palmtree')}Add a day off</a>
        </div>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Day</th><th class="right">Lunch</th><th class="right">Dinner</th><th class="right">Skipped</th><th></th></tr></thead>
          <tbody>${res.days.map(d => {
            const cell = s => !s.offered ? '<span class="text-subtle">–</span>' : `<strong class="num">${s.meals}</strong><span class="text-subtle num"> / ${s.capacity}</span>${s.meals >= s.capacity ? ' <span class="badge badge-danger">Full</span>' : ''}`;
            return `<tr>
              <td><strong>${dayTitle(d.date)}</strong><div class="text-xs text-subtle">${UI.date(d.date)}</div></td>
              ${d.closed ? `<td colspan="3" class="text-muted">${icon('palmtree', 'icon-xs')} ${esc(d.holiday && d.holiday.reason ? d.holiday.reason : d.closed)}</td>` : `<td class="right">${cell(d.slots.lunch)}</td><td class="right">${cell(d.slots.dinner)}</td><td class="right num">${d.slots.lunch.paused + d.slots.dinner.paused}</td>`}
              <td class="right"><a class="btn btn-ghost btn-sm" href="?date=${d.date}#today">View</a></td>
            </tr>`;
          }).join('')}</tbody>
        </table></div>`;
      UI.icons(upcoming);
      upcoming.querySelectorAll('a[href^="?date="]').forEach(a => a.addEventListener('click', e => {
        e.preventDefault();
        state.date = a.getAttribute('href').slice(6, 16);
        history.pushState({}, '', a.getAttribute('href'));
        showTab();
      }));
    } catch (e) {
      upcoming.innerHTML = UI.errorState(e.message);
      UI.icons(upcoming);
    }
  }

  // ---------- Complaints ----------
  const ticketsHost = document.getElementById('tab-tickets');
  async function loadTickets() {
    const id = Number(location.hash.split('/')[1]);
    ticketsHost.innerHTML = UI.skeletonRows(3);
    try {
      if (id) {
        const { ticket } = await API.get(`/api/tickets/${id}`);
        ticketsHost.innerHTML = `<a href="#tickets" class="btn btn-ghost btn-sm" style="margin:-8px 0 12px -8px">${icon('arrow-left')}All complaints</a><div class="card card-pad" id="chefThread"></div>
          <p class="text-xs text-subtle" style="margin-top:10px">Reply kindly and say what you'll fix. If you and the customer can't agree, either of you can ask RasoiSe to step in. Refunds are decided by RasoiSe.</p>`;
        UI.icons(ticketsHost);
        Tickets.renderThread(ticketsHost.querySelector('#chefThread'), ticket, { role: 'chef', onChange: refreshTicketCount });
        return;
      }
      const res = await API.get('/api/tickets');
      updateTicketCount(res.tickets);
      ticketsHost.innerHTML = res.tickets.length
        ? `<div style="display:grid;gap:10px">${res.tickets.map(t => Tickets.listItem(t, 'chef', `#tickets/${t.id}`)).join('')}</div>`
        : UI.empty({ icon: 'smile', title: 'No complaints', body: 'When a customer reports a problem with an order, it shows up here for you to reply.' });
      UI.icons(ticketsHost);
    } catch (e) {
      ticketsHost.innerHTML = UI.errorState(e.message);
      UI.icons(ticketsHost);
    }
  }

  function updateTicketCount(list) {
    const open = list.filter(t => ['open', 'escalated'].includes(t.status)).length;
    const el = document.getElementById('ticketCount');
    el.hidden = !open;
    el.textContent = open;
  }
  async function refreshTicketCount() {
    try { updateTicketCount((await API.get('/api/tickets')).tickets); } catch (e) { /* ignore */ }
  }

  // ---------- Reviews ----------
  const reviewsHost = document.getElementById('tab-reviews');
  async function loadReviews() {
    reviewsHost.innerHTML = UI.skeletonRows(3);
    try {
      const res = await API.get('/api/chef/reviews');
      const s = kitchen ? kitchen.stats : null;
      reviewsHost.innerHTML = `
        ${s && s.reviewsCount ? `<div class="grid grid-cols-3 gap-3" style="margin-bottom:var(--s4)">${metric('Rating', s.rating, `${s.reviewsCount} reviews`)}${metric('Hygiene', s.hygiene)}${metric('Taste', s.taste)}</div>` : ''}
        ${res.reviews.length ? `<div style="display:grid;gap:10px">${res.reviews.map(r => `
          <article class="card card-pad" data-rid="${r.id}">
            <div class="flex items-start justify-between gap-2">
              <div><strong>${esc(r.customerName)}</strong> <span class="text-xs text-subtle">· ${UI.relTime(r.createdAt)}${r.orderCode ? ` · ${esc(r.orderCode)}` : ''}</span></div>
              ${UI.ratingPill(r.rating)}
            </div>
            <p style="margin:8px 0 0">${esc(r.comment)}</p>
            <div class="text-xs text-subtle" style="margin-top:6px">Hygiene ${r.hygiene}★ · Taste ${r.taste}★${r.tags.length ? ` · ${r.tags.map(esc).join(', ')}` : ''}</div>
            ${r.reply ? `<div class="panel text-sm" style="margin-top:10px"><strong>Your reply</strong><p style="margin:4px 0 0">${esc(r.reply.body)}</p></div>` : `
            <form class="reply-form" style="margin-top:10px" novalidate>
              <label class="sr-only" for="rep-${r.id}">Reply publicly</label>
              <textarea id="rep-${r.id}" class="textarea" name="body" maxlength="600" style="min-height:64px" placeholder="Reply publicly, e.g. thank them or explain what you'll change"></textarea>
              <button type="submit" class="btn btn-secondary btn-sm" style="margin-top:6px">${icon('send')}Post reply</button>
            </form>`}
          </article>`).join('')}</div>` : UI.empty({ icon: 'star', title: 'No reviews yet', body: 'Customers can review a meal after it is delivered.' })}`;
      UI.icons(reviewsHost);
      reviewsHost.querySelectorAll('.reply-form').forEach(f => f.addEventListener('submit', async e => {
        e.preventDefault();
        const body = f.body.value.trim();
        if (body.length < 2) { f.body.focus(); return; }
        const id = f.closest('[data-rid]').dataset.rid;
        await UI.busy(f.querySelector('button'), async () => {
          try {
            await API.post(`/api/reviews/${id}/reply`, { body });
            UI.toast('Reply posted on your storefront');
            loadReviews();
          } catch (err) { UI.error(err); }
        });
      }));
    } catch (e) {
      reviewsHost.innerHTML = UI.errorState(e.message);
      UI.icons(reviewsHost);
    }
  }

  // ---------- Earnings ----------
  const earnHost = document.getElementById('tab-earnings');
  async function loadEarnings() {
    earnHost.innerHTML = UI.skeletonRows(4);
    try {
      const e = await API.get('/api/chef/earnings');
      const max = Math.max(1, ...e.series.map(x => x.earned));
      const label = { earning: 'Meal delivered', payout: 'Sent to UPI', clawback: 'Complaint refund' };
      earnHost.innerHTML = `
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
          ${metric('Ready to withdraw', money(e.balances.available), '', 'text-success')}
          ${metric('Today', money(e.totals.today))}
          ${metric('Last 7 days', money(e.totals.last7))}
          ${metric('Meals delivered', e.totals.mealsDelivered, `${money(e.totals.paidOut)} paid out so far`)}
        </div>
        <div class="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-4" style="margin-top:var(--s4)">
          <section class="card card-pad" aria-labelledby="chartTitle">
            <h2 class="title" id="chartTitle">Last 14 days</h2>
            <div class="bar-chart" style="margin-top:14px" role="img" aria-label="Daily earnings for the last 14 days">
              ${e.series.map(x => `<div class="bar${x.date === App.session.today ? ' is-today' : ''}" style="height:${Math.max(2, Math.round((x.earned / max) * 100))}%" title="${UI.date(x.date)}: ${money(x.earned)} from ${x.meals} meals"></div>`).join('')}
            </div>
            <div class="flex justify-between text-xs text-subtle" style="margin-top:6px"><span>${UI.date(e.series[0].date, { day: 'numeric', month: 'short' })}</span><span>Today</span></div>
            <p class="text-xs text-subtle" style="margin:10px 0 0">You earn the meal price minus a ${Math.round(e.commission * 100)}% RasoiSe fee, credited when you mark a meal delivered.</p>
          </section>
          <section class="card card-pad" aria-labelledby="payTitle">
            <h2 class="title" id="payTitle">Withdraw</h2>
            ${e.upi ? `
              <p class="text-sm text-muted" style="margin:6px 0 12px">To <strong>${esc(e.upi)}</strong> · <a class="link" href="/chef-settings.html#payouts">change</a></p>
              <button type="button" class="btn btn-primary btn-block" id="payoutBtn" ${e.balances.available > 0 ? '' : 'disabled'}>Withdraw ${money(e.balances.available)}</button>
              <p class="text-xs text-subtle" style="margin:8px 0 0">Payouts are simulated in this version.</p>` : `
              <p class="text-sm text-muted" style="margin:6px 0 12px">Add your UPI id to receive money.</p>
              <a class="btn btn-secondary btn-block" href="/chef-settings.html#payouts">Add UPI id</a>`}
          </section>
        </div>
        <section style="margin-top:var(--s5)" aria-labelledby="histTitle">
          <h2 class="h3" id="histTitle" style="margin-bottom:10px">History</h2>
          ${e.ledger.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>When</th><th>What</th><th class="right">Amount</th></tr></thead><tbody>
            ${e.ledger.map(t => `<tr><td class="text-subtle" style="white-space:nowrap">${UI.dateTime(t.createdAt)}</td><td><strong>${label[t.kind] || t.kind}</strong><div class="text-xs text-muted">${esc(t.note)}</div></td><td class="right num ledger-amt ${t.available > 0 ? 'pos' : 'neg'}">${t.available > 0 ? '+' : '−'}${money(Math.abs(t.available))}</td></tr>`).join('')}
          </tbody></table></div>` : UI.empty({ icon: 'indian-rupee', title: 'No earnings yet', body: 'Mark meals as delivered and your earnings appear here.' })}
        </section>`;
      UI.icons(earnHost);
      const pb = earnHost.querySelector('#payoutBtn');
      if (pb) pb.addEventListener('click', async () => {
        const yes = await UI.confirm({ title: `Withdraw ${money(e.balances.available)}?`, body: `It will be sent to ${esc(e.upi)}.`, confirmText: 'Withdraw' });
        if (!yes) return;
        UI.busy(pb, async () => {
          try {
            const res = await API.post('/api/chef/payout');
            UI.toast(`${money(res.amount)} sent to ${e.upi} (ref ${res.ref})`);
            loadEarnings();
          } catch (err) { UI.error(err); }
        });
      });
    } catch (err) {
      earnHost.innerHTML = UI.errorState(err.message);
      UI.icons(earnHost);
    }
  }

  // ---------- Live ----------
  if (window.Live) {
    Live.on('orders', () => { if (currentTab() === 'today') loadManifest(); if (currentTab() === 'upcoming') loadUpcoming(); });
    Live.on('tickets', () => { if (currentTab() === 'tickets') loadTickets(); else refreshTicketCount(); });
    Live.on('reviews', () => { if (currentTab() === 'reviews') loadReviews(); });
    Live.on('earnings', () => { if (currentTab() === 'earnings') loadEarnings(); });
    Live.on('kitchen', loadKitchen);
  }

  await loadKitchen();
  refreshTicketCount();
  showTab();
})();
