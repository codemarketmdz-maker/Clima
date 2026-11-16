/* Datos abiertos del Servicio Meteorológico Nacional (SMN): estado del tiempo actual de sus estaciones y pronóstico a 5 días.
   - "Estado del tiempo": lo que cada estación observa (tormenta, lluvia, viento, temperatura). Se convierte al mismo formato que los
     informes de aeropuerto para que avisen igual que ellos (observed.js).
   - "Pronóstico 5 días": modelo del SMN por estación; se usa para cruzar la lluvia prevista con la del pronóstico general.
   Los archivos vienen en ZIP: la app los descomprime (OfficialProxy.kt). Si no se pueden leer, simplemente no se usan.
   Necesita detect.js y observed.js cargados antes. */
(function (g) {
  'use strict';
  // Estación -> posición aproximada (para saber cuál te queda cerca) y nombre en el archivo de pronóstico
  const ST = [
    { k: 'Mendoza', pk: 'MENDOZA_AERO', place: 'Mendoza (aeropuerto)', lat: -32.8317, lon: -68.7928 },
    { k: 'Mendoza Observatorio', pk: 'MENDOZA_OBSERVATORIO', place: 'Mendoza Observatorio', lat: -32.8833, lon: -68.8583 },
    { k: 'San Martín (Mza)', pk: 'SAN_MARTIN_(MZA)', place: 'San Martín', lat: -33.0833, lon: -68.4833 },
    { k: 'San Carlos (Mza)', pk: 'SAN_CARLOS_(MZA)', place: 'San Carlos', lat: -33.77, lon: -69.05 },
    { k: 'San Rafael', pk: 'SAN_RAFAEL_AERO', place: 'San Rafael', lat: -34.5883, lon: -68.4033 },
    { k: 'Malargue', pk: 'MALARGUE_AERO', place: 'Malargüe', lat: -35.4936, lon: -69.5744 },
    { k: 'Uspallata', pk: 'USPALLATA_AERO', place: 'Uspallata', lat: -32.5933, lon: -69.3472 },
    { k: 'San Juan', pk: 'SAN_JUAN_AERO', place: 'San Juan', lat: -31.5715, lon: -68.4182 },
    { k: 'San Luis', pk: 'SAN_LUIS_AERO', place: 'San Luis', lat: -33.2732, lon: -66.3564 },
    { k: 'Villa Reynolds', pk: 'VILLA_REYNOLDS_AERO', place: 'Villa Reynolds', lat: -33.7289, lon: -65.3874 },
    { k: 'Chilecito', pk: 'CHILECITO_AERO', place: 'Chilecito', lat: -29.2, lon: -67.43 },
    { k: 'La Rioja', pk: 'LA_RIOJA_AERO', place: 'La Rioja', lat: -29.38, lon: -66.8 },
    { k: 'Río Cuarto', pk: 'RIO_CUARTO_AERO', place: 'Río Cuarto', lat: -33.1, lon: -64.23 },
    { k: 'Neuquén', pk: 'NEUQUEN_AERO', place: 'Neuquén', lat: -38.95, lon: -68.13 }
  ];
  const BYK = {}; ST.forEach(s => { BYK[s.k] = s; });
  const BYP = {}; ST.forEach(s => { BYP[s.pk] = s; });
  g.SMN_STATIONS = ST;
  const MONTHS = { enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5, julio: 6, agosto: 7, septiembre: 8, setiembre: 8, octubre: 9, noviembre: 10, diciembre: 11 };
  const DIRS = { norte: 0, noreste: 45, este: 90, sudeste: 135, sur: 180, sudoeste: 225, oeste: 270, noroeste: 315 };
  const KT = 1 / 1.852;
  const rad = x => x * Math.PI / 180;
  const dist = (a, b, c, d) => { const p = rad(c - a), q = rad(d - b), h = Math.sin(p / 2) ** 2 + Math.cos(rad(a)) * Math.cos(rad(c)) * Math.sin(q / 2) ** 2; return 12742 * Math.asin(Math.sqrt(h)); };
  const norm = s => String(s || '').trim();

  // ---- Estado del tiempo actual ----
  // Línea: Estación;día;hora;estado;visibilidad;temperatura;sensación;humedad;viento (dirección + km/h);presión
  g.parseSmnEstado = function (text) {
    const out = [];
    String(text || '').split(/\r?\n/).forEach(line => {
      const p = line.split(';');
      if (p.length < 10) return;
      const name = norm(p[0]), st = BYK[name];
      if (!st) return;
      const dm = /^(\d{1,2})-([a-záéíóú]+)-(\d{4})$/i.exec(norm(p[1])), hm = /^(\d{1,2}):(\d{2})$/.exec(norm(p[2]));
      if (!dm || !hm || MONTHS[dm[2].toLowerCase()] == null) return;
      // La hora del archivo es la local argentina (UTC-3)
      const time = Date.UTC(+dm[3], MONTHS[dm[2].toLowerCase()], +dm[1], +hm[1] + 3, +hm[2]);
      const cond = norm(p[3]), low = cond.toLowerCase();
      const wx = [];
      if (/tormenta/.test(low)) wx.push(/a la vista|cercan|lejos/.test(low) ? 'VCTS' : 'TS');
      if (/granizo/.test(low)) wx.push('GR');
      if (/lluvia|chubasco|chaparr/.test(low)) wx.push('RA');
      else if (/llovizna/.test(low)) wx.push('DZ');
      let cover = 0;
      if (/cubierto/.test(low)) cover = 4; else if (/parcialmente/.test(low)) cover = 2; else if (/algo nublado/.test(low)) cover = 1; else if (/nublado/.test(low)) cover = 3;
      const temp = parseFloat(norm(p[5]).replace(',', '.'));
      const wm = /^([A-Za-záéíóú]+)\s+(\d+)/.exec(norm(p[8]));
      const kmh = wm ? +wm[2] : 0;
      out.push({
        id: 'SMN:' + name, src: 'smn', place: st.place, time, raw: line, wx, cb: null, cover, gust: null,
        wdir: wm && DIRS[wm[1].toLowerCase()] != null ? DIRS[wm[1].toLowerCase()] : null,
        wspd: Math.round(kmh * KT * 10) / 10, temp: Number.isFinite(temp) ? temp : null, dew: null, vis: null,
        cavok: /^despejado$/.test(low), cond
      });
    });
    return out;
  };

  // ---- Pronóstico a 5 días ----
  g.parseSmnPron = function (text) {
    const out = {}; let cur = null;
    String(text || '').split(/\r?\n/).forEach(line => {
      const h = /^\s([A-Z0-9_ÁÉÍÓÚÑ().,-]+)\s*$/.exec(line);
      if (h && !/^=+$/.test(h[1])) { cur = h[1]; return; }
      const m = /^\s*(\d{2})\/([A-Z]{3})\/(\d{4})\s+(\d{2})Hs\.\s+(-?[\d.]+)\s+(\d+)\s*\|\s*(\d+)\s+([\d.]+)/.exec(line);
      if (!m || !cur) return;
      const mo = { ENE: 0, FEB: 1, MAR: 2, ABR: 3, MAY: 4, JUN: 5, JUL: 6, AGO: 7, SEP: 8, OCT: 9, NOV: 10, DIC: 11 }[m[2]];
      if (mo == null) return;
      (out[cur] = out[cur] || []).push({ t: Date.UTC(+m[3], mo, +m[1], +m[4] + 3), temp: +m[5], dir: +m[6], kmh: +m[7], mm: +m[8] });
    });
    return out;
  };

  async function getText(url, ms) {
    const ac = new AbortController(), tm = setTimeout(() => ac.abort(), ms);
    try { const r = await fetch(url, { signal: ac.signal }); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.text(); } finally { clearTimeout(tm); }
  }
  const BASE = 'https://ssl.smn.gob.ar/dpd/zipopendata.php?dato=';
  let obsC = null, prC = null;
  g.fetchSmnObs = async function () {
    if (obsC && Date.now() - obsC.t < 10 * 60e3) return obsC.list;
    let list = [];
    try { list = g.parseSmnEstado(await getText(BASE + 'tiepre', 9000)); } catch (e) { list = []; }
    obsC = { t: Date.now() - (list.length ? 0 : 8 * 60e3), list }; // si falló, reintenta pronto
    return list;
  };
  g.fetchSmnPron = async function () {
    if (prC && Date.now() - prC.t < 60 * 60e3) return prC.data;
    let data = {};
    try { data = g.parseSmnPron(await getText(BASE + 'pron5d', 12000)); } catch (e) { data = {}; }
    prC = { t: Date.now() - (Object.keys(data).length ? 0 : 50 * 60e3), data };
    return data;
  };
  g.__resetSmn = () => { obsC = null; prC = null; };

  // Lluvia que prevé el SMN en las próximas 12 horas en la estación más cercana (a menos de 120 km). '' si no hay nada que mostrar.
  g.smnRainLine = function (data, loc, omMm, now) {
    now = now || Date.now();
    let best = null;
    Object.keys(data || {}).forEach(pk => {
      const s = BYP[pk]; if (!s) return;
      const km = dist(loc.lat, loc.lon, s.lat, s.lon);
      if (km <= 120 && (!best || km < best.km)) best = { s, km, rows: data[pk] };
    });
    if (!best) return '';
    const mm = best.rows.filter(r => r.t > now && r.t <= now + 15 * 3600e3).reduce((a, r) => a + r.mm, 0);
    if (mm < 1) return '';
    const txt = (Math.round(mm * 10) / 10).toString().replace('.', ',');
    return '🌧 El Servicio Meteorológico prevé ' + txt + ' milímetros de lluvia en las próximas 12 horas (' + best.s.place + ')' +
      (omMm != null && omMm < 0.5 && mm >= 2 ? '. El pronóstico general no la marca: puede haber diferencias' : '');
  };
  g.__smn = { ST, BYK, BYP };
})(typeof self !== 'undefined' ? self : this);
