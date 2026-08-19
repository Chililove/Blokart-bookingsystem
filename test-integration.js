// End-to-end guard for the HTTP layer: real server, real routes, throwaway
// data file. Covers the rules that actually protect the business - overbooking,
// payment confirmation, closures, cancellation, auth and input validation - so
// a future change can't quietly break them. Fleet math has its own unit test.

const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = 4700 + Math.floor(Math.random() * 200);
const STAFF = 'testcode-123';
const DATA_FILE = path.join(os.tmpdir(), `blokart-test-${Date.now()}.json`);
// A date far in the future so slots never count as "past".
const DAY = '2099-06-15';

let pass = 0, fail = 0;
function check(name, cond) {
  console.log(`${cond ? '✔' : '✗ FEJL'}  ${name}`);
  cond ? pass++ : fail++;
}

// Minimal JSON HTTP client so the test needs no dependencies.
function req(method, urlPath, { body, staff } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (payload) headers['Content-Length'] = Buffer.byteLength(payload);
    if (staff) headers['x-staff-code'] = staff;
    const r = http.request({ host: '127.0.0.1', port: PORT, path: urlPath, method, headers }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        let json = {};
        try { json = JSON.parse(data || '{}'); } catch { /* non-JSON body */ }
        resolve({ status: res.statusCode, json });
      });
    });
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

const order = (over = {}) => ({
  singleQty: 1, doubleQty: 0, date: DAY, startTime: '12:00', durationMinutes: 60,
  name: 'Test Testesen', phone: '+4512345678', email: '', consent: true, payment: 'shop', ...over,
});

function waitForReady(retries = 50) {
  return new Promise((resolve, reject) => {
    const tryOnce = (n) => {
      const r = http.request({ host: '127.0.0.1', port: PORT, path: '/api/config', method: 'GET' }, () => resolve());
      r.on('error', () => (n <= 0 ? reject(new Error('server never came up')) : setTimeout(() => tryOnce(n - 1), 100)));
      r.end();
    };
    tryOnce(retries);
  });
}

async function run() {
  // 1. Config is public and complete.
  let r = await req('GET', '/api/config');
  check('config: 200 og indeholder priser + flåde', r.status === 200 && !!r.json.prices && !!r.json.fleet);

  // 2. Valid pay-in-shop order is created and priced correctly.
  r = await req('POST', '/api/bookings', { body: order({ singleQty: 2, doubleQty: 1 }) });
  check('ordre: 201 oprettet', r.status === 201 && r.json.ok === true);
  check('ordre: pris = 2×335 + 1×595', r.json.total === 2 * 335 + 595);

  // 3. Email format is validated.
  r = await req('POST', '/api/bookings', { body: order({ email: 'not-an-email' }) });
  check('validering: dårlig e-mail afvist', r.status === 409 && !r.json.ok);

  // 4. Over-capacity single order is refused (10 singles exist; ask for 11).
  r = await req('POST', '/api/bookings', { body: order({ singleQty: 11, date: '2099-06-16' }) });
  check('kapacitet: for mange vogne afvist', r.status === 409 && r.json.full === true);

  // 5. Overbooking guard across separate orders on the same slot.
  //    Day/slot starts empty; fill the last single, then one more must fail.
  const D2 = '2099-06-17';
  r = await req('POST', '/api/bookings', { body: order({ singleQty: 10, date: D2 }) });
  check('overbooking: 10 singler fylder slot', r.status === 201 && r.json.ok);
  r = await req('POST', '/api/bookings', { body: order({ singleQty: 1, date: D2 }) });
  check('overbooking: 11. single afvist', r.status === 409 && r.json.full === true);

  // 6. Flatpay order stays pending until the (verified, mock=true) webhook.
  r = await req('POST', '/api/bookings', { body: order({ date: '2099-06-18', payment: 'flatpay' }) });
  const flatOrder = r.json.orderId;
  check('flatpay: 201 med checkoutUrl', r.status === 201 && !!r.json.checkoutUrl && !!flatOrder);
  r = await req('POST', '/api/payments/webhook', { body: { orderId: flatOrder } });
  check('webhook: bekræfter betaling (200)', r.status === 200 && r.json.ok);
  // Idempotent: a duplicate webhook is a harmless no-op.
  r = await req('POST', '/api/payments/webhook', { body: { orderId: flatOrder } });
  check('webhook: dublet er no-op (200)', r.status === 200 && r.json.ok);
  // Unknown order is rejected.
  r = await req('POST', '/api/payments/webhook', { body: { orderId: 'ord_does_not_exist' } });
  check('webhook: ukendt ordre afvist (404)', r.status === 404);

  // 7. Staff routes require the code.
  r = await req('GET', '/api/bookings/list?from=0&to=9999999999999');
  check('auth: liste uden kode afvist (401)', r.status === 401);
  r = await req('GET', '/api/bookings/list?from=0&to=9999999999999', { staff: STAFF });
  check('auth: liste med kode tilladt (200)', r.status === 200 && Array.isArray(r.json.bookings));

  // 8. Closure blocks online booking; reopening restores it.
  const D3 = '2099-06-19';
  r = await req('POST', '/api/closures', { body: { date: D3, reason: 'for meget vind' }, staff: STAFF });
  check('lukning: dag lukket (201)', r.status === 201 && r.json.ok);
  r = await req('POST', '/api/bookings', { body: order({ date: D3 }) });
  check('lukning: online booking blokeret (409)', r.status === 409 && r.json.closed === true);
  r = await req('DELETE', '/api/closures', { body: { date: D3 }, staff: STAFF });
  check('lukning: dag genåbnet (200)', r.status === 200 && r.json.ok);
  r = await req('POST', '/api/bookings', { body: order({ date: D3 }) });
  check('lukning: booking virker igen efter genåbning', r.status === 201 && r.json.ok);

  // 9. Cancelling a booking frees its cart again.
  const D4 = '2099-06-20';
  await req('POST', '/api/bookings', { body: order({ singleQty: 10, date: D4 }) });
  let list = await req('GET', `/api/bookings/list?from=${new Date(D4 + 'T00:00:00').getTime()}&to=${new Date(D4 + 'T23:59:59').getTime()}`, { staff: STAFF });
  const oneId = list.json.bookings[0].id;
  r = await req('POST', '/api/bookings/cancel', { body: { id: oneId, reason: 'test' }, staff: STAFF });
  check('aflysning: booking aflyst (200)', r.status === 200 && r.json.ok);
  r = await req('POST', '/api/bookings', { body: order({ singleQty: 1, date: D4 }) });
  check('aflysning: frigiver vogn (ny booking lykkes)', r.status === 201 && r.json.ok);

  console.log(`\n${fail === 0 ? '✅ ALLE TEST BESTÅET' : '❌ NOGLE TEST FEJLEDE'} (${pass} ok, ${fail} fejl)`);
  return fail === 0;
}

// Start a real server against a temp data file, run the suite, always clean up.
fs.writeFileSync(DATA_FILE, JSON.stringify({ bookings: [], closures: [], nextId: 1 }));
const child = spawn('node', ['server.js'], {
  cwd: __dirname,
  env: { ...process.env, PORT: String(PORT), DATA_FILE, STAFF_ACCESS_CODE: STAFF,
    // Force mock integrations regardless of any real keys in .env.
    FLATPAY_API_KEY: '', GOOGLE_CALENDAR_ID: '', GATEWAYAPI_TOKEN: '', SMTP_HOST: '' },
  stdio: ['ignore', 'ignore', 'inherit'],
});

(async () => {
  let ok = false;
  try {
    await waitForReady();
    ok = await run();
  } catch (e) {
    console.error('Testkørsel fejlede:', e.message);
  } finally {
    child.kill();
    try { fs.unlinkSync(DATA_FILE); } catch { /* already gone */ }
    process.exit(ok ? 0 : 1);
  }
})();
