/* TiempoMDZ 1.13 · mapa interactivo: dock de capas, viento animado, rumbo de nubes, temperatura,
   avisos SMN, panel de Contingencias Mendoza. Se apoya en lo que ya existe en index.html. */
(function (root) {
  'use strict';

  /* ===================== utilidades puras (se pueden probar solas) ===================== */
  const D2R = Math.PI / 180;
  const P8 = [['N', 'norte'], ['NE', 'noreste'], ['E', 'este'], ['SE', 'sudeste'], ['S', 'sur'], ['SO', 'sudoeste'], ['O', 'oeste'], ['NO', 'noroeste']];
  const pt8 = d => P8[Math.round((((d % 360) + 360) % 360) / 45) % 8];
  const fromWords = d => 'del ' + pt8(d)[1];
  const toWords = d => 'hacia el ' + pt8((d + 180) % 360)[1];
  const toward = (u, v) => ((Math.atan2(u, v) / D2R) + 360) % 360;
  function windClass(k) {
    if (k < 6) return ['Calma', '😌'];
    if (k < 20) return ['Brisa suave', '🍃'];
    if (k < 40) return ['Viento moderado', '💨'];
    if (k < 60) return ['Viento fuerte', '⚠️'];
    if (k < 80) return ['Viento muy fuerte', '🚨'];
    return ['Temporal', '🌪'];
  }
  function wxText(code) {
    const c = Number(code);
    if (c === 0) return ['☀️', 'Despejado'];
    if (c === 1) return ['🌤', 'Mayormente despejado'];
    if (c === 2) return ['⛅', 'Parcialmente nublado'];
    if (c === 3) return ['☁️', 'Nublado'];
    if (c === 45 || c === 48) return ['🌫', 'Niebla'];
    if (c >= 51 && c <= 57) return ['🌦', 'Llovizna'];
    if (c >= 61 && c <= 67) return ['🌧', 'Lluvia'];
    if (c >= 71 && c <= 77) return ['🌨', 'Nieve'];
    if (c >= 80 && c <= 82) return ['🌦', 'Chubascos'];
    if (c === 85 || c === 86) return ['🌨', 'Nevadas'];
    if (c === 96 || c === 99) return ['⛈', 'Tormenta con granizo'];
    if (c >= 95) return ['⛈', 'Tormenta'];
    return ['🌡', 'Sin datos'];
  }
  const WIND = [[0, '#5bc8ff'], [10, '#38d6c4'], [20, '#8be04e'], [30, '#f5e33a'], [45, '#ff9f2e'], [60, '#ff4b3e'], [80, '#d02fd0'], [100, '#ffffff']];
  const TEMP = [[-5, '#8e6bd8'], [2, '#3d7bd9'], [10, '#26c6da'], [18, '#7bd36b'], [25, '#f5e33a'], [32, '#ff9f2e'], [40, '#e53935']];
  const hex2rgb = h => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  function ramp(stops, v) {
    if (!(v > stops[0][0])) return stops[0][1];
    for (let i = 1; i < stops.length; i++) {
      if (v <= stops[i][0]) {
        const a = stops[i - 1], b = stops[i], t = (v - a[0]) / (b[0] - a[0]), A = hex2rgb(a[1]), B = hex2rgb(b[1]);
        return 'rgb(' + A.map((x, k) => Math.round(x + (B[k] - x) * t)).join(',') + ')';
      }
    }
    return stops[stops.length - 1][1];
  }
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const SEV = { 1: ['Amarillo', '#ffd600'], 2: ['Naranja', '#ff9100'], 3: ['Rojo', '#ff1744'] };
  function sevLevel(a) { const s = String(a.severity || '').toLowerCase(); return /extreme|severe/.test(s) ? 3 : /moderate/.test(s) ? 2 : 1; }
  function alertType(a) {
    const t = (a.event + ' ' + a.title + ' ' + a.desc).toLowerCase();
    if (/zonda/.test(t)) return 'zonda';
    if (/helada|temperaturas? m[ií]nimas?/.test(t)) return 'frost';
    if (/granizo/.test(t)) return 'hail';
    if (/tormenta|lluvia/.test(t)) return 'stormStrong';
    if (/viento/.test(t)) return 'wind';
    if (/calor/.test(t)) return 'heat';
    if (/nieve|nevada/.test(t)) return 'snow';
    return null;
  }
  const TYPE_ICON = { zonda: '🌬', frost: '🥶', hail: '🧊', stormStrong: '⛈', wind: '💨', heat: '🥵', snow: '❄️' };
  const TYPE_PLAIN = {
    zonda: 'El Zonda es un viento cálido, seco y fuerte que baja de la cordillera. Sube la temperatura, baja la humedad y levanta polvo.',
    frost: 'Se espera que la temperatura baje a 0 °C o menos. Puede dañar cultivos y plantas sensibles.',
    hail: 'Hay riesgo de caída de granizo, que puede dañar cultivos, techos y vehículos.',
    stormStrong: 'Tormenta fuerte: lluvia intensa, ráfagas y posible caída de granizo en poco tiempo.',
    wind: 'Ráfagas fuertes que pueden mover objetos sueltos y tirar ramas o cables.',
    heat: 'Temperaturas muy altas: tomá agua, evitá el sol del mediodía y cuidá a chicos y mayores.',
    snow: 'Posibles nevadas: cuidado en rutas de montaña y con el frío.'
  };
  function pointInPoly(lat, lon, pts) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i], b = pts[j];
      if (((a[1] > lon) !== (b[1] > lon)) && (lat < (b[0] - a[0]) * (lon - a[1]) / ((b[1] - a[1]) || 1e-12) + a[0])) inside = !inside;
    }
    return inside;
  }
  function covers(a, lat, lon) {
    if ((a.polys || []).some(p => pointInPoly(lat, lon, p))) return true;
    return (a.circles || []).some(c => Math.hypot((lon - c.lon) * 111.32 * Math.cos(lat * D2R), (lat - c.lat) * 111.32) <= c.km);
  }

  /* ---- grilla de viento/temperatura: interpolación ---- */
  function makeGrid(b, cols, rows, cells) {
    // b = {n,s,w,e}; cells[r*cols+c] con u,v (km/h hacia donde va), su,sv (altura), t, cl, gu
    return { b, cols, rows, cells, lat0: b.n, lon0: b.w, dlat: (b.n - b.s) / (rows - 1), dlon: (b.e - b.w) / (cols - 1) };
  }
  function sample(G, lat, lon) {
    if (!G) return null;
    const fc = Math.max(0, Math.min(G.cols - 1, (lon - G.lon0) / G.dlon));
    const fr = Math.max(0, Math.min(G.rows - 1, (G.lat0 - lat) / G.dlat));
    const c0 = Math.floor(fc), r0 = Math.floor(fr), c1 = Math.min(G.cols - 1, c0 + 1), r1 = Math.min(G.rows - 1, r0 + 1), tx = fc - c0, ty = fr - r0;
    const g = (r, c) => G.cells[r * G.cols + c];
    const mix = k => { const a = g(r0, c0)[k], b = g(r0, c1)[k], c = g(r1, c0)[k], d = g(r1, c1)[k]; return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty; };
    const u = mix('u'), v = mix('v'), su = mix('su'), sv = mix('sv');
    return { u, v, speed: Math.hypot(u, v), toward: toward(u, v), gust: mix('gu'), t: mix('t'), cl: mix('cl'), su, sv, sspeed: Math.hypot(su, sv), stoward: toward(su, sv) };
  }
  function parseGrid(json, b, cols, rows) {
    const arr = Array.isArray(json) ? json : [json];
    if (arr.length !== cols * rows) throw new Error('grilla incompleta');
    const cells = arr.map(o => {
      const c = (o && o.current) || {}, h = (o && o.hourly) || {};
      const num = x => (typeof x === 'number' && isFinite(x)) ? x : null;
      const ws = num(c.wind_speed_10m) || 0, wd = num(c.wind_direction_10m) || 0;
      const sw = num(h.wind_speed_700hPa && h.wind_speed_700hPa[0]) || 0, sd = num(h.wind_direction_700hPa && h.wind_direction_700hPa[0]) || 0;
      const tw = (wd + 180) % 360, ts = (sd + 180) % 360;
      const t = num(c.temperature_2m), cl = num(c.cloud_cover), gu = num(c.wind_gusts_10m);
      return { u: ws * Math.sin(tw * D2R), v: ws * Math.cos(tw * D2R), su: sw * Math.sin(ts * D2R), sv: sw * Math.cos(ts * D2R), t: t == null ? NaN : t, cl: cl == null ? 0 : cl, gu: gu == null ? ws : gu };
    });
    return makeGrid(b, cols, rows, cells);
  }

  const API = { pt8, fromWords, toWords, toward, windClass, wxText, ramp, WIND, TEMP, sevLevel, alertType, covers, makeGrid, sample, parseGrid, pointInPoly, esc };
  root.__mx = API;

  if (typeof document === 'undefined' || typeof L === 'undefined' || typeof map === 'undefined') return;

  /* ===================== interfaz ===================== */
  const $ = id => document.getElementById(id);
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const LSg = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
  const LSs = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } };
  const safe = (name, fn) => { try { return fn(); } catch (e) { try { console.error('ui2:' + name, e); } catch (x) { } } };
  const buzz = () => { try { if (typeof hap === 'function') hap(); } catch (e) { } };
  const mapWrap = $('mapWrap');
  document.body.classList.add('mx');

  let toastT = 0, toastEl = null;
  function toast(msg) {
    if (!toastEl) { toastEl = el('div', 'mx-toast'); document.body.appendChild(toastEl); }
    toastEl.textContent = msg; toastEl.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('show'), 2800);
  }
  window.mxToast = msg => toast(msg); // 1.14.3: el radar avisa por aca (el texto #rt esta oculto con la interfaz nueva)

  const recent = [];
  const S = Object.assign({ wind: false, dir: false, temp: false, smn: false }, LSg('mx_layers', {}));
  if (!LSg('mx_perf_1133', false)) { S.wind = false; LSs('mx_layers', S); LSs('mx_perf_1133', true); } // 1.13.3: el viento animado arranca apagado (pesa mucho); se enciende desde Capas
  const click = id => { const b = $(id); if (b) b.click(); };
  const arrowSvg = (deg, color, size) => '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '" style="transform:rotate(' + deg + 'deg)"><path d="M12 2 L19 21 L12 16.5 L5 21 Z" fill="' + color + '" stroke="#06121f" stroke-width="1.5" stroke-linejoin="round"/></svg>';
  const fmtTime = ms => ms ? new Date(ms).toLocaleString('es-AR', { weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';

  /* ---------- mapas base ---------- */
  const BASES = {
    streets: { label: 'Calles', bg: 'linear-gradient(135deg,#e8e4d8,#b8d4a8)', url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', opt: { maxZoom: 19, attribution: '© OpenStreetMap' } },
    sat: { label: 'Satélite', bg: 'linear-gradient(135deg,#27401f,#6b5a3a)', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', opt: { maxZoom: 18, attribution: 'Imágenes © Esri' } },
    topo: { label: 'Relieve', bg: 'linear-gradient(135deg,#d9c7a0,#8fb58a)', url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', opt: { subdomains: 'abc', maxZoom: 17, attribution: '© OpenStreetMap · OpenTopoMap' } }
  };
  let baseKey = LSg('mx_base2', 'streets'), baseL = null;
  function setBase(k) {
    if (!BASES[k]) k = 'streets';
    baseKey = k; LSs('mx_base2', k);
    map.eachLayer(l => { if (l._url && /openstreetmap\.org|cartocdn|arcgisonline|opentopomap/.test(l._url)) map.removeLayer(l); });
    const b = BASES[k]; baseL = L.tileLayer(b.url, Object.assign({ zIndex: 1, keepBuffer: 1, updateWhenZooming: false }, b.opt)); baseL.addTo(map);
    if (baseL.bringToBack) baseL.bringToBack();
    syncUI();
  }

  /* ---------- grilla meteorológica (Open-Meteo) ---------- */
  const COLS = 6, ROWS = 8;
  let G = null, gridAt = 0, gridZ = 0, gridBusy = null, gridErrAt = 0;
  const gridNeeded = () => S.wind || S.dir || S.temp;
  async function loadGrid(force) {
    const bd = map.getBounds(), z = map.getZoom();
    if (!force && G && Date.now() - gridAt < 10 * 60e3 && Math.abs(z - gridZ) <= 1 &&
      bd.getSouth() >= G.b.s && bd.getNorth() <= G.b.n && bd.getWest() >= G.b.w && bd.getEast() <= G.b.e) return G;
    if (gridBusy) return gridBusy;
    if (Date.now() - gridErrAt < 60e3 && G) return G;
    gridBusy = (async () => {
      const pad = .18, dLat = bd.getNorth() - bd.getSouth(), dLon = bd.getEast() - bd.getWest();
      const b = { s: Math.max(-85, bd.getSouth() - dLat * pad), n: Math.min(85, bd.getNorth() + dLat * pad), w: Math.max(-180, bd.getWest() - dLon * pad), e: Math.min(180, bd.getEast() + dLon * pad) };
      const lats = [], lons = [];
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
        lats.push((b.n - (b.n - b.s) * r / (ROWS - 1)).toFixed(3)); lons.push((b.w + (b.e - b.w) * c / (COLS - 1)).toFixed(3));
      }
      const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + lats.join(',') + '&longitude=' + lons.join(',') +
        '&current=temperature_2m,cloud_cover,wind_speed_10m,wind_direction_10m,wind_gusts_10m&hourly=wind_speed_700hPa,wind_direction_700hPa&forecast_hours=1&wind_speed_unit=kmh';
      const ac = new AbortController(), t = setTimeout(() => ac.abort(), 14000);
      try {
        const r = await fetch(url, { signal: ac.signal });
        if (r.status === 429) throw new Error('limit');
        if (!r.ok) throw new Error('HTTP ' + r.status);
        G = parseGrid(await r.json(), b, COLS, ROWS); gridAt = Date.now(); gridZ = z; gridErrAt = 0;
        return G;
      } catch (e) { gridErrAt = Date.now(); toast(e.message === 'limit' ? 'El proveedor de datos pidió esperar. Reintento en unos minutos.' : 'No pude traer los datos de viento ahora.'); return G; }
      finally { clearTimeout(t); gridBusy = null; }
    })();
    return gridBusy;
  }
  const smp = (lat, lon) => sample(G, lat, lon);

  /* ---------- viento animado (partículas) ---------- */
  const cv = el('canvas', 'mx-cv'); mapWrap.insertBefore(cv, $('map').nextSibling); const ctx = cv.getContext('2d');
  let W = 0, H = 0, FW = 0, FH = 0, field = null, parts = [], raf = 0, lastT = 0, running = false;
  const CELL = 18, PXS = 2.6, NB = 24;
  const BINCOL = Array.from({ length: NB }, (_, i) => ramp(WIND, i * 4.5 + 2));
  const reduceMotion = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } };
  function sizeCanvas() {
    const r = mapWrap.getBoundingClientRect(), dpr = 1;
    W = Math.max(1, Math.round(r.width)); H = Math.max(1, Math.round(r.height));
    cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px'; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function buildField() {
    FW = Math.ceil(W / CELL) + 2; FH = Math.ceil(H / CELL) + 2; field = new Float32Array(FW * FH * 2);
    for (let j = 0; j < FH; j++) for (let i = 0; i < FW; i++) {
      const ll = map.containerPointToLatLng([i * CELL, j * CELL]), s = smp(ll.lat, ll.lng);
      field[(j * FW + i) * 2] = s ? s.u : 0; field[(j * FW + i) * 2 + 1] = s ? s.v : 0;
    }
  }
  function vec(x, y, out) {
    const fx = Math.max(0, Math.min(FW - 1.001, x / CELL)), fy = Math.max(0, Math.min(FH - 1.001, y / CELL));
    const i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j, k = (j * FW + i) * 2, k2 = k + FW * 2;
    for (let q = 0; q < 2; q++) out[q] = (field[k + q] * (1 - tx) + field[k + 2 + q] * tx) * (1 - ty) + (field[k2 + q] * (1 - tx) + field[k2 + 2 + q] * tx) * ty;
  }
  const rnd = (a, b) => a + Math.random() * (b - a);
  function seed(p) { p.x = rnd(0, W); p.y = rnd(0, H); p.age = 0; p.max = rnd(35, 110); return p; }
  function initParts() { const n = Math.min(650, Math.round(W * H / 700)); parts = Array.from({ length: n }, () => seed({})); }
  const tmp = [0, 0];
  function frame(t) {
    raf = requestAnimationFrame(frame);
    if (!running || document.hidden || !field) return;
    if (t - lastT < 45) return;
    const dt = Math.min(0.06, (t - lastT) / 1000); lastT = t;
    ctx.globalCompositeOperation = 'destination-out'; ctx.fillStyle = 'rgba(0,0,0,0.11)'; ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over'; ctx.lineWidth = 1.5; ctx.lineCap = 'round';
    const bins = Array.from({ length: NB }, () => []);
    for (const p of parts) {
      vec(p.x, p.y, tmp);
      const sp = Math.hypot(tmp[0], tmp[1]), nx = p.x + tmp[0] * PXS * dt, ny = p.y - tmp[1] * PXS * dt;
      bins[Math.min(NB - 1, Math.floor(sp / 4.5))].push(p.x, p.y, nx, ny);
      p.x = nx; p.y = ny; p.age++;
      if (p.age > p.max || nx < -5 || ny < -5 || nx > W + 5 || ny > H + 5) seed(p);
    }
    for (let i = 0; i < NB; i++) {
      const s = bins[i]; if (!s.length) continue;
      ctx.strokeStyle = BINCOL[i]; ctx.beginPath();
      for (let k = 0; k < s.length; k += 4) { ctx.moveTo(s[k], s[k + 1]); ctx.lineTo(s[k + 2], s[k + 3]); }
      ctx.stroke();
    }
  }
  function startWind() {
    if (!G || reduceMotion()) return;
    sizeCanvas(); buildField(); initParts(); ctx.clearRect(0, 0, W, H); running = true; cv.style.display = 'block';
    if (!raf) raf = requestAnimationFrame(frame);
  }
  function pauseWind() { running = false; ctx.clearRect(0, 0, W, H); }
  function stopWind() { running = false; if (raf) { cancelAnimationFrame(raf); raf = 0; } ctx.clearRect(0, 0, W, H); cv.style.display = 'none'; }

  /* ---------- marcadores: flechas de viento, rumbo de nubes, temperatura ---------- */
  const windG = L.layerGroup(), dirG = L.layerGroup(), tempG = L.layerGroup(), smnG = L.layerGroup();
  function cellLL(r, c) { return [G.lat0 - G.dlat * r, G.lon0 + G.dlon * c]; }
  function drawMarkers() {
    [windG, dirG, tempG].forEach(g => g.clearLayers());
    if (!G) return;
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const cell = G.cells[r * COLS + c], ll = cellLL(r, c);
      const sp = Math.hypot(cell.u, cell.v);
      if (S.wind && r % 2 === 1 && c % 2 === 1) {
        const col = ramp(WIND, sp);
        L.marker(ll, { interactive: false, keyboard: false, icon: L.divIcon({ className: '', iconSize: [46, 46], iconAnchor: [23, 23], html: '<div class="mx-m">' + arrowSvg(toward(cell.u, cell.v), col, 26) + '<b>' + Math.round(sp) + '</b></div>' }) }).addTo(windG);
      }
      if (S.dir && r % 2 === 0 && c % 2 === 0) {
        const ss = Math.hypot(cell.su, cell.sv);
        L.marker(ll, { interactive: false, keyboard: false, icon: L.divIcon({ className: '', iconSize: [54, 54], iconAnchor: [27, 27], html: '<div class="mx-m dir">' + arrowSvg(toward(cell.su, cell.sv), '#ffffff', 34) + '<b>' + pt8(toward(cell.su, cell.sv))[0] + ' ' + Math.round(ss) + '</b></div>' }) }).addTo(dirG);
      }
      if (S.temp && (r + c) % 2 === 1 && isFinite(cell.t)) {
        L.marker(ll, { interactive: false, keyboard: false, icon: L.divIcon({ className: '', iconSize: [38, 24], iconAnchor: [19, 12], html: '<div class="mx-t" style="background:' + ramp(TEMP, cell.t) + '">' + Math.round(cell.t) + '°</div>' }) }).addTo(tempG);
      }
    }
  }
  function applyGroups() {
    const set = (g, on) => { const has = map.hasLayer(g); if (on && !has) g.addTo(map); if (!on && has) map.removeLayer(g); };
    set(windG, S.wind && !!G); set(dirG, S.dir && !!G); set(tempG, S.temp && !!G);
  }
  async function refreshGrid(force) {
    if (!gridNeeded()) { stopWind(); applyGroups(); return; }
    await loadGrid(force);
    drawMarkers(); applyGroups();
    if (S.wind && G) startWind(); else stopWind();
  }
  let mvT = 0;
  map.on('movestart zoomstart', () => { if (S.wind) pauseWind(); });
  map.on('moveend zoomend', () => { clearTimeout(mvT); mvT = setTimeout(() => safe('moved', () => refreshGrid(false)), 350); });
  root.addEventListener('resize', () => { clearTimeout(mvT); mvT = setTimeout(() => safe('resize', () => { if (S.wind && G) startWind(); }), 300); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && S.wind && G) startWind(); });

  function pointHtml(s, lat, lon) {
    const wc = windClass(s.speed), sc = windClass(s.sspeed);
    return '<b>📍 En este punto (aproximado)</b><br>' +
      (isFinite(s.t) ? '🌡 <b>' + Math.round(s.t) + '°C</b> · ' : '') + '☁ nubosidad ' + Math.round(s.cl) + '%<br>' +
      '💨 <b>' + Math.round(s.speed) + ' km/h</b> · ' + wc[0] + '<br><span style="color:#9fb4c8">Viene ' + fromWords((s.toward + 180) % 360) + ' y va ' + toWords((s.toward + 180) % 360) + '. Ráfagas hasta ' + Math.round(s.gust) + ' km/h.</span><br>' +
      '🧭 Las nubes altas se mueven <b>' + toWords((s.stoward + 180) % 360) + '</b> a unos ' + Math.round(s.sspeed) + ' km/h (' + sc[0].toLowerCase() + ' en altura).' +
      '<div style="font-size:10px;color:#9fb4c8;margin-top:5px">Estimación de modelo meteorológico, no una medición exacta del lugar.</div>';
  }
  /* 1.13.1: se quitó la tarjeta que se abría al tocar el mapa (ya está la tarjeta "Ahora" y el clima por horas). */

  /* ---------- avisos SMN en el mapa ---------- */
  let smnData = null, smnAt = 0, smnBusy = null;
  async function loadSmn(force) {
    if (!force && smnData && Date.now() - smnAt < 5 * 60e3) return smnData;
    if (smnBusy) return smnBusy;
    smnBusy = (async () => {
      try { smnData = await root.fetchOfficialAlertGeometry(); smnAt = Date.now(); smnData.error = false; return smnData; }
      catch (e) { const d = smnData || []; d.error = true; smnData = d; smnAt = Date.now() - 4 * 60e3; return d; }
      finally { smnBusy = null; }
    })();
    return smnBusy;
  }
  function alertPopup(a) {
    const lv = sevLevel(a), s = SEV[lv];
    return '<b>' + esc(a.title) + '</b><br><span class="mx-lv" style="--lv:' + s[1] + '">' + s[0] + '</span> ' + esc(a.area) +
      (a.expires ? '<br><small>Vigente hasta ' + esc(fmtTime(a.expires)) + '</small>' : '') +
      (a.desc ? '<br>' + esc(a.desc.slice(0, 240)) + (a.desc.length > 240 ? '…' : '') : '') + '<br><a href="' + esc(a.url) + '" target="_blank" rel="noopener">Ver aviso completo (SMN)</a>';
  }
  async function applySmn() {
    smnG.clearLayers();
    if (!S.smn) { if (map.hasLayer(smnG)) map.removeLayer(smnG); return; }
    if (!map.hasLayer(smnG)) smnG.addTo(map);
    const data = await loadSmn(false);
    smnG.clearLayers();
    data.forEach(a => {
      const col = SEV[sevLevel(a)][1], st = { color: col, weight: 2, fillColor: col, fillOpacity: .22 };
      a.polys.forEach(p => L.polygon(p, st).bindPopup(alertPopup(a), { className: 'mx-pop', maxWidth: 270 }).addTo(smnG));
      a.circles.forEach(c => L.circle([c.lat, c.lon], Object.assign({ radius: c.km * 1000 }, st)).bindPopup(alertPopup(a), { className: 'mx-pop', maxWidth: 270 }).addTo(smnG));
    });
    if (data.error) toast('No pude consultar los avisos del SMN ahora.');
    else if (!data.length) toast('El SMN no informa avisos vigentes.');
    syncUI();
  }
  setInterval(() => { if (S.smn) safe('smn', applySmn); }, 6 * 60e3);

  /* ---------- estado de capas existentes ---------- */
  const st = {
    ir: () => typeof irOn !== 'undefined' && irOn,
    vis: () => typeof visibleOn !== 'undefined' && visibleOn,
    rain: () => typeof radarOn !== 'undefined' && radarOn,
    anim: () => typeof radarTimer !== 'undefined' && !!radarTimer
  };
  function setExisting(key, id, want) { if (st[key]() !== want) click(id); }
  function setLayer(k, v) {
    buzz();
    if (v) bump(k);
    if (k === 'ir') setExisting('ir', 'clouds', v);
    else if (k === 'vis') setExisting('vis', 'visible', v);
    else if (k === 'rain') { if (!v && st.anim()) click('rplay'); setExisting('rain', 'radar', v); }
    else if (k === 'anim') { if (v && !st.rain()) { click('rplay'); } else if (v !== st.anim()) click('rplay'); }
    else if (k === 'esc') click('esc');
    else { S[k] = v; LSs('mx_layers', S); if (k === 'smn') safe('smn', applySmn); else safe('grid', () => refreshGrid(false)); }
    setTimeout(syncUI, 60);
  }
  const isOn = k => (k in S) ? S[k] : (st[k] ? st[k]() : (k === 'esc' ? !!($('esc') && $('esc').classList.contains('on')) : false));

  /* ---------- dock ---------- */
  const dock = el('div', 'mx-dock'); dock.setAttribute('role', 'toolbar'); dock.setAttribute('aria-label', 'Capas del mapa');
  const CHIPS = [
    ['ir', '☁️', 'Nubes'], ['rain', '🌧', 'Lluvia'], ['wind', '💨', 'Viento'], ['dir', '🧭', 'Rumbo'], ['temp', '🌡', 'Temp.'], ['act:alerts', '🚨', 'Alertas']
  ];
  CHIPS.forEach(([k, ic, tx]) => {
    const b = el('button', 'mx-chip' + (k.startsWith('act:') ? ' act' : ''), '<span class="ic">' + ic + '</span><span class="tx">' + tx + '</span>');
    b.type = 'button'; b.dataset.k = k;
    b.onclick = () => {
      buzz();
      if (k === 'act:alerts') openOfficial('now');
      else setLayer(k, !isOn(k));
    };
    dock.appendChild(b);
  });
  mapWrap.appendChild(dock);

  /* ---------- botones flotantes ---------- */
  const fabs = el('div', 'mx-fabs');
  const mkFab = (cls, html, label, fn) => { const b = el('button', 'mx-fab ' + cls, html); b.type = 'button'; b.setAttribute('aria-label', label); b.onclick = () => { buzz(); fn(); }; return b; };
  fabs.appendChild(mkFab('main', '🗺', 'Capas y estilo de mapa', () => openSheet('layers')));
  fabs.appendChild(mkFab('', '📍', 'Ir a mi ubicación', () => { click('locMe'); setTimeout(() => { try { const p = cur(); if (p && p.lat != null) map.setView([p.lat, p.lon], Math.max(map.getZoom(), 9)); } catch (e) { } }, 250); }));
  const zoom = el('div', 'mx-zoom'); const zi = el('button', '', '+'), zo = el('button', '', '−'); zi.type = zo.type = 'button';
  zi.setAttribute('aria-label', 'Acercar'); zo.setAttribute('aria-label', 'Alejar'); zi.onclick = () => map.zoomIn(); zo.onclick = () => map.zoomOut(); zoom.append(zi, zo); fabs.appendChild(zoom);
  const fullB = mkFab('', '⛶', 'Mapa en pantalla completa', () => { const on = document.body.classList.toggle('mx-full'); fullB.classList.toggle('on', on); setTimeout(() => { map.invalidateSize(); sizeCanvas(); if (S.wind && G) startWind(); }, 120); });
  let trS = null; // la hoja se crea al primer toque (mkSheet usa constantes que se definen más abajo)
  fabs.appendChild(mkFab('', '🚚', 'Modo transporte', () => { try { if (!trS) trS = mkSheet('transport', '🚚 Modo transporte'); if (root.CMT) root.CMT.mount(trS.querySelector('.mx-body'), closeSheets); openSheet('transport'); } catch (e) { } }));
  fabs.appendChild(fullB); mapWrap.appendChild(fabs);

  /* ---------- tarjeta "Ahora" ---------- */
  const hud = el('div', 'mx-hud' + (LSg('mx_hudmin', false) ? ' min' : '')); hud.setAttribute('role', 'button'); hud.tabIndex = 0;
  hud.onclick = e => {
    if (e.target.closest && e.target.closest('.hrBtn')) { e.stopPropagation(); buzz(); openHourly(); return; }
    hud.classList.toggle('min'); LSs('mx_hudmin', hud.classList.contains('min'));
  };
  mapWrap.appendChild(hud);
  function refreshHUD() {
    const c = (typeof lastC !== 'undefined' && lastC) || (!root.hudWait && typeof last !== 'undefined' && last && last[0] && last[0].c);
    let name = ''; try { name = cur().name; } catch (e) { }
    if (!c) { hud.innerHTML = '<div class="r1"><b>TiempoMDZ</b></div><div class="r2"><span class="wx">Buscando datos del tiempo…</span></div>'; return; }
    const ob = root.metarLive && root.metarLive(root.mainObsSummary), rn = root.mainRadarNow;
    let w = wxText(c.weather_code), rainTxt = null;
    if (c.is_day === 0 && (c.weather_code === 0 || c.weather_code === 1)) w = ['🌙', c.weather_code === 0 ? 'Despejado' : 'Mayormente despejado'];
    if (ob && ob.phase === 'ahora') { w = [ob.icon, ob.text + ' (en el aeropuerto)']; if (ob.rain) rainTxt = '🌧 llueve en el aeropuerto'; }
    if (rn && rn.rain) { w = ['🌦️', (rn.level >= 3 ? 'Lluvia intensa' : 'Lluvia detectada') + ' (radar)']; rainTxt = '🌧 llueve ahora (radar)'; }
    const sp = Math.round(c.wind_speed_10m || 0), wc = windClass(sp), dir = c.wind_direction_10m;
    const nAl = (typeof curEvents !== 'undefined' && curEvents) ? curEvents.length : 0;
    const rain = Number(c.precipitation || 0);
    hud.innerHTML = '<div class="r1">📍 <b>' + esc(name || 'Tu ubicación') + '</b>' + (nAl ? '<span class="badge">' + nAl + ' aviso' + (nAl > 1 ? 's' : '') + '</span>' : '') + '</div>' +
      '<div class="r2"><span class="big">' + Math.round(c.temperature_2m) + '<sup>°C</sup></span><span class="wx"><i>' + w[0] + '</i>' + w[1] + '</span></div>' +
      '<div class="r3"><span class="wd">' + (dir != null ? arrowSvg(((dir + 180) % 360), ramp(WIND, sp), 22) : '💨') + '</span><span><b>' + sp + ' km/h</b> · ' + wc[0] +
      (dir != null ? '<br><small style="color:#9fb4c8">viene ' + fromWords(dir) + ' · ráfagas ' + Math.round(c.wind_gusts_10m || sp) + '</small>' : '') + '</span></div>' +
      (ob ? '<div class="obs">✈ ' + esc(ob.src) + ': ' + esc(ob.text.toLowerCase()) + '</div>' + (ob.rain ? (root.obsAnswered === ob.icao + ':' + ob.t ? '<div class="obsfb"><span>Gracias, anotado 👍</span></div>' : '<div class="obsfb"><span>¿Llueve donde estás?</span><button type="button" data-fb="si">Sí</button><button type="button" data-fb="no">No</button></div>') : '') : (root.mainObsStatus ? '<div class="obs dim">✈ ' + esc(root.mainObsStatus) + '</div>' : '')) +
      (rn && rn.available ? '<div class="obs dim">📡 Radar (hace ' + rn.ageMin + ' min): ' + (rn.rain ? 'lluvia sobre tu ubicación' : 'sin lluvia detectada') + '</div>' : '') + '<div class="r4"><span>☁ ' + Math.round(c.cloud_cover || 0) + '%</span><span>💧 ' + Math.round(c.relative_humidity_2m || 0) + '%</span><span>' + (rain > 0 ? '🌧 ' + rain + ' mm' : (rainTxt || '☂️ sin lluvia')) + '</span></div>' +
      '<button type="button" class="hrBtn">🕐 Clima del día</button>' +
      '<div class="tap">Tocá para achicar</div>';
    const chipAl = dock.querySelector('[data-k="act:alerts"]'); if (chipAl) chipAl.classList.toggle('hot', nAl > 0);
  }
  hud.addEventListener('click', e => { const b = e.target.closest && e.target.closest('[data-fb]'); if (!b) return; e.stopPropagation(); buzz(); try { root.obsFeedback(b.dataset.fb); } catch (x) { } }, true);
  let hudT = 0; const hudDeb = () => { clearTimeout(hudT); hudT = setTimeout(() => safe('hud', refreshHUD), 400); };
  root.onQuickWeather = () => safe('hud', refreshHUD);
  ['chips', 'al'].forEach(id => { const n = $(id); if (n) new MutationObserver(hudDeb).observe(n, { childList: true, subtree: true, characterData: true }); });
  setInterval(() => safe('hud', refreshHUD), 15000);

  /* ---------- leyendas ---------- */
  const legBox = el('div', 'mx-leg'); mapWrap.appendChild(legBox);
  const bump = k => { const i = recent.indexOf(k); if (i >= 0) recent.splice(i, 1); recent.unshift(k); };
  const grad = stops => 'linear-gradient(90deg,' + stops.map(s => s[1]).join(',') + ')';
  const LEG = {
    ir: () => '<b>☁️ Nubes (satélite infrarrojo)</b><div class="bar" style="background:linear-gradient(90deg,#3d7bd9,#2fbf71,#f2e63a,#f29a2e,#e03a3a,#c22fc2,#fff)"></div><div class="tk"><span>Poca nube</span><span>Nube alta</span><span>Tormenta fuerte</span></div><p>Cuanto más cálido el color (naranja, rojo, violeta) más alta y fría es la nube, y más probable que sea una tormenta.</p>',
    vis: () => '<b>🌤 Nubes visibles</b><p>Foto real del satélite, solo de día. Las nubes se ven blancas.</p>',
    rain: () => '<b>🌧 Lluvia (radar)</b><div class="bar" style="background:linear-gradient(90deg,#9fd3ff,#3d8bff,#27c46b,#f2e63a,#ff9f2e,#e53935)"></div><div class="tk"><span>Llovizna</span><span>Moderada</span><span>Intensa</span></div><p>' + esc(($('rt') && $('rt').textContent) || '') + '</p>',
    wind: () => '<b>💨 Viento a 10 m</b><div class="bar" style="background:' + grad(WIND) + '"></div><div class="tk"><span>0</span><span>20</span><span>45</span><span>80+ km/h</span></div><p>Las líneas en movimiento muestran hacia dónde sopla. Los números son km/h. Tocá el mapa para ver el detalle de ese lugar.</p>',
    dir: () => '<b>🧭 Rumbo de las nubes</b><div class="dots"><span>➤ Flecha: hacia dónde se mueven</span><span>Número: km/h</span></div><p>Viento a ~3.000 m de altura, el que empuja nubes y tormentas. Una tormenta suele seguir ese rumbo.</p>',
    temp: () => '<b>🌡 Temperatura</b><div class="bar" style="background:' + grad(TEMP) + '"></div><div class="tk"><span>-5°</span><span>10°</span><span>25°</span><span>40°</span></div>',
    smn: () => '<b>🇦🇷 Avisos del SMN</b><div class="dots"><span><i style="background:#ffd600"></i>Amarillo</span><span><i style="background:#ff9100"></i>Naranja</span><span><i style="background:#ff1744"></i>Rojo</span></div><p>Tocá una zona coloreada para leer el aviso.</p>'
  };
  function refreshLegend() {
    legBox.innerHTML = ''; return; // 1.12: las barras de colores no se muestran
    const rank = k => { const i = recent.indexOf(k); return i < 0 ? 99 : i; };
    const act = ['smn', 'temp', 'dir', 'wind', 'rain', 'ir'].filter(isOn).sort((a, b) => rank(a) - rank(b)).slice(0, 2).reverse();
    legBox.innerHTML = ''; act.forEach((k, i) => legBox.appendChild(el('div', 'mx-lg', i === act.length - 1 ? LEG[k]() : LEG[k]().replace(/<p>[\s\S]*<\/p>/, ''))));
  }
  if ($('rt')) new MutationObserver(() => { if (isOn('rain')) refreshLegend(); }).observe($('rt'), { childList: true, characterData: true, subtree: true });

  /* ---------- hojas ---------- */
  const back = el('div', 'mx-back'); document.body.appendChild(back);
  const sheets = {};
  function mkSheet(id, title) {
    const s = el('div', 'mx-sheet'); s.id = 'mx-' + id; s.setAttribute('role', 'dialog'); s.setAttribute('aria-label', title);
    s.innerHTML = '<div class="mx-grab"></div><h3>' + title + '<button type="button" class="mx-x" aria-label="Cerrar">✕</button></h3><div class="mx-body"></div>';
    s.querySelector('.mx-x').onclick = closeSheets; document.body.appendChild(s); sheets[id] = s; return s;
  }
  function closeSheets() { Object.values(sheets).forEach(s => s.classList.remove('show')); back.classList.remove('show'); }
  back.onclick = closeSheets;
  function openSheet(id) { closeSheets(); if (id === 'layers') buildLayers(); sheets[id].classList.add('show'); back.classList.add('show'); sheets[id].scrollTop = 0; syncUI(); }

  /* hoja de capas */
  function buildLayers() {
    const body = sheets.layers.querySelector('.mx-body');
    const rows = [
      ['Nubes y lluvia', [['ir', '☁️', 'Nubes del satélite', 'Muestra dónde hay nubes y qué tan altas son.'], ['vis', '🌤', 'Nubes visibles (de día)', 'Foto real del satélite GOES.'], ['rain', '🌧', 'Lluvia en el radar', 'Dónde está lloviendo ahora.'], ['anim', '⏯', 'Animar la lluvia', 'Reproduce las últimas imágenes de radar.']]],
      ['Viento y temperatura', [['wind', '💨', 'Viento animado', 'Líneas que fluyen según el viento, con su velocidad.'], ['dir', '🧭', 'Rumbo de nubes y tormentas', 'Flechas del viento en altura: hacia dónde van las nubes.'], ['temp', '🌡', 'Temperatura', 'Grados en distintos puntos del mapa.']]],
      ['Avisos oficiales', [['smn', '🇦🇷', 'Zonas con aviso del SMN', 'Colorea las áreas con alerta amarilla, naranja o roja.'], ['esc', '🧭', 'Ruta de escape', 'Solo cuando hay una amenaza identificada.']]]
    ];
    let h = '<div class="mx-sec">Estilo de mapa</div><div class="mx-seg">' + Object.keys(BASES).map(k => '<button type="button" data-base="' + k + '"><i style="background:' + BASES[k].bg + '"></i>' + BASES[k].label + '</button>').join('') + '</div>';
    rows.forEach(([sec, list]) => {
      h += '<div class="mx-sec">' + sec + '</div>';
      list.forEach(([k, ic, t, sm]) => { h += '<div class="mx-row"><span class="ri">' + ic + '</span><span class="rt"><b>' + t + '</b><small>' + sm + '</small></span><button type="button" class="mx-sw" role="switch" aria-checked="false" aria-label="' + t + '" data-sw="' + k + '"></button></div>'; });
    });
    h += '<div class="mx-sec">Transparencia de nubes y lluvia</div><input class="mx-range" type="range" min="20" max="100" value="' + Math.round(op * 100) + '" aria-label="Transparencia"><div class="mx-note">Más a la izquierda se ve más el mapa de abajo.</div>';
    h += '<div class="mx-sec">Más información</div><a class="mx-btn" href="#" data-open="smn">🇦🇷 Avisos SMN</a><a class="mx-btn" href="#" data-open="mza">🏔 Contingencias Mendoza</a>';
    h += '<details class="mx-help"><summary>❓ ¿Cómo leo este mapa?</summary><p><b>Viento:</b> las líneas se mueven hacia donde va el viento; más cálido el color, más fuerte. <b>Rumbo de nubes:</b> flechas blancas que muestran hacia dónde avanzan las nubes altas. <b>Nubes (satélite):</b> naranja, rojo y violeta indican nubes muy altas y frías, típicas de tormentas. <b>Lluvia:</b> azul es débil, amarillo/rojo es intensa. <b>Tocá el mapa</b> para ver el viento, la temperatura y el rumbo de las nubes de ese lugar.</p><p>Los datos de viento y temperatura son estimaciones de modelos meteorológicos. Ante una alerta, seguí siempre las indicaciones oficiales.</p></details>';
    body.innerHTML = h;
    body.querySelectorAll('[data-base]').forEach(b => b.onclick = () => { buzz(); setBase(b.dataset.base); });
    body.querySelectorAll('[data-sw]').forEach(b => b.onclick = () => setLayer(b.dataset.sw, !isOn(b.dataset.sw)));
    body.querySelectorAll('[data-open]').forEach(a => a.onclick = e => { e.preventDefault(); openOfficial(a.dataset.open); });
    body.querySelector('.mx-range').oninput = e => { op = e.target.value / 100; LSs('mx_op', op); applyOpacity(); };
  }
  let op = LSg('mx_op', 0.65);
  function applyOpacity() {
    safe('op', () => {
      if (typeof irL !== 'undefined') irL.setOpacity(op);
      if (typeof visL !== 'undefined') visL.setOpacity(Math.min(1, op * .75));
      if (typeof radarLayer !== 'undefined' && radarLayer) radarLayer.setOpacity(Math.min(1, op + .05));
    });
  }
  // los cuadros de radar se crean de nuevo cada vez: se reaplica la transparencia
  if (typeof radarShow === 'function') { const orig = radarShow; root.radarShow = function (i) { const r = orig.apply(this, arguments); applyOpacity(); return r; }; }

  /* hoja de avisos oficiales */
  mkSheet('layers', '🗺 Mapa y capas');
  const offS = mkSheet('official', '🚨 Alertas');
  offS.querySelector('.mx-body').innerHTML = '<div class="mx-tabs"><button type="button" data-t="now">📍 Ahora</button><button type="button" data-t="hist">🕘 Recientes</button><button type="button" data-t="smn">SMN</button><button type="button" data-t="mza">Mendoza</button><button type="button" data-t="quakes">Sismos</button></div><div class="mx-pane"></div>';
  offS.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { buzz(); showTab(b.dataset.t); });
  function openOfficial(tab) { closeSheets(); offS.classList.add('show'); back.classList.add('show'); offS.scrollTop = 0; showTab(tab || 'now'); }
  let tabSeq = 0;
  function showTab(t) {
    const seq = ++tabSeq, pane = offS.querySelector('.mx-pane');
    offS.querySelectorAll('[data-t]').forEach(b => b.classList.toggle('on', b.dataset.t === t));
    if (t === 'now') tabNow(pane); else if (t === 'hist') tabHist(pane); else if (t === 'smn') tabSmn(pane, seq); else if (t === 'mza') tabMza(pane, seq); else tabQuakes(pane, seq);
  }
  const stillHere = seq => seq === tabSeq;
  const here = () => { try { return cur(); } catch (e) { return null; } };
  const LINKS_SMN = '<div><a class="mx-btn" href="https://www.smn.gob.ar/alertas" target="_blank" rel="noopener">⚠️ Alertas SMN</a><a class="mx-btn" href="https://ws2.smn.gob.ar/radar" target="_blank" rel="noopener">📡 Radar SMN</a><a class="mx-btn" href="https://www.smn.gob.ar/" target="_blank" rel="noopener">🌦 Pronóstico SMN</a></div>';
  function alertCard(a, mine) {
    const lv = sevLevel(a), s = SEV[lv], ty = alertType(a), tips = (root.TIPS || {});
    const plain = ty && TYPE_PLAIN[ty] ? TYPE_PLAIN[ty] : '';
    const doIt = a.instruction || (ty && tips[ty]) || '';
    const hz = root.humanize || (x => x), spk = (hz(a.title) + '. ' + (plain ? plain + ' ' : '') + (doIt ? 'Qué hacer: ' + hz(doIt) : '')).slice(0, 380);
    return '<div class="mx-card" style="--lv:' + s[1] + '"><h4>' + (ty ? TYPE_ICON[ty] + ' ' : '') + esc(a.title) + '</h4><div class="meta"><span class="mx-lv">' + s[0] + '</span>' + (mine ? '<b style="color:#ff8a95">Afecta tu ubicación</b> · ' : '') + esc(a.area) +
      (a.expires ? '<br>Vigente hasta ' + esc(fmtTime(a.expires)) : '') + '</div>' +
      (plain ? '<p>' + esc(plain) + '</p>' : '') + (a.desc ? '<p>' + esc(a.desc.slice(0, 420)) + (a.desc.length > 420 ? '…' : '') + '</p>' : '') +
      (doIt ? '<div class="do">✅ <b>Qué hacer:</b> ' + esc(String(doIt).slice(0, 400)) + '</div>' : '') +
      '<button type="button" class="mx-btn" data-say="' + esc(spk) + '">🔊 Leer en voz alta</button><a class="mx-btn" href="' + esc(a.url) + '" target="_blank" rel="noopener">Ver aviso completo</a></div>';
  }
  /* 1.13.2: "Ahora" = clima del lugar + alertas vigentes en palabras simples; "Recientes" = avisos que ya salieron. */
  /* 1.14.4: provincia y localidad del punto elegido (Nominatim, con cache) */
  const geoCache = {};
  const normTxt = x => String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  async function placeInfo(lat, lon) {
    const k = lat.toFixed(1) + ',' + lon.toFixed(1);
    if (geoCache[k]) return geoCache[k];
    const ac = new AbortController(), t = setTimeout(() => ac.abort(), 4500);
    try {
      const r = await fetch('https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=10&accept-language=es&lat=' + lat.toFixed(4) + '&lon=' + lon.toFixed(4), { signal: ac.signal });
      const a = ((await r.json()) || {}).address || {};
      const v = { city: a.city || a.town || a.village || a.municipality || a.county || '', state: String(a.state || '').replace(/^Provincia de /i, '') };
      if (v.state || v.city) geoCache[k] = v;
      return v;
    } catch (e) { return null; } finally { clearTimeout(t); }
  }
  function tabNow(pane) {
    const c = (typeof lastC !== 'undefined' && lastC) || null, p = here(), evs = (typeof curEvents !== 'undefined' && curEvents) || [];
    const col = l => l >= 3 ? '#ff4d5e' : l >= 2 ? '#ff9020' : '#ffd23f';
    let h = '<div class="mx-sec">📍 ' + esc((p && p.name) || 'Tu ubicación') + '</div>';
    if (c) {
      const w = wxText(c.weather_code), sp = Math.round(c.wind_speed_10m || 0), gu = Math.round(c.wind_gusts_10m || sp), dir = c.wind_direction_10m, rain = Number(c.precipitation || 0);
      h += '<div class="mx-card" style="--lv:#35b6ff"><h4>' + w[0] + ' ' + Math.round(c.temperature_2m) + ' grados · ' + esc(w[1]) + '</h4>' +
        '<p>💨 Viento a ' + sp + ' kilómetros por hora' + (dir != null ? ', ' + fromWords(dir) : '') + '. Ráfagas de hasta ' + gu + ' kilómetros por hora.</p>' +
        '<p>💧 Humedad ' + Math.round(c.relative_humidity_2m || 0) + '% · ☁ Nubes ' + Math.round(c.cloud_cover || 0) + '%' + (rain > 0 ? ' · 🌧 Lluvia ' + rain + ' mm' : '') + '</p></div>';
    } else h += '<div class="mx-empty">Buscando datos del tiempo…</div>';
    const ob = root.metarLive && root.metarLive(root.mainObsSummary);
    if (ob) h += '<div class="mx-card" style="--lv:#ffd23f"><h4>✈ ' + esc(ob.icon + ' ' + ob.text) + '</h4><p>' + esc(ob.src) + '. Es una medición real del aeropuerto, no de tu ubicación exacta.</p></div>';
    h += '<div class="mx-sec">Alertas en tu ubicación</div>';
    if (!evs.length) h += '<div class="mx-empty">✅ Sin alertas por ahora.</div>';
    else evs.forEach(e => { const q = root.plainEvent(e), ic = (root.TYPES[e.type] || {}).icon || '⚠️';
      h += '<div class="mx-card" style="--lv:' + col(e.level) + '"><h4>' + ic + ' ' + esc(q.title) + '</h4>' + (q.say ? '<p>' + esc(q.say) + '</p>' : '') + '<div class="do">✅ <b>Qué hacer:</b> ' + esc(q.todo) + '</div><button type="button" class="mx-btn" data-spk="' + evs.indexOf(e) + '">🔊 Leer en voz alta</button></div>'; });
    pane.innerHTML = h;
    if (p && p.lat != null) { const sec = pane.querySelector('.mx-sec'); placeInfo(p.lat, p.lon).then(i => { if (i && sec && sec.isConnected) sec.textContent = '📍 ' + [i.city, i.state].filter(Boolean).join(', '); }); }
    pane.querySelectorAll('[data-spk]').forEach(b => b.onclick = () => { buzz(); try { root.speakEvent(evs[+b.dataset.spk]); } catch (e) { } });
  }
  function tabHist(pane) {
    const AB = root.AndroidBridge; let a = [];
    try { a = JSON.parse((AB && AB.histGet) ? AB.histGet() : (localStorage.getItem('climaHist') || '[]')); } catch (e) { }
    let h = '';
    if (!a.length) h += '<div class="mx-empty">Todavía no hubo avisos. Acá vas a poder volver a leer los que aparecen y se van.</div>';
    a.forEach(it => { const parts = String(it.body || '').split('\n👉'), when = new Date(it.t).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
      h += '<div class="mx-card" style="--lv:#35b6ff"><h4>' + esc(it.title) + '</h4><div class="meta">' + esc(when) + '</div>' + (parts[0] ? '<p>' + esc(parts[0]) + '</p>' : '') + (parts[1] ? '<div class="do">✅ <b>Qué hacer:</b> ' + esc(parts[1].trim()) + '</div>' : '') + '</div>'; });
    if (a.length) h += '<button type="button" class="mx-btn" data-clr>🗑 Borrar historial</button>';
    pane.innerHTML = h;
    const cb = pane.querySelector('[data-clr]'); if (cb) cb.onclick = () => { try { if (AB && AB.histClear) AB.histClear(); localStorage.removeItem('climaHist'); } catch (e) { } tabHist(pane); };
  }
  async function tabSmn(pane, seq) {
    pane.innerHTML = '<div class="mx-load">Consultando al Servicio Meteorológico Nacional…</div>';
    let data; try { data = await root.fetchOfficialAlertList(); data.error = false; } catch (e) { data = []; data.error = true; }
    if (!stillHere(seq)) return;
    const p = here(), mine = [], mza = [], rest = [];
    const info = p && p.lat != null ? await placeInfo(p.lat, p.lon) : null; if (!stillHere(seq)) return;
    const prov = info && info.state ? normTxt(info.state) : '';
    data.forEach(a => { if (p && covers(a, p.lat, p.lon)) mine.push(a); else if (prov && normTxt(a.area).indexOf(prov) >= 0) mza.push(a); else rest.push(a); });
    const byLv = (x, y) => sevLevel(y) - sevLevel(x); [mine, mza, rest].forEach(l => l.sort(byLv));
    let h = '<button type="button" class="mx-btn" data-zones>' + (isOn('smn') ? '🗺 Ocultar zonas en el mapa' : '🗺 Ver zonas en el mapa') + '</button>';
    if (data.error) h += '<div class="mx-empty" style="background:rgba(255,176,32,.12)">⚠️ No pude consultar el SMN ahora (sin conexión o el servicio no responde). No significa que no haya avisos: mirá la página oficial.</div>';
    else if (!data.length && root.officialAlertsDiag && (root.officialAlertsDiag.limited || root.officialAlertsDiag.failed)) h += '<div class="mx-empty" style="background:rgba(255,176,32,.12)">⏳ El SMN está limitando los pedidos o no respondió bien. Reintenta solo en unos minutos; no significa que no haya avisos. Mirá la página oficial.</div>';
    else if (!data.length) h += '<div class="mx-empty">✅ El SMN no informa avisos vigentes en este momento.<br><small>Consultado a las ' + new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) + '</small></div>';
    if (mine.length) h += '<div class="mx-sec">En tu ubicación</div>' + mine.map(a => alertCard(a, true)).join('');
    if (mza.length) h += '<div class="mx-sec">En ' + esc(info.state) + '</div>' + mza.map(a => alertCard(a, false)).join('');
    if (rest.length) h += '<div class="mx-sec">Resto del país (' + rest.length + ')</div>' + rest.map(a => alertCard(a, false)).join('');
    if (data.length) h += '<div class="mx-note">' + data.length + ' aviso(s) vigente(s) en todo el país, consultados a las ' + new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) + '.</div>';
    h += '<div class="mx-sec">Fuentes oficiales</div>' + LINKS_SMN + '<div class="mx-note">Datos del feed público de alertas del SMN (formato CAP). Se listan todos los avisos vigentes; “Afecta tu ubicación” solo aparece cuando la zona del aviso se puede comprobar en el mapa.</div>';
    try {
      const dg = root.officialAlertsDiag;
      if (dg) h += '<div class="mx-note">Diagnóstico SMN: ' + dg.sources.map(x => (x.url.split('/').filter(Boolean).pop() || x.url) + ' ' + (x.ok ? '✔ ' + x.links + ' enlaces' : '✖ ' + (x.status || x.error || 'sin respuesta'))).join(' · ') + ' · leídos ' + dg.read + ', vencidos ' + dg.expired + (dg.failed ? ', con error ' + dg.failed : '') + '.</div>';
    } catch (e) { }
    pane.innerHTML = h;
    pane.querySelectorAll('[data-say]').forEach(b => b.onclick = () => { buzz(); try { root.speakText(b.dataset.say); } catch (e) { } });
    const zb = pane.querySelector('[data-zones]');
    if (zb) zb.onclick = () => { buzz(); const on = !isOn('smn'); setLayer('smn', on); if (on) closeSheets(); else zb.textContent = '🗺 Ver zonas en el mapa'; };
  }
  async function mzaText() {
    const U = 'https://contingencias.mendoza.gov.ar/web1/Alertadeheladas/alertadeheladas.php', ac = new AbortController(), t = setTimeout(() => ac.abort(), 8000);
    try {
      const r = await fetch(U, { signal: ac.signal, cache: 'no-store' }); if (!r.ok) throw new Error('HTTP ' + r.status);
      const d = new DOMParser().parseFromString(await r.text(), 'text/html');
      d.querySelectorAll('script,style,noscript,nav,header,footer,form,select,option,button').forEach(n => n.remove());
      return ((d.body && d.body.textContent) || '').replace(/\s+/g, ' ').trim().slice(0, 700);
    } finally { clearTimeout(t); }
  }
  async function tabMza(pane, seq) {
    const evs = (typeof curEvents !== 'undefined' && curEvents) || [], tips = root.TIPS || {};
    let h = '<div class="mx-sec">Hoy en tu ubicación y fincas</div>';
    const rel = evs.filter(e => /frost|hail|zonda|wind|storm/i.test(e.type || ''));
    h += rel.length ? rel.slice(0, 6).map(e => '<div class="mx-card" style="--lv:' + (SEV[e.level] || SEV[1])[1] + '"><h4>' + esc(e.title) + '</h4><div class="meta">' + esc(e.place || '') + '</div><p>' + esc(e.detail || '') + '</p>' + (tips[e.type] ? '<div class="do">✅ ' + esc(tips[e.type]) + '</div>' : '') + '</div>').join('')
      : '<div class="mx-empty">✅ Sin avisos de helada, granizo, Zonda ni tormenta fuerte para tus lugares ahora.</div>';
    h += '<div class="mx-sec">Contingencias Climáticas · Gobierno de Mendoza</div>' +
      '<div><a class="mx-btn" href="https://contingencias.mendoza.gov.ar/web1/Alertadeheladas/alertadeheladas.php" target="_blank" rel="noopener">🥶 Alerta de heladas</a>' +
      '<a class="mx-btn" href="https://contingencias.mendoza.gov.ar/" target="_blank" rel="noopener">🧊 Granizo y contingencias</a>' +
      '<a class="mx-btn" href="https://www.mendoza.gov.ar/" target="_blank" rel="noopener">🏛 Gobierno de Mendoza</a></div><div class="mx-sec">Último texto publicado (heladas)</div><div class="mx-load" id="mx-mzt">Buscando…</div>';
    h += '<div class="mx-sec">Qué hacer según el fenómeno</div>' + ['frost', 'hail', 'zonda', 'stormStrong', 'wind'].filter(k => tips[k]).map(k => '<div class="mx-card" style="--lv:#35b6ff"><h4>' + TYPE_ICON[k] + ' ' + ({ frost: 'Helada', hail: 'Granizo', zonda: 'Viento Zonda', stormStrong: 'Tormenta fuerte', wind: 'Viento fuerte' })[k] + '</h4><p>' + esc(tips[k]) + '</p></div>').join('');
    pane.innerHTML = h;
    try {
      const tx = await mzaText(); if (!stillHere(seq)) return; const box = $('mx-mzt');
      if (box) { box.className = 'mx-card'; box.style.setProperty('--lv', '#35b6ff'); box.innerHTML = tx.length > 40 ? '<p>' + esc(tx) + '</p><div class="mx-note">Resumen automático del texto de la página oficial; puede incluir partes que no son del aviso. Para el parte completo abrí la página.</div>' : '<p>La página no tiene texto legible para mostrar acá. Abrila con el botón de arriba.</p>'; }
    } catch (e) { const box = $('mx-mzt'); if (box && stillHere(seq)) { box.className = 'mx-note'; box.textContent = 'No pude leer la página ahora. Abrila con el botón de arriba.'; } }
  }
  /* Últimos sismos del INPRES (página oficial, leída desde Android con permiso CORS). Se muestran aunque estén lejos. */
  let inpresCache = null;
  /* Filas de la tabla “Últimos 50 sismos” del INPRES: Nº | Dia (dd/mm) | Hora | Latitud | Longitud | Mg. | Prof. | Lugar */
  function inpresRows(rows) {
    const num = t => { const m = String(t || '').replace(',', '.').match(/-?\d+(?:\.\d+)?/); return m ? Number(m[0]) : NaN; };
    const out = []; let idx = { date: 1, time: 2, lat: 3, lon: 4, mag: 5, depth: 6, place: 7 };
    rows.forEach(cells => {
      if (cells.length < 6) return;
      if (cells.some(c => /^lat/i.test(c)) && cells.some(c => /^lon/i.test(c))) {   // fila de encabezados: se ajustan las columnas
        const m = {}; cells.forEach((c, k) => {
          if (/^(d[ií]a|fecha)/i.test(c)) m.date = k; else if (/^hora/i.test(c)) m.time = k; else if (/^lat/i.test(c)) m.lat = k; else if (/^lon/i.test(c)) m.lon = k;
          else if (/^(mg|mag)/i.test(c)) m.mag = k; else if (/^prof/i.test(c)) m.depth = k; else if (/^(lugar|provincia|zona)/i.test(c)) m.place = k;
        });
        idx = Object.assign(idx, m); return;
      }
      if (!/^\d{1,3}$/.test(cells[0]) || !/^\d{1,2}\/\d{1,2}(\/\d{2,4})?$/.test(cells[idx.date] || '') || !/^\d{1,2}:\d{2}/.test(cells[idx.time] || '')) return;
      const mag = num(cells[idx.mag]), lat = num(cells[idx.lat]), lon = num(cells[idx.lon]), depth = num(cells[idx.depth]);
      if (!(mag >= 0 && mag < 10)) return;
      out.push({ date: cells[idx.date], time: cells[idx.time].match(/^\d{1,2}:\d{2}/)[0], mag, lat: isFinite(lat) ? lat : null, lon: isFinite(lon) ? lon : null, depth: isFinite(depth) ? depth : null, place: cells[idx.place] || 'Argentina', src: 'INPRES' });
    });
    return out;
  }
  function parseInpres(html) {
    const d = new DOMParser().parseFromString(html, 'text/html');
    const rows = [...d.querySelectorAll('tr')].map(tr => [...tr.children].map(c => (c.textContent || '').replace(/\s+/g, ' ').trim()));
    return inpresRows(rows);
  }
  let inpresDiag = '';
  async function loadInpres() {
    if (inpresCache && Date.now() - inpresCache.at < 3 * 60e3) return inpresCache.list;
    const ac = new AbortController(), t = setTimeout(() => ac.abort(), 12000);
    try {
      const r = await fetch('https://www.inpres.gob.ar/seismology/xultimos.html', { signal: ac.signal, cache: 'no-store' });
      if (!r.ok) { inpresDiag = 'HTTP ' + r.status + (r.headers.get('x-proxy-error') ? ' · ' + r.headers.get('x-proxy-error') : ''); throw new Error(inpresDiag); }
      const html = await r.text();
      const list = parseInpres(html).slice(0, 3);
      if (!list.length) { inpresDiag = 'respondió (' + html.length + ' caracteres, ' + (html.match(/<tr/gi) || []).length + ' filas) pero no encontré la tabla de sismos'; throw new Error(inpresDiag); }
      inpresDiag = ''; inpresCache = { at: Date.now(), list }; return list;
    } catch (e) { if (!inpresDiag) inpresDiag = e && e.name === 'AbortError' ? 'tardó demasiado' : String((e && e.message) || e).slice(0, 80); throw e; }
    finally { clearTimeout(t); }
  }
  /* Respaldo si el INPRES no responde: últimos sismos de Argentina según USGS. */
  async function loadUsgsAr() {
    const u = 'https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&orderby=time&limit=3&minmagnitude=2&minlatitude=-56&maxlatitude=-21&minlongitude=-74&maxlongitude=-53&starttime=' + new Date(Date.now() - 14 * 864e5).toISOString();
    const j = await (await fetch(u)).json();
    return (j.features || []).map(f => ({ date: '', time: '', ts: f.properties.time, mag: f.properties.mag, lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], depth: f.geometry.coordinates[2], place: f.properties.place || 'Argentina', src: 'USGS' }));
  }
  function quakeCard(x, p) {
    const lv = x.mag >= 5 ? 3 : x.mag >= 4 ? 2 : 1;
    const d = p && x.lat != null && x.lon != null ? Math.round(Math.hypot((x.lat - p.lat) * 111, (x.lon - p.lon) * 111 * Math.cos(p.lat * D2R))) : null;
    const when = x.ts ? fmtTime(x.ts) : [x.date, x.time].filter(Boolean).join(' · ');
    return '<div class="mx-card" style="--lv:' + SEV[lv][1] + '"><h4>🌎 Sismo M' + Number(x.mag).toFixed(1) + '</h4><div class="meta">' + esc(x.place) + (when ? '<br>' + esc(when) : '') + '</div><p>' +
      (x.depth != null ? 'Profundidad ' + Math.round(x.depth) + ' km' : 'Profundidad sin dato') + (d != null ? ' · a ' + d + ' km de ' + esc(p.name) : '') + '</p></div>';
  }
  async function tabQuakes(pane, seq) {
    pane.innerHTML = '<div class="mx-load">Consultando últimos sismos…</div>';
    let last = [], src = '', err = false;
    try { last = await loadInpres(); src = 'INPRES'; }
    catch (e) { try { last = await loadUsgsAr(); src = 'USGS'; } catch (e2) { err = true; } }
    if (seq != null && !stillHere(seq)) return;
    const q = (typeof quakes !== 'undefined' && quakes) ? quakes.slice().sort((a, b) => (b.time || 0) - (a.time || 0)) : [], p = here();
    let h = '<div class="mx-sec">Últimos 3 sismos · Argentina</div>';
    if (err) h += '<div class="mx-empty" style="background:rgba(255,176,32,.12)">⚠️ No pude consultar los últimos sismos ahora (sin conexión o el servicio no responde). Abrí el INPRES con el botón de abajo.</div>';
    else {
      h += last.map(x => quakeCard(x, p)).join('');
      h += '<div class="mx-note">' + (src === 'INPRES' ? 'Fuente: INPRES, tal como figura en su listado “Últimos sismos”. Se muestran aunque estén lejos de tu zona; la fecha y la hora son las que publica el INPRES.' : 'El INPRES no respondió (' + esc(inpresDiag || 'sin detalle') + '): estos son los últimos sismos de Argentina según el USGS (puede diferir del INPRES).') + '</div>';
    }
    h += '<div class="mx-sec">Cerca de tu ubicación</div>';
    h += q.length ? q.slice(0, 12).map(x => quakeCard({ mag: x.mag, place: x.place || 'Región cercana', ts: x.time, depth: x.depth, lat: x.lat, lon: x.lon }, p)).join('') : '<div class="mx-empty">✅ No hubo sismos dentro del radio y la magnitud que configuraste en las últimas 3 horas.</div>';
    h += '<div><a class="mx-btn" href="https://www.inpres.gob.ar/seismology/xultimos.html" target="_blank" rel="noopener">🏔 INPRES · últimos sismos (oficial)</a><a class="mx-btn" href="https://earthquake.usgs.gov/earthquakes/map/" target="_blank" rel="noopener">🌐 USGS</a></div><div class="mx-note">Lo de “cerca de tu ubicación” sale del USGS con el radio y la magnitud de tus ajustes. En Argentina la fuente oficial es el INPRES.</div>';
    pane.innerHTML = h;
  }


  /* ---------- clima del día, hora por hora ---------- */
  mkSheet('hourly', '🕐 Clima del día');
  const hrS = sheets.hourly, hrBody = hrS.querySelector('.mx-body');
  const hrCache = {}; let hrSeq = 0, hrDay = 0;
  const nowAR = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 13); // Argentina: GMT-3 todo el año
  async function hrLoad(p) {
    const key = p.lat.toFixed(2) + ',' + p.lon.toFixed(2), c = hrCache[key];
    if (c && Date.now() - c.at < 10 * 60e3) return c.j;
    const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + p.lat.toFixed(4) + '&longitude=' + p.lon.toFixed(4) +
      '&hourly=temperature_2m,apparent_temperature,weather_code,precipitation_probability,precipitation,wind_speed_10m,wind_direction_10m,wind_gusts_10m,relative_humidity_2m,is_day' +
      '&daily=temperature_2m_max,temperature_2m_min,sunrise,sunset&forecast_days=2&wind_speed_unit=kmh&timezone=America%2FArgentina%2FBuenos_Aires';
    const ac = new AbortController(), t = setTimeout(() => ac.abort(), 12000);
    try {
      const r = await fetch(url, { signal: ac.signal }); if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json(); if (!j.hourly || !j.hourly.time) throw new Error('sin datos');
      hrCache[key] = { at: Date.now(), j }; return j;
    } finally { clearTimeout(t); }
  }
  function hrPaint(j, p, day) {
    const H = j.hourly, D = j.daily, date = D.time[day], nowH = nowAR(), isToday = day === 0;
    const idx = []; H.time.forEach((t, i) => { if (t.slice(0, 10) === date) idx.push(i); });
    const hhmm = s => s.slice(11, 16);
    const mx = Math.round(D.temperature_2m_max[day]), mn = Math.round(D.temperature_2m_min[day]);
    let best = null; idx.forEach(i => { const pr = H.precipitation_probability[i]; if (pr != null && (!best || pr > best.pr)) best = { pr, h: hhmm(H.time[i]) }; });
    const mm = idx.reduce((a, i) => a + (H.precipitation[i] || 0), 0);
    let h = '<div class="mx-tabs"><button type="button" data-day="0" class="' + (day === 0 ? 'on' : '') + '">Hoy</button><button type="button" data-day="1" class="' + (day === 1 ? 'on' : '') + '">Mañana</button></div>';
    h += '<div class="mx-hrsum"><div><b>' + esc(p.name || 'Tu ubicación') + '</b><span>▲ ' + mx + '°  ▼ ' + mn + '°</span></div><div><span>🌅 ' + esc(hhmm(D.sunrise[day])) + '</span><span>🌇 ' + esc(hhmm(D.sunset[day])) + '</span></div>' +
      '<p>' + (best && best.pr >= 30 ? '🌧 Lo más probable: lluvia cerca de las <b>' + esc(best.h) + '</b> (' + best.pr + '%)' + (mm >= 0.5 ? ', unos ' + mm.toFixed(1) + ' mm en el día.' : '.') : '☂️ Sin lluvia importante prevista.') + '</p></div>';
    h += '<div class="mx-hrh"><span>Hora</span><span></span><span>Temp.</span><span>Lluvia</span><span>Viento</span></div>';
    idx.forEach(i => {
      const t = H.time[i], past = isToday && t.slice(0, 13) < nowH, now = isToday && t.slice(0, 13) === nowH;
      const code = H.weather_code[i], night = H.is_day[i] === 0, w = wxText(code), ic = (night && (code === 0 || code === 1)) ? '🌙' : w[0];
      const pr = H.precipitation_probability[i], mmh = H.precipitation[i] || 0, sp = Math.round(H.wind_speed_10m[i] || 0), gu = Math.round(H.wind_gusts_10m[i] || 0), dir = H.wind_direction_10m[i];
      const fl = Math.round(H.apparent_temperature[i]), tp = Math.round(H.temperature_2m[i]);
      h += '<div class="mx-hr' + (past ? ' past' : '') + (now ? ' now' : '') + '"><span class="hh">' + (now ? 'Ahora' : esc(hhmm(t))) + '</span><span class="hi" title="' + esc(w[1]) + '">' + ic + '</span>' +
        '<span class="ht"><b>' + tp + '°</b>' + (Math.abs(fl - tp) >= 2 ? '<small>sens. ' + fl + '°</small>' : '<small>' + esc(w[1]) + '</small>') + '</span>' +
        '<span class="hp"><b>' + (pr == null ? '–' : pr + '%') + '</b><small>' + (mmh >= 0.1 ? mmh.toFixed(1) + ' mm' : '—') + '</small></span>' +
        '<span class="hw">' + (dir != null ? arrowSvg((dir + 180) % 360, ramp(WIND, sp), 16) : '') + '<b>' + sp + '</b><small>ráf. ' + gu + '</small></span></div>';
    });
    h += '<div class="mx-note">Pronóstico de modelos meteorológicos (Open-Meteo) para ' + esc(p.name || 'tu ubicación') + '. La sensación térmica aparece solo si difiere 2° o más. Horario de Argentina.</div>';
    hrBody.innerHTML = h;
    hrBody.querySelectorAll('[data-day]').forEach(b => b.onclick = () => { buzz(); hrDay = +b.dataset.day; hrPaint(j, p, hrDay); hrS.scrollTop = 0; });
    const n = hrBody.querySelector('.mx-hr.now'); if (n && day === 0) setTimeout(() => { try { hrS.scrollTop = Math.max(0, n.offsetTop - 150); } catch (e) { } }, 40);
  }
  async function openHourly() {
    closeSheets(); hrS.classList.add('show'); back.classList.add('show'); hrS.scrollTop = 0; hrDay = 0;
    const p = here(), seq = ++hrSeq;
    if (!p || p.lat == null || p.lon == null) { hrBody.innerHTML = '<div class="mx-empty">Todavía no tengo tu ubicación. Tocá “Mi lugar” y probá de nuevo.</div>'; return; }
    hrBody.innerHTML = '<div class="mx-load">Buscando el pronóstico hora por hora…</div>';
    try { const j = await hrLoad(p); if (seq !== hrSeq) return; hrPaint(j, p, 0); }
    catch (e) { if (seq === hrSeq) hrBody.innerHTML = '<div class="mx-empty" style="background:rgba(255,176,32,.12)">⚠️ No pude traer el pronóstico ahora (sin conexión o el servicio no responde). Probá en un momento.</div>'; }
  }

  /* ---------- botones de la barra inferior: ícono + texto ---------- */
  const EMO = /^(\p{Extended_Pictographic}️?)\s*([\s\S]*)$/u;
  function decorate(b) {
    if (!b || b.querySelector('.ic')) return;
    const m = EMO.exec((b.textContent || '').trim()); if (!m) return;
    b.textContent = ''; const i = el('span', 'ic'), t = el('span', 'tx'); i.textContent = m[1]; t.textContent = m[2].replace(/GPS vivo:/i, 'GPS'); b.append(i, t);
  }
  const barBtns = ['locMe', 'searchToggle', 'fincaDd', 'live', 'fcBtn', 'cfgBtn', 'sos'];
  barBtns.forEach(id => { const b = $(id); if (!b) return; decorate(b); new MutationObserver(() => { if (!b.querySelector('.ic')) decorate(b); }).observe(b, { childList: true, characterData: true, subtree: true }); });
  const lb = $('locMe'); if (lb) { const t = lb.querySelector('.tx'); if (t) t.textContent = 'Mi lugar'; }
  const sb = $('searchToggle'); if (sb) { const t = sb.querySelector('.tx'); if (t) t.textContent = 'Buscar'; }
  const fb = $('fcBtn'); if (fb) { const t = fb.querySelector('.tx'); if (t) t.textContent = '14 días'; }
  const ab = $('cfgBtn'); if (ab) { const t = ab.querySelector('.tx'); if (t) t.textContent = 'Avisos'; }

  /* ---------- sincronizar estado visual ---------- */
  function syncUI() {
    dock.querySelectorAll('.mx-chip[data-k]').forEach(b => { const k = b.dataset.k; if (!k.startsWith('act:')) { const on = isOn(k); b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); } });
    document.querySelectorAll('[data-sw]').forEach(b => b.setAttribute('aria-checked', String(isOn(b.dataset.sw))));
    document.querySelectorAll('[data-base]').forEach(b => b.classList.toggle('on', b.dataset.base === baseKey));
    refreshLegend();
  }
  setInterval(() => { if (!document.hidden) safe('sync', syncUI); }, 5000);

  /* ---------- arranque ---------- */
  safe('base', () => setBase(baseKey));
  safe('op', applyOpacity);
  safe('hud', refreshHUD);
  safe('sync', syncUI);
  safe('grid', () => { if (gridNeeded()) refreshGrid(false); });
  safe('smn', () => { if (S.smn) applySmn(); });
  setInterval(() => safe('gridTimer', () => { if (gridNeeded()) refreshGrid(true); }), 15 * 60e3);
  root.__mxState = () => ({ S, G, baseKey, op });
})(typeof window !== 'undefined' ? window : globalThis);
