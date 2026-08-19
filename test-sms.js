// Smoke test for SMS templates + GatewayAPI. Usage: node test-sms.js <number> [type]
// Sends a real SMS with GATEWAYAPI_TOKEN set, otherwise mocks.

const config = require('./config');
const notify = require('./lib/notify');

const phone = process.argv[2];
const type = process.argv[3] || 'confirmation';

if (!phone) {
  console.log('Skriv dit nummer, fx:  node test-sms.js 12345678 cancellation');
  process.exit(1);
}
if (!['confirmation', 'cancellation', 'reminder'].includes(type)) {
  console.log(`Ukendt type "${type}". Vælg: confirmation, cancellation eller reminder.`);
  process.exit(1);
}

// Throwaway payload for template rendering.
const fakeBooking = {
  name: 'Test',
  phone,
  email: '',
  type: 'single',
  payment: 'shop',
  start: Date.now() + 3600000, // 1h out
};

(async () => {
  console.log(config.notifications.smsMock
    ? '⚠️  Ingen GATEWAYAPI_TOKEN fundet - kører i MOCK (ingen rigtig SMS).'
    : `📲 Sender rigtig test-SMS (${type}) via GatewayAPI...`);
  const res = await notify.notifyCustomer(type, fakeBooking, { reason: 'for meget vind (test)' });
  console.log('Resultat:', JSON.stringify(res.sms));
})();
