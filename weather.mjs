// Proxy de clima con varios proveedores: si uno alcanza su límite o falla, se usa el siguiente.
// Devuelve siempre el formato de Open-Meteo ({current, hourly}) para que la app no cambie.
// Las respuestas se guardan en la caché del CDN (10 min) y se comparten entre todos los usuarios.

const UA = 'ClimaMendoza/1.0 (https://climamdz.netlify.app)';
const cool = {}; // proveedor -> timestamp hasta el que no se usa (por límite alcanzado)

class LimitError extends Error {
  constructor(msg, ms) { super(msg); this.limit = true; this.ms = ms; }
}

async function getJSON(url, ms, headers) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(url, { signal: c.signal, headers: Object.assign({ 'User-Agent': UA, Accept: 'application/json' }, headers || {}) });
    let j = null;
    try { j = await r.json(); } catch (e) {}
    if (r.status === 429 || (j && j.error && /limit/i.test(j.reason || ''))) {
      const reason = (j && j.reason) || 'HTTP 429';
      throw new LimitError(reason, /minut/i.test(reason) ? 60e3 : /hour/i.test(reason) ? 3600e3 : untilUtcMidnight());
    }
    if (!r.ok || (j && j.error)) throw new Error((j && j.reason) || 'HTTP ' + r.status);
    return j;
  } finally { clearTimeout(t); }
}
const untilUtcMidnight = () => { const d = new Date(); d.setUTCHours(24, 0, 0, 0); return d - Date.now(); };

/* ---------- 1) Open-Meteo ---------- */
const CUR_FULL = 'temperature_2m,relative_humidity_2m,precipitation,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,wind_gusts_10m,cape,lifted_index';
async function openMeteo(pts, full, hourly) {
  const u = 'https://api.open-meteo.com/v1/forecast?latitude=' + pts.map(p => p[0]).join(',') + '&longitude=' + pts.map(p => p[1]).join(',') +
    '&current=' + (full ? CUR_FULL : 'weather_code,precipitation,cape,lifted_index') +
    (hourly ? '&hourly=weather_code,precipitation,wind_gusts_10m,cape,lifted_index&forecast_hours=6' : '') + '&timezone=auto&wind_speed_unit=kmh';
  const j = await getJSON(u, 6000);
  const arr = Array.isArray(j) ? j : [j];
  return arr.map(d => ({ current: d.current, hourly: d.hourly }));
}

/* ---------- 2) MET Norway (yr.no) ---------- */
function metSymbolToWmo(s, pr) {
  s = (s || '').replace(/_(day|night|polartwilight)$/, '');
  if (/thunder/.test(s)) return /heavy/.test(s) ? 95 : 95;
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
async function metOne(lat, lon) {
  const j = await getJSON('https://api.met.no/weatherapi/locationforecast/2.0/complete?lat=' + (+lat).toFixed(4) + '&lon=' + (+lon).toFixed(4), 6000);
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
      weather_code: metSymbolToWmo(n.summary && n.summary.symbol_code, pr),
      cloud_cover: Math.round(d.cloud_area_fraction),
      wind_speed_10m: Math.round(d.wind_speed * 3.6 * 10) / 10,
      wind_direction_10m: Math.round(d.wind_from_direction),
      wind_gusts_10m: Math.round((d.wind_speed_of_gust != null ? d.wind_speed_of_gust : d.wind_speed * 1.5) * 3.6 * 10) / 10
    };
  };
  const hours = ts.slice(i0, i0 + 6).map(conv);
  return {
    current: hours[0],
    hourly: {
      weather_code: hours.map(h => h.weather_code),
      precipitation: hours.map(h => h.precipitation),
      wind_gusts_10m: hours.map(h => h.wind_gusts_10m)
    }
  };
}
async function metNorway(pts) {
  return Promise.all(pts.map(p => metOne(p[0], p[1])));
}

/* ---------- 3) wttr.in ---------- */
function wwoToWmo(c) {
  c = +c;
  if ([200, 386, 389, 392, 395].includes(c)) return c === 389 || c === 395 ? 95 : 95;
  if ([113].includes(c)) return 0;
  if ([116].includes(c)) return 2;
  if ([119, 122].includes(c)) return 3;
  if ([143, 248, 260].includes(c)) return 45;
  if ([176, 353].includes(c)) return 80;
  if ([356].includes(c)) return 81;
  if ([359].includes(c)) return 82;
  if ([263, 266, 293, 296].includes(c)) return 61;
  if ([299, 302].includes(c)) return 63;
  if ([305, 308].includes(c)) return 65;
  if ([182, 185, 281, 284, 311, 314, 317, 320, 350, 362, 365, 374, 377].includes(c)) return 66;
  if ([179, 227, 230, 323, 326, 329, 332, 335, 338, 368, 371].includes(c)) return 73;
  return 0;
}
async function wttrOne(lat, lon) {
  const j = await getJSON('https://wttr.in/' + (+lat).toFixed(3) + ',' + (+lon).toFixed(3) + '?format=j1', 6000);
  const c = j && j.current_condition && j.current_condition[0];
  if (!c) throw new Error('wttr sin datos');
  const current = {
    temperature_2m: +c.temp_C,
    relative_humidity_2m: +c.humidity,
    precipitation: +c.precipMM || 0,
    weather_code: wwoToWmo(c.weatherCode),
    cloud_cover: +c.cloudcover,
    wind_speed_10m: +c.windspeedKmph,
    wind_direction_10m: +c.winddirDegree,
    wind_gusts_10m: +c.windspeedKmph * 1.5
  };
  // Pronóstico cada 3 h: se toman los bloques que cubren las próximas 6 h (hora local del lugar)
  const slots = [];
  (j.weather || []).forEach(d => (d.hourly || []).forEach(h => {
    slots.push({ t: Date.parse(d.date + 'T00:00:00Z') + (+h.time / 100) * 3600e3, h });
  }));
  const m = /(\d{4}-\d{2}-\d{2}) (\d{1,2}):(\d{2}) (AM|PM)/.exec(c.localObsDateTime || '');
  let nowLocal = Date.now();
  if (m) {
    let hh = +m[2] % 12; if (m[4] === 'PM') hh += 12;
    nowLocal = Date.parse(m[1] + 'T00:00:00Z') + hh * 3600e3 + +m[3] * 60e3;
  }
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
async function wttr(pts) {
  return Promise.all(pts.map(p => wttrOne(p[0], p[1])));
}

const PROVIDERS = [
  { name: 'open-meteo', run: openMeteo, max: 50 },
  { name: 'met-norway', run: metNorway, max: 20 },
  { name: 'wttr', run: wttr, max: 20 }
];

export default async (req) => {
  const q = new URL(req.url).searchParams;
  const lats = (q.get('lat') || '').split(',').map(Number);
  const lons = (q.get('lon') || '').split(',').map(Number);
  const full = q.get('full') !== '0';
  const hourly = q.get('hourly') === '1';
  const skip = (q.get('skip') || '').split(',');
  const pts = lats.map((la, i) => [la, lons[i]]).filter(p => isFinite(p[0]) && isFinite(p[1]) && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180);
  if (!pts.length || pts.length !== lats.length) return Response.json({ error: true, reason: 'coordenadas inválidas' }, { status: 400 });

  const errors = [];
  for (const p of PROVIDERS) {
    if (skip.includes(p.name) || pts.length > p.max) continue;
    if (cool[p.name] && cool[p.name] > Date.now()) { errors.push(p.name + ': en pausa por límite'); continue; }
    try {
      const data = await p.run(pts, full, hourly);
      if (!data.length || !data.every(d => d && d.current)) throw new Error('respuesta incompleta');
      return Response.json({ source: p.name, data }, {
        headers: {
          'Cache-Control': 'public, max-age=120',
          'Netlify-CDN-Cache-Control': 'public, max-age=0, s-maxage=600, stale-while-revalidate=300, durable',
          'Netlify-Vary': 'query'
        }
      });
    } catch (e) {
      if (e.limit) cool[p.name] = Date.now() + Math.min(e.ms, 6 * 3600e3);
      errors.push(p.name + ': ' + ((e && e.name === 'AbortError') ? 'tiempo agotado' : (e && e.message) || 'error'));
    }
  }
  const lim = errors.length && errors.every(x => /l[íi]mit/i.test(x));
  return Response.json({ error: true, reason: (lim ? 'limit: ' : '') + 'ningún proveedor respondió (' + errors.join(' | ') + ')' }, {
    status: 503, headers: { 'Cache-Control': 'no-store' }
  });
};

export const config = { path: '/api/weather' };
