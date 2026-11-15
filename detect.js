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
    frost:       { icon: '❄️', label: 'Riesgo de helada', desc: 'Temperatura prevista cercana o inferior a 2 °C' }
  };
  g.RANK = { hail: 3, stormApproach: 2.1, stormStrong: 2, stormWeak: 1 };

  // Qué hacer (se muestra en la tarjeta y en la notificación)
  g.TIPS = {
    wind: 'Buscá un lugar cerrado. Asegurá objetos sueltos y alejate de árboles, carteles y cables. Si vas manejando, agarrá firme el volante y evitá las rutas abiertas.',
    zonda: 'Cerrá puertas y ventanas, no hagas fuego y alejate de árboles y cables. Cuidá a personas con problemas para respirar.',
    stormWeak: 'Manejá despacio y con las luces prendidas. No cruces calles inundadas.',
    stormStrong: 'Buscá refugio en un lugar cerrado y firme, lejos de ventanas y árboles. Si vas manejando, frená en un lugar seguro y no cruces calles inundadas.',
    stormApproach: 'Buscá refugio ya. Si estás en la ruta, cambiá de dirección alejándote de la tormenta o frená en un lugar seguro, lejos de árboles y cables.',
    hail: 'Poné el vehículo bajo techo o refugiate en un lugar cerrado, lejos de ventanas. No te quedes bajo árboles. Si vas manejando, buscá una estación de servicio o un techo firme.',
    quake: 'Agachate, cubrite y agarrate de un mueble firme. Alejate de ventanas. No uses ascensores. Si manejás, frená en un lugar abierto, lejos de puentes y cables.',
    frost: 'Protegé las plantas y cultivos sensibles y revisá el riego antihelada. En la ruta, cuidado con el hielo en el asfalto.'
  };

  // Lenguaje simple para la gente (título corto + qué pasa + qué hacer)
  g.PLAIN = { wind: 'Viento fuerte', zonda: 'Viento Zonda', stormWeak: 'Lluvia o tormenta leve', stormStrong: 'Tormenta fuerte',
    stormApproach: 'Se acerca una tormenta', hail: 'Tormenta fuerte con posible granizo', quake: 'Sismo (temblor)', frost: 'Riesgo de helada' };
  g.humanize = t => String(t == null ? '' : t).replace(/\s*\([^)]*\)/g, '').replace(/km\/h/g, 'kilómetros por hora').replace(/\s*°C/g, ' grados')
    .replace(/~\s*(\d+)\s*min/g, 'unos $1 minutos').replace(/\s+/g, ' ').trim();
  g.plainEvent = function (e) {
    const d = String(e.detail || ''), ahora = /ahora/i.test(d), mm = d.match(/~(\d+) min/), tp = ahora ? 'ahora' : (mm ? 'en unos ' + mm[1] + ' minutos' : '');
    let title = g.PLAIN[e.type] || e.title, say = '', m;
    if (/^unc:/.test(e.key || '')) return { title: e.title, say: e.detail, todo: 'Estate atento. Si empieza a llover o ves rayos, buscá refugio en un lugar cerrado.' };
    if (/^cons:/.test(e.key || '')) return { title: e.title, say: e.detail, todo: e.key === 'cons:ts' ? 'Todavía hay tiempo: organizá lo que tengas al aire libre, poné el vehículo bajo techo y revisá la app más tarde. Te avisamos de nuevo si se acerca.' : 'Llevá abrigo o paraguas y manejá con precaución.' };
    if (/^rad:/.test(e.key || '')) return { title: e.title, say: e.detail, todo: e.type === 'stormStrong' ? g.TIPS.stormStrong : g.TIPS.stormWeak };
    if (/^obs:/.test(e.key || '')) return { title: e.title, say: e.detail, todo: g.TIPS[e.type] || '' };
    if (/^smn:/.test(e.key || '')) return { title: (g.PLAIN[e.type] || e.title) + ' · aviso oficial', say: 'El Servicio Meteorológico Nacional emitió un aviso para tu zona.', todo: g.TIPS[e.type] || '' };
    if (e.type === 'wind') { m = d.match(/(\d+) km\/h/); say = m ? 'Ráfagas de hasta ' + m[1] + ' kilómetros por hora.' : ''; }
    else if (e.type === 'quake') { const mg = String(e.title || '').match(/M(\d+(?:\.\d)?)/); if (mg) title = 'Sismo (temblor) de magnitud ' + mg[1]; m = d.match(/a (\d+) km de/); say = m ? 'Fue a ' + m[1] + ' kilómetros de tu ubicación.' : ''; }
    else if (e.type === 'frost') { m = d.match(/(-?\d+) °C/); const tv = m ? (Number(m[1]) < 0 ? 'menos ' + Math.abs(Number(m[1])) : m[1]) : ''; say = m ? (ahora ? 'Ahora hay ' + tv + ' grados.' : 'Se esperan ' + tv + ' grados ' + tp + '.') : ''; }
    else if (e.type === 'stormApproach') { const a = d.match(/Célula a (\d+) km/), b = d.match(/Paso más cercano en ~(\d+) min/); say = a ? 'Una tormenta está a ' + a[1] + ' kilómetros' + (b ? ' y podría llegar en unos ' + b[1] + ' minutos.' : '.') : 'Una tormenta viene hacia tu zona.'; }
    else if (e.type === 'zonda') say = 'Aviso oficial del Servicio Meteorológico para tu zona.';
    else say = tp === 'ahora' ? 'Hay riesgo ahora en tu zona.' : (tp ? 'Se espera ' + tp + '.' : g.humanize(d));
    return { title: title, say: say, todo: g.TIPS[e.type] || '' };
  };

  g.DEFAULT_CFG = {
    notify: { wind: true, zonda: true, stormWeak: false, stormStrong: true, stormApproach: true, hail: true, quake: true, frost: true },
    escape: true,
    windKmh: 60, quakeMag: 4, quakeKm: 300, repeatMin: 60, sound: true, vibrate: true, alertLeadMin: 60, frostC: 2
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
    if (x.wind_speed_10m != null) p.push('viento local ' + Math.round(x.wind_speed_10m) + ' km/h del ' + g.bearingName(x.wind_direction_10m || 0) + (x.wind_gusts_10m != null ? ', ráfagas ' + Math.round(x.wind_gusts_10m) + ' km/h' : ''));
    return p.length ? ' (' + p.join(', ') + ')' : '';
  };


  const when = minutes => (minutes <= 0 ? 'ahora' : 'en ~' + minutes + ' min');

  // ¿Hay evidencia observada de lluvia/tormenta? radar sobre el punto, lluvia medida (>= 0.2 mm) o evento de aeropuerto.
  g.stormConfirmed = function (c, rn, obsEv) {
    return !!((rn && rn.available && rn.rain) || (c && Number(c.precipitation) >= 0.2) || (obsEv || []).some(e => g.RANK[e.type]));
  };

  // Eventos para un punto: c = current, h = hourly (próximas 6 h), place = nombre del lugar
  g.detectPoint = function (c, h, cfg, place, opt) {
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
    const frostLimit = Number.isFinite(Number(cfg.frostC)) ? Number(cfg.frostC) : 2;
    let frostAt = c.temperature_2m != null && c.temperature_2m <= frostLimit ? 0 : null;
    const frostSeries = (m15.temperature_2m || []).length ? m15.temperature_2m : (h.temperature_2m || []);
    frostSeries.forEach((v, i) => {
      const minutes = (m15.temperature_2m && m15.temperature_2m.length) ? (i + 1) * 15 : i * 60;
      if (v != null && v <= frostLimit && minutes >= 30 && minutes <= lead && (frostAt === null || minutes < frostAt)) frostAt = minutes;
    });
    if (frostAt !== null) ev.push({ type: 'frost', level: frostAt === 0 ? 3 : 2, title: 'Riesgo de helada', place: place,
      detail: 'Temperatura ' + (frostAt === 0 ? 'actual' : 'prevista en ~' + frostAt + ' min') + ' de ' + Math.round(frostAt === 0 ? c.temperature_2m : frostSeries[(m15.temperature_2m && m15.temperature_2m.length) ? Math.max(0, Math.round(frostAt / 15) - 1) : frostAt / 60]) + ' °C. Umbral de aviso: ' + frostLimit + ' °C.' });

    const txt = { hail: 'Tormenta severa con posible granizo ', stormStrong: 'Tormenta fuerte con lluvia intensa y rayos ', stormWeak: 'Lluvia o tormenta débil ' };
    // Sin confirmación (radar, lluvia medida o aeropuerto) una tormenta "ahora" solo puede ser un aviso suave:
    // nubes cargadas según modelo/satélite, pero sin lluvia detectada. No suena, no vibra y no activa ruta de escape.
    const unconfirmed = !!(opt && opt.confirmed === false);
    let soft = false;
    Object.keys(first).forEach(k => {
      if (unconfirmed && first[k] === 0) { soft = true; return; }
      ev.push({
        type: k, level: g.RANK[k], title: g.TYPES[k].label, place: place,
        detail: txt[k] + when(first[k]) + (first[k] === 0 ? g.stormWhy(c) : '') + '.'
      });
    });
    if (soft) ev.push({ type: 'stormWeak', level: 1, key: 'unc:now', title: 'Nubes de tormenta, sin lluvia confirmada', place: place,
      detail: 'El satélite o el modelo ven nubes cargadas cerca, pero el radar no detecta lluvia sobre tu ubicación.' });


    let gust = c.wind_gusts_10m || 0;
    const gustSeries=(m15.wind_gusts_10m||[]).length?m15.wind_gusts_10m:(h.wind_gusts_10m||[]);
    gustSeries.forEach((v,i)=>{const minutes=(m15.wind_gusts_10m||[]).length?(i+1)*15:i*60;if(minutes<=lead&&v>gust)gust=v;});
    if (gust >= cfg.windKmh) {
      const level = gust >= cfg.windKmh + 40 ? 3 : gust >= cfg.windKmh + 20 ? 2 : 1;
      ev.push({ type: 'wind', level, title: 'Viento fuerte', place: place, detail: 'Ráfagas de hasta ' + Math.round(gust) + ' km/h dentro de la anticipación seleccionada.' });
    }
    // Zonda nunca se infiere solo por viento del oeste, calor o baja humedad.
    // Se agrega únicamente cuando un aviso oficial del SMN cubre este punto.
    return ev;
  };

  // ---- Clima con varias fuentes (todas se piden directo desde el celular, sin servidor propio) ----
  // Orden: Open-Meteo -> MET Norway -> wttr.in -> (opcional) servidor propio si g.WEATHER_API está definido.
  // Si una alcanza su límite o falla, se pasa a la siguiente y se la deja "en pausa" un rato.
  // Devuelve un array [{current, hourly}] en formato Open-Meteo.
  const CUR_FULL = 'temperature_2m,relative_humidity_2m,precipitation,weather_code,cloud_cover,is_day,wind_speed_10m,wind_direction_10m,wind_gusts_10m,cape,lifted_index';
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
        if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') throw new Error('lectura de imagen GOES no disponible');
        const bmp = await createImageBitmap(await r.blob());
        const cv = new OffscreenCanvas(bmp.width, bmp.height), cx = cv.getContext('2d', { willReadFrequently: true });
        cx.drawImage(bmp, 0, 0);
        return { data: cx.getImageData(0, 0, bmp.width, bmp.height).data, width: bmp.width, height: bmp.height };
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
  g.fetchRadarTimeline = async function () {
    const j = await getJ('https://api.rainviewer.com/public/weather-maps.json', 10000);
    const past = j && j.radar && j.radar.past;
    if (!Array.isArray(past) || past.length < 4) throw new Error('RainViewer no entregó cuatro imágenes históricas utilizables.');
    return { host: j.host || 'https://tilecache.rainviewer.com', frames: past.slice(-5) };
  };
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
        if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') throw new Error('lectura de imagen no disponible');
        const bmp = await createImageBitmap(blob);
        const cv = new OffscreenCanvas(bmp.width, bmp.height), cx = cv.getContext('2d', { willReadFrequently: true });
        cx.drawImage(bmp, 0, 0);
        return { data: cx.getImageData(0, 0, bmp.width, bmp.height).data, width: bmp.width, height: bmp.height };
      } finally { clearTimeout(timer); }
    })().catch(e => { radarTileCache.delete(url); throw e; });
    radarTileCache.set(url, promise);
    while (radarTileCache.size > 90) radarTileCache.delete(radarTileCache.keys().next().value);
    return promise;
  }
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
          const image = await radarBitmap(url), comps = radarEchoComponents(image, +loc.lat);
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
  g.officialAlertsStats = { total: 0, parsed: 0, withoutGeometry: 0, failed: 0 };
  const ENT = { aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', ntilde: 'ñ', Ntilde: 'Ñ',
    uuml: 'ü', Uuml: 'Ü', nbsp: ' ', ordm: 'º', ordf: 'ª', deg: '°', iexcl: '¡', iquest: '¿', quot: '"', apos: "'", lt: '<', gt: '>', amp: '&' };
  const cp = n => (n > 0 && n <= 0x10FFFF) ? String.fromCodePoint(n) : '';
  // Texto con doble codificación ("Ã¡" en vez de "á"): se repara si es posible.
  const fixMoji = s => String(s).replace(/[\u00C2-\u00F4][\u0080-\u00BF]{1,3}/g, m => {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(m, c => c.charCodeAt(0))); } catch (e) { return m; }
  });
  const xmlText = (s) => fixMoji(String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (m, h) => cp(parseInt(h, 16))).replace(/&#(\d+);/g, (m, d) => cp(+d))
    .replace(/&([a-zA-Z]+);/g, (m, n) => ENT[n] !== undefined ? ENT[n] : m)
    .replace(/<[^>]+>/g, ' ').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\uFFFD]/g, '').replace(/\s+/g, ' ').trim());
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
  /* Fuentes públicas del SMN: el RSS registrado en la OMM, el RSS de alertas y la carpeta de avisos a corto plazo.
     Alcanza con que una responda. Los archivos CAP traen la fecha en el nombre: se leen primero los más nuevos. */
  const CAP_SOURCES = [CAP_FEED, 'https://ssl.smn.gob.ar/feeds/CAP/rss_alertaCAP_nuevo.xml', 'https://ssl.smn.gob.ar/feeds/CAP/avisocortoplazo/'];
  const capStamp = u => {
    const m = String(u).match(/(20\d{2})_?(\d{2})_?(\d{2})_?(\d{2})_?(\d{2})/);
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) + 3 * 3600e3 : 0;
  };
  function capLinks(body, base) {
    const out = new Map();
    const re = /(?:https?:\/\/[^\s"'<>\]\)]+|[A-Za-z0-9_\-.\/]+)\.xml(?:\?[^\s"'<>\]\)]*)?/gi;
    let m;
    while ((m = re.exec(body))) {
      let h = m[0].replace(/&amp;/g, '&');
      let abs; try { abs = new URL(h, base).href; } catch (e) { continue; }
      if (!/\/cap/i.test(abs) && !/cap_|_cap/i.test(abs)) continue;
      if (/rss|\.xsl/i.test(abs.split('/').pop())) continue;
      if (abs === base) continue;
      out.set(abs, true);
    }
    return [...out.keys()];
  }
  /* El SMN limita los pedidos (error 429): se piden pocos y despacio, y lo ya leído se guarda en el celular
     (cada archivo CAP no cambia: si hay una actualización, sale con otro nombre). */
  const capSleep = ms => new Promise(r => setTimeout(r, ms));
  const CAP_LS = 'capStore2', CAP_BACKOFF = 'capBackoff2';
  const capLoad = () => { try { return JSON.parse(localStorage.getItem(CAP_LS) || '{}') || {}; } catch (e) { return {}; } };
  const capSave = o => { try { localStorage.setItem(CAP_LS, JSON.stringify(o)); } catch (e) { try { localStorage.removeItem(CAP_LS); } catch (x) { } } };
  async function loadCapItems() {
    if (Date.now() - capCache.at < 10 * 60000 && capCache.items) return capCache.items;
    if (capPromise) return capPromise;
    capPromise = (async () => {
      const now = Date.now();
      const diag = { sources: [], links: 0, read: 0, expired: 0, failed: 0, cancelled: 0, limited: 0, cached: 0 };
      const store = capLoad();
      let backoff = 0; try { backoff = Number(localStorage.getItem(CAP_BACKOFF)) || 0; } catch (e) { }
      const links = new Map();
      if (now >= backoff) {
        for (const src of CAP_SOURCES) {
          const d = { url: src, ok: false, status: 0, links: 0 }; diag.sources.push(d);
          try {
            const r = await capFetch(src, 8000); d.status = r.status;
            if (r.status === 429 || r.status === 503) { diag.limited++; try { localStorage.setItem(CAP_BACKOFF, String(Date.now() + 3 * 60000)); } catch (e) { } break; }
            if (!r.ok) { d.error = (r.headers.get('x-proxy-error') || '').slice(0, 50); continue; }
            const body = await r.text(); d.ok = true;
            if (/<(?:[\w.-]+:)?alert[\s>]/i.test(body) && /<(?:[\w.-]+:)?info[\s>]/i.test(body)) { links.set(src, true); d.links++; }
            capLinks(body, src).forEach(u => { if (!links.has(u)) d.links++; links.set(u, true); });
            if (links.size) break;            // con una fuente que responda alcanza: así se hacen menos pedidos
          } catch (e) { d.error = String((e && e.message) || e).slice(0, 60); }
          await capSleep(400);
        }
      } else { diag.limited++; diag.waiting = true; }
      diag.links = links.size;
      const cutoff = now - 4 * 864e5;
      const cand = [...links.keys()].map(u => ({ url: u, st: capStamp(u) })).filter(x => !x.st || x.st > cutoff).sort((a, b) => b.st - a.st).slice(0, 40);
      const items = [], need = [];
      cand.forEach(x => {
        const c = store[x.url];
        if (c && c.skip) { diag.expired++; return; }
        if (c && c.item) { if (c.item.expires && c.item.expires < now) { store[x.url] = { skip: 1, t: now }; diag.expired++; } else { items.push(c.item); diag.cached++; } return; }
        need.push(x);
      });
      if (!links.size) {   // sin red o limitado: se usa lo guardado que siga vigente
        Object.keys(store).forEach(u => { const c = store[u]; if (c && c.item && (!c.item.expires || c.item.expires > now)) { items.push(c.item); diag.cached++; } });
      }
      const toGet = need.slice(0, 25);
      let cursor = 0, stop = false;
      const worker = async () => {
        while (!stop && cursor < toGet.length) {
          const x = toGet[cursor++];
          try {
            const q = await capFetch(x.url, 7000);
            if (q.status === 429 || q.status === 503) { diag.limited++; stop = true; try { localStorage.setItem(CAP_BACKOFF, String(Date.now() + 3 * 60000)); } catch (e) { } return; }
            if (!q.ok) throw new Error('CAP ' + q.status);
            const xml = await q.text();
            if (/<(?:[\w.-]+:)?msgType>\s*Cancel/i.test(xml)) { diag.cancelled++; store[x.url] = { skip: 1, t: now }; continue; }
            if (/<(?:[\w.-]+:)?status>\s*(Test|Exercise)/i.test(xml)) { store[x.url] = { skip: 1, t: now }; continue; }
            const event = capTags(xml, 'event')[0] || '';
            const headline = capTags(xml, 'headline')[0] || event;
            const desc = capTags(xml, 'description')[0] || '';
            const area = capTags(xml, 'areaDesc').join(' · ');
            const expires = Date.parse(capTags(xml, 'expires')[0] || '') || 0;
            if (expires && expires < now) { diag.expired++; store[x.url] = { skip: 1, t: now }; continue; }
            if (!expires && x.st && x.st < now - 36 * 3600e3) { diag.expired++; store[x.url] = { skip: 1, t: now }; continue; }
            const hasGeometry = capTags(xml, 'polygon').length > 0 || capTags(xml, 'circle').length > 0;
            // Se conserva el aviso sin geometría para el listado nacional; nunca se asigna a una localidad
            // ni se dibuja en el mapa si no se puede comprobar su cobertura.
            const item = { xml, event, headline, desc, area, expires, url: x.url, hasGeometry, severity: capTags(xml, 'severity')[0] || '',
              instruction: capTags(xml, 'instruction')[0] || '', onset: Date.parse(capTags(xml, 'onset')[0] || capTags(xml, 'effective')[0] || '') || null };
            items.push(item); store[x.url] = { item, t: now };
          } catch (e) { diag.failed++; }
          await capSleep(300);
        }
      };
      await Promise.all([worker(), worker()]);
      // limpieza: se descartan entradas de más de 6 días
      Object.keys(store).forEach(u => { if (!store[u] || now - (store[u].t || 0) > 6 * 864e5) delete store[u]; });
      capSave(store);
      diag.read = items.length;
      const withoutGeometry = items.filter(a => !a.hasGeometry).length;
      g.officialAlertsDiag = diag;
      g.officialAlertsStats = { total: cand.length, parsed: items.length, withoutGeometry, failed: diag.failed };
      if (!diag.sources.some(x => x.ok) && !items.length && !diag.waiting && !diag.limited) { g.officialAlertsStatus = 'fuente SMN no disponible'; throw new Error('SMN sin respuesta'); }
      capCache = { at: diag.limited ? now - 8 * 60000 : now, items };
      g.officialAlertsStatus = diag.limited ? 'SMN limitó los pedidos · se reintenta en unos minutos' : (diag.failed || withoutGeometry ? 'SMN conectado · revisión parcial (' + items.length + ' avisos leídos; ' + withoutGeometry + ' sin cobertura geográfica verificable)' : 'SMN conectado · avisos revisados');
      return items;
    })().finally(() => { capPromise = null; });
    return capPromise;
  }
  // Resumen nacional de avisos SMN vigentes. coverageVerified=false significa que no se
  // pudo comprobar el alcance geográfico; nunca se usa para disparar una alerta local.
  g.fetchOfficialAlertsNational = async function () {
    const items = await loadCapItems();
    return items.map(a => ({
      title: a.headline || a.event || 'Aviso meteorológico',
      event: a.event || '', area: a.area || 'Área indicada por SMN',
      description: a.desc || '', severity: a.severity || '',
      expires: a.expires || null, source: a.url, coverageVerified: !!a.hasGeometry
    }));
  };
  // Avisos SMN con su geometría (polígonos/círculos) para dibujarlos en el mapa y listarlos.
  const mapAlert = a => {
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
        onset: a.onset || null, expires: a.expires || null, url: a.url, polys, circles, hasGeometry: !!a.hasGeometry
      };
  };
  /* Solo avisos con zona dibujable (capa del mapa). */
  g.fetchOfficialAlertGeometry = async function () { return (await loadCapItems()).filter(a => a.hasGeometry).map(mapAlert); };
  /* Todos los avisos vigentes del SMN, tengan o no zona dibujable (listado de la pestaña SMN). */
  g.fetchOfficialAlertList = async function () { return (await loadCapItems()).map(mapAlert); };
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
  /* ---- Observaciones reales: METAR de aeropuertos (NOAA Aviation Weather Center). Miden lo que pasa, no lo que predice un modelo. ---- */
  const METAR_IDS = 'SAME,SAMR,SAMM,SANU,SAOU,SANL,SAZN,SACO,SAAR,SAEZ,SABE,SCEL,SANT,SASA,SAZR';
  let metarCache = { at: 0, data: null };
  g.fetchMetars = async function () {
    if (metarCache.data && Date.now() - metarCache.at < 4 * 60e3) return metarCache.data;
    const c = new AbortController(), t = setTimeout(() => c.abort(), 8000);
    try {
      const r = await fetch('https://aviationweather.gov/api/data/metar?ids=' + METAR_IDS + '&format=json&hours=3', { signal: c.signal });
      if (!r.ok) throw new Error('METAR ' + r.status);
      const tx = await r.text(), j = tx ? JSON.parse(tx) : [], by = {};
      (Array.isArray(j) ? j : []).forEach(m => { if (m && m.icaoId && (!by[m.icaoId] || m.obsTime > by[m.icaoId].obsTime)) by[m.icaoId] = m; });
      metarCache = { at: Date.now(), data: Object.values(by) };
      return metarCache.data;
    } finally { clearTimeout(t); }
  };
  const dkm = (a, b, c, d) => { const R = Math.PI / 180, x = Math.sin((c - a) * R / 2) ** 2 + Math.cos(a * R) * Math.cos(c * R) * Math.sin((d - b) * R / 2) ** 2; return 12742 * Math.asin(Math.sqrt(x)); };
  g.nearestMetar = function (list, lat, lon, maxKm) {
    let best = null;
    (list || []).forEach(m => {
      if (m.lat == null || m.lon == null) return;
      const km = dkm(lat, lon, m.lat, m.lon), age = (Date.now() / 1000 - m.obsTime) / 60;
      if (age > 110 || km > (maxKm || 60)) return;
      if (!best || km < best.km) best = { m: m, km: Math.round(km), age: Math.max(0, Math.round(age)) };
    });
    return best;
  };
  const wxEs = tok => {
    const heavy = tok[0] === '+' ? 'fuerte ' : tok[0] === '-' ? 'débil ' : '', t = tok.replace(/^[+-]/, '').replace(/^VC/, ''), out = [];
    if (/TS/.test(t)) out.push('tormenta eléctrica'); if (/GR|GS/.test(t)) out.push('granizo');
    if (/SH/.test(t) && /RA/.test(t)) out.push('chubascos de lluvia'); else if (/RA/.test(t)) out.push('lluvia'); else if (/SH/.test(t)) out.push('chubascos');
    if (/DZ/.test(t)) out.push('llovizna'); if (/SN/.test(t)) out.push('nieve'); if (/FG/.test(t)) out.push('niebla'); if (/BR/.test(t)) out.push('neblina');
    if (/DU|SA|DS|SS/.test(t)) out.push('polvo en suspensión'); if (/SQ/.test(t)) out.push('ráfagas fuertes'); if (/FC/.test(t)) out.push('embudo (posible tornado)');
    return out.length ? heavy + out.join(' con ') : '';
  };
  const metarName = m => String(m.name || m.icaoId).split(',')[0].trim();
  g.metarSummary = function (o) {   // dato crudo para la tarjeta (solo si hay un fenómeno significativo)
    if (!o) return null;
    const toks = String(o.m.wxString || '').split(/\s+/).filter(Boolean).filter(t => !/^VC/.test(t)), txt = toks.map(wxEs).filter(Boolean)[0];
    if (!txt) return null;
    const j = toks.join(' '), ts = /TS/.test(j), rain = /RA|SH|DZ|SN|GR|GS/.test(j);
    return { icao: o.m.icaoId, t: o.m.obsTime, km: o.km, name: metarName(o.m), wx: String(o.m.wxString || ''),
      icon: ts ? '⛈️' : rain ? '🌧️' : /FG|BR/.test(j) ? '🌫️' : '🌬️', text: txt.charAt(0).toUpperCase() + txt.slice(1), rain: rain || ts };
  };
  // Vigencia: hasta 20 min es "ahora"; hasta 60 min se muestra como "hace X min"; después ya no se muestra.
  g.metarLive = function (s) {
    if (!s) return null;
    const age = Math.max(0, Math.round((Date.now() / 1000 - s.t) / 60));
    if (age > 60) return null;
    const phase = age <= 20 ? 'ahora' : 'reciente';
    return Object.assign({}, s, { age: age, phase: phase, src: (phase === 'ahora' ? 'Ahora' : 'Hace ' + age + ' min') + ' en el aeropuerto ' + s.name + ' (a ' + s.km + ' km)' });
  };
  g.metarEvents = function (o, place) {
    if (!o || o.age > 25) return [];   // una medición vieja ya no es una alerta
    const m = o.m, toks = String(m.wxString || '').split(/\s+/).filter(Boolean), raw = String(m.rawOb || ''), all = toks.join(' '), icao = m.icaoId, out = [];
    const near = o.km <= 15, lv = n => near ? n : Math.min(n, 2), loc = o.km <= 8 ? 'en tu zona' : 'cerca (a ' + o.km + ' km)';
    const where = 'El aeropuerto ' + metarName(m) + ', a ' + o.km + ' km, informó hace ' + o.age + ' min: ';
    const tsHere = toks.some(t => /TS/.test(t) && !/^VC/.test(t)), tsNear = toks.some(t => /^VCTS/.test(t)), hail = /GR|GS/.test(all);
    const ev = (type, level, title, key, detail) => out.push({ type: type, level: level, title: title, place: place, key: 'obs:' + icao + ':' + key, detail: detail });
    if (tsHere && o.km <= 45) ev(hail ? 'hail' : 'stormStrong', lv(3), (hail ? 'Tormenta con granizo ' : 'Tormenta eléctrica ') + loc, 'ts', where + toks.map(wxEs).filter(Boolean).join(', ') + '. Puede no estar pasando exactamente donde estás.');
    else if (tsNear && o.km <= 45) ev('stormStrong', 2, 'Tormenta eléctrica cerca (a ' + o.km + ' km)', 'vcts', where + 'tormenta eléctrica a pocos kilómetros del aeropuerto.');
    else if (/\bLTG/.test(raw) && o.km <= 60) ev('stormApproach', 2, 'Se ven rayos cerca (a ' + o.km + ' km)', 'ltg', where + 'se ven rayos en la zona.');
    else if (/(CB|TCU)\b/.test(raw.replace(/RMK.*/, '')) && o.km <= 60) ev('stormApproach', 1, 'Nubes de tormenta cerca (a ' + o.km + ' km)', 'cb', where + 'hay nubes de tormenta en la zona.');
    if (!tsHere && !tsNear && toks.some(t => /(RA|SH|DZ)/.test(t) && !/^VC/.test(t)) && o.km <= 30) ev('stormWeak', 1, 'Lluvia ' + loc, 'ra', where + toks.map(wxEs).filter(Boolean).join(', ') + '.');
    if (/\bSQ\b/.test(all) && o.km <= 45) ev('wind', 2, 'Ráfagas fuertes ' + loc, 'sq', where + 'ráfagas fuertes (turbonada).');
    return out;
  };

  g.metarStatus = function (o) {   // línea de transparencia: qué dijo el aeropuerto aunque no haya fenómeno
    if (!o) return 'sin aeropuertos cercanos con datos recientes';
    const toks = String(o.m.wxString || '').split(/\s+/).filter(Boolean), txt = toks.map(wxEs).filter(Boolean).join(', ');
    return 'Aeropuerto ' + metarName(o.m) + ' (a ' + o.km + ' km, hace ' + o.age + ' min): ' + (txt || 'sin lluvia ni tormenta');
  };

  /* ---- Radar ahora: ¿hay eco de lluvia justo sobre el punto? (solo confirma presencia; la ausencia puede ser falta de cobertura) ---- */
  g.radarNowAt = async function (loc, frames, host) {
    const f = (frames || []).filter(x => x && x.path && Number.isFinite(+x.time)).slice(-1)[0];
    if (!f || !loc) return null;
    const ageMin = Math.round((Date.now() / 1000 - f.time) / 60);
    if (ageMin > 35) return { available: false, ageMin: ageMin };
    const url = (host || 'https://tilecache.rainviewer.com').replace(/\/$/, '') + f.path + '/' + RADAR_SIZE + '/' + RADAR_Z + '/' + (+loc.lat).toFixed(4) + '/' + (+loc.lon).toFixed(4) + '/2/1_1.png';
    const img = await radarBitmap(url), c = img.width / 2, R = Math.max(2, Math.round(3 / radarPixelKm(+loc.lat)));
    let hits = 0, warm = 0;
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      if (dx * dx + dy * dy > R * R) continue;
      const o = (Math.round(c + dy) * img.width + Math.round(c + dx)) * 4, r = img.data[o], gg = img.data[o + 1], b = img.data[o + 2], a = img.data[o + 3];
      if (a < 78) continue;
      const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), sat = mx ? (mx - mn) / mx : 0;
      if (sat < 0.22 && !(a > 235 && mn > 190)) continue;
      hits++; if (r > 190 && b < 150) warm++;
    }
    return { available: true, rain: hits >= 3, level: hits >= 3 ? (warm >= 3 ? 3 : 1) : 0, ageMin: ageMin };
  };
  g.radarNowEvents = function (rn, place) {
    if (!rn || !rn.rain) return [];
    const strong = rn.level >= 3;
    return [{ type: strong ? 'stormStrong' : 'stormWeak', level: strong ? 2 : 1, title: strong ? 'Lluvia intensa en tu zona (radar)' : 'Lluvia en tu zona (radar)', place: place, key: 'rad:rain',
      detail: 'El radar muestra lluvia justo sobre tu ubicación (imagen de hace ' + rn.ageMin + ' min).' }];
  };

  /* ---- Consenso de varios modelos (ECMWF, GFS, ICON, GEM): anticipa lluvia y tormentas solo si coinciden al menos 2 ---- */
  const CONS_MODELS = ['ecmwf_ifs025', 'gfs_seamless', 'icon_seamless', 'gem_seamless'];
  g.fetchConsensus = async function (lat, lon) {
    const key = 'cmCons:' + (+lat).toFixed(2) + ',' + (+lon).toFixed(2);
    try { const c = JSON.parse(localStorage.getItem(key) || 'null'); if (c && Date.now() - c.at < 45 * 60e3) return c.data; } catch (e) { }
    const ac = new AbortController(), t = setTimeout(() => ac.abort(), 12000);
    try {
      const r = await fetch('https://api.open-meteo.com/v1/forecast?latitude=' + (+lat).toFixed(3) + '&longitude=' + (+lon).toFixed(3) + '&hourly=precipitation,weather_code&models=' + CONS_MODELS.join(',') + '&timeformat=unixtime&timezone=UTC&forecast_days=2', { signal: ac.signal });
      if (!r.ok) throw new Error('modelos ' + r.status);
      const j = await r.json(), h = j.hourly || {}, models = [];
      CONS_MODELS.forEach(m => { const p = h['precipitation_' + m], c = h['weather_code_' + m]; if (Array.isArray(p) && p.some(v => v != null)) models.push({ m: m, p: p, c: Array.isArray(c) ? c : [] }); });
      const data = { time: h.time || [], models: models };
      try { localStorage.setItem(key, JSON.stringify({ at: Date.now(), data: data })); } catch (e) { }
      return data;
    } finally { clearTimeout(t); }
  };
  g.consensusEvents = function (c, place, leadH) {
    if (!c || !c.models || c.models.length < 2) return [];
    const now = Date.now() / 1000, i0 = c.time.findIndex(t => t >= now - 1800), N = c.models.length, out = [];
    if (i0 < 0) return [];
    let ts = null, rain = null;
    for (let i = i0; i < Math.min(c.time.length, i0 + (leadH || 6) + 1); i++) {
      const th = c.models.filter(m => [95, 96, 99].includes(m.c[i])).length, ra = c.models.filter(m => (m.p[i] || 0) >= 0.5).length;
      if (!ts && th >= 2) ts = { i: i, k: th }; if (!rain && ra >= 2) rain = { i: i, k: ra };
    }
    const when = x => { const hrs = Math.max(0, Math.round((c.time[x.i] - now) / 3600)); return (hrs <= 0 ? 'ahora' : 'en ~' + hrs + ' h') + ' (hacia las ' + new Date(c.time[x.i] * 1000).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) + ')'; };
    if (ts) out.push({ type: 'stormApproach', level: 2, title: 'Posible tormenta eléctrica ' + when(ts), place: place, key: 'cons:ts', detail: ts.k + ' de ' + N + ' modelos coinciden en tormenta eléctrica. Es un pronóstico, no una medición.' });
    else if (rain) out.push({ type: 'stormWeak', level: 1, title: 'Lluvia probable ' + when(rain), place: place, key: 'cons:rain', detail: rain.k + ' de ' + N + ' modelos coinciden en lluvia. Es un pronóstico, no una medición.' });
    return out;
  };

  g.evKey = e => (e.type === 'quake' ? 'quake' + e.key : e.type + (e.place ? '@' + e.place : ''));

  g.shouldNotify = function (map, e, cfg, now) {
    if (!cfg.notify[e.type]) return false;
    if (/^unc:/.test(e.key || '')) return false;
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
    const t = g.TYPES[e.type], q = g.plainEvent(e);
    return {
      title: t.icon + ' ' + q.title + (e.place ? ' · ' + e.place : ''),
      opts: {
        body: q.say + '\n👉 ' + q.todo,
        tag: g.evKey(e), renotify: true, icon: 'icon-192.png', badge: 'icon-192.png',
        vibrate: cfg.vibrate ? [300, 150, 300, 150, 400] : [],
        requireInteraction: e.level >= 2,
        actions: [{ action: 'call', title: '📞 Llamar 911' }, { action: 'open', title: 'Qué hacer' }],
        data: { type: e.type }
      }
    };
  };
})(typeof self !== 'undefined' ? self : this);
