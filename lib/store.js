// Persistence: bookings + closures in one JSON file, so the prototype needs no
// database. Production should swap this module for a real DB. See README.

const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', 'data.json');

// Missing/corrupt file falls back to an empty DB rather than crashing.
function readAll() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {
    return { bookings: [], closures: [], nextId: 1 };
  }
}

// Synchronous write serializes saves so concurrent bookings don't clobber.
function writeAll(db) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2), 'utf8');
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
