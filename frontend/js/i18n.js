// Languages: English (default), Hindi, Marathi, Gujarati.
//
// How it works: pages are written in English. This script translates text as it appears on
// screen, using a dictionary per language (frontend/js/i18n/<lang>.js), keyed by the English
// text. Anything not in the dictionary simply stays in English, so a gap never shows a blank
// or a raw key. User content (kitchen names, dishes, reviews) is left as typed.
//
// Load it in <head>, right after tw-config.js, so text is translated before it is painted.

(function () {
  const LANGS = {
    en: { name: 'English', short: 'EN', locale: 'en-IN' },
    hi: { name: 'हिन्दी', short: 'हि', locale: 'hi-IN-u-nu-latn' },
    mr: { name: 'मराठी', short: 'म', locale: 'mr-IN-u-nu-latn' },
    gu: { name: 'ગુજરાતી', short: 'ગુ', locale: 'gu-IN-u-nu-latn' }
  };
  const KEY = 'rasoi_lang';

  // Text with numbers or names inside ("7 kitchens in Andheri West"). Each language file gives a
  // replacement for every id; $1, $2... are the captured parts (translated too when they're known).
  const PATTERNS = [
    ['kitchensIn', /^(\d+) kitchens? in (.+)$/],
    ['kitchensTo', /^(\d+) kitchens? delivering to (.+)$/],
    ['reviews', /^(\d+) reviews?$/],
    ['kitchenCount', /^(\d+) kitchens?$/],
    ['nextOpen', /^Next: (.+) (lunch|dinner)$/],
    ['changeBy', /^Change by (.+)$/],
    ['addedOn', /^Skipped (.+), added on (.+)$/],
    ['ordersCount', /^Orders \((\d+)\)$/],
    ['deliveredOf', /^(\d+) of (\d+) delivered$/],
    ['mealsCount', /^(\d+) meals?$/],
    ['mealsToCook', /^(\d+) delivered$/],
    ['minWalk', /^(.+) \((\d+) min walk\)$/],
    ['reliability', /^Delivered (\d+)% of booked meals in the last 30 days$/],
    ['placeOrder', /^Place order · (.+)$/],
    ['bookTrial', /^Book trial · (.+)$/],
    ['startPlan', /^Start plan · (.+)$/],
    ['addMoney', /^Add (₹[\d,]+) to wallet$/],
    ['addAmount', /^Add (₹[\d,]+)$/],
    ['withdraw', /^Withdraw (₹[\d,]+)$/],
    ['startCookingAll', /^Start cooking all \((\d+)\)$/],
    ['sendAllOut', /^Send all out for delivery \((\d+)\)$/],
    ['markAllDelivered', /^Mark all delivered \((\d+)\)$/],
    ['perMeal', /^(₹[\d,]+)\/meal$/],
    ['welcome', /^Welcome, (.+)! Add your address to see who delivers to you\.$/],
    ['strikes', /^(\d+) late cancellations? this month$/],
    ['endsOn', /^Ends (.+)$/],
    ['skippedN', /^Skipped: (\d+)$/],
    ['makeupN', /^Make-up days: (\d+)$/],
    ['skipsLeftOf', /^Skips left: (\d+) of (\d+)$/],
    ['noticeH', /^(\d+) hours' notice$/],
    ['skipBy', /^Not home\? Skip by (.+)$/],
    ['lockedAt', /^Locked: changes closed (.+)\.$/],
    ['nothingBooked', /^(.+): nothing booked$/],
    ['earnedDay', /^(.+): (₹[\d,]+) from (\d+) meals?$/],
    ['placedOn', /^Placed (.+)$/],
    ['activePlans', /^(\d+) active plans?\. Tap a day to see its orders\.$/],
    ['todayMenu', /^Today: (.+)$/],
    ['noticeWindow', /^This meal is inside the (\d+)-hour notice window\. Once booked it can't be cancelled\.$/],
    ['cancelFree', /^Cancel free up to (\d+) hours before the meal\.$/],
    ['lateCancels', /^Late cancellations this month: (\d+) of 3$/],
    ['lateCancelInfo', /^Cancelling with less than (\d+) hours' notice gives customers a (₹[\d,]+) credit from your earnings\. Three in a month brings a warning\.$/],
    ['emergencyBody', /^Less than (\d+) hours' notice\. The customer gets their money back plus a (₹[\d,]+) credit from your earnings, and this counts as a late cancellation\.$/],
    ['reasonRequired', /^Less than (\d+) hours' notice: this is an emergency cancellation\. Please give a short reason for your customers\.$/],
    ['policyNotice', /^Skip, change or cancel a meal up to (\d+) hours before it\.$/],
    ['policySkips', /^A skipped meal becomes a make-up day at the end of your plan\. Up to (\d+) on a 22-meal plan, (\d+) on a 30-meal plan\.$/],
    ['policyConfirm', /^Changes need (\d+) hours' notice\. Skipped meals move to the end of your plan as make-up days\. Late changes and missed deliveries are still charged\.$/],
    ['skipCredit', /^It moves to the end of your plan as a make-up day\. You have (\d+) make-up days left on this plan\.$/],
    ['freezeRule', /^One freeze per month, up to 30 days\. Every meal in the range must still be open to change \((\d+) hours' notice\)\.$/],
    ['frozen', /^Plan frozen\. (\d+) meals moved, plan now ends (.+)\.$/],
    ['goodwillGiven', /^Cancelled\. (₹[\d,]+) goodwill credit given to the customer\.$/],
    ['noticeHint', /^Customers can skip or change a meal until this long before it \(lunch (.+), dinner (.+)\)\. You get the same notice when cancelling\.$/],
    ['makeupsAdded', /^(\d+) meals added as make-up days\.$/],
    ['mealsResumed', /^(\d+) meals resumed\.$/],
    ['chargedNoCredit', /^(\d+) charged \(no make-up days left\)\.$/],
    ['notChanged', /^(\d+) couldn't be changed \(past the deadline or full\)\.$/],
    ['ratedOf', /^Rated ([\d.]+) out of 5$/],
    ['drops', /^(\d+) drops?$/],
    ['noRiceN', /^(\d+) no rice$/],
    ['rotiN', /^(\d+) roti$/],
    ['paidOut', /^(₹[\d,]+) paid out so far$/],
    ['earningLine', /^(RS\d+) delivered \((₹[\d,]+) - (₹[\d,]+) platform fee\)$/],
    ['routeLen', /^· about (.+) in this order$/],
    ['starsOf', /^([\d.]+) out of 5 stars$/],
    ['quantityOf', /^(.+) quantity$/],
    ['removeFav', /^Remove (.+) from favourites$/],
    ['fromKitchen', /^(.+) from the kitchen\. The rider shows here once it's on the way\.$/],
    ['aboutWalk', /^About (.+) from (.+), roughly a (\d+) min walk\. Inside the delivery circle\.$/],
    ['trialPrice', /^\/meal · trial (₹[\d,]+)$/],
    ['movedTo', /^Moved to a make-up day on (.+)\.$/],
    ['homeTitle', /^Home-cooked meals in (.+)$/],
    ['unreadN', /^Notifications, (\d+) unread$/],
    ['hygTaste', /^Hygiene ([\d.]+) · Taste ([\d.]+)$/],
    ['moreKitchens', /^(\d+) more kitchens? nearby doesn't deliver to this address\.$/],
    ['priceTrial', /^(₹[\d,]+) · trial (₹[\d,]+)$/],
    ['distMin', /^([\d.]+) (km|m) · (\d+) min$/],
    ['minAgo', /^(\d+) min ago$/],
    ['hAgo', /^(\d+) h ago$/],
    ['dAgo', /^(\d+) d ago$/],
    ['mealLabel', /^(\w{3}, \d{1,2} \w{3}) (lunch|dinner)$/],
    ['nPreparing', /^Your (lunch|dinner) from (.+) is being prepared$/],
    ['nOutForDelivery', /^Your (lunch|dinner) from (.+) is out for delivery$/],
    ['nDelivered', /^Your (lunch|dinner) from (.+) was delivered$/],
    ['nEnjoy', /^(RS\d+): enjoy your meal! Tap to rate it\.$/],
    // Notifications from the notice / make-up / cancellation features
    ['nSkipped', /^Skipped (.+) (lunch|dinner)$/],
    ['nAddedMakeup', /^Added as a make-up day on (.+)\.$/],
    ['nHolidayMode', /^Holiday mode: (\d+) meals skipped$/],
    ['nMakeupsAtEnd', /^(\d+) added as make-up days at the end of your plan\.$/],
    ['nResumedN', /^Resumed (\d+) meals$/],
    ['nFrozenTitle', /^Plan frozen (.+) – (.+)$/],
    ['nFrozenBody', /^(\d+) meals moved\. Your plan now ends (.+)\.$/],
    ['nKeeping', /^(.+) is keeping your (lunch|dinner) for pickup$/],
    ['nCollect', /^(.+) (lunch|dinner)\. Collect it from the kitchen when you're back today\.$/],
    ['nNoReach', /^(.+) couldn't reach you for (.+) (lunch|dinner)$/],
    ['nMissedN', /^That's (\d+) missed deliveries this month\. Please skip meals (\d+) hours ahead, or tap "I won't be home"\.$/],
    ['nCantMake', /^(.+) can't make (.+)$/],
    ['nAway', /^(.+) won't be home for (.+) (lunch|dinner)$/],
    ['nNoNeed', /^(RS\d+): no need to deliver\. The meal is still paid; you can keep it for pickup\.$/],
    ['nCustSkipped', /^(.+) skipped (.+) (lunch|dinner)$/],
    ['nRemovedPrep', /^(RS\d+) removed from that day's prep\. Make-up meal on (.+)\.$/],
    ['nFroze', /^(.+) froze their plan$/],
    ['nAwayBody', /^Away (.+) – (.+)\. (\d+) meals moved; plan now ends (.+)\.$/],
    ['nLateWarn', /^(\d+) late cancellations this month\. Please give customers (\d+) hours' notice\.$/],
    ['deadlinePassed', /^Too late to (\w+) this meal\. Changes closed on (.+) \((\d+) hours' notice\)\.$/]
  ];

  function pick() {
    let saved = null;
    try { saved = localStorage.getItem(KEY); } catch (e) { /* storage blocked */ }
    return LANGS[saved] ? saved : 'en';
  }

  const lang = pick();
  const dicts = (window.I18N_DICTS = window.I18N_DICTS || {});
  const missing = new Set();
  document.documentElement.lang = lang;

  // Load this language's dictionary and fonts (Noto for Devanagari/Gujarati; system fonts as fallback)
  if (lang !== 'en') {
    document.write(`<script src="/js/i18n/${lang}.js"><\/script>`);
    const family = lang === 'gu' ? 'Noto+Sans+Gujarati:wght@400;500;600;700&family=Noto+Serif+Gujarati:wght@600;700' : 'Noto+Sans+Devanagari:wght@400;500;600;700&family=Noto+Serif+Devanagari:wght@600;700';
    document.write(`<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=${family}&display=swap">`);
  }

  function dict() {
    return (dicts[lang] && dicts[lang].strings) || {};
  }

  function patterns() {
    return (dicts[lang] && dicts[lang].patterns) || {};
  }

  // A dictionary entry, or a pattern with its numbers/names filled in. null if neither fits.
  function whole(key, d) {
    if (d[key] != null) return d[key];
    const p = patterns();
    for (const [id, re] of PATTERNS) {
      const m = key.match(re);
      if (m && p[id]) return p[id].replace(/\$(\d)/g, (_, i) => (m[i] != null ? (d[m[i]] || m[i]) : ''));
    }
    return null;
  }

  // Translate one piece of text. Returns null when there's nothing to change.
  function translate(text) {
    const key = text.replace(/\s+/g, ' ').trim();
    if (!key || !/[A-Za-z]{2}/.test(key)) return null;
    const d = dict();
    let out = whole(key, d);
    // "Lunch · Annapurna Kitchen": translate the parts that are known
    if (out == null && key.includes(' · ')) {
      const parts = key.split(' · ');
      const done = parts.map(s => whole(s, d));
      if (done.some(Boolean)) out = parts.map((s, i) => done[i] || s).join(' · ');
    }
    if (out == null) {
      if (lang !== 'en') missing.add(key);
      return null;
    }
    return text.match(/^\s*/)[0] + out + text.match(/\s*$/)[0];
  }

  const ATTRS = ['placeholder', 'aria-label', 'title'];
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'CODE']);
  const doneText = new WeakMap(); // node -> text we wrote, so we don't translate twice

  function skipped(el) {
    return !el || SKIP.has(el.tagName) || (el.closest && el.closest('[translate="no"], .notranslate'));
  }

  function doText(node) {
    if (doneText.get(node) === node.data) return;
    if (skipped(node.parentElement)) return;
    const out = translate(node.data);
    if (out != null && out !== node.data) {
      node.data = out;
      doneText.set(node, out);
    }
  }

  function doAttrs(el) {
    if (skipped(el)) return;
    ATTRS.forEach(a => {
      const v = el.getAttribute(a);
      if (!v || el['__i18n_' + a] === v) return;
      const out = translate(v);
      if (out != null) {
        el.setAttribute(a, out);
        el['__i18n_' + a] = out;
      }
    });
  }

  function walk(root) {
    if (root.nodeType === 3) return doText(root);
    if (root.nodeType !== 1 || skipped(root)) return;
    doAttrs(root);
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    let n;
    while ((n = tw.nextNode())) {
      if (n.nodeType === 3) doText(n);
      else doAttrs(n);
    }
  }

  // Translate everything as it is added or changed (pages render a lot after loading)
  if (lang !== 'en') {
    new MutationObserver(muts => {
      for (const m of muts) {
        if (m.type === 'characterData') doText(m.target);
        else if (m.type === 'attributes') doAttrs(m.target);
        else m.addedNodes.forEach(walk);
      }
    }).observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    // The <title> was parsed before this script ran, so translate it once the dictionary has loaded
    document.addEventListener('DOMContentLoaded', () => {
      const t = document.querySelector('title');
      if (t && t.firstChild) doText(t.firstChild);
    });
  }

  function setLang(next) {
    if (!LANGS[next]) return;
    try { localStorage.setItem(KEY, next); } catch (e) { /* ignore */ }
    // Also remember it on the account when signed in (best effort)
    fetch('/api/auth/language', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lang: next }) })
      .catch(() => {})
      .finally(() => location.reload());
  }

  // After sign-in: if the account has a saved language and this browser has none, use it
  function syncWithAccount(user) {
    if (!user || !user.lang || !LANGS[user.lang]) return;
    let saved = null;
    try { saved = localStorage.getItem(KEY); } catch (e) { return; }
    if (!saved && user.lang !== lang) {
      try { localStorage.setItem(KEY, user.lang); } catch (e) { return; }
      location.reload();
    }
  }

  window.I18n = {
    lang, LANGS, PATTERNS, missing, setLang, syncWithAccount,
    t: s => { const out = translate(s); return out == null ? s : out; },
    locale: () => LANGS[lang].locale
  };
})();
