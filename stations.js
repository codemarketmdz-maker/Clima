/* Estaciones agrometeorológicas (FePEDI · ISCAMEN · COVIAR, datos de EVOLUS IoT) en TiempoMDZ.
   1) Capa "Estaciones" en el mapa: temperatura actual, humedad, punto de rocío y mín./máx. del día de cada estación.
   2) Cruce con las alertas: usa las estaciones cercanas a cada lugar para
        · confirmar helada cuando una estación cercana ya está en el umbral de helada,
        · anticipar la helada de la madrugada (estimación a partir del punto de rocío y del enfriamiento medido),
        · sumar a las alertas de tormenta si las estaciones registran un descenso brusco de temperatura.
   Estas estaciones miden temperatura, humedad y punto de rocío; NO miden viento, lluvia ni granizo: el granizo no se detecta con ellas. */
(function (g) {
  'use strict';
  const BASE = 'https://fepedi.evolus.com.ar/estaciones/data.json';
  const HK = 'tmdz_stn_hist_v1', KEEP_MS = 3 * 3600e3, RADIUS_KM = 30, MAX_AGE_MIN = 90;
  const COLORS = { FEPEDI: '#f5b301', ISCAMEN: '#ff7a1a', COVIAR: '#9b5de5' };
  const lsg = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lss = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { } };
  let list = [], at = 0, hist = {}, group = null, on = false, timer = null, first = true, fitted = false;
  try { hist = JSON.parse(lsg(HK) || '{}') || {}; } catch (e) { hist = {}; }

  const f1 = x => (Math.round(x * 10) / 10).toFixed(1).replace('.', ',');
  const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
  const rad = x => x * Math.PI / 180;
  function km(a, b, c, d) { const p = rad(c - a), q = rad(d - b), h = Math.sin(p / 2) ** 2 + Math.cos(rad(a)) * Math.cos(rad(c)) * Math.sin(q / 2) ** 2; return 12742 * Math.asin(Math.sqrt(h)); }
  function stamp(f, h) {       // "19/11/26" + "21:14" (hora argentina, UTC-3) → ms UTC
    const a = /^(\d{2})\/(\d{2})\/(\d{2,4})$/.exec(String(f || '')), b = /^(\d{1,2}):(\d{2})/.exec(String(h || ''));
    if (!a || !b) return null; const y = +a[3] < 100 ? 2000 + +a[3] : +a[3];
    return Date.UTC(y, +a[2] - 1, +a[1], +b[1] + 3, +b[2]);
  }
  function magnus(t, h) { if (t == null || h == null || h <= 0) return null; const a = 17.62, b = 243.12, x = Math.log(h / 100) + a * t / (b + t); return b * x / (a - x); }
  function norm(r) {
    const lat = num(r.latitud), lon = num(r.longitud), t = num(r.temperatura), h = num(r.humedad), time = stamp(r.fecha, r.hora);
    let td = num(r.pto_rocio); if (td == null) td = magnus(t, h);
    const st = { id: String(r.id), name: String(r.name || r.id), prov: String(r.proveedor || ''), lat, lon, t, h, td, tmin: num(r.temp_min), tmax: num(r.temp_max), hmin: num(r.hum_min), hmax: num(r.hum_max), time, offline: r.estado !== 'online' };
    st.ageMin = time == null ? null : Math.max(0, (Date.now() - time) / 60000);
    st.ok = lat != null && lon != null && t != null && !st.offline && st.ageMin != null && st.ageMin <= MAX_AGE_MIN;
    return st;
  }
  function remember(st) {
    const now = Date.now(); let ch = false;
    st.forEach(s => {
      if (!s.ok) return; const a = hist[s.id] = hist[s.id] || [], last = a[a.length - 1];
      if (!last || last.t !== s.time) { a.push({ t: s.time, T: s.t, D: s.td, H: s.h }); ch = true; }
      while (a.length && now - a[0].t > KEEP_MS) { a.shift(); ch = true; }
    });
    Object.keys(hist).forEach(k => { if (!hist[k].length || now - hist[k][hist[k].length - 1].t > KEEP_MS) { delete hist[k]; ch = true; } });
    if (ch) lss(HK, JSON.stringify(hist));
  }
  // Enfriamiento de una estación en °C/h (positivo = se enfría) con lecturas de los últimos `maxMin` min; exige ≥ minSpan min entre lecturas.
  function rate(id, maxMin, minSpan) {
    const a = hist[id]; if (!a || a.length < 2) return null; const l = a[a.length - 1];
    const o = a.find(x => l.t - x.t <= maxMin * 60e3 && l.t - x.t >= minSpan * 60e3); if (!o) return null;
    return (o.T - l.T) / ((l.t - o.t) / 3.6e6);
  }
  function drop(id, maxMin) {   // mayor caída de temperatura (°C) dentro de los últimos maxMin min, con los minutos que tardó
    const a = hist[id]; if (!a || a.length < 2) return null; const l = a[a.length - 1]; let best = null;
    a.forEach(x => { const dt = (l.t - x.t) / 60000; if (dt >= 8 && dt <= maxMin) { const d = x.T - l.T; if (!best || d > best.d) best = { d, min: Math.round(dt) }; } });
    return best;
  }
  function nearby(lat, lon, radius, max) {
    return list.filter(s => s.ok).map(s => Object.assign({ km: km(lat, lon, s.lat, s.lon) }, s)).filter(s => s.km <= radius).sort((a, b) => a.km - b.km).slice(0, max || 6);
  }
  function sunriseMs(lat, lon, ms) {   // aproximación NOAA del próximo amanecer
    const calc = m => {
      const d = new Date(m), n = Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(d.getUTCFullYear(), 0, 0)) / 864e5), y = 2 * Math.PI / 365 * (n - 1);
      const eq = 229.18 * (0.000075 + 0.001868 * Math.cos(y) - 0.032077 * Math.sin(y) - 0.014615 * Math.cos(2 * y) - 0.040849 * Math.sin(2 * y));
      const dc = 0.006918 - 0.399912 * Math.cos(y) + 0.070257 * Math.sin(y) - 0.006758 * Math.cos(2 * y) + 0.000907 * Math.sin(2 * y) - 0.002697 * Math.cos(3 * y) + 0.00148 * Math.sin(3 * y);
      const la = rad(lat), c = Math.cos(rad(90.833)) / (Math.cos(la) * Math.cos(dc)) - Math.tan(la) * Math.tan(dc); if (Math.abs(c) > 1) return null;
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) + (720 - 4 * (lon + Math.acos(c) * 180 / Math.PI) - eq) * 60e3;
    };
    let s = calc(ms); if (s != null && s < ms) s = calc(ms + 864e5); return s;
  }
  const localHour = ms => +new Date(ms).toLocaleString('en-GB', { hour: '2-digit', hour12: false, timeZone: 'America/Argentina/Mendoza' }) % 24;
  const hhmm = ms => new Date(ms).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Argentina/Mendoza' });
  const median = a => { const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

  // ---------------- Condiciones de la noche (modelo: temperatura, viento y nubes hasta el amanecer) ----------------
  const NIGHT = {};
  function night(lat, lon) {
    const k = lat.toFixed(1) + ',' + lon.toFixed(1), n = NIGHT[k];
    if ((!n || Date.now() - n.at > 30 * 60e3) && !(n && n.busy)) { NIGHT[k] = Object.assign(n || { at: 0 }, { busy: true }); fetchNight(k, lat, lon); }
    return n && n.t ? n : null;
  }
  async function fetchNight(k, lat, lon) {
    try {
      const r = await fetch('https://api.open-meteo.com/v1/forecast?latitude=' + lat.toFixed(3) + '&longitude=' + lon.toFixed(3) + '&hourly=temperature_2m,wind_speed_10m,cloud_cover&forecast_hours=18&timezone=auto&wind_speed_unit=kmh');
      const j = await r.json(), off = (j.utc_offset_seconds || 0) * 1000, H = j.hourly;
      const t = H.time.map(x => { const m = /(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(x); return Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5]) - off; });
      const first = !(NIGHT[k] && NIGHT[k].t); NIGHT[k] = { at: Date.now(), t, T: H.temperature_2m, W: H.wind_speed_10m, C: H.cloud_cover };
      if (first) afterFirst(true);
    } catch (e) { NIGHT[k] = { at: Date.now() - 20 * 60e3 }; }     // reintenta en 10 min
  }
  function conditions(nt, now, sr) {
    if (!nt) return null;
    let i = -1; for (let j = 0; j < nt.t.length; j++) { if (nt.t[j] <= now) i = j; else break; }
    if (i < 0 || !Number.isFinite(nt.T[i])) return null;
    const nx = Number.isFinite(nt.T[i + 1]) ? nt.T[i + 1] : nt.T[i], frac = Math.min(1, (now - nt.t[i]) / 3.6e6), mNow = nt.T[i] + frac * (nx - nt.T[i]);
    const end = (sr != null ? sr : now + 12 * 3.6e6) + 3600e3; let mMin = null; const W = [], C = [];
    for (let j = i + 1; j < nt.t.length && nt.t[j] <= end; j++) {
      if (Number.isFinite(nt.T[j])) mMin = mMin == null ? nt.T[j] : Math.min(mMin, nt.T[j]);
      if (Number.isFinite(nt.W[j])) W.push(nt.W[j]); if (Number.isFinite(nt.C[j])) C.push(nt.C[j]);
    }
    const k3 = Number.isFinite(nt.T[i + 3]) ? i + 3 : null, rateM = k3 != null ? (mNow - nt.T[k3]) / ((nt.t[k3] - now) / 3.6e6) : null;
    const wMax = W.length ? Math.max(...W) : null, wMean = W.length ? W.reduce((a, x) => a + x, 0) / W.length : null, cMean = C.length ? C.reduce((a, x) => a + x, 0) / C.length : null;
    return { mNow, mMin, rateM, wMax, cMean, calm: wMax != null && wMax <= 10, clear: cMean != null && cMean <= 35, windy: wMax != null && (wMean >= 15 || wMax >= 25), cloudy: cMean != null && cMean >= 70 };
  }
  function condText(c) {
    if (!c) return '';
    const w = c.wMax != null ? Math.round(c.wMax) : null, n = c.cMean != null ? Math.round(c.cMean) : null;
    if (c.clear && c.calm) return 'Cielo despejado (' + n + ' % de nubes) y viento calmo (hasta ' + w + ' km/h): condiciones de máximo enfriamiento.';
    if (c.windy) return 'Viento de hasta ' + w + ' km/h' + (n != null ? ' y ' + n + ' % de nubes' : '') + ': el aire mezclado frena el enfriamiento.';
    if (c.cloudy) return 'Cielo cubierto (' + n + ' % de nubes): se enfría menos.';
    return 'Nubosidad ' + (n != null ? n + ' %' : '—') + ', viento hasta ' + (w != null ? w : '—') + ' km/h.';
  }
  const trendText = r => r == null ? '' : r > 0.3 ? 'está bajando ' + f1(r) + ' °C/h' : r < -0.3 ? 'está subiendo ' + f1(-r) + ' °C/h' : 'se mantiene estable';

  // ---------------- Cruce con las alertas ----------------
  function cross(ev, loc, cfg) {
    if (cfg && cfg.stnCross === false) return ev;
    if (!loc || !Number.isFinite(loc.lat) || !Number.isFinite(loc.lon) || !list.length || Date.now() - at > 20 * 60e3) return ev;
    const radius = Math.max(5, Math.min(100, Number(cfg && cfg.stnKm) || RADIUS_KM));
    const near = nearby(loc.lat, loc.lon, radius, 6); if (!near.length) return ev;
    const lim = Number.isFinite(Number(cfg && cfg.frostC)) ? Number(cfg.frostC) : 3, now = Date.now(), place = loc.name, out = ev.slice(), mine = [];
    const names = a => a.slice(0, 2).map(s => s.name + ' (' + Math.round(s.km) + ' km)').join(' y ');
    const sr = sunriseMs(loc.lat, loc.lon, now), cnd = conditions(night(loc.lat, loc.lon), now, sr), ct = condText(cnd);
    const hit = near.filter(s => s.t <= lim);
    if (hit.length) {
      // A) Helada registrada: una estación cercana ya está en el umbral
      const s = hit[0], cnt = hit.length, tr = trendText(rate(s.id, 150, 40));
      mine.push({ type: 'frost', level: 3, title: 'Riesgo de helada', place, detail: 'Estaciones cercanas ya registran ' + f1(s.t) + ' °C (umbral ' + f1(lim) + ' °C): ' + names(hit) + (cnt > 2 ? ' y otras ' + (cnt - 2) : '') + '; lectura de hace ' + Math.round(s.ageMin) + ' min' + (tr ? ' y ' + tr : '') + '. ' + ct + ' Activá la protección antihelada ahora.' });
    } else if (localHour(now) >= 18 || localHour(now) < 9) {
      // B) Anticipación nocturna con estaciones + modelo (viento y nubes)
      const set = near.slice(0, 4), w = s => 1 / (s.km + 3), sw = set.reduce((a, s) => a + w(s), 0);
      const T0 = set.reduce((a, s) => a + s.t * w(s), 0) / sw, tds = set.filter(s => s.td != null), Td = tds.length ? tds.reduce((a, s) => a + s.td * w(s), 0) / tds.reduce((a, s) => a + w(s), 0) : null;
      const rs = set.map(s => rate(s.id, 150, 40)).filter(r => r != null), rSt = rs.length ? median(rs) : null, rEff = rSt != null ? rSt : (cnd && cnd.rateM != null ? cnd.rateM : null), rSrc = rSt != null ? 'medido en las estaciones' : 'según el modelo';
      const hrs = sr == null ? null : (sr - now) / 3.6e6;
      if (Td != null && hrs != null && hrs > 0 && hrs < 15 && T0 > lim) {
        const floor = Td - 2, rc = rEff != null ? Math.min(3, rEff) : null;
        // 1) enfriamiento que se frena al acercarse al punto de rocío: T(t) = piso + (T0 − piso)·e^(−t/τ), piso = rocío − 2 °C
        const estRad = rc != null && rc > 0.15 && T0 > floor + 0.2 ? floor + (T0 - floor) * Math.exp(-hrs * rc / (T0 - floor)) : null;
        // 2) mínima del modelo hasta el amanecer, corregida por la diferencia entre lo medido y lo que el modelo tenía ahora
        const estMod = cnd && cnd.mMin != null ? cnd.mMin + Math.max(-5, Math.min(5, T0 - cnd.mNow)) : null;
        let est = null;
        if (cnd && (cnd.windy || cnd.cloudy)) est = estMod != null ? estMod : (estRad != null ? estRad + 1.5 : null);     // viento o nubes: manda el modelo
        else if (cnd && cnd.clear && cnd.calm) est = estRad != null && estMod != null ? Math.min(estRad, estMod) : (estRad != null ? estRad : estMod);   // despejado y calmo: la peor de las dos
        else est = estRad != null && estMod != null ? (estRad + estMod) / 2 : (estRad != null ? estRad : estMod);
        let eta = null;      // hora en que llegaría al umbral
        if (rEff != null && rEff > 0.15) {
          if (estRad != null && floor < lim) { const hh = (T0 - floor) / rc * Math.log((T0 - floor) / (lim - floor)); if (hh > 0 && hh < hrs) eta = now + hh * 3.6e6; }
          else { const hh = (T0 - lim) / rEff; if (hh > 0 && hh <= 3) eta = now + hh * 3.6e6; }
        }
        const basis = 'Estaciones: ' + names(set) + '. Ahora ' + f1(T0) + ' °C, punto de rocío ' + f1(Td) + ' °C' + (rEff != null ? ', ' + trendText(rEff) + ' (' + rSrc + ')' : '') + '. ' + ct;
        let lvl = 0;
        if (est != null && est <= lim) lvl = 2; else if (eta != null && eta - now <= 3 * 3.6e6 && !(cnd && (cnd.windy || cnd.cloudy) && est != null && est > lim + 1.5)) lvl = 2; else if (est != null && est <= lim + 1.5) lvl = 1;
        if (lvl) {
          const head = est != null && est <= lim ? 'Se estima una mínima de ' + f1(est) + ' °C hacia el amanecer (' + hhmm(sr) + ').' : (lvl === 2 ? 'Se acerca al umbral de ' + f1(lim) + ' °C.' : 'Vigilancia: la mínima estimada para el amanecer es de ' + f1(est) + ' °C, cerca del umbral de ' + f1(lim) + ' °C.');
          mine.push({ type: 'frost', level: lvl, title: 'Riesgo de helada', place, detail: head + (eta != null ? ' Llegaría a ' + f1(lim) + ' °C hacia las ' + hhmm(eta) + '.' : '') + ' ' + basis + ' Es una estimación.' });
        } else if (est == null && Td <= lim + 1 && T0 <= lim + 6) {
          mine.push({ type: 'frost', level: 1, title: 'Riesgo de helada', place, detail: 'Vigilancia: el punto de rocío es muy bajo (' + f1(Td) + ' °C) y hay ' + f1(T0) + ' °C ahora. Con cielo despejado y sin viento podría llegar a helada. ' + basis });
        }
      }
    }
    if (mine.length) { for (let i = out.length - 1; i >= 0; i--) if (out[i] && out[i].type === 'frost' && out[i].place === place && !out[i].source) { if (out[i].level <= mine[0].level) out.splice(i, 1); } }
    // C) Descenso brusco de temperatura en varias estaciones (típico del paso de una tormenta): se suma a las alertas de tormenta de ese lugar
    const crash = near.map(s => ({ s, d: drop(s.id, 45) })).filter(x => x.d && x.d.d >= 4);
    if (crash.length >= 2) {
      const x = crash[0], txt = ' Las estaciones cercanas registran un descenso brusco de temperatura (' + x.s.name + ': −' + f1(x.d.d) + ' °C en ' + x.d.min + ' min; ' + crash.length + ' estaciones), típico del paso de una tormenta.';
      for (let i = 0; i < out.length; i++) {
        const e = out[i]; if (e && !e.source && e.place === place && /^(hail|stormStrong|stormWeak|stormApproach)$/.test(e.type) && !/descenso brusco/.test(e.detail || '')) out[i] = Object.assign({}, e, { detail: String(e.detail || '').replace(/\s*$/, '') + txt });
      }
    }
    const res = mine.concat(out);
    return typeof g.applyTier === 'function' ? g.applyTier(res) : res;
  }
  g.stnCross = function (ev, loc, cfg) { try { return cross(ev, loc, cfg); } catch (e) { return ev; } };
  g.stnNearby = (lat, lon, radius) => nearby(lat, lon, radius || RADIUS_KM, 12);

  // ---------------- Datos ----------------
  const proxyBase = () => { let u = String((g.CM_CFG && g.CM_CFG.proxy) || '').trim(); if (!u) return ''; if (!/^https?:\/\//i.test(u)) u = 'https://' + u.replace(/^\/+/, ''); return u.replace(/\/+$/, ''); };
  async function load() {
    const t = Math.floor(Date.now() / 60e3), b = proxyBase();
    for (const u of (b ? [b + '/estaciones?t=' + t, BASE + '?t=' + t, BASE] : [BASE + '?t=' + t, BASE])) {       // en vivo (Worker propio); si falla, proxies públicos y la copia de GitHub Actions
      try {
        const r = await fetch(u, { cache: 'no-store' }); if (!r.ok) continue;
        const j = JSON.parse(await r.text()); if (!Array.isArray(j) || !j.length) continue;
        list = j.map(norm).filter(s => s.lat != null && s.lon != null); at = Date.now(); remember(list); paint(); afterFirst(); status(true); return true;
      } catch (e) { }
    }
    status(false); return false;
  }
  // Cartel chico sobre el mapa: dice cuántas estaciones hay o por qué no cargan
  function status(ok) {
    if (!on) return; let c = document.getElementById('stnInfo');
    if (!c) { c = document.createElement('div'); c.id = 'stnInfo'; c.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);top:84px;z-index:1000;max-width:min(640px,86vw);background:rgba(7,24,43,.95);color:#fff;border:1px solid #2a5f94;border-radius:10px;padding:7px 10px;font:12.5px system-ui,sans-serif'; document.body.appendChild(c); }
    clearTimeout(c._t);
    if (ok) { const n = list.filter(s => s.ok).length; c.style.display = 'block'; c.style.borderColor = '#2a5f94'; c.textContent = '📍 ' + n + ' estaciones con datos de hace menos de 90 min (' + list.length + ' en total) · hacé clic en una para ver el detalle'; c._t = setTimeout(() => { c.style.display = 'none'; }, 9000); }
    else { c.style.display = 'block'; c.style.borderColor = '#ff6b6b'; c.textContent = proxyBase() ? '📍 No pude traer las estaciones. Abrí 📡 Radar SMN → 🔧 Probar servidor para ver el motivo.' : '📍 No pude traer las estaciones: falta configurar el servidor (proxy en config.js).'; }
  }
  let firstN = true;
  function afterFirst(n) {
    if (n) { if (!firstN) return; firstN = false; } else { if (!first) return; first = false; }
    try { if (typeof render === 'function' && typeof last !== 'undefined' && last) render(); } catch (e) { }
  }

  // ---------------- Capa del mapa ----------------
  const css = '.stn-pill{font:700 12px/1 system-ui,sans-serif;color:#fff;background:#0b2238;border:2px solid #f5b301;border-radius:12px;padding:3px 6px;white-space:nowrap;text-align:center;box-shadow:0 1px 4px rgba(0,0,0,.5)}.stn-pill.off{opacity:.55;border-style:dashed}.stn-pill.fr{background:#0b5fa5;color:#fff}.stn-pop{font:13px/1.4 system-ui,sans-serif}';
  function mapObj() { try { return typeof map !== 'undefined' ? map : null; } catch (e) { return null; } }
  function paint() {
    const m = mapObj(); if (!on || !m || !g.L) return;
    if (!group) group = g.L.layerGroup(); group.clearLayers();
    list.forEach(s => {
      const c = COLORS[s.prov] || '#f5b301', good = s.ok, fr = good && s.t <= 2;
      const html = '<div class="stn-pill' + (good ? '' : ' off') + (fr ? ' fr' : '') + '" style="border-color:' + c + '">' + (s.t != null && good ? Math.round(s.t) + '°' : '—') + '</div>';
      const mk = g.L.marker([s.lat, s.lon], { icon: g.L.divIcon({ className: '', html, iconSize: [40, 22], iconAnchor: [20, 11] }) });
      const when = s.time ? new Date(s.time).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Argentina/Mendoza' }) : '—';
      const row = (a, b) => b == null ? '' : '<br><b>' + a + ':</b> ' + b;
      mk.bindPopup('<div class="stn-pop"><b>' + esc(s.name) + '</b> · ' + esc(s.prov) + (good ? '' : ' <i>(sin datos recientes)</i>') + row('Ahora', s.t != null ? f1(s.t) + ' °C' : null) + row('Humedad', s.h != null ? Math.round(s.h) + ' %' : null) + row('Punto de rocío', s.td != null ? f1(s.td) + ' °C' : null) +
        row('Mín. / máx. del día', s.tmin != null && s.tmax != null ? f1(s.tmin) + ' / ' + f1(s.tmax) + ' °C' : null) + '<br><small>Lectura: ' + when + ' · Fuente: ' + esc(s.prov) + ' · EVOLUS IoT. No mide viento ni lluvia.</small></div>');
      mk.addTo(group);
    });
    if (!m.hasLayer(group)) group.addTo(m);
    if (!fitted && list.length) { fitted = true; try { m.fitBounds(g.L.latLngBounds(list.map(s => [s.lat, s.lon])).pad(0.1), { maxZoom: 10 }); } catch (e) { } }   // la primera vez, el mapa se acerca a donde están las estaciones
  }
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function toggle() {
    const b = document.getElementById('stn'), m = mapObj(); on = !on;
    if (b) b.classList.toggle('on', on);
    const q = document.getElementById('qStn'); if (q) { q.classList.toggle('on', on); q.setAttribute('aria-pressed', String(on)); }
    if (on) { if (!list.length) load().then(paint); else { paint(); status(true); } } else { if (group && m && m.hasLayer(group)) m.removeLayer(group); const c = document.getElementById('stnInfo'); if (c) c.style.display = 'none'; }
  }
  function ensureChip() {       // el panel de capas lo arma ui2.js; si por algo no incluyó el botón, se agrega acá
    if (document.querySelector('.mx-chip[data-k="stn"]') || document.getElementById('stnFab')) return;
    const dock = document.querySelector('.mx-dock'), b = document.createElement('button'); b.type = 'button';
    if (dock) { b.className = 'mx-chip'; b.dataset.k = 'stn'; b.innerHTML = '<span class="ic">📍</span><span class="tx">Estaciones</span>'; const al = dock.querySelector('.mx-chip.act'); dock.insertBefore(b, al || null); }
    else { b.id = 'stnFab'; b.textContent = '📍 Estaciones'; b.style.cssText = 'position:fixed;right:14px;top:150px;z-index:1000;min-height:40px;padding:0 12px;border-radius:12px;border:1px solid #2a5f94;background:rgba(7,24,43,.95);color:#fff;font:600 13px system-ui,sans-serif;cursor:pointer'; document.body.appendChild(b); }
    b.onclick = () => { toggle(); b.classList.toggle('on', on); };
  }
  function init() {
    setTimeout(ensureChip, 1500); setTimeout(ensureChip, 5000);
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    const b = document.createElement('button'); b.id = 'stn'; b.type = 'button'; b.style.display = 'none'; b.onclick = toggle; document.body.appendChild(b);
    load(); timer = setInterval(() => { if (!document.hidden) load(); }, 60e3);
    document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - at > 90e3) load(); });
  }
  g.cmStations = { reload: load, list: () => list.slice() };
  g.addEventListener('load', init);
})(window);
