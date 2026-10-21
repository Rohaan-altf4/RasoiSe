# RasoiSe

Ghar ka khana from home cooks in Andheri West (Lokhandwala, Versova, Oshiwara).
Customers order a single meal, try a kitchen for a day, or subscribe for the month, and pause any day before the cutoff.
Chefs run their kitchen from their phone. Admins approve kitchens and handle complaints.

Plain HTML/CSS/JS frontend (Tailwind CDN for layout, Lucide icons) and a Node/Express backend that stores data in **MongoDB** (or in `backend/data.json` when no MongoDB is configured). No build step.

## Setup

Requires Node 18 or newer, and MongoDB (Community Server running locally, or a MongoDB Atlas cluster). Without MongoDB the app falls back to `data.json`.

```bash
cd backend
npm install
cp .env.example .env      # then edit .env (see below)
npm run seed              # optional: load the demo data (replaces what's in MongoDB)
npm start                 # http://localhost:3000
```

### `.env`

| Key | What it does |
|---|---|
| `PORT` | Port to serve on (default 3000) |
| `MONGODB_URI` | MongoDB connection string, e.g. `mongodb://localhost:27017` (local / Compass) or an Atlas `mongodb+srv://...` string. Leave it out to store data in `data.json` instead. |
| `MONGODB_DB` | Database name (default `rasoise`) |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME` | The admin account, created on first start. Password needs 8+ characters. |
| `GOOGLE_MAPS_API_KEY` | Maps JavaScript API + Places. Leave empty to use OpenStreetMap (Leaflet + Nominatim) instead; everything still works. |
| `PLATFORM_COMMISSION` | Share of each delivered meal RasoiSe keeps (default `0.1`) |
| `COOKIE_SECURE` | `true` when served over HTTPS |
| `MIGRATION_DEFAULT_PASSWORD` | Password given to chef accounts created when an old (v1) data.json is migrated |
| `DATA_DIR` | Folder for `data.json` and chef photos. Set it to a persistent disk when deploying (default: `backend/` and `frontend/uploads/`). |
| `TRUST_PROXY` | `true` when running behind a host's HTTPS proxy |
| `AUTH_RATE_LIMIT` | Max sign-in / sign-up attempts per IP every 15 minutes (default 10) |
| `RASOI_NOW` | Optional. Pretend "now" is this ISO time (e.g. `2026-10-20T07:30:00+05:30`) to demo the 8 AM cutoff. The clock keeps ticking from it. |

`.env` is git-ignored. Never commit real keys.

### Scripts

| Command | |
|---|---|
| `npm start` | Run the server |
| `npm run seed` | Replace the data (MongoDB, or data.json) with demo data (stop the server first) |
| `npm run mongo:import` | Copy `data.json` into MongoDB, replacing its contents (stop the server first). The server does this by itself the first time, when the MongoDB database is empty. |
| `npm run migrate` | Convert an old v1 data.json (also happens automatically on first start; a backup is kept as `data.legacy.json`) |
| `npm test` | 200 checks across all flows, plus the translation check, on a throwaway JSON file with its own server on port 3999. Your data is untouched. |
| `npm run test:mongo` | The same checks against a throwaway MongoDB database (`rasoise_test`) on `mongodb://localhost:27017` (change with `MONGO_TEST_URI`) |
| `npm run i18n` | Rebuild `frontend/js/i18n/{en,hi,mr,gu}.js` from the tables in `backend/i18n-source/` |

## MongoDB

With `MONGODB_URI` set, the data lives in MongoDB, one collection per kind of record:

| Collection | What's in it |
|---|---|
| `users` | Customers, cooks and admins (passwords are bcrypt hashes), with addresses, preferences, favourites |
| `sessions` | Signed-in sessions |
| `kitchens` | Kitchen profiles, prices, capacity, notice period, holidays, warnings and strikes |
| `menus` | Each kitchen's weekly menu, dishes (with photos), extras and specials (`_id` = kitchen id) |
| `orders` | Every meal: single, trial and plan meals, with status history |
| `subscriptions` | Monthly plans, skips used and freezes |
| `walletTransactions` | The wallet ledger (top-ups, reservations, charges, refunds, earnings, payouts) |
| `reviews`, `tickets`, `notifications`, `auditLog` | Reviews, complaints, notifications and the admin audit trail |
| `meta` | Id counters |

Each record's `_id` is its app id (1, 2, 3...). Indexes are created on start-up for the common lookups (orders by kitchen and date, wallet by user, unique email...).

**How it works:** `backend/db.js` loads the collections into memory on start-up. Every change runs in a transaction that rolls back on error, and then only the changed records are written to MongoDB, in order, with `bulkWrite`. Keeping the working copy in memory keeps requests synchronous, so two requests can never interleave halfway through a wallet change.

**Compass:** connect to `mongodb://localhost:27017` and open the `rasoise` database. Data changed in the app appears after a refresh.

## Deploying

Run it as one always-on Node server (Render, Railway, Fly.io or a small VPS), not on serverless hosting: it keeps data in memory and holds live connections for notifications.

1. Push the project to GitHub (`.env` and `data.json` are git-ignored).
2. Create a web service with root directory `backend`, build command `npm install`, start command `npm start`, and health check path `/health`.
3. Set `MONGODB_URI` to a MongoDB Atlas connection string (or attach a persistent disk for `data.json`), plus a persistent disk for chef photos (e.g. mounted at `/var/data`), and set these environment variables: `DATA_DIR=/var/data`, `TRUST_PROXY=true`, `COOKIE_SECURE=true`, a strong `ADMIN_PASSWORD`, and ideally `GOOGLE_MAPS_API_KEY`.
4. Optional: load the demo data once from the host's shell with `npm run seed`, then restart the service.

## Demo accounts (after `npm run seed`)

Every seeded chef and customer uses the password **`demo1234`**.

| Role | Email | Notes |
|---|---|---|
| Admin | value of `ADMIN_EMAIL` | password from `ADMIN_PASSWORD` |
| Customer | `neha@rasoise.demo` | 5-day plan with Annapurna, one paused meal |
| Customer | `rohan@rasoise.demo` | 7-day plan with Nanak's Rasoi (meal every day) |
| Customer | `priya@rasoise.demo` | Amma's Kitchen plan, peanut allergy |
| Customer | `aditya@rasoise.demo` | Konkan Ghar dinners, resolved complaint with refund |
| Customer | `farah@rasoise.demo` | Escalated hygiene complaint, 2★ review that flagged a kitchen |
| Customer | `vikram@rasoise.demo` | Jain, no onion-garlic |
| Chef | `asha@rasoise.demo` | Annapurna Kitchen (Gujarati, veg) |
| Chef | `harpreet@rasoise.demo` | Nanak's Rasoi (Punjabi, veg) |
| Chef | `sunita@rasoise.demo` | Konkan Ghar (Malvani, non-veg) |
| Chef | `lakshmi@rasoise.demo` | Amma's Kitchen (South Indian), holiday in 4 days |
| Chef | `kavita@rasoise.demo` | Sindhi Swaad |
| Chef | `rukhsana@rasoise.demo` | Bawarchi Bibi (Mughlai), flagged |
| Chef | `ritu@rasoise.demo` | Healthy Thali by Ritu (Jain options) |
| Chef | `meera@rasoise.demo` | Meera's Pulao House, waiting for approval |

## How money works

Payments are simulated (see `backend/lib/payments.js`, which has notes on plugging in Razorpay). Every rupee goes through the wallet ledger (`walletTransactions`) and balances are always summed from it, never stored.

- **Top-up**: adds to *available*.
- **Booking** (meal, trial, plan, extras): moves money from *available* to *reserved*.
- **Cancel / ban** before delivery, and single or trial meals the kitchen cancels: moves it back to *available*.
- **Skip** a plan meal: the money stays *reserved* and moves to a make-up day at the end of the plan.
- **Delivered**: takes it from *reserved*; the kitchen earns the price minus the platform fee.
- **Complaint refund** on a delivered meal: credited to *available*; the kitchen's share is taken back.

New bookings for a day close at the kitchen's cutoff (default 8:00 AM IST). Changes to a booked meal close a set time before it (see below). Both are enforced on the server.

## Notice, skips and cancellations

- **Notice period**: each kitchen picks 12, 24 (default) or 48 hours. Lunch starts 12:30 and dinner 19:30 (IST). Skipping, resuming, editing or cancelling a meal (and a cook's day off) is allowed until *slot start − notice*. The calendar shows "Change by …".
- **Skip → make-up day**: a skipped plan meal moves to the next open day after the plan ends (skipping off-days, holidays and full days). Limit per plan: 4 on a 22-meal plan, 6 on a 30-meal plan (cook setting). Beyond that the meal is not delivered and is still charged.
- **Too late to skip**: the customer can tap "I won't be home". The meal is charged and the cook can keep it for pickup.
- **Customer not available** at the door: the cook marks it; it counts as delivered. Three in a month warns the customer and flags them to admin.
- **Freeze plan**: away more than 7 days, once a month (up to 30 days). The meals move after the plan ends, with nothing charged.
- **Cook cancels** a day or a single meal: with enough notice, plan customers get a make-up day (or a refund, set in their profile). With less notice it's an emergency: a reason is required, the customer gets a ₹20 goodwill credit from the cook's earnings, and a late-cancellation strike is recorded (3 in a month → automatic warning + admin alert). Kitchen pages show a 30-day reliability line.

## Languages

English, हिन्दी, मराठी and ગુજરાતી, from the switcher in the header (also on the login page). The choice is saved in the browser and on the account. Pages are written in English; `frontend/js/i18n.js` translates text on screen from `frontend/js/i18n/<lang>.js`, and anything missing stays in English. The admin console stays in English. Dish and kitchen names are shown as the cook typed them.

The service area ("Andheri West, Mumbai") is one value, `SERVICE_AREA` in `backend/lib/models.js`.

## Pages

| Page | Who |
|---|---|
| `index.html` | Marketplace: list/map, distance from your saved address, filters |
| `kitchen.html?id=` | Storefront: menu, reviews, map, booking (meal / trial / plan) |
| `calendar.html` | My meals: month/week calendar, dish choices, extras, pause, holiday mode, wallet, plans |
| `orders.html` | Orders, live tracker, complaints |
| `profile.html` | Food preferences, addresses, favourites, account |
| `login.html` | Sign in / create account |
| `chef-onboarding.html` | Register a kitchen |
| `chef-dashboard.html` | Today's manifest, prep sheet, dispatch, delivery route, complaints, reviews, earnings |
| `chef-settings.html` | Menu builder, profile & photos, prices, delivery area, days off, payouts |
| `admin-console.html` | Overview, approvals, kitchens, complaints, orders, users, refunds, audit log |

## API

All responses are JSON. Errors look like `{ "error": "message", "code": "OPTIONAL_CODE" }`.
🔒 = signed in; role shown where it's restricted.

**Auth & config**
- `GET /api/config`: maps key/provider, localities, today's date
- `POST /api/auth/signup`: customer account `{ name, phone, email?, password }`
- `POST /api/auth/login`: `{ identifier, password }` (email or mobile)
- `POST /api/auth/logout`
- `GET /api/auth/me`: current user, wallet, unread count
- `POST /api/auth/password` 🔒: `{ current, next }`

**Kitchens (public)**
- `GET /api/kitchens?lat&lng`: approved kitchens with distance and delivery check
- `GET /api/kitchens/:id`: storefront details + menu
- `GET /api/kitchens/:id/availability?days=14`: bookable slots per day
- `GET /api/kitchens/:id/reviews`

**Customer** 🔒 customer
- `PUT /api/me/profile`: name, phone, email, `preferences`
- `POST /api/me/addresses`, `PUT/DELETE /api/me/addresses/:id`, `POST /api/me/addresses/:id/default`
- `GET /api/me/favourites`, `POST /api/me/favourites/:kitchenId` (toggle)
- `GET /api/wallet` (customer or chef), `POST /api/wallet/topup`
- `POST /api/orders`: single meal or trial `{ kitchenId, type, date, slot, choices, addons, note, addressId }`
- `GET /api/orders?scope=upcoming|past|active`, `GET /api/orders/:id` (customer, the kitchen's chef, or admin)
- `PUT /api/orders/:id`: dish choices, extras, note, slot, address (before cutoff)
- `POST /api/orders/:id/pause | /resume | /cancel`
- `POST /api/meals/holiday`: `{ from, to, action: 'pause'|'resume' }`
- `POST /api/subscriptions`, `GET /api/subscriptions`, `PUT /api/subscriptions/:id` (auto-renew)
- `POST /api/subscriptions/:id/cancel | /renew | /change`
- `GET /api/calendar?from&to`

**Reviews**
- `GET /api/reviews/tags`
- `POST /api/reviews` 🔒 customer: delivered orders only
- `POST /api/reviews/:id/reply` 🔒 chef
- `GET /api/chef/reviews` 🔒 chef

**Complaints**
- `GET /api/tickets/categories`
- `POST /api/tickets` 🔒 customer, `GET /api/tickets`, `GET /api/tickets/:id` 🔒
- `POST /api/tickets/:id/messages` 🔒, `POST /api/tickets/:id/escalate` 🔒 customer/chef
- `POST /api/tickets/:id/resolve` 🔒 admin (with `refundAmount`) or customer

**Notifications**
- `GET /api/notifications` 🔒, `POST /api/notifications/read` 🔒 `{ ids } | { all: true }`
- `GET /api/events` 🔒: Server-Sent Events stream (`notification`, `refresh`)

**Chef** 🔒 chef
- `POST /api/chef/register`: multipart, public (creates the account + pending kitchen)
- `GET/PUT /api/chef/kitchen`, `PUT /api/chef/photos`, `POST /api/chef/upload`
- `PUT /api/chef/menu`: dishes, add-ons, weekly courses with choices, specials
- `POST /api/chef/holidays`, `DELETE /api/chef/holidays/:date`, `PUT /api/chef/offdays`, `POST /api/chef/pause`
- `GET /api/chef/manifest?date&slot`: orders, prep counts, delivery route
- `GET /api/chef/schedule`: next 14 days
- `POST /api/chef/orders/:id/status`, `POST /api/chef/dispatch` (bulk)
- `GET /api/chef/earnings`, `POST /api/chef/payout`

**Admin** 🔒 admin
- `GET /api/admin/stats`
- `GET /api/admin/kitchens?status&q`, `GET /api/admin/kitchens/:id`
- `POST /api/admin/kitchens/:id/approve | /reject | /reopen | /warn | /ban | /unban | /clear-flags`
- `GET /api/admin/users?q&role`, `GET /api/admin/orders?q&status&date&kitchenId`
- `POST /api/admin/orders/:id/refund`
- `GET /api/admin/refunds`, `GET /api/admin/audit?q`

## Project layout

```
backend/
  server.js          app setup, page guards, error handling
  db.js              JSON store with atomic writes and rollback
  migrate.js         one-time v1 → v2 data migration
  seed.js            demo data
  lib/               auth, wallet ledger, meal rules, notifications/SSE, jobs, maps math, uploads, payments
  routes/            auth, kitchens, customer, chef, reviews, tickets, notifications, admin
  test/              API tests (npm test)
frontend/
  *.html             pages
  css/style.css      design tokens and components
  js/                api.js, ui.js, layout.js, live.js, maps.js and shared dialogs
  js/pages/          one script per page
  uploads/           chef photos
```
