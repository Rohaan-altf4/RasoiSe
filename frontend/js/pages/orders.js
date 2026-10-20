// Orders: upcoming/past lists, a live order tracker, and complaint threads.

(async function () {
  const { esc, icon, money } = UI;
  await App.init({ active: 'orders', requireRole: ['customer'] });

  const listView = document.getElementById('listView');
  const detailView = document.getElementById('detailView');
  const listBody = document.getElementById('listBody');
  let tab = location.hash === '#help' ? 'help' : 'upcoming';
  let currentId = null;
  let trackerTimer = null;

  // ---------- Router: ?id=ORDER, ?ticket=TICKET, else lists ----------
  function route() {
    clearInterval(trackerTimer);
    const id = Number(UI.qs('id'));
    const ticket = Number(UI.qs('ticket'));
    if (id) return showOrder(id);
    if (ticket) return showTicket(ticket);
    detailView.hidden = true;
    listView.hidden = false;
    currentId = null;
    selectTab(tab);
  }

  function go(url) {
    history.pushState({}, '', url);
    route();
    window.scrollTo(0, 0);
  }
  window.addEventListener('popstate', route);

  // ---------- Lists ----------
  document.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => selectTab(b.dataset.tab)));

  async function selectTab(t) {
    tab = t;
    document.querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === t)));
    history.replaceState({}, '', '/orders.html' + (t === 'help' ? '#help' : ''));
    listBody.innerHTML = UI.skeletonRows(4);
    try {
      if (t === 'help') return renderTickets(await API.get('/api/tickets'));
      const res = await API.get(`/api/orders?scope=${t}`);
      renderOrders(res.orders);
    } catch (e) {
      listBody.innerHTML = UI.errorState(e.message, '<button class="btn btn-secondary" data-action="retry">Try again</button>');
      UI.icons(listBody);
    }
  }
  UI.on('retry', () => selectTab(tab));

  function orderCard(o) {
    const items = Object.values(o.choices || {}).slice(0, 3).join(', ');
    const type = o.type === 'subscription' ? 'Plan meal' : o.type === 'trial' ? 'Trial' : 'Meal';
    return `
      <a class="card card-link card-pad" href="/orders.html?id=${o.id}" data-open="${o.id}" style="display:flex;gap:14px;align-items:center">
        ${UI.img(o.kitchen && o.kitchen.coverUrl, '')}
        <span style="flex:1;min-width:0">
          <span class="flex items-center justify-between gap-2"><strong class="truncate">${esc(o.kitchen ? o.kitchen.name : '')}</strong>${UI.statusBadge(o.status)}</span>
          <span class="text-sm text-muted" style="display:block">${UI.date(o.date)} · ${o.slot === 'lunch' ? 'Lunch' : 'Dinner'} · ${type} · ${money(o.total)}</span>
          ${items ? `<span class="text-xs text-subtle truncate" style="display:block;margin-top:2px">${esc(items)}</span>` : ''}
        </span>
        ${icon('chevron-right', 'text-subtle')}
      </a>`;
  }

  function renderOrders(orders) {
    if (!orders.length) {
      listBody.innerHTML = UI.empty(tab === 'upcoming'
        ? { icon: 'shopping-bag', title: 'No upcoming meals', body: 'Order a meal for tomorrow, or start a plan and never think about lunch again.', action: '<a class="btn btn-primary" href="/index.html">Find a kitchen</a>' }
        : { icon: 'history', title: 'No past orders yet', body: 'Your delivered and cancelled meals will show here.' });
      UI.icons(listBody);
      return;
    }
    listBody.innerHTML = `<div style="display:grid;gap:10px">${orders.map(orderCard).join('')}</div>`;
    listBody.querySelectorAll('img').forEach(img => { img.style.cssText = 'width:56px;height:56px;border-radius:12px;object-fit:cover;flex-shrink:0'; });
    UI.icons(listBody);
  }

  function renderTickets(res) {
    const open = res.tickets.filter(t => t.status !== 'resolved').length;
    const count = document.getElementById('helpCount');
    count.hidden = !open;
    count.textContent = open;
    if (!res.tickets.length) {
      listBody.innerHTML = UI.empty({ icon: 'life-buoy', title: 'No complaints', body: 'If something is wrong with a meal, open the order and tap "Report a problem". The kitchen replies here, and RasoiSe steps in if needed.' });
    } else {
      listBody.innerHTML = `<div style="display:grid;gap:10px">${res.tickets.map(t => Tickets.listItem(t, 'customer', `/orders.html?ticket=${t.id}`)).join('')}</div>`;
    }
    UI.icons(listBody);
  }

  listBody.addEventListener('click', e => {
    const a = e.target.closest('a[href^="/orders.html?"]');
    if (a && !e.metaKey && !e.ctrlKey) { e.preventDefault(); go(a.getAttribute('href')); }
  });

  // ---------- Order detail & tracker ----------
  async function showOrder(id) {
    currentId = id;
    listView.hidden = true;
    detailView.hidden = false;
    detailView.innerHTML = UI.skeletonRows(5);
    try {
      const { order } = await API.get(`/api/orders/${id}`);
      renderOrder(order);
    } catch (e) {
      detailView.innerHTML = `${backLink()}${UI.errorState(e.message)}`;
      UI.icons(detailView);
    }
  }

  function backLink() {
    return `<a href="/orders.html" class="btn btn-ghost btn-sm" data-back style="margin:-8px 0 12px -8px">${icon('arrow-left')}All orders</a>`;
  }

  const STEPS = [
    ['scheduled', 'Order confirmed', 'circle-check'],
    ['preparing', 'Being cooked', 'chef-hat'],
    ['out_for_delivery', 'On the way', 'bike'],
    ['delivered', 'Delivered', 'house']
  ];

  function stepTime(o, status) {
    const h = (o.statusHistory || []).filter(x => x.status === status).pop();
    return h ? UI.timeOnly(h.at) : '';
  }

  function tracker(o) {
    if (['paused', 'cancelled', 'holiday'].includes(o.status)) {
      // Plan meals that were skipped or cancelled by the kitchen may have moved to a make-up day
      const outcome = o.makeupDate ? `<span>Moved to a make-up day on ${UI.date(o.makeupDate)}.</span>`
        : o.skipCredit === 'none' ? '<span>No make-up day left, so this meal is charged.</span>'
          : '<span>Refunded to your wallet.</span>';
      const reason = o.cancelReason ? ` <span translate="no">(${esc(o.cancelReason)})</span>` : '';
      const msg = o.status === 'paused' ? `<span>You skipped this meal.</span> ${outcome}`
        : o.status === 'holiday' ? `<span>The kitchen is closed this day.</span>${reason} ${outcome}`
          : `<span>Cancelled.</span>${reason} ${outcome}`;
      return `<div class="alert ${o.status === 'paused' ? 'alert-warning' : 'alert-info'}">${icon(o.status === 'paused' ? 'pause' : 'info')}<div>${msg}</div></div>`;
    }
    const idx = STEPS.findIndex(s => s[0] === o.status);
    return `<ol class="stepper" aria-label="Order progress">
      ${STEPS.map(([key, label, ic], i) => {
        const cls = i < idx || o.status === 'delivered' ? 'done' : i === idx ? 'current' : '';
        const sub = i === 0 ? `Placed ${UI.dateTime(o.createdAt)}` : stepTime(o, key) || (i === idx + 1 && key === 'preparing' ? `Cooking starts after ${UI.time12(o.kitchen.cutoffTime)}` : '');
        return `<li class="step ${cls}" ${cls === 'current' ? 'aria-current="step"' : ''}><span class="dot">${icon(cls === 'done' ? 'check' : ic)}</span><span><span class="s-title" style="display:block">${label}</span><span class="s-sub">${sub}</span></span></li>`;
      }).join('')}
    </ol>`;
  }

  function eta(o) {
    if (o.status !== 'out_for_delivery' || !o.outForDeliveryAt) return '';
    const mins = Math.max(1, 20 - Math.round((Date.now() - new Date(o.outForDeliveryAt).getTime()) / 60000));
    return `<div class="alert alert-info" style="margin-bottom:14px">${icon('bike')}<div><div class="a-title">Arriving in about ${mins} min</div>Left the kitchen at ${UI.timeOnly(o.outForDeliveryAt)}.</div></div>`;
  }

  function renderOrder(o) {
    const type = o.type === 'subscription' ? 'Plan meal' : o.type === 'trial' ? '1-day trial' : 'Single meal';
    const addr = o.address;
    const refunded = (o.refunded || 0) + (o.goodwillRefund || 0);
    const live = ['preparing', 'out_for_delivery'].includes(o.status);
    detailView.innerHTML = `
      ${backLink()}
      ${UI.qs('placed') ? `<div class="alert alert-success" style="margin-bottom:14px">${icon('party-popper')}<div><div class="a-title">Order placed!</div>${esc(o.kitchen.name)} has your order. ${money(o.total)} is reserved from your wallet and charged on delivery.</div></div>` : ''}
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 class="h2">${esc(o.kitchen.name)}</h1>
          <p class="text-muted" style="margin:4px 0 0">${UI.date(o.date, { weekday: 'long', day: 'numeric', month: 'long' })} · ${o.slot === 'lunch' ? 'Lunch, 12:30–1:30 PM' : 'Dinner, 7:30–8:30 PM'}</p>
          <p class="text-xs text-subtle" style="margin:2px 0 0">${type} · ${esc(o.code)}</p>
        </div>
        ${UI.statusBadge(o.status)}
      </div>

      <div class="grid grid-cols-1 gap-5 md:grid-cols-2" style="margin-top:var(--s5)">
        <section class="card card-pad" aria-labelledby="trackTitle">
          <h2 class="title" id="trackTitle" style="margin-bottom:14px">${live ? 'Live status' : 'Status'}</h2>
          ${eta(o)}
          ${tracker(o)}
          ${live && o.kitchen.phone ? `<a class="btn btn-secondary btn-sm" style="margin-top:14px" href="tel:+91${esc(o.kitchen.phone)}">${icon('phone')}Call the kitchen</a>` : ''}
        </section>
        <section class="card card-pad" id="orderMapCard" aria-labelledby="mapTitle" hidden>
          <h2 class="title" id="mapTitle" style="margin-bottom:10px">Delivery</h2>
          <div class="map-box" id="orderMap" style="height:240px"></div>
          <p class="text-xs text-subtle" id="mapNote" style="margin:8px 0 0"></p>
        </section>
        <section class="card card-pad" aria-labelledby="itemsTitle">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h2 class="title" id="itemsTitle">Your thali</h2>
            ${UI.thaliTag((o.dietaryNotes || []).includes('Jain') && (o.mealType || 'veg') === 'veg' ? 'jain' : (o.mealType || 'veg'))}
          </div>
          <ul style="list-style:disc;margin:10px 0 0;padding-left:20px;display:grid;gap:6px">
            ${Object.values(o.choices || {}).map(v => `<li translate="no">${esc(v)}</li>`).join('') || '<li class="text-muted">Chef\'s menu of the day</li>'}
            ${(o.addons || []).map(a => `<li class="flex items-center justify-between text-sm"><span>+ ${esc(a.name)} × ${a.qty}</span><span class="num">${money(a.price * a.qty)}</span></li>`).join('')}
          </ul>
          ${o.dietaryNotes.length ? `<p class="text-xs text-subtle" style="margin:10px 0 0">Sent to the kitchen: ${esc(o.dietaryNotes.join(' · '))}</p>` : ''}
          ${o.note ? `<p class="text-sm" style="margin:8px 0 0"><span class="text-subtle">Your note:</span> ${esc(o.note)}</p>` : ''}
          <hr class="divider">
          <div class="kv"><span>${type}</span><span class="num">${money(o.amount)}</span></div>
          ${o.addonsTotal ? `<div class="kv"><span>Extras</span><span class="num">${money(o.addonsTotal)}</span></div>` : ''}
          <div class="kv total"><span>Total</span><span class="num">${money(o.total)}</span></div>
          ${refunded ? `<div class="kv text-success"><span>Refunded to wallet</span><span class="num">${money(refunded)}</span></div>` : ''}
          <p class="text-xs text-subtle" style="margin:6px 0 0">${o.status === 'delivered' ? 'Paid from your wallet on delivery.' : ['cancelled', 'paused', 'holiday'].includes(o.status) ? '' : 'Reserved in your wallet, charged on delivery.'}</p>
        </section>
        <section class="card card-pad" aria-labelledby="addrTitle">
          <h2 class="title" id="addrTitle">Delivering to</h2>
          ${addr ? `<p style="margin:8px 0 0"><strong>${esc(addr.label)}</strong><br><span class="text-sm text-muted">${esc(addressText(addr))}</span></p>` : '<p class="text-muted">No address</p>'}
          <div class="flex flex-wrap gap-2" style="margin-top:16px" id="orderActions"></div>
        </section>
      </div>
      <section id="orderTickets" style="margin-top:var(--s5)"></section>`;
    UI.icons(detailView);

    // Actions
    const actions = detailView.querySelector('#orderActions');
    const btns = [];
    if (o.editable && o.type !== 'subscription') btns.push(`<button type="button" class="btn btn-danger btn-sm" data-o="cancel">Cancel order</button>`);
    if (o.editable) btns.push(`<a class="btn btn-secondary btn-sm" href="/calendar.html">${icon('pencil')}Change dishes or extras</a>`);
    if (o.canReview) btns.push(`<button type="button" class="btn btn-primary btn-sm" data-o="review">${icon('star')}Rate this meal</button>`);
    if (o.canComplain && !o.tickets.some(t => t.status !== 'resolved')) btns.push(`<button type="button" class="btn btn-secondary btn-sm" data-o="complain">${icon('life-buoy')}Report a problem</button>`);
    if (['delivered', 'cancelled', 'holiday'].includes(o.status)) btns.push(`<a class="btn btn-secondary btn-sm" href="/kitchen.html?id=${o.kitchenId}&reorder=${o.id}">${icon('rotate-ccw')}Order again</a>`);
    actions.innerHTML = btns.join('');
    if (o.review) actions.insertAdjacentHTML('beforebegin', `<p class="text-sm" style="margin:12px 0 0">You rated this ${UI.stars(o.review.rating)}${o.review.reply ? ' · the chef replied' : ''}</p>`);
    UI.icons(actions);

    actions.addEventListener('click', async e => {
      const b = e.target.closest('[data-o]');
      if (!b) return;
      if (b.dataset.o === 'cancel') {
        const yes = await UI.confirm({ title: 'Cancel this order?', body: `${money(o.total)} goes back to your wallet straight away.`, confirmText: 'Cancel order', cancelText: 'Keep it', danger: true });
        if (!yes) return;
        UI.busy(b, async () => {
          try {
            const res = await API.post(`/api/orders/${o.id}/cancel`);
            App.setWallet(res.balances);
            UI.toast(`Cancelled. ${money(o.total)} refunded to your wallet.`);
            showOrder(o.id);
          } catch (err) { UI.error(err); }
        });
      }
      if (b.dataset.o === 'review') { const r = await Review.open(o); if (r) showOrder(o.id); }
      if (b.dataset.o === 'complain') { const t = await Tickets.openNew(o); if (t) go(`/orders.html?ticket=${t.id}`); }
    });

    // Tickets on this order
    if (o.tickets.length) {
      const host = detailView.querySelector('#orderTickets');
      host.innerHTML = `<h2 class="title" style="margin-bottom:10px">Complaints on this order</h2><div style="display:grid;gap:10px">${o.tickets.map(t => `<a class="card card-link card-pad flex justify-between items-center" href="/orders.html?ticket=${t.id}"><strong>${esc(t.code)}</strong>${UI.statusBadge(t.status)}</a>`).join('')}</div>`;
      host.addEventListener('click', e => { const a = e.target.closest('a'); if (a) { e.preventDefault(); go(a.getAttribute('href')); } });
      UI.icons(host);
    }

    detailView.querySelector('[data-back]').addEventListener('click', e => { e.preventDefault(); go('/orders.html'); });

    if (window.Maps) Maps.renderOrderMap(detailView.querySelector('#orderMapCard'), o);
    // Refresh the ETA text every 30 s while it's on the way
    if (o.status === 'out_for_delivery') trackerTimer = setInterval(() => showOrder(o.id), 30000);
  }

  // ---------- Ticket thread ----------
  async function showTicket(id) {
    listView.hidden = true;
    detailView.hidden = false;
    detailView.innerHTML = UI.skeletonRows(4);
    try {
      const { ticket } = await API.get(`/api/tickets/${id}`);
      detailView.innerHTML = `<a href="/orders.html#help" class="btn btn-ghost btn-sm" data-back style="margin:-8px 0 12px -8px">${icon('arrow-left')}Help & complaints</a>
        <h1 class="h2" style="margin-bottom:14px">Complaint</h1>
        <div class="card card-pad" id="threadHost"></div>
        <p class="text-sm" style="margin-top:12px"><a class="link" href="/orders.html?id=${ticket.orderId}" data-order-link>View order ${esc(ticket.orderCode)}</a></p>`;
      UI.icons(detailView);
      Tickets.renderThread(detailView.querySelector('#threadHost'), ticket, { role: 'customer' });
      detailView.querySelector('[data-back]').addEventListener('click', e => { e.preventDefault(); tab = 'help'; go('/orders.html#help'); });
      detailView.querySelector('[data-order-link]').addEventListener('click', e => { e.preventDefault(); go(`/orders.html?id=${ticket.orderId}`); });
    } catch (e) {
      detailView.innerHTML = `${backLink()}${UI.errorState(e.message)}`;
      UI.icons(detailView);
    }
  }

  // ---------- Live updates ----------
  if (window.Live) {
    Live.on('orders', () => { if (UI.qs('id')) showOrder(Number(UI.qs('id'))); else if (!listView.hidden && tab !== 'help') selectTab(tab); });
    Live.on('tickets', () => { if (UI.qs('ticket')) showTicket(Number(UI.qs('ticket'))); else if (!listView.hidden && tab === 'help') selectTab('help'); });
  }

  route();
})();
