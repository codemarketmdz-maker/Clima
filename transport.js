/* TiempoMDZ 1.13 · Modo transporte: clima y avisos a lo largo de la ruta, a la hora en que vas a pasar,
   con aviso por voz. Usa OSRM (ruta), Open-Meteo (pronóstico) y los avisos SMN que ya trae la app. */
(function (g) {
  'use strict';
  const D2R = Math.PI / 180, AB = g.AndroidBridge;
  const COL = ['#3ddc97', '#ffd23f', '#ff9020', '#ff4d5e'];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const hav = (a, b, c, d) => { const dl = (c - a) * D2R, dn = (d - b) * D2R, x = Math.sin(dl / 2) ** 2 + Math.cos(a * D2R) * Math.cos(c * D2R) * Math.sin(dn / 2) ** 2; return 12742 * Math.asin(Math.sqrt(x)); };
  const brg = (a, b, c, d) => { const y = Math.sin((d - b) * D2R) * Math.cos(c * D2R), x = Math.cos(a * D2R) * Math.sin(c * D2R) - Math.sin(a * D2R) * Math.cos(c * D2R) * Math.cos((d - b) * D2R); return (Math.atan2(y, x) / D2R + 360) % 360; };
  const hhmm = ms => new Date(ms).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
  const S = { empty: true, speed: 70, depH: 0, coords: [], cum: [], samples: [], total: 0, layer: null, driving: false, last: 0, kmNow: 0, watch: null, refT: 0, root: null, closeFn: null };

  function say(t) { try { if (AB && AB.voiceOn && !AB.voiceOn()) return; if (AB && AB.speak) AB.speak(t); else if (g.speechSynthesis) { const u = new SpeechSynthesisUtterance(t); u.lang = 'es-AR'; g.speechSynthesis.speak(u); } } catch (e) { } }
  async function jget(url, ms) { const c = new AbortController(), t = setTimeout(() => c.abort(), ms || 12000); try { const r = await fetch(url, { signal: c.signal }); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); } finally { clearTimeout(t); } }
  const $ = id => document.getElementById(id);

  /* ---------- lugares ---------- */
  async function geocode(q) {
    const j = await jget('https://geocoding-api.open-meteo.com/v1/search?count=5&language=es&name=' + encodeURIComponent(q), 8000);
    return (j.results || []).map(r => ({ lat: r.latitude, lon: r.longitude, name: [r.name, r.admin1, r.country].filter(Boolean).join(', ') }));
  }
  function getPos() {
    return new Promise((ok, no) => {
      const fb = () => { try { if (typeof pos !== 'undefined' && pos && pos.lat != null) return ok({ lat: pos.lat, lon: pos.lon, name: 'Mi ubicación' }); } catch (e) { } no(new Error('Sin GPS')); };
      if (!navigator.geolocation) return fb();
      navigator.geolocation.getCurrentPosition(p => ok({ lat: p.coords.latitude, lon: p.coords.longitude, name: 'Mi ubicación' }), fb, { timeout: 9000, maximumAge: 60000 });
    });
  }
  async function resolve(k) {
    const inp = $('cmt' + k), sel = $('cmt' + k + 's');
    if (sel.style.display !== 'none' && sel.value) { const [a, b] = sel.value.split(',').map(Number); return { lat: a, lon: b, name: sel.selectedOptions[0].textContent }; }
    const q = inp.value.trim();
    if (q) { const r = await geocode(q); if (!r.length) throw new Error('No encontré "' + q + '"'); fill(k, r); return r[0]; }
    if (k === 'O') return getPos();
    throw new Error('Elegí un destino');
  }
  function fill(k, list) {
    const sel = $('cmt' + k + 's'); sel.innerHTML = '';
    list.forEach(r => { const o = document.createElement('option'); o.value = r.lat + ',' + r.lon; o.textContent = r.name; sel.appendChild(o); });
    sel.style.display = list.length > 1 ? 'block' : 'none';
  }

  /* ---------- ruta ---------- */
  async function route(o, d) {
    const j = await jget('https://router.project-osrm.org/route/v1/driving/' + o.lon + ',' + o.lat + ';' + d.lon + ',' + d.lat + '?overview=full&geometries=geojson&steps=true', 15000);
    if (j.code !== 'Ok' || !j.routes || !j.routes[0]) throw new Error('No pude trazar la ruta');
    const r = j.routes[0];
    S.coords = r.geometry.coordinates.map(c => [c[1], c[0]]);
    let acc = 0; S.cum = [0];
    for (let i = 1; i < S.coords.length; i++) { acc += hav(S.coords[i - 1][0], S.coords[i - 1][1], S.coords[i][0], S.coords[i][1]); S.cum.push(acc); }
    const k = acc ? (r.distance / 1000) / acc : 1; S.cum = S.cum.map(x => x * k); S.total = S.cum[S.cum.length - 1];
    const steps = []; (r.legs || []).forEach(l => (l.steps || []).forEach(s => { if ((s.name || s.ref) && s.maneuver) steps.push({ n: s.name || s.ref, a: s.maneuver.location[1], b: s.maneuver.location[0] }); }));
    const N = Math.max(2, Math.min(14, Math.ceil(S.total / 25) + 1)); S.samples = [];
    for (let q = 0; q < N; q++) {
      const km = S.total * q / (N - 1); let i = S.cum.findIndex(x => x >= km); if (i < 0) i = S.coords.length - 1;
      const a = S.coords[Math.max(0, i - 3)], b = S.coords[Math.min(S.coords.length - 1, i + 3)];
      let nm = '', bd = 1e9; steps.forEach(s => { const dd = hav(S.coords[i][0], S.coords[i][1], s.a, s.b); if (dd < bd) { bd = dd; nm = s.n; } });
      S.samples.push({ i, km, lat: S.coords[i][0], lon: S.coords[i][1], b: brg(a[0], a[1], b[0], b[1]), road: nm, risks: [], lvl: 0, said: false });
    }
  }

  /* ---------- clima a la hora de paso ---------- */
  function judge(w, b) {
    const r = [], E = S.empty, cross = Math.round(w.g * Math.abs(Math.sin((w.d - b) * D2R)));
    const gl = w.g >= (E ? 75 : 90) ? 3 : w.g >= (E ? 55 : 65) ? 2 : 0; if (gl) r.push([gl, '💨', 'ráfagas de ' + Math.round(w.g) + ' km/h']);
    const cl = cross >= (E ? 45 : 60) ? 3 : cross >= (E ? 30 : 45) ? 2 : 0; if (cl) r.push([cl, '↔️', 'viento cruzado de ' + cross + ' km/h']);
    if (w.c === 96 || w.c === 99) r.push([3, '🧊', 'posible granizo']); else if (w.c === 95) r.push([3, '⛈️', 'tormenta eléctrica']);
    if (w.p >= 8) r.push([3, '🌧️', 'lluvia intensa']); else if (w.p >= 2) r.push([2, '🌧️', 'lluvia']);
    if ([71, 73, 75, 77, 85, 86].includes(w.c)) r.push([w.t <= 0 ? 3 : 2, '❄️', 'nieve']);
    if ([56, 57, 66, 67].includes(w.c) || (w.t <= 1 && w.p > 0)) r.push([3, '🧊', 'hielo en la ruta']); else if (w.t <= 2) r.push([1, '❄️', 'helada posible']);
    if ([45, 48].includes(w.c)) r.push([2, '🌫️', 'niebla']);
    if (w.t >= 38) r.push([1, '🔥', 'calor extremo']);
    return r;
  }
  const inPoly = (la, lo, p) => { let c = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) { const yi = p[i][0], xi = p[i][1], yj = p[j][0], xj = p[j][1]; if ((yi > la) !== (yj > la) && lo < (xj - xi) * (la - yi) / (yj - yi) + xi) c = !c; } return c; };
  async function analyze(kmNow) {
    const base = Date.now() + (kmNow > 0 ? 0 : S.depH * 3600e3), sm = S.samples;
    const j = await jget('https://api.open-meteo.com/v1/forecast?latitude=' + sm.map(s => s.lat.toFixed(3)).join(',') + '&longitude=' + sm.map(s => s.lon.toFixed(3)).join(',') +
      '&hourly=temperature_2m,precipitation,weather_code,wind_gusts_10m,wind_direction_10m&wind_speed_unit=kmh&timeformat=unixtime&timezone=UTC&forecast_days=3', 15000);
    const arr = Array.isArray(j) ? j : [j]; let alerts = null; try { alerts = await g.fetchOfficialAlertGeometry(); } catch (e) { }
    S.smnOk = !!alerts;
    sm.forEach((s, n) => {
      const h = arr[n] && arr[n].hourly; if (!h) return;
      s.eta = base + Math.max(0, s.km - kmNow) / S.speed * 3600e3; s.passed = s.km < kmNow - 2;
      const ix = Math.max(0, Math.min(h.time.length - 1, Math.round((s.eta / 1000 - h.time[0]) / 3600)));
      s.w = { t: h.temperature_2m[ix], p: h.precipitation[ix], c: h.weather_code[ix], g: h.wind_gusts_10m[ix], d: h.wind_direction_10m[ix] };
      s.risks = judge(s.w, s.b);
      (alerts || []).forEach(a => {
        if ((a.expires && Date.parse(a.expires) < s.eta) || (a.onset && Date.parse(a.onset) > s.eta + 3 * 3600e3)) return;
        if ((a.polys || []).some(p => inPoly(s.lat, s.lon, p)) || (a.circles || []).some(c => hav(s.lat, s.lon, c.lat, c.lon) <= c.km))
          s.risks.push([/extreme|severe/i.test(a.severity) ? 3 : /moderate/i.test(a.severity) ? 2 : 1, '🚨', 'aviso SMN: ' + String(a.event || a.title).slice(0, 60)]);
      });
      s.lvl = s.risks.reduce((m, r) => Math.max(m, r[0]), 0);
    });
  }
  const rtxt = (s, min) => s.risks.filter(r => r[0] >= (min || 1)).map(r => r[2]).join(', ');

  /* ---------- mapa y resultados ---------- */
  function draw() {
    if (S.layer) map.removeLayer(S.layer); S.layer = L.layerGroup().addTo(map);
    const sm = S.samples;
    for (let q = 0; q < sm.length - 1; q++) L.polyline(S.coords.slice(sm[q].i, sm[q + 1].i + 1), { color: COL[Math.max(sm[q].lvl, sm[q + 1].lvl)], weight: 7, opacity: .9 }).addTo(S.layer);
    sm.forEach(s => { if (s.lvl >= 1) L.circleMarker([s.lat, s.lon], { radius: 8, color: '#fff', weight: 2, fillColor: COL[s.lvl], fillOpacity: 1 }).bindPopup('<b>km ' + Math.round(s.km) + (s.road ? ' · ' + esc(s.road) : '') + '</b><br>' + hhmm(s.eta) + ' · ' + esc(rtxt(s)), { className: 'mx-pop' }).addTo(S.layer); });
    try { map.fitBounds(L.polyline(S.coords).getBounds(), { padding: [30, 30] }); } catch (e) { }
    showBar();
  }
  function render() {
    const sm = S.samples, bad = sm.filter(s => s.lvl >= 2), worst = sm.reduce((m, s) => Math.max(m, s.lvl), 0);
    let h = '<div class="cmt-sum l' + worst + '"><b>' + Math.round(S.total) + ' km · ' + Math.round(S.total / S.speed * 10) / 10 + ' h</b><br>' +
      (bad.length ? '⚠ ' + bad.length + ' tramo(s) con riesgo. El primero: km ' + Math.round(bad[0].km) + ' a las ' + hhmm(bad[0].eta) + ' (' + esc(rtxt(bad[0], 2)) + ').' : '✅ Sin riesgos importantes previstos para el horario de paso.') + '</div>';
    if (!S.smnOk) h += '<p class="cmt-n">No pude leer los avisos SMN; solo se usó el pronóstico.</p>';
    sm.forEach(s => { h += '<div class="cmt-row l' + s.lvl + '"><b>' + hhmm(s.eta) + '</b> · km ' + Math.round(s.km) + (s.road ? ' · ' + esc(s.road) : '') + '<br><span>' + (s.risks.length ? esc(s.risks.map(r => r[1] + ' ' + r[2]).join(' · ')) : 'Sin novedades') + ' · ' + Math.round(s.w ? s.w.t : 0) + '°C</span></div>'; });
    h += '<p class="cmt-n">Pronóstico de modelo para la hora estimada de paso, no una garantía. Respetá siempre las indicaciones de Vialidad y Policía.</p>' +
      '<div class="cmt-r"><button id="cmtMap" class="cmt-b">🗺 Ver en el mapa</button><button id="cmtStart" class="cmt-b go">▶ Iniciar viaje con voz</button></div><button id="cmtClr" class="cmt-b" type="button">🗑 No viajo: borrar ruta</button>';
    $('cmtOut').innerHTML = h;
    $('cmtMap').onclick = () => { if (S.closeFn) S.closeFn(); };
    $('cmtStart').onclick = start;
    $('cmtClr').onclick = clearRoute;
  }

  /* ---------- viaje con voz ---------- */
  function bar() {
    let b = $('cmtBar');
    if (!b) { b = document.createElement('div'); b.id = 'cmtBar'; b.className = 'cmt-bar'; b.innerHTML = '<span id="cmtTxt"></span><button id="cmtStop" type="button">■ Terminar</button><button id="cmtDel" type="button" class="del">🗑 Borrar</button>'; document.body.appendChild(b); $('cmtStop').onclick = stop; $('cmtDel').onclick = clearRoute; }
    return b;
  }
  function showBar() { const b = bar(); b.style.display = 'flex'; $('cmtStop').style.display = S.driving ? '' : 'none'; upd(); }
  function clearRoute() {
    stop(); if (S.layer) { try { map.removeLayer(S.layer); } catch (e) { } S.layer = null; }
    S.samples = []; S.coords = []; S.cum = []; S.total = 0;
    const b = $('cmtBar'); if (b) b.style.display = 'none'; const o = $('cmtOut'); if (o) o.innerHTML = '';
  }
  function start() {
    if (S.driving) stop(); S.driving = true; S.last = 0; S.kmNow = 0; S.first = true; S.samples.forEach(s => { s.said = false; s.said2 = false; });
    if (S.closeFn) S.closeFn(); showBar();
    try { AB && AB.keepScreen && AB.keepScreen(true); } catch (e) { }
    const n = S.samples.filter(s => s.lvl >= 2).length;
    say('Modo transporte activado. ' + (n ? 'Hay ' + n + ' tramos con riesgo en la ruta.' : 'No hay riesgos importantes previstos.') + ' Te aviso por voz antes de cada uno.');
    if (navigator.geolocation) S.watch = navigator.geolocation.watchPosition(onPos, () => { }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 25000 });
    S.refT = setInterval(async () => { try { await analyze(S.kmNow); draw(); upd(); } catch (e) { } }, 15 * 60e3);
  }
  function stop() {
    S.driving = false; if (S.watch != null) navigator.geolocation.clearWatch(S.watch); S.watch = null; clearInterval(S.refT);
    try { AB && AB.keepScreen && AB.keepScreen(false); AB && AB.stopSpeak && AB.stopSpeak(); } catch (e) { }
    if (S.layer) showBar(); else { const b = $('cmtBar'); if (b) b.style.display = 'none'; }
  }
  function onPos(p) {
    if (!S.driving) return; const a = p.coords.latitude, b = p.coords.longitude;
    let best = S.last, bd = 1e9; const end = S.first ? S.coords.length : Math.min(S.coords.length, S.last + 500);
    for (let i = S.first ? 0 : S.last; i < end; i++) { const dd = hav(a, b, S.coords[i][0], S.coords[i][1]); if (dd < bd) { bd = dd; best = i; } }
    if (bd > 3) { if (!S.offAt || Date.now() - S.offAt > 300e3) { S.offAt = Date.now(); say('Te alejaste de la ruta calculada.'); } return; }
    S.first = false; S.last = best; S.kmNow = S.cum[best];
    S.samples.forEach(s => {
      if (s.lvl < 2 || s.km < S.kmNow - 1) return; const ahead = s.km - S.kmNow, why = rtxt(s, 2) + (s.road ? ', en ' + s.road : '');
      if (!s.said && ahead <= 60) { s.said = true; say('En ' + Math.max(1, Math.round(ahead)) + ' kilómetros: ' + why); try { navigator.vibrate && navigator.vibrate([200, 100, 200]); } catch (e) { } }
      else if (s.lvl === 3 && !s.said2 && ahead <= 8) { s.said2 = true; say('Atención, en ' + Math.max(1, Math.round(ahead)) + ' kilómetros: ' + rtxt(s, 3)); }
    });
    if (S.total - S.kmNow < 1) { say('Llegaste a destino.'); stop(); return; } upd();
  }
  function upd() {
    const t = $('cmtTxt'); if (!t) return; const nx = S.samples.find(s => s.lvl >= 2 && s.km >= S.kmNow - 1);
    t.textContent = S.driving ? '🚚 ' + Math.round(S.total - S.kmNow) + ' km restantes · ' + (nx ? '⚠ en ' + Math.max(0, Math.round(nx.km - S.kmNow)) + ' km: ' + rtxt(nx, 2) : '✅ sin riesgos adelante')
      : '🚚 Ruta de ' + Math.round(S.total) + ' km · ' + (nx ? '⚠ riesgo desde el km ' + Math.round(nx.km) : '✅ sin riesgos importantes');
  }

  /* ---------- pantalla ---------- */
  function mount(body, closeFn) {
    S.closeFn = closeFn; if (S.root) return; S.root = body;
    body.innerHTML = '<div class="cmt"><label>Origen</label><div class="cmt-r"><input id="cmtO" placeholder="Mi ubicación (vacío = GPS)" autocomplete="off"><button id="cmtOb" type="button">🔎</button></div><select id="cmtOs" style="display:none"></select>' +
      '<label>Destino</label><div class="cmt-r"><input id="cmtD" placeholder="Ej: Uspallata, San Rafael, Santiago" autocomplete="off"><button id="cmtDb" type="button">🔎</button></div><select id="cmtDs" style="display:none"></select>' +
      '<div class="cmt-r"><label>Velocidad media <input id="cmtSp" type="number" value="70" min="30" max="110" inputmode="numeric"> km/h</label><label>Salida <select id="cmtDep"><option value="0">Ahora</option><option value="1">En 1 h</option><option value="2">En 2 h</option><option value="4">En 4 h</option><option value="8">En 8 h</option><option value="12">En 12 h</option></select></label></div>' +
      '<label class="cmt-ck"><input id="cmtEmp" type="checkbox" checked> Camión vacío o acoplado (más sensible al viento)</label>' +
      '<button id="cmtGo" class="cmt-b go" type="button">🚚 Calcular ruta y clima</button><div id="cmtOut"></div></div>';
    ['O', 'D'].forEach(k => { $('cmt' + k + 'b').onclick = async () => { try { const q = $('cmt' + k).value.trim(); if (!q) return; $('cmtOut').textContent = 'Buscando…'; const r = await geocode(q); fill(k, r); $('cmtOut').textContent = r.length ? '' : 'No encontré ese lugar'; } catch (e) { $('cmtOut').textContent = 'No pude buscar (¿sin internet?)'; } }; $('cmt' + k).oninput = () => { $('cmt' + k + 's').style.display = 'none'; $('cmt' + k + 's').innerHTML = ''; }; });
    $('cmtGo').onclick = async () => {
      const out = $('cmtOut'), btn = $('cmtGo'); btn.disabled = true;
      try {
        S.speed = Math.max(30, Math.min(110, +$('cmtSp').value || 70)); S.depH = +$('cmtDep').value || 0; S.empty = $('cmtEmp').checked;
        out.textContent = 'Buscando lugares…'; const o = await resolve('O'), d = await resolve('D');
        out.textContent = 'Trazando ruta…'; await route(o, d);
        out.textContent = 'Consultando el clima en ' + S.samples.length + ' puntos…'; await analyze(0);
        render(); draw();
      } catch (e) { out.textContent = '⚠ ' + (e && e.message ? e.message : 'No se pudo calcular. Revisá la conexión.'); }
      btn.disabled = false;
    };
  }
  g.CMT = { mount: mount, stop: stop, clear: clearRoute };

  /* ---------- ajustes de sonido y voz (solo en la app Android) ---------- */
  const SND = [['stormStrong', '⛈️ Tormenta fuerte'], ['stormApproach', '🌩️ Se acerca tormenta'], ['stormWeak', '🌧️ Lluvia o tormenta leve'], ['hail', '🧊 Granizo'], ['wind', '💨 Viento fuerte'], ['zonda', '🌬️ Zonda'], ['quake', '🏛️ Sismo'], ['frost', '❄️ Helada']];
  function initSnd() {
    const box = $('cmSnd'); if (!box || !AB || !AB.voiceOn) return; box.style.display = 'block';
    try { $('oVoice').checked = !!AB.voiceOn(); } catch (e) { }
    $('oVoice').onchange = e => { try { AB.setVoice(e.target.checked); if (e.target.checked) AB.speak('Voz activada.'); } catch (x) { } };
    $('vTest').onclick = () => { try { AB.speak('Prueba de voz. Viento fuerte. Ráfagas de hasta 60 kilómetros por hora. Buscá un lugar cerrado.'); } catch (e) { } };
    const host = $('sndTypes'); host.innerHTML = '';
    SND.forEach(x => {
      const row = document.createElement('div'); row.className = 'sndrow';
      row.innerHTML = '<span>' + x[1] + '</span><select aria-label="' + x[1] + '"><option value="app">Sonido de la app</option><option value="system">Alarma del sistema</option></select><button type="button" aria-label="Escuchar">▶</button>';
      const sel = row.querySelector('select'); try { let v = AB.soundPref(x[0]) || 'app'; if (v !== 'system') { v = 'app'; AB.setSoundPref(x[0], 'app'); } sel.value = v; } catch (e) { }
      sel.onchange = () => { try { AB.setSoundPref(x[0], sel.value); AB.previewSound(x[0]); } catch (e) { } };
      row.querySelector('button').onclick = () => { try { AB.previewSound(x[0]); } catch (e) { } };
      host.appendChild(row);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initSnd); else initSnd();
})(window);
