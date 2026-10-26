/* Promille-Uhr – Oberfläche */
(function () {
  'use strict';

  const C = window.PromilleCalc;
  const STORAGE_KEY = 'promille-uhr-v1';
  const REFRESH_MS = 30 * 1000;
  const TOAST_MS = 5000;

  const PRESETS = [
    { name: 'Stange Bier', short: 'Stange', cl: 30, vol: 5 },
    { name: 'Grosses Bier', short: 'Grosses Bier', cl: 50, vol: 5 },
    { name: 'Wein', short: 'Wein', cl: 10, vol: 12.5 },
    { name: 'Prosecco', short: 'Prosecco', cl: 10, vol: 11 },
    { name: 'Shot', short: 'Shot', cl: 2, vol: 40 },
    { name: 'Longdrink', short: 'Longdrink', cl: 4, vol: 40 },
    { name: 'Cocktail', short: 'Cocktail', cl: 6, vol: 40 },
    { name: 'Alcopop', short: 'Alcopop', cl: 27.5, vol: 5 },
  ];

  const DEFAULT_PERSON = {
    sex: 'mann',
    age: '25',
    weight: '75',
    height: '178',
    stomach: 'etwas',
    rate: '0.15',
  };

  const $ = (sel, el) => (el || document).querySelector(sel);
  const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));

  /* ---------- Zustand & Speicher ---------- */

  const MAX_AGE_MS = 24 * 3600 * 1000; // Getränke verschwinden nach 24 h

  let firstVisit = false;
  let state = load();
  const listeners = [];

  function freshState() {
    return { person: { ...DEFAULT_PERSON }, drinks: [], updatedAt: 0 };
  }

  /** Daten aus Speicher oder Cloud in ein sauberes Format bringen. */
  function normalize(data) {
    const now = Date.now();
    return {
      person: { ...DEFAULT_PERSON, ...(data && data.person) },
      drinks: Array.isArray(data && data.drinks)
        ? data.drinks
          .filter((d) => d && typeof d.id === 'string')
          .map((d) => ({
            id: d.id,
            name: String(d.name || ''),
            cl: String(d.cl ?? ''),
            vol: String(d.vol ?? ''),
            time: String(d.time || ''),
            addedAt: Number.isFinite(d.addedAt) ? d.addedAt : now,
          }))
        : [],
      updatedAt: Number.isFinite(data && data.updatedAt) ? data.updatedAt : 0,
    };
  }

  function load() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        firstVisit = true;
        return freshState();
      }
      return normalize(JSON.parse(raw));
    } catch (e) {
      firstVisit = true;
      return freshState();
    }
  }

  function save() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      /* Speicher nicht verfügbar – App funktioniert trotzdem */
    }
  }

  /* ---------- Hilfen ---------- */

  function newId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function numToInput(n) {
    return String(n).replace('.', ',');
  }

  function escapeXml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function clockWithDay(t, now) {
    const off = C.dayOffset(t, now);
    const clock = C.formatClock(t);
    if (off === 1) return { clock, day: 'morgen' };
    if (off === -1) return { clock, day: 'gestern' };
    if (off > 1) return { clock, day: 'in ' + off + ' Tagen' };
    return { clock, day: '' };
  }

  function personForCalc() {
    const p = state.person;
    return {
      sex: p.sex,
      age: C.parseNumber(p.age),
      weight: C.parseNumber(p.weight),
      height: C.parseNumber(p.height),
      stomach: p.stomach,
      rate: C.parseNumber(p.rate),
    };
  }

  /* ---------- Körperdaten ---------- */

  function fillProfileForm() {
    const p = state.person;
    $('#age').value = p.age;
    $('#weight').value = p.weight;
    $('#height').value = p.height;
    setSex(p.sex);

    const stomach = $(`input[name="stomach"][value="${p.stomach}"]`) || $('input[name="stomach"][value="etwas"]');
    stomach.checked = true;
    const rate = $$('input[name="rate"]').find((r) => Number(r.value) === Number(p.rate))
      || $('input[name="rate"][value="0.15"]');
    rate.checked = true;
  }

  function initProfile() {
    fillProfileForm();

    $$('.seg-btn[data-sex]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.person.sex = btn.dataset.sex;
        setSex(btn.dataset.sex);
        changed();
      });
    });

    ['age', 'weight', 'height'].forEach((key) => {
      $('#' + key).addEventListener('input', (e) => {
        state.person[key] = e.target.value;
        changed();
      });
    });

    $$('input[name="stomach"]').forEach((r) => r.addEventListener('change', () => {
      state.person.stomach = r.value;
      changed();
    }));
    $$('input[name="rate"]').forEach((r) => r.addEventListener('change', () => {
      state.person.rate = r.value;
      changed();
    }));

    // Beim ersten Besuch die Angaben offen zeigen
    if (firstVisit) $('#profile-panel').open = true;
  }

  function setSex(sex) {
    $$('.seg-btn[data-sex]').forEach((btn) => {
      btn.setAttribute('aria-pressed', String(btn.dataset.sex === sex));
    });
  }

  function profileSummary() {
    const p = state.person;
    const stomach = (C.STOMACH[p.stomach] || C.STOMACH.etwas).label;
    return `${p.sex === 'frau' ? 'Frau' : 'Mann'} · ${p.age || '?'} J. · ${p.weight || '?'} kg · ${stomach}`;
  }

  /* ---------- Getränke ---------- */

  let openAfterRender = null;

  function initPresets() {
    const box = $('#presets');
    PRESETS.forEach((p) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'preset';
      b.dataset.name = p.name;
      b.setAttribute('aria-label', `${p.name} hinzufügen (${numToInput(p.cl)} cl, ${numToInput(p.vol)} %)`);
      b.innerHTML = `<b></b><small>${numToInput(p.cl)} cl</small><span class="badge" hidden></span>`;
      $('b', b).textContent = p.short;
      b.addEventListener('click', () => {
        addDrink(p.name, p.cl, p.vol);
        flash(b);
      });
      box.appendChild(b);
    });

    const custom = document.createElement('button');
    custom.type = 'button';
    custom.className = 'preset custom';
    custom.innerHTML = '<b>+ Eigenes</b><small>selbst eingeben</small>';
    custom.addEventListener('click', () => {
      const id = addDrink('Eigenes Getränk', '', '', true);
      const row = $(`#drink-list .drink[data-id="${id}"]`);
      if (row) {
        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        $('.drink-cl', row).focus({ preventScroll: true });
      }
    });
    box.appendChild(custom);

    $('#clear-drinks').addEventListener('click', () => {
      if (!state.drinks.length) return;
      const backup = state.drinks.slice();
      state.drinks = [];
      renderDrinks();
      changed();
      showToast('Alle Getränke gelöscht', () => {
        state.drinks = backup;
        renderDrinks();
        changed();
      });
    });
  }

  function flash(el) {
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 350);
    if (navigator.vibrate) {
      try { navigator.vibrate(15); } catch (e) { /* egal */ }
    }
  }

  function addDrink(name, cl, vol, open) {
    const id = newId();
    state.drinks.push({
      id,
      name,
      cl: cl === '' ? '' : numToInput(cl),
      vol: vol === '' ? '' : numToInput(vol),
      time: C.formatClock(Date.now()),
      addedAt: Date.now(),
    });
    if (open) openAfterRender = id;
    renderDrinks();
    changed();
    return id;
  }

  function renderDrinks() {
    const list = $('#drink-list');
    const tpl = $('#drink-row-tpl');
    const openIds = new Set($$('.drink details[open]', list).map((d) => d.parentElement.dataset.id));
    if (openAfterRender) openIds.add(openAfterRender);
    openAfterRender = null;

    list.textContent = '';
    // Neueste zuerst
    state.drinks.slice().reverse().forEach((d) => {
      const row = tpl.content.firstElementChild.cloneNode(true);
      row.dataset.id = d.id;
      $('.drink-name', row).value = d.name;
      $('.drink-cl', row).value = d.cl;
      $('.drink-vol', row).value = d.vol;
      $('.drink-time', row).value = d.time;
      if (openIds.has(d.id)) $('details', row).open = true;
      fillSummary(row, d);
      list.appendChild(row);
    });

    const n = state.drinks.length;
    $('#drink-empty').hidden = n > 0;
    $('#clear-drinks').hidden = n === 0;
    $('#drink-count').textContent = n ? `(${n})` : '';
    updateBadges();
  }

  function fillSummary(row, d) {
    const g = C.gramsAlcohol(d.cl, d.vol);
    $('.drink-title', row).textContent = d.name || 'Getränk';
    $('.drink-meta', row).textContent = g > 0
      ? `${d.cl} cl · ${d.vol} % · ${C.formatNumber(g, 1)} g Alkohol`
      : 'Tippen und Menge + % eingeben';
    $('.drink-clock', row).textContent = d.time || '--:--';
  }

  function updateBadges() {
    const counts = {};
    state.drinks.forEach((d) => { counts[d.name] = (counts[d.name] || 0) + 1; });
    $$('.preset[data-name]').forEach((b) => {
      const badge = $('.badge', b);
      const n = counts[b.dataset.name] || 0;
      badge.hidden = n === 0;
      badge.textContent = n;
    });
  }

  function initDrinkList() {
    const list = $('#drink-list');
    const fieldMap = {
      'drink-name': 'name',
      'drink-cl': 'cl',
      'drink-vol': 'vol',
      'drink-time': 'time',
    };

    list.addEventListener('input', (e) => {
      const row = e.target.closest('.drink');
      if (!row) return;
      const d = state.drinks.find((x) => x.id === row.dataset.id);
      if (!d) return;
      const cls = Object.keys(fieldMap).find((c) => e.target.classList.contains(c));
      if (!cls) return;
      d[fieldMap[cls]] = e.target.value;
      fillSummary(row, d);
      if (cls === 'drink-name') updateBadges();
      changed();
    });

    list.addEventListener('click', (e) => {
      const btn = e.target.closest('.drink-del');
      if (!btn) return;
      e.preventDefault(); // nicht auf-/zuklappen
      const row = btn.closest('.drink');
      const index = state.drinks.findIndex((x) => x.id === row.dataset.id);
      if (index < 0) return;
      const [removed] = state.drinks.splice(index, 1);
      renderDrinks();
      changed();
      showToast(`${removed.name || 'Getränk'} gelöscht`, () => {
        state.drinks.splice(Math.min(index, state.drinks.length), 0, removed);
        renderDrinks();
        changed();
      });
    });
  }

  /* ---------- Toast mit Rückgängig ---------- */

  let toastTimer = null;
  let toastUndo = null;

  function showToast(text, undo) {
    $('#toast-text').textContent = text;
    toastUndo = undo;
    $('#toast-undo').hidden = !undo;
    $('#toast').hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, TOAST_MS);
  }

  function hideToast() {
    $('#toast').hidden = true;
    toastUndo = null;
  }

  function initToast() {
    $('#toast-undo').addEventListener('click', () => {
      const undo = toastUndo;
      hideToast();
      if (undo) undo();
    });
  }

  /* ---------- Berechnung & Anzeige ---------- */

  function changed() {
    state.updatedAt = Date.now();
    save();
    update();
    listeners.forEach((fn) => {
      try { fn(state); } catch (e) { /* Fehler im Konto-Modul nicht weitergeben */ }
    });
  }

  /** Getränke, die älter als 24 h sind, entfernen. */
  function pruneOldDrinks(now) {
    const keep = state.drinks.filter((d) => {
      const t = C.drinkTimestamp(d, now);
      return t === null || now - t < MAX_AGE_MS;
    });
    if (keep.length === state.drinks.length) return false;
    state.drinks = keep;
    return true;
  }

  function update() {
    const now = Date.now();
    if (pruneOldDrinks(now)) {
      renderDrinks();
      changed();
      return;
    }
    const person = personForCalc();
    const errors = C.validatePerson(person);

    $('#age-notice').hidden = !(person.age > 0 && person.age < 18);
    $('#profile-summary').textContent = profileSummary();

    const errEl = $('#person-error');
    errEl.hidden = errors.length === 0;
    errEl.textContent = errors.length ? 'Bitte «Deine Angaben» prüfen: ' + errors.join(' ') : '';

    const drinks = state.drinks
      .map((d) => ({
        name: d.name,
        grams: C.gramsAlcohol(d.cl, d.vol),
        time: C.drinkTimestamp(d, now),
      }))
      .filter((d) => d.grams > 0 && d.time !== null);

    const ok = errors.length === 0;
    const sim = C.simulate(person, ok ? drinks : []);
    const current = C.valueAt(sim, now);

    // Hauptwert
    $('#current').textContent = C.formatPermille(current);
    const status = C.statusFor(current);
    $('#status').textContent = status.label;
    $('#hero').dataset.status = status.key;
    $('#trend').textContent = trendText(sim, now, current, drinks.length > 0 && ok, person.rate);

    // Uhrzeiten
    const hasDrinks = drinks.length > 0 && ok;
    renderTime('#tile-under05', sim.times.under05, now, hasDrinks);
    renderTime('#tile-under01', sim.times.under01, now, hasDrinks);
    renderTime('#tile-zero', sim.times.zero, now, hasDrinks);

    // Verlauf
    const totalGrams = drinks.reduce((s, d) => s + d.grams, 0);
    $('#info-grams').textContent = C.formatNumber(totalGrams, 1) + ' g';
    $('#info-std').textContent = C.formatNumber(totalGrams / 10, 1);
    if (sim.peakTime !== null) {
      const p = clockWithDay(sim.peakTime, now);
      $('#info-peak').textContent = `${C.formatPermille(sim.peak)} ‰ · ${p.clock}`;
      $('#chart-summary').textContent = `Höchstwert ${C.formatPermille(sim.peak)} ‰`;
    } else {
      $('#info-peak').textContent = '–';
      $('#chart-summary').textContent = '';
    }

    if ($('#chart-panel').open) renderChart(sim, now, current, drinks);
  }

  function trendText(sim, now, current, hasDrinks, rate) {
    if (!hasDrinks) return 'Tippe unten auf dein Getränk.';
    if (sim.peakTime !== null && sim.peakTime > now && sim.peak - current > 0.005) {
      const p = clockWithDay(sim.peakTime, now);
      return `Steigt noch auf ca. ${C.formatPermille(sim.peak)} ‰ (um ${p.clock})`;
    }
    if (current > 0) return `Sinkt um ca. ${C.formatNumber(rate, 2)} ‰ pro Stunde`;
    return 'Alles abgebaut.';
  }

  function renderTime(sel, t, now, hasDrinks) {
    const tile = $(sel);
    const valueEl = $('.time-value', tile);
    const subEl = $('.time-sub', tile);
    tile.classList.remove('done');

    if (!hasDrinks) {
      valueEl.textContent = '–';
      subEl.innerHTML = '&nbsp;';
      return;
    }
    if (t === null || t <= now) {
      tile.classList.add('done');
      valueEl.textContent = '✓';
      if (t === null) {
        subEl.textContent = 'nie darüber';
      } else {
        const { clock, day } = clockWithDay(t, now);
        subEl.textContent = 'seit ' + (day ? day + ' ' : '') + clock;
      }
      return;
    }
    const { clock, day } = clockWithDay(t, now);
    valueEl.textContent = '';
    if (day) {
      const small = document.createElement('small');
      small.textContent = day;
      valueEl.appendChild(small);
    }
    valueEl.appendChild(document.createTextNode(clock));
    subEl.textContent = 'in ' + C.formatDuration(t - now);
  }

  function renderChart(sim, now, current, drinks) {
    const svg = $('#chart');
    const empty = $('#chart-empty');
    if (!sim.points.length) {
      svg.innerHTML = '';
      empty.hidden = false;
      svg.setAttribute('aria-label', 'Verlaufskurve: noch keine Daten');
      return;
    }
    empty.hidden = true;

    // In echter Pixelbreite zeichnen, damit die Schrift lesbar bleibt
    const W = Math.max(260, Math.round(svg.parentElement.clientWidth || 480));
    const H = W < 460 ? 200 : 240;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const L = 32;
    const R = 10;
    const T = 18;
    const B = 26;

    let t0 = Math.min(sim.start, now);
    let t1 = Math.max(sim.end, now);
    const minSpan = 2 * 3600e3;
    if (t1 - t0 < minSpan) t1 = t0 + minSpan;
    const pad = (t1 - t0) * 0.02;
    t0 -= pad;
    t1 += pad;

    const yMax = Math.max(0.6, Math.ceil(sim.peak * 1.15 * 10) / 10);
    const x = (t) => L + ((t - t0) / (t1 - t0)) * (W - L - R);
    const y = (v) => T + (1 - v / yMax) * (H - T - B);
    const f = (n) => n.toFixed(1);

    const parts = [];

    // Y-Gitter
    const yStep = yMax <= 0.8 ? 0.2 : yMax <= 1.6 ? 0.4 : 0.5;
    for (let v = 0; v <= yMax + 1e-9; v += yStep) {
      const yy = f(y(v));
      parts.push(`<line class="grid" x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}"/>`);
      parts.push(`<text class="axis-label" x="${L - 6}" y="${yy}" dy="4" text-anchor="end">${C.formatNumber(v, 1)}</text>`);
    }

    // X-Achse: volle Stunden, mind. 48 px Abstand
    const pxPerHour = (W - L - R) / ((t1 - t0) / 3600e3);
    const hStep = [1, 2, 3, 4, 6, 12, 24].find((s) => s * pxPerHour >= 48) || 24;
    const d = new Date(t0);
    d.setMinutes(0, 0, 0);
    d.setHours(d.getHours() + 1);
    while (d.getTime() <= t1) {
      if (d.getHours() % hStep === 0) {
        const xx = f(x(d.getTime()));
        parts.push(`<line class="grid" x1="${xx}" x2="${xx}" y1="${T}" y2="${H - B}"/>`);
        parts.push(`<text class="axis-label" x="${xx}" y="${H - B + 18}" text-anchor="middle">${String(d.getHours()).padStart(2, '0')}:00</text>`);
      }
      d.setHours(d.getHours() + 1);
    }

    // Grenzwerte
    [[0.5, '05'], [0.1, '01']].forEach(([v, k]) => {
      const yy = f(y(v));
      parts.push(`<line class="limit limit-${k}" x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}"/>`);
      parts.push(`<text class="limit-label limit-label-${k}" x="${W - R - 2}" y="${yy}" dy="-4" text-anchor="end">${C.formatNumber(v, 1)} ‰</text>`);
    });

    // Kurve + Fläche
    const pts = sim.points;
    const line = pts.map((p, i) => (i ? 'L' : 'M') + f(x(p.t)) + ' ' + f(y(p.v))).join(' ');
    const base = f(y(0));
    parts.push(`<path class="area" d="${line} L${f(x(pts[pts.length - 1].t))} ${base} L${f(x(pts[0].t))} ${base} Z"/>`);
    parts.push(`<path class="line" d="${line}"/>`);

    // Getränke-Markierungen
    drinks.forEach((dr) => {
      const xx = f(x(dr.time));
      const yb = H - B;
      parts.push(
        `<path class="marker" d="M${xx} ${yb - 9} l4.5 7 h-9 z"><title>${escapeXml(dr.name || 'Getränk')} · ${C.formatClock(dr.time)}</title></path>`
      );
    });

    // Jetzt-Linie
    const xn = f(x(now));
    parts.push(`<line class="now-line" x1="${xn}" x2="${xn}" y1="${T - 4}" y2="${H - B}"/>`);
    const right = x(now) < W - 50;
    parts.push(`<text class="now-label" x="${xn}" y="${T - 6}" dx="${right ? 4 : -4}" dy="8" text-anchor="${right ? 'start' : 'end'}">jetzt</text>`);
    parts.push(`<circle class="now-dot" cx="${xn}" cy="${f(y(current))}" r="5.5"/>`);

    svg.innerHTML = parts.join('');
    svg.setAttribute(
      'aria-label',
      `Verlaufskurve: jetzt ${C.formatPermille(current)} Promille, Höchstwert ${C.formatPermille(sim.peak)} Promille`
    );
  }

  /* ---------- Schnittstelle für das Konto-Modul (account.js) ---------- */

  window.PromilleApp = {
    /** Kopie der aktuellen Daten. */
    getState() {
      return JSON.parse(JSON.stringify(state));
    },
    /** Daten ersetzen (z. B. aus der Cloud), ohne updatedAt neu zu setzen. */
    replaceState(data) {
      state = normalize(data);
      save();
      fillProfileForm();
      renderDrinks();
      update();
    },
    /** Lokale Daten löschen (beim Abmelden). */
    clearLocal() {
      state = freshState();
      try { window.localStorage.removeItem(STORAGE_KEY); } catch (e) { /* egal */ }
      fillProfileForm();
      renderDrinks();
      update();
    },
    /** Wird bei jeder Änderung durch den Nutzer aufgerufen. */
    onChange(fn) {
      listeners.push(fn);
    },
    showToast(text) {
      showToast(text, null);
    },
  };

  /* ---------- Start ---------- */

  function registerServiceWorker() {
    const secure = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    if (!('serviceWorker' in navigator) || !secure) return;
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => { /* offline-Modus optional */ });
    });
  }

  function init() {
    if (!C) return;
    registerServiceWorker();
    initProfile();
    initPresets();
    initDrinkList();
    initToast();
    renderDrinks();
    update();

    $('#chart-panel').addEventListener('toggle', update);
    setInterval(update, REFRESH_MS);
    let resizeTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(update, 150);
    });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) update();
    });
  }

  init();
})();
