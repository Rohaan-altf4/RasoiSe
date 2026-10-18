// My meals: month/week calendar from the server, per-day meal editing (dishes, extras, note,
// slot, address, pause/resume), wallet + ledger, plans (renew, change, cancel) and holiday mode.

(async function () {
  const { esc, icon, money } = UI;
  await App.init({ active: 'meals', requireRole: ['customer'] });

  const state = { view: window.innerWidth < 768 ? 'week' : 'month', anchor: App.session.today, orders: [], holidays: [], subs: [], wallet: null };
  const cal = document.getElementById('calendar');

  // ---------- Date helpers ----------
  const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const dow = d => new Date(d + 'T00:00:00Z').getUTCDay();
  const monthStart = d => d.slice(0, 8) + '01';
  const mondayOf = d => addDays(d, -((dow(d) + 6) % 7));
  const monthName = d => new Date(d + 'T00:00:00Z').toLocaleDateString(window.I18n ? I18n.locale() : 'en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });

  function range() {
    if (state.view === 'week') {
      const from = mondayOf(state.anchor);
      return { from, to: addDays(from, 6) };
    }
    const first = monthStart(state.anchor);
    const from = mondayOf(first);
    const next = new Date(first + 'T00:00:00Z'); next.setUTCMonth(next.getUTCMonth() + 1);
    const last = addDays(next.toISOString().slice(0, 10), -1);
    return { from, to: addDays(mondayOf(last), 6) };
  }

  // ---------- Loading ----------
  async function loadCalendar() {
    const { from, to } = range();
    cal.setAttribute('aria-busy', 'true');
    try {
      const res = await API.get(`/api/calendar?from=${from}&to=${to}`);
      state.orders = res.orders;
      state.holidays = res.holidays;
      renderCalendar();
      if (dayModal.open && openDate) renderDay(openDate);
    } catch (e) {
      cal.innerHTML = UI.errorState(e.message, '<button class="btn btn-secondary" data-action="reload">Try again</button>');
      UI.icons(cal);
    } finally {
      cal.setAttribute('aria-busy', 'false');
    }
  }

  async function loadWallet() {
    try {
      const res = await API.get('/api/wallet');
      state.wallet = res;
      App.setWallet(res.balances);
      renderWallet();
      renderAlerts();
    } catch (e) {
      document.getElementById('walletBody').innerHTML = `<p class="text-sm text-danger">${esc(e.message)}</p>`;
    }
  }

  async function loadPlans() {
    try {
      const res = await API.get('/api/subscriptions');
      state.subs = res.subscriptions;
      renderPlans();
      renderAlerts();
    } catch (e) {
      document.getElementById('plansBody').innerHTML = `<p class="text-sm text-danger">${esc(e.message)}</p>`;
    }
  }

  // ---------- Calendar ----------
  function mealsOn(date) {
    return state.orders.filter(o => o.date === date);
  }

  function renderCalendar() {
    const { from, to } = range();
    document.getElementById('calTitle').textContent = state.view === 'week'
      ? `${UI.date(from, { day: 'numeric', month: 'short' })} – ${UI.date(to, { day: 'numeric', month: 'short' })}`
      : monthName(state.anchor);
    document.getElementById('monthBtn').setAttribute('aria-pressed', String(state.view === 'month'));
    document.getElementById('weekBtn').setAttribute('aria-pressed', String(state.view === 'week'));

    if (state.view === 'week') {
      const rows = [];
      for (let d = from; d <= to; d = addDays(d, 1)) rows.push(weekRow(d));
      cal.innerHTML = `<div style="display:grid;gap:8px">${rows.join('')}</div>`;
    } else {
      const month = state.anchor.slice(0, 7);
      const cells = [];
      for (let d = from; d <= to; d = addDays(d, 1)) cells.push(monthCell(d, d.slice(0, 7) !== month));
      cal.innerHTML = `
        <div class="cal-grid" role="grid" aria-label="${esc(monthName(state.anchor))}">
          ${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(x => `<div class="cal-dow" role="columnheader">${x}</div>`).join('')}
          ${cells.join('')}
        </div>`;
    }
    UI.icons(cal);
  }

  function pillText(o) {
    const what = o.status === 'holiday' ? 'Holiday' : o.status === 'paused' ? 'Skipped' : o.status === 'cancelled' ? 'Cancelled' : (o.slot === 'lunch' ? 'Lunch' : 'Dinner');
    return `${what} · ${o.kitchen ? o.kitchen.name.split(' ')[0] : ''}`;
  }

  function monthCell(d, other) {
    const meals = mealsOn(d);
    const hol = state.holidays.filter(h => h.date === d && !meals.some(m => m.kitchenId === h.kitchenId));
    const label = `${UI.date(d, { weekday: 'long', day: 'numeric', month: 'long' })}: ${meals.length ? meals.map(m => `${m.slot} ${UI.statusLabel(m.status)}`).join(', ') : 'nothing booked'}`;
    return `
      <button type="button" role="gridcell" class="cal-cell${other ? ' is-other' : ''}${d === App.session.today ? ' is-today' : ''}" data-day="${d}" aria-label="${esc(label)}">
        <span class="d-num">${Number(d.slice(8))}</span>
        <span class="d-pills">
          ${meals.map(o => `<span class="cal-pill st-${o.status}">${esc(pillText(o))}</span>`).join('')}
          ${hol.map(h => `<span class="cal-pill st-holiday">Holiday · ${esc(h.kitchenName.split(' ')[0])}</span>`).join('')}
        </span>
      </button>`;
  }

  function weekRow(d) {
    const meals = mealsOn(d);
    const hol = state.holidays.filter(h => h.date === d && !meals.some(m => m.kitchenId === h.kitchenId));
    const isToday = d === App.session.today;
    return `
      <button type="button" class="card" data-day="${d}" style="width:100%;text-align:left;padding:12px 14px;cursor:pointer;display:flex;gap:14px;align-items:flex-start;font:inherit;color:inherit;${isToday ? 'border-color:var(--brand-saffron)' : ''}">
        <span style="width:46px;flex-shrink:0;text-align:center">
          <span class="label-caps" style="display:block">${UI.date(d, { weekday: 'short' })}</span>
          <span style="font-size:20px;font-weight:700">${Number(d.slice(8))}</span>
        </span>
        <span style="flex:1;min-width:0;display:grid;gap:6px;grid-template-columns:minmax(0,1fr)">
          ${meals.length || hol.length ? '' : '<span class="text-sm text-subtle" style="padding-top:8px">Nothing booked</span>'}
          ${meals.map(o => `
            <span class="flex items-center justify-between gap-2">
              <span style="min-width:0;flex:1"><span style="font-weight:600;display:block" class="truncate">${o.slot === 'lunch' ? 'Lunch' : 'Dinner'} · ${esc(o.kitchen ? o.kitchen.name : '')}</span>
              <span class="text-xs text-subtle truncate" style="display:block">${esc(Object.values(o.choices || {}).slice(0, 3).join(', '))}</span></span>
              ${UI.statusBadge(o.status)}
            </span>`).join('')}
          ${hol.map(h => `<span class="flex items-center justify-between"><span class="text-sm">${esc(h.kitchenName)} closed${h.reason ? `: ${esc(h.reason)}` : ''}</span>${UI.statusBadge('holiday')}</span>`).join('')}
        </span>
      </button>`;
  }

  cal.addEventListener('click', e => {
    const cell = e.target.closest('[data-day]');
    if (cell) openDay(cell.dataset.day);
  });

  // ---------- Day detail ----------
  const dayModal = document.getElementById('dayModal');
  let openDate = null;
  dayModal.addEventListener('close', () => { openDate = null; });

  function openDay(d) {
    openDate = d;
    renderDay(d);
    UI.openModal(dayModal);
  }

  function renderDay(d) {
    const meals = mealsOn(d);
    const hol = state.holidays.filter(h => h.date === d);
    document.getElementById('dayTitle').textContent = UI.date(d, { weekday: 'long', day: 'numeric', month: 'long' });
    document.getElementById('daySub').textContent = meals.length ? `${meals.length} meal${meals.length > 1 ? 's' : ''}` : 'Nothing booked';
    const body = document.getElementById('dayBody');
    body.innerHTML = `
      ${hol.map(h => `<div class="alert alert-info" style="margin-bottom:12px">${icon('palmtree')}<div><strong>${esc(h.kitchenName)}</strong> is closed this day${h.reason ? `: ${esc(h.reason)}` : ''}. Any meal from them is refunded to your wallet.</div></div>`).join('')}
      ${meals.length ? meals.map(mealEditor).join('') : UI.empty({ icon: 'calendar-plus', title: 'Nothing booked', body: d < App.session.today ? 'No meals on this day.' : 'Order a single meal or start a plan with a kitchen nearby.', action: d >= App.session.today ? '<a class="btn btn-primary" href="/index.html">Find a kitchen</a>' : '' })}`;
    UI.icons(body);
    wireDay(body);
  }

  function mealEditor(o) {
    const editable = o.editable;
    const addons = [...(o.availableAddons || [])];
    if (o.special) addons.push({ id: 'special', name: `Special: ${o.special.name}`, price: o.special.price });
    const qtyOf = id => ((o.addons || []).find(a => a.id === id) || {}).qty || 0;
    const kitchenSlots = (o.kitchen && o.kitchen.slots) || [o.slot];
    const addresses = App.user.addresses || [];
    const cutoff = o.kitchen ? UI.time12(o.kitchen.cutoffTime) : '8:00 AM';
    const typeLabel = o.type === 'subscription' ? 'Plan meal' : o.type === 'trial' ? 'Trial' : 'Single meal';
    return `
      <article class="card" style="margin-bottom:12px" data-order="${o.id}">
        <div class="card-head" style="padding-bottom:0">
          <div style="min-width:0">
            <div class="flex items-center gap-2 flex-wrap"><strong>${o.slot === 'lunch' ? 'Lunch' : 'Dinner'} · ${esc(o.kitchen ? o.kitchen.name : '')}</strong>${UI.statusBadge(o.status)}${o.isMakeup ? `<span class="badge badge-saffron">${icon('calendar-plus')}Make-up day</span>` : ''}</div>
            <div class="text-xs text-subtle">${typeLabel} · ${esc(o.code)} · ${money(o.total)}${o.cancelReason ? ` · ${esc(o.cancelReason)}` : ''}</div>
          </div>
          ${['preparing', 'out_for_delivery'].includes(o.status) ? `<a class="btn btn-primary btn-sm" href="/orders.html?id=${o.id}">${icon('map')}Track</a>` : ''}
        </div>
        <div class="card-pad">
          ${editable ? `
            ${(o.courses || []).map(c => c.options.length > 1 ? `
              <fieldset style="border:0;padding:0;margin:0 0 10px">
                <legend class="text-xs text-subtle" style="margin-bottom:4px">${esc(c.label)}: pick one</legend>
                <div class="chips">${c.options.map(opt => `<label class="chip"><input type="radio" name="c-${o.id}-${esc(c.id)}" data-course="${esc(c.id)}" value="${esc(opt)}" ${(o.choices[c.id] || c.options[0]) === opt ? 'checked' : ''}>${esc(opt)}</label>`).join('')}</div>
              </fieldset>` : `<div class="text-sm" style="margin-bottom:4px"><span class="text-subtle" style="display:inline-block;width:90px">${esc(c.label)}</span>${esc(c.options[0])}</div>`).join('')}
            ${addons.length ? `
            <div style="margin-top:12px">
              <div class="field-label" style="margin-bottom:6px">Extras for this day</div>
              <div style="display:grid;gap:8px">${addons.map(a => `
                <div class="flex items-center justify-between text-sm"><span>${esc(a.name)} <span class="text-subtle">${money(a.price)}</span></span>
                  <span class="qty"><button type="button" data-addon="${esc(a.id)}" data-d="-1" aria-label="Remove one ${esc(a.name)}">−</button><span data-qty="${esc(a.id)}">${qtyOf(a.id)}</span><button type="button" data-addon="${esc(a.id)}" data-d="1" aria-label="Add one ${esc(a.name)}">+</button></span>
                </div>`).join('')}</div>
            </div>` : ''}
            <div class="form-grid cols-2" style="margin-top:12px">
              <div class="field">
                <label class="field-label" for="slot-${o.id}">Slot</label>
                <select id="slot-${o.id}" class="select" data-field="slot" ${kitchenSlots.length < 2 ? 'disabled' : ''}>
                  ${['lunch', 'dinner'].filter(s => kitchenSlots.includes(s)).map(s => `<option value="${s}" ${o.slot === s ? 'selected' : ''}>${s === 'lunch' ? 'Lunch (12:30–1:30)' : 'Dinner (7:30–8:30)'}</option>`).join('')}
                </select>
              </div>
              <div class="field">
                <label class="field-label" for="addr-${o.id}">Deliver to</label>
                <select id="addr-${o.id}" class="select" data-field="addressId">
                  ${addresses.map(a => `<option value="${a.id}" ${o.address && o.address.id === a.id ? 'selected' : ''}>${esc(AddressBook.addrTitle(a))}: ${esc(a.flat)}</option>`).join('')}
                </select>
              </div>
            </div>
            <div class="field" style="margin-top:12px">
              <label class="field-label" for="note-${o.id}">Note for the chef</label>
              <input id="note-${o.id}" class="input" data-field="note" maxlength="200" value="${esc(o.note || '')}" placeholder="e.g. less spicy today">
            </div>
            <p class="text-xs text-subtle" style="margin:10px 0 0">${icon('clock', 'icon-xs')} <span>Change by ${UI.dateTime(o.deadline)}</span></p>
            <div class="flex flex-wrap gap-2" style="margin-top:12px">
              <button type="button" class="btn btn-primary" data-act="save">Save changes</button>
              ${o.type === 'subscription' ? `<button type="button" class="btn btn-secondary" data-act="pause">${icon('calendar-x')}Skip this meal</button>` : `<button type="button" class="btn btn-danger" data-act="cancel">Cancel order</button>`}
            </div>` : `
            <div class="text-sm" style="display:grid;gap:4px">
              ${Object.entries(o.choices || {}).map(([, v]) => `<div>${esc(v)}</div>`).join('')}
              ${(o.addons || []).length ? `<div class="text-subtle">Extras: ${o.addons.map(a => `${esc(a.name)} × ${a.qty}`).join(', ')}</div>` : ''}
              ${o.note ? `<div class="text-subtle">Note: ${esc(o.note)}</div>` : ''}
            </div>
            ${o.status === 'paused' ? `
              <p class="text-sm" style="margin:10px 0 0">${icon('calendar-x', 'icon-xs')} ${o.skipCredit === 'makeup' && o.makeupDate
                ? `<span>Skipped ${UI.date(o.date)}, added on ${UI.date(o.makeupDate)}</span>`
                : o.skipCredit === 'none' ? '<span>Skipped with no make-up day left. This meal is charged.</span>' : '<span>Skipped</span>'}</p>
              ${o.changeable && o.date >= App.session.today ? `<div class="flex flex-wrap gap-2 items-center" style="margin-top:12px"><button type="button" class="btn btn-success" data-act="resume">${icon('play')}Resume this meal</button><span class="text-xs text-subtle"><span>Change by ${UI.dateTime(o.deadline)}</span></span></div>` : ''}` : ''}
            ${o.status === 'scheduled' && !editable ? `
              <p class="text-xs text-subtle" style="margin:10px 0 0">${icon('lock', 'icon-xs')} <span>Locked: changes closed ${UI.dateTime(o.deadline)}.</span></p>
              ${o.customerAway ? `<div class="alert alert-info" style="margin-top:10px">${icon('house')}<div><span>You told the kitchen you won't be home. The meal is still paid.</span>${o.keepForPickup ? ' <span>The kitchen is keeping it for you to collect.</span>' : ''}</div></div>` : ''}
              ${o.canSayAway ? `<div class="flex flex-wrap gap-2 items-center" style="margin-top:10px"><button type="button" class="btn btn-secondary btn-sm" data-act="away">${icon('door-closed')}I won't be home</button><span class="text-xs text-subtle">The kitchen won't deliver. No refund this late.</span></div>` : ''}` : ''}
            ${o.canReview ? `<button type="button" class="btn btn-secondary btn-sm" style="margin-top:12px" data-act="review">${icon('star')}Rate this meal</button>` : ''}
            ${o.review ? `<p class="text-sm" style="margin:10px 0 0">You rated it ${UI.stars(o.review.rating)}</p>` : ''}`}
        </div>
      </article>`;
  }

  function wireDay(body) {
    body.querySelectorAll('[data-order]').forEach(card => {
      const id = Number(card.dataset.order);
      const o = state.orders.find(x => x.id === id);
      const qty = {};
      (o.addons || []).forEach(a => { qty[a.id] = a.qty; });
      card.querySelectorAll('[data-addon]').forEach(b => b.addEventListener('click', () => {
        const aid = b.dataset.addon;
        qty[aid] = Math.max(0, Math.min(5, (qty[aid] || 0) + Number(b.dataset.d)));
        card.querySelector(`[data-qty="${aid}"]`).textContent = qty[aid];
      }));
      const act = name => card.querySelector(`[data-act="${name}"]`);
      if (act('save')) act('save').addEventListener('click', e => UI.busy(e.currentTarget, async () => {
        const choices = {};
        card.querySelectorAll('input[data-course]:checked').forEach(r => { choices[r.dataset.course] = r.value; });
        const payload = {
          choices,
          addons: Object.entries(qty).map(([aid, q]) => ({ id: aid, qty: q })),
          note: card.querySelector('[data-field="note"]').value
        };
        const slot = card.querySelector('[data-field="slot"]');
        if (slot && !slot.disabled) payload.slot = slot.value;
        const addr = card.querySelector('[data-field="addressId"]');
        if (addr && addr.value) payload.addressId = Number(addr.value);
        try {
          const res = await API.put(`/api/orders/${id}`, payload);
          App.setWallet(res.balances);
          UI.toast('Meal updated. The kitchen has your changes.');
          await Promise.all([loadCalendar(), loadWallet()]);
        } catch (err) {
          if (err.code === 'LOW_BALANCE') { UI.error(err); Wallet.openTopUp().then(b => b && loadWallet()); }
          else UI.error(err);
        }
      }));
      if (act('pause')) act('pause').addEventListener('click', async e => {
        const btn = e.currentTarget;
        const credit = o.skipsLeft > 0;
        const yes = await UI.confirm({
          title: 'Skip this meal?',
          body: credit
            ? `It moves to the end of your plan as a make-up day. You have ${o.skipsLeft} make-up days left on this plan.`
            : 'You have used all make-up days on this plan. The kitchen won\'t deliver, but this meal is still charged.',
          confirmText: 'Skip meal', cancelText: 'Keep it', danger: !credit
        });
        if (!yes) return;
        UI.busy(btn, async () => {
          try {
            const res = await API.post(`/api/orders/${id}/pause`);
            App.setWallet(res.balances);
            UI.toast(res.order.skipCredit === 'makeup' ? 'Skipped. Added as a make-up day at the end of your plan.' : 'Skipped. No make-up day left, so this meal is charged.');
            await Promise.all([loadCalendar(), loadWallet(), loadPlans()]);
          } catch (err) { UI.error(err); }
        });
      });
      if (act('away')) act('away').addEventListener('click', async e => {
        const btn = e.currentTarget;
        const yes = await UI.confirm({ title: 'Tell the kitchen you won\'t be home?', body: 'It\'s too late to skip with a make-up day, so the meal is still paid. The kitchen won\'t make the trip, and may keep it for you to collect.', confirmText: 'Tell the kitchen', cancelText: 'Cancel' });
        if (!yes) return;
        UI.busy(btn, async () => {
          try {
            await API.post(`/api/orders/${id}/away`);
            UI.toast('The kitchen knows you won\'t be home.');
            await loadCalendar();
          } catch (err) { UI.error(err); }
        });
      });
      if (act('resume')) act('resume').addEventListener('click', e => UI.busy(e.currentTarget, async () => {
        try {
          const res = await API.post(`/api/orders/${id}/resume`);
          App.setWallet(res.balances);
          UI.toast('Meal resumed. The kitchen will cook it.');
          await Promise.all([loadCalendar(), loadWallet(), loadPlans()]);
        } catch (err) {
          UI.error(err);
          if (err.code === 'LOW_BALANCE') Wallet.openTopUp(o.total).then(b => b && loadWallet());
        }
      }));
      if (act('cancel')) act('cancel').addEventListener('click', async e => {
        const btn = e.currentTarget;
        const yes = await UI.confirm({ title: 'Cancel this order?', body: `${money(o.total)} goes back to your wallet straight away.`, confirmText: 'Cancel order', cancelText: 'Keep it', danger: true });
        if (!yes) return;
        UI.busy(btn, async () => {
          try {
            const res = await API.post(`/api/orders/${id}/cancel`);
            App.setWallet(res.balances);
            UI.toast(`Order cancelled. ${money(o.total)} refunded to your wallet.`);
            await Promise.all([loadCalendar(), loadWallet()]);
          } catch (err) { UI.error(err); }
        });
      });
      if (act('review')) act('review').addEventListener('click', async () => {
        const r = await Review.open(o);
        if (r) loadCalendar();
      });
    });
  }

  // ---------- Wallet ----------
  function renderWallet() {
    const b = state.wallet.balances;
    const host = document.getElementById('walletBody');
    host.innerHTML = `
      <div class="flex items-end justify-between gap-3">
        <div class="stat"><span class="stat-label">Available</span><span class="stat-value">${money(b.available)}</span></div>
        <button type="button" class="btn btn-primary btn-sm" data-action="topup">${icon('plus')}Add money</button>
      </div>
      <div class="panel flex items-center justify-between text-sm" style="margin-top:12px">
        <span class="text-muted">${icon('lock', 'icon-xs')} Reserved for upcoming meals</span><strong class="num">${money(b.reserved)}</strong>
      </div>
      <p class="text-xs text-subtle" style="margin:8px 0 0">Booked meals are reserved, then charged when delivered. A skipped plan meal stays reserved for its make-up day; a cancelled meal comes back to available.</p>`;
    UI.icons(host);
  }

  function ledgerLabel(t) {
    return { topup: 'Added money', reserve: 'Reserved', release: 'Refunded', charge: 'Paid on delivery', refund: 'Refund' }[t.kind] || t.kind;
  }

  function openLedger() {
    const rows = (state.wallet ? state.wallet.ledger : []);
    const dlg = document.createElement('dialog');
    dlg.className = 'modal modal-lg';
    dlg.innerHTML = `
      <div class="modal-head"><div><h2 class="h3">Wallet history</h2><p class="text-sm text-muted" style="margin:4px 0 0">Every rupee in and out of your wallet.</p></div><button class="icon-btn" data-close aria-label="Close">${icon('x')}</button></div>
      <div class="modal-body">
        ${rows.length ? `<div class="table-wrap"><table class="table">
          <thead><tr><th>When</th><th>What</th><th class="right">Available</th><th class="right">Reserved</th></tr></thead>
          <tbody>${rows.map(t => `<tr>
            <td class="text-subtle" style="white-space:nowrap">${UI.dateTime(t.createdAt)}</td>
            <td><div style="font-weight:600">${ledgerLabel(t)}</div><div class="text-xs text-muted">${esc(t.note)}</div></td>
            <td class="right num ledger-amt ${t.available > 0 ? 'pos' : 'neg'}">${t.available ? (t.available > 0 ? '+' : '−') + money(Math.abs(t.available)) : '–'}</td>
            <td class="right num text-subtle">${t.reserved ? (t.reserved > 0 ? '+' : '−') + money(Math.abs(t.reserved)) : '–'}</td>
          </tr>`).join('')}</tbody></table></div>` : UI.empty({ icon: 'wallet', title: 'No transactions yet', body: 'Add money to book your first meal.' })}
      </div>`;
    document.body.appendChild(dlg);
    dlg.addEventListener('close', () => setTimeout(() => dlg.remove(), 250));
    UI.openModal(dlg);
  }

  // ---------- Plans ----------
  function renderPlans() {
    const host = document.getElementById('plansBody');
    const active = state.subs.filter(s => s.status === 'active');
    const past = state.subs.filter(s => s.status !== 'active').slice(0, 3);
    if (!state.subs.length) {
      host.innerHTML = `<p class="text-sm text-muted" style="margin:0">No plans yet. A monthly plan works out cheaper than single meals and you can skip any day with notice.</p><a class="btn btn-secondary btn-sm" style="margin-top:10px" href="/index.html">Browse kitchens</a>`;
      return;
    }
    host.innerHTML = `
      ${active.map(planCard).join('')}
      ${!active.length ? '<p class="text-sm text-muted" style="margin:0 0 10px">No active plan.</p>' : ''}
      ${past.length ? `<details style="margin-top:8px"><summary class="text-sm text-muted" style="cursor:pointer">Past plans (${past.length})</summary>
        <div style="display:grid;gap:8px;margin-top:8px">${past.map(s => `
          <div class="panel text-sm flex items-center justify-between gap-2">
            <span style="min-width:0"><strong class="truncate" style="display:block">${esc(s.kitchen ? s.kitchen.name : '')}</strong><span class="text-xs text-subtle">${esc(s.planLabel)} · ${UI.date(s.startDate)}–${UI.date(s.lastDate)}</span></span>
            ${s.status === 'completed' && !s.renewedById && s.kitchen && s.kitchen.status === 'approved' ? `<button type="button" class="btn btn-secondary btn-sm" data-plan="${s.id}" data-pact="renew">Renew</button>` : UI.statusBadge(s.status)}
          </div>`).join('')}</div></details>` : ''}`;
    UI.icons(host);
  }

  function planCard(s) {
    const done = s.counts.delivered;
    const total = s.mealsTotal;
    const pct = Math.round((done / total) * 100);
    return `
      <div class="panel" style="margin-bottom:10px">
        <div class="flex items-start justify-between gap-2">
          <div style="min-width:0"><a class="truncate" style="display:block;font-weight:700;text-decoration:none" href="/kitchen.html?id=${s.kitchenId}">${esc(s.kitchen.name)}</a>
          <div class="text-xs text-subtle">${esc(s.planLabel)} · ${s.slot === 'both' ? 'lunch + dinner' : s.slot} · ${esc(s.code)}</div></div>
          ${UI.statusBadge(s.status)}
        </div>
        <div class="progress" style="margin-top:10px" role="progressbar" aria-valuenow="${done}" aria-valuemin="0" aria-valuemax="${total}" aria-label="Meals delivered"><span style="width:${pct}%"></span></div>
        <div class="flex justify-between text-xs text-subtle" style="margin-top:4px"><span>${done} of ${total} delivered</span><span>Ends ${UI.date(s.lastDate)}</span></div>
        <div class="plan-summary text-xs" style="margin-top:8px;display:flex;flex-wrap:wrap;gap:6px">
          <span class="badge">${icon('calendar-x')}<span>Skipped: ${s.counts.skippedWithCredit + s.counts.skippedNoCredit}</span></span>
          <span class="badge">${icon('calendar-plus')}<span>Make-up days: ${s.counts.makeupDays}</span></span>
          ${s.status === 'active' ? `<span class="badge">${icon('ticket')}<span>Skips left: ${s.skipsLeft} of ${s.skipLimit}</span></span>` : ''}
          <span class="badge">${icon('clock')}<span>${s.noticeHours} hours' notice</span></span>
        </div>
        ${s.nextMeal ? `<div class="text-sm" style="margin-top:8px">Next: <strong>${UI.date(s.nextMeal.date)} ${s.nextMeal.slot}</strong></div>` : ''}
        ${s.renewError ? `<div class="alert alert-warning" style="margin-top:8px">${icon('triangle-alert')}<div>${esc(s.renewError)}</div></div>` : ''}
        <label class="switch" style="margin-top:10px"><input type="checkbox" data-autorenew="${s.id}" ${s.autoRenew ? 'checked' : ''}><span class="track"></span><span class="text-sm">Auto-renew</span></label>
        <div class="flex flex-wrap gap-2" style="margin-top:10px">
          <button type="button" class="btn btn-secondary btn-sm" data-plan="${s.id}" data-pact="renew">Renew</button>
          <button type="button" class="btn btn-secondary btn-sm" data-plan="${s.id}" data-pact="change">Change plan</button>
          ${s.status === 'active' ? `<button type="button" class="btn btn-secondary btn-sm" data-plan="${s.id}" data-pact="freeze" ${s.freezeUsedThisMonth ? 'disabled title="One freeze per month"' : ''}>${icon('snowflake')}Freeze plan</button>` : ''}
          <button type="button" class="btn btn-danger btn-sm" data-plan="${s.id}" data-pact="cancel">Cancel</button>
        </div>
      </div>`;
  }

  document.getElementById('plansBody').addEventListener('change', async e => {
    const t = e.target.closest('[data-autorenew]');
    if (!t) return;
    try {
      await API.put(`/api/subscriptions/${t.dataset.autorenew}`, { autoRenew: t.checked });
      UI.toast(t.checked ? 'Auto-renew on. We\'ll renew from your wallet.' : 'Auto-renew off.');
      loadPlans();
    } catch (err) { t.checked = !t.checked; UI.error(err); }
  });

  document.getElementById('plansBody').addEventListener('click', async e => {
    const b = e.target.closest('[data-pact]');
    if (!b) return;
    const s = state.subs.find(x => x.id === Number(b.dataset.plan));
    if (b.dataset.pact === 'cancel') {
      const yes = await UI.confirm({
        title: `Cancel your plan with ${s.kitchen.name}?`,
        body: `Meals that are still open, including make-up days, are refunded to your wallet right away. Meals past their change deadline will still be delivered.`,
        confirmText: 'Cancel plan', cancelText: 'Keep plan', danger: true
      });
      if (!yes) return;
      UI.busy(b, async () => {
        try {
          const res = await API.post(`/api/subscriptions/${s.id}/cancel`);
          App.setWallet(res.balances);
          UI.toast(`Plan cancelled. ${money(res.refunded)} refunded to your wallet.`);
          refreshAll();
        } catch (err) { UI.error(err); }
      });
    }
    if (b.dataset.pact === 'renew') {
      const price = s.plan === '5day' ? s.kitchen.pricing.plan5 : s.kitchen.pricing.plan7;
      const total = price * (s.slot === 'both' ? 2 : 1);
      const yes = await UI.confirm({ title: 'Renew this plan?', body: `Another ${s.planLabel.toLowerCase()} with ${esc(s.kitchen.name)}, starting after ${UI.date(s.lastDate)}. ${money(total)} will be reserved from your wallet.`, confirmText: `Renew · ${money(total)}` });
      if (!yes) return;
      UI.busy(b, async () => {
        try {
          const res = await API.post(`/api/subscriptions/${s.id}/renew`);
          App.setWallet(res.balances);
          UI.toast(`Renewed. ${res.subscription.mealsTotal} more meals from ${UI.date(res.subscription.startDate)}.`);
          refreshAll();
        } catch (err) {
          UI.error(err);
          if (err.code === 'LOW_BALANCE') Wallet.openTopUp(total - (App.session.wallet || {}).available).then(x => x && loadWallet());
        }
      });
    }
    if (b.dataset.pact === 'change') openChangePlan(s);
    if (b.dataset.pact === 'freeze') openFreeze(s);
  });

  function openChangePlan(s) {
    const k = s.kitchen;
    const dlg = document.createElement('dialog');
    dlg.className = 'modal';
    dlg.innerHTML = `
      <form novalidate>
        <div class="modal-head"><div><h2 class="h3">Change plan</h2><p class="text-sm text-muted" style="margin:4px 0 0">${esc(k.name)}</p></div><button type="button" class="icon-btn" data-close aria-label="Close">${icon('x')}</button></div>
        <div class="modal-body">
          <div class="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Plan">
            ${[['5day', 'Mon–Fri · 22 meals', k.pricing.plan5], ['7day', 'Every day · 30 meals', k.pricing.plan7]].map(([p, l, price]) => `
              <label class="option-card" style="padding:12px"><input type="radio" name="plan" value="${p}" ${s.plan === p ? 'checked' : ''}><strong style="display:block">${p === '5day' ? '5-day' : '7-day'} plan</strong><span class="text-xs text-subtle">${l}</span><span class="num" style="display:block;margin-top:4px;font-weight:700">${money(price)}</span></label>`).join('')}
          </div>
          <div class="field" style="margin-top:14px">
            <label class="field-label" for="chSlot">Meals</label>
            <select id="chSlot" name="slot" class="select">${['lunch', 'dinner', 'both'].map(x => `<option value="${x}" ${s.slot === x ? 'selected' : ''}>${x === 'both' ? 'Lunch + dinner' : x[0].toUpperCase() + x.slice(1)}</option>`).join('')}</select>
          </div>
          <div class="alert alert-info" style="margin-top:14px">${icon('info')}<div>Open meals on your current plan are refunded, and the new plan starts from the next open day.</div></div>
        </div>
        <div class="modal-foot"><button type="button" class="btn btn-secondary" data-close>Keep current plan</button><button type="submit" class="btn btn-primary">Switch plan</button></div>
      </form>`;
    document.body.appendChild(dlg);
    dlg.addEventListener('close', () => setTimeout(() => dlg.remove(), 250));
    UI.openModal(dlg);
    const form = dlg.querySelector('form');
    form.addEventListener('submit', async e => {
      e.preventDefault();
      await UI.busy(form.querySelector('[type=submit]'), async () => {
        try {
          const res = await API.post(`/api/subscriptions/${s.id}/change`, { plan: form.plan.value, slot: form.slot.value });
          App.setWallet(res.balances);
          UI.toast(`Switched. ${money(res.refunded)} refunded, new plan starts ${UI.date(res.subscription.startDate)}.`);
          dlg.close();
          refreshAll();
        } catch (err) {
          UI.error(err);
          if (err.code === 'LOW_BALANCE') Wallet.openTopUp().then(x => x && loadWallet());
        }
      });
    });
  }

  // Freeze: away for more than a week. The whole plan moves forward (once a month).
  function openFreeze(s) {
    const t = App.session.today;
    const dlg = document.createElement('dialog');
    dlg.className = 'modal';
    dlg.innerHTML = `
      <form novalidate>
        <div class="modal-head"><div><h2 class="h3">Freeze plan</h2><p class="text-sm text-muted" style="margin:4px 0 0">${esc(s.kitchen.name)}</p></div><button type="button" class="icon-btn" data-close aria-label="Close">${icon('x')}</button></div>
        <div class="modal-body">
          <p class="text-sm" style="margin:0 0 12px">Going away for more than a week? Meals between these dates move to after your plan ends. Nothing is charged and no make-up days are used.</p>
          <div class="form-grid cols-2">
            <div class="field"><label class="field-label" for="fzFrom">From</label><input id="fzFrom" name="from" type="date" class="input" min="${t}" value="${addDays(t, 2)}"></div>
            <div class="field"><label class="field-label" for="fzTo">To</label><input id="fzTo" name="to" type="date" class="input" min="${t}" value="${addDays(t, 11)}"><p class="field-error">End date must be on or after the start.</p></div>
          </div>
          <p class="text-xs text-subtle" style="margin:12px 0 0">One freeze per month, up to 30 days. Every meal in the range must still be open to change (${s.noticeHours} hours' notice).</p>
        </div>
        <div class="modal-foot"><button type="button" class="btn btn-secondary" data-close>Cancel</button><button type="submit" class="btn btn-primary">Freeze these days</button></div>
      </form>`;
    document.body.appendChild(dlg);
    dlg.addEventListener('close', () => setTimeout(() => dlg.remove(), 250));
    UI.openModal(dlg);
    const form = dlg.querySelector('form');
    form.addEventListener('submit', async e => {
      e.preventDefault();
      UI.clearErrors(form);
      if (!form.from.value || !form.to.value || form.to.value < form.from.value) { UI.setFieldError(form, 'to', 'End date must be on or after the start.'); return; }
      await UI.busy(form.querySelector('[type=submit]'), async () => {
        try {
          const res = await API.post(`/api/subscriptions/${s.id}/freeze`, { from: form.from.value, to: form.to.value });
          UI.toast(`Plan frozen. ${res.moved} meals moved, plan now ends ${UI.date(res.endDate)}.`);
          dlg.close();
          refreshAll();
        } catch (err) { UI.error(err); }
      });
    });
  }

  // ---------- Holiday mode ----------
  function openHoliday() {
    const t = App.session.today;
    const dlg = document.createElement('dialog');
    dlg.className = 'modal';
    dlg.innerHTML = `
      <form novalidate>
        <div class="modal-head"><div><h2 class="h3">Holiday mode</h2><p class="text-sm text-muted" style="margin:4px 0 0">Away for a few days? Skip every plan meal between two dates. Each skip becomes a make-up day at the end of your plan.</p></div><button type="button" class="icon-btn" data-close aria-label="Close">${icon('x')}</button></div>
        <div class="modal-body">
          <div class="segmented" role="radiogroup" aria-label="Action" style="margin-bottom:14px">
            <button type="button" role="radio" aria-checked="true" aria-pressed="true" data-hact="pause">Skip meals</button>
            <button type="button" role="radio" aria-checked="false" aria-pressed="false" data-hact="resume">Resume meals</button>
          </div>
          <div class="form-grid cols-2">
            <div class="field"><label class="field-label" for="hFrom">From</label><input id="hFrom" name="from" type="date" class="input" min="${t}" value="${addDays(t, 1)}"></div>
            <div class="field"><label class="field-label" for="hTo">To</label><input id="hTo" name="to" type="date" class="input" min="${t}" value="${addDays(t, 3)}"><p class="field-error">End date must be on or after the start.</p></div>
          </div>
          <p class="text-xs text-subtle" style="margin:12px 0 0">Up to 7 days. For longer trips, use Freeze plan. Meals past their change deadline can't be skipped and will still arrive.</p>
        </div>
        <div class="modal-foot"><button type="button" class="btn btn-secondary" data-close>Cancel</button><button type="submit" class="btn btn-primary" id="hSubmit">Skip these days</button></div>
      </form>`;
    document.body.appendChild(dlg);
    dlg.addEventListener('close', () => setTimeout(() => dlg.remove(), 250));
    UI.openModal(dlg);
    const form = dlg.querySelector('form');
    let action = 'pause';
    dlg.querySelectorAll('[data-hact]').forEach(b => b.addEventListener('click', () => {
      action = b.dataset.hact;
      dlg.querySelectorAll('[data-hact]').forEach(x => { const on = x === b; x.setAttribute('aria-checked', String(on)); x.setAttribute('aria-pressed', String(on)); });
      dlg.querySelector('#hSubmit').textContent = action === 'pause' ? 'Skip these days' : 'Resume these days';
    }));
    form.addEventListener('submit', async e => {
      e.preventDefault();
      UI.clearErrors(form);
      if (!form.from.value || !form.to.value || form.to.value < form.from.value) { UI.setFieldError(form, 'to', 'End date must be on or after the start.'); return; }
      await UI.busy(form.querySelector('[type=submit]'), async () => {
        try {
          const res = await API.post('/api/meals/holiday', { from: form.from.value, to: form.to.value, action });
          App.setWallet(res.balances);
          // Each sentence is translated on its own, so a mixed message still comes out in one language
          const tr = x => (window.I18n ? I18n.t(x) : x);
          const parts = action === 'pause' ? [`${res.makeups} meals added as make-up days.`] : [`${res.changed} meals resumed.`];
          if (res.noCredit) parts.push(`${res.noCredit} charged (no make-up days left).`);
          if (res.skipped.length) parts.push(`${res.skipped.length} couldn't be changed (past the deadline or full).`);
          UI.toast(parts.map(tr).join(' '));
          dlg.close();
          refreshAll();
        } catch (err) {
          UI.error(err);
          if (err.code === 'USE_FREEZE') { dlg.close(); const s = state.subs.find(x => x.status === 'active'); if (s) openFreeze(s); }
        }
      });
    });
  }

  // ---------- Alerts ----------
  function renderAlerts() {
    const host = document.getElementById('alerts');
    const out = [];
    if (UI.qs('started') && state.subs.length) {
      const s = state.subs.find(x => x.id === Number(UI.qs('started')));
      if (s) out.push(`<div class="alert alert-success">${icon('party-popper')}<div><div class="a-title">Your plan with ${esc(s.kitchen.name)} is on!</div>${s.mealsTotal} meals from ${UI.date(s.startDate)}. Pick your dishes for each day below.</div></div>`);
    }
    // Evening-before nudge: the next plan meal whose change window closes within a day.
    const soon = state.orders
      .filter(o => o.type === 'subscription' && o.status === 'scheduled' && o.changeable && o.deadline &&
        Date.parse(o.deadline) - Date.now() < 24 * 3600e3)
      .sort((a, b) => a.deadline.localeCompare(b.deadline))[0];
    if (soon) {
      const dishes = Object.values(soon.choices || {}).slice(0, 3).join(', ');
      out.push(`<div class="alert alert-info">${icon('bell')}<div><div class="a-title"><span>${UI.date(soon.date)}</span> · <span>${soon.slot === 'lunch' ? 'Lunch' : 'Dinner'}</span>${dishes ? `: <span translate="no">${esc(dishes)}</span>` : ''}</div><span>Not home? Skip by ${UI.dateTime(soon.deadline)}</span></div><button class="btn btn-secondary btn-sm" data-remind-day="${soon.date}">Open day</button></div>`);
    }
    const bal = state.wallet ? state.wallet.balances.available : null;
    state.subs.filter(s => s.status === 'active' && s.autoRenew).forEach(s => {
      const daysLeft = Math.round((Date.parse(s.lastDate) - Date.parse(App.session.today)) / 86400000);
      const need = (s.plan === '5day' ? s.kitchen.pricing.plan5 : s.kitchen.pricing.plan7) * (s.slot === 'both' ? 2 : 1);
      if (bal != null && daysLeft <= 3 && bal < need) {
        out.push(`<div class="alert alert-warning">${icon('wallet')}<div><div class="a-title">Low balance for renewal</div>Your plan with ${esc(s.kitchen.name)} ends ${UI.date(s.lastDate)}. Renewal needs ${money(need)}; you have ${money(bal)}.</div><button class="btn btn-primary btn-sm" data-action="topup" data-need="${need - bal}">Add ${money(need - bal)}</button></div>`);
      }
    });
    host.innerHTML = out.join('');
    host.hidden = !out.length;
    UI.icons(host);
  }

  // ---------- Toolbar & actions ----------
  function shift(n) {
    if (state.view === 'week') state.anchor = addDays(state.anchor, 7 * n);
    else {
      const d = new Date(monthStart(state.anchor) + 'T00:00:00Z');
      d.setUTCMonth(d.getUTCMonth() + n);
      state.anchor = d.toISOString().slice(0, 10);
    }
    loadCalendar();
  }
  document.getElementById('prevBtn').addEventListener('click', () => shift(-1));
  document.getElementById('nextBtn').addEventListener('click', () => shift(1));
  document.getElementById('todayBtn').addEventListener('click', () => { state.anchor = App.session.today; loadCalendar(); });
  document.getElementById('monthBtn').addEventListener('click', () => { state.view = 'month'; loadCalendar(); });
  document.getElementById('weekBtn').addEventListener('click', () => { state.view = 'week'; loadCalendar(); });
  document.getElementById('ledgerBtn').addEventListener('click', openLedger);
  document.getElementById('holidayBtn').addEventListener('click', openHoliday);
  document.getElementById('alerts').addEventListener('click', e => {
    const b = e.target.closest('[data-remind-day]');
    if (b) openDay(b.dataset.remindDay);
  });
  UI.on('topup', async btn => {
    const b = await Wallet.openTopUp(Number(btn.dataset.need) || 0);
    if (b) loadWallet();
  });
  UI.on('reload', loadCalendar);

  function refreshAll() {
    return Promise.all([loadCalendar(), loadWallet(), loadPlans()]);
  }

  // Live updates from the server (chef status changes, holidays, refunds)
  if (window.Live) {
    Live.on('orders', loadCalendar);
    Live.on('wallet', loadWallet);
    Live.on('subscriptions', loadPlans);
  }

  renderCalendar();
  await refreshAll();
  if (location.hash === '#wallet') document.getElementById('wallet').scrollIntoView();
  if (location.hash === '#plans') document.getElementById('plans').scrollIntoView();
})();
