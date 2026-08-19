// Two-way sync with the shared staff calendar. Falls back to MOCK unless
// GOOGLE_CALENDAR_ID + GOOGLE_KEY_FILE are set. See GOOGLE-CALENDAR-SETUP.md.

const config = require('../config');

// Tags our own events so pullFromCalendar skips them (no double-counting).
const MARKER_KEY = 'blokartBookingId';

let _calendar = null;
function getCalendar() {
  if (_calendar) return _calendar;
  // Lazy require so the demo runs without googleapis installed.
  const { google } = require('googleapis');
  const auth = new google.auth.GoogleAuth({
    keyFile: process.env.GOOGLE_KEY_FILE,
    scopes: ['https://www.googleapis.com/auth/calendar'],
  });
  _calendar = google.calendar({ version: 'v3', auth });
  return _calendar;
}

function eventTitle(booking) {
  const typeTxt = booking.type === 'double' ? 'Dobbelt' : 'Single';
  return `${typeTxt} blokart - ${booking.name}`;
}

async function pushToCalendar(booking) {
  if (config.googleCalendar.mock) {
    const eventId = 'mock_evt_' + booking.id;
    console.log(
      `[Google Kalender · MOCK] Ville oprette begivenhed: ${eventTitle(booking)} · ` +
        `${booking.phone} · ${new Date(booking.start).toLocaleString('da-DK')}`
    );
    return { eventId, mock: true };
  }

  const calendar = getCalendar();
  const res = await calendar.events.insert({
    calendarId: config.googleCalendar.calendarId,
    requestBody: {
      summary: eventTitle(booking),
      description:
        `Tlf: ${booking.phone}\n` +
        `Betaling: ${booking.payment}\n` +
        `Sprog: ${booking.lang || 'da'}\n` +
        `Booking-id: ${booking.id}`,
      start: { dateTime: new Date(booking.start).toISOString() },
      end: { dateTime: new Date(booking.end).toISOString() },
      extendedProperties: { private: { [MARKER_KEY]: String(booking.id) } },
    },
  });
  return { eventId: res.data.id, mock: false };
}

async function removeFromCalendar(eventId) {
  if (config.googleCalendar.mock) {
    console.log(`[Google Kalender · MOCK] Ville slette begivenhed: ${eventId}`);
    return true;
  }
  if (!eventId) return true;
  try {
    await getCalendar().events.delete({
      calendarId: config.googleCalendar.calendarId,
      eventId,
    });
  } catch (e) {
    // Already gone / never existed -> nothing to undo.
    console.warn('[Google Kalender] Kunne ikke slette begivenhed:', e.message);
  }
  return true;
}

// Reads staff-added events so they count against the fleet too. Our own events
// are skipped (data.json already counts them). Returns our booking shape.
async function pullFromCalendar(fromMs, toMs) {
  if (config.googleCalendar.mock) {
    return []; // No external calendar in mock.
  }

  const calendar = getCalendar();
  const res = await calendar.events.list({
    calendarId: config.googleCalendar.calendarId,
    timeMin: new Date(fromMs).toISOString(),
    timeMax: new Date(toMs).toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
  });

  return (res.data.items || [])
    // Only timed slots occupy a cart; skip all-day events.
    .filter((ev) => ev.start && ev.start.dateTime && ev.end && ev.end.dateTime)
    // Skip our own events to avoid double-counting.
    .filter((ev) => !(ev.extendedProperties && ev.extendedProperties.private && ev.extendedProperties.private[MARKER_KEY]))
    .map((ev) => {
      const s = (ev.summary || '').toLowerCase();
      const isDouble = s.includes('dobbelt') || s.includes('double') || s.includes('doppel');
      return {
        source: 'google',
        type: isDouble ? 'double' : 'single',
        start: new Date(ev.start.dateTime).getTime(),
        end: new Date(ev.end.dateTime).getTime(),
        name: ev.summary || 'Butiksbooking',
      };
    });
}

module.exports = { pushToCalendar, removeFromCalendar, pullFromCalendar };
