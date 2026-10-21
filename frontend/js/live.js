// Live updates: one Server-Sent Events connection per tab.
// - "notification" events update the bell and show a toast
// - "refresh" events tell the page which data changed (orders, wallet, tickets...)
// If SSE isn't available, falls back to polling every 15 seconds.

(function () {
  const { esc, icon } = UI;
  const handlers = {};
  let unread = 0;
  let source = null;
  let pollTimer = null;
  let lastSeenId = 0;
  const pending = new Set();
  let flushTimer = null;

  const TYPE_ICON = {
    new_order: 'shopping-bag', new_subscription: 'calendar-plus', order_confirmed: 'circle-check', order_status: 'bike',
    order_changed: 'pencil', order_cancelled: 'circle-x', meal_paused: 'pause', meal_resumed: 'play', holiday: 'palmtree',
    kitchen_holiday: 'palmtree', menu_updated: 'utensils', new_review: 'star', review_reply: 'message-circle',
    kitchen_flagged: 'flag', ticket: 'life-buoy', refund: 'wallet', low_balance: 'wallet', payout: 'banknote',
    kitchen_pending: 'hourglass', kitchen_approved: 'badge-check', kitchen_rejected: 'circle-x', kitchen_warning: 'triangle-alert',
    kitchen_banned: 'ban', kitchen_unbanned: 'circle-check', subscription_started: 'calendar-check', subscription_cancelled: 'calendar-x',
    subscription_renewed: 'repeat', subscription_changed: 'repeat', renewal_failed: 'triangle-alert'
  };

  function setCount(n) {
    unread = Math.max(0, n);
    const el = document.getElementById('bellCount');
    const btn = document.getElementById('bellBtn');
    if (el) {
      el.hidden = unread === 0;
      el.textContent = unread > 99 ? '99+' : String(unread);
    }
    if (btn) btn.setAttribute('aria-label', `Notifications${unread ? `, ${unread} unread` : ''}`);
    App.session.unread = unread;
  }

  function on(topic, fn) {
    (handlers[topic] = handlers[topic] || []).push(fn);
  }

  // Several refresh events often arrive together; run each handler once.
  function queue(topics) {
    topics.forEach(t => pending.add(t));
    clearTimeout(flushTimer);
    flushTimer = setTimeout(() => {
      const topicsNow = [...pending];
      pending.clear();
      topicsNow.forEach(t => (handlers[t] || []).forEach(fn => { try { fn(); } catch (e) { console.error(e); } }));
      if (topicsNow.includes('wallet') || topicsNow.includes('kitchen')) updateSession();
    }, 300);
  }

  async function updateSession() {
    try {
      const me = await API.get('/api/auth/me');
      App.session.wallet = me.wallet;
      App.session.kitchen = me.kitchen;
      if (me.wallet) App.setWallet(me.wallet);
      setCount(me.unread || 0);
    } catch (e) { /* ignore */ }
  }

  function onNotification(n) {
    if (n.id <= lastSeenId) return;
    lastSeenId = n.id;
    setCount(unread + 1);
    UI.toast(n.body || '', { type: 'info', title: n.title, timeout: 6000 });
    const menu = document.getElementById('bellMenu');
    if (menu && menu.classList.contains('is-open')) openBell();
  }

  function start() {
    if (source || pollTimer) return;
    if (!('EventSource' in window)) return startPolling();
    source = new EventSource('/api/events');
    source.addEventListener('hello', e => { setCount(JSON.parse(e.data).unread); });
    source.addEventListener('notification', e => onNotification(JSON.parse(e.data)));
    source.addEventListener('refresh', e => queue(JSON.parse(e.data).topics || []));
    source.addEventListener('error', () => {
      // Browser retries on its own; if it gave up (e.g. signed out), fall back to polling
      if (source.readyState === EventSource.CLOSED) {
        source = null;
        startPolling();
      }
    });
  }

  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(async () => {
      try {
        const res = await API.get('/api/notifications?limit=5');
        const fresh = res.notifications.filter(n => n.id > lastSeenId && !n.read);
        if (lastSeenId && fresh.length) {
          fresh.reverse().forEach(onNotification);
          queue(Object.keys(handlers));
        }
        lastSeenId = Math.max(lastSeenId, ...res.notifications.map(n => n.id), 0);
        setCount(res.unread);
      } catch (e) { /* offline: try again next tick */ }
    }, 15000);
  }

  async function openBell() {
    const menu = document.getElementById('bellMenu');
    if (!menu) return;
    menu.innerHTML = `<div class="notif-head"><strong>Notifications</strong></div><div class="notif-list">${UI.skeletonRows(3)}</div>`;
    try {
      const res = await API.get('/api/notifications?limit=30');
      lastSeenId = Math.max(lastSeenId, ...res.notifications.map(n => n.id), 0);
      setCount(res.unread);
      menu.innerHTML = `
        <div class="notif-head">
          <strong>Notifications</strong>
          ${res.unread ? '<button type="button" class="link text-sm" id="markAllRead">Mark all as read</button>' : ''}
        </div>
        <div class="notif-list">
          ${res.notifications.length ? res.notifications.map(n => `
            <a class="notif${n.read ? '' : ' unread'}" href="/${esc(n.link || '#')}" data-nid="${n.id}">
              <span class="n-icon">${icon(TYPE_ICON[n.type] || 'bell')}</span>
              <span style="min-width:0">
                <span class="n-title" style="display:block">${esc(n.title)}</span>
                ${n.body ? `<span class="n-body clamp-2" style="display:block">${esc(n.body)}</span>` : ''}
                <span class="n-time" style="display:block">${UI.relTime(n.createdAt)}</span>
              </span>
            </a>`).join('') : `<div class="empty-state" style="padding:32px 16px"><div class="es-icon">${icon('bell')}</div><p>You're all caught up.</p></div>`}
        </div>`;
      UI.icons(menu);
      const all = menu.querySelector('#markAllRead');
      if (all) all.addEventListener('click', async e => {
        e.stopPropagation();
        const r = await API.post('/api/notifications/read', { all: true });
        setCount(r.unread);
        menu.querySelectorAll('.notif.unread').forEach(x => x.classList.remove('unread'));
        all.remove();
      });
      menu.querySelectorAll('[data-nid]').forEach(a => a.addEventListener('click', async e => {
        const id = Number(a.dataset.nid);
        if (a.classList.contains('unread')) {
          e.preventDefault();
          try { await API.post('/api/notifications/read', { ids: [id] }); } catch (err) { /* still navigate */ }
          const href = a.getAttribute('href');
          // Same page + hash: let the page react without a full reload
          if (href.split('#')[0] === location.pathname + location.search || href === location.pathname) { location.hash = href.split('#')[1] || ''; location.reload(); }
          else location.href = href;
        }
      }));
    } catch (e) {
      menu.innerHTML = `<div class="notif-head"><strong>Notifications</strong></div><p class="text-sm text-danger" style="padding:14px">${esc(e.message)}</p>`;
    }
  }

  window.Live = { start, on, openBell, setCount };
})();
