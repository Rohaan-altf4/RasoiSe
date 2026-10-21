// "Rate your meal" dialog for a delivered order. Review.open(order) resolves to the review or null.

(function () {
  const { esc, icon } = UI;
  let tagsCache = null;

  function starGroup(name, label, value = 0) {
    return `
      <fieldset class="field" style="border:0;padding:0;margin:0 0 14px">
        <legend class="field-label" style="margin-bottom:4px">${label}</legend>
        <div class="flex gap-1" role="radiogroup" aria-label="${label}">
          ${[1, 2, 3, 4, 5].map(n => `
            <label style="cursor:pointer" title="${n} star${n > 1 ? 's' : ''}">
              <input type="radio" name="${name}" value="${n}" class="sr-only" ${value === n ? 'checked' : ''}>
              <span class="star-ico" data-n="${n}" style="font-size:30px;line-height:1;color:var(--star-off);transition:color 150ms">★</span>
            </label>`).join('')}
        </div>
      </fieldset>`;
  }

  function paintStars(form, name) {
    const v = Number((form.querySelector(`[name="${name}"]:checked`) || {}).value || 0);
    form.querySelectorAll(`[name="${name}"]`).forEach(inp => {
      const s = inp.nextElementSibling;
      s.style.color = Number(inp.value) <= v ? 'var(--brand-saffron)' : 'var(--star-off)';
    });
  }

  async function open(order) {
    if (!tagsCache) {
      try { tagsCache = (await API.get('/api/reviews/tags')).tags; } catch (e) { tagsCache = []; }
    }
    return new Promise(resolve => {
      const dlg = document.createElement('dialog');
      dlg.className = 'modal';
      dlg.innerHTML = `
        <form novalidate>
          <div class="modal-head">
            <div><h2 class="h3">Rate your meal</h2>
            <p class="text-sm text-muted" style="margin:4px 0 0">${esc(order.kitchen.name)} · ${UI.date(order.date)} ${esc(order.slot)}</p></div>
            <button type="button" class="icon-btn" data-close aria-label="Close">${icon('x')}</button>
          </div>
          <div class="modal-body">
            ${starGroup('rating', 'Overall <span class="req">*</span>')}
            <div class="grid grid-cols-2 gap-3">
              ${starGroup('hygiene', 'Hygiene & packing')}
              ${starGroup('taste', 'Taste')}
            </div>
            <p class="field-error" id="starErr" style="display:none;margin-top:-6px">Pick an overall star rating.</p>
            <fieldset class="field" style="border:0;padding:0;margin:4px 0 14px">
              <legend class="field-label" style="margin-bottom:6px">What stood out?</legend>
              <div class="chips">${tagsCache.map(t => `<label class="chip"><input type="checkbox" name="tags" value="${esc(t)}">${esc(t)}</label>`).join('')}</div>
            </fieldset>
            <div class="field">
              <label class="field-label" for="revComment">Your review <span class="req">*</span></label>
              <textarea id="revComment" name="comment" class="textarea" maxlength="1000" placeholder="How were the rotis, the spice, the packing? Your words help neighbours choose."></textarea>
              <p class="field-hint">Reviews are public and show your first name.</p>
              <p class="field-error">Write at least 10 characters.</p>
            </div>
            <div id="lowWarn" class="alert alert-warning" style="margin-top:14px" hidden>${icon('flag')}<div>Ratings of 2★ or lower are sent to the RasoiSe team to check. For a refund on this meal, use <strong>Report a problem</strong> on the order instead.</div></div>
          </div>
          <div class="modal-foot">
            <button type="button" class="btn btn-secondary" data-close>Cancel</button>
            <button type="submit" class="btn btn-primary">Post review</button>
          </div>
        </form>`;
      document.body.appendChild(dlg);
      let result = null;
      dlg.addEventListener('close', () => { setTimeout(() => dlg.remove(), 250); resolve(result); });
      UI.openModal(dlg);
      const form = dlg.querySelector('form');
      ['rating', 'hygiene', 'taste'].forEach(name => {
        form.querySelectorAll(`[name="${name}"]`).forEach(inp => inp.addEventListener('change', () => {
          paintStars(form, name);
          if (name === 'rating') {
            // Default the sub-ratings to the overall one until the user changes them
            ['hygiene', 'taste'].forEach(sub => {
              if (!form.querySelector(`[name="${sub}"]:checked`)) {
                form.querySelector(`[name="${sub}"][value="${inp.value}"]`).checked = true;
                paintStars(form, sub);
              }
            });
            document.getElementById('starErr').style.display = 'none';
          }
          const low = Number((form.querySelector('[name="rating"]:checked') || {}).value) <= 2 || Number((form.querySelector('[name="hygiene"]:checked') || {}).value) <= 2;
          dlg.querySelector('#lowWarn').hidden = !low;
        }));
      });
      form.addEventListener('submit', async e => {
        e.preventDefault();
        UI.clearErrors(form);
        const rating = Number((form.querySelector('[name="rating"]:checked') || {}).value || 0);
        const comment = form.comment.value.trim();
        let bad = false;
        if (!rating) { document.getElementById('starErr').style.display = 'block'; bad = true; }
        if (comment.length < 10) { UI.setFieldError(form, 'comment', 'Write at least 10 characters.'); bad = true; }
        if (bad) return;
        const body = {
          orderId: order.id, rating, comment,
          hygiene: Number((form.querySelector('[name="hygiene"]:checked') || {}).value || rating),
          taste: Number((form.querySelector('[name="taste"]:checked') || {}).value || rating),
          tags: [...form.querySelectorAll('[name="tags"]:checked')].map(i => i.value)
        };
        await UI.busy(form.querySelector('[type=submit]'), async () => {
          try {
            const res = await API.post('/api/reviews', body);
            result = res.review;
            UI.toast('Thanks! Your review is live.');
            dlg.close();
          } catch (err) { UI.error(err); }
        });
      });
    });
  }

  window.Review = { open };
})();
