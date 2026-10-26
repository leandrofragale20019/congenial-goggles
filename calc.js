/*
 * Promille-Uhr – Berechnungslogik
 * Reine Funktionen ohne DOM. Läuft im Browser (window.PromilleCalc)
 * und in Node (module.exports).
 */
(function (root) {
  'use strict';

  const ETHANOL_DENSITY = 0.789; // g pro ml
  const STEP_MIN = 5;
  const STEP_MS = STEP_MIN * 60 * 1000;
  const MAX_STEPS = (4 * 24 * 60) / STEP_MIN; // Sicherheitsgrenze: 4 Tage
  const FUTURE_TOLERANCE_MS = 30 * 60 * 1000;
  const EPSILON = 1e-9;

  const STOMACH = {
    leer: { deficit: 0.10, absorbMin: 30, label: 'leer' },
    etwas: { deficit: 0.15, absorbMin: 60, label: 'etwas gegessen' },
    mahlzeit: { deficit: 0.25, absorbMin: 90, label: 'richtige Mahlzeit' },
  };

  const RATES = [0.10, 0.15, 0.20];
  const DEFAULT_RATE = 0.15;

  const LIMITS = { driving: 0.5, novice: 0.1 };

  /** Zahl aus Eingabe lesen, Komma oder Punkt als Dezimaltrenner. */
  function parseNumber(value) {
    if (typeof value === 'number') return value;
    if (value === null || value === undefined) return NaN;
    const s = String(value).trim().replace(',', '.');
    if (s === '') return NaN;
    return Number(s);
  }

  /** Gramm reiner Alkohol = cl × 10 × (Vol-% / 100) × 0,789 */
  function gramsAlcohol(cl, vol) {
    const c = parseNumber(cl);
    const v = parseNumber(vol);
    if (!(c > 0) || !(v > 0)) return 0;
    return c * 10 * (v / 100) * ETHANOL_DENSITY;
  }

  /** Körperwasser nach Watson in Litern. */
  function bodyWater(person) {
    const age = parseNumber(person.age);
    const weight = parseNumber(person.weight);
    const height = parseNumber(person.height);
    if (person.sex === 'frau') {
      return -2.097 + 0.1069 * height + 0.2466 * weight;
    }
    return 2.447 - 0.09516 * age + 0.1074 * height + 0.3362 * weight;
  }

  /** ‰ pro Gramm Alkohol = 0,8 / (1,055 × Körperwasser) */
  function permillePerGram(water) {
    return 0.8 / (1.055 * water);
  }

  /** Prüft die Körperdaten. Liefert eine Liste von Fehlermeldungen (leer = gültig). */
  function validatePerson(person) {
    const errors = [];
    const age = parseNumber(person.age);
    const weight = parseNumber(person.weight);
    const height = parseNumber(person.height);
    if (!(age >= 10 && age <= 120)) errors.push('Alter zwischen 10 und 120 Jahren eingeben.');
    if (!(weight >= 30 && weight <= 300)) errors.push('Gewicht zwischen 30 und 300 kg eingeben.');
    if (!(height >= 100 && height <= 250)) errors.push('Grösse zwischen 100 und 250 cm eingeben.');
    if (errors.length === 0 && !(bodyWater(person) > 0)) {
      errors.push('Mit diesen Körperdaten ist keine Berechnung möglich.');
    }
    return errors;
  }

  /**
   * Uhrzeit "HH:MM" in einen Zeitstempel umwandeln, bezogen auf "now".
   * Liegt sie mehr als 30 Minuten in der Zukunft, gilt sie als gestern.
   */
  function resolveDrinkTime(hhmm, now) {
    const m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm || '').trim());
    if (!m) return null;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h > 23 || min > 59) return null;
    const d = new Date(now);
    d.setHours(h, min, 0, 0);
    if (d.getTime() - now > FUTURE_TOLERANCE_MS) {
      d.setDate(d.getDate() - 1);
    }
    return d.getTime();
  }

  function emptyResult() {
    return {
      points: [],
      start: null,
      end: null,
      peak: 0,
      peakTime: null,
      totalGrams: 0,
      times: { under05: null, under01: null, zero: null },
    };
  }

  /**
   * Letzter Zeitpunkt, an dem der Wert unter die Schwelle fällt (linear interpoliert).
   * Für threshold = 0 zählt das Erreichen von genau 0.
   */
  function lastCrossing(points, threshold) {
    for (let i = points.length - 1; i > 0; i--) {
      const a = points[i - 1];
      const b = points[i];
      const crosses = threshold === 0
        ? a.v > 0 && b.v <= 0
        : a.v >= threshold && b.v < threshold;
      if (crosses) {
        const frac = a.v === b.v ? 1 : (a.v - threshold) / (a.v - b.v);
        return Math.round(a.t + frac * (b.t - a.t));
      }
    }
    return null;
  }

  /**
   * Simulation in 5-Minuten-Schritten ab dem ersten Getränk.
   * @param {object} person  { sex, age, weight, height, stomach, rate }
   * @param {Array}  drinks  [{ grams, time }]  time = Zeitstempel in ms
   */
  function simulate(person, drinks) {
    const valid = (drinks || []).filter(
      (d) => d && d.grams > 0 && Number.isFinite(d.time)
    );
    if (valid.length === 0) return emptyResult();

    const stomach = STOMACH[person.stomach] || STOMACH.etwas;
    const rate = parseNumber(person.rate) > 0 ? parseNumber(person.rate) : DEFAULT_RATE;
    const water = bodyWater(person);
    if (!(water > 0)) return emptyResult();
    const ppg = permillePerGram(water);

    const absorbMs = stomach.absorbMin * 60 * 1000;
    const items = valid.map((d) => ({
      start: d.time,
      end: d.time + absorbMs,
      permille: d.grams * (1 - stomach.deficit) * ppg,
    }));

    const start = Math.min.apply(null, items.map((it) => it.start));
    const absorbedEnd = Math.max.apply(null, items.map((it) => it.end));
    const elimPerStep = rate / (60 / STEP_MIN);

    const points = [{ t: start, v: 0 }];
    let v = 0;
    let peak = 0;
    let peakTime = start;

    for (let i = 0; i < MAX_STEPS; i++) {
      const t0 = start + i * STEP_MS;
      const t1 = t0 + STEP_MS;
      let added = 0;
      for (const it of items) {
        const overlap = Math.min(t1, it.end) - Math.max(t0, it.start);
        if (overlap > 0) added += it.permille * (overlap / absorbMs);
      }
      v = v + added - elimPerStep;
      if (v < EPSILON) v = 0;
      points.push({ t: t1, v });
      if (v > peak) {
        peak = v;
        peakTime = t1;
      }
      if (t1 >= absorbedEnd && v === 0) break;
    }

    return {
      points,
      start,
      end: points[points.length - 1].t,
      peak,
      peakTime: peak > 0 ? peakTime : null,
      totalGrams: valid.reduce((sum, d) => sum + d.grams, 0),
      times: {
        under05: lastCrossing(points, LIMITS.driving),
        under01: lastCrossing(points, LIMITS.novice),
        zero: lastCrossing(points, 0),
      },
    };
  }

  /** Wert zum Zeitpunkt t (linear zwischen den Simulationspunkten). */
  function valueAt(sim, t) {
    const pts = sim && sim.points;
    if (!pts || pts.length === 0) return 0;
    if (t <= pts[0].t || t >= pts[pts.length - 1].t) return 0;
    let lo = 0;
    let hi = pts.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (pts[mid].t <= t) lo = mid; else hi = mid;
    }
    const a = pts[lo];
    const b = pts[hi];
    return a.v + ((t - a.t) / (b.t - a.t)) * (b.v - a.v);
  }

  /** Status-Text je nach Wert. */
  function statusFor(v) {
    if (v >= LIMITS.driving) return { key: 'danger', label: 'nicht fahren' };
    if (v >= LIMITS.novice) return { key: 'warn', label: 'Neulenker nicht fahren' };
    if (v > 0) return { key: 'low', label: 'fast nüchtern' };
    return { key: 'ok', label: 'nüchtern' };
  }

  function formatNumber(value, decimals) {
    return Number(value).toFixed(decimals).replace('.', ',');
  }

  function formatPermille(v) {
    return formatNumber(Math.max(0, v), 2);
  }

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  /** "HH:MM" in lokaler Zeit. */
  function formatClock(t) {
    const d = new Date(t);
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  /** Tagesabstand zwischen t und now (−1 = gestern, 0 = heute, 1 = morgen). */
  function dayOffset(t, now) {
    const a = new Date(t);
    const b = new Date(now);
    a.setHours(12, 0, 0, 0);
    b.setHours(12, 0, 0, 0);
    return Math.round((a.getTime() - b.getTime()) / 86400000);
  }

  /** Dauer als "2 h 15 min", "45 min", "3 h". Aufgerundet auf volle Minuten. */
  function formatDuration(ms) {
    const mins = Math.max(0, Math.ceil(ms / 60000));
    if (mins < 60) return mins + ' min';
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m ? h + ' h ' + m + ' min' : h + ' h';
  }

  const api = {
    ETHANOL_DENSITY,
    STEP_MIN,
    STOMACH,
    RATES,
    DEFAULT_RATE,
    LIMITS,
    parseNumber,
    gramsAlcohol,
    bodyWater,
    permillePerGram,
    validatePerson,
    resolveDrinkTime,
    simulate,
    lastCrossing,
    valueAt,
    statusFor,
    formatNumber,
    formatPermille,
    formatClock,
    dayOffset,
    formatDuration,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.PromilleCalc = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
