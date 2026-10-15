// Page shell shared by every customer/chef page: loads the session, renders the sticky header
// (location, search, wallet, bell, account), the footer and the mobile bottom nav.
//
// Usage on a page:  const session = await App.init({ active: 'home', search: true });

(function () {
  const { esc, icon, money } = UI;
  const GUEST_LOC_KEY = 'rasoi_guest_location'; // harmless UI preference for logged-out visitors

  const App = {
    session: { user: null },
    listeners: {},

    async init(opts = {}) {
      this.opts = opts;
      try {
        this.session = await API.get('/api/auth/me');
      } catch (e) {
        this.session = { user: null, today: new Date().toISOString().slice(0, 10) };
      }
      const u = this.session.user;
      if (opts.requireRole && (!u || !opts.requireRole.includes(u.role))) {
        location.href = u ? '/index.html' : `/login.html?next=${encodeURIComponent(location.pathname + location.search)}`;
        return new Promise(() => {}); // stop the page script
      }
      renderHeader();
      renderFooter();
      renderBottomNav();
      if (window.Live && u) Live.start();
      UI.icons();
      // Two frames: let Tailwind apply its styles before fading the page in
      requestAnimationFrame(() => requestAnimationFrame(() => document.documentElement.classList.remove('page-loading')));
      return this.session;
    },

    async refreshSession() {
      const before = this.role;
      this.session = await API.get('/api/auth/me');
      renderHeader();
      // Signed in / out on this page (e.g. after registering): footer and bottom nav depend on the role
      if (this.role !== before) {
        ['site-footer', 'bottom-nav'].forEach(id => { const el = document.getElementById(id); if (el) el.remove(); });
        document.body.classList.remove('has-bottom-nav');
        renderFooter();
        renderBottomNav();
      }
      UI.icons();
      return this.session;
    },

    get user() { return this.session.user; },
    get role() { return this.session.user ? this.session.user.role : 'guest'; },

    // Where distances are measured from: the default saved address, or the guest's pick.
    origin() {
      const u = this.session.user;
      if (u && u.role === 'customer') {
        const a = (u.addresses || []).find(x => x.id === u.defaultAddressId) || (u.addresses || [])[0];
        if (a) return { lat: a.lat, lng: a.lng, label: a.label === 'Other' && a.customLabel ? a.customLabel : a.label, sub: [a.flat, a.building].filter(Boolean).join(', ') || a.formatted, addressId: a.id };
        return null;
      }
      try {
        const g = JSON.parse(localStorage.getItem(GUEST_LOC_KEY) || 'null');
        if (g && Number.isFinite(g.lat)) return g;
      } catch (e) { /* storage blocked */ }
      return null;
    },

    setGuestOrigin(loc) {
      try { localStorage.setItem(GUEST_LOC_KEY, JSON.stringify(loc)); } catch (e) { /* ignore */ }
      renderHeader();
      UI.icons();
      this.emit('origin');
    },

    on(topic, fn) {
      (this.listeners[topic] = this.listeners[topic] || []).push(fn);
    },

    emit(topic, data) {
      (this.listeners[topic] || []).forEach(fn => { try { fn(data); } catch (e) { console.error(e); } });
    },

    async signOut() {
      try { await API.post('/api/auth/logout'); } catch (e) { /* ignore */ }
      location.href = '/index.html';
    }
  };

  // ---------- Header ----------
  function navLink(href, label, key, ic) {
    const active = App.opts.active === key ? ' is-active' : '';
    return `<a class="header-link${active}" href="${href}"${active ? ' aria-current="page"' : ''} aria-label="${label}" title="${label}">${icon(ic, 'icon-sm')}<span class="hl-text">${label}</span></a>`;
  }

  function initials(name) {
    return esc(String(name || '?').split(' ').map(s => s[0]).slice(0, 2).join('').toUpperCase());
  }

  function renderHeader() {
    const u = App.session.user;
    const role = u ? u.role : 'guest';
    let host = document.getElementById('site-header');
    if (!host) {
      host = document.createElement('header');
      host.id = 'site-header';
      document.body.prepend(host);
    }
    host.className = 'site-header';

    const origin = App.origin();
    const locBtn = (role === 'customer' || role === 'guest') ? `
      <button type="button" class="loc-btn" id="locBtn" aria-haspopup="dialog" aria-label="Change delivery location">
        ${icon('map-pin', 'text-saffron')}
        <span class="truncate" style="min-width:0">
          <span class="loc-label">${esc(origin ? origin.label : 'Set location')}${icon('chevron-down', 'icon-xs')}</span>
          <span class="loc-sub truncate" style="display:block">${esc(origin ? (origin.sub || 'Andheri West') : 'To see kitchens that deliver to you')}</span>
        </span>
      </button>` : '';

    const search = App.opts.search ? `
      <form class="header-search" role="search" id="headerSearchForm">
        <div class="input-group">
          <span class="prefix">${icon('search', 'icon-sm')}</span>
          <label for="headerSearch" class="sr-only">Search kitchens or dishes</label>
          <input id="headerSearch" class="input" type="search" placeholder="Search kitchens, dishes, cuisines" autocomplete="off" style="min-height:40px">
        </div>
      </form>` : '';

    let links = '';
    let right = '';
    if (role === 'guest') {
      links = navLink('/chef-onboarding.html', 'Cook with us', 'partner', 'chef-hat');
      right = `<a class="btn btn-dark btn-sm" href="/login.html?next=${encodeURIComponent(location.pathname + location.search)}">Sign in</a>`;
    } else if (role === 'customer') {
      links = navLink('/index.html', 'Kitchens', 'home', 'utensils') + navLink('/calendar.html', 'My meals', 'meals', 'calendar-days') + navLink('/orders.html', 'Orders', 'orders', 'receipt-text');
      right = `
        <a class="wallet-pill" href="/calendar.html#wallet" title="Wallet balance">${icon('wallet', 'icon-sm')}<span id="headerWallet" class="num">${money(App.session.wallet ? App.session.wallet.available : 0)}</span></a>
        ${bellHtml()}
        ${accountMenu(u, [
          ['/calendar.html', 'My meals & plans', 'calendar-days'],
          ['/orders.html', 'Orders & help', 'receipt-text'],
          ['/profile.html', 'Profile & preferences', 'user-round'],
          ['/profile.html#addresses', 'Saved addresses', 'map-pin']
        ])}`;
    } else if (role === 'chef') {
      links = navLink('/chef-dashboard.html', 'Today', 'chef-today', 'clipboard-list') + navLink('/chef-settings.html', 'Kitchen & menu', 'chef-settings', 'settings');
      right = `${bellHtml()}${accountMenu(u, [
        ['/chef-dashboard.html', 'Dashboard', 'clipboard-list'],
        ['/chef-settings.html', 'Kitchen & menu', 'settings'],
        [App.session.kitchen ? `/kitchen.html?id=${App.session.kitchen.id}` : '/chef-settings.html', 'View my storefront', 'store']
      ])}`;
    } else if (role === 'admin') {
      links = navLink('/admin-console.html', 'Admin console', 'admin', 'shield');
      right = `${bellHtml()}${accountMenu(u, [['/admin-console.html', 'Admin console', 'shield']])}`;
    }

    host.innerHTML = `
      <a class="skip-link" href="#main">Skip to content</a>
      <div class="container bar">
        <a class="logo" href="${role === 'chef' ? '/chef-dashboard.html' : role === 'admin' ? '/admin-console.html' : '/index.html'}" aria-label="RasoiSe home">Rasoi<span>Se</span></a>
        ${role === 'chef' ? '<span class="badge badge-saffron" style="margin-left:-4px">Partner</span>' : ''}
        ${locBtn}
        ${search}
        <nav class="header-actions" aria-label="Main">
          ${links}
          ${role !== 'admin' ? themeButtonHtml() : ''}
          ${right}
        </nav>
      </div>`;

    wireHeader();
  }

  // ---------- Light / dark toggle ----------
  function isDark() {
    return document.documentElement.dataset.theme === 'dark';
  }

  function themeButtonHtml() {
    const label = isDark() ? 'Switch to light mode' : 'Switch to dark mode';
    return `<button type="button" class="icon-btn theme-toggle" id="themeBtn" aria-label="${label}" title="${label}">
      <span class="when-light">${icon('moon')}</span><span class="when-dark">${icon('sun')}</span>
    </button>`;
  }

  function toggleTheme() {
    const next = isDark() ? 'light' : 'dark';
    const root = document.documentElement;
    root.classList.add('theme-switching'); // short colour fade, then back to normal transitions
    root.dataset.theme = next;
    try { localStorage.setItem('rasoi_theme', next); } catch (e) { /* storage blocked: still switches */ }
    setTimeout(() => root.classList.remove('theme-switching'), 250);
    const btn = document.getElementById('themeBtn');
    if (btn) {
      const label = next === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
      btn.setAttribute('aria-label', label);
      btn.title = label;
    }
    App.emit('theme', next);
  }

  function bellHtml() {
    const n = App.session.unread || 0;
    return `
      <div class="dropdown" id="bellWrap">
        <button type="button" class="icon-btn" id="bellBtn" aria-haspopup="true" aria-expanded="false" aria-label="Notifications${n ? `, ${n} unread` : ''}">
          ${icon('bell')}<span class="dot-count" id="bellCount" ${n ? '' : 'hidden'}>${n > 99 ? '99+' : n}</span>
        </button>
        <div class="menu notif-menu" id="bellMenu" role="region" aria-label="Notifications"></div>
      </div>`;
  }

  function accountMenu(u, items) {
    return `
      <div class="dropdown">
        <button type="button" class="icon-btn" id="accountBtn" aria-haspopup="true" aria-expanded="false" aria-label="Account menu">
          <span class="avatar">${initials(u.name)}</span>
        </button>
        <div class="menu" id="accountMenu" role="menu">
          <div class="menu-head">
            <div style="font-weight:700">${esc(u.name)}</div>
            <div class="text-xs text-subtle truncate">${esc(u.email || u.phone)}</div>
          </div>
          <div class="menu-sep"></div>
          ${items.map(([href, label, ic]) => `<a class="menu-item" role="menuitem" href="${href}">${icon(ic, 'icon-sm')}${label}</a>`).join('')}
          ${u.role !== 'customer' ? `<button type="button" class="menu-item" role="menuitem" id="passwordBtn">${icon('key-round', 'icon-sm')}Change password</button>` : ''}
          <div class="menu-sep"></div>
          <button type="button" class="menu-item danger" role="menuitem" id="signOutBtn">${icon('log-out', 'icon-sm')}Sign out</button>
        </div>
      </div>`;
  }

  // Change password (chefs and admin; customers do this on their profile page)
  function openPasswordDialog() {
    const dlg = document.createElement('dialog');
    dlg.className = 'modal modal-sm';
    dlg.innerHTML = `
      <form novalidate>
        <div class="modal-head"><h2 class="h3">Change password</h2><button type="button" class="icon-btn" data-close aria-label="Close">${icon('x')}</button></div>
        <div class="modal-body">
          <div class="field"><label class="field-label" for="pwCurrent">Current password</label><input id="pwCurrent" name="current" type="password" class="input" autocomplete="current-password"><p class="field-error"></p></div>
          <div class="field"><label class="field-label" for="pwNext">New password</label><input id="pwNext" name="next" type="password" class="input" autocomplete="new-password"><p class="field-hint">At least 8 characters.</p><p class="field-error"></p></div>
          <div class="field"><label class="field-label" for="pwAgain">Repeat new password</label><input id="pwAgain" name="again" type="password" class="input" autocomplete="new-password"><p class="field-error"></p></div>
        </div>
        <div class="modal-foot"><button type="button" class="btn btn-secondary" data-close>Cancel</button><button type="submit" class="btn btn-primary">Update password</button></div>
      </form>`;
    document.body.appendChild(dlg);
    dlg.addEventListener('close', () => setTimeout(() => dlg.remove(), 250));
    UI.openModal(dlg);
    const form = dlg.querySelector('form');
    form.addEventListener('submit', async e => {
      e.preventDefault();
      UI.clearErrors(form);
      if (!form.current.value) return UI.setFieldError(form, 'current', 'Enter your current password.');
      if (form.next.value.length < 8) return UI.setFieldError(form, 'next', 'At least 8 characters.');
      if (form.next.value !== form.again.value) return UI.setFieldError(form, 'again', 'The two new passwords don\'t match.');
      await UI.busy(form.querySelector('[type=submit]'), async () => {
        try {
          await API.post('/api/auth/password', { current: form.current.value, next: form.next.value });
          UI.toast('Password updated');
          dlg.close();
        } catch (err) { UI.setFieldError(form, 'current', err.message); }
      });
    });
  }

  // Dropdown open/close with outside click + Escape
  function toggleMenu(btn, menu, open) {
    const willOpen = open == null ? !menu.classList.contains('is-open') : open;
    document.querySelectorAll('.menu.is-open').forEach(m => { if (m !== menu) m.classList.remove('is-open'); });
    menu.classList.toggle('is-open', willOpen);
    btn.setAttribute('aria-expanded', String(willOpen));
    if (willOpen) {
      const first = menu.querySelector('a, button');
      if (first && btn.id === 'accountBtn') setTimeout(() => first.focus(), 20);
    }
    return willOpen;
  }

  function wireHeader() {
    const accBtn = document.getElementById('accountBtn');
    if (accBtn) accBtn.addEventListener('click', e => { e.stopPropagation(); toggleMenu(accBtn, document.getElementById('accountMenu')); });
    const bellBtn = document.getElementById('bellBtn');
    if (bellBtn) {
      bellBtn.addEventListener('click', e => {
        e.stopPropagation();
        const open = toggleMenu(bellBtn, document.getElementById('bellMenu'));
        if (open && window.Live) Live.openBell();
      });
    }
    const themeBtn = document.getElementById('themeBtn');
    if (themeBtn) themeBtn.addEventListener('click', toggleTheme);
    const out = document.getElementById('signOutBtn');
    if (out) out.addEventListener('click', () => App.signOut());
    const pw = document.getElementById('passwordBtn');
    if (pw) pw.addEventListener('click', () => { toggleMenu(accBtn, document.getElementById('accountMenu'), false); openPasswordDialog(); });
    const loc = document.getElementById('locBtn');
    if (loc) loc.addEventListener('click', () => openLocationPicker());
    const sf = document.getElementById('headerSearchForm');
    if (sf) {
      const input = document.getElementById('headerSearch');
      input.value = App.searchTerm || '';
      sf.addEventListener('submit', e => { e.preventDefault(); App.searchTerm = input.value.trim(); App.emit('search', App.searchTerm); });
      input.addEventListener('input', () => { App.searchTerm = input.value.trim(); App.emit('search', App.searchTerm); });
    }
  }

  document.addEventListener('click', e => {
    if (!e.target.closest('.dropdown')) {
      document.querySelectorAll('.menu.is-open').forEach(m => m.classList.remove('is-open'));
      document.querySelectorAll('[aria-expanded="true"]').forEach(b => { if (b.closest('.dropdown')) b.setAttribute('aria-expanded', 'false'); });
    }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      const open = document.querySelector('.menu.is-open');
      if (open) {
        open.classList.remove('is-open');
        const btn = open.parentElement.querySelector('[aria-expanded]');
        if (btn) { btn.setAttribute('aria-expanded', 'false'); btn.focus(); }
      }
    }
  });

  // ---------- Location picker (saved addresses / guest locality) ----------
  function openLocationPicker() {
    const u = App.session.user;
    if (u && u.role === 'customer' && window.AddressBook) return AddressBook.openSwitcher();
    if (window.AddressBook) return AddressBook.openGuest();
  }
  App.openLocationPicker = openLocationPicker;

  // ---------- Footer ----------
  function renderFooter() {
    if (document.getElementById('site-footer') || App.opts.noFooter) return;
    const u = App.session.user;
    const role = u ? u.role : 'guest';
    const f = document.createElement('footer');
    f.id = 'site-footer';
    f.className = 'site-footer';
    const customerLinks = role === 'customer'
      ? '<li><a href="/calendar.html">My meals</a></li><li><a href="/orders.html">Orders</a></li><li><a href="/orders.html#help">Help with an order</a></li>'
      : role === 'guest' ? '<li><a href="/login.html">Sign in</a></li><li><a href="/login.html#signup">Create an account</a></li>' : '';
    const chefLinks = role === 'chef'
      ? '<li><a href="/chef-dashboard.html">Chef dashboard</a></li><li><a href="/chef-settings.html">Kitchen & menu</a></li>'
      : role === 'guest' ? '<li><a href="/chef-onboarding.html">Start cooking with RasoiSe</a></li><li><a href="/login.html">Partner sign in</a></li>' : '<li><a href="/chef-onboarding.html">How cooking with RasoiSe works</a></li>';
    f.innerHTML = `
      <div class="container">
        <div class="inner">
          <div>
            <a class="logo" href="/index.html">Rasoi<span>Se</span></a>
            <p class="text-sm" style="margin:12px 0 0;max-width:320px">Everyday ghar ka khana from home cooks in your neighbourhood. Order a meal, try a day, or subscribe for the month.</p>
          </div>
          <div><h3>Eat</h3><ul><li><a href="/index.html">Kitchens near you</a></li>${customerLinks}</ul></div>
          <div><h3>Cook</h3><ul>${chefLinks}</ul></div>
          <div><h3>Where we deliver</h3><ul><li>Lokhandwala</li><li>Versova & Seven Bungalows</li><li>Oshiwara</li></ul></div>
        </div>
        <div class="legal"><span>© ${new Date().getFullYear()} RasoiSe · Andheri West, Mumbai</span><span>Payments are simulated in this version.</span></div>
      </div>`;
    document.body.appendChild(f);
  }

  // ---------- Bottom nav (mobile, customers & guests) ----------
  function renderBottomNav() {
    const role = App.role;
    if (role !== 'customer' && role !== 'guest') return;
    if (document.getElementById('bottom-nav')) return;
    const a = App.opts.active;
    const item = (href, label, ic, key) => `<a href="${href}" class="${a === key ? 'is-active' : ''}"${a === key ? ' aria-current="page"' : ''}>${icon(ic)}<span>${label}</span></a>`;
    const nav = document.createElement('nav');
    nav.id = 'bottom-nav';
    nav.className = 'bottom-nav';
    nav.setAttribute('aria-label', 'Primary');
    nav.innerHTML = role === 'guest'
      ? item('/index.html', 'Kitchens', 'utensils', 'home') + item('/login.html?next=/calendar.html', 'My meals', 'calendar-days', 'meals') + item('/login.html?next=/orders.html', 'Orders', 'receipt-text', 'orders') + item('/login.html', 'Sign in', 'user-round', 'profile')
      : item('/index.html', 'Kitchens', 'utensils', 'home') + item('/calendar.html', 'My meals', 'calendar-days', 'meals') + item('/orders.html', 'Orders', 'receipt-text', 'orders') + item('/profile.html', 'Profile', 'user-round', 'profile');
    document.body.appendChild(nav);
    document.body.classList.add('has-bottom-nav');
  }

  // Keep the header wallet in sync after any wallet change
  App.setWallet = function (balances) {
    if (!balances) return;
    App.session.wallet = balances;
    const el = document.getElementById('headerWallet');
    if (el) el.textContent = money(balances.available);
  };

  window.App = App;
})();
