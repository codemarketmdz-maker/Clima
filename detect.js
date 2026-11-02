/* Lógica compartida de detección (la usan index.html y sw.js) */
(function (g) {
  'use strict';
  const ND = ['norte', 'noreste', 'este', 'sudeste', 'sur', 'sudoeste', 'oeste', 'noroeste'];

  g.TYPES = {
    wind:        { icon: '💨', label: 'Viento fuerte',   desc: 'Ráfagas por encima del umbral elegido' },
    zonda:       { icon: '🌬️', label: 'Viento Zonda',    desc: 'Viento seco y cálido del oeste' },
    stormWeak:   { icon: '🌦️', label: 'Tormenta débil',  desc: 'Lluvia o chaparrones leves' },
    stormStrong: { icon: '⛈️', label: 'Tormenta fuerte', desc: 'Lluvia intensa y actividad eléctrica' },
    hail:        { icon: '🧊', label: 'Tormenta severa / granizo', desc: 'Topes de nube muy fríos o tormenta muy inestable: posible granizo' },
    quake:       { icon: '🏛️', label: 'Sismo',           desc: 'Sismos cercanos' }
  };
  g.RANK = { hail: 3, stormStrong: 2, stormWeak: 1 };

  // Qué hacer (se muestra en la tarjeta y en la notificación)
  g.TIPS = {
    wind: 'Asegurá objetos sueltos, alejate de árboles, carteles y cables. Evitá rutas expuestas con vehículos altos.',
    zonda: 'Cerrá puertas y ventanas, no hagas fuego, alejate de árboles y cables. Cuidá a personas con problemas respiratorios.',
    stormWeak: 'Reducí la velocidad y encendé luces. No cruces calles anegadas ni zanjones.',
    stormStrong: 'Buscá refugio firme, alejate de ventanas, árboles y cables. No cruces zanjones ni calles anegadas.',
    hail: 'Poné el vehículo bajo techo o refugiate en un lugar cerrado. No te pares bajo árboles. Alejate de ventanas.',
    quake: 'Agachate, cubrite y agarrate junto a un mueble firme. Alejate de ventanas. No uses ascensores.'
  };

  g.DEFAULT_CFG = {
    notify: { wind: true, zonda: true, stormWeak: false, stormStrong: true, hail: true, quake: true },
    escape: true,
    windKmh: 60, quakeMag: 4, quakeKm: 300, repeatMin: 60, sound: true, vibrate: true
  };
  g.mergeCfg = function (s) {
    s = s || {};
    const d = g.DEFAULT_CFG;
    const out = Object.assign({}, d, s, { notify: Object.assign({}, d.notify, s.notify || {}) });
    delete out.notify.smn;
    return out;
  };

  g.bearingName = b => ND[Math.round((((b % 360) + 360) % 360) / 45) % 8];

  // Clasificación de tormenta combinando:
  //  - el modelo (código WMO + lluvia), que suele subestimar las tormentas convectivas,
  //  - la inestabilidad (CAPE / índice de levantamiento) y
  //  - la observación del satélite: temperatura de topes de nube (x.ctt, °C) y fracción de píxeles muy fríos (x.cold).
  g.stormClass = function (code, pr, x) {
    pr = pr || 0; x = x || {};
    const cape = x.cape, li = x.lifted_index, ctt = x.ctt, cold = x.cold || 0;
    const unstable = cape == null || cape >= 300;
    let r = 0;
    // Modelo
    if (code >= 96) r = 3;
    else if (code === 95 && cape >= 2000 && (li == null || li <= -5)) r = 3;
    else if (code === 95 || code === 82 || pr >= 4) r = 2;
    else if ((code === 80 || code === 81 || code === 65) && cape >= 1000 && (li == null || li <= -3)) r = 2;
    else if ((code >= 51 && code <= 67) || code === 80 || code === 81 || pr >= 0.2) r = 1;
    // Satélite (observado)
    if (ctt != null) {
      let s = 0;
      if (ctt <= -70 && cold >= 0.25 && unstable) s = 3;            // topes extremadamente fríos: tormenta severa
      else if (ctt <= -62 && cold >= 0.2 && cape >= 1500) s = 3;
      else if (ctt <= -52 && cold >= 0.1 && (unstable || r)) s = 2;  // convección profunda
      else if (ctt <= -40 && (r || cape >= 500)) s = 1;
      if (s > r) r = s;
    }
    return r === 3 ? 'hail' : r === 2 ? 'stormStrong' : r === 1 ? 'stormWeak' : null;
  };

  // Texto con los datos que respaldan la clasificación
  g.stormWhy = function (x) {
    x = x || {};
    const p = [];
    if (x.ctt != null && x.ctt <= -40) p.push('satélite: topes de nube a ' + Math.round(x.ctt) + ' °C' + (x.ctt <= -65 ? ' (muy altos)' : ''));
    if (x.cape >= 500) p.push('inestabilidad (CAPE) ' + Math.round(x.cape) + ' J/kg');
    return p.length ? ' (' + p.join(', ') + ')' : '';
  };

  function zondaScore(c) {
    const d = c.wind_direction_10m, w = d >= 225 && d <= 315;
    let s = 0;
    if (w) s++;
    if (c.wind_gusts_10m >= 40) s++;
    if (c.wind_gusts_10m >= 60) s++;
    if (c.relative_humidity_2m <= 30) s++;
    if (c.temperature_2m >= 22) s++;
    return w && s >= 3 ? 2 : (w && s === 2 ? 1 : 0);
  }

  const when = h => (h <= 0 ? 'ahora' : 'en ~' + h + ' h');

  // Eventos para un punto: c = current, h = hourly (próximas 6 h), place = nombre del lugar
  g.detectPoint = function (c, h, cfg, place) {
    const ev = [];
    h = h || {};
    const first = {};
    const consider = (k, hr) => { if (k && (first[k] === undefined || hr < first[k])) first[k] = hr; };
    consider(g.stormClass(c.weather_code, c.precipitation, c), 0);
    (h.weather_code || []).forEach((w, i) => consider(g.stormClass(w, (h.precipitation || [])[i] || 0,
      { cape: (h.cape || [])[i], lifted_index: (h.lifted_index || [])[i] }), i));

    const txt = { hail: 'Tormenta severa con posible granizo ', stormStrong: 'Tormenta fuerte con lluvia intensa y rayos ', stormWeak: 'Lluvia o tormenta débil ' };
    Object.keys(first).forEach(k => ev.push({
      type: k, level: g.RANK[k], title: g.TYPES[k].label, place: place,
      detail: txt[k] + when(first[k]) + (first[k] === 0 ? g.stormWhy(c) : '') + '.'
    }));

    let gust = c.wind_gusts_10m || 0;
    (h.wind_gusts_10m || []).forEach(v => { if (v > gust) gust = v; });
    if (gust >= cfg.windKmh) {
      const level = gust >= cfg.windKmh + 40 ? 3 : gust >= cfg.windKmh + 20 ? 2 : 1;
      ev.push({ type: 'wind', level, title: 'Viento fuerte', place: place, detail: 'Ráfagas de hasta ' + Math.round(gust) + ' km/h (próximas 6 h).' });
    }
    const z = zondaScore(c);
    if (z) ev.push({
      type: 'zonda', level: z === 2 ? 2 : 1, title: 'Viento Zonda', place: place,
      detail: (z === 2 ? 'Condiciones propicias de Zonda: ' : 'Posible Zonda: ') +
        'viento del ' + g.bearingName(c.wind_direction_10m) + ', humedad ' + c.relative_humidity_2m + '%, ' + Math.round(c.temperature_2m) + '°C.'
    });
    return ev;
  };

  // ---- Clima con varias fuentes (todas se piden directo desde el celular, sin servidor propio) ----
  // Orden: Open-Meteo -> MET Norway -> wttr.in -> (opcional) servidor propio si g.WEATHER_API está definido.
  // Si una alcanza su límite o falla, se pasa a la siguiente y se la deja "en pausa" un rato.
  // Devuelve un array [{current, hourly}] en formato Open-Meteo.
  const CUR_FULL = 'temperature_2m,relative_humidity_2m,precipitation,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,wind_gusts_10m,cape,lifted_index';
  const BLK = 'wxBlock';
  let blocks = {};
  try { blocks = JSON.parse((g.localStorage && g.localStorage.getItem(BLK)) || '{}') || {}; } catch (e) {}
  const isBlocked = n => (blocks[n] || 0) > Date.now();
  function setBlock(n, ms) {
    blocks[n] = Date.now() + ms;
    try { g.localStorage && g.localStorage.setItem(BLK, JSON.stringify(blocks)); } catch (e) {}
  }
  const untilMidnight = () => { const d = new Date(); d.setUTCHours(24, 0, 0, 0); return d - Date.now(); };
  async function getJ(url, ms) {
    const c = new AbortController(), t = setTimeout(() => c.abort(), ms);
    try {
      const r = await fetch(url, { signal: c.signal });
      let j = null; try { j = await r.json(); } catch (e) {}
      if (!r.ok || (j && j.error)) {
        const err = new Error((j && j.reason) || ('HTTP ' + r.status));
        err.limit = r.status === 429 || /limit/i.test(err.message);
        throw err;
      }
      return j;
    } finally { clearTimeout(t); }
  }

  // 1) Open-Meteo
  async function runOpenMeteo(pts, full, hourly, ms) {
    const u = 'https://api.open-meteo.com/v1/forecast?latitude=' + pts.map(p => (+p[0]).toFixed(3)).join(',') +
      '&longitude=' + pts.map(p => (+p[1]).toFixed(3)).join(',') +
      '&current=' + (full ? CUR_FULL : 'weather_code,precipitation,cape,lifted_index') +
      (hourly ? '&hourly=weather_code,precipitation,wind_gusts_10m,cape,lifted_index&forecast_hours=6' : '') + '&timezone=auto&wind_speed_unit=kmh';
    const j = await getJ(u, ms);
    return (Array.isArray(j) ? j : [j]).map(d => ({ current: d.current, hourly: d.hourly }));
  }

  // 2) MET Norway (yr.no)
  function metToWmo(s, pr) {
    s = (s || '').replace(/_(day|night|polartwilight)$/, '');
    if (/thunder/.test(s)) return 95;
    if (/sleet/.test(s)) return /heavy/.test(s) ? 67 : 66;
    if (/snow/.test(s)) return /heavy/.test(s) ? 75 : /light/.test(s) ? 71 : 73;
    if (/rainshowers/.test(s)) return /heavy/.test(s) ? 82 : /light/.test(s) ? 80 : 81;
    if (/rain/.test(s)) return /heavy/.test(s) ? 65 : /light/.test(s) ? 61 : 63;
    if (s === 'fog') return 45;
    if (s === 'cloudy') return 3;
    if (s === 'partlycloudy') return 2;
    if (s === 'fair') return 1;
    if (s === 'clearsky') return 0;
    return pr >= 0.2 ? 61 : 0;
  }
  async function metOne(lat, lon, ms) {
    const j = await getJ('https://api.met.no/weatherapi/locationforecast/2.0/complete?lat=' + (+lat).toFixed(4) + '&lon=' + (+lon).toFixed(4), ms);
    const ts = (j && j.properties && j.properties.timeseries) || [];
    if (!ts.length) throw new Error('MET sin datos');
    const now = Date.now();
    let i0 = ts.findIndex(t => Date.parse(t.time) + 3600e3 > now);
    if (i0 < 0) i0 = 0;
    const conv = t => {
      const d = t.data.instant.details, n = t.data.next_1_hours || t.data.next_6_hours || {};
      const pr = (n.details && n.details.precipitation_amount) || 0;
      return {
        temperature_2m: d.air_temperature,
        relative_humidity_2m: Math.round(d.relative_humidity),
        precipitation: pr,
        weather_code: metToWmo(n.summary && n.summary.symbol_code, pr),
        cloud_cover: Math.round(d.cloud_area_fraction),
        wind_speed_10m: Math.round(d.wind_speed * 3.6 * 10) / 10,
        wind_direction_10m: Math.round(d.wind_from_direction),
        wind_gusts_10m: Math.round((d.wind_speed_of_gust != null ? d.wind_speed_of_gust : d.wind_speed * 1.5) * 3.6 * 10) / 10
      };
    };
    const hrs = ts.slice(i0, i0 + 6).map(conv);
    return {
      current: hrs[0],
      hourly: { weather_code: hrs.map(h => h.weather_code), precipitation: hrs.map(h => h.precipitation), wind_gusts_10m: hrs.map(h => h.wind_gusts_10m) }
    };
  }
  const runMet = (pts, full, hourly, ms) => Promise.all(pts.map(p => metOne(p[0], p[1], ms)));

  // 3) wttr.in
  function wwoToWmo(c) {
    c = +c;
    if ([200, 386, 389, 392, 395].includes(c)) return 95;
    if (c === 113) return 0;
    if (c === 116) return 2;
    if (c === 119 || c === 122) return 3;
    if ([143, 248, 260].includes(c)) return 45;
    if (c === 176 || c === 353) return 80;
    if (c === 356) return 81;
    if (c === 359) return 82;
    if ([263, 266, 293, 296].includes(c)) return 61;
    if (c === 299 || c === 302) return 63;
    if (c === 305 || c === 308) return 65;
    if ([182, 185, 281, 284, 311, 314, 317, 320, 350, 362, 365, 374, 377].includes(c)) return 66;
    if ([179, 227, 230, 323, 326, 329, 332, 335, 338, 368, 371].includes(c)) return 73;
    return 0;
  }
  async function wttrOne(lat, lon, ms) {
    const j = await getJ('https://wttr.in/' + (+lat).toFixed(3) + ',' + (+lon).toFixed(3) + '?format=j1', ms);
    const c = j && j.current_condition && j.current_condition[0];
    if (!c) throw new Error('wttr sin datos');
    const current = {
      temperature_2m: +c.temp_C, relative_humidity_2m: +c.humidity, precipitation: +c.precipMM || 0,
      weather_code: wwoToWmo(c.weatherCode), cloud_cover: +c.cloudcover,
      wind_speed_10m: +c.windspeedKmph, wind_direction_10m: +c.winddirDegree, wind_gusts_10m: +c.windspeedKmph * 1.5
    };
    const slots = [];
    (j.weather || []).forEach(d => (d.hourly || []).forEach(h => {
      slots.push({ t: Date.parse(d.date + 'T00:00:00Z') + (+h.time / 100) * 3600e3, h });
    }));
    const m = /(\d{4}-\d{2}-\d{2}) (\d{1,2}):(\d{2}) (AM|PM)/.exec(c.localObsDateTime || '');
    let nowLocal = Date.now();
    if (m) { let hh = +m[2] % 12; if (m[4] === 'PM') hh += 12; nowLocal = Date.parse(m[1] + 'T00:00:00Z') + hh * 3600e3 + +m[3] * 60e3; }
    const H = { weather_code: [], precipitation: [], wind_gusts_10m: [] };
    for (let i = 0; i < 6; i++) {
      const t = nowLocal + i * 3600e3;
      const s = slots.filter(x => x.t <= t).pop() || slots[0];
      if (!s) break;
      H.weather_code.push(wwoToWmo(s.h.weatherCode));
      H.precipitation.push((+s.h.precipMM || 0) / 3);
      H.wind_gusts_10m.push(+s.h.WindGustKmph || 0);
    }
    if (H.wind_gusts_10m.length) current.wind_gusts_10m = Math.max(current.wind_speed_10m, H.wind_gusts_10m[0]);
    return { current, hourly: H };
  }
  const runWttr = (pts, full, hourly, ms) => Promise.all(pts.map(p => wttrOne(p[0], p[1], ms)));

  // 4) Servidor propio (opcional): definir window.WEATHER_API = 'https://tu-sitio.netlify.app' para usarlo
  async function runServer(pts, full, hourly, ms) {
    const base = (g.WEATHER_API || '').replace(/\/$/, '');
    const u = base + '/api/weather?lat=' + pts.map(p => (+p[0]).toFixed(2)).join(',') + '&lon=' + pts.map(p => (+p[1]).toFixed(2)).join(',') +
      '&full=' + (full ? 1 : 0) + '&hourly=' + (hourly ? 1 : 0);
    const r = await getJ(u, ms + 10000);
    return r.data;
  }

  const PROVIDERS = [
    { name: 'open-meteo', label: 'Open-Meteo', max: 50, run: runOpenMeteo },
    { name: 'met-norway', label: 'MET Norway', max: 24, run: runMet },
    { name: 'wttr', label: 'wttr.in', max: 12, run: runWttr },
    { name: 'servidor', label: 'Servidor propio', max: 50, run: runServer, enabled: () => !!g.WEATHER_API }
  ];

  g.weatherSource = '';
  g.fetchWeather = async function (pts, opts) {
    opts = opts || {};
    const full = opts.full !== false, hourly = !!opts.hourly, ms = opts.timeout || 8000;
    const errors = []; let allLimit = true, tried = 0;
    for (const p of PROVIDERS) {
      if (p.enabled && !p.enabled()) continue;
      if (pts.length > p.max) continue;
      if (isBlocked(p.name)) { errors.push(p.label + ': en pausa por límite'); continue; }
      tried++;
      try {
        const data = await p.run(pts, full, hourly, ms);
        if (!data || !data.length || !data.every(d => d && d.current)) throw new Error('respuesta sin datos');
        g.weatherSource = p.label;
        return data;
      } catch (e) {
        const msg = (e && e.name === 'AbortError') ? 'tiempo agotado' : ((e && e.message) || 'error');
        if (e && e.limit) setBlock(p.name, /minut/i.test(msg) ? 60e3 : /hour/i.test(msg) ? 3600e3 : p.name === 'open-meteo' ? untilMidnight() : 900e3);
        else allLimit = false;
        errors.push(p.label + ': ' + msg);
      }
    }
    const err = new Error('Ningún proveedor respondió (' + (errors.join(' | ') || 'sin proveedores disponibles') + ')');
    err.limit = allLimit && tried > 0;
    throw err;
  };

  // ---- Satélite: temperatura de topes de nube (observado, GOES-East, NASA GIBS) ----
  // Se calcula directo en el celular: baja los mosaicos del satélite, los lee y busca el punto más frío
  // en ~10 km a la redonda. Devuelve [{min, cold}] por punto, o null si no hay datos. Nunca lanza error.
  const CT_LAYER = 'GOES-East_ABI_Band13_Clean_Infrared', CT_Z = 6, CT_TS = 256;
  const CT_CMAP = 'https://gibs.earthdata.nasa.gov/colormaps/v1.3/Clean_Longwave_Infrared_Window_Band.xml';
  let ctMap = null;
  async function ctColormap() {
    if (ctMap) return ctMap;
    const c = new AbortController(), t = setTimeout(() => c.abort(), 8000);
    try {
      const r = await fetch(CT_CMAP, { signal: c.signal });
      if (!r.ok) throw new Error('colormap HTTP ' + r.status);
      const xml = await r.text();
      const m = new Map(); const re = /rgb="(\d+),(\d+),(\d+)"[^>]*?value="\(([-+\d.INF]+),([-+\d.INF]+)\]"/g; let x;
      while ((x = re.exec(xml))) {
        const a = parseFloat(x[4]), b = parseFloat(x[5]);
        const v = isFinite(a) && isFinite(b) ? (a + b) / 2 : isFinite(a) ? a : b;
        const k = x[1] + ',' + x[2] + ',' + x[3];
        if (!m.has(k)) m.set(k, v);
      }
      if (m.size < 50) throw new Error('colormap inválido');
      return (ctMap = m);
    } finally { clearTimeout(t); }
  }
  function ctColorToC(m, r, gg, b) {
    const k = r + ',' + gg + ',' + b;
    if (m.has(k)) return m.get(k);
    let best = null, bd = 1e9;
    for (const [kk, v] of m) {
      const c = kk.split(','), d = (c[0] - r) ** 2 + (c[1] - gg) ** 2 + (c[2] - b) ** 2;
      if (d < bd) { bd = d; best = v; }
    }
    const val = bd <= 300 ? best : null;
    m.set(k, val);
    return val;
  }
  const ctWorld = (lat, lon) => {
    const n = CT_TS * 2 ** CT_Z, s = Math.sin(lat * Math.PI / 180);
    return [(lon + 180) / 360 * n, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n];
  };
  let ctTiles = new Map(), ctBucket = 0;
  function ctTile(tx, ty) {
    const bk = Math.floor(Date.now() / 600000);
    if (bk !== ctBucket) { ctBucket = bk; ctTiles = new Map(); }
    const k = tx + '/' + ty;
    if (!ctTiles.has(k)) ctTiles.set(k, (async () => {
      const c = new AbortController(), t = setTimeout(() => c.abort(), 10000);
      try {
        const u = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/' + CT_LAYER + '/default/default/GoogleMapsCompatible_Level6/' + CT_Z + '/' + ty + '/' + tx + '.png';
        const r = await fetch(u, { signal: c.signal });
        if (!r.ok) throw new Error('tile HTTP ' + r.status);
        const bmp = await createImageBitmap(await r.blob());
        const cv = new OffscreenCanvas(bmp.width, bmp.height), cx = cv.getContext('2d', { willReadFrequently: true });
        cx.drawImage(bmp, 0, 0);
        return cx.getImageData(0, 0, bmp.width, bmp.height).data;
      } finally { clearTimeout(t); }
    })().catch(() => null));
    return ctTiles.get(k);
  }
  g.fetchCloudTops = async function (pts) {
    try {
      if (g.WEATHER_API) {
        const u = g.WEATHER_API.replace(/\/$/, '') + '/api/cloudtops?lat=' + pts.map(p => (+p[0]).toFixed(2)).join(',') + '&lon=' + pts.map(p => (+p[1]).toFixed(2)).join(',');
        const r = await getJ(u, 12000);
        if (Array.isArray(r && r.data)) return r.data;
      }
      if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function' || pts.length > 40) return null;
      const m = await ctColormap();
      const out = await Promise.all(pts.map(async ([lat, lon]) => {
        const [wx, wy] = ctWorld(lat, lon);
        const kmPerPx = 40075 * Math.cos(lat * Math.PI / 180) / (CT_TS * 2 ** CT_Z);
        const R = Math.max(2, Math.round(10 / kmPerPx));
        let min = Infinity, n = 0, cold = 0;
        for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
          if (dx * dx + dy * dy > R * R) continue;
          const X = Math.floor(wx) + dx, Y = Math.floor(wy) + dy;
          const d = await ctTile(Math.floor(X / CT_TS), Math.floor(Y / CT_TS));
          if (!d) continue;
          const o = ((((Y % CT_TS) + CT_TS) % CT_TS) * CT_TS + (((X % CT_TS) + CT_TS) % CT_TS)) * 4;
          if (d[o + 3] < 128) continue;
          const v = ctColorToC(m, d[o], d[o + 1], d[o + 2]);
          if (v == null) continue;
          n++; if (v < min) min = v; if (v <= -52) cold++;
        }
        return n ? { min: Math.round(min * 10) / 10, cold: Math.round(cold / n * 100) / 100 } : null;
      }));
      return out.some(Boolean) ? out : null;
    } catch (e) { return null; }
  };
  // Agrega ctt/cold a cada "current" (arr en formato [{current}])
  g.attachCloudTops = function (arr, ct) {
    if (!arr || !ct) return arr;
    arr.forEach((d, i) => { const t = ct[i]; if (d && d.current && t) { d.current.ctt = t.min; d.current.cold = t.cold; } });
    return arr;
  };

  // ---- Sismos (USGS: con CORS, sirve desde navegador y service worker) ----
  g.fetchUSGS = async function (loc, cfg) {
    const start = new Date(Date.now() - 3 * 3600e3).toISOString();
    const u = 'https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&orderby=time&starttime=' + start +
      '&latitude=' + loc.lat + '&longitude=' + loc.lon + '&maxradiuskm=' + cfg.quakeKm + '&minmagnitude=' + cfg.quakeMag;
    const j = await (await fetch(u)).json();
    return (j.features || []).map(f => ({
      id: f.id, lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], depth: f.geometry.coordinates[2],
      mag: f.properties.mag, place: f.properties.place, time: f.properties.time
    }));
  };
  g.quakeEvents = function (list, loc, place) {
    if (!list || !list.length) return [];
    const q = list.reduce((a, b) => (b.mag > a.mag ? b : a));
    const d = Math.round(Math.hypot((q.lat - loc.lat) * 111, (q.lon - loc.lon) * 111 * Math.cos(loc.lat * Math.PI / 180)));
    return [{
      type: 'quake', level: q.mag >= 5 ? 3 : q.mag >= 4 ? 2 : 1, key: q.id, place: place,
      title: 'Sismo M' + Number(q.mag).toFixed(1),
      detail: (q.place || 'Región cercana') + ' · a ' + d + ' km de ' + (place || 'tu ubicación') + ' · prof. ' + Math.round(q.depth) + ' km.',
      lat: q.lat, lon: q.lon
    }];
  };

  // ---- Notificaciones ----
  g.evKey = e => (e.type === 'quake' ? 'quake' + e.key : e.type + (e.place ? '@' + e.place : ''));

  g.shouldNotify = function (map, e, cfg, now) {
    if (!cfg.notify[e.type]) return false;
    const k = g.evKey(e), p = map[k];
    if (p) {
      if (e.type === 'quake') return false;
      if (now - p.t < cfg.repeatMin * 60000 && e.level <= p.level) return false;
    }
    map[k] = { t: now, level: e.level };
    return true;
  };
  g.pruneNotified = function (map, events) {
    const present = new Set(events.map(g.evKey)), now = Date.now();
    Object.keys(map).forEach(k => {
      if (k.indexOf('quake') === 0) { if (now - map[k].t > 24 * 3600e3) delete map[k]; }
      else if (!present.has(k)) delete map[k];
    });
  };

  // Título + opciones de notificación (con acciones: llamar al 911 / qué hacer)
  g.notifOptions = function (e, cfg) {
    const t = g.TYPES[e.type];
    return {
      title: t.icon + ' ' + e.title + (e.place ? ' · ' + e.place : ''),
      opts: {
        body: e.detail + '\n👉 ' + g.TIPS[e.type],
        tag: g.evKey(e), renotify: true, icon: 'icon-192.png', badge: 'icon-192.png',
        vibrate: cfg.vibrate ? [300, 150, 300, 150, 400] : [],
        requireInteraction: e.level >= 2,
        actions: [{ action: 'call', title: '📞 Llamar 911' }, { action: 'open', title: 'Qué hacer' }],
        data: { type: e.type }
      }
    };
  };
})(typeof self !== 'undefined' ? self : this);
