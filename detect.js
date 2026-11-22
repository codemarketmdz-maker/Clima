/* Lógica compartida de detección (la usan index.html y sw.js) */
(function (g) {
  'use strict';
  const ND = ['norte', 'noreste', 'este', 'sudeste', 'sur', 'sudoeste', 'oeste', 'noroeste'];

  g.TYPES = {
    wind:        { icon: '💨', label: 'Viento fuerte',   desc: 'Ráfagas por encima del umbral elegido' },
    zonda:       { icon: '🌬️', label: 'Viento Zonda',    desc: 'Viento seco y cálido del oeste' },
    stormWeak:   { icon: '🌦️', label: 'Tormenta débil',  desc: 'Lluvia o chaparrones leves' },
    stormStrong: { icon: '⛈️', label: 'Tormenta fuerte', desc: 'Lluvia intensa y actividad eléctrica' },
    stormApproach:{ icon: '🌩️', label: 'Tormenta en aproximación', desc: 'Célula observada que se desplaza hacia la ubicación' },
    hail:        { icon: '🧊', label: 'Tormenta severa / granizo', desc: 'Topes de nube muy fríos o tormenta muy inestable: posible granizo' },
    quake:       { icon: '🏛️', label: 'Sismo',           desc: 'Sismos cercanos' },
    frost:       { icon: '❄️', label: 'Riesgo de helada', desc: 'Temperatura medida o prevista en el umbral de helada elegido (3 °C por defecto)' }
  };
  /* Se acerca una tormenta con topes de nube igual o más fríos que esto (°C): se avisa como “posible granizo”. */
  g.HAIL_TOP_C = -58;
  /* ---- Rayos (GOES-19 GLM): archivo rayos.json {t:ms, flashes:[[lat,lon,epochSeg],...]} ---- */
  g.RAYOS_URL = (function () { try { return atob('aHR0cHM6Ly9yYXcuZ2l0aHVidXNlcmNvbnRlbnQuY29tL2NvZGVtYXJrZXRtZHotbWFrZXIvdGllbXBvbWR6LXJheW9zL2RhdGEvcmF5b3MuanNvbg=='); } catch (e) { return ''; } })();
  g.lightningSummary = function (feed, lat, lon, nowMs, radiusKm) {
    const R = radiusKm || 100, now = (nowMs || Date.now()) / 1000, rad = Math.PI / 180;
    let n10 = 0, nPrev = 0, near = null;
    ((feed && feed.flashes) || []).forEach(f => {
      const dy = (f[0] - lat) * 111.2, dx = (f[1] - lon) * 111.2 * Math.cos(lat * rad), d = Math.hypot(dx, dy), m = (now - f[2]) / 60;
      if (d > R || m < 0) return;
      if (m <= 10) { n10++; if (!near || d < near.d) near = { d: d, brg: (Math.atan2(dx, dy) / rad + 360) % 360 }; }
      else if (m <= 20) nPrev++;
    });
    const trend = n10 === 0 ? '' : n10 >= nPrev * 1.5 + 3 ? 'en aumento' : nPrev >= n10 * 1.5 + 3 ? 'en baja' : 'estable';
    return { n10: n10, nPrev: nPrev, nearKm: near ? Math.round(near.d) : null, nearDir: near ? ND[Math.round(near.brg / 45) % 8] : null, trend: trend };
  };

  /* ---- Rayos como confirmación extra del aviso de granizo ---- */
  g.RAYOS_BBOX = [-36.0, -29.5, -72.5, -65.0]; // [latMin, latMax, lonMin, lonMax] que cubre rayos.json
  let rayCache = { at: 0, data: null };
  /* ---- Nombre del lugar según coordenadas (Godoy Cruz, Rosario…) ---- */
  g.geoName = async function (lat, lon, onlyCache) {
    lat = +lat; lon = +lon;
    if (!isFinite(lat) || !isFinite(lon)) return null;
    const k = lat.toFixed(2) + ',' + lon.toFixed(2);
    let cache = {};
    try { cache = JSON.parse(localStorage.getItem('geoCache') || '{}') || {}; } catch (e) { }
    if (cache[k]) return cache[k];
    if (onlyCache) return null;
    const clean = n => String(n || '').replace(/^(Departamento|Partido|Municipio|Ciudad|Comuna) de /i, '').trim();
    const get = async u => { const ac = new AbortController(), t = setTimeout(() => ac.abort(), 6000); try { const r = await fetch(u, { signal: ac.signal }); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); } finally { clearTimeout(t); } };
    let name = '';
    try {
      const j = await get('https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=12&accept-language=es&lat=' + lat.toFixed(4) + '&lon=' + lon.toFixed(4)), a = (j && j.address) || {};
      name = clean(a.city || a.town || a.village || a.municipality || a.suburb || a.city_district || a.county || a.state_district);
    } catch (e) { }
    if (!name) {
      try {
        const j = await get('https://api.bigdatacloud.net/data/reverse-geocode-client?localityLanguage=es&latitude=' + lat.toFixed(4) + '&longitude=' + lon.toFixed(4));
        name = clean(j && (j.city || j.locality));
      } catch (e) { }
    }
    if (!name) return null;
    try { const ks = Object.keys(cache); if (ks.length > 80) delete cache[ks[0]]; cache[k] = name; localStorage.setItem('geoCache', JSON.stringify(cache)); } catch (e) { }
    return name;
  };
  /* ---- Resumen del clima actual para la notificación fija (lo usan la app abierta y la vigilancia de fondo) ---- */
  g.buildWx = async function (c0, l0, events) {
    if (!c0 || !l0) return null;
    const code = Number(c0.weather_code), cloud = Math.round(Number(c0.cloud_cover)), hr = new Date().getHours();
    const day = c0.is_day != null ? Number(c0.is_day) === 1 : (hr >= 7 && hr < 20);
    let icon = '🌡', sky = '';
    if (code === 0) { icon = day ? '☀️' : '🌙'; sky = day ? 'Soleado' : 'Despejado'; }
    else if (code === 1 || code === 2) { icon = day ? '⛅' : '☁️'; sky = code === 1 ? 'Poco nublado' : 'Parcialmente nublado'; }
    else if (code === 3) { icon = '☁️'; sky = 'Nublado'; }
    else if (code === 45 || code === 48) { icon = '🌫'; sky = 'Niebla'; }
    else if (code >= 51 && code <= 57) { icon = '🌦'; sky = 'Llovizna'; }
    else if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) { icon = '🌧'; sky = code >= 80 ? 'Chubascos' : 'Lluvia'; }
    else if ((code >= 71 && code <= 77) || code === 85 || code === 86) { icon = '🌨'; sky = 'Nieve'; }
    else if (code >= 95) { icon = '⛈'; sky = code >= 96 ? 'Tormenta con granizo' : 'Tormenta'; }
    else if (Number.isFinite(cloud)) { icon = cloud < 25 ? (day ? '☀️' : '🌙') : cloud < 70 ? '⛅' : '☁️'; sky = cloud < 25 ? 'Despejado' : cloud < 70 ? 'Parcialmente nublado' : 'Nublado'; }
    let bolts = -1, nearKm = null;
    try {
      const feed = await g.fetchRayos(), b = g.RAYOS_BBOX;
      if (feed && feed.t && (Date.now() - feed.t) / 60000 <= 25 && l0.lat >= b[0] && l0.lat <= b[1] && l0.lon >= b[2] && l0.lon <= b[3]) {
        const ls = g.lightningSummary(feed, l0.lat, l0.lon, Date.now(), 50); bolts = ls.n10; nearKm = ls.nearKm;
      }
    } catch (e) { }
    const level = (events || []).reduce((m, e) => Math.max(m, Math.ceil(e.level || 0)), 0);
    return { place: l0.name, icon: icon, sky: sky, t: Math.round(Number(c0.temperature_2m)), cloud: Number.isFinite(cloud) ? cloud : -1,
      wind: Math.round(Number(c0.wind_speed_10m)), gust: Math.round(Number(c0.wind_gusts_10m)), rain: Number(c0.precipitation) || 0,
      hum: Math.round(Number(c0.relative_humidity_2m)), bolts: bolts, nearKm: nearKm, level: level,
      levelTxt: level >= 3 ? 'Alerta máxima' : level === 2 ? 'Alerta' : level === 1 ? 'Atención' : 'Sin alertas' };
  };
  g.fetchRayos = async function (maxAgeMs) {
    if (!g.RAYOS_URL) return null;
    if (rayCache.data && Date.now() - rayCache.at < (maxAgeMs || 90000)) return rayCache.data;
    try {
      const ac = typeof AbortController === 'function' ? new AbortController() : null, tm = ac && setTimeout(() => ac.abort(), 8000);
      const r = await fetch(g.RAYOS_URL + '?t=' + Date.now(), { cache: 'no-store', signal: ac ? ac.signal : undefined });
      if (tm) clearTimeout(tm);
      if (!r.ok) return null;
      rayCache = { at: Date.now(), data: await r.json() };
      return rayCache.data;
    } catch (e) { return null; }
  };
  // Devuelve null si no hay datos frescos o la tormenta está fuera de la zona cubierta (no se afirma nada).
  g.rayosNote = function (feed, cellLat, cellLon, nowMs) {
    const now = nowMs || Date.now(), b = g.RAYOS_BBOX;
    if (!feed || !feed.t || cellLat == null || cellLon == null) return null;
    if ((now - feed.t) / 60000 > 25) return null;
    if (cellLat < b[0] || cellLat > b[1] || cellLon < b[2] || cellLon > b[3]) return null;
    const s = g.lightningSummary(feed, cellLat, cellLon, now, 40);
    if (s.n10 >= 5) return { confirmed: true, n: s.n10, text: ' Confirmada con rayos: ' + s.n10 + ' descargas eléctricas en los últimos 10 minutos dentro de la tormenta' + (s.trend ? ' (' + s.trend + ')' : '') + '.', say: ' Hay actividad eléctrica.' };
    if (s.n10 === 0) return { confirmed: false, n: 0, text: ' Todavía no se detectan rayos en esa tormenta.', say: '' };
    return { confirmed: false, n: s.n10, text: ' Poca actividad eléctrica por ahora (' + s.n10 + ' descargas en 10 minutos).', say: '' };
  };
  g.rayosFor = async function (cellLat, cellLon) { try { return g.rayosNote(await g.fetchRayos(), cellLat, cellLon, Date.now()); } catch (e) { return null; } };

  g.hailTop = function (cloudMin) { return cloudMin != null && Number(cloudMin) <= g.HAIL_TOP_C; };
  g.RANK = { hail: 3, stormApproach: 2.1, stormStrong: 2, stormWeak: 1 };

  // Qué hacer (se muestra en la tarjeta y en la notificación)
  g.TIPS = {
    wind: 'Asegurá objetos sueltos, alejate de árboles, carteles y cables. Evitá rutas expuestas con vehículos altos.',
    zonda: 'Cerrá puertas y ventanas, no hagas fuego, alejate de árboles y cables. Cuidá a personas con problemas respiratorios.',
    stormWeak: 'Reducí la velocidad y encendé luces. No cruces calles anegadas ni zanjones.',
    stormStrong: 'Buscá refugio firme, alejate de ventanas, árboles y cables. No cruces zanjones ni calles anegadas.',
    stormApproach: 'Prepará resguardo, asegurá objetos y seguí los avisos oficiales. La trayectoria estimada puede cambiar.',
    hail: 'Poné el vehículo bajo techo o refugiate en un lugar cerrado. No te pares bajo árboles. Alejate de ventanas.',
    quake: 'Agachate, cubrite y agarrate junto a un mueble firme. Alejate de ventanas. No uses ascensores.',
    frost: 'Protegé cultivos sensibles y revisá riego antihelada, ventilación y sectores bajos de la finca. La temperatura pronosticada es orientativa; verificá con un sensor local.'
  };

  g.DEFAULT_CFG = {
    notify: { wind: true, zonda: true, stormWeak: false, stormStrong: true, stormApproach: true, hail: true, quake: true, frost: true },
    escape: true,
    windKmh: 60, quakeMag: 4, quakeKm: 300, repeatMin: 60, sound: true, vibrate: true, alertLeadMin: 60, frostC: 3, stnCross: true, stnKm: 30, radarOn: true, radarDbz: 52, radarKm: 25
  };
  g.mergeCfg = function (s) {
    s = s || {};
    const d = g.DEFAULT_CFG;
    const out = Object.assign({}, d, s, { notify: Object.assign({}, d.notify, s.notify || {}) });
    delete out.notify.smn;
    return out;
  };

  // ---- Tipos de licencia: Básica / Pro ----
  // El plan lo fija la app nativa (g.CM_TIER = 'basic' | 'pro'). Sin dato: dentro de Android se asume Básica
  // y en un navegador (pruebas) Pro. Los límites se pueden ajustar en config.js (CM_CFG.limits).
  g.TIER_LIMITS = {
    basic: { fincas: 2, forecastDays: 5, frost: false, hail: false, approach: false },
    pro: { fincas: 20, forecastDays: 14, frost: true, hail: true, approach: true }
  };
  g.cmTier = function () { return g.CM_TIER === 'pro' || g.CM_TIER === 'basic' ? g.CM_TIER : (g.AndroidBridge ? 'basic' : 'pro'); };
  g.cmLimits = function () {
    const t = g.cmTier(), o = (g.CM_CFG && g.CM_CFG.limits && g.CM_CFG.limits[t]) || {};
    return Object.assign({}, g.TIER_LIMITS[t], o);
  };
  g.cmCan = f => !!g.cmLimits()[f];
  // Aplica el plan a una lista de eventos. Los avisos OFICIALES del SMN (traen "source") se muestran siempre.
  g.applyTier = function (events) {
    const L = g.cmLimits(), seen = {}, out = [];
    (events || []).forEach(e => {
      if (!e) return;
      let ev = e;
      if (!e.source) {
        if (e.type === 'frost' && !L.frost) return;
        if (e.type === 'stormApproach' && !L.approach) return;
        if (e.type === 'hail' && !L.hail) ev = Object.assign({}, e, { type: 'stormStrong', level: Math.min(e.level, 2), title: g.TYPES.stormStrong.label, detail: String(e.detail || '').replace(/^Tormenta fuerte con posible granizo/, 'Tormenta fuerte con lluvia intensa y rayos') });
      }
      const k = g.evKey ? g.evKey(ev) : ev.type + '@' + ev.place;
      if (seen[k] != null) { if (ev.level > out[seen[k]].level) out[seen[k]] = ev; return; }
      seen[k] = out.length; out.push(ev);
    });
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

  // Lenguaje simple para la gente: "60 km/h" -> "60 kilómetros por hora", "-3 °C" -> "menos 3 grados".
  // "11:00 p. m." / "23:00" -> "las 11 de la noche" (la voz no distingue mañana/noche con "pm" o 24 h)
  g.spokenTime = function (h24, min, pre) {
    h24 = ((h24 % 24) + 24) % 24; min = String(min || '00');
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    const per = h24 === 12 ? 'del mediodía' : h24 === 0 ? 'de la noche' : h24 < 6 ? 'de la madrugada' : h24 < 12 ? 'de la mañana' : h24 < 20 ? 'de la tarde' : 'de la noche';
    const art = pre ? (h12 === 1 ? 'la ' : 'las ') : '';
    return art + h12 + (min !== '00' ? ' y ' + String(+min) : '') + ' ' + per;
  };
  g.plain = function (t) {
    if (t == null) return '';
    const SP = '[\\s\\u00a0\\u202f]*';
    return String(t)
      .replace(new RegExp('(?:\\b(las|la)\\s+)?\\b(\\d{1,2})(?::(\\d{2}))?' + SP + '([ap])\\.?' + SP + 'm\\b\\.?', 'gi'), (m, pre, h, mi, ap) => { h = +h % 12; return g.spokenTime(/^p/i.test(ap) ? h + 12 : h, mi, !!pre); })
      .replace(/(?:\b(las|la)\s+)?\b([01]?\d|2[0-3]):([0-5]\d)\b(?!\s?\d)/g, (m, pre, h, mi) => g.spokenTime(+h, mi, !!pre))
      .replace(/(-|−)\s?(\d+(?:[.,]\d+)?)\s?°\s?C\b/g, (m, a, n) => 'menos ' + n + (Number(String(n).replace(',', '.')) === 1 ? ' grado' : ' grados'))
      .replace(/(\d+(?:[.,]\d+)?)\s?°\s?C\b/g, (m, n) => n + (Number(String(n).replace(',', '.')) === 1 ? ' grado' : ' grados'))
      .replace(/(\d+(?:[.,]\d+)?)\s?km\/h/gi, (m, n) => n + (Number(String(n).replace(',', '.')) === 1 ? ' kilómetro por hora' : ' kilómetros por hora'))
      .replace(/(\d+(?:[.,]\d+)?)\s?mm\/h/gi, '$1 milímetros por hora')
      .replace(/(\d+(?:[.,]\d+)?)\s?mm\b/g, '$1 milímetros')
      .replace(/(\d+)\s?km\b/g, (m, n) => n + (Number(n) === 1 ? ' kilómetro' : ' kilómetros'))
      .replace(/\bráf\./g, 'ráfagas')
      .replace(/\bprof\./g, 'profundidad')
      .replace(/\bMETAR\b/g, 'informe del aeropuerto')
      .replace(/\bGOES IR\b/g, 'satélite')
      .replace(/\bGOES\b/g, 'satélite')
      .replace(/\bSMN\b/g, 'Servicio Meteorológico')
      .replace(/\bINPRES\b/g, 'INPRES');
  };

  // Texto con los datos que respaldan la clasificación (en palabras simples)
  g.stormWhy = function (x) {
    x = x || {};
    const p = [];
    if (x.ctt != null && x.ctt <= -40) p.push('el satélite ve nubes de tormenta muy altas' + (x.ctt <= -65 ? ' y muy desarrolladas' : ''));
    if (x.cape >= 500) p.push('el aire está muy inestable');
    if (x.wind_speed_10m != null) p.push('viento del ' + g.bearingName(x.wind_direction_10m || 0) + ' a ' + Math.round(x.wind_speed_10m) + ' km/h' + (x.wind_gusts_10m != null ? ', con ráfagas de ' + Math.round(x.wind_gusts_10m) + ' km/h' : ''));
    return p.length ? ' (' + p.join('; ') + ')' : '';
  };


  const when = minutes => (minutes <= 0 ? 'ahora' : 'en ~' + minutes + ' min');

  // Eventos para un punto: c = current, h = hourly (próximas 6 h), place = nombre del lugar
  g.detectPoint = function (c, h, cfg, place) {
    const ev = [];
    h = h || {};
    const first = {};
    const consider = (k, hr) => { if (k && (first[k] === undefined || hr < first[k])) first[k] = hr; };
    consider(g.stormClass(c.weather_code, c.precipitation, c), 0);
    const lead = Math.max(30, Math.min(90, Number(cfg.alertLeadMin) || 60));
    const m15 = h.minutely_15 || {};
    if ((m15.weather_code || []).length) {
      (m15.weather_code || []).forEach((w, i) => {
        const minutes = (i + 1) * 15;
        if (minutes >= 30 && minutes <= lead) consider(g.stormClass(w, (m15.precipitation || [])[i] || 0,
          { cape: (m15.cape || [])[i] }), minutes);
      });
    } else {
      (h.weather_code || []).forEach((w, i) => {
        const minutes = i * 60;
        if (minutes >= 30 && minutes <= lead) consider(g.stormClass(w, (h.precipitation || [])[i] || 0,
          { cape: (h.cape || [])[i], lifted_index: (h.lifted_index || [])[i] }), minutes);
      });
    }
    // Riesgo de helada: temperatura actual o prevista dentro de la ventana elegida.
    const frostLimit = Number.isFinite(Number(cfg.frostC)) ? Number(cfg.frostC) : 3;
    let frostAt = c.temperature_2m != null && c.temperature_2m <= frostLimit ? 0 : null;
    const frostSeries = (m15.temperature_2m || []).length ? m15.temperature_2m : (h.temperature_2m || []);
    frostSeries.forEach((v, i) => {
      const minutes = (m15.temperature_2m && m15.temperature_2m.length) ? (i + 1) * 15 : i * 60;
      if (v != null && v <= frostLimit && minutes >= 30 && minutes <= lead && (frostAt === null || minutes < frostAt)) frostAt = minutes;
    });
    if (frostAt !== null) ev.push({ type: 'frost', level: frostAt === 0 ? 3 : 2, title: 'Riesgo de helada', place: place,
      detail: (frostAt === 0 ? 'Ahora hay ' : 'En unos ' + frostAt + ' minutos habrá ') + Math.round(frostAt === 0 ? c.temperature_2m : frostSeries[(m15.temperature_2m && m15.temperature_2m.length) ? Math.max(0, Math.round(frostAt / 15) - 1) : frostAt / 60]) + ' °C. Puede helar y dañar plantas y cultivos.' });

    const txt = { hail: 'Tormenta fuerte con posible granizo ', stormStrong: 'Tormenta fuerte con lluvia intensa y rayos ', stormWeak: 'Lluvia o tormenta débil ' };
    Object.keys(first).forEach(k => ev.push({
      type: k, level: g.RANK[k], title: g.TYPES[k].label, place: place,
      detail: txt[k] + when(first[k]) + (first[k] === 0 ? g.stormWhy(c) : '') + '.'
    }));

    let gust = c.wind_gusts_10m || 0;
    const gustSeries=(m15.wind_gusts_10m||[]).length?m15.wind_gusts_10m:(h.wind_gusts_10m||[]);
    gustSeries.forEach((v,i)=>{const minutes=(m15.wind_gusts_10m||[]).length?(i+1)*15:i*60;if(minutes<=lead&&v>gust)gust=v;});
    if (gust >= cfg.windKmh) {
      const level = gust >= cfg.windKmh + 40 ? 3 : gust >= cfg.windKmh + 20 ? 2 : 1;
      ev.push({ type: 'wind', level, title: 'Viento fuerte', place: place, detail: 'Se esperan ráfagas de hasta ' + Math.round(gust) + ' km/h. Asegurá objetos sueltos y tené cuidado en la calle y en ruta.' });
    }
    // Zonda nunca se infiere solo por viento del oeste, calor o baja humedad.
    // Se agrega únicamente cuando un aviso oficial del SMN cubre este punto.
    // Observaciones reales (METAR de aeropuertos + radar): van primero para que su texto gane si empatan con el modelo.
    let obsEv = [];
    try { if (typeof g.observedEvents === 'function') obsEv = g.observedEvents(c, h, cfg, place) || []; } catch (e) { obsEv = []; }
    return g.applyTier(obsEv.concat(ev));
  };

  // ---- Clima con varias fuentes (todas se piden directo desde el celular, sin servidor propio) ----
  // Orden: Open-Meteo -> MET Norway -> wttr.in -> (opcional) servidor propio si g.WEATHER_API está definido.
  // Si una alcanza su límite o falla, se pasa a la siguiente y se la deja "en pausa" un rato.
  // Devuelve un array [{current, hourly}] en formato Open-Meteo.
  const CUR_FULL = 'temperature_2m,relative_humidity_2m,precipitation,weather_code,is_day,cloud_cover,wind_speed_10m,wind_direction_10m,wind_gusts_10m,cape,lifted_index';
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
      '&current=' + (full ? CUR_FULL : 'weather_code,precipitation,cape,lifted_index,wind_speed_10m,wind_direction_10m') +
      (hourly ? '&hourly=temperature_2m,weather_code,precipitation,wind_gusts_10m,wind_speed_10m,wind_direction_10m,cape,lifted_index,wind_speed_700hPa,wind_direction_700hPa,wind_speed_500hPa,wind_direction_500hPa&forecast_hours=6&minutely_15=temperature_2m,weather_code,precipitation,wind_gusts_10m,cape&forecast_minutely_15=8' : '') + '&timezone=auto&wind_speed_unit=kmh';
    const j = await getJ(u, ms);
    return (Array.isArray(j) ? j : [j]).map(d => ({ current: d.current, hourly: d.hourly, minutely_15: d.minutely_15 }));
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
      hourly: { temperature_2m: hrs.map(h => h.temperature_2m), weather_code: hrs.map(h => h.weather_code), precipitation: hrs.map(h => h.precipitation), wind_gusts_10m: hrs.map(h => h.wind_gusts_10m) }
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
    const H = { temperature_2m: [], weather_code: [], precipitation: [], wind_gusts_10m: [] };
    for (let i = 0; i < 6; i++) {
      const t = nowLocal + i * 3600e3;
      const s = slots.filter(x => x.t <= t).pop() || slots[0];
      if (!s) break;
      H.temperature_2m.push(Number.isFinite(+s.h.tempC) ? +s.h.tempC : null);
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
  // ---- Decodificación de imágenes (satélite/radar) en un hilo aparte: la pantalla no se traba ----
  const yieldUI = () => new Promise(r => setTimeout(r, 0));
  const imgWorker = (function () {
    let w = null, bad = false, seq = 0; const pend = new Map();
    function failAll(msg) { bad = true; pend.forEach(p => p.resolve(null)); pend.clear(); }
    function make() {
      const src = 'self.onmessage=async e=>{const id=e.data.id;try{const b=await createImageBitmap(e.data.blob);const c=new OffscreenCanvas(b.width,b.height);const x=c.getContext("2d",{willReadFrequently:true});x.drawImage(b,0,0);const d=x.getImageData(0,0,b.width,b.height);self.postMessage({id:id,w:b.width,h:b.height,buf:d.data.buffer},[d.data.buffer])}catch(err){self.postMessage({id:id,err:String(err)})}}';
      w = new Worker(URL.createObjectURL(new Blob([src], { type: 'application/javascript' })));
      w.onmessage = e => { const m = e.data, p = pend.get(m.id); if (!p) return; pend.delete(m.id); p.resolve(m.err ? null : { data: new Uint8ClampedArray(m.buf), width: m.w, height: m.h }); };
      w.onerror = () => failAll();
    }
    return function (blob) {
      if (bad || typeof Worker !== 'function') return Promise.resolve(null);
      try { if (!w) make(); } catch (e) { bad = true; return Promise.resolve(null); }
      return new Promise(resolve => { const id = ++seq; pend.set(id, { resolve }); try { w.postMessage({ id, blob }); } catch (e) { pend.delete(id); bad = true; resolve(null); } });
    };
  })();
  async function decodeImage(blob) {
    const viaWorker = await imgWorker(blob);
    if (viaWorker) return viaWorker;
    if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') throw new Error('lectura de imagen no disponible');
    const bmp = await createImageBitmap(blob);
    const cv = new OffscreenCanvas(bmp.width, bmp.height), cx = cv.getContext('2d', { willReadFrequently: true });
    cx.drawImage(bmp, 0, 0);
    return { data: cx.getImageData(0, 0, bmp.width, bmp.height).data, width: bmp.width, height: bmp.height };
  }
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
        return (await decodeImage(await r.blob())).data;
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
        await yieldUI();
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

  // ---- Movimiento de nubosidad convectiva GOES IR (NASA GIBS, secuencia histórica) ----
  // Compara cinco imágenes IR subdiarias. Es seguimiento de rasgos nubosos, no el producto
  // oficial DMW NetCDF: se usa como segunda observación independiente del radar.
  const goesMotionCache = new Map(), goesMotionTileCache = new Map();
  const GOES_MOTION_Z = 6, GOES_MOTION_RADIUS_KM = 180, GOES_MOTION_STEP = 2;
  async function goesMotionTile(tx, ty, isoTime) {
    const key = tx + '/' + ty + '/' + isoTime;
    if (goesMotionTileCache.has(key)) return goesMotionTileCache.get(key);
    const promise = (async () => {
      const ac = new AbortController(), timer = setTimeout(() => ac.abort(), 10000);
      try {
        const url = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/' + CT_LAYER + '/default/' +
          encodeURIComponent(isoTime) + '/GoogleMapsCompatible_Level6/' + GOES_MOTION_Z + '/' + ty + '/' + tx + '.png';
        const r = await fetch(url, { signal: ac.signal, mode: 'cors', cache: 'force-cache' });
        if (!r.ok) throw new Error('GOES IR histórico HTTP ' + r.status);
        return await decodeImage(await r.blob());
      } finally { clearTimeout(timer); }
    })().catch(e => { goesMotionTileCache.delete(key); throw e; });
    goesMotionTileCache.set(key, promise);
    while (goesMotionTileCache.size > 72) goesMotionTileCache.delete(goesMotionTileCache.keys().next().value);
    return promise;
  }
  async function goesColdComponents(loc, isoTime, cmap) {
    const world = ctWorld(+loc.lat, +loc.lon), kmPx = 40075.017 * Math.cos(+loc.lat * Math.PI / 180) / (256 * Math.pow(2, GOES_MOTION_Z));
    const radius = Math.ceil(GOES_MOTION_RADIUS_KM / kmPx), half = Math.ceil(radius / GOES_MOTION_STEP);
    const tiles = new Map(), minTX = Math.floor((world[0] - radius) / 256), maxTX = Math.floor((world[0] + radius) / 256);
    const minTY = Math.floor((world[1] - radius) / 256), maxTY = Math.floor((world[1] + radius) / 256);
    const req = [];
    for (let ty = minTY; ty <= maxTY; ty++) for (let tx = minTX; tx <= maxTX; tx++) req.push([tx, ty]);
    const loaded = await Promise.all(req.map(async ([tx, ty]) => [tx + '/' + ty, await goesMotionTile(tx, ty, isoTime)]));
    loaded.forEach(([k, v]) => { if (v) tiles.set(k, v); });
    await yieldUI();
    const width = half * 2 + 1, n = width * width, mask = new Uint8Array(n), temps = new Float32Array(n);
    for (let gy = 0; gy < width; gy++) for (let gx = 0; gx < width; gx++) {
      const dx = (gx - half) * GOES_MOTION_STEP, dy = (gy - half) * GOES_MOTION_STEP;
      if (dx * dx + dy * dy > radius * radius) continue;
      const wx = Math.floor(world[0]) + dx, wy = Math.floor(world[1]) + dy;
      const tx = Math.floor(wx / 256), ty = Math.floor(wy / 256), tile = tiles.get(tx + '/' + ty);
      if (!tile || wx < 0 || wy < 0) continue;
      const px = ((wx % 256) + 256) % 256, py = ((wy % 256) + 256) % 256;
      if (px >= tile.width || py >= tile.height) continue;
      const o = (py * tile.width + px) * 4;
      if (tile.data[o + 3] < 128) continue;
      const temp = ctColorToC(cmap, tile.data[o], tile.data[o + 1], tile.data[o + 2]);
      if (temp == null) continue;
      const k = gy * width + gx; temps[k] = temp;
      // -50 °C: filtra nubosidad convectiva profunda y reduce el seguimiento de cirros cálidos.
      if (temp <= -50) mask[k] = 1;
    }
    const seen = new Uint8Array(n), queue = new Int32Array(n), comps = [];
    for (let seed = 0; seed < n; seed++) {
      if (!mask[seed] || seen[seed]) continue;
      let head = 0, tail = 0, count = 0, sx = 0, sy = 0, min = Infinity, sum = 0;
      queue[tail++] = seed; seen[seed] = 1;
      while (head < tail) {
        const k = queue[head++], x = k % width, y = (k / width) | 0, t = temps[k];
        count++; sx += x; sy += y; min = Math.min(min, t); sum += t;
        const nb = [x > 0 ? k - 1 : -1, x + 1 < width ? k + 1 : -1, y > 0 ? k - width : -1, y + 1 < width ? k + width : -1];
        for (const q of nb) if (q >= 0 && mask[q] && !seen[q]) { seen[q] = 1; queue[tail++] = q; }
      }
      if (count >= 4) {
        const px = (sx / count - half) * GOES_MOTION_STEP, py = (sy / count - half) * GOES_MOTION_STEP;
        comps.push({ x: px * kmPx, y: -py * kmPx, area: count, minC: Math.round(min * 10) / 10, meanC: Math.round(sum / count * 10) / 10 });
      }
    }
    return comps;
  }
  g.trackGoesCloudMotion = async function (loc, target) {
    try {
      if (!loc || !Number.isFinite(+loc.lat) || !Number.isFinite(+loc.lon)) return { available: false, reason: 'Ubicación no válida.' };
      const now = Date.now(), newest = Math.floor((now - 18 * 60000) / 600000) * 600000;
      const times = [4, 3, 2, 1, 0].map(i => newest - i * 600000);
      const cacheKey = (+loc.lat).toFixed(3) + ',' + (+loc.lon).toFixed(3) + ':' + times[4];
      const cached = goesMotionCache.get(cacheKey);
      if (cached && now - cached.at < 7 * 60000) return cached.value;
      const cmap = await ctColormap();
      const samples = await Promise.all(times.map(async t => {
        const iso = new Date(t).toISOString().replace(/\.000Z$/, 'Z');
        try { return { time: t / 1000, comps: await goesColdComponents(loc, iso, cmap) }; }
        catch (e) { return { time: t / 1000, comps: [], error: (e && e.message) || 'GOES sin datos' }; }
      }));
      const lastSample = samples[samples.length - 1];
      if (!lastSample || !lastSample.comps.length) return { available: false, reason: 'GOES IR histórico sin píxeles convectivos analizables en esta ubicación.' };
      const tx = target && Number.isFinite(+target.x) ? +target.x : 0, ty = target && Number.isFinite(+target.y) ? +target.y : 0;
      const candidates = lastSample.comps.slice().sort((a, b) => Math.hypot(a.x - tx, a.y - ty) - Math.hypot(b.x - tx, b.y - ty)).slice(0, 5), fits = [];
      for (const seed of candidates) {
        const reverse = [{ time: lastSample.time, x: seed.x, y: seed.y, area: seed.area, minC: seed.minC }];
        let next = seed, nextTime = lastSample.time;
        for (let i = samples.length - 2; i >= 0; i--) {
          const sample = samples[i]; if (!sample.comps.length) continue;
          const dt = Math.max(1, (nextTime - sample.time) / 60), maxJump = Math.min(160, 40 + dt * 0.20);
          let best = null, bestD = Infinity;
          for (const c of sample.comps) { const d = Math.hypot(c.x - next.x, c.y - next.y); if (d < bestD) { bestD = d; best = c; } }
          if (best && bestD <= maxJump) { reverse.push({ time: sample.time, x: best.x, y: best.y, area: best.area, minC: best.minC }); next = best; nextTime = sample.time; }
        }
        const points = reverse.reverse(), fit = fitRadarTrack(points);
        if (fit) { fit.cloudTopMinC = Math.min(...points.map(p => p.minC)); fits.push(fit); }
      }
      if (!fits.length) return { available: false, detected: true, reason: 'GOES detecta topes fríos, pero no hay suficientes imágenes coherentes para medir su desplazamiento.' };
      fits.sort((a, b) => { const da = target ? Math.hypot(a.latestX - tx, a.latestY - ty) : a.distanceKm; const db = target ? Math.hypot(b.latestX - tx, b.latestY - ty) : b.distanceKm; return da - db || (a.approaching === b.approaching ? 0 : a.approaching ? -1 : 1); });
      const fit = fits[0]; fit.available = true; fit.detected = true; fit.source = 'GOES IR NASA GIBS';
      fit.cellLat = +loc.lat + fit.latestY / 111.32;
      fit.cellLon = +loc.lon + fit.latestX / (111.32 * Math.cos(+loc.lat * Math.PI / 180));
      fit.sampleCount = fit.points.length; fit.windowMin = fit.observedMin;
      goesMotionCache.set(cacheKey, { at: now, value: fit });
      while (goesMotionCache.size > 30) goesMotionCache.delete(goesMotionCache.keys().next().value);
      return fit;
    } catch (e) { return { available: false, reason: 'No se pudo analizar la secuencia GOES: ' + ((e && e.message) || 'error') }; }
  };
  // Timeline público de RainViewer (solo imágenes pasadas; no se usa como nowcast).
  // La lista de imágenes de radar se pide una sola vez por minuto (varias partes de la app la usan)
  let tlCache = null;
  g.fetchRadarTimeline = function () {
    if (tlCache && Date.now() - tlCache.at < 60e3) return tlCache.p;
    const p = (async () => {
      const j = await getJ('https://api.rainviewer.com/public/weather-maps.json', 10000);
      const past = j && j.radar && j.radar.past;
      if (!Array.isArray(past) || past.length < 4) throw new Error('RainViewer no entregó cuatro imágenes históricas utilizables.');
      return { host: j.host || 'https://tilecache.rainviewer.com', frames: past.slice(-5) };
    })();
    tlCache = { at: Date.now(), p };
    p.catch(() => { if (tlCache && tlCache.p === p) tlCache = null; });
    return p;
  };
  g.__resetTimeline = () => { tlCache = null; };
  // Exportación pequeña para pruebas automatizadas de ajuste de trayectoria.
  g.fitObservedMotion = fitRadarTrack;

  // ---- Seguimiento de células convectivas por radar (RainViewer) ----
  // Mide el movimiento observado entre imágenes pasadas. No usa el viento de superficie
  // como velocidad de la tormenta. Requiere imágenes consecutivas y cobertura de radar.
  const RADAR_Z = 7, RADAR_SIZE = 512, RADAR_GRID = 128, RADAR_STEP = 4;
  const radarTileCache = new Map(), radarTrackCache = new Map();
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const mercatorPx = (lat, lon, z) => {
    const n = 256 * Math.pow(2, z), s = clamp(Math.sin(lat * Math.PI / 180), -0.9999, 0.9999);
    return { x: (lon + 180) / 360 * n, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n };
  };
  const radarPixelKm = lat => 40075.017 * Math.cos(lat * Math.PI / 180) / (256 * Math.pow(2, RADAR_Z));
  async function radarBitmap(url) {
    if (radarTileCache.has(url)) return radarTileCache.get(url);
    const promise = (async () => {
      const ac = new AbortController(), timer = setTimeout(() => ac.abort(), 9000);
      try {
        const r = await fetch(url, { signal: ac.signal, mode: 'cors', cache: 'force-cache' });
        if (!r.ok) throw new Error('radar HTTP ' + r.status);
        const blob = await r.blob();
        return await decodeImage(blob);
      } finally { clearTimeout(timer); }
    })().catch(e => { radarTileCache.delete(url); throw e; });
    radarTileCache.set(url, promise);
    while (radarTileCache.size > 90) radarTileCache.delete(radarTileCache.keys().next().value);
    return promise;
  }
  g.radarBitmap = radarBitmap;
  function radarEchoComponents(image, lat) {
    const w = image.width, h = image.height, data = image.data, n = RADAR_GRID * RADAR_GRID;
    const mask = new Uint8Array(n), weights = new Float32Array(n), step = RADAR_STEP;
    const center = RADAR_SIZE / 2, kmPx = radarPixelKm(lat), maxR = 185 / kmPx;
    for (let gy = 0; gy < RADAR_GRID; gy++) for (let gx = 0; gx < RADAR_GRID; gx++) {
      const px = gx * step + 2, py = gy * step + 2;
      const dx = px - center, dy = py - center;
      if (dx * dx + dy * dy > maxR * maxR) continue;
      const o = (py * w + px) * 4, r = data[o], gg = data[o + 1], b = data[o + 2], a = data[o + 3];
      if (a < 78) continue;
      const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), sat = mx ? (mx - mn) / mx : 0;
      const brightSnow = a > 235 && mn > 190;
      if (sat < 0.22 && !brightSnow) continue;
      const k = gy * RADAR_GRID + gx;
      mask[k] = 1; weights[k] = Math.max(0.2, a / 255) * (brightSnow ? 1.3 : 1);
    }
    const seen = new Uint8Array(n), queue = new Int32Array(n), comps = [];
    for (let seed = 0; seed < n; seed++) {
      if (!mask[seed] || seen[seed]) continue;
      let head = 0, tail = 0, count = 0, sx = 0, sy = 0, sw = 0;
      queue[tail++] = seed; seen[seed] = 1;
      while (head < tail) {
        const k = queue[head++], x = k % RADAR_GRID, y = (k / RADAR_GRID) | 0, wt = weights[k];
        count++; sx += (x * step + 2) * wt; sy += (y * step + 2) * wt; sw += wt;
        const nb = [x > 0 ? k - 1 : -1, x + 1 < RADAR_GRID ? k + 1 : -1, y > 0 ? k - RADAR_GRID : -1, y + 1 < RADAR_GRID ? k + RADAR_GRID : -1];
        for (const q of nb) if (q >= 0 && mask[q] && !seen[q]) { seen[q] = 1; queue[tail++] = q; }
      }
      if (count >= 3 && sw > 0) {
        const px = sx / sw, py = sy / sw;
        comps.push({ x: (px - center) * kmPx, y: (center - py) * kmPx, area: count, weight: sw });
      }
    }
    return comps;
  }
  function fitRadarTrack(points) {
    if (points.length < 4) return null;
    const t0 = points[0].time / 60, ts = points.map(p => p.time / 60 - t0), xs = points.map(p => p.x), ys = points.map(p => p.y);
    if (ts[ts.length - 1] - ts[0] < 25) return null;
    const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
    const mt = mean(ts), mx = mean(xs), my = mean(ys);
    let den = 0, vxN = 0, vyN = 0;
    for (let i = 0; i < ts.length; i++) { const d = ts[i] - mt; den += d * d; vxN += d * (xs[i] - mx); vyN += d * (ys[i] - my); }
    if (!den) return null;
    const vx = vxN / den * 60, vy = vyN / den * 60; // km/h, x east, y north
    const speed = Math.hypot(vx, vy);
    const predX = ts.map(t => mx + vx / 60 * (t - mt)), predY = ts.map(t => my + vy / 60 * (t - mt));
    const ss = points.reduce((s, p, i) => s + (p.x - mx) ** 2 + (p.y - my) ** 2, 0);
    const err = points.reduce((s, p, i) => s + (p.x - predX[i]) ** 2 + (p.y - predY[i]) ** 2, 0);
    const r2 = ss > 0 ? clamp(1 - err / ss, 0, 1) : 0;
    const latest = points[points.length - 1], d2 = vx * vx + vy * vy;
    if (speed < 6 || speed > 130 || d2 < 1) return null;
    const closestH = -(latest.x * vx + latest.y * vy) / d2;
    const missKm = Math.hypot(latest.x + vx * closestH, latest.y + vy * closestH);
    const distanceKm = Math.hypot(latest.x, latest.y);
    const toward = latest.x * vx + latest.y * vy < 0;
    const etaMin = toward && closestH >= 0 ? Math.round(closestH * 60) : null;
    const bearing = (Math.atan2(vx, vy) * 180 / Math.PI + 360) % 360;
    const confidence = points.length >= 5 && r2 >= 0.62 ? 'alta' : points.length >= 4 && r2 >= 0.48 ? 'media' : 'baja';
    return { points, speedKmh: Math.round(speed), bearing: Math.round(bearing), distanceKm: Math.round(distanceKm),
      missKm: Math.round(missKm), etaMin, toward, approaching: toward && closestH >= 0 && missKm <= 25 && etaMin != null,
      r2: Math.round(r2 * 100) / 100, confidence, observedMin: Math.round(ts[ts.length - 1] - ts[0]),
      latestX: latest.x, latestY: latest.y, latestTime: latest.time };
  }
  g.trackRadarMotion = async function (loc, frames, host) {
    try {
      if (!loc || !Number.isFinite(+loc.lat) || !Number.isFinite(+loc.lon)) return null;
      const usable = (frames || []).filter(f => f && f.path && Number.isFinite(+f.time)).slice(-5);
      if (usable.length < 4) return { available: false, reason: 'No hay suficientes imágenes históricas de radar.' };
      const cacheKey = loc.lat.toFixed(3) + ',' + loc.lon.toFixed(3) + ':' + usable[usable.length - 1].time;
      const cached = radarTrackCache.get(cacheKey);
      if (cached && Date.now() - cached.at < 4 * 60000) return cached.value;
      const samples = await Promise.all(usable.map(async f => {
        const url = (host || 'https://tilecache.rainviewer.com').replace(/\/$/, '') + f.path + '/' + RADAR_SIZE + '/' + RADAR_Z + '/' + (+loc.lat).toFixed(4) + '/' + (+loc.lon).toFixed(4) + '/2/1_1.png';
        try {
          const image = await radarBitmap(url); await yieldUI(); const comps = radarEchoComponents(image, +loc.lat);
          return { time: +f.time, comps };
        } catch (e) { return { time: +f.time, comps: [], error: (e && e.message) || 'error' }; }
      }));
      const lastSample = samples[samples.length - 1];
      if (!lastSample || !lastSample.comps.length) return { available: false, reason: 'El radar no muestra ecos analizables cerca de este punto o no hay cobertura. Esto no confirma ausencia de tormenta.' };
      const candidates = lastSample.comps.slice().sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y)).slice(0, 5);
      const fits = [];
      for (const seed of candidates) {
        const reverse = [{ time: lastSample.time, x: seed.x, y: seed.y, area: seed.area }];
        let next = seed, nextTime = lastSample.time;
        for (let i = samples.length - 2; i >= 0; i--) {
          const s = samples[i]; if (!s.comps.length) continue;
          const dtMin = Math.max(1, (nextTime - s.time) / 60), maxJump = Math.min(140, 35 + dtMin * 0.16);
          let best = null, bd = Infinity;
          for (const c of s.comps) { const d = Math.hypot(c.x - next.x, c.y - next.y); if (d < bd) { bd = d; best = c; } }
          if (best && bd <= maxJump) { reverse.push({ time: s.time, x: best.x, y: best.y, area: best.area }); next = best; nextTime = s.time; }
        }
        const points = reverse.reverse(), fit = fitRadarTrack(points);
        if (fit) fits.push(fit);
      }
      if (!fits.length) return { available: true, detected: true, reason: 'Hay ecos de precipitación, pero todavía no hay suficientes imágenes coherentes para calcular una trayectoria confiable.', latest: candidates[0] || null };
      fits.sort((a, b) => {
        if (a.approaching !== b.approaching) return a.approaching ? -1 : 1;
        if (a.approaching && b.approaching) return (a.missKm - b.missKm) || ((a.etaMin || 9999) - (b.etaMin || 9999));
        return a.distanceKm - b.distanceKm;
      });
      const fit = fits[0];
      fit.available = true; fit.detected = true;
      fit.cellLat = +loc.lat + fit.latestY / 111.32;
      fit.cellLon = +loc.lon + fit.latestX / (111.32 * Math.cos(+loc.lat * Math.PI / 180));
      fit.source = 'RainViewer'; fit.sampleCount = fit.points.length;
      const value = fit;
      radarTrackCache.set(cacheKey, { at: Date.now(), value });
      while (radarTrackCache.size > 40) radarTrackCache.delete(radarTrackCache.keys().next().value);
      return value;
    } catch (e) { return { available: false, reason: 'No se pudo analizar el radar: ' + ((e && e.message) || 'error') }; }
  };

  // ---- Alertas oficiales SMN (CAP): la geometría del aviso debe cubrir el punto ----
  // Se usa el feed público CAP del SMN. Si la fuente no responde o no se puede verificar
  // el polígono, no se inventa una alerta ni se etiqueta viento fuerte como Zonda.
  const CAP_FEED = 'https://ssl.smn.gob.ar/CAP/AR.php';
  let capCache = { at: 0, items: [] }, capPromise = null;
  g.officialAlertsStatus = 'sin consultar';
  // Entidades HTML/XML más comunes (el feed del SMN a veces trae &#243; o &oacute; en vez de la letra con tilde).
  const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', ntilde: 'ñ', Ntilde: 'Ñ', uuml: 'ü', Uuml: 'Ü', iexcl: '¡', iquest: '¿', deg: '°', ordm: 'º', ordf: 'ª' };
  const decodeEnt = (t) => String(t).replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (m, d, h, n) => {
    if (d || h) { try { return String.fromCodePoint(d ? +d : parseInt(h, 16)); } catch (e) { return m; } }
    return Object.prototype.hasOwnProperty.call(ENT, n) ? ENT[n] : m;
  });
  // Texto "ÃƒÂ³" (UTF-8 leído como Latin-1) -> "ó"
  const fixMojibake = (t) => {
    if (!/[ÃÂ][\u0080-¿]/.test(t)) return t;
    try { return decodeURIComponent(escape(t)); } catch (e) { return t; }
  };
  // Localidades de referencia (capitales y ciudades grandes) para nombrar la zona de un aviso: [nombre, provincia, lat, lon]
  g.ARG_PLACES = [
    ['Buenos Aires', 'Buenos Aires', -34.60, -58.38], ['La Plata', 'Buenos Aires', -34.92, -57.95], ['Mar del Plata', 'Buenos Aires', -38.00, -57.55], ['Bahía Blanca', 'Buenos Aires', -38.72, -62.27],
    ['Tandil', 'Buenos Aires', -37.32, -59.13], ['Junín', 'Buenos Aires', -34.59, -60.95], ['Pergamino', 'Buenos Aires', -33.89, -60.57], ['Olavarría', 'Buenos Aires', -36.89, -60.32],
    ['Santa Rosa', 'La Pampa', -36.62, -64.29], ['General Pico', 'La Pampa', -35.66, -63.76], ['Neuquén', 'Neuquén', -38.95, -68.06], ['Zapala', 'Neuquén', -38.90, -70.06],
    ['Bariloche', 'Río Negro', -41.13, -71.31], ['Viedma', 'Río Negro', -40.81, -62.99], ['General Roca', 'Río Negro', -39.03, -67.58],
    ['Comodoro Rivadavia', 'Chubut', -45.86, -67.48], ['Trelew', 'Chubut', -43.25, -65.31], ['Esquel', 'Chubut', -42.91, -71.32],
    ['Río Gallegos', 'Santa Cruz', -51.62, -69.22], ['El Calafate', 'Santa Cruz', -50.34, -72.26], ['Ushuaia', 'Tierra del Fuego', -54.80, -68.30], ['Río Grande', 'Tierra del Fuego', -53.79, -67.70],
    ['Córdoba', 'Córdoba', -31.42, -64.18], ['Río Cuarto', 'Córdoba', -33.13, -64.35], ['Villa María', 'Córdoba', -32.41, -63.24],
    ['Rosario', 'Santa Fe', -32.95, -60.64], ['Santa Fe', 'Santa Fe', -31.63, -60.70], ['Rafaela', 'Santa Fe', -31.25, -61.49],
    ['Paraná', 'Entre Ríos', -31.73, -60.53], ['Concordia', 'Entre Ríos', -31.39, -58.02], ['Gualeguaychú', 'Entre Ríos', -33.01, -58.52],
    ['Corrientes', 'Corrientes', -27.47, -58.83], ['Posadas', 'Misiones', -27.37, -55.90], ['Resistencia', 'Chaco', -27.45, -58.99], ['Formosa', 'Formosa', -26.18, -58.17],
    ['Santiago del Estero', 'Santiago del Estero', -27.78, -64.26], ['San Miguel de Tucumán', 'Tucumán', -26.82, -65.22], ['Salta', 'Salta', -24.79, -65.41], ['San Salvador de Jujuy', 'Jujuy', -24.19, -65.30],
    ['Catamarca', 'Catamarca', -28.47, -65.78], ['La Rioja', 'La Rioja', -29.41, -66.86], ['San Juan', 'San Juan', -31.54, -68.52], ['San Luis', 'San Luis', -33.30, -66.34], ['Villa Mercedes', 'San Luis', -33.68, -65.46],
    ['Mendoza', 'Mendoza', -32.89, -68.84], ['San Rafael', 'Mendoza', -34.62, -68.33], ['Malargüe', 'Mendoza', -35.47, -69.58], ['Tunuyán', 'Mendoza', -33.57, -69.02], ['Uspallata', 'Mendoza', -32.59, -69.35],
    ['San Martín', 'Mendoza', -33.08, -68.47], ['General Alvear', 'Mendoza', -34.98, -67.70]
  ];
  g.nearPlace = function (lat, lon) {
    let best = null, bd = 1e9;
    g.ARG_PLACES.forEach(p => { const d = Math.hypot((p[2] - lat) * 111, (p[3] - lon) * 111 * Math.cos(lat * Math.PI / 180)); if (d < bd) { bd = d; best = p; } });
    return best ? { name: best[0], province: best[1], km: Math.round(bd) } : null;
  };
  const PROPER = ['Ciudad Autónoma de Buenos Aires', 'Buenos Aires', 'Catamarca', 'Chaco', 'Chubut', 'Córdoba', 'Corrientes', 'Entre Ríos', 'Formosa', 'Jujuy', 'La Pampa', 'La Rioja', 'Mendoza', 'Misiones', 'Neuquén', 'Río Negro', 'Salta', 'San Juan', 'San Luis', 'Santa Cruz', 'Santa Fe', 'Santiago del Estero', 'Tierra del Fuego', 'Tucumán', 'Patagonia', 'Cuyo', 'Argentina', 'Chile', 'Uruguay', 'Paraguay', 'Bolivia', 'Brasil']
    .concat(g.ARG_PLACES.map(p => p[0])).filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => b.length - a.length);
  const properCase = (t) => PROPER.reduce((x, n) => x.replace(new RegExp('(^|[^A-Za-zÁÉÍÓÚÑÜáéíóúñü])' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[áéíóúñü]/gi, c => ({ á: '[aá]', é: '[eé]', í: '[ií]', ó: '[oó]', ú: '[uú]', ñ: '[nñ]', ü: '[uü]' })[c.toLowerCase()]) + '(?![A-Za-zÁÉÍÓÚÑÜáéíóúñü])', 'gi'), (m, a) => a + n), t);
  // Limpia texto de un aviso: entidades, espacios y, si viene todo en MAYÚSCULAS, lo pasa a oración normal.
  g.cleanText = function (t) {
    let x = fixMojibake(decodeEnt(decodeEnt(String(t == null ? '' : t)))).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/\s+/g, ' ').trim();
    const letters = x.replace(/[^A-Za-zÁÉÍÓÚÑÜáéíóúñü]/g, '');
    if (letters.length > 12 && letters.replace(/[^A-ZÁÉÍÓÚÑÜ]/g, '').length / letters.length > 0.8) {
      x = properCase(x.toLowerCase().replace(/(^|[.!?]\s+)([a-záéíóúñü])/g, (m, a, b) => a + b.toUpperCase()));
    }
    return x;
  };
  const xmlText = (s) => g.cleanText(String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, ' '));
  function capTags(xml, name) {
    const re = new RegExp('<(?:[\\w.-]+:)?' + name + '(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?' + name + '\\s*>', 'gi');
    const out = []; let m; while ((m = re.exec(xml))) out.push(xmlText(m[1])); return out;
  }
  function pointInPoly(lat, lon, pts) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i], b = pts[j];
      if (((a[1] > lon) !== (b[1] > lon)) && (lat < (b[0] - a[0]) * (lon - a[1]) / ((b[1] - a[1]) || 1e-12) + a[0])) inside = !inside;
    }
    return inside;
  }
  function capCovers(xml, loc) {
    let checked = false;
    for (const raw of capTags(xml, 'polygon')) {
      const pts = raw.split(/\s+/).map(x => x.split(',').map(Number)).filter(x => x.length >= 2 && Number.isFinite(x[0]) && Number.isFinite(x[1]));
      if (pts.length >= 3) { checked = true; if (pointInPoly(loc.lat, loc.lon, pts)) return true; }
    }
    for (const raw of capTags(xml, 'circle')) {
      const m = raw.match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)/);
      if (m) {
        checked = true;
        const a = Number(m[1]), b = Number(m[2]), r = Number(m[3]);
        const dx = (loc.lon - b) * 111.32 * Math.cos(loc.lat * Math.PI / 180), dy = (loc.lat - a) * 111.32;
        if (Math.hypot(dx, dy) <= r) return true;
      }
    }
    return false; // sin polígono/círculo verificable: no se dispara
  }
  async function capFetch(url, timeoutMs) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs || 7000);
    try { return await fetch(url, { cache: 'no-store', signal: controller.signal }); }
    finally { clearTimeout(timer); }
  }
  async function loadCapItems() {
    if (Date.now() - capCache.at < 10 * 60000) return capCache.items;
    if (capPromise) return capPromise;
    capPromise = (async () => {
      const r = await capFetch(CAP_FEED, 7000);
      if (!r.ok) throw new Error('SMN CAP HTTP ' + r.status);
      const body = await r.text();
      const links = [];
      if (/<(?:[\w.-]+:)?alert[\s>]/i.test(body)) links.push({ url: CAP_FEED, title: 'Aviso SMN' });
      const re = /<a\b[^>]*href=["']([^"']+\.xml(?:\?[^"']*)?)["'][^>]*>([\s\S]*?)<\/a>/gi;
      let m;
      while ((m = re.exec(body)) && links.length < 100) {
        const href = m[1];
        if (!/(zonda|viento|torment|lluv|granizo|helad|nieve|nevad|calor|fr[ií]o|temperatur|niebla|polvo|inunda|tormenta|alerta|aviso)/i.test(href + ' ' + m[2])) continue;
        links.push({ url: new URL(href, CAP_FEED).href, title: xmlText(m[2]) || href });
      }
      // Algunos despliegues entregan el RSS XML en vez de HTML.
      if (!links.length) {
        const lr = /<link[^>]*>(https?:[^<]+\.xml[^<]*)<\/link>/gi;
        while ((m = lr.exec(body)) && links.length < 100) links.push({ url: xmlText(m[1]), title: '' });
      }
      const unique = [...new Map(links.map(x => [x.url, x])).values()].slice(0, 80);
      const settled = []; let cursor = 0;
      const workers = Array.from({ length: 8 }, async () => {
        while (cursor < unique.length) {
          const x = unique[cursor++];
          try {
            const q = await capFetch(x.url, 7000); if (!q.ok) throw new Error('CAP ' + q.status);
            const xml = await q.text();
            const event = capTags(xml, 'event')[0] || x.title || '';
            const headline = capTags(xml, 'headline')[0] || event;
            const desc = capTags(xml, 'description')[0] || '';
            const area = capTags(xml, 'areaDesc').join(' · ');
            const expires = Date.parse(capTags(xml, 'expires')[0] || '');
            if (expires && expires < Date.now()) continue;
            if (!capTags(xml, 'polygon').length && !capTags(xml, 'circle').length) continue;
            settled.push({ xml, event, headline, desc, area, expires, url: x.url, severity: capTags(xml, 'severity')[0] || '',
              instruction: capTags(xml, 'instruction')[0] || '', onset: Date.parse(capTags(xml, 'onset')[0] || capTags(xml, 'effective')[0] || '') || null });
          } catch (e) { /* Un CAP individual no invalida los demás avisos. */ }
        }
      });
      await Promise.all(workers);
      const items = settled;
      capCache = { at: Date.now(), items };
      g.officialAlertsStatus = 'fuente SMN conectada';
      return items;
    })().finally(() => { capPromise = null; });
    return capPromise;
  }
  // Resumen nacional de avisos SMN vigentes (feed CAP con geometría validada).
  g.fetchOfficialAlertsNational = async function () {
    const items = await loadCapItems();
    return items.map(a => ({
      title: a.headline || a.event || 'Aviso meteorológico',
      event: a.event || '', area: a.area || 'Área indicada por SMN',
      description: a.desc || '', severity: a.severity || '',
      expires: a.expires || null, source: a.url
    }));
  };
  // Avisos SMN con su geometría (polígonos/círculos) para dibujarlos en el mapa y listarlos.
  g.fetchOfficialAlertGeometry = async function () {
    const items = await loadCapItems();
    return items.map(a => {
      const polys = [], circles = [];
      capTags(a.xml, 'polygon').forEach(raw => {
        const pts = raw.split(/\s+/).map(x => x.split(',').map(Number)).filter(x => x.length >= 2 && Number.isFinite(x[0]) && Number.isFinite(x[1]));
        if (pts.length >= 3) polys.push(pts);
      });
      capTags(a.xml, 'circle').forEach(raw => {
        const m = raw.match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)/);
        if (m) circles.push({ lat: Number(m[1]), lon: Number(m[2]), km: Number(m[3]) });
      });
      return {
        title: a.headline || a.event || 'Aviso meteorológico', event: a.event || '', area: a.area || '',
        severity: a.severity || '', desc: a.desc || '', instruction: a.instruction || '',
        onset: a.onset || null, expires: a.expires || null, url: a.url, polys, circles
      };
    });
  };
  g.fetchOfficialAlertsForPoint = async function (loc) {
    try {
      const items = await loadCapItems(), out = [];
      items.forEach(a => {
        if (!capCovers(a.xml, loc)) return;
        const label = (a.event + ' ' + a.headline + ' ' + a.desc).toLowerCase();
        let type = null;
        if (/zonda/.test(label)) type = 'zonda';
        else if (/helada|temperaturas? m[ií]nimas? extremas/.test(label)) type = 'frost';
        else if (/granizo|tormenta severa/.test(label)) type = 'hail';
        else if (/tormenta|lluvia intensa/.test(label)) type = 'stormStrong';
        else if (/viento/.test(label)) type = 'wind';
        if (!type) return;
        const sev = (a.severity || '').toLowerCase();
        const level = /extreme|severe/.test(sev) ? 3 : /moderate/.test(sev) ? 2 : 1;
        out.push({ type, level, title: a.headline || g.TYPES[type].label, place: loc.name,
          key: 'smn:' + a.url, detail: 'Aviso oficial del SMN para el área: ' + (a.area || 'área indicada en el aviso') + '. ' + (a.desc || '') + ' Fuente: SMN.', source: a.url });
      });
      return out;
    } catch (e) { g.officialAlertsStatus = 'fuente SMN no disponible'; return []; }
  };

  // ---- Sismos: INPRES (fuente oficial, vía la app) con respaldo en USGS ----
  const titleCase = t => String(t || '').toLowerCase().replace(/(^|\s)([a-záéíóúñ])/g, (m, a, c) => a + c.toUpperCase());
  // Lee la tabla "Últimos sismos" del INPRES: N°, Día (dd/mm), Hora (local), Latitud, Longitud, Mg., Prof., Lugar.
  g.parseInpres = function (html, nowMs) {
    const now = nowMs || Date.now(), out = [], seen = new Set();
    const text = s => String(s).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&aacute;/g, 'á').replace(/&eacute;/g, 'é').replace(/&iacute;/g, 'í').replace(/&oacute;/g, 'ó').replace(/&uacute;/g, 'ú').replace(/&ntilde;/gi, 'ñ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
    const add = (dm, hm, lat, lon, mag, prof, lugar) => {
      const d = /^(\d{1,2})\/(\d{1,2})$/.exec(dm), h = /^(\d{1,2}):(\d{2})/.exec(hm);
      if (!d || !h) return;
      const la = parseFloat(lat), lo = parseFloat(lon), mg = parseFloat(String(mag).replace(',', '.')), pr = parseFloat(String(prof).replace(',', '.'));
      if (!Number.isFinite(la) || !Number.isFinite(lo) || !Number.isFinite(mg)) return;
      // La hora del INPRES es la local de Argentina (UTC-3, sin horario de verano)
      let y = new Date(now - 3 * 3600e3).getUTCFullYear();
      let t = Date.UTC(y, +d[2] - 1, +d[1], +h[1] + 3, +h[2]);
      if (t > now + 36 * 3600e3) t = Date.UTC(y - 1, +d[2] - 1, +d[1], +h[1] + 3, +h[2]);
      const id = 'inpres-' + dm + '-' + hm + '-' + la.toFixed(2) + '-' + lo.toFixed(2);
      if (seen.has(id)) return; seen.add(id);
      out.push({ id, lat: la, lon: lo, depth: Number.isFinite(pr) ? pr : 0, mag: mg, place: titleCase(lugar), time: t, source: 'INPRES' });
    };
    // 1) filas de tabla con 8 celdas
    const rows = String(html).match(/<tr[\s\S]*?<\/tr>/gi) || [];
    rows.forEach(r => {
      const cells = (r.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) || []).map(text);
      if (cells.length >= 8) add(cells[1], cells[2], cells[3], cells[4], cells[5], cells[6], cells[7]);
    });
    // 2) respaldo: texto corrido, una fila por sismo
    if (!out.length) {
      const flat = text(html), re = /(\d{1,2}\/\d{1,2})\s+(\d{1,2}:\d{2})\s+(-?\d+(?:[.,]\d+)?)\s+(-?\d+(?:[.,]\d+)?)\s+(\d(?:[.,]\d)?)\s+(\d+)\s*Km\s+([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ ]+?)(?=\s+\d{1,2}\s+\d{1,2}\/|\s*$)/gi;
      let m; while ((m = re.exec(flat))) add(m[1], m[2], m[3], m[4], m[5], m[6], m[7]);
    }
    // 3) respaldo: la tabla viene "por columnas" (cada columna son varias líneas: primero los N° 1..N, después las N fechas, etc.)
    if (!out.length) {
      const lines = String(html).replace(/<\s*(br|\/td|\/tr|\/div|\/p|\/li)[^>]*>/gi, '\n').split(/\n/).map(text).filter(Boolean);
      const hi = lines.findIndex(l => /^lugar$/i.test(l) || /\bprof\.?\s+lugar\b/i.test(l));
      const toks = hi >= 0 ? lines.slice(hi + 1) : lines;
      let n = 0; while (n < toks.length && toks[n] === String(n + 1)) n++;
      if (n >= 1 && toks.length >= n * 8) {
        const col = k => toks.slice(n * k, n * (k + 1));
        const D = col(1), H = col(2), LA = col(3), LO = col(4), M = col(5), P = col(6), PL = col(7);
        for (let i = 0; i < n; i++) add(D[i], H[i], LA[i], LO[i], M[i], P[i], PL[i]);
      }
    }
    // 4) último recurso: reconocer cada dato por su forma (fecha, hora, coordenadas, magnitud, profundidad, lugar), esté como esté armada la página
    if (!out.length) {
      const toks = String(html).replace(/<\s*(script|style)[\s\S]*?<\/\s*\1\s*>/gi, ' ').replace(/<[^>]*>/g, '\n').replace(/&nbsp;/g, ' ').split(/\n+/).map(x => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
      const D = [], T = [], C = [], M = [], P = [], L = [];
      toks.forEach(x => {
        if (/^\d{1,2}\/\d{1,2}$/.test(x)) D.push(x);
        else if (/^\d{1,2}:\d{2}$/.test(x)) T.push(x);
        else if (/^-?\d{1,3}[.,]\d{2,3}$/.test(x) && Math.abs(parseFloat(x.replace(',', '.'))) > 9.99) C.push(x);
        else if (/^\d[.,]\d$/.test(x)) M.push(x);
        else if (/^\d{1,3}\s*km$/i.test(x)) P.push(x);
        else if (/^[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ .]{2,}$/.test(x) && !/^(SISMOLOG|INSTITUTO|SERVICIO|RED |INGENIER|LABORATORIO|PUBLICACIONES|SERVICIOS|DOCENTES|MAPAS|PREGUNTAS|GLOSARIO)/.test(x)) L.push(x);
      });
      const n = D.length;
      if (n && T.length >= n && M.length >= n && P.length >= n && C.length >= 2 * n && L.length >= n) {
        // en filas los datos se alternan (lat, lon, lat, lon...) y en columnas vienen primero todas las latitudes
        const rows = toks.findIndex(x => /^\d{1,2}\/\d{1,2}$/.test(x));
        const byRow = rows >= 0 && /^\d{1,2}:\d{2}$/.test(toks[rows + 1] || '');
        for (let i = 0; i < n; i++) add(D[i], T[i], byRow ? C[2 * i] : C[i], byRow ? C[2 * i + 1] : C[n + i], M[i], P[i], L[i]);
      }
    }
    return out.sort((a, b) => b.time - a.time);
  };
  // Lugares del USGS ("64 km WSW of Valparaíso, Chile") en español
  const DIR_ES = { N: 'norte', NNE: 'norte-noreste', NE: 'noreste', ENE: 'este-noreste', E: 'este', ESE: 'este-sudeste', SE: 'sudeste', SSE: 'sur-sudeste', S: 'sur', SSW: 'sur-sudoeste', SW: 'sudoeste', WSW: 'oeste-sudoeste', W: 'oeste', WNW: 'oeste-noroeste', NW: 'noroeste', NNW: 'norte-noroeste' };
  g.quakePlaceEs = function (t) {
    const m = /^(\d+)\s*km\s+([NSEW]{1,3})\s+of\s+(.+)$/i.exec(String(t || '').trim());
    return m && DIR_ES[m[2].toUpperCase()] ? m[1] + ' km al ' + DIR_ES[m[2].toUpperCase()] + ' de ' + m[3] : String(t || '');
  };
  // Lector flexible para el archivo de datos del mapa del INPRES (XML/KML/JSON con campos de sismo)
  g.parseInpresXml = function (txt, nowMs) {
    const now = nowMs || Date.now(), out = [], seen = new Set(); txt = String(txt || '');
    const mk = f => {
      const pick = re => { for (const k in f) if (re.test(k) && f[k] !== '') return f[k]; return ''; };
      const all = Object.values(f).join(' ');
      let la = parseFloat(pick(/^(lat|latitud|latitude|y)$/)), lo = parseFloat(pick(/^(lon|lng|long|longitud|longitude|x)$/));
      let mg = parseFloat(String(pick(/^mg$|mag/)).replace(',', '.')), pr = parseFloat(String(pick(/prof|depth/)).replace(',', '.'));
      if (!Number.isFinite(la)) { const m = /lat\w*\D{0,4}(-?\d+[.,]\d+)/i.exec(all); if (m) la = parseFloat(m[1].replace(',', '.')); }
      if (!Number.isFinite(lo)) { const m = /lo?n\w*\D{0,4}(-?\d+[.,]\d+)/i.exec(all); if (m) lo = parseFloat(m[1].replace(',', '.')); }
      if (!Number.isFinite(mg)) { const m = /mag\w*\D{0,6}(\d+(?:[.,]\d+)?)/i.exec(all); if (m) mg = parseFloat(m[1].replace(',', '.')); }
      if (!Number.isFinite(pr)) { const m = /(?:prof\w*|depth)\D{0,6}(\d+(?:[.,]\d+)?)/i.exec(all); if (m) pr = parseFloat(m[1].replace(',', '.')); }
      if (!Number.isFinite(la) || !Number.isFinite(lo) || !Number.isFinite(mg) || Math.abs(la) > 90 || Math.abs(lo) > 180) return;
      let fe = pick(/fecha|date|time|origen|utc/), ho = pick(/hora/), t = NaN;
      if (!fe) { const m = /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?|\d{1,2}\/\d{1,2}\/\d{2,4}\s+\d{1,2}:\d{2}/.exec(all); if (m) fe = m[0]; }
      const idm = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(pick(/^idsismo$|^id$/).trim());
      if (idm) t = Date.UTC(+idm[1], +idm[2] - 1, +idm[3], +idm[4], +idm[5], +idm[6]);
      else if (/^\d{9,13}$/.test(fe.trim())) { t = +fe; if (t < 1e11) t *= 1000; }
      else {
        let m = /(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?\s*(Z|[+-]\d{2}:?\d{2})?/.exec(fe + ' ' + ho);
        let y, mo, d, h, mi, tz = null;
        if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; h = +m[4]; mi = +m[5]; tz = m[7] || null; }
        else {
          m = /(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(fe); const hm = /(\d{1,2}):(\d{2})/.exec(fe + ' ' + ho);
          const m0 = /^(\d{1,2})\/(\d{1,2})$/.exec(fe.trim());
          if (m0 && hm) { d = +m0[1]; mo = +m0[2]; y = new Date(now - 3 * 3600e3).getUTCFullYear(); h = +hm[1]; mi = +hm[2]; }
          else if (m && hm) { d = +m[1]; mo = +m[2]; y = +m[3] < 100 ? 2000 + +m[3] : +m[3]; h = +hm[1]; mi = +hm[2]; }
          else { const m2 = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fe.trim()), hm2 = /(\d{1,2}):(\d{2})/.exec(ho); if (m2 && hm2) { y = +m2[1]; mo = +m2[2]; d = +m2[3]; h = +hm2[1]; mi = +hm2[2]; } }
        }
        if (y) {
          let off = 3; if (tz) off = tz === 'Z' ? 0 : -((tz[0] === '-' ? -1 : 1) * (+tz.slice(1, 3) + (+tz.slice(-2)) / 60));
          t = Date.UTC(y, mo - 1, d, h + off, mi);
        }
      }
      if (!Number.isFinite(t) || t > now + 36 * 3600e3) return;
      const lugar = pick(/lugar|place|ref|ubic|desc|title|name|nombre|zona|loc|prov/) || '';
      const id = 'inpres-' + Math.round(t / 6e4) + '-' + la.toFixed(2) + '-' + lo.toFixed(2); if (seen.has(id)) return; seen.add(id);
      out.push({ id, lat: la, lon: lo, depth: Number.isFinite(pr) ? pr : 0, mag: mg, place: String(lugar).replace(/\s+/g, ' ').trim().toLowerCase().replace(/(^|\s)\S/g, c => c.toUpperCase()), time: t, source: 'INPRES' });
    };
    try {
      if (/^\s*[\[{]/.test(txt)) {
        const walk = o => { if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === 'object') { const f = {}; let leaf = false; for (const k in o) { if (o[k] === null || typeof o[k] !== 'object') { f[k.toLowerCase()] = String(o[k]); leaf = true; } } if (o.geometry && o.geometry.coordinates) { f.lon = o.geometry.coordinates[0]; f.lat = o.geometry.coordinates[1]; } if (o.properties) Object.keys(o.properties).forEach(k => f[k.toLowerCase()] = String(o.properties[k])); if (leaf || o.properties) mk(f); for (const k in o) if (o[k] && typeof o[k] === 'object') walk(o[k]); } };
        walk(JSON.parse(txt));
      } else if (typeof DOMParser !== 'undefined') {
        const doc = new DOMParser().parseFromString(txt, 'text/xml');
        doc.querySelectorAll('*').forEach(e => {
          const f = {}; let n = 0;
          for (const a of e.attributes || []) { f[a.name.toLowerCase()] = a.value; n++; }
          for (const c of e.children || []) { if (!c.children.length) { f[c.nodeName.toLowerCase().replace(/^.*:/, '')] = (c.textContent || '').trim(); n++; } }
          const cn = e.querySelector && e.querySelector('coordinates'); if (cn && !f.coordinates) { f.coordinates = (cn.textContent || '').trim(); n++; }
          if (n >= 3) { const co = f.coordinates; if (co && !f.lat) { const q = co.trim().split(/[,\s]+/); f.lon = q[0]; f.lat = q[1]; } mk(f); }
        });
      }
    } catch (e) { }
    return out.sort((a, b) => b.time - a.time);
  };
  g.inpresWhy = '';
  const INPRES_URL = 'https://www.inpres.gob.ar/seismology/xultimos.html';
  const INPRES_XML = 'https://www.inpres.gob.ar/mapa/sismos.xml';
  let inpresCache = null;
  g.fetchInpres = async function () {
    if (inpresCache && Date.now() - inpresCache.t < 3 * 60e3) return inpresCache.list;
    const get = async url => {
      const ac = new AbortController(), tm = setTimeout(() => ac.abort(), 7000);
      try {
        const r = await fetch(url, { signal: ac.signal });
        if (!r.ok) throw new Error('HTTP ' + r.status + (r.headers.get('x-proxy-error') ? ' · ' + r.headers.get('x-proxy-error') : ''));
        return await r.text();
      } finally { clearTimeout(tm); }
    };
    try {
      g.inpresSnip = '';
      try { const lx = g.parseInpresXml(await get(INPRES_XML)); if (lx.length) { inpresCache = { t: Date.now(), list: lx }; return lx; } } catch (e) { }
      let html = await get(INPRES_URL), list = g.parseInpres(html);
      if (!list.length) {
        // la tabla puede cargarse aparte (iframe, script o pedido ajax): buscamos todas las direcciones que menciona la página
        const h = String(html), cand = [];
        const add = u => { try { const abs = new URL(u.replace(/&amp;/g, '&'), INPRES_URL).href; if (/^https?:\/\/([a-z0-9-]+\.)*inpres\.gob\.ar\//i.test(abs) && !/\.(css|png|jpe?g|gif|svg|ico|woff2?|ttf|pdf)(\?|$)/i.test(abs) && abs !== INPRES_URL && cand.indexOf(abs) < 0) cand.push(abs); } catch (e) { } };
        [...h.matchAll(/<(?:iframe|frame|script|embed|object)[^>]+(?:src|data)=["']([^"']+)["']/gi)].forEach(m => add(m[1]));
        [...h.matchAll(/["'`]([^"'`\s<>]+\.(?:php|json|xml|txt|csv|aspx?|html?)(?:\?[^"'`\s<>]*)?)["'`]/gi)].forEach(m => add(m[1]));
        cand.sort((x, y) => (/ultim|sism|xult|data|json|ajax|tabla/i.test(y) ? 1 : 0) - (/ultim|sism|xult|data|json|ajax|tabla/i.test(x) ? 1 : 0));
        g.inpresCand = cand.slice(0, 8);
        for (const abs of cand.slice(0, 6)) {
          try { const t = await get(abs); list = g.parseInpres(t); if (!list.length) list = g.parseInpresXml(t); if (!list.length && !g.inpresSnip) g.inpresSnip = abs.replace(/^https?:\/\/[^/]+/, '') + ' → ' + String(t).replace(/\s+/g, ' ').slice(0, 220); if (list.length) break; } catch (e) { if (!g.inpresSnip) g.inpresSnip = abs.replace(/^https?:\/\/[^/]+/, '') + ' → ' + String((e && e.message) || e).slice(0, 80); }
        }
      }
      if (!list.length) {
        const txt = String(html).replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        const i = txt.search(/Lugar/i);
        throw new Error('sin filas legibles: recibí ' + String(html).length + ' caracteres; ' + (/\bKm\b/.test(txt) ? 'hay datos pero con otra forma' : 'no hay tabla de sismos') + '; ' + (i >= 0 ? 'después de «Lugar»: ' + txt.slice(i, i + 80) : 'sin encabezado «Lugar»: ' + txt.slice(0, 80)) + (g.inpresCand && g.inpresCand.length ? '; probé: ' + g.inpresCand.map(u => u.replace(/^https?:\/\/(www\.)?inpres\.gob\.ar/i, '')).join(' , ') : '; la página no nombra otros archivos') + (g.inpresSnip ? '; contenido: ' + g.inpresSnip : ''));
      }
      inpresCache = { t: Date.now(), list };
      return list;
    } catch (e) { g.inpresWhy = (e && e.name === 'AbortError') ? 'tardó demasiado' : String((e && e.message) || e); throw e; }
  };
  g.__resetInpres = () => { inpresCache = null; };
  const kmBetween = (a, b, c, d) => Math.hypot((a - c) * 111, (b - d) * 111 * Math.cos(a * Math.PI / 180));
  g.fetchUSGSraw = async function (loc, cfg) {
    const start = new Date(Date.now() - 3 * 3600e3).toISOString();
    const u = 'https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&orderby=time&starttime=' + start +
      '&latitude=' + loc.lat + '&longitude=' + loc.lon + '&maxradiuskm=' + cfg.quakeKm + '&minmagnitude=' + cfg.quakeMag;
    const j = await (await fetch(u)).json();
    return (j.features || []).map(f => ({
      id: f.id, lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], depth: f.geometry.coordinates[2],
      mag: f.properties.mag, place: g.quakePlaceEs(f.properties.place), time: f.properties.time, source: 'USGS'
    }));
  };
  // Mismo nombre de siempre: primero INPRES (oficial), si no responde usa USGS
  g.fetchUSGS = async function (loc, cfg) {
    try {
      const all = await g.fetchInpres(), since = Date.now() - 3 * 3600e3;
      return all.filter(q => q.time >= since && q.mag >= cfg.quakeMag && kmBetween(q.lat, q.lon, loc.lat, loc.lon) <= cfg.quakeKm);
    } catch (e) {
      return g.fetchUSGSraw(loc, cfg);
    }
  };
  g.quakeEvents = function (list, loc, place) {
    if (!list || !list.length) return [];
    const q = list.reduce((a, b) => (b.mag > a.mag ? b : a));
    const d = Math.round(Math.hypot((q.lat - loc.lat) * 111, (q.lon - loc.lon) * 111 * Math.cos(loc.lat * Math.PI / 180)));
    return [{
      type: 'quake', level: q.mag >= 5 ? 3 : q.mag >= 4 ? 2 : 1, key: q.id, place: place,
      title: 'Sismo de magnitud ' + Number(q.mag).toFixed(1).replace('.', ','),
      detail: 'Sismo de magnitud ' + Number(q.mag).toFixed(1).replace('.', ',') + (q.place ? ' en ' + q.place : '') + ', a ' + d + ' km de ' + (place || 'tu ubicación') + ', a ' + Math.round(q.depth) + ' km de profundidad.',
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
  /* Frase corta para decir en voz alta: aviso + dato clave + qué hacer. */
  g.sayFor = function (e) {
    const first = (t, max) => { t = String(t || '').replace(/\s+/g, ' ').trim(); const m = /^(.+?[.!?])(\s|$)/.exec(t); t = m ? m[1] : t; return t.length > max ? '' : t; };
    if (e.say) return g.plain(e.say);
    const d = first(g.plain(e.detail), 130);
    const norm = x => String(x).toLowerCase().replace(/[^a-záéíóúñ0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 2);
    const tw = norm(e.title), dw = new Set(norm(d));
    const dup = d && tw.length && tw.filter(w => dw.has(w)).length / tw.length >= 0.6; // el detalle ya dice lo del título
    const parts = ['Atención'];
    if (!dup) parts.push(e.title + (e.place && e.type !== 'quake' ? ' en ' + e.place : ''));
    if (d) parts.push(d);
    let tip = first(g.plain(g.TIPS[e.type] || ''), 110);
    if (tip && parts.join('. ').length + tip.length > 190) tip = ''; // corto: que se entienda en ~10 segundos
    if (tip) parts.push(tip);
    return g.plain(parts.map(x => String(x).replace(/[.\s]+$/, '')).join('. ') + '.').replace(/[·•]/g, ',').slice(0, 300);
  };
  g.notifOptions = function (e, cfg) {
    const t = g.TYPES[e.type];
    return {
      title: g.plain(t.icon + ' ' + e.title + (e.place ? ' · ' + e.place : '')),
      opts: {
        body: g.plain(e.detail) + '\n👉 ' + g.plain(g.TIPS[e.type]),
        tag: g.evKey(e), renotify: true, icon: 'icon-192.png', badge: 'icon-192.png',
        vibrate: cfg.vibrate ? [300, 150, 300, 150, 400] : [],
        requireInteraction: e.level >= 2,
        actions: [{ action: 'call', title: '📞 Llamar 911' }, { action: 'open', title: 'Qué hacer' }],
        data: { type: e.type }
      }
    };
  };
})(typeof self !== 'undefined' ? self : this);
