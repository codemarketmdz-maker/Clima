/* TiempoMDZ 1.11 · mapa interactivo: dock de capas, viento animado, rumbo de nubes, temperatura,
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
    frost: 'Se espera que la temperatura baje a cero grados o menos. Puede dañar cultivos y plantas sensibles.',
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
    return { u, v, speed: Math.hypot(u, v), toward: toward(u, v), gust: mix('gu'), pr: mix('pr'), t: mix('t'), cl: mix('cl'), su, sv, sspeed: Math.hypot(su, sv), stoward: toward(su, sv) };
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
      return { u: ws * Math.sin(tw * D2R), v: ws * Math.cos(tw * D2R), su: sw * Math.sin(ts * D2R), sv: sw * Math.cos(ts * D2R), t: t == null ? NaN : t, cl: cl == null ? 0 : cl, gu: gu == null ? ws : gu, pr: Math.max(0, num(c.precipitation) || 0) };
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

  const recent = [];
  const S = Object.assign({ wind: false, dir: false, temp: false, smn: false, rain: false }, LSg('mx_layers', {}));
  S.wind = false; // el viento animado arranca apagado (pesa); se prende desde la botonera
  const click = id => { const b = $(id); if (b) b.click(); };
  const arrowSvg = (deg, color, size) => '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '" style="transform:rotate(' + deg + 'deg)"><path d="M12 2 L19 21 L12 16.5 L5 21 Z" fill="' + color + '" stroke="#06121f" stroke-width="1.5" stroke-linejoin="round"/></svg>';
  const fmtTime = ms => ms ? new Date(ms).toLocaleString('es-AR', { weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';

  /* ---------- mapas base ---------- */
  const BASES = {
    streets: { label: 'Calles', bg: 'linear-gradient(135deg,#e8e4d8,#b8d4a8)', url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', opt: { maxZoom: 19, attribution: '© OpenStreetMap' } },
    topo: { label: 'Relieve', bg: 'linear-gradient(135deg,#d9c7a0,#8fb58a)', url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', opt: { subdomains: 'abc', maxZoom: 17, attribution: '© OpenStreetMap · OpenTopoMap' } }
  };
  let baseKey = LSg('mx_base', 'streets'), baseL = null;
  function setBase(k) {
    if (!BASES[k]) k = 'streets';
    baseKey = k; LSs('mx_base', k);
    map.eachLayer(l => { if (l._url && /openstreetmap\.org|cartocdn|arcgisonline|opentopomap/.test(l._url)) map.removeLayer(l); });
    const b = BASES[k]; baseL = L.tileLayer(b.url, Object.assign({ zIndex: 1 }, b.opt)); baseL.addTo(map);
    if (baseL.bringToBack) baseL.bringToBack();
    syncUI();
  }

  /* ---------- grilla meteorológica (Open-Meteo) ---------- */
  const COLS = 6, ROWS = 8;
  let G = null, gridAt = 0, gridZ = 0, gridBusy = null, gridErrAt = 0;
  const gridNeeded = () => S.wind || S.dir || S.temp || S.rain;
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
        '&current=temperature_2m,precipitation,cloud_cover,wind_speed_10m,wind_direction_10m,wind_gusts_10m&hourly=wind_speed_700hPa,wind_direction_700hPa&forecast_hours=1&wind_speed_unit=kmh';
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
  function initParts() { const n = Math.min(450, Math.round(W * H / 900)); parts = Array.from({ length: n }, () => seed({})); }
  const tmp = [0, 0];
  function frame(t) {
    raf = requestAnimationFrame(frame);
    if (!running || document.hidden || !field) return;
    if (t - lastT < 50) return;
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
  const windG = L.layerGroup(), dirG = L.layerGroup(), tempG = L.layerGroup(), smnG = L.layerGroup(), rayG = L.layerGroup();
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
  /* ---------- lluvia (pronóstico del modelo, cubre toda Argentina) ---------- */
  const RAIN = [[0.1, [159, 211, 255, 110]], [0.5, [61, 139, 255, 150]], [2, [39, 196, 107, 170]], [5, [242, 230, 58, 185]], [10, [255, 159, 46, 195]], [20, [229, 57, 53, 205]]];
  function rainRgba(v) {
    if (!(v >= RAIN[0][0])) return null;
    for (let i = RAIN.length - 1; i >= 0; i--) if (v >= RAIN[i][0]) {
      const a = RAIN[i], b = RAIN[i + 1]; if (!b) return a[1];
      const t = (v - a[0]) / (b[0] - a[0]); return a[1].map((x, k) => x + (b[1][k] - x) * t);
    }
    return null;
  }
  let rainOv = null, rainG = null;
  function drawRain() {
    if (!S.rain || !G) { if (rainOv) { map.removeLayer(rainOv); rainOv = null; rainG = null; } return; }
    if (rainOv && rainG === G) return;
    const w = 72, h = 96, c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d'), im = x.createImageData(w, h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const lat = G.b.n - (G.b.n - G.b.s) * (j + .5) / h, lon = G.b.w + (G.b.e - G.b.w) * (i + .5) / w, sm = smp(lat, lon), col = sm && rainRgba(sm.pr), k = (j * w + i) * 4;
      if (col) { im.data[k] = col[0]; im.data[k + 1] = col[1]; im.data[k + 2] = col[2]; im.data[k + 3] = col[3]; }
    }
    x.putImageData(im, 0, 0);
    if (rainOv) map.removeLayer(rainOv);
    rainOv = L.imageOverlay(c.toDataURL(), [[G.b.s, G.b.w], [G.b.n, G.b.e]], { interactive: false, zIndex: 5 }).addTo(map); rainG = G;
  }
  async function refreshGrid(force) {
    if (!gridNeeded()) { stopWind(); applyGroups(); drawRain(); return; }
    await loadGrid(force);
    const sig = S.wind + '|' + S.dir + '|' + S.temp;
    if (G !== markersG || sig !== markersSig) { drawMarkers(); markersG = G; markersSig = sig; }
    applyGroups(); drawRain();
    if (S.wind && G) startWind(); else stopWind();
  }
  let mvT = 0, markersG = null, markersSig = '';
  map.on('movestart zoomstart', () => { if (S.wind) pauseWind(); });
  map.on('moveend zoomend', () => { clearTimeout(mvT); mvT = setTimeout(() => safe('moved', () => refreshGrid(false)), 350); });
  root.addEventListener('resize', () => { clearTimeout(mvT); mvT = setTimeout(() => safe('resize', () => { if (S.wind && G) startWind(); }), 300); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && S.wind && G) startWind(); });

  // Al tocar el mapa solo se elige ese lugar (lo hace index.html) y la tarjeta "Ahora" muestra su clima: ya no se abre ninguna placa.

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
  async function applySmn() {
    smnG.clearLayers();
    if (!S.smn) { if (map.hasLayer(smnG)) map.removeLayer(smnG); return; }
    if (!map.hasLayer(smnG)) smnG.addTo(map);
    const data = await loadSmn(false);
    smnG.clearLayers();
    data.forEach(a => {
      const col = SEV[sevLevel(a)][1], st = { color: col, weight: 2, fillColor: col, fillOpacity: .22, interactive: false };
      a.polys.forEach(p => L.polygon(p, st).addTo(smnG));
      a.circles.forEach(c => L.circle([c.lat, c.lon], Object.assign({ radius: c.km * 1000 }, st)).addTo(smnG));
    });
    if (data.error) toast('No pude consultar los avisos del SMN ahora.');
    else if (!data.length) toast('El SMN no informa avisos vigentes.');
    syncUI();
  }
  setInterval(() => { if (S.smn) safe('smn', applySmn); }, 6 * 60e3);

  /* ---------- franja de aviso oficial vigente (SMN) sobre el mapa ---------- */
  const offHidden = {};
  const offStrip = document.createElement('div'); offStrip.id = 'offStrip'; offStrip.hidden = true;
  (document.getElementById('mapWrap') || document.body).appendChild(offStrip);
  function paintOffStrip() {
    let list = []; try { list = (typeof mainOfficialEv !== 'undefined' && mainOfficialEv) ? mainOfficialEv.filter(e => e && e.key && /^smn:/.test(e.key) && !offHidden[e.key]) : []; } catch (e) { }
    if (!list.length) { offStrip.hidden = true; return; }
    list.sort((a, b) => (b.level || 0) - (a.level || 0));
    const e = list[0], m = /para el área: (.*?)\. /.exec(e.detail || ''), lv = e.level >= 3 ? 'r' : e.level === 2 ? 'o' : 'y';
    offStrip.className = 'lv-' + lv; offStrip.hidden = false;
    try { const d = document.querySelector('.mx-dock'); if (d && d.offsetParent) offStrip.style.bottom = Math.max(70, document.getElementById('mapWrap').clientHeight - d.offsetTop + 8) + 'px'; } catch (e) { }
    offStrip.innerHTML = '<div class="os-t"><b>🇦🇷 Aviso oficial del SMN' + (list.length > 1 ? ' (+' + (list.length - 1) + ')' : '') + '</b><span>' + esc(e.title || '') + (m ? ' · ' + esc(m[1]) : '') + '</span></div><button type="button" class="os-x" aria-label="Ocultar">✕</button>';
    offStrip.querySelector('.os-x').onclick = ev => { ev.stopPropagation(); offHidden[e.key] = 1; paintOffStrip(); };
    offStrip.onclick = () => openOfficial('smn');
  }
  setInterval(() => safe('offStrip', paintOffStrip), 15e3); setTimeout(() => safe('offStrip', paintOffStrip), 3000);

  /* ---------- rayos (GOES-19 GLM) ---------- */
  const boltSvg = (c, s) => '<svg viewBox="0 0 24 24" width="' + s + '" height="' + s + '"><path d="M13.5 1 4 14h6.2L8.8 23 20 9.5h-6.4z" fill="' + c + '" stroke="#000" stroke-width="1.3" stroke-linejoin="round"/></svg>';
  let rayData = null, rayAt = 0, rayBusy = null, rayTxt = 'Cargando…';
  async function loadRayos(force) {
    if (!force && rayData && Date.now() - rayAt < 90e3) return rayData;
    if (rayBusy) return rayBusy;
    rayBusy = (async () => {
      try {
        if (!root.RAYOS_URL) throw new Error('nourl');
        const r = await fetch(root.RAYOS_URL + (root.RAYOS_URL.indexOf('?') < 0 ? '?' : '&') + 't=' + Date.now(), { cache: 'no-store' });
        if (!r.ok) throw new Error('http' + r.status);
        rayData = await r.json(); rayData.error = false; rayAt = Date.now(); return rayData;
      } catch (e) { const d = rayData || { flashes: [] }; d.error = e.message === 'nourl' ? 'nourl' : true; rayData = d; rayAt = Date.now() - 60e3; return d; }
      finally { rayBusy = null; }
    })();
    return rayBusy;
  }
  async function applyRayos(announce) {
    rayG.clearLayers();
    if (!S.rayos) { if (map.hasLayer(rayG)) map.removeLayer(rayG); return; }
    if (!map.hasLayer(rayG)) rayG.addTo(map);
    const d = await loadRayos(!!announce);
    rayG.clearLayers();
    if (d.error) { rayTxt = d.error === 'nourl' ? 'La fuente de rayos todavía no está configurada.' : 'No pude consultar los rayos ahora.'; if (announce) toast(rayTxt); syncUI(); return; }
    const now = Date.now() / 1000; let c0 = { lat: -32.89, lon: -68.85 }; try { const l = cur(); if (l && l.lat != null) c0 = l; } catch (e) { }
    const all = (d.flashes || []).filter(f => now - f[2] <= 3600 && Math.abs(f[0] - c0.lat) <= 2.8 && Math.abs(f[1] - c0.lon) <= 3.4);
    const fl = all.sort((a, b) => b[2] - a[2]).slice(0, 700).reverse();
    fl.forEach(f => {
      const m = (now - f[2]) / 60, col = m <= 10 ? '#ffffff' : m <= 30 ? '#ffd600' : '#ff7043', sz = m <= 10 ? 20 : m <= 30 ? 17 : 14;
      L.marker([f[0], f[1]], { icon: L.divIcon({ className: 'mx-ray', html: boltSvg(col, sz), iconSize: [sz, sz], iconAnchor: [sz / 2, sz / 2] }), interactive: false, keyboard: false, opacity: m <= 30 ? 1 : .8 }).addTo(rayG);
    });
    let sm = null; try { const l = cur(); sm = root.lightningSummary && root.lightningSummary(d, l.lat, l.lon, Date.now()); } catch (e) { }
    const age = d.t ? Math.round((Date.now() - d.t) / 60e3) : null;
    rayTxt = (all.length > fl.length ? 'Se muestran las ' + fl.length + ' más recientes. ' : '') + (sm ? (sm.n10 ? sm.n10 + ' descargas en 10 min a menos de 100 km' + (sm.nearKm != null ? ' · la más cercana a ' + sm.nearKm + ' km al ' + sm.nearDir : '') + (sm.trend ? ' · ' + sm.trend : '') : 'Sin descargas cerca (100 km) en los últimos 10 min') : fl.length + ' descargas en la última hora') + (age != null && age > 12 ? ' · datos de hace ' + age + ' min' : '') + '.';
    if (announce) toast(rayTxt);
    syncUI();
  }
  setInterval(() => { if (S.rayos) safe('rayos', () => applyRayos(false)); }, 3 * 60e3);

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
    else if (k === 'anim') { if (v && !st.rain()) { click('rplay'); } else if (v !== st.anim()) click('rplay'); }
    else if (k === 'esc') click('esc');
    else { S[k] = v; LSs('mx_layers', S); if (k === 'smn') safe('smn', applySmn); else if (k === 'rayos') safe('rayos', () => applyRayos(true)); else safe('grid', () => refreshGrid(false)); }
    setTimeout(syncUI, 60);
  }
  const isOn = k => k === 'stn' ? !!($('stn') && $('stn').classList.contains('on')) : (k in S) ? S[k] : (st[k] ? st[k]() : (k === 'esc' ? !!($('esc') && $('esc').classList.contains('on')) : false));

  /* ---------- dock ---------- */
  const dock = el('div', 'mx-dock'); dock.setAttribute('role', 'toolbar'); dock.setAttribute('aria-label', 'Capas del mapa');
  const CHIPS = [
    ['ir', '☁️', 'Nubes'], ['rain', '🌧', 'Lluvia'], ['rayos', '⚡', 'Rayos'], ['wind', '💨', 'Viento'], ['dir', '🧭', 'Rumbo'], ['temp', '🌡', 'Temp.'], ['stn', '📍', 'Estaciones'], ['act:alerts', '🔔', 'Alertas']
  ];
  CHIPS.forEach(([k, ic, tx]) => {
    const b = el('button', 'mx-chip' + (k.startsWith('act:') ? ' act' : ''), '<span class="ic">' + ic + '</span><span class="tx">' + tx + '</span>');
    b.type = 'button'; b.dataset.k = k;
    b.onclick = () => {
      buzz();
      if (k === 'act:alerts') openOfficial((typeof curEvents !== 'undefined' && curEvents && curEvents.length) ? 'mine' : 'smn');
      else if (k === 'act:mza') openOfficial('mza');
      else if (k === 'act:quakes') openOfficial('quakes');
      else if (k === 'act:fc') click('fcBtn');
      else if (k === 'stn') { click('stn'); setTimeout(syncUI, 80); }
      else setLayer(k, !isOn(k));
    };
    dock.appendChild(b);
  });
  mapWrap.appendChild(dock);

  /* ---------- botones flotantes ---------- */
  const fabs = el('div', 'mx-fabs');
  const mkFab = (cls, html, label, fn) => { const b = el('button', 'mx-fab ' + cls, html); b.type = 'button'; b.setAttribute('aria-label', label); b.onclick = () => { buzz(); fn(); }; return b; };
  fabs.appendChild(mkFab('main', '🗺', 'Capas y estilo de mapa', () => openSheet('layers')));
  fabs.appendChild(mkFab('', '📍', 'Ir a mi ubicación', () => { if (typeof gpsGo === 'function') gpsGo(); else click('locMe'); }));
  const zoom = el('div', 'mx-zoom'); const zi = el('button', '', '+'), zo = el('button', '', '−'); zi.type = zo.type = 'button';
  zi.setAttribute('aria-label', 'Acercar'); zo.setAttribute('aria-label', 'Alejar'); zi.onclick = () => map.zoomIn(); zo.onclick = () => map.zoomOut(); zoom.append(zi, zo); fabs.appendChild(zoom);
  const fullB = mkFab('', '⛶', 'Mapa en pantalla completa', () => { const on = document.body.classList.toggle('mx-full'); fullB.classList.toggle('on', on); setTimeout(() => { map.invalidateSize(); sizeCanvas(); if (S.wind && G) startWind(); }, 120); });
  fabs.appendChild(fullB); mapWrap.appendChild(fabs);

  /* ---------- tarjeta "Ahora" ---------- */
  const hud = el('div', 'mx-hud' + (LSg('mx_hudmin', false) ? ' min' : '')); hud.setAttribute('role', 'button'); hud.tabIndex = 0;
  hud.onclick = e => {
    const b = e.target && e.target.closest ? e.target.closest('[data-a]') : null;
    if (b) { e.stopPropagation(); buzz(); if (b.dataset.a === 'hours') { if (root.__hours) root.__hours.open(); } else click('fcBtn'); return; }
    hud.classList.toggle('min'); LSs('mx_hudmin', hud.classList.contains('min'));
  };
  mapWrap.appendChild(hud);
  function refreshHUD() {
    const c = (typeof lastC !== 'undefined' && lastC) || (typeof last !== 'undefined' && last && last[0] && last[0].c);
    let name = ''; try { name = cur().name; } catch (e) { }
    if (!c) { hud.innerHTML = '<div class="r1"><b>TiempoMDZ</b></div><div class="r2"><span class="wx">Buscando datos del tiempo…</span></div>'; return; }
    const w = wxText(c.weather_code), sp = Math.round(c.wind_speed_10m || 0), wc = windClass(sp), dir = c.wind_direction_10m;
    const nAl = (typeof curEvents !== 'undefined' && curEvents) ? curEvents.length : 0;
    const rain = Number(c.precipitation || 0);
    hud.innerHTML = '<div class="r1">📍 <b>' + esc(name || 'Tu ubicación') + '</b>' + (nAl ? '<span class="badge">' + nAl + ' aviso' + (nAl > 1 ? 's' : '') + '</span>' : '') + '</div>' +
      '<div class="r2"><span class="big">' + Math.round(c.temperature_2m) + '<sup>°C</sup></span><span class="wx"><i>' + w[0] + '</i>' + w[1] + '</span></div>' +
      '<div class="r3"><span class="wd">' + (dir != null ? arrowSvg(((dir + 180) % 360), ramp(WIND, sp), 22) : '💨') + '</span><span><b>' + sp + ' kilómetros por hora</b> · ' + wc[0] +
      (dir != null ? '<br><small style="color:#9fb4c8">viene ' + fromWords(dir) + ' · ráfagas ' + Math.round(c.wind_gusts_10m || sp) + '</small>' : '') + '</span></div>' +
      '<div class="r4"><span>☁ ' + Math.round(c.cloud_cover || 0) + '%</span><span>💧 ' + Math.round(c.relative_humidity_2m || 0) + '%</span><span>' + (rain > 0 ? '🌧 ' + rain + ' milímetros' : '☂️ sin lluvia') + '</span></div>' +
      (typeof airportLine === 'function' && airportLine(c) ? '<div class="r6">' + esc(plain(airportLine(c))) + '</div>' : '') +
      (typeof smnLine === 'function' && smnLine(c) ? '<div class="r6">' + esc(plain(smnLine(c))) + '</div>' : '') +
      '<div class="r5"><button type="button" data-a="hours">🕒 Por horas</button><button type="button" data-a="fc">📅 ' + ((typeof cmLimits === 'function' && cmLimits().forecastDays) || 14) + ' días</button></div>' +
      '<div class="tap">Tocá el número para achicar</div>';
    const chipAl = dock.querySelector('[data-k="act:alerts"]'); if (chipAl) chipAl.classList.toggle('hot', nAl > 0);
  }
  ['chips', 'al'].forEach(id => { const n = $(id); if (n) new MutationObserver(() => safe('hud', refreshHUD)).observe(n, { childList: true, subtree: true, characterData: true }); });
  setInterval(() => safe('hud', refreshHUD), 15000);

  /* ---------- leyendas ---------- */
  const legBox = el('div', 'mx-leg'); // las leyendas de colores ya no se dibujan sobre el mapa: la explicación está en "Mapa y capas"
  const bump = k => { const i = recent.indexOf(k); if (i >= 0) recent.splice(i, 1); recent.unshift(k); };
  const grad = stops => 'linear-gradient(90deg,' + stops.map(s => s[1]).join(',') + ')';
  const LEG = {
    ir: () => '<b>☁️ Nubes (satélite infrarrojo)</b><div class="bar" style="background:linear-gradient(90deg,#3d7bd9,#2fbf71,#f2e63a,#f29a2e,#e03a3a,#c22fc2,#fff)"></div><div class="tk"><span>Poca nube</span><span>Nube alta</span><span>Tormenta fuerte</span></div><p>Cuanto más cálido el color (naranja, rojo, violeta) más alta y fría es la nube, y más probable que sea una tormenta.</p>',
    vis: () => '<b>🌤 Nubes visibles</b><p>Foto real del satélite, solo de día. Las nubes se ven blancas.</p>',
    rain: () => '<b>🌧 Lluvia (pronóstico del modelo, mm)</b><div class="bar" style="background:linear-gradient(90deg,#9fd3ff,#3d8bff,#27c46b,#f2e63a,#ff9f2e,#e53935)"></div><div class="tk"><span>Llovizna</span><span>Moderada</span><span>Intensa</span></div><p>Lluvia estimada ahora por el modelo (Open-Meteo), en mm. No es radar: puede no coincidir con tormentas muy locales.</p>',
    wind: () => '<b>💨 Viento a 10 m</b><div class="bar" style="background:' + grad(WIND) + '"></div><div class="tk"><span>0</span><span>20</span><span>45</span><span>80+ km/h</span></div><p>Las líneas en movimiento muestran hacia dónde sopla. Los números son km/h. Tocá el mapa para ver el detalle de ese lugar.</p>',
    rayos: () => '<b>⚡ Rayos (GOES-19)</b><div class="dots"><span>' + boltSvg('#fff', 14) + ' 0–10 min</span><span>' + boltSvg('#ffd600', 14) + ' 10–30</span><span>' + boltSvg('#ff7043', 14) + ' 30–60</span></div><p>' + esc(rayTxt) + '</p>',
    dir: () => '<b>🧭 Rumbo de las nubes</b><div class="dots"><span>➤ Flecha: hacia dónde se mueven</span><span>Número: km/h</span></div><p>Viento a ~3.000 m de altura, el que empuja nubes y tormentas. Una tormenta suele seguir ese rumbo.</p>',
    temp: () => '<b>🌡 Temperatura</b><div class="bar" style="background:' + grad(TEMP) + '"></div><div class="tk"><span>-5°</span><span>10°</span><span>25°</span><span>40°</span></div>',
    smn: () => '<b>🇦🇷 Avisos del SMN</b><div class="dots"><span><i style="background:#ffd600"></i>Amarillo</span><span><i style="background:#ff9100"></i>Naranja</span><span><i style="background:#ff1744"></i>Rojo</span></div><p>Las zonas coloreadas son los avisos vigentes. El detalle está en Alertas, pestaña SMN.</p>'
  };
  function refreshLegend() {
    const rank = k => { const i = recent.indexOf(k); return i < 0 ? 99 : i; };
    const act = ['smn', 'temp', 'dir', 'wind', 'rayos', 'rain', 'ir'].filter(isOn).sort((a, b) => rank(a) - rank(b)).slice(0, 2).reverse();
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

  root.__mx.sheet = { mk: mkSheet, open: id => { closeSheets(); sheets[id].classList.add('show'); back.classList.add('show'); sheets[id].scrollTop = 0; }, close: closeSheets };

  /* hoja de capas */
  function buildLayers() {
    const body = sheets.layers.querySelector('.mx-body');
    const rows = [
      ['Nubes y lluvia', [['ir', '☁️', 'Nubes del satélite', 'Muestra dónde hay nubes y qué tan altas son.'], ['vis', '🌤', 'Nubes visibles (de día)', 'Foto real del satélite GOES.'], ['rain', '🌧', 'Lluvia (modelo)', 'Lluvia estimada ahora por el modelo meteorológico; no es radar.'], ['rayos', '⚡', 'Rayos (satélite GOES-19)', 'Descargas eléctricas de la última hora, con su ubicación exacta.']]],
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
  const offS = mkSheet('official', '🔔 Alertas');
  offS.querySelector('.mx-body').innerHTML = '<div class="mx-tabs"><button type="button" data-t="mine">Mis avisos</button><button type="button" data-t="smn">SMN</button><button type="button" data-t="mza">Mendoza</button><button type="button" data-t="quakes">Sismos</button></div><div class="mx-pane"></div>';
  offS.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { buzz(); showTab(b.dataset.t); });
  function openOfficial(tab) { closeSheets(); offS.classList.add('show'); back.classList.add('show'); offS.scrollTop = 0; showTab(tab || 'smn'); }
  let tabSeq = 0;
  function showTab(t) {
    const seq = ++tabSeq, pane = offS.querySelector('.mx-pane');
    offS.querySelectorAll('[data-t]').forEach(b => b.classList.toggle('on', b.dataset.t === t));
    if (t === 'mine') tabMine(pane); else if (t === 'smn') tabSmn(pane, seq); else if (t === 'mza') tabMza(pane, seq); else tabQuakes(pane, seq);
  }
  const stillHere = seq => seq === tabSeq;
  function tabMine(pane) {
    const evs = (typeof curEvents !== 'undefined' && curEvents) ? curEvents : [];
    let name = ''; try { name = cur().name; } catch (e) { }
    if (!evs.length) { pane.innerHTML = '<div class="mx-empty">✅ <b>Sin avisos para ' + esc(name || 'tu ubicación') + '</b><br>No se detecta ninguna amenaza ahora. Mirá las pestañas SMN, Mendoza y Sismos para ver lo oficial.</div>'; return; }
    const TY = root.TYPES || {}, TP = root.TIPS || {};
    pane.innerHTML = evs.map(e => {
      const col = e.level >= 3 ? '#ff1744' : e.level >= 2 ? '#ff9100' : '#ffd600', t = TY[e.type] || { icon: '⚠️', label: e.title };
      return '<div class="mx-card" style="--lv:' + col + '"><h4>' + esc(t.icon + ' ' + (e.title || t.label)) + '</h4><div class="meta">' + esc(e.place || name) + '</div><p>' + esc(plain(e.detail || '')) + '</p>' + (TP[e.type] ? '<div class="do">✅ <b>Qué hacer:</b> ' + esc(TP[e.type]) + '</div>' : '') + '</div>';
    }).join('');
  }
  const here = () => { try { return cur(); } catch (e) { return null; } };
  /* Texto de avisos: se corta en fin de oración o de palabra (nunca a mitad de palabra) y siempre termina con punto. */
  function shortText(t, n) {
    t = String(t || '').trim(); if (!t) return '';
    if (t.length > n) { let c = t.slice(0, n); const dot = Math.max(c.lastIndexOf('. '), c.lastIndexOf('; ')); c = dot > n * 0.5 ? c.slice(0, dot + 1) : c.slice(0, c.lastIndexOf(' ') > 0 ? c.lastIndexOf(' ') : n).replace(/[,;:\s]+$/, '') + '…'; t = c; }
    return /[.!?…]$/.test(t) ? t : t + '.';
  }
  const clean = t => (typeof root.cleanText === 'function' ? root.cleanText(t) : String(t || ''));
  /* Zona del aviso: lo que informa el SMN y, como ayuda, la ciudad de referencia más cercana al centro del área. */
  function zoneOf(a) {
    let lat = null, lon = null;
    const pts = (a.polys && a.polys[0]) || null;
    if (pts && pts.length) { const la = pts.map(x => x[0]), lo = pts.map(x => x[1]); lat = (Math.min(...la) + Math.max(...la)) / 2; lon = (Math.min(...lo) + Math.max(...lo)) / 2; }
    else if (a.circles && a.circles[0]) { lat = a.circles[0].lat; lon = a.circles[0].lon; }
    const np = lat != null && typeof root.nearPlace === 'function' ? root.nearPlace(lat, lon) : null;
    const zone = clean(a.area).replace(/^área indicada por smn$/i, '');
    return { lat, lon, zone, near: np, label: zone || (np ? 'Zona aproximada: cerca de ' + np.name + ' (' + np.province + ')' : 'Zona indicada en el mapa del SMN'), province: np ? np.province : 'Otras zonas' };
  }
  function alertCard(a, mine) {
    const lv = sevLevel(a), s = SEV[lv], ty = alertType(a), tips = (root.TIPS || {});
    const plain = ty && TYPE_PLAIN[ty] ? TYPE_PLAIN[ty] : '';
    const doIt = clean(a.instruction) || (ty && tips[ty]) || '';
    const z = zoneOf(a), title = clean(a.title), desc = clean(a.desc);
    const near = z.zone && z.near ? '<div class="meta">Cerca de ' + esc(z.near.name) + ' (' + esc(z.near.province) + ')</div>' : '';
    return '<div class="mx-card" style="--lv:' + s[1] + '"><h4>' + (ty ? TYPE_ICON[ty] + ' ' : '') + esc(title) + '</h4><div class="meta"><span class="mx-lv">' + s[0] + '</span>' + (mine ? '<b style="color:#ff8a95">Afecta tu ubicación</b> · ' : '') + '📍 ' + esc(z.label) + '</div>' + near +
      '<div class="meta">' + (a.onset ? 'Desde ' + esc(fmtTime(a.onset)) + ' · ' : '') + (a.expires ? 'Vigente hasta ' + esc(fmtTime(a.expires)) : 'Sin hora de fin informada') + '</div>' +
      (plain ? '<p>' + esc(plain) + '</p>' : '') + (desc ? '<p>' + esc(shortText(desc, 420)) + '</p>' : '') +
      (doIt ? '<div class="do">✅ <b>Qué hacer:</b> ' + esc(shortText(String(doIt), 400)) + '</div>' : '') +
      '<a class="mx-btn" href="' + esc(a.url) + '" target="_blank" rel="noopener">Ver aviso completo</a></div>';
  }
  async function tabSmn(pane, seq) {
    pane.innerHTML = '<div class="mx-load">Consultando al Servicio Meteorológico Nacional…</div>';
    const data = await loadSmn(true); if (!stillHere(seq)) return;
    const p = here(), mine = [], rest = [];
    data.forEach(a => { if (p && covers(a, p.lat, p.lon)) mine.push(a); else rest.push(a); });
    const byLv = (x, y) => sevLevel(y) - sevLevel(x); mine.sort(byLv); rest.sort(byLv);
    let h = '';
    if (data.error) h += '<div class="mx-empty" style="background:rgba(255,176,32,.12)">⚠️ No pude consultar el SMN ahora (sin conexión o el servicio no responde). Eso no significa que no haya avisos. Probá de nuevo en unos minutos.</div>';
    else if (!data.length) h += '<div class="mx-empty">✅ El SMN no informa avisos vigentes en este momento.<br><small>Consultado a las ' + new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) + '</small></div>';
    else h += '<div class="mx-note" style="margin:0 0 6px">' + data.length + ' aviso' + (data.length > 1 ? 's' : '') + ' vigente' + (data.length > 1 ? 's' : '') + ' en el país · consultado a las ' + new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) + '</div>';
    if (mine.length) h += '<div class="mx-sec">En tu ubicación</div>' + mine.map(a => alertCard(a, true)).join('');
    else if (data.length) h += '<div class="mx-empty">✅ <b>Ningún aviso del SMN afecta tu ubicación ahora.</b></div>';
    if (rest.length) {
      const groups = {}; rest.forEach(a => { const k = zoneOf(a).province; (groups[k] = groups[k] || []).push(a); });
      // Primero Mendoza, después las zonas más cercanas a vos; las lejanas quedan plegadas
      const dkm = (a1, o1, a2, o2) => Math.hypot((a1 - a2) * 111, (o1 - o2) * 111 * Math.cos(a1 * Math.PI / 180));
      const near = k => { if (!p) return 0; let m = 1e9; groups[k].forEach(a => { const z = zoneOf(a); if (z.lat != null) m = Math.min(m, dkm(p.lat, p.lon, z.lat, z.lon)); }); return m; };
      const keys = Object.keys(groups).sort((x, y) => (/Mendoza/.test(y) ? 1 : 0) - (/Mendoza/.test(x) ? 1 : 0) || near(x) - near(y) || x.localeCompare(y, 'es'));
      const sec = k => '<div class="mx-sec">' + (/Mendoza/.test(k) ? 'En Mendoza' : 'Zona de ' + esc(k)) + ' (' + groups[k].length + ')</div>' + groups[k].map(a => alertCard(a, false)).join('');
      const shown = keys.filter((k, i) => /Mendoza/.test(k) || i < 2), later = keys.filter(k => shown.indexOf(k) < 0);
      shown.forEach(k => { h += sec(k); });
      if (later.length) {
        const cnt = later.reduce((s, k) => s + groups[k].length, 0);
        h += '<details class="mx-more"><summary>Otras zonas del país (' + cnt + ' aviso' + (cnt > 1 ? 's' : '') + ')</summary>' + later.map(sec).join('') + '</details>';
      }
    }
    h += '<div class="mx-note">Fuente: feed público de alertas del SMN (formato CAP). Solo se muestran avisos con zona definida en el mapa. Para el parte oficial completo: <a href="https://www.smn.gob.ar/alertas" target="_blank" rel="noopener" style="color:#8fd3ff">smn.gob.ar/alertas</a>.</div>';
    pane.innerHTML = h;
  }
  async function mzaText() {
    const U = 'https://contingencias.mendoza.gov.ar/web1/Alertadeheladas/alertadeheladas.php', ac = new AbortController(), t = setTimeout(() => ac.abort(), 8000);
    try {
      const r = await fetch(U, { signal: ac.signal, cache: 'no-store' }); if (!r.ok) throw new Error('HTTP ' + r.status);
      const d = new DOMParser().parseFromString(await r.text(), 'text/html');
      d.querySelectorAll('script,style,noscript,nav,header,footer,form,select,option,button').forEach(n => n.remove());
      const all = ((d.body && d.body.textContent) || '').replace(/\s+/g, ' ').trim();
      // La página mezcla menús y publicidad: solo se dejan frases del aviso (hablan de helada/temperatura y traen algún número)
      const menu = /imprima|factura|\bRUT\b|seguro agr|conozca|propiedades rurales|radar informaci|temporada \d{4}|prevenir el riesgo y disminuir|emergencia agropecuaria|estad[ií]stica/i;
      const keep = all.split(/(?<=[.!?])\s+/).filter(s => /helada|temperatura|m[ií]nima|grados|°/i.test(s) && /\d/.test(s) && !menu.test(s));
      return keep.join(' ').slice(0, 600);
    } finally { clearTimeout(t); }
  }
  async function tabMza(pane, seq) {
    const evs = (typeof curEvents !== 'undefined' && curEvents) || [], tips = root.TIPS || {};
    let h = '<div class="mx-sec">Hoy en tu ubicación y fincas</div>';
    const rel = evs.filter(e => /frost|hail|zonda|wind|storm/i.test(e.type || ''));
    h += rel.length ? rel.slice(0, 6).map(e => '<div class="mx-card" style="--lv:' + (SEV[e.level] || SEV[1])[1] + '"><h4>' + esc(e.title) + '</h4><div class="meta">' + esc(e.place || '') + '</div><p>' + esc(plain(e.detail || '')) + '</p>' + (tips[e.type] ? '<div class="do">✅ ' + esc(tips[e.type]) + '</div>' : '') + '</div>').join('')
      : '<div class="mx-empty">✅ Sin avisos de helada, granizo, Zonda ni tormenta fuerte para tus lugares ahora.</div>';
    h += '<div class="mx-sec">Contingencias Climáticas · Gobierno de Mendoza</div>' +
      '<div><a class="mx-btn" href="https://contingencias.mendoza.gov.ar/web1/Alertadeheladas/alertadeheladas.php" target="_blank" rel="noopener">🥶 Alerta de heladas</a>' +
      '<a class="mx-btn" href="https://contingencias.mendoza.gov.ar/" target="_blank" rel="noopener">🧊 Granizo y contingencias</a>' +
      '<a class="mx-btn" href="https://www.mendoza.gov.ar/" target="_blank" rel="noopener">🏛 Gobierno de Mendoza</a></div><div class="mx-sec">Último texto publicado (heladas)</div><div class="mx-load" id="mx-mzt">Buscando…</div>';
    h += '<div class="mx-sec">Qué hacer según el fenómeno</div>' + ['frost', 'hail', 'zonda', 'stormStrong', 'wind'].filter(k => tips[k]).map(k => '<div class="mx-card" style="--lv:#35b6ff"><h4>' + TYPE_ICON[k] + ' ' + ({ frost: 'Helada', hail: 'Granizo', zonda: 'Viento Zonda', stormStrong: 'Tormenta fuerte', wind: 'Viento fuerte' })[k] + '</h4><p>' + esc(tips[k]) + '</p></div>').join('');
    pane.innerHTML = h;
    try {
      const tx = await mzaText(); if (!stillHere(seq)) return; const box = $('mx-mzt');
      if (box) { box.className = 'mx-card'; box.style.setProperty('--lv', '#35b6ff'); box.innerHTML = tx.length > 25 ? '<p>' + esc(plain(tx)) + '</p><div class="mx-note">Frases de la página oficial que hablan de heladas. Para el parte completo abrí la página.</div>' : '<p>La página oficial no publica ahora un texto de aviso que se pueda mostrar acá. Abrila con el botón de arriba.</p>'; }
    } catch (e) { const box = $('mx-mzt'); if (box && stillHere(seq)) { box.className = 'mx-note'; box.textContent = 'No pude leer la página ahora. Abrila con el botón de arriba.'; } }
  }
  /* Sismos: siempre se muestran los últimos 3 de la región (aunque queden fuera del radio o la magnitud elegidos)
     y, aparte, los que sí caen dentro de lo configurado (esos además se dibujan en el mapa con hora e intensidad). */
  let recentQ = null, recentQAt = 0;
  async function loadRecentQuakes() {
    if (recentQ && Date.now() - recentQAt < 5 * 60e3) return recentQ;
    try { const li = await fetchInpres(); if (li && li.length) { recentQ = li.filter(x => x.mag >= 2.5).slice(0, 20); recentQAt = Date.now(); return recentQ; } } catch (e) {}
    const start = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 19);
    const u = 'https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&orderby=time&limit=20&minmagnitude=2.5&minlatitude=-56&maxlatitude=-20&minlongitude=-76&maxlongitude=-52&starttime=' + start;
    const ac = new AbortController(), t = setTimeout(() => ac.abort(), 9000);
    try {
      const r = await fetch(u, { signal: ac.signal }); if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      recentQ = (j.features || []).map(f => ({ id: f.id, mag: f.properties.mag, place: quakePlaceEs(f.properties.place), source: 'USGS', time: f.properties.time, lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], depth: f.geometry.coordinates[2] })).filter(x => Number.isFinite(x.mag));
      recentQAt = Date.now(); return recentQ;
    } finally { clearTimeout(t); }
  }
  function ago(ms) { const m = Math.max(0, Math.round((Date.now() - ms) / 60000)); return m < 60 ? 'hace ' + m + ' min' : m < 1440 ? 'hace ' + Math.floor(m / 60) + ' h' : 'hace ' + Math.floor(m / 1440) + ' d'; }
  function quakeCard(x, p, inRange) {
    const d = p ? Math.round(Math.hypot((x.lat - p.lat) * 111, (x.lon - p.lon) * 111 * Math.cos(p.lat * D2R))) : null, lv = x.mag >= 5 ? 3 : x.mag >= 4 ? 2 : 1;
    return '<div class="mx-card" style="--lv:' + SEV[lv][1] + '"><h4>🌎 Sismo de magnitud ' + Number(x.mag).toFixed(1).replace('.', ',') + (inRange ? ' <span class="mx-lv" style="--lv:#ff5252">En tu rango</span>' : '') + '</h4><div class="meta">' + esc(clean(x.place) || 'Región cercana') + (x.time ? '<br>🕒 ' + esc(fmtTime(x.time)) + ' · ' + ago(x.time) : '') + '</div><p>A ' + Math.round(x.depth) + ' kilómetros de profundidad' + (d != null ? ' · a ' + d + ' kilómetros de ' + esc(p.name) : '') + '</p></div>';
  }
  async function tabQuakes(pane, seq) {
    const mine = (typeof quakes !== 'undefined' && quakes) ? quakes.slice().sort((a, b) => (b.time || 0) - (a.time || 0)) : [], p = here();
    const cfgNow = typeof cfg !== 'undefined' ? cfg : { quakeMag: 4, quakeKm: 300 };
    let h = '<div class="mx-sec">Dentro de tu rango (M ' + cfgNow.quakeMag + '+ · hasta ' + cfgNow.quakeKm + ' km · últimas 3 h)</div>' +
      (mine.length ? mine.slice(0, 6).map(x => quakeCard(x, p, true)).join('') : '<div class="mx-empty">✅ No hubo sismos dentro del radio y la magnitud que elegiste en las últimas 3 horas.</div>');
    pane.innerHTML = h + '<div class="mx-sec">Últimos sismos de la región</div><div class="mx-load">Buscando…</div>';
    let list = null;
    try { list = await loadRecentQuakes(); } catch (e) { list = null; }
    if (seq != null && !stillHere(seq)) return;
    const mineIds = new Set(mine.map(x => x.id));
    h += '<div class="mx-sec">Últimos 3 sismos de la región</div>';
    if (list && list.length) h += list.slice(0, 3).map(x => quakeCard(x, p, mineIds.has(x.id))).join('') + '<div class="mx-note">Se muestran siempre, aunque queden fuera del radio o la magnitud que elegiste. Región: Argentina y alrededores (magnitud 2,5 o más).</div>';
    else h += '<div class="mx-empty" style="background:rgba(255,176,32,.12)">No pude consultar la lista de sismos recientes ahora. Probá de nuevo en unos minutos.</div>';
    h += '<div class="mx-note">Datos del ' + (list && list[0] && list[0].source === 'INPRES' ? 'INPRES (fuente oficial de Argentina)' : 'USGS; la fuente oficial en Argentina es el INPRES, que no respondió' + (window.inpresWhy ? ' (' + esc(window.inpresWhy) + ')' : '')) + ': <a href="https://www.inpres.gob.ar/" target="_blank" rel="noopener" style="color:#8fd3ff">inpres.gob.ar</a>.</div>';
    pane.innerHTML = h;
  }

  /* ---------- botones de la barra inferior: ícono + texto ---------- */
  const EMO = /^(\p{Extended_Pictographic}️?)\s*([\s\S]*)$/u;
  function decorate(b) {
    if (!b || b.querySelector('.ic')) return;
    const m = EMO.exec((b.textContent || '').trim()); if (!m) return;
    b.textContent = ''; const i = el('span', 'ic'), t = el('span', 'tx'); i.textContent = m[1]; t.textContent = m[2].replace(/GPS vivo:/i, 'GPS'); b.append(i, t);
  }
  const barBtns = ['gpsGo', 'searchToggle', 'fincaDd', 'cfgBtn', 'sos'];
  barBtns.forEach(id => { const b = $(id); if (!b) return; decorate(b); new MutationObserver(() => { if (!b.querySelector('.ic')) decorate(b); }).observe(b, { childList: true, characterData: true, subtree: true }); });
  // el botón 🎯 GPS ya activa/pausa la ubicación; el interruptor viejo queda oculto (la lógica lo usa)
  (function () { const lv = $('live'); if (lv) lv.style.display = 'none'; })();
  const sb = $('searchToggle'); if (sb) { const t = sb.querySelector('.tx'); if (t) t.textContent = 'Buscar'; }
  const ab = $('cfgBtn'); if (ab) { const t = ab.querySelector('.tx'); if (t) t.textContent = 'Avisos'; }

  /* ---------- sincronizar estado visual ---------- */
  function syncUI() {
    dock.querySelectorAll('.mx-chip[data-k]').forEach(b => { const k = b.dataset.k; if (!k.startsWith('act:')) { const on = isOn(k); b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); } });
    document.querySelectorAll('[data-sw]').forEach(b => b.setAttribute('aria-checked', String(isOn(b.dataset.sw))));
    document.querySelectorAll('[data-base]').forEach(b => b.classList.toggle('on', b.dataset.base === baseKey));
    refreshLegend();
  }
  setInterval(() => safe('sync', syncUI), 2500);

  /* ---------- arranque ---------- */
  safe('base', () => setBase(baseKey));
  safe('op', applyOpacity);
  safe('hud', refreshHUD);
  safe('sync', syncUI);
  safe('grid', () => { if (gridNeeded()) refreshGrid(false); });
  safe('smn', () => { if (S.smn) applySmn(); });
  safe('rayos', () => { if (S.rayos) applyRayos(false); });
  setInterval(() => safe('gridTimer', () => { if (gridNeeded()) refreshGrid(true); }), 15 * 60e3);
  root.__mxState = () => ({ S, G, baseKey, op });
})(typeof window !== 'undefined' ? window : globalThis);

