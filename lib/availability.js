// Fleet accounting - the single overbooking guard, shared by public + staff.
// Allocate doubles from the permanent one first (free of single capacity),
// then convertibles (each eats one single), to maximize single availability.

// Edge-touching windows (10-11, 11-12) are NOT an overlap, so trips share a cart.
function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

// Compute usage and availability for one window. start/end accept ms or ISO.
function calcAvailability(bookings, start, end, fleet) {
  const startMs = typeof start === 'number' ? start : new Date(start).getTime();
  const endMs = typeof end === 'number' ? end : new Date(end).getTime();

  // Only bookings overlapping this window compete for capacity.
  let singleBooked = 0;
  let doubleBooked = 0;
  for (const b of bookings) {
    const bStart = typeof b.start === 'number' ? b.start : new Date(b.start).getTime();
    const bEnd = typeof b.end === 'number' ? b.end : new Date(b.end).getTime();
    if (!overlaps(startMs, endMs, bStart, bEnd)) continue;
    if (b.type === 'double') doubleBooked++;
    else singleBooked++;
  }

  // Permanent-first allocation keeps single availability high.
  const permanentUsed = Math.min(doubleBooked, fleet.permanentDouble);
  const convertibleUsed = Math.min(
    Math.max(doubleBooked - fleet.permanentDouble, 0),
    fleet.convertibleDouble
  );

  // Each convertible double in use borrows one single slot.
  const singlesConsumedByDoubles = convertibleUsed;

  const singleAvailable = fleet.totalSingle - singleBooked - singlesConsumedByDoubles;

  const totalDoubleCapacity = fleet.permanentDouble + fleet.convertibleDouble;
  const doubleAvailable = totalDoubleCapacity - doubleBooked;

  return {
    singleBooked,
    doubleBooked,
    permanentUsed,
    convertibleUsed,
    singleAvailable: Math.max(singleAvailable, 0),
    doubleAvailable: Math.max(doubleAvailable, 0),
    canBookSingle: singleAvailable >= 1,
    canBookDouble: doubleAvailable >= 1,
  };
}

// Last-line guard before persisting one new booking.
function canBook(bookings, type, start, end, fleet) {
  const a = calcAvailability(bookings, start, end, fleet);
  return type === 'double' ? a.canBookDouble : a.canBookSingle;
}

// Group-order guard: singles and doubles checked together, since convertible
// doubles draw from the same 10 singles.
function canBookQuantities(bookings, addSingle, addDouble, start, end, fleet) {
  if (addSingle < 0 || addDouble < 0) return false;
  if (addSingle === 0 && addDouble === 0) return false;
  const a = calcAvailability(bookings, start, end, fleet);

  const newDouble = a.doubleBooked + addDouble;
  const newSingle = a.singleBooked + addSingle;

  // Reject if total doubles would exceed permanent + convertible capacity.
  if (newDouble > fleet.permanentDouble + fleet.convertibleDouble) return false;

  // Convertibles in use borrow single slots, so count them against singles too.
  const convertibleUsed = Math.min(
    Math.max(newDouble - fleet.permanentDouble, 0),
    fleet.convertibleDouble
  );
  if (newSingle + convertibleUsed > fleet.totalSingle) return false;

  return true;
}

module.exports = { overlaps, calcAvailability, canBook, canBookQuantities };
