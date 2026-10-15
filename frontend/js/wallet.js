// Wallet top-up dialog (payments are simulated; see backend/lib/payments.js).
// Wallet.openTopUp(suggested) resolves to the new balances, or null if closed.

(function () {
  const { icon, money } = UI;

  function openTopUp(suggested = 0) {
    return new Promise(resolve => {
      const presets = [200, 500, 1000, 2000];
      const need = Math.max(0, Math.ceil(suggested / 10) * 10);
      if (need && !presets.includes(need)) presets.unshift(need);
      const dlg = document.createElement('dialog');
      dlg.className = 'modal modal-sm';
      dlg.innerHTML = `
        <form novalidate>
          <div class="modal-head">
            <div><h2 class="h3">Add money to wallet</h2>
            <p class="text-sm text-muted" style="margin:4px 0 0">Balance: <strong class="num">${money(App.session.wallet ? App.session.wallet.available : 0)}</strong></p></div>
            <button type="button" class="icon-btn" data-close aria-label="Close">${icon('x')}</button>
          </div>
          <div class="modal-body">
            ${need ? `<div class="alert alert-warning" style="margin-bottom:14px">${icon('wallet')}<div>You need <strong>${money(need)}</strong> more for this booking.</div></div>` : ''}
            <div class="chips" role="group" aria-label="Quick amounts">
              ${presets.slice(0, 4).map(p => `<button type="button" class="chip" data-amt="${p}">${money(p)}</button>`).join('')}
            </div>
            <div class="field" style="margin-top:14px">
              <label class="field-label" for="topupAmt">Amount</label>
              <div class="input-group"><span class="prefix">₹</span><input id="topupAmt" name="amount" class="input num" inputmode="numeric" value="${need || 500}" style="padding-left:30px"></div>
              <p class="field-hint">Between ₹50 and ₹10,000. Unused money stays in your wallet.</p>
              <p class="field-error"></p>
            </div>
            <p class="text-xs text-subtle" style="margin:12px 0 0">${icon('shield-check', 'icon-xs')} Payments are simulated in this version. No real money is charged.</p>
          </div>
          <div class="modal-foot">
            <button type="button" class="btn btn-secondary" data-close>Cancel</button>
            <button type="submit" class="btn btn-primary">Add money</button>
          </div>
        </form>`;
      document.body.appendChild(dlg);
      let result = null;
      dlg.addEventListener('close', () => { setTimeout(() => dlg.remove(), 250); resolve(result); });
      UI.openModal(dlg);
      const form = dlg.querySelector('form');
      dlg.querySelectorAll('[data-amt]').forEach(b => b.addEventListener('click', () => {
        form.amount.value = b.dataset.amt;
        dlg.querySelectorAll('[data-amt]').forEach(x => x.classList.toggle('is-active', x === b));
      }));
      form.addEventListener('submit', async e => {
        e.preventDefault();
        UI.clearErrors(form);
        const amount = Number(form.amount.value);
        if (!Number.isFinite(amount) || amount < 50 || amount > 10000) {
          UI.setFieldError(form, 'amount', 'Enter an amount between ₹50 and ₹10,000.');
          return;
        }
        await UI.busy(form.querySelector('[type=submit]'), async () => {
          try {
            const res = await API.post('/api/wallet/topup', { amount });
            result = res.balances;
            App.setWallet(res.balances);
            UI.toast(`${money(amount)} added to your wallet`);
            dlg.close();
          } catch (err) { UI.error(err); }
        });
      });
    });
  }

  window.Wallet = { openTopUp };
})();
