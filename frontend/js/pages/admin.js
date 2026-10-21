// Admin console: overview, kitchen approvals, moderation (warn/ban/unban/flags), complaints,
// orders (with refunds), users, refunds register and audit log. All numbers come from the API.

(async function () {
  const { esc, icon, money } = UI;
  await App.init({ active: 'admin', requireRole: ['admin'], noFooter: true });

  const root = document.getElementById('adminRoot');
  const TITLES = { overview: 'Overview', approvals: 'Kitchen approvals', kitchens: 'Kitchens', tickets: 'Complaints', orders: 'Orders', users: 'Users', refunds: 'Refunds', audit: 'Audit log' };
  const filters = { kitchens: { status: 'all', q: '' }, tickets: 'active', orders: { q: '', status: 'all', date: '' }, users: { q: '', role: 'all' }, audit: '' };

  function section() { return (location.hash.replace('#', '') || 'overview').split('/')[0]; }

  function route() {
    const s = TITLES[section()] ? section() : 'overview';
    document.getElementById('secTitle').textContent = TITLES[s];
    document.querySelectorAll('[data-sec]').forEach(a => a.classList.toggle('is-active', a.dataset.sec === s));
    document.getElementById('secSelect').value = s;
    root.innerHTML = UI.skeletonRows(5);
    ({ overview, approvals, kitchens, tickets, orders, users, refunds, audit })[s]().catch(e => {
      root.innerHTML = UI.errorState(e.message, '<button class="btn btn-secondary" data-action="reload">Try again</button>');
      UI.icons(root);
    });
  }
  window.addEventListener('hashchange', route);
  document.getElementById('secSelect').addEventListener('change', e => { location.hash = e.target.value; });
  UI.on('reload', route);

  async function updateCounts() {
    try {
      const s = await API.get('/api/admin/stats');
      const set = (k, n) => { const el = document.querySelector(`[data-count="${k}"]`); el.hidden = !n; el.textContent = n; };
      set('approvals', s.pendingApprovals);
      set('flagged', s.flaggedKitchens);
      set('tickets', s.openTickets);
      return s;
    } catch (e) { return null; }
  }

  function stat(label, value, sub = '', href = '') {
    const inner = `<div class="stat"><span class="stat-label">${label}</span><span class="stat-value">${value}</span>${sub ? `<span class="text-xs text-subtle">${sub}</span>` : ''}</div>`;
    return href ? `<a class="card card-pad card-link" href="${href}">${inner}</a>` : `<div class="card card-pad">${inner}</div>`;
  }

  // ---------- Overview ----------
  async function overview() {
    const [s, k, t, a] = await Promise.all([updateCounts(), API.get('/api/admin/kitchens'), API.get('/api/tickets?status=escalated'), API.get('/api/admin/audit')]);
    const pending = k.kitchens.filter(x => x.status === 'pending');
    const flagged = k.kitchens.filter(x => x.openFlags > 0 && x.status !== 'banned');
    root.innerHTML = `
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
        ${stat('Live kitchens', s.activeKitchens, `${s.bannedKitchens} banned`, '#kitchens')}
        ${stat('Waiting for approval', s.pendingApprovals, '', '#approvals')}
        ${stat('Open complaints', s.openTickets, `${s.escalatedTickets} escalated`, '#tickets')}
        ${stat('Flagged kitchens', s.flaggedKitchens, 'low ratings', '#kitchens')}
        ${stat('Refunded today', money(s.refundsToday), 'to customer wallets', '#refunds')}
        ${stat('Meals today', s.mealsToday, `${s.deliveredToday} delivered`, '#orders')}
        ${stat('Customers', s.customers, '', '#users')}
        ${stat('Active plans', s.activeSubscriptions)}
      </div>
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4" style="margin-top:var(--s5)">
        <section class="card card-pad"><h2 class="title">Needs attention</h2>
          <div style="margin-top:8px">
            ${pending.map(x => `<a class="list-row" style="text-decoration:none" href="#approvals">${icon('hourglass', 'text-warning')}<span style="flex:1">${esc(x.name)} <span class="text-xs text-subtle">waiting for approval</span></span></a>`).join('')}
            ${t.tickets.map(x => `<a class="list-row" style="text-decoration:none" href="#tickets/${x.id}">${icon('triangle-alert', 'text-danger')}<span style="flex:1">${esc(x.code)} · ${esc(x.kitchenName)} <span class="text-xs text-subtle">${esc(x.categoryLabel)}</span></span></a>`).join('')}
            ${flagged.map(x => `<a class="list-row" style="text-decoration:none" href="#kitchens">${icon('flag', 'text-danger')}<span style="flex:1">${esc(x.name)} <span class="text-xs text-subtle">${x.openFlags} low rating${x.openFlags > 1 ? 's' : ''}</span></span></a>`).join('')}
            ${!pending.length && !t.tickets.length && !flagged.length ? '<p class="text-sm text-muted">Nothing needs you right now.</p>' : ''}
          </div>
        </section>
        <section class="card card-pad"><div class="flex justify-between"><h2 class="title">Recent activity</h2><a class="link text-sm" href="#audit">All</a></div>
          <div style="margin-top:8px">${a.entries.slice(0, 7).map(auditRow).join('')}</div>
        </section>
      </div>`;
    UI.icons(root);
  }

  function auditRow(e) {
    const bad = /BAN|FLAG|ESCALAT|REJECT|WARN/.test(e.action);
    return `<div class="list-row" style="align-items:flex-start"><span class="badge ${bad ? 'badge-danger' : 'badge-neutral'}" style="flex-shrink:0">${esc(e.action.replace(/_/g, ' ').toLowerCase())}</span><span style="flex:1;min-width:0"><span class="text-sm" style="display:block">${esc(e.detail)}</span><span class="text-xs text-subtle">${esc(e.actorName)} · ${UI.relTime(e.createdAt)}</span></span></div>`;
  }

  // ---------- Approvals ----------
  async function approvals() {
    const res = await API.get('/api/admin/kitchens');
    const pending = res.kitchens.filter(k => k.status === 'pending');
    const rejected = res.kitchens.filter(k => k.status === 'rejected');
    root.innerHTML = `
      ${pending.length ? `<div style="display:grid;gap:14px">${pending.map(k => `
        <article class="card card-pad" data-kid="${k.id}">
          <div class="grid grid-cols-1 md:grid-cols-[180px_minmax(0,1fr)] gap-4">
            <div class="kcard-img">${UI.img(k.coverUrl, k.name)}</div>
            <div>
              <div class="flex flex-wrap items-center gap-2"><h2 class="h3">${esc(k.name)}</h2>${UI.statusBadge(k.status)}</div>
              <p class="text-sm text-muted" style="margin:4px 0 0">${esc(k.chefName)} · ${esc(k.phone)}${k.ownerEmail ? ` · ${esc(k.ownerEmail)}` : ''} · applied ${UI.relTime(k.createdAt)}</p>
              <div class="flex flex-wrap gap-2" style="margin-top:8px">
                ${UI.kitchenDietTag(k.dietType)}
                <span class="badge badge-neutral">${icon('map-pin')}${esc(k.location.locality || 'No area')}${k.location.lat ? '' : ' · not pinned'}</span>
                <span class="badge badge-neutral">${(k.radiusM / 1000).toFixed(1)} km</span>
                <span class="badge ${k.fssai ? 'badge-success' : 'badge-warning'}">${k.fssai ? 'FSSAI ' + esc(k.fssai) : 'No FSSAI yet'}</span>
                ${(k.cuisines || []).map(c => `<span class="badge badge-neutral">${esc(c)}</span>`).join('')}
              </div>
              <p class="text-sm" style="margin:8px 0 0">Meal ${money(k.pricing.single)} · trial ${money(k.pricing.trial)} · 5-day ${money(k.pricing.plan5)} · 7-day ${money(k.pricing.plan7)} · ${k.capacity}/slot · ${k.slots.join(' & ')}</p>
              ${k.bio ? `<p class="text-sm text-muted" style="margin:6px 0 0">"${esc(k.bio)}"</p>` : ''}
              ${k.statusNote ? `<p class="text-xs text-warning" style="margin:6px 0 0">${esc(k.statusNote)}</p>` : ''}
              <div class="flex flex-wrap gap-2" style="margin-top:12px">
                <button type="button" class="btn btn-success btn-sm" data-k="approve">${icon('check')}Approve</button>
                <button type="button" class="btn btn-danger btn-sm" data-k="reject">Ask for changes</button>
                <a class="btn btn-ghost btn-sm" href="/kitchen.html?id=${k.id}" target="_blank" rel="noopener">${icon('eye')}Preview storefront</a>
              </div>
            </div>
          </div>
        </article>`).join('')}</div>` : UI.empty({ icon: 'badge-check', title: 'No kitchens waiting', body: 'New chef applications appear here.' })}
      ${rejected.length ? `<h2 class="title" style="margin:var(--s6) 0 10px">Sent back for changes</h2><div class="table-wrap"><table class="table"><tbody>${rejected.map(k => `<tr data-kid="${k.id}"><td><strong>${esc(k.name)}</strong><div class="text-xs text-subtle">${esc(k.statusNote)}</div></td><td class="right"><button type="button" class="btn btn-secondary btn-sm" data-k="reopen">Move back to review</button></td></tr>`).join('')}</tbody></table></div>` : ''}`;
    UI.icons(root);
  }

  // ---------- Kitchens ----------
  async function kitchens() {
    const f = filters.kitchens;
    const res = await API.get(`/api/admin/kitchens?status=${f.status}&q=${encodeURIComponent(f.q)}`);
    root.innerHTML = `
      <div class="flex flex-col md:flex-row gap-3 md:items-center md:justify-between" style="margin-bottom:var(--s4)">
        <div class="chip-scroll" role="group" aria-label="Filter">${[['all', 'All'], ['approved', 'Live'], ['flagged', 'Flagged'], ['pending', 'Pending'], ['banned', 'Banned'], ['rejected', 'Rejected']].map(([v, l]) => `<button type="button" class="chip${f.status === v ? ' is-active' : ''}" aria-pressed="${f.status === v}" data-kf="${v}">${l}</button>`).join('')}</div>
        <div class="input-group" style="max-width:320px;width:100%"><span class="prefix">${icon('search', 'icon-sm')}</span><label class="sr-only" for="kq">Search kitchens</label><input id="kq" class="input" type="search" placeholder="Name, chef, area, phone" value="${esc(f.q)}" style="min-height:40px"></div>
      </div>
      ${res.kitchens.length ? `<div class="table-wrap"><table class="table">
        <thead><tr><th>Kitchen</th><th>Rating</th><th class="right">Meals</th><th class="right">Complaints</th><th>Status</th><th class="right">Actions</th></tr></thead>
        <tbody>${res.kitchens.map(k => `
          <tr data-kid="${k.id}">
            <td><button type="button" class="link" data-k="view" style="color:var(--ink);font-weight:700">${esc(k.name)}</button><div class="text-xs text-subtle">${esc(k.chefName)} · ${esc(k.location.locality || '—')}</div></td>
            <td>${UI.ratingPill(k.stats.rating)}<div class="text-xs text-subtle" style="margin-top:2px">${k.stats.hygiene != null ? `Hygiene ${k.stats.hygiene}` : 'No reviews'}</div></td>
            <td class="right num">${k.stats.mealsServed}</td>
            <td class="right num">${k.stats.openTickets}${k.openFlags ? `<div><span class="badge badge-danger">${icon('flag')}${k.openFlags} flag${k.openFlags > 1 ? 's' : ''}</span></div>` : ''}</td>
            <td>${UI.statusBadge(k.status)}${k.paused ? ' <span class="badge badge-neutral">Paused</span>' : ''}${k.warnings.length ? `<div class="text-xs text-warning">${k.warnings.length} warning${k.warnings.length > 1 ? 's' : ''}</div>` : ''}${k.strikesThisMonth ? `<div class="text-xs ${k.strikesThisMonth >= 3 ? 'text-danger' : 'text-warning'}">${k.strikesThisMonth} late cancellation${k.strikesThisMonth > 1 ? 's' : ''} this month</div>` : ''}</td>
            <td class="right"><div class="flex justify-end gap-1 flex-wrap">
              ${k.openFlags ? '<button type="button" class="btn btn-ghost btn-sm" data-k="clear">Clear flags</button>' : ''}
              ${k.status === 'approved' ? '<button type="button" class="btn btn-secondary btn-sm" data-k="warn">Warn</button><button type="button" class="btn btn-danger btn-sm" data-k="ban">Ban</button>' : ''}
              ${k.status === 'banned' ? '<button type="button" class="btn btn-secondary btn-sm" data-k="unban">Unban</button>' : ''}
              ${k.status === 'pending' ? '<a class="btn btn-secondary btn-sm" href="#approvals">Review</a>' : ''}
            </div></td>
          </tr>`).join('')}</tbody></table></div>` : UI.empty({ icon: 'search-x', title: 'No kitchens match', body: 'Try another filter or search.' })}`;
    UI.icons(root);
    root.querySelectorAll('[data-kf]').forEach(b => b.addEventListener('click', () => { f.status = b.dataset.kf; route(); }));
    const q = root.querySelector('#kq');
    let t;
    q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { f.q = q.value.trim(); kitchens().then(() => { const n = root.querySelector('#kq'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }); }, 300); });
  }

  async function viewKitchen(id) {
    const res = await API.get(`/api/admin/kitchens/${id}`);
    const k = res.kitchen;
    const dlg = document.createElement('dialog');
    dlg.className = 'modal modal-lg';
    dlg.innerHTML = `
      <div class="modal-head"><div><h2 class="h3">${esc(k.name)}</h2><p class="text-sm text-muted" style="margin:4px 0 0">${esc(k.chefName)} · ${esc(k.phone)} · ${esc(k.ownerEmail)}</p></div><button class="icon-btn" data-close aria-label="Close">${icon('x')}</button></div>
      <div class="modal-body">
        <div class="flex flex-wrap gap-2">${UI.statusBadge(k.status)}<span class="badge badge-neutral">${k.activeSubscribers} active plans</span><span class="badge badge-neutral">${k.stats.mealsServed} meals served</span><span class="badge badge-neutral">FSSAI ${esc(k.fssai || 'not added')}</span></div>
        ${k.statusNote ? `<p class="text-sm text-muted" style="margin:10px 0 0">Note: ${esc(k.statusNote)}</p>` : ''}
        ${k.flags.length ? `<h3 class="title" style="margin:16px 0 6px">Flags</h3>${k.flags.slice().reverse().map(f => `<div class="list-row text-sm"><span class="badge ${f.resolved ? 'badge-neutral' : 'badge-danger'}">${f.resolved ? 'Cleared' : 'Open'}</span><span style="flex:1">${esc(f.reason)}</span><span class="text-xs text-subtle">${UI.relTime(f.at)}</span></div>`).join('')}` : ''}
        ${k.warnings.length ? `<h3 class="title" style="margin:16px 0 6px">Warnings</h3>${k.warnings.slice().reverse().map(w => `<div class="list-row text-sm"><span style="flex:1">${esc(w.reason)}</span><span class="text-xs text-subtle">${esc(w.by)} · ${UI.relTime(w.at)}</span></div>`).join('')}` : ''}
        <h3 class="title" style="margin:16px 0 6px">Reviews (${res.reviews.length})</h3>
        ${res.reviews.length ? res.reviews.slice(0, 20).map(r => `<div class="list-row" style="align-items:flex-start">${UI.ratingPill(r.rating)}<span style="flex:1"><span class="text-sm" style="display:block">${esc(r.comment)}</span><span class="text-xs text-subtle">${esc(r.customerName)} · hygiene ${r.hygiene}★ · ${UI.relTime(r.createdAt)}</span></span></div>`).join('') : '<p class="text-sm text-muted">No reviews.</p>'}
      </div>
      <div class="modal-foot"><a class="btn btn-secondary" href="/kitchen.html?id=${k.id}" target="_blank" rel="noopener">Open storefront</a><button class="btn btn-secondary" data-close>Close</button></div>`;
    document.body.appendChild(dlg);
    dlg.addEventListener('close', () => setTimeout(() => dlg.remove(), 250));
    UI.openModal(dlg);
  }

  // Kitchen actions (approvals + kitchens tables)
  root.addEventListener('click', async e => {
    const b = e.target.closest('[data-k]');
    if (!b) return;
    const id = Number(b.closest('[data-kid]').dataset.kid);
    const name = (b.closest('[data-kid]').querySelector('h2, strong, [data-k="view"]') || {}).textContent || 'this kitchen';
    const act = b.dataset.k;
    if (act === 'view') return viewKitchen(id).catch(UI.error);
    let body = {};
    if (act === 'approve') {
      const note = await UI.prompt({ title: `Approve ${name}?`, body: 'The kitchen goes live on the marketplace and the chef is notified.', label: 'Note to the chef (optional)', required: false, confirmText: 'Approve' });
      if (note === null) return;
      body = { note };
    } else if (act === 'reject') {
      const note = await UI.prompt({ title: `Send ${name} back for changes`, label: 'What needs fixing? (sent to the chef)', placeholder: 'e.g. Please pin your exact kitchen location and add an FSSAI number.', confirmText: 'Send', danger: true });
      if (!note) return;
      body = { note };
    } else if (act === 'warn') {
      const reason = await UI.prompt({ title: `Warn ${name}`, label: 'Reason (sent to the chef)', placeholder: 'e.g. Two late deliveries this week. Please dispatch by 12:30.', confirmText: 'Send warning' });
      if (!reason) return;
      body = { reason };
    } else if (act === 'ban') {
      const reason = await UI.prompt({ title: `Ban ${name}?`, body: 'The kitchen disappears from the marketplace. Every meal not yet delivered is cancelled and refunded to customers\' wallets, and their plans end. Customers and the chef are notified.', label: 'Reason (sent to the chef)', confirmText: 'Ban and refund', danger: true });
      if (!reason) return;
      body = { reason };
    } else if (act === 'unban') {
      const note = await UI.prompt({ title: `Unban ${name}?`, body: 'The kitchen can take orders again. Cancelled plans stay cancelled.', label: 'Note to the chef (optional)', required: false, confirmText: 'Unban' });
      if (note === null) return;
      body = { note };
    } else if (act === 'clear') {
      const yes = await UI.confirm({ title: 'Clear open flags?', body: 'Do this after you\'ve looked into the low ratings.', confirmText: 'Clear flags' });
      if (!yes) return;
    }
    const path = { approve: 'approve', reject: 'reject', reopen: 'reopen', warn: 'warn', ban: 'ban', unban: 'unban', clear: 'clear-flags' }[act];
    UI.busy(b, async () => {
      try {
        const res = await API.post(`/api/admin/kitchens/${id}/${path}`, body);
        const msg = { approve: 'Approved. The kitchen is live.', reject: 'Sent back to the chef.', reopen: 'Moved back to review.', warn: 'Warning sent.', unban: 'Unbanned.', clear: 'Flags cleared.' }[act]
          || `Banned. ${money(res.refunded)} refunded to ${res.customers} customer${res.customers === 1 ? '' : 's'} (${res.mealsCancelled} meals).`;
        UI.toast(msg);
        updateCounts();
        route();
      } catch (err) { UI.error(err); }
    });
  });

  // ---------- Complaints ----------
  async function tickets() {
    const id = Number(location.hash.split('/')[1]);
    if (id) {
      const { ticket } = await API.get(`/api/tickets/${id}`);
      root.innerHTML = `<a href="#tickets" class="btn btn-ghost btn-sm" style="margin:-8px 0 12px -8px">${icon('arrow-left')}All complaints</a>
        <div class="card card-pad" id="adminThread"></div>
        <p class="text-sm" style="margin-top:10px"><button type="button" class="link" data-order-open="${ticket.orderId}">Open order ${esc(ticket.orderCode)}</button></p>`;
      UI.icons(root);
      Tickets.renderThread(root.querySelector('#adminThread'), ticket, { role: 'admin', onChange: updateCounts });
      root.querySelector('[data-order-open]').addEventListener('click', () => openOrder(ticket.orderId));
      return;
    }
    const res = await API.get(`/api/tickets?status=${filters.tickets}`);
    root.innerHTML = `
      <div class="chip-scroll" style="margin-bottom:var(--s4)">${[['active', 'Open'], ['escalated', 'Escalated'], ['resolved', 'Resolved'], ['all', 'All']].map(([v, l]) => `<button type="button" class="chip${filters.tickets === v ? ' is-active' : ''}" aria-pressed="${filters.tickets === v}" data-tf="${v}">${l}</button>`).join('')}</div>
      ${res.tickets.length ? `<div style="display:grid;gap:10px">${res.tickets.map(t => Tickets.listItem(t, 'admin', `#tickets/${t.id}`).replace(`${esc(t.customerName)} ·`, `${esc(t.customerName)} → ${esc(t.kitchenName)} ·`)).join('')}</div>` : UI.empty({ icon: 'smile', title: 'No complaints here', body: '' })}`;
    UI.icons(root);
    root.querySelectorAll('[data-tf]').forEach(b => b.addEventListener('click', () => { filters.tickets = b.dataset.tf; route(); }));
  }

  // ---------- Orders ----------
  async function orders() {
    const f = filters.orders;
    const res = await API.get(`/api/admin/orders?q=${encodeURIComponent(f.q)}&status=${f.status}&date=${f.date}`);
    root.innerHTML = `
      <form class="flex flex-wrap gap-2" id="oFilter" style="margin-bottom:var(--s4)">
        <label class="sr-only" for="oq">Search</label><input id="oq" class="input" type="search" placeholder="Order code, customer or kitchen" value="${esc(f.q)}" style="max-width:280px;min-height:40px">
        <label class="sr-only" for="os">Status</label><select id="os" class="select" style="width:auto;min-height:40px">${['all', 'scheduled', 'preparing', 'out_for_delivery', 'delivered', 'paused', 'cancelled', 'holiday'].map(s => `<option value="${s}" ${f.status === s ? 'selected' : ''}>${s === 'all' ? 'Any status' : UI.statusLabel(s)}</option>`).join('')}</select>
        <label class="sr-only" for="od">Date</label><input id="od" class="input" type="date" value="${f.date}" style="width:auto;min-height:40px">
        <button type="submit" class="btn btn-secondary">Filter</button>
        ${f.q || f.status !== 'all' || f.date ? '<button type="button" class="btn btn-ghost" id="oClear">Clear</button>' : ''}
      </form>
      <p class="text-sm text-muted" style="margin:0 0 10px">${res.total} order${res.total === 1 ? '' : 's'}${res.total > 200 ? ' (showing 200)' : ''}</p>
      ${res.orders.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Order</th><th>Customer</th><th>Kitchen</th><th>Meal</th><th class="right">Total</th><th>Status</th></tr></thead><tbody>
        ${res.orders.map(o => `<tr style="cursor:pointer" data-oid="${o.id}" tabindex="0"><td><strong>${esc(o.code)}</strong><div class="text-xs text-subtle">${o.type}</div></td><td>${esc(o.customerName)}</td><td>${esc(o.kitchen ? o.kitchen.name : '')}</td><td>${UI.date(o.date)} ${o.slot}</td><td class="right num">${money(o.total)}</td><td>${UI.statusBadge(o.status)}</td></tr>`).join('')}
      </tbody></table></div>` : UI.empty({ icon: 'search-x', title: 'No orders match', body: '' })}`;
    UI.icons(root);
    const form = root.querySelector('#oFilter');
    form.addEventListener('submit', e => { e.preventDefault(); f.q = form.querySelector('#oq').value.trim(); f.status = form.querySelector('#os').value; f.date = form.querySelector('#od').value; route(); });
    const clr = root.querySelector('#oClear');
    if (clr) clr.addEventListener('click', () => { filters.orders = { q: '', status: 'all', date: '' }; route(); });
    root.querySelectorAll('[data-oid]').forEach(tr => {
      tr.addEventListener('click', () => openOrder(Number(tr.dataset.oid)));
      tr.addEventListener('keydown', e => { if (e.key === 'Enter') openOrder(Number(tr.dataset.oid)); });
    });
  }

  async function openOrder(id) {
    let o;
    try { o = (await API.get(`/api/orders/${id}`)).order; } catch (e) { return UI.error(e); }
    const refundable = o.status === 'delivered' ? o.total - (o.goodwillRefund || 0) : ['scheduled', 'preparing', 'out_for_delivery'].includes(o.status) ? (o.paid || 0) - (o.refunded || 0) : 0;
    const dlg = document.createElement('dialog');
    dlg.className = 'modal';
    dlg.innerHTML = `
      <div class="modal-head"><div><h2 class="h3">${esc(o.code)}</h2><p class="text-sm text-muted" style="margin:4px 0 0">${esc(o.customerName)} · ${esc(o.kitchen.name)} · ${UI.date(o.date)} ${o.slot}</p></div><button class="icon-btn" data-close aria-label="Close">${icon('x')}</button></div>
      <div class="modal-body">
        <div class="flex gap-2 flex-wrap">${UI.statusBadge(o.status)}<span class="badge badge-neutral">${o.type}</span></div>
        <p class="text-sm" style="margin:10px 0 0">${Object.values(o.choices || {}).map(esc).join(' · ')}</p>
        ${o.dietaryNotes.length ? `<p class="text-xs text-subtle">${esc(o.dietaryNotes.join(' · '))}</p>` : ''}
        <hr class="divider">
        <div class="kv"><span>Meal</span><span class="num">${money(o.amount)}</span></div>
        ${o.addonsTotal ? `<div class="kv"><span>Extras</span><span class="num">${money(o.addonsTotal)}</span></div>` : ''}
        <div class="kv total"><span>Total</span><span class="num">${money(o.total)}</span></div>
        ${(o.refunded || 0) + (o.goodwillRefund || 0) ? `<div class="kv"><span>Already refunded</span><span class="num">${money((o.refunded || 0) + (o.goodwillRefund || 0))}</span></div>` : ''}
        <h3 class="title" style="margin:14px 0 6px">History</h3>
        ${o.statusHistory.map(h => `<div class="kv"><span>${UI.statusLabel(h.status)}${h.by ? ` · ${esc(h.by)}` : ''}</span><span>${UI.dateTime(h.at)}</span></div>`).join('')}
      </div>
      <div class="modal-foot">${refundable > 0 ? `<button class="btn btn-danger" id="refundBtn">${icon('wallet')}Refund…</button>` : ''}<button class="btn btn-secondary" data-close>Close</button></div>`;
    document.body.appendChild(dlg);
    dlg.addEventListener('close', () => setTimeout(() => dlg.remove(), 250));
    UI.openModal(dlg);
    const rb = dlg.querySelector('#refundBtn');
    if (rb) rb.addEventListener('click', async () => {
      const reason = await UI.prompt({ title: `Refund ${o.code}`, body: `Up to ${money(refundable)} goes back to ${esc(o.customerName)}'s wallet.${o.status !== 'delivered' ? ' A full refund also cancels the meal.' : ''}`, label: 'Reason (sent to the customer)', confirmText: `Refund ${money(refundable)}`, danger: true });
      if (!reason) return;
      try {
        const res = await API.post(`/api/admin/orders/${o.id}/refund`, { amount: refundable, reason });
        UI.toast(`${money(res.amount)} refunded`);
        dlg.close();
        if (section() === 'orders') route();
      } catch (e) { UI.error(e); }
    });
  }

  // ---------- Users ----------
  async function users() {
    const f = filters.users;
    const res = await API.get(`/api/admin/users?q=${encodeURIComponent(f.q)}&role=${f.role}`);
    root.innerHTML = `
      <div class="flex flex-wrap gap-2" style="margin-bottom:var(--s4)">
        <div class="chip-scroll">${[['all', 'Everyone'], ['customer', 'Customers'], ['chef', 'Chefs'], ['admin', 'Admins']].map(([v, l]) => `<button type="button" class="chip${f.role === v ? ' is-active' : ''}" aria-pressed="${f.role === v}" data-uf="${v}">${l}</button>`).join('')}</div>
        <label class="sr-only" for="uq">Search users</label><input id="uq" class="input" type="search" placeholder="Name, email or phone" value="${esc(f.q)}" style="max-width:280px;min-height:40px">
      </div>
      ${res.users.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Name</th><th>Role</th><th>Contact</th><th class="right">Wallet</th><th class="right">Orders</th><th>Joined</th></tr></thead><tbody>
        ${res.users.map(u => `<tr><td><strong>${esc(u.name)}</strong>${u.kitchenName ? `<div class="text-xs text-subtle">${esc(u.kitchenName)}</div>` : ''}</td><td><span class="badge badge-neutral">${u.role}</span>${u.noShowsThisMonth ? `<div class="text-xs ${u.noShowsThisMonth >= 3 ? 'text-danger' : 'text-warning'}">${u.noShowsThisMonth} no-show${u.noShowsThisMonth > 1 ? 's' : ''} this month${u.flagged ? ' · flagged' : ''}</div>` : ''}</td><td class="text-sm">${esc(u.email || '—')}<div class="text-xs text-subtle">${esc(u.phone || '')}</div></td><td class="right num">${u.wallet ? money(u.wallet.available) + (u.wallet.reserved ? `<div class="text-xs text-subtle">${money(u.wallet.reserved)} reserved</div>` : '') : '—'}</td><td class="right num">${u.role === 'customer' ? u.orders : '—'}</td><td class="text-sm text-subtle">${UI.relTime(u.createdAt)}</td></tr>`).join('')}
      </tbody></table></div>` : UI.empty({ icon: 'users', title: 'No users match', body: '' })}`;
    UI.icons(root);
    root.querySelectorAll('[data-uf]').forEach(b => b.addEventListener('click', () => { f.role = b.dataset.uf; route(); }));
    const q = root.querySelector('#uq');
    let t;
    q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { f.q = q.value.trim(); users().then(() => { const n = root.querySelector('#uq'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }); }, 300); });
  }

  // ---------- Refunds ----------
  async function refunds() {
    const res = await API.get('/api/admin/refunds');
    root.innerHTML = `
      <p class="text-muted" style="margin:0 0 var(--s4)">Money returned to customer wallets: complaint refunds, bans, kitchen holidays and cancellations. Customer pauses aren't counted. Total shown: <strong>${money(res.total)}</strong></p>
      ${res.refunds.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>When</th><th>Customer</th><th>Order</th><th>Reason</th><th class="right">Amount</th></tr></thead><tbody>
        ${res.refunds.map(r => `<tr><td class="text-subtle" style="white-space:nowrap">${UI.dateTime(r.createdAt)}</td><td>${esc(r.customerName)}</td><td>${r.orderCode ? `<button type="button" class="link" data-order-open="${r.orderId}">${esc(r.orderCode)}</button>` : '—'}<div class="text-xs text-subtle">${esc(r.kitchenName || '')}</div></td><td class="text-sm">${esc(r.note)}</td><td class="right num text-success">${money(r.amount)}</td></tr>`).join('')}
      </tbody></table></div>` : UI.empty({ icon: 'wallet', title: 'No refunds yet', body: '' })}`;
    UI.icons(root);
    root.querySelectorAll('[data-order-open]').forEach(b => b.addEventListener('click', () => openOrder(Number(b.dataset.orderOpen))));
  }

  // ---------- Audit ----------
  async function audit() {
    const res = await API.get(`/api/admin/audit?q=${encodeURIComponent(filters.audit)}`);
    root.innerHTML = `
      <label class="sr-only" for="aq">Search the log</label>
      <input id="aq" class="input" type="search" placeholder="Search actions, kitchens, people" value="${esc(filters.audit)}" style="max-width:360px;min-height:40px;margin-bottom:var(--s4)">
      <div class="card card-pad">${res.entries.length ? res.entries.map(auditRow).join('') : '<p class="text-muted">No entries.</p>'}</div>`;
    UI.icons(root);
    const q = root.querySelector('#aq');
    let t;
    q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { filters.audit = q.value.trim(); audit().then(() => { const n = root.querySelector('#aq'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }); }, 300); });
  }

  if (window.Live) {
    Live.on('kitchens', () => { updateCounts(); if (['overview', 'approvals', 'kitchens'].includes(section())) route(); });
    Live.on('tickets', () => { updateCounts(); if (['overview', 'tickets'].includes(section())) route(); });
  }

  updateCounts();
  route();
})();
