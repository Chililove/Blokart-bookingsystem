// Next-day reminders. Flags each booking after sending so a re-run (e.g. cron)
// never double-reminds. Run via `node reminders.js` or schedule it - see README.

const store = require('./lib/store');
const notify = require('./lib/notify');

async function run() {
  const now = new Date();
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const from = tomorrow.getTime();
  const to = from + 24 * 60 * 60 * 1000 - 1;

  const bookings = store
    .getBookingsBetween(from, to)
    .filter((b) => b.status === 'confirmed' && !b.reminderSent);

  if (!bookings.length) {
    console.log('Ingen påmindelser at sende for i morgen.');
    return;
  }

  // Group by order so a multi-cart booking gets one reminder, not one per cart.
  const groups = new Map();
  for (const b of bookings) {
    const key = b.orderId || 'single-' + b.id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(b);
  }

  console.log(`Sender ${groups.size} påmindelse(r) for i morgen...`);
  for (const list of groups.values()) {
    const f = list[0];
    if (f.orderId) {
      await notify.notifyOrderCustomer('reminder', {
        name: f.name, phone: f.phone, email: f.email, lang: f.lang,
        payment: f.payment, start: f.start, singleQty: f.singleQty, doubleQty: f.doubleQty,
      });
    } else {
      await notify.notifyCustomer('reminder', f);
    }
    for (const b of list) store.setBookingFields(b.id, { reminderSent: true });
  }
  console.log('Færdig.');
}

run().catch((e) => { console.error('Fejl i reminders.js:', e); process.exit(1); });
