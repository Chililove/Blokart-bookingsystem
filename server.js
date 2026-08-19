// Single server for public site and staff screen, so they can't disagree on
// free carts = no overbooking. Plain Node, no dependencies.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const config = require('./config');
const store = require('./lib/store');
const { calcAvailability, canBook, canBookQuantities } = require('./lib/availability');
const flatpay = require('./lib/flatpay');
const calendar = require('./lib/googleCalendar');
const notify = require('./lib/notify');

const PUBLIC_DIR = path.join(__dirname, 'public');

// --- Helpers ---
function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

// Resolves { body, raw, tooLarge }. We keep the raw string because webhook
// signatures are computed over the exact bytes, and we abort oversized uploads
// so a huge payload can't exhaust memory.
function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    let received = 0;
    let tooLarge = false;
    let done = false;
    const finish = (payload) => { if (!done) { done = true; resolve(payload); } };
    req.on('data', (c) => {
      received += c.length;
      // Past the cap: stop buffering (bounds memory) but let the request end so
      // the handler can still reply 413. Only a wildly abusive upload is killed.
      if (received > config.limits.bodyMaxBytes) tooLarge = true;
      if (!tooLarge) data += c;
      if (received > config.limits.bodyMaxBytes * 8) req.destroy();
    });
    req.on('end', () => {
      if (tooLarge) return finish({ body: {}, raw: '', tooLarge: true });
      let body = {};
      try { body = JSON.parse(data || '{}'); } catch { body = {}; }
      finish({ body, raw: data, tooLarge: false });
    });
    req.on('close', () => finish({ body: {}, raw: '', tooLarge: true }));
    req.on('error', () => finish({ body: {}, raw: '', tooLarge: true }));
  });
}

// Trivial auth for the prototype; real logins are a later job. Constant-time
// compare so the shared code can't be guessed by timing the response.
function isStaff(req) {
  const given = String(req.headers['x-staff-code'] || '');
  const want = String(config.staffAccessCode);
  const a = Buffer.from(given), b = Buffer.from(want);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Phone required so staff can call to cancel in bad weather. Lenient on
// formatting, strict on 8+ digits.
function validPhone(phone) {
  if (!phone || typeof phone !== 'string') return false;
  const digits = phone.replace(/[^0-9]/g, '');
  return digits.length >= 8;
}

// Local (not UTC) date string, so a booking's day matches the shop's clock.
function dateStr(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// --- Mutex ---
// Serialize booking creation so two concurrent customers can't both pass the
// capacity check on the same last cart (overbooking).
let chain = Promise.resolve();
function runExclusive(fn) {
  const result = chain.then(fn, fn);
  chain = result.catch(() => {});
  return result;
}

// --- Rate limit ---
// Naive in-memory sliding window per client IP. Enough to blunt scripted spam
// on this single instance; a multi-instance deploy would need a shared store.
const rateHits = new Map();
function clientIp(req) {
  // Render/most proxies set x-forwarded-for; take the first (original) IP.
  const xf = req.headers['x-forwarded-for'];
  return (xf ? String(xf).split(',')[0].trim() : '') || req.socket.remoteAddress || 'unknown';
}
function rateLimited(ip) {
  const now = Date.now();
  const win = config.limits.rateWindowMs;
  const arr = (rateHits.get(ip) || []).filter((t) => now - t < win);
  arr.push(now);
  rateHits.set(ip, arr);
  return arr.length > config.limits.rateMaxRequests;
}

// A Flatpay checkout that's opened but never paid leaves pending_payment rows
// that keep holding carts. Cancel them past the TTL so the capacity frees up.
function reapPendingOrders() {
  const cutoff = Date.now() - config.limits.pendingTtlMinutes * 60000;
  const stale = store.getBookings().filter((b) => b.status === 'pending_payment' && (b.createdAt || 0) < cutoff);
  for (const b of stale) store.cancelBooking(b.id);
  if (stale.length) console.log(`[reaper] Frigav ${stale.length} ubetalt(e) booking(er) efter ${config.limits.pendingTtlMinutes} min.`);
  // Drop idle rate-limit buckets so the map can't grow without bound.
  const now = Date.now();
  for (const [ip, arr] of rateHits) {
    if (!arr.length || now - arr[arr.length - 1] > config.limits.rateWindowMs) rateHits.delete(ip);
  }
}

// Count staff's own Google Calendar entries too, or we'd overbook against
// carts staff reserved by hand.
async function bookingsInWindow(startMs, endMs) {
  const own = store.getBookingsBetween(startMs, endMs);
  let external = [];
  try {
    external = await calendar.pullFromCalendar(startMs, endMs);
  } catch (e) {
    // Don't block bookings if the calendar is unreachable.
    console.warn('Kunne ikke hente fra Google Kalender:', e.message);
  }
  return own.concat(external);
}

// Customer errors localized (da/de/en) for German tourists; staff text stays
// Danish. 'da' is the fallback.
function errors(lang) {
  const L = ['da', 'de', 'en'].includes(lang) ? lang : 'da';
  const cartWord = (type) => ({
    da: { single: 'single', double: 'dobbeltsæde' },
    de: { single: 'Single', double: 'Doppelsitz' },
    en: { single: 'single', double: 'two-seater' },
  }[L][type === 'double' ? 'double' : 'single']);
  const open = config.booking.openHour, close = config.booking.closeHour;
  const t = {
    da: {
      invalidType: 'Ugyldig vogntype.', nameMissing: 'Navn mangler.',
      phoneRequired: 'Telefonnummer er påkrævet.', invalidDuration: 'Ugyldig varighed.',
      consent: 'Du skal acceptere betingelserne og privatlivspolitikken for at booke.',
      invalidDateTime: 'Ugyldig dato/tid.', past: 'Tidspunktet er i fortiden.',
      hours: `Bookinger skal ligge mellem kl. ${open} og ${close}.`,
      closed: (d, r) => `Vi har lukket for booking ${d}: ${r}. Vælg venligst en anden dato.`,
      full: (ty) => `Desværre - ingen ledige ${cartWord(ty)}-vogne i det tidsrum.`,
      chooseQty: 'Vælg mindst én vogn.',
      notEnough: 'Der er ikke nok ledige vogne i det tidsrum til så mange. Vælg færre vogne eller et andet tidspunkt.',
      tooLong: 'En af oplysningerne er for lang.',
      invalidEmail: 'E-mailadressen ser ikke rigtig ud.',
    },
    de: {
      invalidType: 'Ungültiger Wagentyp.', nameMissing: 'Name fehlt.',
      phoneRequired: 'Telefonnummer ist erforderlich.', invalidDuration: 'Ungültige Dauer.',
      consent: 'Du musst die Bedingungen und die Datenschutzerklärung akzeptieren, um zu buchen.',
      invalidDateTime: 'Ungültiges Datum/Zeit.', past: 'Der Zeitpunkt liegt in der Vergangenheit.',
      hours: `Buchungen müssen zwischen ${open} und ${close} Uhr liegen.`,
      closed: (d, r) => `An diesem Tag ist die Buchung geschlossen (${d}): ${r}. Bitte wähle ein anderes Datum.`,
      full: (ty) => `Leider keine freien ${cartWord(ty)}-Wagen in diesem Zeitraum.`,
      chooseQty: 'Wähle mindestens einen Wagen.',
      notEnough: 'Nicht genug freie Wagen in diesem Zeitraum. Wähle weniger Wagen oder eine andere Zeit.',
      tooLong: 'Eine der Angaben ist zu lang.',
      invalidEmail: 'Die E-Mail-Adresse sieht nicht korrekt aus.',
    },
    en: {
      invalidType: 'Invalid cart type.', nameMissing: 'Name is missing.',
      phoneRequired: 'Phone number is required.', invalidDuration: 'Invalid duration.',
      consent: 'You must accept the terms and privacy policy to book.',
      invalidDateTime: 'Invalid date/time.', past: 'That time is in the past.',
      hours: `Bookings must be between ${open}:00 and ${close}:00.`,
      closed: (d, r) => `Booking is closed on ${d}: ${r}. Please choose another date.`,
      full: (ty) => `Sorry - no ${cartWord(ty)} carts available in that time slot.`,
      chooseQty: 'Choose at least one cart.',
      notEnough: 'Not enough carts available in that time slot for that many. Choose fewer carts or another time.',
      tooLong: 'One of the details is too long.',
      invalidEmail: 'That email address does not look right.',
    },
  };
  return t[L];
}

// Length caps + email format, shared by single and group bookings so the two
// paths can't diverge. Returns an error string, or null when the fields pass.
function contactError(input, E) {
  const L = config.limits;
  const name = (input.name || '').trim();
  const phone = (input.phone || '').trim();
  const email = (input.email || '').trim();
  const note = (input.note || '').trim();
  if (name.length > L.nameMax || phone.length > L.phoneMax || note.length > L.noteMax || email.length > L.emailMax) {
    return E.tooLong;
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return E.invalidEmail;
  return null;
}

// Shared by online customers and staff so validation/capacity rules can't
// diverge between the two entry points.
async function createBooking(input, { isStaffBooking }) {
  const { type, date, startTime, durationMinutes, name, phone, email, payment, note } = input;
  const lang = ['da', 'de', 'en'].includes(input.lang) ? input.lang : 'da';
  const E = errors(lang);

  // --- Validation -----------------------------------------------------------
  if (!['single', 'double'].includes(type)) return { ok: false, error: E.invalidType };
  if (!name || !name.trim()) return { ok: false, error: E.nameMissing };
  if (!validPhone(phone)) return { ok: false, error: E.phoneRequired };
  const contactErr = contactError(input, E);
  if (contactErr) return { ok: false, error: contactErr };
  // GDPR: only online customers must consent; staff book on their behalf.
  if (!isStaffBooking && !input.consent) return { ok: false, error: E.consent };

  const dur = Number(durationMinutes);
  if (!config.booking.durationsMinutes.includes(dur)) return { ok: false, error: E.invalidDuration };

  const start = new Date(`${date}T${startTime}:00`).getTime();
  if (isNaN(start)) return { ok: false, error: E.invalidDateTime };
  const end = start + dur * 60000;

  // 60s grace so a click at the top of the slot isn't rejected as "past".
  if (start < Date.now() - 60000) return { ok: false, error: E.past };

  // Whole booking must fit inside opening hours, not just its start.
  const startH = new Date(start).getHours() + new Date(start).getMinutes() / 60;
  const endH = new Date(end).getHours() + new Date(end).getMinutes() / 60;
  if (startH < config.booking.openHour || endH > config.booking.closeHour) {
    return { ok: false, error: E.hours };
  }

  // --- Closed day ---
  // Weather closure blocks everyone, staff included; booking onto a cancelled
  // day is almost always a mistake. Staff must reopen the day first.
  const closure = store.getClosureForDate(date);
  if (closure) {
    return {
      ok: false,
      closed: true,
      error: isStaffBooking
        ? `Dagen ${date} er lukket (${closure.reason}). Åbn dagen igen først, hvis I vil oprette en booking.`
        : E.closed(date, closure.reason),
    };
  }

  // --- Capacity: the one check that actually prevents overbooking ---
  const existing = await bookingsInWindow(start, end);
  if (!canBook(existing, type, start, end, config.fleet)) {
    return { ok: false, error: E.full(type), full: true };
  }

  // --- Persist ---
  const booking = store.addBooking({
    type,
    start,
    end,
    durationMinutes: dur,
    name: name.trim(),
    phone: phone.trim(),
    email: (email || '').trim(),
    note: (note || '').trim(),
    lang,
    // GDPR: record online consent as evidence; null when staff booked it.
    consentAccepted: isStaffBooking ? null : !!input.consent,
    payment: payment === 'shop' ? 'shop' : 'flatpay',
    source: isStaffBooking ? 'staff' : 'online',
    // Staff and pay-in-shop are certain; online Flatpay isn't paid yet.
    status: isStaffBooking || payment === 'shop' ? 'confirmed' : 'pending_payment',
  });

  // Confirmed bookings hit the calendar and notify now. Unpaid Flatpay waits
  // for the webhook, so we never confirm an unpaid booking.
  if (booking.status === 'confirmed') {
    // Booking is already saved; a calendar/SMS hiccup must not fail the request
    // or the customer would rebook and we'd double-count the cart.
    try {
      const ev = await calendar.pushToCalendar(booking);
      store.setBookingFields(booking.id, { calendarEventId: ev.eventId });
      booking.calendarEventId = ev.eventId;
    } catch (e) { console.error('Kalender-push fejlede (booking gemt):', e.message); }
    try { await notify.notifyCustomer('confirmation', booking); }
    catch (e) { console.error('Notifikation fejlede (booking gemt):', e.message); }
  }

  return { ok: true, booking };
}

// Group order: several carts, one slot, one purchase. Stored as N bookings
// sharing an orderId so they confirm/cancel together.
async function createOrder(input, { isStaffBooking = false } = {}) {
  const lang = ['da', 'de', 'en'].includes(input.lang) ? input.lang : 'da';
  const E = errors(lang);

  const singleQty = Math.max(0, parseInt(input.singleQty, 10) || 0);
  const doubleQty = Math.max(0, parseInt(input.doubleQty, 10) || 0);
  const { date, startTime, durationMinutes, name, phone, email, payment } = input;

  // --- Validation ---
  if (singleQty + doubleQty < 1) return { ok: false, error: E.chooseQty };
  if (!name || !name.trim()) return { ok: false, error: E.nameMissing };
  if (!validPhone(phone)) return { ok: false, error: E.phoneRequired };
  const contactErr = contactError(input, E);
  if (contactErr) return { ok: false, error: contactErr };
  // GDPR: consent required from online customers only, not staff.
  if (!isStaffBooking && !input.consent) return { ok: false, error: E.consent };

  const dur = Number(durationMinutes);
  if (!config.booking.durationsMinutes.includes(dur)) return { ok: false, error: E.invalidDuration };

  const start = new Date(`${date}T${startTime}:00`).getTime();
  if (isNaN(start)) return { ok: false, error: E.invalidDateTime };
  const end = start + dur * 60000;
  if (start < Date.now() - 60000) return { ok: false, error: E.past };

  const startH = new Date(start).getHours() + new Date(start).getMinutes() / 60;
  const endH = new Date(end).getHours() + new Date(end).getMinutes() / 60;
  if (startH < config.booking.openHour || endH > config.booking.closeHour) {
    return { ok: false, error: E.hours };
  }

  // Closures block online customers; staff may override (e.g. a phoned-in group).
  const closure = store.getClosureForDate(date);
  if (closure && !isStaffBooking) return { ok: false, closed: true, error: E.closed(date, closure.reason) };

  // --- Capacity for the whole order ---
  // Enforced even for staff: no override can conjure more physical carts.
  const existing = await bookingsInWindow(start, end);
  if (!canBookQuantities(existing, singleQty, doubleQty, start, end, config.fleet)) {
    return { ok: false, full: true, error: E.notEnough };
  }

  // --- Persist N bookings under a shared orderId ---
  const orderId = 'ord_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  const isFlatpay = !isStaffBooking && payment === 'flatpay';
  const common = {
    start, end, durationMinutes: dur,
    name: name.trim(), phone: phone.trim(), email: (email || '').trim(),
    note: (input.note || '').trim(), lang,
    consentAccepted: isStaffBooking ? null : !!input.consent,
    payment: isFlatpay ? 'flatpay' : 'shop',
    source: isStaffBooking ? 'staff' : 'online',
    status: isFlatpay ? 'pending_payment' : 'confirmed',
    orderId, singleQty, doubleQty,
  };
  const bookings = [];
  for (let i = 0; i < singleQty; i++) bookings.push(store.addBooking({ ...common, type: 'single' }));
  for (let i = 0; i < doubleQty; i++) bookings.push(store.addBooking({ ...common, type: 'double' }));

  const total = singleQty * config.prices.single + doubleQty * config.prices.double;
  const order = { name: common.name, phone: common.phone, email: common.email, lang, payment: common.payment, start, singleQty, doubleQty };

  // Confirmed orders hit the calendar now with one message for the group;
  // Flatpay orders wait for the payment webhook.
  if (common.status === 'confirmed') {
    // Order rows are saved; side-effects are best-effort so they can't 500 the
    // request after we've already committed the carts.
    for (const b of bookings) {
      try {
        const ev = await calendar.pushToCalendar(b);
        store.setBookingFields(b.id, { calendarEventId: ev.eventId });
      } catch (e) { console.error('Kalender-push fejlede (ordre gemt):', e.message); }
    }
    try { await notify.notifyOrderCustomer('confirmation', order); }
    catch (e) { console.error('Notifikation fejlede (ordre gemt):', e.message); }
  }

  return { ok: true, orderId, bookings, total, order, payment: common.payment };
}

// --- Static files (the website) ---
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
function serveStatic(req, res) {
  let urlPath = req.url.split('?')[0];
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(PUBLIC_DIR, path.normalize(urlPath));
  // Reject path-traversal that escapes PUBLIC_DIR (e.g. ../../etc/passwd).
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Ikke fundet'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
}

// --- Router ---
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;

  try {
    // --- Public config the client needs to render ---
    if (p === '/api/config' && req.method === 'GET') {
      return sendJson(res, 200, {
        businessName: config.businessName,
        contactPhone: config.contactPhone,
        prices: config.prices,
        durationsMinutes: config.booking.durationsMinutes,
        openHour: config.booking.openHour,
        closeHour: config.booking.closeHour,
        slotStepMinutes: config.booking.slotStepMinutes,
        maxDaysAhead: config.booking.maxDaysAhead,
        fleet: config.fleet,
        pollIntervalMs: config.googleCalendar.pollIntervalMs,
        links: config.links,
      });
    }

    // --- Available slots for one day ---
    if (p === '/api/slots' && req.method === 'GET') {
      const date = url.searchParams.get('date');
      const dur = Number(url.searchParams.get('durationMinutes')) || config.booking.durationsMinutes[0];
      if (!date) return sendJson(res, 400, { error: 'Mangler dato.' });

      const closure = store.getClosureForDate(date);

      const slots = [];
      const { openHour, closeHour, slotStepMinutes } = config.booking;
      // Fetch the whole day's bookings ONCE, then compute each slot in memory.
      // calcAvailability filters to each window, so one calendar call replaces
      // the ~15 we used to make per page load.
      const dayStart = new Date(`${date}T00:00:00`).getTime();
      const dayEnd = new Date(`${date}T23:59:59`).getTime();
      const dayBookings = await bookingsInWindow(dayStart, dayEnd);
      for (let m = openHour * 60; m + dur <= closeHour * 60; m += slotStepMinutes) {
        const hh = String(Math.floor(m / 60)).padStart(2, '0');
        const mm = String(m % 60).padStart(2, '0');
        const start = new Date(`${date}T${hh}:${mm}:00`).getTime();
        const end = start + dur * 60000;
        const a = calcAvailability(dayBookings, start, end, config.fleet);
        slots.push({
          time: `${hh}:${mm}`,
          singleAvailable: a.singleAvailable,
          doubleAvailable: a.doubleAvailable,
          // Raw booked counts let the client check a mixed quantity fits.
          sBooked: a.singleBooked,
          dBooked: a.doubleBooked,
          past: start < Date.now(),
        });
      }
      return sendJson(res, 200, { date, durationMinutes: dur, closure: closure || null, slots });
    }

    // --- Create booking/order (online customer) ---
    if (p === '/api/bookings' && req.method === 'POST') {
      if (rateLimited(clientIp(req))) return sendJson(res, 429, { error: 'For mange forsøg lige nu. Vent et øjeblik og prøv igen.' });
      const { body, tooLarge } = await readBody(req);
      if (tooLarge) return sendJson(res, 413, { error: 'Forespørgslen er for stor.' });
      // Serialize through the mutex so concurrent orders can't overbook.
      const result = await runExclusive(() => createOrder(body));
      if (!result.ok) return sendJson(res, 409, result);

      // Flatpay: return a checkout URL for the order; not confirmed yet.
      if (result.payment === 'flatpay') {
        const checkout = await flatpay.createCheckout({
          orderId: result.orderId,
          amountKr: result.total,
          description: `Blokart booking hos ${config.businessName}`,
          customerPhone: result.order.phone,
        });
        return sendJson(res, 201, { ok: true, orderId: result.orderId, total: result.total, payment: 'flatpay', checkoutUrl: checkout.checkoutUrl });
      }
      // Pay-in-shop is already confirmed by createOrder.
      return sendJson(res, 201, { ok: true, orderId: result.orderId, total: result.total, order: result.order, payment: 'shop' });
    }

    // --- Flatpay webhook ---
    // SECURITY: payment confirmed only here, never from the browser, which
    // can't prove money changed hands.
    if (p === '/api/payments/webhook' && req.method === 'POST') {
      const { body, raw, tooLarge } = await readBody(req);
      if (tooLarge) return sendJson(res, 413, { error: 'Payload for stor.' });
      // Verify the signature over the RAW bytes before trusting a "paid" event.
      // Mock returns true; production returns false unless the HMAC matches, so
      // a forged webhook can't confirm a free booking.
      if (!flatpay.verifyWebhook(req.headers, raw)) {
        return sendJson(res, 401, { error: 'Ugyldig webhook-signatur.' });
      }
      const orderId = body.orderId;
      if (!orderId) return sendJson(res, 400, { error: 'Mangler orderId.' });

      const bookings = store.getBookingsByOrder(orderId);
      if (!bookings.length) return sendJson(res, 404, { error: 'Ordre ikke fundet.' });

      // Skip confirmed bookings so a duplicate webhook is a no-op.
      const pending = bookings.filter((b) => b.status === 'pending_payment');
      if (pending.length) {
        for (const b of pending) {
          store.setBookingFields(b.id, { status: 'confirmed', paidAt: Date.now() });
          try {
            const ev = await calendar.pushToCalendar(b);
            store.setBookingFields(b.id, { calendarEventId: ev.eventId });
          } catch (e) { console.error('Kalender-push fejlede (betaling bekræftet):', e.message); }
        }
        // One confirmation for the whole order, not one per cart.
        const f = bookings[0];
        try {
          await notify.notifyOrderCustomer('confirmation', {
            name: f.name, phone: f.phone, email: f.email, lang: f.lang,
            payment: 'flatpay', start: f.start, singleQty: f.singleQty, doubleQty: f.doubleQty,
          });
        } catch (e) { console.error('Notifikation fejlede (betaling bekræftet):', e.message); }
      }
      return sendJson(res, 200, { ok: true });
    }

    // --- Staff-only routes: gate them all before any handler runs ---
    if (p.startsWith('/api/staff') || p === '/api/bookings/list' || p === '/api/closures' || p === '/api/bookings/cancel') {
      if (!isStaff(req)) return sendJson(res, 401, { error: 'Forkert eller manglende personale-kode.' });
    }

    // --- Staff: list bookings in a range ---
    if (p === '/api/bookings/list' && req.method === 'GET') {
      const from = Number(url.searchParams.get('from'));
      const to = Number(url.searchParams.get('to'));
      const bookings = store.getBookingsBetween(from, to);
      const closures = store.getClosures().filter((c) => {
        const cms = new Date(`${c.date}T00:00:00`).getTime();
        return cms >= from - 86400000 && cms <= to;
      });
      return sendJson(res, 200, { bookings, closures });
    }

    // --- Staff: create booking(s) themselves ---
    // Quantities -> group order; otherwise legacy single booking, kept for
    // backward compatibility with older staff clients.
    if (p === '/api/staff/bookings' && req.method === 'POST') {
      const { body, tooLarge } = await readBody(req);
      if (tooLarge) return sendJson(res, 413, { error: 'Forespørgslen er for stor.' });
      const hasQty = body.singleQty !== undefined || body.doubleQty !== undefined;
      const result = hasQty
        ? await runExclusive(() => createOrder(body, { isStaffBooking: true }))
        : await runExclusive(() => createBooking(body, { isStaffBooking: true }));
      return sendJson(res, result.ok ? 201 : 409, result);
    }

    // --- Staff: cancel a booking ---
    if (p === '/api/bookings/cancel' && req.method === 'POST') {
      const { body } = await readBody(req);
      const reason = (body.reason || '').trim() || 'aflyst af butikken';
      const b = store.cancelBooking(Number(body.id));
      if (b) {
        // Free the calendar slot and tell the customer why.
        if (b.calendarEventId) await calendar.removeFromCalendar(b.calendarEventId);
        await notify.notifyCustomer('cancellation', b, { reason });
      }
      return sendJson(res, 200, { ok: !!b });
    }

    // --- Staff: close / reopen a day ---
    if (p === '/api/closures' && req.method === 'POST') {
      const { body, tooLarge } = await readBody(req);
      if (tooLarge) return sendJson(res, 413, { error: 'Forespørgslen er for stor.' });
      if (!body.date || !body.reason) return sendJson(res, 400, { error: 'Dato og årsag skal udfyldes.' });
      const c = store.addClosure(body.date, body.reason);

      // Optional one-click "storm all day": cancel every booking on the day
      // and notify customers, instead of one by one.
      let cancelledCount = 0;
      if (body.cancelExisting) {
        const from = new Date(`${body.date}T00:00:00`).getTime();
        const to = new Date(`${body.date}T23:59:59`).getTime();
        const affected = store.getBookingsBetween(from, to);
        for (const bk of affected) {
          store.cancelBooking(bk.id);
          if (bk.calendarEventId) await calendar.removeFromCalendar(bk.calendarEventId);
          cancelledCount++;
        }
        // Dedupe to one message per order (or order-less single booking), so a
        // group of carts isn't spammed with one text per cart.
        const groups = new Map();
        for (const bk of affected) {
          const key = bk.orderId || 'single-' + bk.id;
          if (!groups.has(key)) groups.set(key, bk);
        }
        for (const bk of groups.values()) {
          if (bk.orderId) {
            await notify.notifyOrderCustomer('cancellation', {
              name: bk.name, phone: bk.phone, email: bk.email, lang: bk.lang,
              payment: bk.payment, start: bk.start, singleQty: bk.singleQty, doubleQty: bk.doubleQty,
            }, { reason: body.reason });
          } else {
            await notify.notifyCustomer('cancellation', bk, { reason: body.reason });
          }
        }
      }
      return sendJson(res, 201, { ok: true, closure: c, cancelledCount });
    }
    if (p === '/api/closures' && req.method === 'DELETE') {
      const { body } = await readBody(req);
      store.removeClosure(body.date);
      return sendJson(res, 200, { ok: true });
    }
    if (p === '/api/closures' && req.method === 'GET') {
      return sendJson(res, 200, { closures: store.getClosures() });
    }

    // --- Fallthrough: serve a static file ---
    if (req.method === 'GET') return serveStatic(req, res);

    sendJson(res, 404, { error: 'Ukendt rute.' });
  } catch (err) {
    console.error('Serverfejl:', err);
    sendJson(res, 500, { error: 'Der opstod en serverfejl.' });
  }
});

server.listen(config.port, () => {
  console.log('');
  console.log(`  ${config.businessName} – Blokart booking`);
  console.log(`  ------------------------------------------`);
  console.log(`  Kundeside:   http://localhost:${config.port}/`);
  // Only echo the code for the public 'demo' fallback; never log a real secret.
  console.log(`  Personale:   http://localhost:${config.port}/staff.html  (kode: ${config.staffAccessCode === 'demo' ? 'demo' : 'se STAFF_ACCESS_CODE i .env'})`);
  console.log(`  Flatpay:     ${config.flatpay.mock ? 'MOCK (ingen rigtig nøgle endnu)' : 'AKTIV'}`);
  console.log(`  Google Cal:  ${config.googleCalendar.mock ? 'MOCK (ingen rigtig kalender endnu)' : 'AKTIV'}`);
  console.log(`  SMS:         ${config.notifications.smsMock ? 'MOCK (skrives i terminalen)' : 'AKTIV'}`);
  console.log(`  E-mail:      ${config.notifications.emailMock ? 'MOCK (skrives i terminalen)' : 'AKTIV'}`);
  if (config.staffAccessCode === 'demo') {
    console.log('');
    console.log('  ⚠  Bruger DEMO-personalekode "demo". Sæt STAFF_ACCESS_CODE i .env til produktion.');
  }
  console.log('');

  // Sweep abandoned unpaid orders on a timer (and once shortly after boot).
  setTimeout(reapPendingOrders, 10000).unref();
  setInterval(reapPendingOrders, 5 * 60 * 1000).unref();
});
