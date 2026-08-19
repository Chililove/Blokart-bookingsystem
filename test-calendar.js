// End-to-end Google Calendar check (create, read, delete) on a throwaway event.
// Needs GOOGLE_CALENDAR_ID + GOOGLE_KEY_FILE and googleapis (see GOOGLE-CALENDAR-SETUP.md).

const config = require('./config');
const cal = require('./lib/googleCalendar');

(async () => {
  if (config.googleCalendar.mock) {
    console.log('⚠  Kører i MOCK - der sker ikke noget rigtigt.');
    console.log('   Sæt GOOGLE_CALENDAR_ID og GOOGLE_KEY_FILE i .env og prøv igen.');
    console.log('   (Se GOOGLE-CALENDAR-SETUP.md)');
    return;
  }

  const start = Date.now() + 60 * 60 * 1000; // 1h out
  const fake = {
    id: 'TEST-' + Date.now(),
    type: 'single',
    name: 'TEST - kan slettes',
    phone: '+4512345678',
    payment: 'shop',
    lang: 'da',
    start,
    end: start + 60 * 60 * 1000,
  };

  console.log('Kalender:', config.googleCalendar.calendarId);
  console.log('1) Opretter testbegivenhed...');
  const ev = await cal.pushToCalendar(fake);
  console.log('   ✔ oprettet, eventId:', ev.eventId);

  console.log('2) Henter eksterne begivenheder (vores egne springes over)...');
  const list = await cal.pullFromCalendar(Date.now(), Date.now() + 2 * 86400000);
  console.log('   eksterne begivenheder fundet:', list.length, '(0 forventet - testbegivenheden er vores egen)');

  console.log('3) Venter 5 sek (kig gerne i din Google Kalender nu)...');
  await new Promise((r) => setTimeout(r, 5000));

  console.log('4) Sletter testbegivenheden igen...');
  await cal.removeFromCalendar(ev.eventId);
  console.log('   ✔ slettet');

  console.log('\n✅ Google Kalender virker! Begivenheder kan oprettes, læses og slettes.');
})().catch((e) => {
  console.error('\n❌ Fejl:', e.message);
  console.error('   Tjek: 1) er kalenderen delt med service account-mailen?');
  console.error('         2) er GOOGLE_CALENDAR_ID og GOOGLE_KEY_FILE rigtige i .env?');
  console.error('         3) har du kørt: npm install googleapis ?');
});
