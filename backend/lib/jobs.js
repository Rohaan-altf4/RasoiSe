// Background checks that run every minute:
// 1. Low wallet warning: in the evening, warn customers whose plan ends soon and whose
//    wallet can't cover the auto-renewal.
// 2. Auto-renew: once a plan's last meal is locked in (past cutoff), start the next plan.
// 3. Mark finished plans as completed.

const db = require('../db');
const time = require('./time');
const wallet = require('./wallet');
const { notify, refresh } = require('./notify');

const WARN_FROM_MINUTES = 18 * 60; // 6 PM IST

function lastMealDate(d, sub) {
  return d.orders.filter(o => o.subscriptionId === sub.id && o.status !== 'cancelled').reduce((m, o) => (o.date > m ? o.date : m), sub.startDate);
}

function renewalPrice(k, sub) {
  const unit = sub.plan === '5day' ? k.pricing.plan5 : k.pricing.plan7;
  return unit * (sub.slot === 'both' ? 2 : 1);
}

function tick() {
  const { createSubscription } = require('../routes/customer');
  const d = db.load();
  const today = time.today();
  const { minutes } = time.istParts();

  d.subscriptions.filter(s => s.status === 'active').forEach(sub => {
    const k = d.kitchens.find(x => x.id === sub.kitchenId);
    if (!k) return;
    const last = lastMealDate(d, sub);
    const daysLeft = time.diffDays(today, last);

    // 1. Low balance warning (once per day)
    if (sub.autoRenew && daysLeft >= 0 && daysLeft <= 2 && minutes >= WARN_FROM_MINUTES && sub.lowBalanceWarnedOn !== today) {
      const need = renewalPrice(k, sub);
      const { available } = wallet.balances(sub.customerId);
      if (available < need) {
        db.transaction(dd => {
          const s = dd.subscriptions.find(x => x.id === sub.id);
          s.lowBalanceWarnedOn = today;
          notify(dd, s.customerId, {
            type: 'low_balance',
            title: 'Low wallet balance',
            body: `Your plan with ${k.name} ends ${daysLeft === 0 ? 'today' : daysLeft === 1 ? 'tomorrow' : 'in 2 days'}. Renewal needs ₹${need}; you have ₹${available}. Top up ₹${need - available} to keep your meals coming.`,
            link: 'calendar.html#wallet'
          });
        });
      }
    }

    // 2. Auto-renew once the last meal is locked in
    if (sub.autoRenew && !sub.renewedById && !sub.renewAttemptedOn && k.status === 'approved' && !k.paused &&
        (last < today || !time.isBeforeCutoff(last, k.cutoffTime))) {
      try {
        db.transaction(dd => {
          const s = dd.subscriptions.find(x => x.id === sub.id);
          const u = dd.users.find(x => x.id === s.customerId);
          const kk = dd.kitchens.find(x => x.id === s.kitchenId);
          let start = time.addDays(last, 1);
          if (start <= today) start = time.isBeforeCutoff(today, kk.cutoffTime) ? today : time.addDays(today, 1);
          const created = createSubscription(dd, u, kk, { plan: s.plan, slot: s.slot, startDate: start, addressId: s.addressId, autoRenew: true, previousId: s.id });
          s.renewedById = created.id;
          s.renewAttemptedOn = today;
          notify(dd, u.id, { type: 'subscription_renewed', title: `Plan with ${kk.name} renewed`, body: `${created.mealsTotal} more meals from ${created.startDate}. ₹${created.price} reserved from your wallet.`, link: 'calendar.html' });
          notify(dd, kk.ownerId, { type: 'new_subscription', title: `${u.name}'s plan auto-renewed`, body: `${created.mealsTotal} meals from ${created.startDate}`, link: 'chef-dashboard.html' });
          refresh([u.id], ['orders', 'wallet', 'subscriptions']);
          refresh([kk.ownerId], ['orders']);
        });
      } catch (err) {
        db.transaction(dd => {
          const s = dd.subscriptions.find(x => x.id === sub.id);
          s.renewAttemptedOn = today;
          s.renewError = err.message;
          notify(dd, s.customerId, { type: 'renewal_failed', title: `Couldn't renew your plan with ${k.name}`, body: err.message, link: 'calendar.html#plans' });
        });
      }
    }

    // 3. Finished
    if (last < today) {
      db.transaction(dd => {
        const s = dd.subscriptions.find(x => x.id === sub.id);
        if (s.status === 'active') s.status = 'completed';
      });
    }
  });
}

function start() {
  const run = () => { try { tick(); } catch (e) { console.error('[jobs]', e); } };
  setTimeout(run, 3000);
  setInterval(run, 60000).unref();
}

module.exports = { start, tick };
