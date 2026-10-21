# RasoiSe — Codebase Audit (before rebuild)

Read on 15 Oct 2026, covering `backend/server.js`, `backend/data.json`, every page in `frontend/`, `js/app.js`, `js/validation.js`, `css/style.css` and `public/`.

## 1. localStorage / sessionStorage usage
No `sessionStorage` anywhere. Everything below is browser-local, so customer, chef and admin never see each other's actions.

| Key | Where it's written / read | What it fakes |
|---|---|---|
| `rasoise_user_profile` | app.js `handleUserSignIn`, `handleCreateProfile`, `getStoredUser`, `updateNavAuthState`, `signOutUser`; index.html card `onclick` login gate; kitchen.html `initKitchenPage`, `processTrialCheckout`, `processSubscription`, `openReviewModal`; chef-dashboard.html `loadChefWeeklyMenu`, `saveWeeklyMenuSchedule` (fallback save), header personalisation; validation.js after chef registration | The entire login/session, role, address, chef's kitchenId and a copy of the weekly menu |
| `rasoise_wallet` | app.js `updateWalletUI`, `triggerWalletTopUp`, pause/resume, nav dropdown | Wallet balance (defaults to ₹720); top-ups add money from nowhere |
| `rasoise_active_subscription` | kitchen.html trial + subscription checkout (write); calendar.html (read) | Bookings and subscriptions. A trial overwrites the subscription. Nothing reaches the server or chef |
| `rasoise_latest_trial` | app.js `signOutUser` (remove only) | Never written: dead key |

## 2. Hardcoded or fake values
**index.html**: hero tick-list ("100%", "0 min Delivery Hassles"); badge "2 Active Today"; two static kitchen cards (450m/600m, ★4.9, ₹80) that get replaced on load; footer "ISO-22000 Compliant"; app.js fallbacks `distance 450`, `'400m away'`, rating `5.0`, 4-card cap; `AREA_SECTOR_MAP` lists Bandra/Powai/South Mumbai (outside the service area).
**kitchen.html**: `FSSAI Verified #20822003001889` (same for every kitchen); "4,200+ Meals Served"; "Hygiene Score 5.0/5.0"; "Fresh Daily"; "4.9 (418 Reviews)" / `'150+'` fallback; "Sector 11 (450m away)"; "100% Pure Vegetarian" shown for every kitchen; stock Unsplash chef avatar + 4 fixed gallery photos; "99% Fresh", "On Time"; static star-bar widths; static weekly-menu table; default kitchen is Annapurna if the id doesn't match; address prefilled "Flat 101/204, Society View"; "cut off 3 hours prior" (no such rule exists).
**calendar.html**: wallet ₹720; "Plan #SUB-9021"; "Annapurna Kitchen • 5-Day Mon-Fri Lunch Plan"; "Sector 11", ₹80; week "Sep 22 – Sep 28 (Week 39)"; all 7 day cards static, Wednesday pre-paused; UPI methods line.
**chef-dashboard.html**: "Annapurna Kitchen / Chef Asha Sharma / Sector 11 Micro-Hub / #K-1104"; "Cut-off: CLOSED at 8:00 AM" always on; metrics 34 / 26 / 8 / 4, "↑ 4 more", "76.5%"; six fake manifest rows (Rajiv, Sneha, …); "1 of 6 Dispatched"; "riders depart 12:15 PM"; revenue `₹2,720`, "34 meals × ₹80"; "Settled to UPI"; `asha.sharma@okaxis`; fake payout ref `#UPI/2026/0923/8812`; footer "v2.4 / Sector 11 Cluster"; hardcoded default menu; `kitchenId || 1` fallback (every chef edits Annapurna).
**chef-onboarding.html / server**: "Join over 45+ home chefs across Sectors 10, 11, 12 & 15"; "0% Commission Month 1"; success modal says "verified for active orders" (no approval exists); server forces `area: 'Gurugram Central'`, `distance: '400m away'`, `rating: 5.0`, `status: 'Active'`; diet type radio is never sent.
**admin-console.html / server**: sidebar "12"; stats 142 / 12 / 8 / ₹14,240 with "+4%", "6 requires action", "−2 since yesterday", "+18% vs avg"; "Moderator-09", "IN-North-1", "99.98%"; `flaggedKitchens` in data.json = 6 fake kitchens (incl. Bandra/Powai); complaints synthesised as `8` or `0`; refund defaults `880`; "last 7 days"; ban "refunds" only write an audit line, no wallet changes.

## 3. Broken or dead buttons / links
- **No real login**: any email/phone "signs in", the role is a radio button, no password. "Login as Admin" is a plain link. Admin, chef and calendar pages have no guard at all.
- index.html: `areaSelect`, `sectorSelect`, `radiusToggle` don't exist in the markup, so the location filter and ≤1 km toggle are dead; "Showing kitchens in selected location" has no selector; 🛍️ "cart" icon just opens the calendar; footer has no links.
- Sign-up modal: `updateProfileSectors()` writes `<option>`s into an `<input>`; grid declares 3 columns for 2 fields.
- kitchen.html: doesn't load app.js (no session state in header); header has no logo; "Chef Hub" shown to customers; Pay buttons never call the server or touch the wallet; anyone can review with any name (no order needed); `bg-brandPillBg` class isn't defined in that page's Tailwind config (selected review tags lose their background).
- calendar.html: pause/resume only changes the DOM + localStorage; no cutoff check (Wednesday says "Cutoff passed" but can still be resumed); weekend buttons and "Rate Chef" link to `kitchen.html` with no id; top-up adds money for free; footer links to Admin Console.
- chef-dashboard.html: "Mark as Dispatched" / "Dispatch All" only edit the DOM; "Instant UPI Transfer" is an `alert()`; "Admin View" link exposed to chefs.
- admin-console.html: "Kitchen Directory" opens the customer marketplace; "Refund Register" is an `alert()` with a fake total; can ban the fake flagged kitchens.
- server.js: no auth on any route; `app.all('/api/kitchens/:id/menu')` accepts any HTTP verb from anyone; `/api/kitchens?status=all` leaks every kitchen's email/phone; reviews accepted for non-existent kitchens; `saveDB` writes in place (a crash mid-write corrupts data.json).
- `frontend/uploads/default-thali.jpg` is a 0-byte file (broken image).
- `public/` (admin-console.html, calender.html, chef-onboarding.html) is not referenced by the server or any page: dead duplicates.

## 4. APIs the frontend needs but the backend lacks
Auth (sign up / sign in / sign out / me) · profile, preferences, saved addresses · wallet balance, ledger, top-up · on-demand single orders · trial bookings · subscriptions (create, renew, change plan, cancel + prorated refund) · per-day meal calendar (pause/resume with server-side cutoff, dish choices, add-ons, notes, slot/address change, holiday range) · chef: my kitchen, settings, menu builder, off-days, pause kitchen, manifest, prep counts, dispatch status, earnings, payouts · order tracking · review replies · complaint tickets · notifications + live events · admin: approvals, warn/ban/unban with real refunds, users, orders, refunds register, tickets, audit log, computed stats · `/api/config` for the maps key · favourites / reorder · capacity and radius checks.
