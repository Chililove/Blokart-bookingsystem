// Owner-tunable settings, kept in one place.

// Minimal .env reader (no dotenv dep). Existing env vars win over the file.
(function loadDotEnv() {
  try {
    const fs = require('fs');
    const path = require('path');
    const file = path.join(__dirname, '.env');
    if (!fs.existsSync(file)) return;
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const i = t.indexOf('=');
      if (i === -1) continue;
      const key = t.slice(0, i).trim();
      let val = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
      if (key && process.env[key] === undefined) process.env[key] = val;
    }
  } catch (e) { /* .env is optional */ }
})();

module.exports = {
  businessName: 'Club Fanø',
  contactPhone: '+45 42 41 25 65',
  contactEmail: 'clubfanoe@gmail.com',

  // GDPR consent links. Empty termsUrl makes the UI show terms as plain text.
  links: {
    privacyUrl: 'https://clubfanoe.dk/privatlivspolitik-gdpr/',
    termsUrl: '',
  },

  // Fleet numbers drive sold-out logic; getting them right prevents overbooking.
  fleet: {
    totalSingle: 10,

    // A convertible double borrows one single while in use.
    convertibleDouble: 2,

    // Separate from the 10 singles, so consumes no single capacity.
    permanentDouble: 1,
  },

  prices: {
    single: 335,   // matches clubfanoe.dk "Priser fra 335 kr."
    double: 595,    // set the real price here
  },

  booking: {
    durationsMinutes: [60, 120],

    // Slots step over slotStepMinutes; closeHour is the latest a trip may end.
    openHour: 10,
    closeHour: 18,
    slotStepMinutes: 30,

    maxDaysAhead: 60,
  },

  // Prototype-grade. Real code in .env; server warns on 'demo'. See README.
  staffAccessCode: process.env.STAFF_ACCESS_CODE || 'demo',

  port: process.env.PORT || 3000,

  // Integrations: real keys via .env only. See README.
  flatpay: {
    enabled: true,
    mock: !process.env.FLATPAY_API_KEY,   // mock until a real key exists
    apiKey: process.env.FLATPAY_API_KEY || 'MOCK_FLATPAY_KEY',
    // Needed to verify webhook signatures in production (see lib/flatpay.js).
    webhookSecret: process.env.FLATPAY_WEBHOOK_SECRET || '',
  },

  // Abuse/robustness guards. Small caps keep storage sane and block junk;
  // the rate limit slows scripted spam; pendingTtl frees carts held by
  // abandoned checkouts so they don't stay "sold" forever.
  limits: {
    bodyMaxBytes: 16 * 1024,
    nameMax: 80, phoneMax: 32, emailMax: 120, noteMax: 300,
    rateWindowMs: 60 * 1000, rateMaxRequests: 12,
    pendingTtlMinutes: 30,
  },
  googleCalendar: {
    enabled: true,
    mock: !process.env.GOOGLE_CALENDAR_ID,
    calendarId: process.env.GOOGLE_CALENDAR_ID || 'mock-shared-calendar@group.calendar.google.com',
    pollIntervalMs: 10 * 60 * 1000, // staff calendar poll interval
  },

  // Mocked until real keys in .env. SMS carries weather-cancellation alerts.
  notifications: {
    // GatewayAPI recommended (Danish, cheap).
    smsEnabled: true,
    smsMock: !process.env.GATEWAYAPI_TOKEN,
    smsToken: process.env.GATEWAYAPI_TOKEN || 'MOCK_SMS_TOKEN',
    smsSender: 'ClubFanoe', // SMS sender name; max 11 chars

    emailEnabled: true,
    emailMock: !process.env.SMTP_HOST,
    emailFrom: process.env.EMAIL_FROM || 'clubfanoe@gmail.com',
  },
};
