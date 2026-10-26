// Tests für calc.js – ausführen mit: node calc.test.js
'use strict';

const assert = require('node:assert/strict');
const C = require('./calc.js');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ✓ ' + name);
  } catch (err) {
    failed++;
    console.log('  ✗ ' + name);
    console.log('    ' + String(err.message).split('\n').join('\n    '));
  }
}

function near(actual, expected, tol, msg) {
  assert.ok(
    Math.abs(actual - expected) <= tol,
    (msg || '') + ` erwartet ≈ ${expected} (±${tol}), erhalten ${actual}`
  );
}

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
// Fester Bezugszeitpunkt: 26.10.2026, 20:00 Lokalzeit
const BASE = new Date(2026, 9, 26, 20, 0, 0, 0).getTime();

const mann = { sex: 'mann', age: 25, height: 180, weight: 75, stomach: 'etwas', rate: 0.15 };

console.log('calc.js');

test('Gramm Alkohol: 30 cl Bier 5 % ≈ 11,8 g', () => {
  near(C.gramsAlcohol(30, 5), 11.835, 0.001);
});

test('Gramm Alkohol: Komma als Dezimaltrenner, ungültige Werte = 0', () => {
  near(C.gramsAlcohol('10', '12,5'), 9.8625, 0.001);
  assert.equal(C.gramsAlcohol('', 5), 0);
  assert.equal(C.gramsAlcohol(-2, 40), 0);
});

test('Körperwasser nach Watson (Mann und Frau)', () => {
  near(C.bodyWater(mann), 44.615, 0.01);
  near(C.bodyWater({ sex: 'frau', age: 25, height: 165, weight: 60 }), 30.329, 0.01);
});

test('Fall aus der Vorgabe: Mann, 2 × Bier + 4 cl Schnaps → Höchstwert im erwarteten Bereich', () => {
  const drinks = [
    { grams: C.gramsAlcohol(30, 5), time: BASE },
    { grams: C.gramsAlcohol(30, 5), time: BASE },
    { grams: C.gramsAlcohol(4, 40), time: BASE },
  ];
  const sim = C.simulate(mann, drinks);
  // Theoretisches Maximum ohne Abbau: 36,3 g × 0,85 × 0,0170 ‰/g ≈ 0,52 ‰.
  // Während der 60 min Aufnahme werden 0,15 ‰ abgebaut → Spitze ≈ 0,37 ‰.
  // Darum Toleranz nach unten bis 0,35 (siehe README).
  assert.ok(sim.peak >= 0.35 && sim.peak <= 0.6, `Höchstwert ${sim.peak.toFixed(3)} nicht in 0,35–0,6`);
  near(sim.peak, 0.374, 0.01, 'Höchstwert');
  assert.equal(sim.peakTime, BASE + 60 * MIN);
});

test('Gleiche Getränke über den Abend verteilt → tieferer Höchstwert', () => {
  const together = C.simulate(mann, [
    { grams: 20, time: BASE }, { grams: 20, time: BASE },
  ]);
  const spread = C.simulate(mann, [
    { grams: 20, time: BASE }, { grams: 20, time: BASE + 2 * HOUR },
  ]);
  assert.ok(spread.peak < together.peak);
});

test('Keine Getränke → Wert 0, keine Uhrzeiten', () => {
  const sim = C.simulate(mann, []);
  assert.equal(sim.peak, 0);
  assert.equal(sim.peakTime, null);
  assert.equal(sim.points.length, 0);
  assert.deepEqual(sim.times, { under05: null, under01: null, zero: null });
  assert.equal(C.valueAt(sim, BASE), 0);
});

test('Höhere Abbaurate → früher nüchtern', () => {
  const drinks = [{ grams: 40, time: BASE }];
  const slow = C.simulate({ ...mann, rate: 0.10 }, drinks);
  const fast = C.simulate({ ...mann, rate: 0.20 }, drinks);
  assert.ok(slow.times.zero && fast.times.zero);
  assert.ok(fast.times.zero < slow.times.zero, 'Abbau 0,20 muss vor 0,10 auf 0 sein');
  assert.ok(fast.times.under01 < slow.times.under01);
});

test('Reihenfolge der Schwellen: unter 0,5 vor unter 0,1 vor 0,0', () => {
  const sim = C.simulate(mann, [{ grams: 60, time: BASE }]);
  assert.ok(sim.peak > 0.5);
  assert.ok(sim.times.under05 < sim.times.under01);
  assert.ok(sim.times.under01 <= sim.times.zero);
  assert.equal(C.valueAt(sim, sim.times.zero + MIN), 0);
});

test('Schwelle nie erreicht → keine Uhrzeit dafür', () => {
  const sim = C.simulate(mann, [{ grams: 20, time: BASE }]);
  assert.ok(sim.peak < 0.5);
  assert.equal(sim.times.under05, null);
  assert.ok(sim.times.zero !== null);
});

test('Simulation endet erst, wenn alles aufgenommen ist (Pause zwischen Getränken)', () => {
  const sim = C.simulate(mann, [
    { grams: 5, time: BASE },
    { grams: 30, time: BASE + 5 * HOUR },
  ]);
  assert.ok(sim.end > BASE + 5 * HOUR);
  assert.ok(sim.times.zero > BASE + 5 * HOUR);
});

test('Voller Magen → tieferer Höchstwert als leerer Magen', () => {
  const drinks = [{ grams: 30, time: BASE }];
  const empty = C.simulate({ ...mann, stomach: 'leer' }, drinks);
  const full = C.simulate({ ...mann, stomach: 'mahlzeit' }, drinks);
  assert.ok(full.peak < empty.peak);
});

test('Uhrzeit > 30 min in der Zukunft gilt als gestern', () => {
  const now = new Date(2026, 9, 27, 0, 30).getTime(); // 00:30
  const t = C.resolveDrinkTime('23:45', now);
  assert.equal(t, new Date(2026, 9, 26, 23, 45).getTime());
  const soon = C.resolveDrinkTime('00:50', now); // nur 20 min in der Zukunft
  assert.equal(soon, new Date(2026, 9, 27, 0, 50).getTime());
  assert.equal(C.resolveDrinkTime('abc', now), null);
  assert.equal(C.resolveDrinkTime('25:00', now), null);
});

test('valueAt interpoliert und ist ausserhalb 0', () => {
  const sim = C.simulate(mann, [{ grams: 30, time: BASE }]);
  assert.equal(C.valueAt(sim, BASE - HOUR), 0);
  near(C.valueAt(sim, sim.peakTime), sim.peak, 1e-9);
  assert.equal(C.valueAt(sim, sim.end + HOUR), 0);
});

test('Status-Texte', () => {
  assert.equal(C.statusFor(0.8).label, 'nicht fahren');
  assert.equal(C.statusFor(0.5).label, 'nicht fahren');
  assert.equal(C.statusFor(0.3).label, 'Neulenker nicht fahren');
  assert.equal(C.statusFor(0.05).label, 'fast nüchtern');
  assert.equal(C.statusFor(0).label, 'nüchtern');
});

test('Formatierung', () => {
  assert.equal(C.formatPermille(0.456), '0,46');
  assert.equal(C.formatDuration(135 * MIN), '2 h 15 min');
  assert.equal(C.formatDuration(45 * MIN), '45 min');
  assert.equal(C.formatDuration(3 * HOUR), '3 h');
  assert.equal(C.formatClock(new Date(2026, 0, 1, 7, 5).getTime()), '07:05');
  assert.equal(C.dayOffset(BASE + 6 * HOUR, BASE), 1);
});

test('Körperdaten prüfen', () => {
  assert.deepEqual(C.validatePerson(mann), []);
  assert.ok(C.validatePerson({ ...mann, weight: '' }).length > 0);
});

console.log(`\n${passed} bestanden, ${failed} fehlgeschlagen`);
if (failed > 0) process.exitCode = 1;
