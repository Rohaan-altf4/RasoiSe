// Shared UI helpers: formatting, toasts, dialogs, confirm/prompt, loading buttons,
// form errors, status badges and empty/skeleton states.

(function () {
  const PLACEHOLDER = '/img/placeholder-thali.svg';

  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const money = n => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');

  // 'YYYY-MM-DD' -> 'Thu, 16 Oct'
  function date(d, opts = { weekday: 'short', day: 'numeric', month: 'short' }) {
    if (!d) return '';
    return new Date(d + 'T00:00:00Z').toLocaleDateString('en-IN', { ...opts, timeZone: 'UTC' });
  }

  function dateTime(iso) {
    return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
  }

  function timeOnly(iso) {
    return new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
  }

  function relTime(iso) {
    const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
    if (s < 7 * 86400) return `${Math.floor(s / 86400)} d ago`;
    return dateTime(iso);
  }

  function time12(hhmm) {
    const [h, m] = String(hhmm || '08:00').split(':').map(Number);
    return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
  }

  function distance(m) {
    if (m == null) return '';
    return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`;
  }

  function icons(root) {
    if (window.lucide) window.lucide.createIcons({ attrs: { 'aria-hidden': 'true' }, root: root || document });
  }

  function icon(name, cls = '') {
    return `<i data-lucide="${name}" class="${cls}"></i>`;
  }

  // ---------- Toasts ----------
  function toastStack() {
    let el = document.querySelector('.toast-stack');
    if (!el) {
      el = document.createElement('div');
      el.className = 'toast-stack';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      document.body.appendChild(el);
    }
    return el;
  }

  function toast(message, { type = 'success', title = '', timeout = 4000 } = {}) {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `${icon(type === 'error' ? 'circle-alert' : type === 'info' ? 'bell' : 'circle-check')}
      <div>${title ? `<div class="t-title">${esc(title)}</div>` : ''}<div class="${title ? 't-body' : 't-title'}">${esc(message)}</div></div>
      <button type="button" aria-label="Dismiss">${icon('x', 'icon-sm')}</button>`;
    toastStack().appendChild(el);
    icons(el);
    const remove = () => { el.classList.add('leaving'); setTimeout(() => el.remove(), 160); };
    el.querySelector('button').addEventListener('click', remove);
    setTimeout(remove, timeout);
  }

  function error(err, title) {
    toast(err && err.message ? err.message : String(err), { type: 'error', title, timeout: 6000 });
  }

  // ---------- Dialogs ----------
  // Native <dialog> gives us focus trapping and Escape-to-close for free.
  function openModal(dlg) {
    if (typeof dlg === 'string') dlg = document.getElementById(dlg);
    if (!dlg.open) dlg.showModal();
    icons(dlg);
    const first = dlg.querySelector('[autofocus], input:not([type=hidden]), select, textarea, button:not([data-close])');
    if (first) setTimeout(() => first.focus(), 30);
    return dlg;
  }

  function closeModal(dlg) {
    if (typeof dlg === 'string') dlg = document.getElementById(dlg);
    if (dlg && dlg.open) dlg.close();
  }

  // Close buttons and backdrop clicks
  document.addEventListener('click', e => {
    const closer = e.target.closest('[data-close]');
    if (closer) closeModal(closer.closest('dialog'));
    if (e.target.tagName === 'DIALOG' && e.target.classList.contains('modal')) {
      const r = e.target.getBoundingClientRect();
      const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      if (!inside) e.target.close();
    }
  });

  // Build a throwaway dialog (used by confirm/prompt)
  function tempDialog(html, size = 'modal-sm') {
    const dlg = document.createElement('dialog');
    dlg.className = `modal ${size}`;
    dlg.innerHTML = html;
    document.body.appendChild(dlg);
    dlg.addEventListener('close', () => setTimeout(() => dlg.remove(), 250));
    return dlg;
  }

  function confirm({ title, body = '', confirmText = 'Confirm', cancelText = 'Cancel', danger = false }) {
    return new Promise(resolve => {
      const dlg = tempDialog(`
        <div class="modal-head"><h2 class="h3">${esc(title)}</h2></div>
        <div class="modal-body"><p class="text-muted" style="margin:0">${body}</p></div>
        <div class="modal-foot">
          <button type="button" class="btn btn-secondary" data-r="0">${esc(cancelText)}</button>
          <button type="button" class="btn ${danger ? 'btn-danger-solid' : 'btn-primary'}" data-r="1">${esc(confirmText)}</button>
        </div>`);
      let result = false;
      dlg.querySelectorAll('[data-r]').forEach(b => b.addEventListener('click', () => { result = b.dataset.r === '1'; dlg.close(); }));
      dlg.addEventListener('close', () => resolve(result));
      openModal(dlg);
      dlg.querySelector('[data-r="1"]').focus();
    });
  }

  // Ask for a short text (e.g. a ban reason). Resolves to the text or null.
  function prompt({ title, body = '', label = 'Reason', placeholder = '', confirmText = 'Submit', danger = false, required = true, minLength = 5, value = '' }) {
    return new Promise(resolve => {
      const dlg = tempDialog(`
        <form method="dialog" novalidate>
          <div class="modal-head"><h2 class="h3">${esc(title)}</h2></div>
          <div class="modal-body">
            ${body ? `<p class="text-muted" style="margin:0 0 12px">${body}</p>` : ''}
            <div class="field">
              <label class="field-label" for="ui-prompt-input">${esc(label)}${required ? ' <span class="req">*</span>' : ''}</label>
              <textarea id="ui-prompt-input" class="textarea" placeholder="${esc(placeholder)}" maxlength="500">${esc(value)}</textarea>
              <p class="field-error">Please write at least ${minLength} characters.</p>
            </div>
          </div>
          <div class="modal-foot">
            <button type="button" class="btn btn-secondary" data-cancel>Cancel</button>
            <button type="submit" class="btn ${danger ? 'btn-danger-solid' : 'btn-primary'}">${esc(confirmText)}</button>
          </div>
        </form>`);
      let result = null;
      const input = dlg.querySelector('textarea');
      dlg.querySelector('[data-cancel]').addEventListener('click', () => dlg.close());
      dlg.querySelector('form').addEventListener('submit', e => {
        const v = input.value.trim();
        if (required && v.length < minLength) {
          e.preventDefault();
          input.closest('.field').classList.add('has-error');
          input.focus();
          return;
        }
        result = v;
      });
      dlg.addEventListener('close', () => resolve(result));
      openModal(dlg);
    });
  }

  // ---------- Buttons & forms ----------
  // Runs fn while the button shows a spinner; ignores extra clicks (no double submits).
  async function busy(btn, fn) {
    if (!btn) return fn();
    if (btn.dataset.busy === '1') return undefined;
    btn.dataset.busy = '1';
    btn.classList.add('is-loading');
    btn.setAttribute('aria-busy', 'true');
    try {
      return await fn();
    } finally {
      btn.dataset.busy = '';
      btn.classList.remove('is-loading');
      btn.removeAttribute('aria-busy');
    }
  }

  function clearErrors(form) {
    form.querySelectorAll('.field.has-error').forEach(f => f.classList.remove('has-error'));
  }

  // Show a message under a field: setFieldError(form, 'email', 'Already used')
  function setFieldError(form, name, message) {
    const input = form.querySelector(`[name="${name}"]`);
    if (!input) return false;
    const field = input.closest('.field');
    if (!field) return false;
    let el = field.querySelector('.field-error');
    if (!el) {
      el = document.createElement('p');
      el.className = 'field-error';
      field.appendChild(el);
    }
    el.textContent = message;
    field.classList.add('has-error');
    input.setAttribute('aria-invalid', 'true');
    return true;
  }

  // Apply ApiError.fields to a form; returns true if any field showed the error.
  function showApiErrors(form, err) {
    clearErrors(form);
    let shown = false;
    if (err.fields) Object.entries(err.fields).forEach(([k, v]) => { shown = setFieldError(form, k, v) || shown; });
    const first = form.querySelector('.has-error input, .has-error select, .has-error textarea');
    if (first) first.focus();
    return shown;
  }

  // ---------- Building blocks ----------
  const STATUS = {
    scheduled: ['Scheduled', 'badge-success', 'calendar-check'],
    preparing: ['Preparing', 'badge-info', 'chef-hat'],
    out_for_delivery: ['Out for delivery', 'badge-info', 'bike'],
    delivered: ['Delivered', 'badge-neutral', 'check'],
    paused: ['Paused', 'badge-warning', 'pause'],
    cancelled: ['Cancelled', 'badge-danger', 'x'],
    holiday: ['Chef holiday', 'badge-neutral', 'palmtree'],
    pending: ['Pending approval', 'badge-warning', 'hourglass'],
    approved: ['Live', 'badge-success', 'circle-check'],
    rejected: ['Needs changes', 'badge-danger', 'circle-x'],
    banned: ['Banned', 'badge-danger', 'ban'],
    active: ['Active', 'badge-success', 'circle-check'],
    completed: ['Completed', 'badge-neutral', 'check'],
    changed: ['Changed', 'badge-neutral', 'repeat'],
    open: ['Open', 'badge-warning', 'circle-dot'],
    chef_responded: ['Chef replied', 'badge-info', 'message-circle'],
    escalated: ['Escalated', 'badge-danger', 'triangle-alert'],
    resolved: ['Resolved', 'badge-success', 'circle-check']
  };

  function statusBadge(status) {
    const [label, cls, ic] = STATUS[status] || [status, 'badge-neutral', 'circle'];
    return `<span class="badge ${cls}">${icon(ic)}${esc(label)}</span>`;
  }

  function statusLabel(status) {
    return (STATUS[status] || [status])[0];
  }

  function foodMark(type = 'veg') {
    const label = type === 'nonveg' ? 'Non-veg' : type === 'egg' ? 'Contains egg' : 'Veg';
    return `<span class="food-mark ${type}" role="img" aria-label="${label}" title="${label}"></span>`;
  }

  function ratingPill(r, count) {
    if (r == null) return '<span class="badge badge-neutral">New</span>';
    const cls = r >= 4 ? '' : r >= 3 ? 'low' : 'bad';
    return `<span class="rating-pill ${cls}" aria-label="Rated ${r} out of 5">${icon('star')}${Number(r).toFixed(1)}</span>${count != null ? ` <span class="text-subtle text-sm">(${count})</span>` : ''}`;
  }

  function stars(n) {
    const r = Math.round(n);
    return `<span class="stars" aria-label="${r} out of 5 stars">${'★'.repeat(r)}<span style="color:var(--star-off)">${'★'.repeat(5 - r)}</span></span>`;
  }

  function img(url, alt = '', cls = '') {
    return `<img src="${esc(url || PLACEHOLDER)}" alt="${esc(alt)}" class="${cls}" loading="lazy" onerror="this.onerror=null;this.src='${PLACEHOLDER}'">`;
  }

  function empty({ icon: ic = 'utensils', title, body = '', action = '' }) {
    return `<div class="empty-state"><div class="es-icon">${icon(ic)}</div><h3>${esc(title)}</h3>${body ? `<p>${body}</p>` : ''}${action}</div>`;
  }

  function errorState(message, retryAction = '') {
    return `<div class="empty-state"><div class="es-icon" style="background:var(--danger-bg);color:var(--danger)">${icon('wifi-off')}</div><h3>Couldn't load this</h3><p>${esc(message)}</p>${retryAction}</div>`;
  }

  function skeletonCards(n = 6) {
    return Array.from({ length: n }, () => `
      <div aria-hidden="true"><div class="skeleton sk-img"></div><div class="skeleton sk-title" style="margin-top:12px"></div><div class="skeleton sk-line" style="width:80%"></div><div class="skeleton sk-line" style="width:50%"></div></div>`).join('');
  }

  function skeletonRows(n = 4) {
    return Array.from({ length: n }, () => `<div aria-hidden="true" style="padding:12px 0"><div class="skeleton sk-title" style="width:40%"></div><div class="skeleton sk-line"></div></div>`).join('');
  }

  // Simple click delegation: <button data-action="pause" data-id="4">
  const actions = {};
  function on(name, handler) { actions[name] = handler; }
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-action]');
    if (!el || !actions[el.dataset.action]) return;
    e.preventDefault();
    actions[el.dataset.action](el, e);
  });

  function qs(name) {
    return new URLSearchParams(location.search).get(name);
  }

  window.UI = {
    PLACEHOLDER, esc, money, date, dateTime, timeOnly, relTime, time12, distance, icons, icon,
    toast, error, openModal, closeModal, confirm, prompt, busy, clearErrors, setFieldError, showApiErrors,
    statusBadge, statusLabel, foodMark, ratingPill, stars, img, empty, errorState, skeletonCards, skeletonRows,
    on, qs
  };
})();
