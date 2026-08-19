// Customer SMS + email: confirmation, cancellation, next-day reminder.
// Both default to MOCK (terminal) without credentials. Go live via
// GATEWAYAPI_TOKEN (SMS) and SMTP in .env; fill in sendSms()/sendEmail().

const config = require('../config');

const LOCALE = { da: 'da-DK', de: 'de-DE', en: 'en-GB' };

function pretty(booking, lang) {
  const loc = LOCALE[lang] || 'da-DK';
  const d = new Date(booking.start);
  const dato = d.toLocaleDateString(loc, { weekday: 'long', day: 'numeric', month: 'long' });
  const tid = d.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' });
  return { dato, tid };
}

function vognName(type, lang) {
  const m = {
    da: { single: 'single blokart', double: 'dobbeltsæde blokart' },
    de: { single: 'Single Blokart', double: 'Doppelsitz Blokart' },
    en: { single: 'single blokart', double: 'two-seater blokart' },
  };
  return (m[lang] || m.da)[type === 'double' ? 'double' : 'single'];
}

// Templates in the customer's language; fall back to Danish.
function buildMessage(kind, booking, extra = {}) {
  const lang = ['da', 'de', 'en'].includes(booking.lang) ? booking.lang : 'da';
  const { dato, tid } = pretty(booking, lang);
  const vogn = vognName(booking.type, lang);
  const tlf = config.contactPhone;
  const biz = config.businessName;
  const reason = extra.reason || '';
  const shop = booking.payment === 'shop';

  const M = {
    da: {
      confirmation: {
        subject: `Bekræftelse på din booking hos ${biz}`,
        text:
          `Hej ${booking.name}! Tak for din booking hos ${biz}.\n` +
          `Du har booket en ${vogn} ${dato} kl. ${tid}.\n` +
          (shop ? `Betaling sker i butikken når du møder op.\n` : `Betaling er modtaget. Tak!\n`) +
          `Bemærk: ved dårligt vejr kan vi være nødt til at aflyse - så kontakter vi dig på dette nummer.\n` +
          `Spørgsmål? Ring ${tlf}. Vi ses på stranden!`,
      },
      cancellation: {
        subject: `Din booking ${dato} er desværre aflyst`,
        text:
          `Hej ${booking.name}. Vi er desværre nødt til at aflyse din ${vogn} ${dato} kl. ${tid}.\n` +
          `Årsag: ${reason || 'vejret'}.\n` +
          `Vi beklager! Vil du booke en ny tid, så ring ${tlf} eller book på hjemmesiden. ` +
          (!shop ? `Et eventuelt betalt beløb refunderes.\n` : ``) +
          `Mvh ${biz}`,
      },
      reminder: {
        subject: `Påmindelse: din blokart-tur i morgen`,
        text:
          `Hej ${booking.name}! Lille påmindelse: du har en ${vogn} I MORGEN ${dato} kl. ${tid} hos ${biz}.\n` +
          `Vi ses på stranden ca. 1,5 km syd for nedkørslen til Rindby Strand.\n` +
          `Er du i tvivl om vejret, så ring ${tlf}.`,
      },
    },
    de: {
      confirmation: {
        subject: `Bestätigung deiner Buchung bei ${biz}`,
        text:
          `Hallo ${booking.name}! Danke für deine Buchung bei ${biz}.\n` +
          `Du hast einen ${vogn} am ${dato} um ${tid} Uhr gebucht.\n` +
          (shop ? `Die Zahlung erfolgt im Laden bei Ankunft.\n` : `Zahlung erhalten. Danke!\n`) +
          `Hinweis: bei schlechtem Wetter müssen wir evtl. absagen - dann kontaktieren wir dich unter dieser Nummer.\n` +
          `Fragen? Ruf ${tlf} an. Wir sehen uns am Strand!`,
      },
      cancellation: {
        subject: `Deine Buchung am ${dato} wurde leider abgesagt`,
        text:
          `Hallo ${booking.name}. Wir müssen deinen ${vogn} am ${dato} um ${tid} Uhr leider absagen.\n` +
          `Grund: ${reason || 'das Wetter'}.\n` +
          `Es tut uns leid! Für einen neuen Termin ruf ${tlf} an oder buche online. ` +
          (!shop ? `Ein eventuell gezahlter Betrag wird erstattet.\n` : ``) +
          `Viele Grüße, ${biz}`,
      },
      reminder: {
        subject: `Erinnerung: deine Blokart-Tour morgen`,
        text:
          `Hallo ${booking.name}! Kleine Erinnerung: du hast morgen einen ${vogn} am ${dato} um ${tid} Uhr bei ${biz}.\n` +
          `Wir sehen uns am Strand, ca. 1,5 km südlich der Auffahrt zum Rindby Strand.\n` +
          `Bei Unsicherheit wegen des Wetters ruf ${tlf} an.`,
      },
    },
    en: {
      confirmation: {
        subject: `Confirmation of your booking at ${biz}`,
        text:
          `Hi ${booking.name}! Thanks for booking with ${biz}.\n` +
          `You've booked a ${vogn} on ${dato} at ${tid}.\n` +
          (shop ? `Payment is made in the shop when you arrive.\n` : `Payment received. Thank you!\n`) +
          `Note: in bad weather we may have to cancel - then we'll contact you on this number.\n` +
          `Questions? Call ${tlf}. See you on the beach!`,
      },
      cancellation: {
        subject: `Your booking on ${dato} has unfortunately been cancelled`,
        text:
          `Hi ${booking.name}. We're sorry, but we have to cancel your ${vogn} on ${dato} at ${tid}.\n` +
          `Reason: ${reason || 'the weather'}.\n` +
          `We apologise! To book a new time, call ${tlf} or book online. ` +
          (!shop ? `Any amount paid will be refunded.\n` : ``) +
          `Best regards, ${biz}`,
      },
      reminder: {
        subject: `Reminder: your blokart trip tomorrow`,
        text:
          `Hi ${booking.name}! A little reminder: you have a ${vogn} TOMORROW ${dato} at ${tid} with ${biz}.\n` +
          `We'll see you on the beach, about 1.5 km south of the descent to Rindby Strand.\n` +
          `If in doubt about the weather, call ${tlf}.`,
      },
    },
  };

  const pack = (M[lang] || M.da)[kind];
  if (!pack) throw new Error('Ukendt beskedtype: ' + kind);
  return pack;
}

// MSISDN = country code + digits. Bare 8-digit Danish numbers get +45; others
// are trusted as given.
function toMsisdn(phone) {
  const digits = phone.replace(/[^0-9]/g, '');
  if (digits.startsWith('45') && digits.length === 10) return Number(digits);
  if (digits.length === 8) return Number('45' + digits);
  return Number(digits);
}

async function sendSms(phone, text) {
  if (!config.notifications.smsEnabled) return { skipped: true };

  if (config.notifications.smsMock) {
    console.log(`\n[SMS · MOCK]  til ${phone}\n  "${text.replace(/\n/g, '\n   ')}"\n`);
    return { mock: true, ok: true };
  }

  // Newer GatewayAPI accounts are on .eu, older on .com; override via GATEWAYAPI_BASE.
  const base = process.env.GATEWAYAPI_BASE || 'https://gatewayapi.com';
  try {
    const res = await fetch(`${base}/rest/mtsms`, {
      method: 'POST',
      headers: {
        // GatewayAPI HTTP Basic: token as username, empty password.
        Authorization: 'Basic ' + Buffer.from(config.notifications.smsToken + ':').toString('base64'),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sender: config.notifications.smsSender,
        message: text,
        recipients: [{ msisdn: toMsisdn(phone) }],
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error(`[SMS · FEJL ${res.status}] til ${phone}:`, JSON.stringify(data));
      return { ok: false, status: res.status, error: data };
    }
    console.log(`[SMS · SENDT] til ${phone} (ids: ${JSON.stringify(data.ids || data)})`);
    return { ok: true, ids: data.ids };
  } catch (e) {
    // A failed SMS must never break a booking.
    console.error(`[SMS · UNDTAGELSE] til ${phone}:`, e.message);
    return { ok: false, error: e.message };
  }
}

// --- E-mail ----------------------------------------------------------------
async function sendEmail(to, subject, text) {
  if (!config.notifications.emailEnabled) return { skipped: true };
  if (!to) return { skipped: true, reason: 'ingen e-mail oplyst' };

  if (config.notifications.emailMock) {
    console.log(`\n[E-MAIL · MOCK]  til ${to}\n  Emne: ${subject}\n  "${text.replace(/\n/g, '\n   ')}"\n`);
    return { mock: true, ok: true };
  }

  // Real send (nodemailer + SMTP):
  // const nodemailer = require('nodemailer');
  // const transport = nodemailer.createTransport({
  //   host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587),
  //   auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  // });
  // await transport.sendMail({ from: config.notifications.emailFrom, to, subject, text });
  // return { ok: true };
  return { ok: false, error: 'E-mail ikke konfigureret' };
}

// Always SMS, plus email if an address exists. Channels isolated so one
// failing can't skip the other.
async function notifyCustomer(kind, booking, extra = {}) {
  const { subject, text } = buildMessage(kind, booking, extra);
  const results = {};
  try { results.sms = await sendSms(booking.phone, text); }
  catch (e) { results.sms = { ok: false, error: e.message }; }
  try { results.email = await sendEmail(booking.email, subject, text); }
  catch (e) { results.email = { ok: false, error: e.message }; }
  return results;
}

// Group order: one message covering several carts.
function cartsPhrase(singleQty, doubleQty, lang) {
  const L = {
    da: { single: 'single', double: 'dobbeltsæde', and: 'og', unit: 'blokart' },
    de: { single: 'Single', double: 'Doppelsitz', and: 'und', unit: 'Blokart' },
    en: { single: 'single', double: 'two-seater', and: 'and', unit: 'blokart' },
  }[lang] || { single: 'single', double: 'dobbeltsæde', and: 'og', unit: 'blokart' };
  const parts = [];
  if (singleQty > 0) parts.push(`${singleQty} ${L.single}`);
  if (doubleQty > 0) parts.push(`${doubleQty} ${L.double}`);
  const joined = parts.join(` ${L.and} `);
  const total = singleQty + doubleQty;
  return `${joined} ${L.unit}${total > 1 ? 's' : ''}`;
}

function buildOrderMessage(kind, order, extra = {}) {
  const lang = ['da', 'de', 'en'].includes(order.lang) ? order.lang : 'da';
  const { dato, tid } = pretty(order, lang);
  const carts = cartsPhrase(order.singleQty, order.doubleQty, lang);
  const tlf = config.contactPhone;
  const biz = config.businessName;
  const reason = extra.reason || '';
  const shop = order.payment === 'shop';

  const M = {
    da: {
      confirmation: {
        subject: `Bekræftelse på din booking hos ${biz}`,
        text:
          `Hej ${order.name}! Tak for din booking hos ${biz}.\n` +
          `Du har booket ${carts} ${dato} kl. ${tid}.\n` +
          (shop ? `Betaling sker i butikken når I møder op.\n` : `Betaling er modtaget. Tak!\n`) +
          `Bemærk: ved dårligt vejr kan vi være nødt til at aflyse - så kontakter vi dig på dette nummer.\n` +
          `Spørgsmål? Ring ${tlf}. Vi ses på stranden!`,
      },
      cancellation: {
        subject: `Din booking ${dato} er desværre aflyst`,
        text:
          `Hej ${order.name}. Vi er desværre nødt til at aflyse jeres booking (${carts}) ${dato} kl. ${tid}.\n` +
          `Årsag: ${reason || 'vejret'}.\n` +
          `Vi beklager! Vil I booke en ny tid, så ring ${tlf} eller book på hjemmesiden. ` +
          (!shop ? `Et eventuelt betalt beløb refunderes.\n` : ``) +
          `Mvh ${biz}`,
      },
      reminder: {
        subject: `Påmindelse: jeres blokart-tur i morgen`,
        text:
          `Hej ${order.name}! Lille påmindelse: I har booket ${carts} I MORGEN ${dato} kl. ${tid} hos ${biz}.\n` +
          `Vi ses på stranden ca. 1,5 km syd for nedkørslen til Rindby Strand.\n` +
          `Er I i tvivl om vejret, så ring ${tlf}.`,
      },
    },
    de: {
      confirmation: {
        subject: `Bestätigung deiner Buchung bei ${biz}`,
        text:
          `Hallo ${order.name}! Danke für deine Buchung bei ${biz}.\n` +
          `Du hast ${carts} am ${dato} um ${tid} Uhr gebucht.\n` +
          (shop ? `Die Zahlung erfolgt im Laden bei Ankunft.\n` : `Zahlung erhalten. Danke!\n`) +
          `Hinweis: bei schlechtem Wetter müssen wir evtl. absagen - dann kontaktieren wir dich unter dieser Nummer.\n` +
          `Fragen? Ruf ${tlf} an. Wir sehen uns am Strand!`,
      },
      cancellation: {
        subject: `Deine Buchung am ${dato} wurde leider abgesagt`,
        text:
          `Hallo ${order.name}. Wir müssen eure Buchung (${carts}) am ${dato} um ${tid} Uhr leider absagen.\n` +
          `Grund: ${reason || 'das Wetter'}.\n` +
          `Es tut uns leid! Für einen neuen Termin ruf ${tlf} an oder buche online. ` +
          (!shop ? `Ein eventuell gezahlter Betrag wird erstattet.\n` : ``) +
          `Viele Grüße, ${biz}`,
      },
      reminder: {
        subject: `Erinnerung: eure Blokart-Tour morgen`,
        text:
          `Hallo ${order.name}! Kleine Erinnerung: ihr habt ${carts} morgen am ${dato} um ${tid} Uhr bei ${biz} gebucht.\n` +
          `Wir sehen uns am Strand, ca. 1,5 km südlich der Auffahrt zum Rindby Strand.\n` +
          `Bei Unsicherheit wegen des Wetters ruf ${tlf} an.`,
      },
    },
    en: {
      confirmation: {
        subject: `Confirmation of your booking at ${biz}`,
        text:
          `Hi ${order.name}! Thanks for booking with ${biz}.\n` +
          `You've booked ${carts} on ${dato} at ${tid}.\n` +
          (shop ? `Payment is made in the shop when you arrive.\n` : `Payment received. Thank you!\n`) +
          `Note: in bad weather we may have to cancel - then we'll contact you on this number.\n` +
          `Questions? Call ${tlf}. See you on the beach!`,
      },
      cancellation: {
        subject: `Your booking on ${dato} has unfortunately been cancelled`,
        text:
          `Hi ${order.name}. We're sorry, but we have to cancel your booking (${carts}) on ${dato} at ${tid}.\n` +
          `Reason: ${reason || 'the weather'}.\n` +
          `We apologise! To book a new time, call ${tlf} or book online. ` +
          (!shop ? `Any amount paid will be refunded.\n` : ``) +
          `Best regards, ${biz}`,
      },
      reminder: {
        subject: `Reminder: your blokart trip tomorrow`,
        text:
          `Hi ${order.name}! A little reminder: you've booked ${carts} TOMORROW ${dato} at ${tid} with ${biz}.\n` +
          `We'll see you on the beach, about 1.5 km south of the descent to Rindby Strand.\n` +
          `If in doubt about the weather, call ${tlf}.`,
      },
    },
  };

  const pack = (M[lang] || M.da)[kind];
  if (!pack) throw new Error('Ukendt beskedtype: ' + kind);
  return pack;
}

// Same as notifyCustomer, but one message for a whole group order.
async function notifyOrderCustomer(kind, order, extra = {}) {
  const { subject, text } = buildOrderMessage(kind, order, extra);
  const results = {};
  try { results.sms = await sendSms(order.phone, text); }
  catch (e) { results.sms = { ok: false, error: e.message }; }
  try { results.email = await sendEmail(order.email, subject, text); }
  catch (e) { results.email = { ok: false, error: e.message }; }
  return results;
}

module.exports = { notifyCustomer, buildMessage, notifyOrderCustomer, buildOrderMessage };
