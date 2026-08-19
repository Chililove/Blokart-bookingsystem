// Regression guard for fleet-allocation math.
const { calcAvailability } = require('./lib/availability');
const fleet = { totalSingle: 10, convertibleDouble: 2, permanentDouble: 1 };

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = got === want;
  console.log(`${ok ? '✔' : '✗ FEJL'}  ${name}: fik ${got}, forventet ${want}`);
  ok ? pass++ : fail++;
}

const S = 0, E = 3600000; // shared 1-hour slot
const b = (type) => ({ type, start: S, end: E });

// Baseline
let a = calcAvailability([], S, E, fleet);
check('Tom: single fri', a.singleAvailable, 10);
check('Tom: dobbelt fri', a.doubleAvailable, 3);

// 2 doubles: permanent + one converted single -> 9 singles left
a = calcAvailability([b('double'), b('double')], S, E, fleet);
check('2 dobbelt: single fri (dit eksempel = 9)', a.singleAvailable, 9);
check('2 dobbelt: dobbelt fri', a.doubleAvailable, 1);
check('2 dobbelt: permanent brugt', a.permanentUsed, 1);
check('2 dobbelt: konverterbar brugt', a.convertibleUsed, 1);

// Lone double uses permanent, no single consumed
a = calcAvailability([b('double')], S, E, fleet);
check('1 dobbelt: single fri (uændret 10)', a.singleAvailable, 10);
check('1 dobbelt: dobbelt fri', a.doubleAvailable, 2);

// Max doubles: both convertibles used, singles drop to 8
a = calcAvailability([b('double'), b('double'), b('double')], S, E, fleet);
check('3 dobbelt: single fri', a.singleAvailable, 8);
check('3 dobbelt: dobbelt fri', a.doubleAvailable, 0);
check('3 dobbelt: kan IKKE booke dobbelt', a.canBookDouble, false);

// All singles booked, permanent double still bookable
a = calcAvailability(Array(10).fill(0).map(()=>b('single')), S, E, fleet);
check('10 single: single fri', a.singleAvailable, 0);
check('10 single: kan stadig booke 1 dobbelt (permanent)', a.canBookDouble, true);

// Convertibles unusable once every single is taken
a = calcAvailability([...Array(10).fill(0).map(()=>b('single')), b('double')], S, E, fleet);
check('10 single + 1 dobbelt: dobbelt fri (2 konverterbare, men 0 single)', a.doubleAvailable, 2);
check('10 single + 1 dobbelt: single fri', a.singleAvailable, 0);

// Non-overlapping bookings ignored
a = calcAvailability([{ type:'single', start: E+1, end: E+E }], S, E, fleet);
check('Ingen overlap: single fri', a.singleAvailable, 10);

console.log(`\n${fail === 0 ? '✅ ALLE TEST BESTÅET' : '❌ ' + fail + ' FEJL'} (${pass} ok, ${fail} fejl)`);
process.exit(fail === 0 ? 0 : 1);
