/* Promille-Uhr – Oberfläche */
(function () {
  'use strict';

  const C = window.PromilleCalc;
  const STORAGE_KEY = 'promille-uhr-v1';
  const REFRESH_MS = 30 * 1000;

  const PRESETS = [
    { name: 'Stange Bier', cl: 30, vol: 5 },
    { name: 'Grosses Bier', cl: 50, vol: 5 },
    { name: 'Wein', cl: 10, vol: 12.5 },
    { name: 'Prosecco', cl: 10, vol: 11 },
    { name: 'Shot', cl: 2, vol: 40 },
    { name: 'Longdrink', cl: 4, vol: 40 },
    { name: 'Cocktail', cl: 6, vol: 40 },
    { name: 'Alcopop', cl: 27.5, vol: 5 },
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

  let state = load();

  function load() {
    const fresh = { person: { ...DEFAULT_PERSON }, drinks: [] };
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return fresh;
      const data = JSON.parse(raw);
      return {
        person: { ...DEFAULT_PERSON, ...(data && data.person) },
        drinks: Array.isArray(data && data.drinks)
          ? data.drinks.filter((d) => d && typeof d.id === 'string')
          : [],
      };
    } catch (e) {
      return fresh;
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

  function nowHHMM() {
    return C.formatClock(Date.now());
  }

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

  /* ---------- Körper-Eingaben ---------- */

  function initPersonForm() {
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
  }

  function setSex(sex) {
    $$('.seg-btn[data-sex]').forEach((btn) => {
      btn.setAttribute('aria-pressed', String(btn.dataset.sex === sex));
    });
  }

  /* ---------- Getränke ---------- */

  function initPresets() {
    const box = $('#presets');
    PRESETS.forEach((p) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'preset';
      b.innerHTML = `<b></b><small>${numToInput(p.cl)} cl · ${numToInput(p.vol)} %</small>`;
      b.querySelector('b').textContent = p.name;
      b.addEventListener('click', () => addDrink(p.name, p.cl, p.vol));
      box.appendChild(b);
    });

    const custom = document.createElement('button');
    custom.type = 'button';
    custom.className = 'preset custom';
    custom.innerHTML = '<b>+ Eigenes Getränk</b><small>Menge und % selbst wählen</small>';
    custom.addEventListener('click', () => {
      addDrink('Eigenes Getränk', '', '');
      const rows = $$('#drink-list .drink');
      const last = rows[rows.length - 1];
      if (last) $('.drink-name', last).select();
    });
    box.appendChild(custom);

    $('#clear-drinks').addEventListener('click', () => {
      if (window.confirm('Alle Getränke löschen?')) {
        state.drinks = [];
        renderDrinks();
        changed();
      }
    });
  }

  function addDrink(name, cl, vol) {
    state.drinks.push({
      id: newId(),
      name,
      cl: cl === '' ? '' : numToInput(cl),
      vol: vol === '' ? '' : numToInput(vol),
      time: nowHHMM(),
    });
    renderDrinks();
    changed();
  }

  function renderDrinks() {
    const list = $('#drink-list');
    const tpl = $('#drink-row-tpl');
    list.textContent = '';
    state.drinks.forEach((d) => {
      const row = tpl.content.firstElementChild.cloneNode(true);
      row.dataset.id = d.id;
      $('.drink-name', row).value = d.name;
      $('.drink-cl', row).value = d.cl;
      $('.drink-vol', row).value = d.vol;
      $('.drink-time', row).value = d.time;
      updateRowGrams(row, d);
      list.appendChild(row);
    });
    $('#drink-empty').hidden = state.drinks.length > 0;
    $('#clear-drinks').hidden = state.drinks.length === 0;
  }

  function updateRowGrams(row, d) {
    const g = C.gramsAlcohol(d.cl, d.vol);
    const el = $('.drink-grams', row);
    if (g > 0) {
      el.innerHTML = `<strong>${C.formatNumber(g, 1)} g</strong> reiner Alkohol · ${C.formatNumber(g / 10, 1)} Standardgläser`;
    } else {
      el.textContent = 'Menge und Alkoholgehalt eingeben';
    }
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
      updateRowGrams(row, d);
      changed();
    });

    list.addEventListener('click', (e) => {
      const btn = e.target.closest('.drink-del');
      if (!btn) return;
      const row = btn.closest('.drink');
      state.drinks = state.drinks.filter((x) => x.id !== row.dataset.id);
      renderDrinks();
      changed();
    });
  }

  /* ---------- Berechnung & Anzeige ---------- */

  function changed() {
    save();
    update();
  }

  function update() {
    const now = Date.now();
    const person = personForCalc();
    const errors = C.validatePerson(person);

    const age = person.age;
    $('#age-notice').hidden = !(age > 0 && age < 18);

    const errEl = $('#person-error');
    errEl.hidden = errors.length === 0;
    errEl.textContent = errors.join(' ');

    const drinks = state.drinks
      .map((d) => ({
        name: d.name,
        grams: C.gramsAlcohol(d.cl, d.vol),
        time: C.resolveDrinkTime(d.time, now),
      }))
      .filter((d) => d.grams > 0 && d.time !== null);

    const sim = errors.length ? C.simulate(person, []) : C.simulate(person, drinks);
    const current = C.valueAt(sim, now);

    // Grosse Zahl + Status
    $('#current').textContent = C.formatPermille(current);
    const status = C.statusFor(current);
    const pill = $('#status');
    pill.textContent = status.label;
    pill.className = 'pill status-' + status.key;

    // Kacheln
    const hasDrinks = drinks.length > 0 && !errors.length;
    renderTile('#tile-under05', sim.times.under05, now, hasDrinks);
    renderTile('#tile-under01', sim.times.under01, now, hasDrinks);
    renderTile('#tile-zero', sim.times.zero, now, hasDrinks);

    // Infozeile
    const totalGrams = drinks.reduce((s, d) => s + d.grams, 0);
    $('#info-grams').textContent = C.formatNumber(totalGrams, 1) + ' g';
    $('#info-std').textContent = C.formatNumber(totalGrams / 10, 1);
    if (sim.peakTime !== null) {
      const p = clockWithDay(sim.peakTime, now);
      $('#info-peak').textContent = `${C.formatPermille(sim.peak)} ‰ um ${p.day ? p.day + ' ' : ''}${p.clock}`;
    } else {
      $('#info-peak').textContent = '–';
    }

    renderChart(sim, now, current, drinks);
  }

  function renderTile(sel, t, now, hasDrinks) {
    const tile = $(sel);
    const timeEl = $('.tile-time', tile);
    const subEl = $('.tile-sub', tile);
    tile.classList.remove('done');

    if (!hasDrinks) {
      timeEl.textContent = '–';
      subEl.textContent = 'keine Getränke';
      return;
    }
    if (t === null) {
      // Schwelle wurde nie überschritten
      tile.classList.add('done');
      timeEl.textContent = '✓';
      subEl.textContent = 'nie darüber';
      return;
    }
    const { clock, day } = clockWithDay(t, now);
    if (t <= now) {
      tile.classList.add('done');
      timeEl.textContent = '✓';
      subEl.textContent = 'seit ' + (day ? day + ' ' : '') + clock;
      return;
    }
    timeEl.innerHTML = '';
    if (day) {
      const small = document.createElement('small');
      small.textContent = day;
      timeEl.appendChild(small);
    }
    timeEl.appendChild(document.createTextNode(clock));
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

    // In echter Pixelbreite zeichnen, damit die Schrift auf dem Handy lesbar bleibt
    const W = Math.max(280, Math.round(svg.parentElement.clientWidth || 640));
    const H = W < 500 ? 210 : 260;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const L = 36;
    const R = 14;
    const T = 18;
    const B = 28;

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
    const yStep = yMax <= 0.8 ? 0.1 : yMax <= 1.6 ? 0.2 : 0.5;
    for (let v = 0; v <= yMax + 1e-9; v += yStep) {
      const yy = f(y(v));
      parts.push(`<line class="grid" x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}"/>`);
      parts.push(`<text class="axis-label" x="${L - 6}" y="${yy}" dy="4" text-anchor="end">${C.formatNumber(v, 1)}</text>`);
    }

    // X-Achse: volle Stunden
    // Stundenschritt so wählen, dass Beschriftungen mind. 48 px Abstand haben
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
    const nowLabelRight = x(now) < W - 60;
    parts.push(`<text class="now-label" x="${xn}" y="${T - 6}" dx="${nowLabelRight ? 4 : -4}" text-anchor="${nowLabelRight ? 'start' : 'end'}" dy="8">jetzt</text>`);
    parts.push(`<circle class="now-dot" cx="${xn}" cy="${f(y(current))}" r="5.5"/>`);

    svg.innerHTML = parts.join('');
    svg.setAttribute(
      'aria-label',
      `Verlaufskurve: jetzt ${C.formatPermille(current)} Promille, Höchstwert ${C.formatPermille(sim.peak)} Promille`
    );
  }

  /* ---------- Start ---------- */

  function init() {
    if (!C) return;
    initPersonForm();
    initPresets();
    initDrinkList();
    renderDrinks();
    update();
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
