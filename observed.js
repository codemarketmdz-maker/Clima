/* Observaciones reales: METAR de aeropuertos (Mendoza y vecinos) + eco de radar sobre tu punto.
   Sirve para avisar lo que YA está pasando (tormenta, rayos, granizo, lluvia) aunque el modelo no lo haya previsto,
   y para avisar si una tormenta observada en una estación vecina viene hacia tu lugar.
   Lo usan index.html y bg.html (segundo plano). Necesita detect.js cargado antes. */
(function (g) {
  'use strict';
  const STATIONS = [
    { id: 'SAME', name: 'Aeropuerto de Mendoza', lat: -32.8317, lon: -68.7928 },
    { id: 'SAMR', name: 'Aeropuerto de San Rafael', lat: -34.5883, lon: -68.4033 },
    { id: 'SAMM', name: 'Aeropuerto de Malargüe', lat: -35.4936, lon: -69.5744 },
    { id: 'SANU', name: 'Aeropuerto de San Juan', lat: -31.5715, lon: -68.4182 },
    { id: 'SAOU', name: 'Aeropuerto de San Luis', lat: -33.2732, lon: -66.3564 }
  ];
  const STN = {}; STATIONS.forEach(s => { STN[s.id] = s; });
  const HERE_KM = 35, MAX_KM = 220;
  const KMH = 1.852;

  const rad = x => x * Math.PI / 180;
  function distKm(a, b, c, d) {
    const p = rad(c - a), q = rad(d - b), h = Math.sin(p / 2) ** 2 + Math.cos(rad(a)) * Math.cos(rad(c)) * Math.sin(q / 2) ** 2;
    return 12742 * Math.asin(Math.sqrt(h));
  }
  function bearing(a, b, c, d) {
    const y = Math.sin(rad(d - b)) * Math.cos(rad(c)), x = Math.cos(rad(a)) * Math.sin(rad(c)) - Math.sin(rad(a)) * Math.cos(rad(c)) * Math.cos(rad(d - b));
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }
  const angDiff = (a, b) => { const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d); };
  const hhmm = t => new Date(t).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });
  const num = s => (s[0] === 'M' ? -1 : 1) * Number(s.replace('M', ''));
  const COVER = { FEW: 1, SCT: 2, BKN: 3, OVC: 4 };

  // ---- Lectura de un mensaje METAR/SPECI en texto ----
  function parseMetar(line, now) {
    const m = String(line || '').trim().replace(/=+$/, '').split(/\s+/);
    let i = 0;
    if (m[i] === 'METAR' || m[i] === 'SPECI') i++;
    if (m[i] === 'COR') i++;
    const id = m[i++];
    if (!STN[id]) return null;
    const tm = /^(\d{2})(\d{2})(\d{2})Z$/.exec(m[i] || '');
    if (!tm) return null;
    i++;
    const d = new Date(now);
    let t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), +tm[1], +tm[2], +tm[3]);
    if (t > now + 3600e3) t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, +tm[1], +tm[2], +tm[3]);
    const o = { id, time: t, raw: m.join(' '), wx: [], cb: null, cover: 0, gust: null, wdir: null, wspd: null, temp: null, dew: null, vis: null, cavok: false };
    for (; i < m.length; i++) {
      const k = m[i];
      if (/^(RMK|TEMPO|BECMG|NOSIG|PROB\d\d)$/.test(k)) break; // lo previsto no cuenta como observado
      let x;
      if ((x = /^(\d{3}|VRB)(\d{2,3})(?:G(\d{2,3}))?KT$/.exec(k))) { o.wdir = x[1] === 'VRB' ? null : +x[1]; o.wspd = +x[2]; o.gust = x[3] ? +x[3] : null; continue; }
      if (k === 'CAVOK') { o.cavok = true; continue; }
      if (/^\d{4}$/.test(k) && o.vis == null) { o.vis = +k; continue; }
      if ((x = /^(FEW|SCT|BKN|OVC)(\d{3})(CB|TCU)?$/.exec(k))) { o.cover = Math.max(o.cover, COVER[x[1]]); if (x[3]) o.cb = x[3]; continue; }
      if ((x = /^(M?\d{2})\/(M?\d{2})?$/.exec(k))) { o.temp = num(x[1]); o.dew = x[2] ? num(x[2]) : null; continue; }
      if (/^[+-]?(VC)?(MI|PR|BC|DR|BL|SH|TS|FZ)?(DZ|RA|SN|SG|PL|GR|GS|UP|BR|FG|FU|VA|DU|SA|HZ|SQ|FC|SS|DS)+$/.test(k) || /^[+-]?(VC)?(TS|SH)$/.test(k)) o.wx.push(k);
    }
    return o;
  }
  function parseMetars(text, now) {
    const out = [];
    String(text || '').split(/\r?\n/).forEach(l => { const o = parseMetar(l, now); if (o) out.push(o); });
    return out;
  }

  // Cómo se nombra la fuente en los textos: "del aeropuerto de Mendoza" / "de la estación del Servicio Meteorológico en Malargüe"
  const informeDe = o => o.src === 'smn' ? 'de la estación del Servicio Meteorológico en ' + o.place : 'del ' + o.name.replace(/^Aeropuerto/, 'aeropuerto');
  const enEl = o => o.src === 'smn' ? 'en la estación del Servicio Meteorológico en ' + o.place : 'en el ' + o.name.replace(/^Aeropuerto/, 'aeropuerto');

  // ---- Qué dice una observación ----
  function flags(o) {
    const w = o.wx || [];
    const real = w.filter(k => !/VC/.test(k));
    return {
      hail: real.some(k => /GR/.test(k)),
      ts: real.some(k => /TS/.test(k)),
      vcts: w.some(k => /VCTS/.test(k)),
      rain: real.some(k => /RA|DZ|SH/.test(k)),
      cb: !!o.cb
    };
  }
  function severity(o) {
    const f = flags(o);
    if (f.hail) return 3;
    if (f.ts || f.vcts) return 2;
    if (f.cb && f.rain) return 2;
    if (f.cb || f.rain) return 1;
    return 0;
  }
  function describe(o, noWind) {
    const f = flags(o), p = [];
    if (f.hail) p.push('granizo');
    if (f.ts) p.push('tormenta con rayos' + (o.wx.some(k => /^\+/.test(k) && /TS/.test(k)) ? ' intensa' : ''));
    else if (f.vcts) p.push('tormenta con rayos en las cercanías');
    if (f.rain && !f.ts) p.push(o.wx.some(k => /^\+/.test(k)) ? 'lluvia intensa' : o.wx.some(k => /^-/.test(k)) ? 'lluvia débil' : 'lluvia');
    else if (f.rain && f.ts) p.push('lluvia');
    if (f.cb) p.push('nubes de tormenta');
    if (!noWind && (o.gust != null || o.wspd != null)) {
      const v = Math.round((o.gust != null ? o.gust : o.wspd) * KMH);
      if (v >= 35) p.push('viento ' + (o.gust != null ? 'con ráfagas de ' : 'de ') + v + ' kilómetros por hora');
    }
    return p.join(', ');
  }
  // Resumen corto para la tarjeta del clima
  function summaryLine(o) {
    const f = flags(o), p = [];
    if (o.temp != null) p.push(g.plain(o.temp + ' °C'));
    if (o.wspd != null) {
      const sp = Math.round(o.wspd * KMH);
      p.push(sp === 0 ? 'calma' : (o.wdir != null ? 'viento del ' + g.bearingName(o.wdir) + ' ' : 'viento ') + sp + ' km/h' + (o.gust != null ? ', ráfagas de ' + Math.round(o.gust * KMH) : ''));
    }
    const d = describe(o, true);
    if (severity(o) > 0 && d) p.push(d);
    else if (o.cavok || o.cover <= 1) p.push('despejado');
    else p.push(o.cover >= 4 ? 'cubierto' : o.cover === 3 ? 'nublado' : 'parcialmente nublado');
    return p.join(' · ');
  }

  // ---- Descarga ----
  async function getText(url, ms) {
    const c = new AbortController(), t = setTimeout(() => c.abort(), ms);
    try {
      const r = await fetch(url, { signal: c.signal });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.text();
    } finally { clearTimeout(t); }
  }
  let metarCache = null;
  g.fetchMetars = async function (force) {
    const now = Date.now();
    if (!force && metarCache && now - metarCache.at < 8 * 60e3) return metarCache.list;
    let list = [];
    try {
      const txt = await getText('https://aviationweather.gov/api/data/metar?ids=' + STATIONS.map(s => s.id).join(',') + '&format=raw&hours=3', 9000);
      list = parseMetars(txt, now);
    } catch (e) { list = []; }
    if (!list.length) {
      // Respaldo: último mensaje de cada estación (servidor de NOAA)
      const parts = await Promise.all(STATIONS.map(async s => {
        try { const t = await getText('https://tgftp.ncep.noaa.gov/data/observations/metar/stations/' + s.id + '.TXT', 8000); return parseMetars(t.split(/\r?\n/).slice(1).join('\n'), now); }
        catch (e) { return []; }
      }));
      list = [].concat(...parts);
    }
    if (list.length || !metarCache) metarCache = { at: now, list };
    else metarCache.at = now - 5 * 60e3; // reintento más pronto si la fuente falló
    return metarCache.list;
  };

  // ---- Radar: ¿hay eco de lluvia justo sobre el punto? ----
  const radarCache = new Map();
  async function radarHere(loc) {
    const key = (+loc.lat).toFixed(2) + ',' + (+loc.lon).toFixed(2), c = radarCache.get(key);
    if (c && Date.now() - c.at < 4 * 60e3) return c.v;
    let v = null;
    try {
      const tl = await g.fetchRadarTimeline(), f = tl.frames[tl.frames.length - 1];
      const ageMin = (Date.now() / 1000 - f.time) / 60;
      if (ageMin <= 45 && g.radarBitmap) {
        const url = tl.host.replace(/\/$/, '') + f.path + '/512/7/' + (+loc.lat).toFixed(4) + '/' + (+loc.lon).toFixed(4) + '/2/1_1.png';
        const im = await g.radarBitmap(url);
        let n = 0, strong = 0;
        for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
          const o = ((256 + dy) * im.width + (256 + dx)) * 4, r = im.data[o], gg = im.data[o + 1], b = im.data[o + 2], a = im.data[o + 3];
          if (a < 78) continue;
          const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
          if (!mx || (mx - mn) / mx < 0.22) continue;
          n++;
          if ((r >= 170 && b <= 140) || (r >= 170 && b >= 170 && gg <= 120)) strong++;
        }
        v = { rain: n >= 2, strong: strong >= 2, echoes: n, ageMin: Math.max(0, Math.round(ageMin)) };
      }
    } catch (e) { v = null; }
    radarCache.set(key, { at: Date.now(), v });
    while (radarCache.size > 20) radarCache.delete(radarCache.keys().next().value);
    return v;
  }

  // Une todo y lo deja en current.obs (misma idea que attachCloudTops)
  g.attachObserved = async function (arr, locs) {
    if (!Array.isArray(arr) || !Array.isArray(locs)) return;
    // Aeropuertos (METAR), estaciones del SMN y su pronóstico se piden a la vez
    const got = await Promise.all([
      g.fetchMetars(false).catch(() => []),
      g.fetchSmnObs ? g.fetchSmnObs().catch(() => []) : [],
      g.fetchSmnPron ? g.fetchSmnPron().catch(() => ({})) : {}
    ]);
    const metars = got[0] || [], smn = got[1] || [], pron = got[2] || {};
    const posOf = o => o.src === 'smn' ? g.__smn.BYK[o.id.slice(4)] : STN[o.id];
    await Promise.all(arr.map(async (d, i) => {
      const loc = locs[i];
      if (!d || !d.current || !loc) return;
      const near = [];
      metars.concat(smn).forEach(o => {
        const s = posOf(o); if (!s) return;
        const km = distKm(loc.lat, loc.lon, s.lat, s.lon);
        if (km <= MAX_KM) near.push(Object.assign({}, o, { km: Math.round(km), brg: Math.round(bearing(loc.lat, loc.lon, s.lat, s.lon)), name: s.name || s.place }));
      });
      let radar = null;
      try { radar = await radarHere(loc); } catch (e) { radar = null; }
      let smnLine = '';
      try {
        const pr = (d.hourly && d.hourly.precipitation) || [];
        const om = pr.length ? pr.slice(0, 12).reduce((a, v) => a + (Number(v) || 0), 0) : null;
        smnLine = g.smnRainLine ? g.smnRainLine(pron, loc, om) : '';
      } catch (e) { smnLine = ''; }
      d.current.obs = { at: Date.now(), metars: near, radar, smnLine };
    }));
  };

  // Observación más reciente de la estación más cercana (≤ 40 km) para mostrar en la tarjeta
  g.airportLine = function (c) {
    const obs = c && c.obs; if (!obs || !obs.metars) return '';
    const here = obs.metars.filter(o => o.km <= 40);
    if (!here.length) return '';
    here.sort((a, b) => b.time - a.time || a.km - b.km);
    const o = here[0];
    if (Date.now() - o.time > 3 * 3600e3) return '';
    return (o.src === 'smn' ? '🌡️ ' + o.place : '✈️ ' + o.name) + ' ' + hhmm(o.time) + ' · ' + summaryLine(o);
  };

  g.smnLine = c => (c && c.obs && c.obs.smnLine) || '';

  // ---- Eventos a partir de lo observado ----
  g.observedEvents = function (c, h, cfg, place) {
    const out = [], obs = c && c.obs;
    if (!obs) return out;
    const now = Date.now();
    const lead = Math.max(30, Math.min(90, Number(cfg && cfg.alertLeadMin) || 60));
    const byStation = {};
    (obs.metars || []).forEach(o => { (byStation[o.id] = byStation[o.id] || []).push(o); });
    let hereStorm = false;
    Object.keys(byStation).forEach(id => {
      const list = byStation[id].sort((a, b) => b.time - a.time), latest = list[0];
      const ageOf = o => (now - o.time) / 60000;
      // Lo que cuenta como "ahora": todo mensaje de los últimos 30 min y el último si tiene hasta 75 min
      const recent = list.filter(o => ageOf(o) <= 30 || o === latest && ageOf(o) <= 75);
      if (!recent.length) return;
      let worst = recent[0];
      recent.forEach(o => { if (severity(o) > severity(worst)) worst = o; });
      const sev = severity(worst);
      if (!sev) return;
      const km = worst.km, ago = Math.max(0, Math.round(ageOf(worst)));
      const what = describe(worst);
      if (km <= HERE_KM) {
        const type = sev >= 3 ? 'hail' : sev === 2 ? 'stormStrong' : 'stormWeak';
        if (sev >= 2) hereStorm = true;
        out.push({
          type, level: g.RANK[type], title: g.TYPES[type].label, place, observed: true,
          detail: 'Informe ' + informeDe(worst) + ' de las ' + hhmm(worst.time) + ' (hace ' + ago + ' minutos' + (km >= 5 ? ', a ' + km + ' km de acá' : '') + '): ' + what + '.'
        });
        return;
      }
      // Estación lejana: ¿la tormenta viene hacia acá?
      if (sev < 2 || ageOf(worst) > 90) return;
      const hr = h || {};
      const vec = [700, 500].map(lv => {
        const sp = (hr['wind_speed_' + lv + 'hPa'] || [])[0], dr = (hr['wind_direction_' + lv + 'hPa'] || [])[0];
        if (sp == null || dr == null) return null;
        const to = (Number(dr) + 180) % 360 * Math.PI / 180, v = Number(sp);
        return Number.isFinite(v) ? { x: Math.sin(to) * v, y: Math.cos(to) * v } : null;
      }).filter(Boolean);
      if (!vec.length) return;
      const vx = vec.reduce((a, v) => a + v.x, 0) / vec.length, vy = vec.reduce((a, v) => a + v.y, 0) / vec.length;
      const toward = (Math.atan2(vx, vy) * 180 / Math.PI + 360) % 360, fromDir = (toward + 180) % 360;
      const speed = Math.max(20, Math.min(80, Math.hypot(vx, vy) * 0.8));
      const a = angDiff(worst.brg, fromDir);
      if (a > 40) return;
      const along = km * Math.cos(rad(a)), miss = km * Math.sin(rad(a));
      const remaining = along - speed * ageOf(worst) / 60;
      if (miss > 25 || remaining <= 5) return;
      const eta = Math.round(remaining / speed * 60);
      if (eta < 10 || eta > lead + 30) return;
      out.push({
        type: 'stormApproach', level: g.RANK.stormApproach, title: g.TYPES.stormApproach.label, place, observed: true,
        key: 'metar-approach:' + place,
        detail: 'Hay una tormenta ' + enEl(worst) + ' (informe de las ' + hhmm(worst.time) + '), a ' + km + ' km al ' + g.bearingName(worst.brg) +
          '. Con el viento en altura (del ' + g.bearingName(fromDir) + ') podría llegar en unos ' + eta + ' minutos. Es una estimación: puede cambiar.'
      });
    });
    // Radar sobre el punto
    const r = obs.radar;
    if (r && r.rain && !out.some(e => e.type === 'hail' || e.type === 'stormStrong')) {
      const corroborated = hereStorm || (c.cape != null && c.cape >= 300) || (c.ctt != null && c.ctt <= -40);
      if (r.strong && corroborated) {
        out.push({ type: 'stormStrong', level: g.RANK.stormStrong, title: g.TYPES.stormStrong.label, place, observed: true,
          detail: 'El radar muestra lluvia intensa sobre tu ubicación (imagen de hace ' + r.ageMin + ' minutos)' + (c.cape >= 300 ? ' y el aire está inestable' : '') + '.' });
      } else if (!out.length) {
        out.push({ type: 'stormWeak', level: g.RANK.stormWeak, title: g.TYPES.stormWeak.label, place, observed: true,
          detail: 'El radar detecta lluvia sobre tu ubicación (imagen de hace ' + r.ageMin + ' minutos).' });
      }
    }
    return out;
  };

  g.__obs = { reset: () => { metarCache = null; radarCache.clear(); }, parseMetar, parseMetars, severity, describe, summaryLine, flags, STATIONS, distKm, bearing };
})(typeof self !== 'undefined' ? self : this);
