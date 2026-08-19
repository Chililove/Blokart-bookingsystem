// Persistence: bookings + closures in one JSON file, so the prototype needs no
// database. Production should swap this module for a real DB. See README.

const fs = require('fs');
const path = require('path');

// Overridable so tests (and alternate deploys) can use a separate data file
// instead of clobbering the real one.
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, '..', 'data.json');

const EMPTY_DB = { bookings: [], closures: [], nextId: 1 };

// A first run has no file yet -> start empty. But an existing file that won't
// parse means real bookings could be lost if we silently overwrite it, so we
// preserve it as a .corrupt backup and shout in the log instead of eating it.
function readAll() {
  let raw;
  try {
    raw = fs.readFileSync(DATA_FILE, 'utf8');
  } catch (e) {
    return { ...EMPTY_DB };
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    const backup = `${DATA_FILE}.corrupt-${Date.now()}`;
    try { fs.writeFileSync(backup, raw); } catch (_) {}
    console.error(`[store] data.json ulæselig - sikkerhedskopi gemt: ${backup}`);
    return { ...EMPTY_DB };
  }
}

// Write to a temp file then rename over the target. rename is atomic on the
// same filesystem, so a crash mid-write can't leave a half-written data.json.
function writeAll(db) {
  const tmp = `${DATA_FILE}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
  fs.renameSync(tmp, DATA_FILE);
}

function getBookings() {
  return readAll().bookings.filter((b) => b.status !== 'cancelled');
}

function getBookingsBetween(fromMs, toMs) {
  return getBookings().filter((b) => b.end > fromMs && b.start < toMs);
}

// Active bookings sharing one group order.
function getBookingsByOrder(orderId) {
  return getBookings().filter((b) => b.orderId === orderId);
}

function addBooking(booking) {
  const db = readAll();
  booking.id = db.nextId++;
  booking.createdAt = Date.now();
  db.bookings.push(booking);
  writeAll(db);
  return booking;
}

function cancelBooking(id) {
  const db = readAll();
  const b = db.bookings.find((x) => x.id === id);
  if (b) {
    b.status = 'cancelled';
    writeAll(db);
  }
  return b;
}

// Patch individual fields, e.g. flag that a reminder was sent.
function setBookingFields(id, fields) {
  const db = readAll();
  const b = db.bookings.find((x) => x.id === id);
  if (b) {
    Object.assign(b, fields);
    writeAll(db);
  }
  return b;
}

// Closures (e.g. thunderstorm / too much wind).

function getClosures() {
  return readAll().closures;
}

function getClosureForDate(dateStr /* 'YYYY-MM-DD' */) {
  return readAll().closures.find((c) => c.date === dateStr);
}

function addClosure(dateStr, reason) {
  const db = readAll();
  // Enforce one closure per date by dropping any existing one first.
  db.closures = db.closures.filter((c) => c.date !== dateStr);
  const closure = { id: db.nextId++, date: dateStr, reason, createdAt: Date.now() };
  db.closures.push(closure);
  writeAll(db);
  return closure;
}

function removeClosure(dateStr) {
  const db = readAll();
  db.closures = db.closures.filter((c) => c.date !== dateStr);
  writeAll(db);
}

module.exports = {
  getBookings,
  getBookingsBetween,
  getBookingsByOrder,
  addBooking,
  cancelBooking,
  setBookingFields,
  getClosures,
  getClosureForDate,
  addClosure,
  removeClosure,
};
