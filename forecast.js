/* Pronóstico a 14 días: compara varios modelos/fuentes y muestra el consenso + qué tan de acuerdo están.
   Fuentes: Open-Meteo (ECMWF, GFS, ICON, GEM) y MET Noruega (≈ primeros 9 días). Argentina fija GMT-3 todo el año. */
(function (g) {
  'use strict';
  const MODELS = [
    ['ecmwf_ifs025', 'ECMWF (Europa)'],
    ['gfs_seamless', 'GFS (EE.UU.)'],
    ['icon_seamless', 'ICON (Alemania)'],
    ['gem_seamless', 'GEM (Canadá)']
  ];
  const OFF = -3 * 3600e3;
  const dayKey = ms => new Date(ms + OFF).toISOString().slice(0, 10);
  const DOW = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  const QUICK = ['Mendoza', 'Godoy Cruz', 'Luján de Cuyo', 'Maipú', 'San Martín', 'Tunuyán', 'San Rafael', 'Malargüe'];

  async function jget(url, ms) {
    const c = new AbortController(), t = setTimeout(() => c.abort(), ms || 12000);
    try {
      const r = await fetch(url, { signal: c.signal });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } finally { clearTimeout(t); }
  }
  const num = v => (v === null || v === undefined || isNaN(v)) ? null : +v;
  const median = a => { const s = a.slice().sort((x, y) => x - y), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; };

  /* ---------- fuentes ---------- */
  async function fromOpenMeteo(lat, lon) {
    const dv = 'temperature_2m_max,temperature_2m_min,precipitation_sum,wind_gusts_10m_max,weather_code';
    const j = await jget('https://api.open-meteo.com/v1/forecast?latitude=' + lat.toFixed(4) + '&longitude=' + lon.toFixed(4) +
      '&daily=' + dv + '&models=' + MODELS.map(m => m[0]).join(',') + '&forecast_days=16&timezone=America%2FArgentina%2FBuenos_Aires', 15000);
    const d = j && j.daily; if (!d || !d.time) throw new Error('Open-Meteo sin datos');
    const out = [];
    MODELS.forEach(([id, label]) => {
      const col = k => d[k + '_' + id] || (MODELS.length === 1 ? d[k] : null);
      const tx = col('temperature_2m_max'), tn = col('temperature_2m_min'), pr = col('precipitation_sum'), gu = col('wind_gusts_10m_max'), wc = col('weather_code');
      if (!tx) return;
      const days = {};
      d.time.forEach((t, i) => {
        const o = { tmax: num(tx[i]), tmin: tn ? num(tn[i]) : null, pr: pr ? num(pr[i]) : null, gust: gu ? num(gu[i]) : null, code: wc ? num(wc[i]) : null };
        if (o.tmax !== null && o.tmin !== null) days[t] = o;
      });
      if (Object.keys(days).length) out.push({ id, label, days });
    });
    if (!out.length) throw new Error('Open-Meteo sin modelos');
    return out;
  }

  async function fromMet(lat, lon) {
    const j = await jget('https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=' + lat.toFixed(4) + '&lon=' + lon.toFixed(4), 15000);
    const ts = (j && j.properties && j.properties.timeseries) || []; if (!ts.length) throw new Error('MET sin datos');
    const acc = {};
    ts.forEach(t => {
      const k = dayKey(Date.parse(t.time)), a = acc[k] || (acc[k] = { tmax: -99, tmin: 99, pr: 0, hrs: 0, n: 0 });
      const T = t.data.instant.details.air_temperature;
      if (T != null) { a.tmax = Math.max(a.tmax, T); a.tmin = Math.min(a.tmin, T); a.n++; }
      const nx = t.data.next_1_hours || t.data.next_6_hours;
      if (nx && nx.details && nx.details.precipitation_amount != null) { a.pr += nx.details.precipitation_amount; a.hrs += t.data.next_1_hours ? 1 : 6; }
    });
    const days = {};
    Object.keys(acc).forEach(k => { const a = acc[k]; if (a.hrs >= 20 && a.n >= 3) days[k] = { tmax: a.tmax, tmin: a.tmin, pr: a.pr, gust: null, code: null }; }); // se descartan días incompletos
    if (!Object.keys(days).length) throw new Error('MET sin días completos');
    return [{ id: 'met', label: 'MET Noruega', days }];
  }

  /* ---------- consenso ---------- */
  function codeIcon(c, pr) {
    if (pr >= 15) return '⛈️'; if (pr >= 3) return '🌧️'; if (pr >= 0.5) return '🌦️';
    if (c == null) return '⛅';
    if (c <= 1) return '☀️'; if (c === 2) return '⛅'; if (c === 3) return '☁️'; if (c === 45 || c === 48) return '🌫️';
    if (c >= 71 && c <= 77) return '❄️'; if (c >= 95) return '⛈️'; if (c >= 51) return '🌧️'; return '⛅';
  }
  const mode = a => { const counts = new Map(); a.forEach(x => counts.set(x, (counts.get(x) || 0) + 1)); return [...counts].sort((x,y) => y[1]-x[1] || x[0]-y[0])[0]?.[0] ?? null; };
  function consensus(sources, dates) {
    return dates.map(date => {
      const v = sources.map(s => ({ s, d: s.days[date] })).filter(x => x.d);
      if (!v.length) return { date, n: 0 };
      const tx = v.map(x => x.d.tmax), tn = v.map(x => x.d.tmin);
      const pv = v.filter(x => x.d.pr !== null), gv = v.filter(x => x.d.gust !== null), cv = v.filter(x => x.d.code !== null);
      const rainN = pv.filter(x => x.d.pr >= 1).length, rainShare = pv.length ? rainN / pv.length : 0;
      const spread = Math.max(...tx) - Math.min(...tx);
      const spreadMin = tn.length ? Math.max(...tn) - Math.min(...tn) : null;
      const agree = !pv.length || rainShare <= 0.25 || rainShare >= 0.75;
      // Los cuatro modelos de Open-Meteo son modelos distintos, pero comparten proveedor/API.
      // Se cuentan por separado como modelos y una sola vez como proveedor independiente.
      const providerCount = new Set(v.map(x => x.s.id === 'met' ? 'met-no' : 'open-meteo')).size;
      let conf = 'baja';
      if (providerCount >= 2 && v.length >= 3 && spread <= 3.5 && (spreadMin == null || spreadMin <= 4.5) && agree) conf = 'alta';
      else if (v.length >= 2 && spread <= 6 && (spreadMin == null || spreadMin <= 7)) conf = 'media';
      const pr = pv.length ? median(pv.map(x => x.d.pr)) : null;
      // Los códigos meteorológicos son categorías, no una escala continua: usar el más repetido.
      const code = cv.length ? mode(cv.map(x => x.d.code)) : null;
      return {
        date, n: v.length, providerCount, tmax: median(tx), tmin: median(tn), spread, spreadMin, pr, rainN, rainOf: pv.length,
        gust: gv.length ? median(gv.map(x => x.d.gust)) : null, conf,
        icon: codeIcon(code != null ? Math.round(code) : null, pr || 0),
        per: v.map(x => ({ label: x.s.label, ...x.d }))
      };
    });
  }

  function next14() {
    const o = [], t0 = Date.now();
    for (let i = 0; i < 14; i++) o.push(dayKey(t0 + i * 86400e3));
    return o;
  }

  /* ---------- búsqueda de localidades (solo Argentina, Mendoza primero) ---------- */
  async function geo(q) {
    const j = await jget('https://geocoding-api.open-meteo.com/v1/search?name=' + encodeURIComponent(q) + '&count=20&language=es&countryCode=AR', 9000);
    const r = ((j && j.results) || []).filter(x => x.country_code === 'AR');
    const mdz = x => (x.admin1 || '').toLowerCase().indexOf('mendoza') >= 0 ? 0 : 1;
    return r.map((x, i) => ({ x, i })).sort((a, b) => mdz(a.x) - mdz(b.x) || a.i - b.i).map(o => {
      const x = o.x, sub = [x.admin2 && x.admin2 !== x.name ? x.admin2 : '', x.admin1 || ''].filter(Boolean).join(', ');
      return { name: x.name, sub, label: x.name + (sub ? ', ' + sub : ''), lat: x.latitude, lon: x.longitude };
    });
  }

  /* ---------- pantalla ---------- */
  const $ = id => document.getElementById(id);
  const LSget = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };
  const LSset = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  let place = null, token = 0;

  function fmtDay(k) {
    const d = new Date(k + 'T12:00:00Z'), today = dayKey(Date.now());
    return (k === today ? 'Hoy' : DOW[d.getUTCDay()]) + ' ' + d.getUTCDate() + '/' + (d.getUTCMonth() + 1);
  }
  const R = v => v == null ? '–' : Math.round(v);
  const CONF = { alta: ['🟢', 'Confianza alta', 'Los modelos coinciden'], media: ['🟡', 'Confianza media', 'Hay diferencias moderadas'], baja: ['🔴', 'Confianza baja', 'Pocas fuentes o no coinciden'] };

  function setMsg(t, cls) { const e = $('fcMsg'); e.textContent = t || ''; e.className = 'msg ' + (cls || ''); }

  function draw(rows, used, from) {
    const box = $('fcList'); box.innerHTML = '';
    rows.forEach(r => {
      const d = document.createElement('details'); d.className = 'fcd ' + (r.n ? r.conf : 'baja');
      const s = document.createElement('summary');
      if (!r.n) { s.textContent = fmtDay(r.date) + ' · sin datos'; d.appendChild(s); box.appendChild(d); return; }
      const rain = r.rainOf ? '🌧 ' + r.rainN + '/' + r.rainOf + (r.pr != null ? ' · ' + (r.pr < 0.5 ? '0' : r.pr.toFixed(r.pr < 10 ? 1 : 0)) + ' mm' : '') : '';
      const c = CONF[r.conf];
      s.innerHTML = '<span class="fd"></span><span class="fi"></span><span class="ft"></span><span class="fr"></span><span class="fc"></span>';
      s.querySelector('.fd').textContent = fmtDay(r.date);
      s.querySelector('.fi').textContent = r.icon;
      s.querySelector('.ft').innerHTML = '<b>' + R(r.tmax) + '°</b> / ' + R(r.tmin) + '°';
      s.querySelector('.fr').textContent = [rain, r.gust != null && r.gust >= 45 ? '💨 ' + R(r.gust) : ''].filter(Boolean).join('  ');
      s.querySelector('.fc').textContent = c[0]; s.querySelector('.fc').title = c[1];
      d.appendChild(s);
      const det = document.createElement('div'); det.className = 'fdet';
      const h = document.createElement('div'); h.className = 'fdh'; h.textContent = c[0] + ' ' + c[1] + ' — ' + c[2] + ' (' + r.n + (r.n === 1 ? ' modelo' : ' modelos') + ', ' + r.providerCount + (r.providerCount === 1 ? ' proveedor' : ' proveedores') + (r.spread != null && r.n > 1 ? ', diferencia de máximas ' + r.spread.toFixed(1) + '°' : '') + (r.spreadMin != null && r.n > 1 ? ', mínimas ' + r.spreadMin.toFixed(1) + '°' : '') + ')';
      det.appendChild(h);
      r.per.forEach(p => {
        const l = document.createElement('div'); l.className = 'fdl';
        const a = document.createElement('span'), b = document.createElement('span');
        a.textContent = p.label;
        b.textContent = R(p.tmax) + '° / ' + R(p.tmin) + '°' + (p.pr != null ? ' · ' + (p.pr < 0.5 ? '0' : p.pr.toFixed(1)) + ' mm' : '') + (p.gust != null ? ' · 💨 ' + R(p.gust) : '');
        l.append(a, b); det.appendChild(l);
      });
      d.appendChild(det); box.appendChild(d);
    });
    $('fcSrc').textContent = 'Modelos comparados: ' + used.join(' · ') + (from ? ' (guardado ' + from + ')' : '') + '. Los modelos de Open-Meteo cuentan como modelos distintos, pero como un solo proveedor; MET Noruega es otro proveedor. Los valores centrales son medianas. 🌧 3/5 indica 3 de 5 modelos con lluvia de al menos 1 mm.';
  }

  async function load(p, force) {
    place = p; const my = ++token;
    $('fcPlace').textContent = '📍 ' + p.label;
    $('fcList').innerHTML = ''; $('fcSrc').textContent = ''; setMsg('⏳ Consultando varias fuentes…', 'warn');
    const key = 'fc:' + p.lat.toFixed(2) + ',' + p.lon.toFixed(2), dates = next14();
    const cached = LSget(key);
    if (!force && cached && Date.now() - cached.ts < 3 * 3600e3 && cached.dates[0] === dates[0]) {
      draw(consensus(cached.sources, dates), cached.used); setMsg('', ''); $('fcSrc').textContent += ' (actualizado ' + new Date(cached.ts).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) + ')'; return;
    }
    const res = await Promise.allSettled([fromOpenMeteo(p.lat, p.lon), fromMet(p.lat, p.lon)]);
    if (my !== token) return;
    const sources = [], fails = [];
    res.forEach((r, i) => { if (r.status === 'fulfilled') sources.push(...r.value); else fails.push(i ? 'MET Noruega' : 'Open-Meteo'); });
    if (!sources.length) {
      if (cached) { const ageH = Math.max(0, (Date.now() - cached.ts) / 3600000); draw(consensus(cached.sources, dates), cached.used, new Date(cached.ts).toLocaleString('es-AR')); setMsg('Sin conexión con las fuentes: se muestra un pronóstico guardado hace ' + (ageH < 1 ? Math.round(ageH * 60) + ' minutos' : ageH.toFixed(1) + ' horas') + '. No es una actualización en vivo.', 'warn'); return; }
      setMsg('No pude obtener el pronóstico (revisá tu conexión). Probá de nuevo en unos minutos.', 'bad'); return;
    }
    const used = sources.map(s => s.label);
    LSset(key, { ts: Date.now(), dates, sources, used });
    draw(consensus(sources, dates), used);
    setMsg(fails.length ? 'No respondió: ' + fails.join(', ') + '. Se usan las demás fuentes.' : '', fails.length ? 'warn' : '');
  }

  async function search(q) {
    q = (q || '').trim(); if (q.length < 2) { setMsg('Escribí al menos 2 letras.', 'warn'); return; }
    setMsg('🔎 Buscando…', 'warn'); $('fcRes').innerHTML = '';
    let r;
    try { r = await geo(q); } catch (e) { setMsg('No pude buscar la localidad (sin conexión).', 'bad'); return; }
    if (!r.length) { setMsg('No encontré "' + q + '" en Argentina. Probá con otro nombre.', 'bad'); return; }
    if (r.length > 1) {
      r.slice(1, 7).forEach(x => {
        const b = document.createElement('button'); b.className = 'btn'; b.textContent = x.label;
        b.onclick = () => { $('fcRes').innerHTML = ''; load(x); }; $('fcRes').appendChild(b);
      });
    }
    load(r[0]);
  }

  function here() {
    const l = typeof cur === 'function' ? cur() : { name: 'Mendoza', lat: -32.8895, lon: -68.8458 };
    return { label: l.name + (l.id === 'gps' ? ' (tu ubicación)' : ''), lat: l.lat, lon: l.lon };
  }

  function init() {
    const chips = $('fcQuick'); QUICK.forEach(n => { const b = document.createElement('button'); b.className = 'btn'; b.textContent = n; b.onclick = () => { $('fcQ').value = n; search(n); }; chips.appendChild(b); });
    $('fcGo').onclick = () => search($('fcQ').value);
    $('fcQ').onkeydown = e => { if (e.key === 'Enter') search($('fcQ').value); };
    $('fcHere').onclick = () => { $('fcQ').value = ''; $('fcRes').innerHTML = ''; load(here(), true); };
    $('fcClose').onclick = () => $('fcModal').classList.remove('active');
    $('fcBtn').onclick = () => { $('fcModal').classList.add('active'); load(place || here()); };
  }
  g.Forecast = { init, _consensus: consensus, _next14: next14, _dayKey: dayKey };
})(window);
