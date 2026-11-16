/* TiempoMDZ 1.13 · Clima por horas (próximas 24 h) del lugar que se está mirando.
   Se abre desde el botón "Por horas" de la tarjeta del clima del mapa. */
(function (root) {
  'use strict';
  const URL_ = lat => 'https://api.open-meteo.com/v1/forecast?latitude=' + lat.lat.toFixed(3) + '&longitude=' + lat.lon.toFixed(3) +
    '&hourly=temperature_2m,weather_code,precipitation,precipitation_probability,wind_speed_10m,wind_direction_10m,wind_gusts_10m,cloud_cover' +
    '&forecast_hours=25&timezone=auto&wind_speed_unit=kmh';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const DOW = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
  const arrow = deg => '<svg viewBox="0 0 24 24" width="16" height="16" style="transform:rotate(' + deg + 'deg);vertical-align:-3px"><path d="M12 2 6 20l6-4 6 4z" fill="#9fd6ff"/></svg>';
  const R = v => v == null ? '–' : Math.round(v);

  // Resume una hora: texto + nivel de atención (0 normal, 1 atención, 2 peligro)
  function judge(h, cfg) {
    const windKmh = (cfg && cfg.windKmh) || 60, frostC = (cfg && Number.isFinite(+cfg.frostC)) ? +cfg.frostC : 2;
    const tags = []; let lvl = 0;
    const k = typeof root.stormClass === 'function' ? root.stormClass(h.code, h.pr || 0, {}) : null;
    if (k === 'hail') { tags.push('⛈ Tormenta severa'); lvl = 2; }
    else if (k === 'stormStrong') { tags.push('⛈ Tormenta'); lvl = 2; }
    if (h.gust != null && h.gust >= windKmh) { tags.push('💨 Ráfagas ' + R(h.gust)); lvl = Math.max(lvl, h.gust >= windKmh + 20 ? 2 : 1); }
    if (h.t != null && h.t <= frostC) { tags.push('🥶 Helada'); lvl = Math.max(lvl, 1); }
    return { tags, lvl };
  }
  function parse(j) {
    const h = j && j.hourly; if (!h || !h.time || !h.time.length) throw new Error('El pronóstico llegó vacío.');
    return h.time.map((t, i) => ({
      time: t, t: h.temperature_2m[i], code: h.weather_code[i], pr: h.precipitation[i], prob: h.precipitation_probability ? h.precipitation_probability[i] : null,
      wind: h.wind_speed_10m[i], dir: h.wind_direction_10m[i], gust: h.wind_gusts_10m[i], cloud: h.cloud_cover[i]
    }));
  }
  root.HoursWx = { parse, judge };

  if (typeof document === 'undefined' || !root.__mx || !root.__mx.sheet) return;
  const M = root.__mx, sheet = M.sheet.mk('hours', '🕒 Clima por horas');
  const body = sheet.querySelector('.mx-body');
  let token = 0;
  function render(rows, place) {
    const conf = (typeof cfg !== 'undefined') ? cfg : null;
    let day = '', h = '<div class="hr-place">📍 ' + esc(place) + '</div>';
    rows.slice(0, 24).forEach((r, i) => {
      const d = new Date(r.time), dk = d.getDate() + '/' + d.getMonth();
      if (dk !== day) { day = dk; h += '<div class="hr-day">' + (i === 0 ? 'Hoy' : DOW[d.getDay()] + ' ' + d.getDate() + '/' + (d.getMonth() + 1)) + '</div>'; }
      const w = M.wxText(r.code), j = judge(r, conf), hh = String(d.getHours()).padStart(2, '0') + ':00';
      h += '<div class="hr-row l' + j.lvl + '"><span class="hr-t">' + (i === 0 ? 'Ahora' : hh) + '</span><span class="hr-i" title="' + esc(w[1]) + '">' + w[0] + '</span>' +
        '<span class="hr-d"><b>' + R(r.t) + '°</b></span>' +
        '<span class="hr-r">' + (r.pr >= 0.1 ? '🌧 ' + (r.pr < 10 ? r.pr.toFixed(1) : R(r.pr)) + ' mm' : (r.prob != null && r.prob >= 30 ? '☔ ' + R(r.prob) + '%' : '')) + '</span>' +
        '<span class="hr-w">' + (r.dir != null ? arrow((r.dir + 180) % 360) : '') + ' ' + R(r.wind) + '</span></div>' +
        (j.tags.length ? '<div class="hr-tag l' + j.lvl + '">' + esc(j.tags.join(' · ')) + '</div>' : '');
    });
    h += '<p class="hr-note">Pronóstico de modelo para el lugar elegido. Viento en km/h a 10 m (la flecha indica hacia dónde va). Temperatura y lluvia por hora. Los avisos son orientativos.</p>';
    body.innerHTML = h;
  }
  async function open() {
    const my = ++token; let p = null; try { p = cur(); } catch (e) { }
    M.sheet.open('hours');
    if (!p || p.lat == null) { body.innerHTML = '<div class="mx-empty">Todavía no tengo tu ubicación. Activá el GPS o elegí un lugar.</div>'; return; }
    body.innerHTML = '<div class="mx-empty">⏳ Buscando el pronóstico por horas…</div>';
    try {
      const c = new AbortController(), t = setTimeout(() => c.abort(), 12000);
      let j; try { const r = await fetch(URL_({ lat: +p.lat, lon: +p.lon }), { signal: c.signal }); if (!r.ok) throw new Error('HTTP ' + r.status); j = await r.json(); } finally { clearTimeout(t); }
      if (my !== token) return;
      render(parse(j), p.name || 'Tu ubicación');
    } catch (e) {
      if (my !== token) return;
      body.innerHTML = '<div class="mx-empty">No pude traer el pronóstico por horas ahora (' + esc((e && e.name === 'AbortError') ? 'tardó demasiado' : (e && e.message) || 'error') + '). Probá de nuevo en un rato.</div>';
    }
  }
  root.__hours = { open };
})(typeof window !== 'undefined' ? window : globalThis);
