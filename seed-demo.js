// Demo data seeder: fictional bookings + a closure day. Never run against a
// live system - it wipes data.json first.

const fs = require('fs');
const path = require('path');
const config = require('./config');

// Clean slate so repeated runs stay deterministic.
const DATA = path.join(__dirname, 'data.json');
fs.writeFileSync(DATA, JSON.stringify({ bookings: [], closures: [], nextId: 1 }, null, 2));

const store = require('./lib/store');

// Anchor to today so slots always land in the near future.
function at(daysFromNow, hh, mm = 0) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  d.setHours(hh, mm, 0, 0);
  return d.getTime();
}

const demo = [
  { type: 'single', d: 0, h: 11, dur: 60, name: 'Anna Jensen (demo)', phone: '+4512345678', lang: 'da', source: 'online' },
  { type: 'single', d: 0, h: 11, dur: 60, name: 'Mads Holm (demo)', phone: '+4523456789', lang: 'da', source: 'staff' },
  { type: 'double', d: 0, h: 13, dur: 120, name: 'Familie Schmidt (demo)', phone: '+4915112345678', lang: 'de', source: 'online' },
  { type: 'single', d: 1, h: 10, dur: 60, name: 'John Smith (demo)', phone: '+447700900123', lang: 'en', source: 'online' },
  { type: 'double', d: 1, h: 14, dur: 60, name: 'Klaus Weber (demo)', phone: '+4915198765432', lang: 'de', source: 'online' },
  { type: 'single', d: 1, h: 14, dur: 60, name: 'Sofie Lund (demo)', phone: '+4534567890', lang: 'da', source: 'staff' },
];

for (const b of demo) {
  const start = at(b.d, b.h);
  store.addBooking({
    type: b.type, start, end: start + b.dur * 60000, durationMinutes: b.dur,
    name: b.name, phone: b.phone, email: '', note: 'Demo-booking', lang: b.lang,
    payment: 'shop', source: b.source, status: 'confirmed',
  });
}

// Closure a few days out so the "bad weather" feature is visible.
store.addClosure(
  new Date(at(3, 12)).toISOString().slice(0, 10),
  'For meget vind (demo)'
);

console.log(`✔ Demo-data oprettet: ${demo.length} bookinger + 1 lukkedag.`);
console.log(`  Start serveren (node server.js) og log ind på /staff.html med koden "${config.staffAccessCode}".`);
