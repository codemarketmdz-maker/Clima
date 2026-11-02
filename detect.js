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

  // ---- Clima con varias fuentes ----
  // 1) Open-Meteo directo (límite por dispositivo). 2) Si alcanza el límite o falla, el servidor propio
  // (/api/weather) prueba Open-Meteo, MET Norway y wttr.in, con caché compartida.
  // Devuelve un array [{current, hourly}] en formato Open-Meteo.
  const CUR_FULL = 'temperature_2m,relative_humidity_2m,precipitation,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,wind_gusts_10m,cape,lifted_index';
  const LSK = 'omBlockUntil';
  let omBlock = 0;
  try { omBlock = +(g.localStorage && g.localStorage.getItem(LSK)) || 0; } catch (e) {}
  function setBlock(ms) {
    omBlock = Date.now() + ms;
    try { g.localStorage && g.localStorage.setItem(LSK, String(omBlock)); } catch (e) {}
  }
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
  g.weatherSource = '';
  g.fetchWeather = async function (pts, opts) {
    opts = opts || {};
    const full = opts.full !== false, hourly = !!opts.hourly, ms = opts.timeout || 10000;
    let firstErr = null;
    if (Date.now() >= omBlock) {
      try {
        const u = 'https://api.open-meteo.com/v1/forecast?latitude=' + pts.map(p => (+p[0]).toFixed(3)).join(',') +
          '&longitude=' + pts.map(p => (+p[1]).toFixed(3)).join(',') +
          '&current=' + (full ? CUR_FULL : 'weather_code,precipitation,cape,lifted_index') +
          (hourly ? '&hourly=weather_code,precipitation,wind_gusts_10m,cape,lifted_index&forecast_hours=6' : '') + '&timezone=auto&wind_speed_unit=kmh';
        const j = await getJ(u, ms);
        const arr = Array.isArray(j) ? j : [j];
        if (arr.every(d => d && d.current)) { g.weatherSource = 'Open-Meteo'; return arr; }
        throw new Error('respuesta sin datos');
      } catch (e) {
        firstErr = e;
        if (e.limit) {
          const m = e.message || '';
          const d = new Date(); d.setUTCHours(24, 0, 0, 0);
          setBlock(/minut/i.test(m) ? 60e3 : /hour/i.test(m) ? 3600e3 : d - Date.now());
        }
      }
    }
    // Respaldo: servidor con varios proveedores (coordenadas redondeadas para aprovechar la caché)
    const u2 = '/api/weather?lat=' + pts.map(p => (+p[0]).toFixed(2)).join(',') + '&lon=' + pts.map(p => (+p[1]).toFixed(2)).join(',') +
      '&full=' + (full ? 1 : 0) + '&hourly=' + (hourly ? 1 : 0) + (firstErr && !firstErr.limit ? '&skip=open-meteo' : '');
    try {
      const r = await getJ(u2, ms + 10000);
      g.weatherSource = ({ 'open-meteo': 'Open-Meteo', 'met-norway': 'MET Norway', wttr: 'wttr.in' })[r.source] || r.source;
      return r.data;
    } catch (e) {
      if (firstErr && !firstErr.limit && !e.limit) throw firstErr;
      throw e;
    }
  };

  // ---- Satélite: temperatura de topes de nube (observado, GOES-East) ----
  // Devuelve [{min, cold}] por punto, o null si no hay datos. Nunca lanza error.
  g.fetchCloudTops = async function (pts) {
    try {
      const u = '/api/cloudtops?lat=' + pts.map(p => (+p[0]).toFixed(2)).join(',') + '&lon=' + pts.map(p => (+p[1]).toFixed(2)).join(',');
      const r = await getJ(u, 12000);
      return Array.isArray(r && r.data) ? r.data : null;
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
