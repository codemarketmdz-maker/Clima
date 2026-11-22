/* Radar del SMN en TiempoMDZ (versión web).
   Muestra las últimas imágenes de radar (una cada 10 min) con animación, a través del Worker propio (licencias/worker.js, rutas /radar/list y /radar/img).
   Necesita CM_CFG.proxy (o licUrl) con la dirección del Worker. Fuente de los datos: Servicio Meteorológico Nacional.
   Radares con ubicación calibrada (hoy Santa Rosa, Mendoza): se pueden superponer sobre el mapa. La imagen del SMN es un dibujo (proyección azimutal
   centrada en el radar, 240 km = 520 px): se reproyecta a Web Mercator, se descartan fondo, mapa, textos y leyenda y se conservan solo los colores de la
   escala de reflectividad (dBZ). */
(function (g) {
  'use strict';
  const C = g.CM_CFG || {}, $ = id => document.getElementById(id);
  const base = () => { let u = String(C.proxy || C.licUrl || '').trim(); if (!u) return ''; if (!/^https?:\/\//i.test(u)) u = 'https://' + u.replace(/^\/+/, ''); return u.replace(/\/+$/, ''); };
  const RADARS = [['RMA19_240', 'Santa Rosa (Mendoza)'], ['COMP_CEN', 'Mosaico Centro'], ['COMP_ARG', 'Mosaico Argentina'], ['RMA15_240', 'Patquía (La Rioja)'],
    ['RMA16_240', 'Villa Reynolds (San Luis)'], ['ANG_240', 'Anguil (La Pampa)'], ['RMA7_240', 'Neuquén (Neuquén)']];
  // Calibración medida sobre la imagen de Santa Rosa con 12 ciudades (error típico 1–3 km): centro del radar, 520 px = 240 km, panel del mapa en la imagen.
  // Ambas imágenes están en proyección azimutal equidistante: píxel = (cx + k·E, cy − k·N), con E/N en km desde (lat0, lon0).
  // Mosaico Centro: ajustado con 12 ciudades (error 0,3 px ≈ 0,7 km). Radar de Santa Rosa: 12 ciudades (1–3 km).
  const GEO = {
    RMA19_240: { label: 'Radar de Santa Rosa (SINARAME)', lat0: -33.2605, lon0: -68.0998, cx: 555.5, cy: 691.5, kpx: 520 / 240, rkm: 240, box: [16, 154, 1096, 1229], skip: [[18, 1155, 252, 1228]], nmax: 800 },
    COMP_CEN: { label: 'Mosaico Centro (SINARAME)', lat0: -38.92, lon0: -63.63, cx: 551.4, cy: 633.4, kpx: 0.5269, box: [13, 40, 1090, 891], skip: [[13, 40, 252, 116]], nmax: 1000 }
  };
  // Escala de reflectividad del SMN (R, G, B, dBZ), tomada de la barra de colores de la imagen
  const LUT = [[136,223,189,72.7],[152,227,199,67.5],[167,236,206,65.3],[181,237,216,63.9],[197,241,224,62.1],[153,0,161,57.6],[179,0,182,56.4],[202,0,204,55.0],[234,0,234,53.4],[214,0,160,51.8],[193,0,95,50.4],[155,0,0,48.5],[179,0,10,47.4],[193,1,22,45.8],[203,0,28,44.2],[235,10,47,42.9],[218,129,20,41.4],[216,152,28,40.1],[208,174,33,38.5],[191,198,43,36.9],[204,209,51,35.7],[214,218,51,33.9],[224,229,59,32.7],[238,240,62,30.8],[36,114,24,29.3],[44,137,28,27.8],[52,161,33,26.4],[60,178,40,24.9],[64,193,45,23.5],[72,210,47,22.0],[76,225,50,20.7],[85,243,58,19.1],[42,176,218,17.1],[38,162,209,16.1],[40,151,198,13.7],[47,136,188,11.7],[49,139,188,10.0],[55,126,177,7.7],[56,114,163,4.7],[58,113,163,3.3],[59,101,151,0.6],[61,100,151,-0.6],[59,101,151,-1.8],[61,89,137,-3.8],[62,89,137,-5.0],[61,89,137,-6.0],[60,78,122,-8.1],[60,78,122,-10.3],[62,64,109,-12.6],[59,66,109,-13.7],[62,64,109,-15.3],[59,66,109,-16.6],[61,65,109,-17.7]];
  const REFRESH = 5 * 60e3, RE = 6371;
  let frames = [], urls = {}, ovl = {}, idx = 0, timer = null, refreshT = null, playing = false, token = 0, cur = RADARS[0][0];
  let ovOn = false, ovLayer = null, ovTok = 0, minDbz = 15, ovOpacity = 0.75, fitted = false;

  // ---------- Reproyección y filtrado (funciones puras, probadas fuera del navegador) ----------
  const rad = x => x * Math.PI / 180, deg = x => x * 180 / Math.PI;
  const mercY = lat => Math.log(Math.tan(Math.PI / 4 + rad(lat) / 2)), invMerc = y => deg(2 * Math.atan(Math.exp(y)) - Math.PI / 2);
  function inv(E, N, geo) {          // km desde el centro → [lat, lon] (azimutal equidistante, inversa)
    const p0 = rad(geo.lat0), l0 = rad(geo.lon0), d = Math.hypot(E, N); if (d < 1e-9) return [geo.lat0, geo.lon0];
    const c = d / RE, p = Math.asin(Math.cos(c) * Math.sin(p0) + N * Math.sin(c) * Math.cos(p0) / d), l = l0 + Math.atan2(E * Math.sin(c), d * Math.cos(p0) * Math.cos(c) - N * Math.sin(p0) * Math.sin(c));
    return [deg(p), deg(l)];
  }
  function bounds(geo) {
    let la0 = 90, la1 = -90, lo0 = 180, lo1 = -180; const up = (la, lo) => { la0 = Math.min(la0, la); la1 = Math.max(la1, la); lo0 = Math.min(lo0, lo); lo1 = Math.max(lo1, lo); };
    if (geo.rkm) {
      const d = geo.rkm / RE, p0 = rad(geo.lat0), l0 = rad(geo.lon0);
      for (let t = 0; t < 360; t += 3) {
        const th = rad(t), p = Math.asin(Math.sin(p0) * Math.cos(d) + Math.cos(p0) * Math.sin(d) * Math.cos(th)), l = l0 + Math.atan2(Math.sin(th) * Math.sin(d) * Math.cos(p0), Math.cos(d) - Math.sin(p0) * Math.sin(p));
        up(deg(p), deg(l));
      }
    } else {                          // mosaico: se recorre el borde de la imagen
      const [x0, y0, x1, y1] = geo.box, f = (x, y) => { const q = inv((x - geo.cx) / geo.kpx, (geo.cy - y) / geo.kpx, geo); up(q[0], q[1]); };
      for (let x = x0; x <= x1; x += 10) { f(x, y0); f(x, y1); } for (let y = y0; y <= y1; y += 10) { f(x0, y); f(x1, y); }
    }
    return { latMin: la0, latMax: la1, lonMin: lo0, lonMax: lo1 };
  }
  const key2dbz = new Map();
  function classify(r, g2, b) {      // → dBZ del color, o null si no es un color de la escala (fondo, texto, líneas, costas)
    const k = (r << 16) | (g2 << 8) | b; let v = key2dbz.get(k); if (v !== undefined) return v;
    v = null;
    if (Math.max(r, g2, b) - Math.min(r, g2, b) >= 25 && !(r >= 235 && g2 >= 235 && b >= 235)) {
      let best = 1e9, bi = -1;
      for (let i = 0; i < LUT.length; i++) { const L = LUT[i], d = (r - L[0]) ** 2 + (g2 - L[1]) ** 2 + (b - L[2]) ** 2; if (d < best) { best = d; bi = i; } }
      if (best <= 300) v = LUT[bi][3];
    }
    key2dbz.set(k, v); return v;
  }
  // src: RGBA de la imagen (sw × sh). Devuelve { rgba, nx, ny, latMin, latMax, lonMin, lonMax } en Web Mercator (el lado mayor mide nmax píxeles).
  function build(src, sw, sh, geo, minD, nmax) {
    const bb = bounds(geo), yMax = mercY(bb.latMax), yMin = mercY(bb.latMin), dx = rad(bb.lonMax - bb.lonMin), dy = yMax - yMin, sc = nmax / Math.max(dx, dy);
    const nx = Math.max(2, Math.round(dx * sc)), ny = Math.max(2, Math.round(dy * sc)), out = new Uint8ClampedArray(nx * ny * 4);
    const p0 = rad(geo.lat0), l0 = rad(geo.lon0), s0 = Math.sin(p0), c0 = Math.cos(p0), cl = new Float64Array(nx), sl = new Float64Array(nx), lim = geo.rkm ? geo.rkm * 0.985 : 1e9, skip = geo.skip || [];
    for (let i = 0; i < nx; i++) { const dl = rad(bb.lonMin + (i + 0.5) / nx * (bb.lonMax - bb.lonMin)) - l0; cl[i] = Math.cos(dl); sl[i] = Math.sin(dl); }
    const bx0 = geo.box[0], by0 = geo.box[1], bx1 = geo.box[2], by1 = geo.box[3];
    for (let j = 0; j < ny; j++) {
      const p = rad(invMerc(yMax - (j + 0.5) / ny * (yMax - yMin))), sp = Math.sin(p), cp = Math.cos(p);
      for (let i = 0; i < nx; i++) {
        const cc = s0 * sp + c0 * cp * cl[i], c = Math.acos(cc > 1 ? 1 : cc < -1 ? -1 : cc), dist = RE * c; if (dist > lim) continue;
        const k = c < 1e-9 ? 1 : c / Math.sin(c), E = RE * k * cp * sl[i], N = RE * k * (c0 * sp - s0 * cp * cl[i]);
        const sx = Math.round(geo.cx + geo.kpx * E), sy = Math.round(geo.cy - geo.kpx * N); if (sx < bx0 || sx > bx1 || sy < by0 || sy > by1) continue;
        let ex = false; for (let z = 0; z < skip.length; z++) { const r = skip[z]; if (sx >= r[0] && sx <= r[2] && sy >= r[1] && sy <= r[3]) { ex = true; break; } } if (ex) continue;
        const q = (sy * sw + sx) * 4, d = classify(src[q], src[q + 1], src[q + 2]); if (d == null || d < minD) continue;
        const o = (j * nx + i) * 4; out[o] = src[q]; out[o + 1] = src[q + 1]; out[o + 2] = src[q + 2]; out[o + 3] = 255;
      }
    }
    return { rgba: out, nx, ny, latMin: bb.latMin, latMax: bb.latMax, lonMin: bb.lonMin, lonMax: bb.lonMax };
  }
  g.__rdBuild = build; g.__rdClassify = classify;

  // ---------- Vista en ventana ----------
  function when(f) {       // ..._20261119_234000Z.png  →  hora local
    const m = /(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})?Z/.exec(f);
    if (!m) return f;
    const d = new Date(Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)));
    return d.toLocaleString('es-AR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) + ' (hora local)';
  }
  const msg = (t, bad) => { const m = $('rdMsg'); m.textContent = t; m.style.color = bad ? '#ff8a8a' : ''; };
  function show(i) {
    if (!frames.length) return;
    idx = Math.max(0, Math.min(frames.length - 1, i));
    const f = frames[idx], u = urls[f], t = when(f) + '  ·  imagen ' + (idx + 1) + ' de ' + frames.length;
    $('rdSlide').value = idx; $('rdTime').textContent = t; $('rdBarSlide').max = frames.length - 1; $('rdBarSlide').value = idx; $('rdBarT').textContent = t;
    if (u) { $('rdImg').src = u; $('rdImg').style.opacity = 1; } else $('rdImg').style.opacity = .35;
    if (ovOn) paintOverlay();
  }
  function stop() { playing = false; clearTimeout(timer); $('rdPlay').textContent = '▶ Reproducir'; $('rdBarPlay').textContent = '▶'; }
  function step() {
    if (!playing) return;
    show(idx >= frames.length - 1 ? 0 : idx + 1);
    timer = setTimeout(step, idx === frames.length - 1 ? 1800 : (ovOn ? 900 : 600));
  }
  function play() { if (playing) { stop(); return; } playing = true; $('rdPlay').textContent = '⏸ Pausar'; $('rdBarPlay').textContent = '⏸'; timer = setTimeout(step, 300); }

  // ---------- Superposición sobre el mapa ----------
  const mapObj = () => { try { return typeof map !== 'undefined' ? map : null; } catch (e) { return null; } };
  const loadImg = u => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = u; });
  async function overlayFor(f) {        // URL (blob) de la capa ya reproyectada y filtrada de ese cuadro
    const k = cur + '|' + f + '|' + minDbz; if (ovl[k]) return ovl[k];
    const u = urls[f], geo = GEO[cur]; if (!u || !geo) return null;
    const im = await loadImg(u), cv = document.createElement('canvas'); cv.width = im.naturalWidth; cv.height = im.naturalHeight;
    const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(im, 0, 0);
    const o = build(cx.getImageData(0, 0, cv.width, cv.height).data, cv.width, cv.height, geo, minDbz, geo.nmax || 800);
    const oc = document.createElement('canvas'); oc.width = o.nx; oc.height = o.ny; oc.getContext('2d').putImageData(new ImageData(o.rgba, o.nx, o.ny), 0, 0);
    const blob = await new Promise(r => oc.toBlob(r, 'image/png')); ovl[k] = { url: URL.createObjectURL(blob), b: [[o.latMin, o.lonMin], [o.latMax, o.lonMax]] };
    return ovl[k];
  }
  async function paintOverlay() {
    const m = mapObj(); if (!m || !g.L || !GEO[cur]) return; const my = ++ovTok, f = frames[idx];
    try {
      const o = await overlayFor(f); if (my !== ovTok || !ovOn || !o) return;
      if (!ovLayer) { ovLayer = g.L.imageOverlay(o.url, o.b, { opacity: ovOpacity, interactive: false, zIndex: 350 }); ovLayer.addTo(m); }
      else { ovLayer.setUrl(o.url); ovLayer.setBounds(o.b); }
      if (!fitted) { fitted = true; try { m.fitBounds(o.b, { padding: [10, 10] }); } catch (e) { } }
    } catch (e) { msg('No pude preparar el radar sobre el mapa.', true); }
  }
  async function prerender() {          // deja listos todos los cuadros para que la animación no se trabe
    for (const f of frames) { if (!ovOn) return; if (urls[f]) { try { await overlayFor(f); } catch (e) { } } await new Promise(r => setTimeout(r, 30)); }
  }
  function clearOvl() { Object.keys(ovl).forEach(k => { URL.revokeObjectURL(ovl[k].url); delete ovl[k]; }); }
  function overlayOn() {
    if (!GEO[cur]) return; ovOn = true; fitted = false; $('rdBar').style.display = 'block'; $('rdMin').value = String(minDbz); $('rdOp').value = String(Math.round(ovOpacity * 100));
    $('rdBarL').textContent = GEO[cur].label + ' · Fuente: SMN · Posición calibrada con ciudades (error de 1 a 3 km).'; closeIt(true); show(frames.length - 1); prerender();
  }
  function overlayOff() { ovOn = false; ovTok++; stop(); $('rdBar').style.display = 'none'; const m = mapObj(); if (ovLayer && m) m.removeLayer(ovLayer); ovLayer = null; clearOvl(); }

  // ---------- Vigilancia de ecos fuertes cerca de tus lugares (aviso de posible granizo) ----------
  // Cada 5 min baja los últimos cuadros del radar, se queda solo con los píxeles de ≥ 35 dBZ y, para cada lugar (GPS y fincas), busca el eco fuerte más cercano,
  // si se acerca o se aleja y a qué hora llegaría. El umbral, la distancia y el encendido se eligen en ⚙ Avisos.
  const FR = {};                       // radar → cuadros procesados (el más nuevo primero)
  let wBusy = false, wInfo = '', wLast = 0;
  const COMPASS = ['norte', 'noreste', 'este', 'sudeste', 'sur', 'sudoeste', 'oeste', 'noroeste'];
  const fwd = (lat, lon, geo) => {       // lat/lon → km (E, N) desde el centro de la imagen
    const p = rad(lat), l = rad(lon), p0 = rad(geo.lat0), dl = l - rad(geo.lon0), cc = Math.sin(p0) * Math.sin(p) + Math.cos(p0) * Math.cos(p) * Math.cos(dl), c = Math.acos(Math.max(-1, Math.min(1, cc))), k = c < 1e-9 ? 1 : c / Math.sin(c);
    return [RE * k * Math.cos(p) * Math.sin(dl), RE * k * (Math.cos(p0) * Math.sin(p) - Math.sin(p0) * Math.cos(p) * Math.cos(dl))];
  };
  function extract(src, sw, sh, geo) {  // píxeles de ≥ 35 dBZ de una imagen → { E, N, D } (km desde el centro, dBZ)
    const E = [], N = [], D = [], b = geo.box, skip = geo.skip || [];
    for (let y = b[1]; y <= b[3]; y++) for (let x = b[0]; x <= b[2]; x++) {
      const q = (y * sw + x) * 4, d = classify(src[q], src[q + 1], src[q + 2]); if (d == null || d < 35) continue;
      let ex = false; for (let z = 0; z < skip.length; z++) { const r = skip[z]; if (x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3]) { ex = true; break; } } if (ex) continue;
      E.push((x - geo.cx) / geo.kpx); N.push((geo.cy - y) / geo.kpx); D.push(Math.round(d));
    }
    return { E: Float32Array.from(E), N: Float32Array.from(N), D: Uint8Array.from(D) };
  }
  function nearest(fr, E0, N0, thr, kpx) {   // eco ≥ thr más cercano que no sea un píxel suelto (necesita unos 2,5 km² de ecos fuertes alrededor)
    const c = []; for (let i = 0; i < fr.D.length; i++) if (fr.D[i] >= thr) { const a = fr.E[i] - E0, b = fr.N[i] - N0; c.push([a * a + b * b, i]); }
    if (!c.length) return null; c.sort((p, q) => p[0] - q[0]); const need = 2.5 * kpx * kpx;
    for (let k = 0; k < Math.min(c.length, 60); k++) {
      const i = c[k][1]; let n = 0, mx = 0;
      for (let j = 0; j < fr.D.length; j++) { const a = fr.E[j] - fr.E[i], b = fr.N[j] - fr.N[i]; if (a * a + b * b <= 16) { if (fr.D[j] >= thr) n++; if (fr.D[j] > mx) mx = fr.D[j]; } }
      if (n >= need) return { d: Math.sqrt(c[k][0]), dE: fr.E[i] - E0, dN: fr.N[i] - N0, max: mx };
    }
    return null;
  }
  function evalPlace(frames, E0, N0, thr, kpx) {
    const f0 = frames[0], a = nearest(f0, E0, N0, thr, kpx); if (!a) return null; let v = null;
    for (const fo of frames.slice(1)) { const dt = (f0.t - fo.t) / 3.6e6; if (dt < 0.13 || dt > 0.6) continue; const b = nearest(fo, E0, N0, thr, kpx); if (b) { v = (b.d - a.d) / dt; } break; }
    return { d: a.d, deg: (deg(Math.atan2(a.dE, a.dN)) + 360) % 360, max: a.max, v };
  }
  g.__rdExtract = extract; g.__rdEval = evalPlace; g.__rdFwd = fwd; g.__rdInv = inv; g.__rdFR = FR;
  const stampOf = n => { const m = /(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})Z/.exec(n); return m ? Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : 0; };
  function radarFor(loc) {                 // qué radar cubre este lugar
    for (const id of ['RMA19_240', 'COMP_CEN']) {
      const geo = GEO[id], q = fwd(loc.lat, loc.lon, geo);
      if (geo.rkm) { if (Math.hypot(q[0], q[1]) <= geo.rkm * 0.92) return id; }
      else { const x = geo.cx + geo.kpx * q[0], y = geo.cy - geo.kpx * q[1]; if (x > geo.box[0] + 15 && x < geo.box[2] - 15 && y > geo.box[1] + 15 && y < geo.box[3] - 15) return id; }
    }
    return null;
  }
  const places = () => { try { return (typeof monitored === 'function' ? monitored() : []).filter(p => p && Number.isFinite(p.lat) && Number.isFinite(p.lon)); } catch (e) { return []; } };
  const cfgNow = () => { try { return typeof cfg !== 'undefined' ? cfg : {}; } catch (e) { return {}; } };
  const levelOf = d => d >= 60 ? 'granizo probable y grande' : d >= 55 ? 'granizo probable' : d >= 52 ? 'posible granizo' : d >= 50 ? 'granizo posible pero poco probable' : d >= 45 ? 'tormenta fuerte, con lluvia torrencial' : 'lluvia fuerte';
  function cross(ev, loc, c) {
    if (c && c.radarOn === false) return ev;
    const id = radarFor(loc), frames = id && FR[id]; if (!frames || !frames.length || Date.now() - frames[0].t > 75 * 60e3) return ev;
    const geo = GEO[id], thr = Number(c && c.radarDbz) || 52, R = Number(c && c.radarKm) || 25, q = fwd(loc.lat, loc.lon, geo), r = evalPlace(frames, q[0], q[1], thr, geo.kpx); if (!r) return ev;
    const eta = r.v != null && r.v >= 10 ? r.d / r.v * 60 : null;          // minutos hasta que llegue (si se acerca ≥ 10 km/h)
    let lvl = 0; const near = r.d <= Math.min(10, R);
    if (near) lvl = 3; else if (r.d <= R) lvl = 2; else if (eta != null && eta <= 45 && r.d <= Math.max(80, R * 2)) lvl = 2; else if (r.d <= R * 2) lvl = 1;
    if (!lvl) return ev;
    const dir = COMPASS[Math.round(r.deg / 45) % 8], km = Math.round(r.d), place = loc.name;
    const move = r.v == null ? 'Es un eco nuevo: todavía no se sabe hacia dónde va.' : r.v >= 10 ? 'Se acerca a unos ' + Math.round(r.v) + ' km/h' + (eta <= 120 ? ' y llegaría en unos ' + Math.max(5, Math.round(eta / 5) * 5) + ' minutos.' : '.') : r.v <= -10 ? 'Se está alejando.' : 'Casi no se mueve.';
    let detail = 'Radar del SMN: ' + (near ? 'sobre tu zona' : 'a ' + km + ' km al ' + dir) + ' hay un núcleo de ' + r.max + ' dBZ (' + levelOf(r.max) + '). ' + move;
    const mod = ev.find(e => e && !e.source && e.place === place && (e.type === 'hail' || e.type === 'stormStrong'));
    if (mod) { detail += ' El pronóstico también marca tormenta fuerte en tu zona.'; lvl = Math.min(3, lvl + 1); }
    if (ev.some(e => e && e.place === place && /descenso brusco/.test(e.detail || ''))) detail += ' Las estaciones cercanas ya registran una baja brusca de temperatura.';
    const hail = thr >= 50;
    detail += hail ? ' El radar no ve el granizo en el suelo: indica que es posible.' : ' A este nivel suele ser lluvia muy fuerte, no necesariamente granizo.';
    const title = thr >= 55 ? 'Granizo probable (radar)' : hail ? 'Posible granizo (radar)' : 'Tormenta fuerte (radar)';
    const out = [{ type: hail ? 'hail' : 'stormStrong', level: lvl, title, place, detail }].concat(ev);
    return typeof g.applyTier === 'function' ? g.applyTier(out) : out;
  }
  g.radarCross = function (ev, loc, c) { try { return cross(ev, loc, c); } catch (e) { return ev; } };
  async function watchTick() {
    const b = base(), c = cfgNow(); if (!b || wBusy || c.radarOn === false) return;
    const need = new Set(); places().forEach(p => { const id = radarFor(p); if (id) need.add(id); }); if (!need.size) return;
    wBusy = true; let changed = false;
    try {
      for (const id of need) {
        const r = await fetch(b + '/radar/list?id=' + id, { cache: 'no-store' }); if (!r.ok) continue; const j = await r.json(), names = (j.list || []).slice(0, 3), prev = FR[id] || [], out = [];
        for (const n of names) {
          let fr = prev.find(x => x.name === n);
          if (!fr) {
            try {
              const x = await fetch(b + '/radar/img?f=' + encodeURIComponent(n)); if (!x.ok) continue; const u = URL.createObjectURL(await x.blob()), im = await loadImg(u); URL.revokeObjectURL(u);
              const cv = document.createElement('canvas'); cv.width = im.naturalWidth; cv.height = im.naturalHeight; const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(im, 0, 0);
              fr = Object.assign({ name: n, t: stampOf(n) }, extract(cx.getImageData(0, 0, cv.width, cv.height).data, cv.width, cv.height, GEO[id]));
            } catch (e) { continue; }
          }
          out.push(fr);
        }
        if (out.length) { if (!prev.length || prev[0].name !== out[0].name) changed = true; FR[id] = out; }
      }
      wLast = Date.now(); watchInfo();
      if (changed) { try { if (typeof render === 'function' && typeof last !== 'undefined' && last) render(); } catch (e) { } }
    } catch (e) { } finally { wBusy = false; }
  }
  function watchInfo() {                   // texto de estado para ⚙ Avisos
    const c = cfgNow(), thr = Number(c.radarDbz) || 52, R = Number(c.radarKm) || 25, lines = [];
    places().forEach(p => { const id = radarFor(p), fr = id && FR[id]; if (!fr || !fr.length) return; const geo = GEO[id], q = fwd(p.lat, p.lon, geo), r = evalPlace(fr, q[0], q[1], thr, geo.kpx);
      lines.push((p.name || 'Lugar') + ': ' + (r ? 'eco de ' + r.max + ' dBZ a ' + Math.round(r.d) + ' km' + (r.d > R ? ' (fuera de tu distancia de aviso)' : '') : 'sin ecos de ' + thr + ' dBZ o más cerca')); });
    const el = $('oRdStat'), t = FR.RMA19_240 && FR.RMA19_240[0] || FR.COMP_CEN && FR.COMP_CEN[0];
    wInfo = t ? 'Último cuadro del radar: ' + new Date(t.t).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false }) + ' h. ' + (lines.length ? lines.join(' · ') : 'Ninguno de tus lugares está dentro del alcance.') : 'Todavía no se leyó el radar.';
    if (el) el.textContent = wInfo;
  }
  g.radarWatchInfo = () => { watchInfo(); return wInfo; };

  // ---------- Diagnóstico del servidor de datos (para ver exactamente qué responde el Worker a esta página) ----------
  async function diag() {
    const out = $('rdDiag'), b = base(), log = []; out.style.display = 'block';
    const P = s => { log.push(s); out.textContent = log.join('\n'); };
    P('Página: ' + location.origin); P('proxy en config.js: ' + (C.proxy ? C.proxy : '(vacío)'));
    if (!b) { P('✖ Falta poner la dirección del Worker en config.js → proxy.'); return; }
    P('Servidor usado: ' + b + '\n');
    const hint = (st, txt) => st === 404 && !txt ? '→ Cloudflare devuelve 404 vacío: ese Worker NO tiene el código de worker-datos.js (¿se creó como "archivos estáticos"?). Creá un Worker común (Create Worker → Hello World), pegá worker-datos.js en Edit code y Deploy.'
      : st === 403 ? '→ El Worker no acepta esta página (' + location.origin + '). Borrá la variable ALLOWED_ORIGIN del Worker o ponele ese valor.'
      : st === 502 || st === 503 ? '→ El Worker anda, pero la fuente externa no respondió: ' + String(txt).slice(0, 90) : '→ Respuesta inesperada: ' + String(txt).slice(0, 90);
    async function get(name, path, blob) {
      const t0 = Date.now();
      try {
        const r = await fetch(b + path, { cache: 'no-store' }), x = blob ? await r.blob() : await r.text(), ms = Date.now() - t0;
        return { r, x, ms };
      } catch (e) { P('✖ ' + name + ': el navegador no pudo leer la respuesta (' + (Date.now() - t0) + ' ms). Causas: el Worker no devuelve permiso CORS para esta página, no existe, o está caído.'); P('   → Abrí ' + b + '/health en otra pestaña: si dice "ok":true, revisá ALLOWED_ORIGIN; si no abre, el Worker no está publicado con ese nombre.'); return null; }
    }
    let bad = 0, first = null;
    let q = await get('/health', '/health');
    if (q) { let j = null; try { j = JSON.parse(q.x); } catch (e) { } if (q.r.ok && j && j.servicio === 'tiempomdz-datos') P('✔ /health  OK (' + q.ms + ' ms) · token SMN: ' + j.token_smn); else { bad++; P('✖ /health  HTTP ' + q.r.status); P('   ' + hint(q.r.status, q.x)); } } else bad++;
    q = await get('/estaciones', '/estaciones');
    if (q) { let j = null; try { j = JSON.parse(q.x); } catch (e) { } if (q.r.ok && Array.isArray(j)) P('✔ /estaciones  OK · ' + j.length + ' estaciones (' + q.ms + ' ms)'); else { bad++; P('✖ /estaciones  HTTP ' + q.r.status); P('   ' + hint(q.r.status, q.x)); } } else bad++;
    q = await get('/radar/list', '/radar/list?id=RMA19_240');
    if (q) { let j = null; try { j = JSON.parse(q.x); } catch (e) { } if (q.r.ok && j && Array.isArray(j.list) && j.list.length) { first = j.list[0]; P('✔ /radar/list  OK · ' + j.list.length + ' imágenes · última: ' + first + ' (' + q.ms + ' ms)'); } else { bad++; P('✖ /radar/list  HTTP ' + q.r.status); P('   ' + (j && j.error ? '→ ' + j.error : hint(q.r.status, q.x))); } } else bad++;
    if (first) { q = await get('/radar/img', '/radar/img?f=' + encodeURIComponent(first), true); if (q) { if (q.r.ok && q.x.size > 1000) P('✔ /radar/img  OK · ' + Math.round(q.x.size / 1024) + ' KB · ' + (q.x.type || 'imagen')); else { bad++; let d = ''; try { d = JSON.parse(await q.x.text()).error || ''; } catch (e) { } P('✖ /radar/img  HTTP ' + q.r.status + (d ? ' · ' + d : '')); } } else bad++; }
    P('\n' + (bad ? '✖ Hay ' + bad + ' prueba(s) con error. Copiá este texto y mandámelo.' : '✔ Todo funciona: el radar y las estaciones deberían verse.'));
  }

  // ---------- Carga ----------
  async function load() {
    const my = ++token, b = base();
    if (!b) { msg('Falta configurar el servidor (proxy en config.js) para ver el radar.', true); return; }
    msg('Buscando las últimas imágenes…');
    try {
      const r = await fetch(b + '/radar/list?id=' + encodeURIComponent(cur), { cache: 'no-store' }), j = await r.json();
      if (my !== token) return;
      if (!r.ok) { msg(r.status === 503 ? 'El servidor no pudo obtener acceso al radar del SMN: ' + (j.error || '') + '. Probá de nuevo en unos minutos.' : 'No pude traer el radar ahora (' + (j.error || r.status) + ').', true); return; }
      const list = (j.list || []).slice().reverse();            // el SMN manda la más nueva primero
      if (!list.length) { msg('El SMN no tiene imágenes disponibles de este radar en este momento.', true); return; }
      Object.keys(urls).forEach(k => { if (!list.includes(k)) { URL.revokeObjectURL(urls[k]); delete urls[k]; } });
      const wasLast = !frames.length || idx >= frames.length - 1;
      frames = list; $('rdSlide').max = frames.length - 1; show(wasLast ? frames.length - 1 : idx);
      let ok = 0;
      await Promise.all(frames.map(async f => {
        if (!urls[f]) {
          try { const x = await fetch(b + '/radar/img?f=' + encodeURIComponent(f)); if (!x.ok) throw 0; urls[f] = URL.createObjectURL(await x.blob()); } catch (e) { return; }
        }
        ok++; if (my === token && frames[idx] === f) show(idx);
      }));
      if (my !== token) return;
      show(frames.length - 1);
      msg(ok ? 'Fuente: Servicio Meteorológico Nacional (SMN). Se actualiza solo cada 5 minutos.' : 'No pude descargar las imágenes del radar.', !ok);
      if (ovOn) prerender();
    } catch (e) { if (my === token) msg('No pude conectar con el servidor del radar.', true); }
  }
  function openIt() { $('rdModal').classList.add('active'); $('rdMapBtn').style.display = GEO[cur] ? '' : 'none'; load(); clearInterval(refreshT); refreshT = setInterval(() => { if (!document.hidden && ($('rdModal').classList.contains('active') || ovOn)) load(); }, REFRESH); }
  function closeIt(keepTimer) { stop(); $('rdModal').classList.remove('active'); if (!keepTimer && !ovOn) clearInterval(refreshT); }

  function init() {
    const m = document.createElement('div'); m.id = 'rdModal'; m.className = 'modal-bg';
    m.innerHTML = '<div class="modal-box"><h2>📡 Radar meteorológico <button class="close-btn" id="rdClose">✕</button></h2>' +
      '<select id="rdSel" style="width:100%;min-height:44px;margin:6px 0"></select>' +
      '<div style="background:#1a1a1a;border-radius:10px;text-align:center;min-height:120px"><img id="rdImg" alt="Imagen de radar del SMN" style="max-width:100%;max-height:60dvh;display:block;margin:0 auto;border-radius:10px"></div>' +
      '<input id="rdSlide" type="range" min="0" max="0" value="0" style="width:100%;margin:8px 0 2px">' +
      '<p id="rdTime" class="note" style="margin:2px 0 6px;text-align:center"></p>' +
      '<div class="pre"><button class="btn" id="rdPlay">▶ Reproducir</button><button class="btn" id="rdRef">↻ Actualizar</button><button class="btn" id="rdMapBtn">🗺 Ver sobre el mapa</button><button class="btn" id="rdDiagBtn">🔧 Probar servidor</button></div>' +
      '<p class="msg" id="rdMsg" style="margin-top:8px"></p><pre id="rdDiag" style="display:none;white-space:pre-wrap;font:12px/1.45 monospace;background:#0a1a2c;border:1px solid #2a5f94;border-radius:8px;padding:8px;margin:8px 0 0;max-height:240px;overflow:auto;color:#cfe3f5"></pre></div>';
    document.body.appendChild(m);
    const BTN = 'min-width:46px;min-height:40px;padding:0 10px;border-radius:10px;border:1px solid #35b6ff !important;background:#0b4775 !important;color:#fff !important;font:700 18px/1 system-ui,sans-serif;cursor:pointer';
    const bar = document.createElement('div'); bar.id = 'rdBar';
    bar.style.cssText = 'display:none;position:fixed;left:8px;right:8px;bottom:calc(10px + env(safe-area-inset-bottom,0px));z-index:1100;background:rgba(7,24,43,.95);border:1px solid #2a5f94;border-radius:12px;padding:8px 10px;color:#fff;font:13px system-ui,sans-serif;max-width:560px;margin:0 auto';
    const grad = 'linear-gradient(90deg,' + LUT.filter(l => l[3] >= 10 && l[3] <= 70).map(l => 'rgb(' + l[0] + ',' + l[1] + ',' + l[2] + ')').join(',') + ')';
    bar.innerHTML = '<div style="display:flex;gap:8px;align-items:center"><b id="rdBarT" style="flex:1;font-size:12.5px"></b><button id="rdBarPlay" title="Reproducir / pausar" style="' + BTN + '">▶</button><button id="rdBarX" title="Cerrar el radar del mapa" style="' + BTN + '">✕</button></div>' +
      '<input id="rdBarSlide" type="range" min="0" max="0" value="0" style="width:100%;margin:6px 0">' +
      '<div style="display:flex;gap:8px;align-items:center"><span>Opacidad</span><input id="rdOp" type="range" min="20" max="100" value="75" style="flex:1"><select id="rdMin" style="min-height:36px"><option value="5">≥ 5 dBZ</option><option value="10">≥ 10 dBZ</option><option value="15">≥ 15 dBZ</option><option value="25">≥ 25 dBZ</option><option value="35">≥ 35 dBZ</option><option value="45">≥ 45 dBZ</option></select></div>' +
      '<div style="height:8px;border-radius:4px;margin:8px 0 2px;background:' + grad + '"></div><div style="display:flex;justify-content:space-between;font-size:11px;color:#9fb4c8"><span>10</span><span>25</span><span>40</span><span>55</span><span>70 dBZ</span></div>' +
      '<div id="rdBarL" style="font-size:11px;color:#9fb4c8;margin-top:4px"></div>';
    document.body.appendChild(bar);
    const sel = $('rdSel'); RADARS.forEach(([id, n]) => { const o = document.createElement('option'); o.value = id; o.textContent = n; sel.appendChild(o); });
    sel.onchange = () => { stop(); if (ovOn) overlayOff(); cur = sel.value; $('rdMapBtn').style.display = GEO[cur] ? '' : 'none'; frames = []; Object.keys(urls).forEach(k => { URL.revokeObjectURL(urls[k]); delete urls[k]; }); clearOvl(); $('rdImg').removeAttribute('src'); load(); };
    $('rdDiagBtn').onclick = diag; $('rdClose').onclick = () => closeIt(); $('rdPlay').onclick = play; $('rdRef').onclick = load; $('rdMapBtn').onclick = overlayOn;
    $('rdSlide').oninput = e => { stop(); show(+e.target.value); };
    $('rdBarSlide').oninput = e => { stop(); show(+e.target.value); }; $('rdBarPlay').onclick = play; $('rdBarX').onclick = overlayOff;
    $('rdOp').oninput = e => { ovOpacity = +e.target.value / 100; if (ovLayer) ovLayer.setOpacity(ovOpacity); };
    $('rdMin').onchange = e => { minDbz = +e.target.value; clearOvl(); ovLayer && paintOverlay(); prerender(); };
    m.addEventListener('click', e => { if (e.target === m) closeIt(); });
    const b = document.createElement('button'); b.id = 'rdBtn'; b.textContent = '📡 Radar SMN'; b.onclick = openIt;
    const ref = $('layerBtn'); if (ref && ref.parentNode) ref.parentNode.insertBefore(b, ref); else document.body.appendChild(b);
  }
  g.openRadar = openIt;
  g.addEventListener('load', () => { init(); if (/(^|[#&])diag\b/.test(location.hash)) { openIt(); setTimeout(diag, 400); } setTimeout(watchTick, 4000); setInterval(() => { if (!document.hidden) watchTick(); }, 5 * 60e3); document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - wLast > 6 * 60e3) watchTick(); }); });
  g.radarWatchNow = () => watchTick();
})(window);
