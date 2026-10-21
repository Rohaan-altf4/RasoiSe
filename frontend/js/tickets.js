// Complaint threads, shared by the customer, chef and admin pages.
// Tickets.openNew(order) -> dialog to raise a complaint
// Tickets.renderThread(host, ticket, { role, dark, onChange }) -> thread with reply box and actions

(function () {
  const { esc, icon, money } = UI;
  let categories = null;

  async function getCategories() {
    if (!categories) categories = (await API.get('/api/tickets/categories')).categories;
    return categories;
  }

  function openNew(order) {
    return new Promise(async resolve => {
      const cats = await getCategories();
      const dlg = document.createElement('dialog');
      dlg.className = 'modal';
      dlg.innerHTML = `
        <form novalidate>
          <div class="modal-head"><div><h2 class="h3">Report a problem</h2><p class="text-sm text-muted" style="margin:4px 0 0">${esc(order.code)} · ${esc(order.kitchen.name)} · ${UI.date(order.date)} ${esc(order.slot)}</p></div><button type="button" class="icon-btn" data-close aria-label="Close">${icon('x')}</button></div>
          <div class="modal-body">
            <fieldset class="field" style="border:0;padding:0;margin:0">
              <legend class="field-label" style="margin-bottom:6px">What went wrong? <span class="req">*</span></legend>
              <div class="chips">${cats.map(c => `<label class="chip"><input type="radio" name="category" value="${c.id}">${esc(c.label)}</label>`).join('')}</div>
              <p class="field-error" id="catErr">Choose what went wrong.</p>
            </fieldset>
            <div class="field" style="margin-top:14px">
              <label class="field-label" for="tkMsg">Tell us what happened <span class="req">*</span></label>
              <textarea id="tkMsg" name="message" class="textarea" maxlength="1000" placeholder="e.g. The dal was missing and the rotis were cold."></textarea>
              <p class="field-error">Write at least 10 characters.</p>
            </div>
            <p class="text-xs text-subtle" style="margin:10px 0 0">The kitchen sees this and replies here. Hygiene problems go straight to the RasoiSe team. Refunds go to your wallet.</p>
          </div>
          <div class="modal-foot"><button type="button" class="btn btn-secondary" data-close>Cancel</button><button type="submit" class="btn btn-primary">Send</button></div>
        </form>`;
      document.body.appendChild(dlg);
      let result = null;
      dlg.addEventListener('close', () => { setTimeout(() => dlg.remove(), 250); resolve(result); });
      UI.openModal(dlg);
      const form = dlg.querySelector('form');
      form.addEventListener('submit', async e => {
        e.preventDefault();
        UI.clearErrors(form);
        const cat = (form.querySelector('[name="category"]:checked') || {}).value;
        const msg = form.message.value.trim();
        let bad = false;
        if (!cat) { form.querySelector('#catErr').closest('.field').classList.add('has-error'); bad = true; }
        if (msg.length < 10) { UI.setFieldError(form, 'message', 'Write at least 10 characters.'); bad = true; }
        if (bad) return;
        await UI.busy(form.querySelector('[type=submit]'), async () => {
          try {
            const res = await API.post('/api/tickets', { orderId: order.id, category: cat, message: msg });
            result = res.ticket;
            UI.toast(`Complaint ${res.ticket.code} sent`);
            dlg.close();
          } catch (err) { UI.error(err); }
        });
      });
    });
  }

  function roleName(m, viewerRole) {
    if (m.role === 'admin') return 'RasoiSe support';
    if (m.role === 'chef') return viewerRole === 'chef' ? 'You (kitchen)' : `${m.authorName} (kitchen)`;
    return viewerRole === 'customer' ? 'You' : m.authorName;
  }

  function renderThread(host, t, { role, onChange } = {}) {
    const closed = t.status === 'resolved';
    host.innerHTML = `
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div class="flex items-center gap-2 flex-wrap"><strong>${esc(t.code)} · ${esc(t.categoryLabel)}</strong>${UI.statusBadge(t.status)}</div>
          <div class="text-sm text-muted">${esc(t.orderCode)} · ${esc(t.kitchenName)} · ${UI.date(t.orderDate)} ${esc(t.orderSlot)}${role !== 'customer' ? ` · ${esc(t.customerName)}` : ''}</div>
        </div>
        ${t.refund ? `<span class="badge badge-success">${icon('wallet')}Refunded ${money(t.refund.amount)}</span>` : ''}
      </div>
      <ol style="list-style:none;margin:16px 0 0;padding:0;display:grid;gap:10px" aria-label="Messages">
        ${t.messages.map(m => m.system
          ? `<li class="text-xs text-subtle" style="text-align:center">${esc(m.body)} · ${UI.relTime(m.at)}</li>`
          : `<li class="panel" style="${m.role === role ? 'margin-left:24px;background:var(--saffron-soft);border-color:var(--saffron-line)' : 'margin-right:24px'}">
              <div class="flex justify-between gap-2 text-xs"><strong>${esc(roleName(m, role))}</strong><span class="text-subtle">${UI.relTime(m.at)}</span></div>
              <p style="margin:4px 0 0;white-space:pre-line">${esc(m.body)}</p>
            </li>`).join('')}
      </ol>
      ${closed ? `<p class="text-sm text-muted" style="margin:14px 0 0">${icon('circle-check', 'icon-sm')} Closed ${UI.relTime(t.resolvedAt)}.</p>` : `
      <form class="tk-reply" style="margin-top:14px" novalidate>
        <label class="sr-only" for="tkReply-${t.id}">Reply</label>
        <textarea id="tkReply-${t.id}" class="textarea" name="body" placeholder="${role === 'chef' ? 'Reply to the customer, e.g. say sorry and what you\'ll fix' : 'Write a reply'}" maxlength="1000" style="min-height:72px"></textarea>
        <div class="flex flex-wrap gap-2" style="margin-top:8px">
          <button type="submit" class="btn btn-primary btn-sm">${icon('send')}Send</button>
          ${(role === 'customer' || role === 'chef') && t.status !== 'escalated' ? `<button type="button" class="btn btn-secondary btn-sm" data-tk="escalate">${icon('shield-alert')}Ask RasoiSe to step in</button>` : ''}
          ${role === 'customer' ? `<button type="button" class="btn btn-ghost btn-sm" data-tk="close">Mark as resolved</button>` : ''}
          ${role === 'admin' ? `<button type="button" class="btn btn-success btn-sm" data-tk="resolve">${icon('circle-check')}Resolve…</button>` : ''}
        </div>
      </form>`}`;
    UI.icons(host);
    if (closed) return;

    const form = host.querySelector('.tk-reply');
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const body = form.body.value.trim();
      if (body.length < 2) { form.body.focus(); return; }
      await UI.busy(form.querySelector('[type=submit]'), async () => {
        try {
          const res = await API.post(`/api/tickets/${t.id}/messages`, { body });
          renderThread(host, res.ticket, { role, onChange });
          if (onChange) onChange(res.ticket);
        } catch (err) { UI.error(err); }
      });
    });
    const act = host.querySelector('[data-tk="escalate"]');
    if (act) act.addEventListener('click', async () => {
      const yes = await UI.confirm({ title: 'Ask RasoiSe support to step in?', body: 'Our team will read this thread and decide, including any refund.', confirmText: 'Send to support' });
      if (!yes) return;
      UI.busy(act, async () => {
        try {
          const res = await API.post(`/api/tickets/${t.id}/escalate`);
          UI.toast('Sent to RasoiSe support');
          renderThread(host, res.ticket, { role, onChange });
          if (onChange) onChange(res.ticket);
        } catch (err) { UI.error(err); }
      });
    });
    const close = host.querySelector('[data-tk="close"]');
    if (close) close.addEventListener('click', async () => {
      const yes = await UI.confirm({ title: 'Close this complaint?', body: 'Only do this if the problem is sorted.', confirmText: 'Mark as resolved' });
      if (!yes) return;
      try {
        const res = await API.post(`/api/tickets/${t.id}/resolve`, {});
        renderThread(host, res.ticket, { role, onChange });
        if (onChange) onChange(res.ticket);
      } catch (err) { UI.error(err); }
    });
    const resolve = host.querySelector('[data-tk="resolve"]');
    if (resolve) resolve.addEventListener('click', () => openResolve(t, res => { renderThread(host, res, { role, onChange }); if (onChange) onChange(res); }));
  }

  // Admin: resolve with an optional wallet refund
  function openResolve(t, done) {
    const dlg = document.createElement('dialog');
    dlg.className = 'modal modal-sm';
    dlg.innerHTML = `
      <form novalidate>
        <div class="modal-head"><div><h2 class="h3">Resolve ${esc(t.code)}</h2><p class="text-sm text-muted" style="margin:4px 0 0">Order total ${money(t.orderTotal)}${t.refundable < t.orderTotal ? ` · ${money(t.refundable)} still refundable` : ''}</p></div><button type="button" class="icon-btn" data-close aria-label="Close">${icon('x')}</button></div>
        <div class="modal-body">
          <div class="field">
            <label class="field-label" for="rsAmt">Refund to customer's wallet</label>
            <div class="input-group"><span class="prefix">₹</span><input id="rsAmt" name="amount" class="input num" inputmode="numeric" value="0" style="padding-left:30px"></div>
            <div class="chips" style="margin-top:8px">
              <button type="button" class="chip" data-amt="0">No refund</button>
              <button type="button" class="chip" data-amt="${Math.round(t.refundable / 2)}">Half · ${money(Math.round(t.refundable / 2))}</button>
              <button type="button" class="chip" data-amt="${t.refundable}">Full · ${money(t.refundable)}</button>
            </div>
            <p class="field-hint">For delivered meals, the kitchen's share is taken back from its earnings.</p>
            <p class="field-error"></p>
          </div>
          <div class="field">
            <label class="field-label" for="rsNote">Note to customer and chef</label>
            <textarea id="rsNote" name="note" class="textarea" maxlength="500" placeholder="e.g. Refunded in full. We've spoken to the kitchen about packing."></textarea>
          </div>
        </div>
        <div class="modal-foot"><button type="button" class="btn btn-secondary" data-close>Cancel</button><button type="submit" class="btn btn-success">Resolve</button></div>
      </form>`;
    document.body.appendChild(dlg);
    dlg.addEventListener('close', () => setTimeout(() => dlg.remove(), 250));
    UI.openModal(dlg);
    const form = dlg.querySelector('form');
    dlg.querySelectorAll('[data-amt]').forEach(b => b.addEventListener('click', () => { form.amount.value = b.dataset.amt; }));
    form.addEventListener('submit', async e => {
      e.preventDefault();
      UI.clearErrors(form);
      const amt = Number(form.amount.value || 0);
      if (!Number.isFinite(amt) || amt < 0 || amt > t.refundable) { UI.setFieldError(form, 'amount', `Enter between ₹0 and ${money(t.refundable)}.`); return; }
      await UI.busy(form.querySelector('[type=submit]'), async () => {
        try {
          const res = await API.post(`/api/tickets/${t.id}/resolve`, { refundAmount: amt, note: form.note.value });
          UI.toast(amt ? `Resolved with a ${money(amt)} refund` : 'Resolved');
          dlg.close();
          done(res.ticket);
        } catch (err) { UI.error(err); }
      });
    });
  }

  function listItem(t, role, href) {
    return `
      <a class="card card-link card-pad" href="${href}" style="display:block">
        <div class="flex items-start justify-between gap-2">
          <div style="min-width:0"><strong>${esc(t.code)} · ${esc(t.categoryLabel)}</strong>
            <div class="text-xs text-subtle">${esc(t.orderCode)} · ${esc(role === 'customer' ? t.kitchenName : t.customerName)} · ${UI.relTime(t.updatedAt)}</div></div>
          ${UI.statusBadge(t.status)}
        </div>
        ${t.lastMessage ? `<p class="text-sm text-muted truncate" style="margin:8px 0 0">${esc(t.lastMessage.body)}</p>` : ''}
      </a>`;
  }

  window.Tickets = { openNew, renderThread, listItem };
})();
