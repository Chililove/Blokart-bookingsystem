# Blokart Booking System

Overbooking-safe rental booking system with group orders, a multilingual UI,
customer notifications and Google Calendar sync — built in zero-dependency Node.js.

Both the public booking page and the in-store staff screen talk to the **same
server**, so they can never disagree on how many carts are free. That single
source of truth is what prevents double-booking, online or in the shop.

> **Demo mode:** This public version runs with **no secrets** — payments (Flatpay),
> SMS/email and Google Calendar are simulated, and no real customer data is used.
> The real deployment enables these via a private `.env` file that never ships here.

## Features

- **Overbooking-safe availability** — single and double carts share one pool, with
  non-trivial capacity rules (a convertible double borrows a single slot).
- **Group orders** — book several carts, mixed single/double, in one request.
- **Live staff calendar** with auto-refresh, plus manual bookings from the shop.
- **Weather closures** — close a day with a reason; optionally cancel + notify all.
- **Notifications** — confirmation, cancellation and next-day reminder via SMS/email.
- **Multilingual** customer flow and messages (DA/DE/EN) + international phone numbers.
- **Payments** — pay online (Flatpay) or in the shop, with a webhook-verified flow.

## Tech & architecture

Backend is **plain Node.js (standard library only)** — no framework, no build step.
Frontend is **vanilla HTML/CSS/JS**. The zero-dependency choice keeps the code
readable, dependency-free and easy to run, while still keeping a clear separation
of concerns:

```
config.js              Settings (fleet, prices, hours)
server.js              HTTP layer: routing + request handling
lib/availability.js    Domain logic: the fleet/overbooking math (pure, no I/O)
lib/store.js           Data access (JSON now; swap for a DB without touching logic)
lib/flatpay.js         Payment adapter (mock ⇄ real)
lib/googleCalendar.js  Calendar adapter (mock ⇄ real)
lib/notify.js          SMS/email adapter (mock ⇄ real)
public/                Customer + staff frontends
```

Integrations sit behind small adapters that each swap between a mock and a real
implementation, so the domain logic stays independent of infrastructure.

## Quick start

Requires Node.js 18+.

```bash
node seed-demo.js   # optional: adds example bookings so the calendar looks alive
node server.js
```

- Customer booking: <http://localhost:3000/>
- Staff calendar: <http://localhost:3000/staff.html> — demo code: `demo`

Run the fleet-math test suite with `node test-availability.js`.

## License

MIT
