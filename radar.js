/* Radar del SMN en TiempoMDZ (versión web).
   Muestra las últimas imágenes de radar (una cada 10 min) con animación, a través del Worker propio (licencias/worker.js, rutas /radar/list y /radar/img).
   Necesita CM_CFG.licUrl (o CM_CFG.proxy) y el Secret SMN_TOKEN en el Worker. Fuente de los datos: Servicio Meteorológico Nacional. */
(function (g) {
  'use strict';
  const C = g.CM_CFG || {}, $ = id => document.getElementById(id);
  const base = () => String(C.proxy || C.licUrl || '').replace(/\/+$/, '');
  const RADARS = [['RMA19_240', 'Santa Rosa (Mendoza)'], ['COMP_CEN', 'Mosaico Centro'], ['COMP_ARG', 'Mosaico Argentina'], ['RMA15_240', 'Patquía (La Rioja)'],
    ['RMA16_240', 'Villa Reynolds (San Luis)'], ['ANG_240', 'Anguil (La Pampa)'], ['RMA7_240', 'Neuquén (Neuquén)']];
  const REFRESH = 5 * 60e3;
  let frames = [], urls = {}, idx = 0, timer = null, refreshT = null, playing = false, token = 0, cur = RADARS[0][0];

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
    const f = frames[idx], u = urls[f];
    $('rdSlide').value = idx;
    $('rdTime').textContent = when(f) + '  ·  imagen ' + (idx + 1) + ' de ' + frames.length;
    if (u) { $('rdImg').src = u; $('rdImg').style.opacity = 1; } else $('rdImg').style.opacity = .35;
  }
  function stop() { playing = false; clearTimeout(timer); $('rdPlay').textContent = '▶ Reproducir'; }
  function step() {
    if (!playing) return;
    show(idx >= frames.length - 1 ? 0 : idx + 1);
    timer = setTimeout(step, idx === frames.length - 1 ? 1800 : 600);
  }
  function play() { if (playing) { stop(); return; } playing = true; $('rdPlay').textContent = '⏸ Pausar'; timer = setTimeout(step, 300); }

  async function load() {
    const my = ++token, b = base();
    if (!b) { msg('Falta configurar el servidor (licUrl en config.js) para ver el radar.', true); return; }
    msg('Buscando las últimas imágenes…');
    try {
      const r = await fetch(b + '/radar/list?id=' + encodeURIComponent(cur), { cache: 'no-store' }), j = await r.json();
      if (my !== token) return;
      if (!r.ok) { msg(r.status === 503 ? 'El servidor no pudo obtener acceso al radar del SMN. Probá de nuevo en unos minutos.' : 'No pude traer el radar ahora (' + (j.error || r.status) + ').', true); return; }
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
    } catch (e) { if (my === token) msg('No pude conectar con el servidor del radar.', true); }
  }
  function openIt() { $('rdModal').classList.add('active'); load(); clearInterval(refreshT); refreshT = setInterval(() => { if (!document.hidden && $('rdModal').classList.contains('active')) load(); }, REFRESH); }
  function closeIt() { stop(); $('rdModal').classList.remove('active'); clearInterval(refreshT); }

  function init() {
    const m = document.createElement('div'); m.id = 'rdModal'; m.className = 'modal-bg';
    m.innerHTML = '<div class="modal-box"><h2>📡 Radar meteorológico <button class="close-btn" id="rdClose">✕</button></h2>' +
      '<select id="rdSel" style="width:100%;min-height:44px;margin:6px 0"></select>' +
      '<div style="background:#1a1a1a;border-radius:10px;text-align:center;min-height:120px"><img id="rdImg" alt="Imagen de radar del SMN" style="max-width:100%;max-height:68dvh;display:block;margin:0 auto;border-radius:10px"></div>' +
      '<input id="rdSlide" type="range" min="0" max="0" value="0" style="width:100%;margin:8px 0 2px">' +
      '<p id="rdTime" class="note" style="margin:2px 0 6px;text-align:center"></p>' +
      '<div class="pre"><button class="btn" id="rdPlay">▶ Reproducir</button><button class="btn" id="rdRef">↻ Actualizar</button></div>' +
      '<p class="msg" id="rdMsg" style="margin-top:8px"></p></div>';
    document.body.appendChild(m);
    const sel = $('rdSel'); RADARS.forEach(([id, n]) => { const o = document.createElement('option'); o.value = id; o.textContent = n; sel.appendChild(o); });
    sel.onchange = () => { stop(); cur = sel.value; frames = []; Object.keys(urls).forEach(k => { URL.revokeObjectURL(urls[k]); delete urls[k]; }); $('rdImg').removeAttribute('src'); load(); };
    $('rdClose').onclick = closeIt; $('rdPlay').onclick = play; $('rdRef').onclick = load;
    $('rdSlide').oninput = e => { stop(); show(+e.target.value); };
    m.addEventListener('click', e => { if (e.target === m) closeIt(); });
    const b = document.createElement('button'); b.id = 'rdBtn'; b.textContent = '📡 Radar SMN'; b.onclick = openIt;
    const ref = $('layerBtn'); if (ref && ref.parentNode) ref.parentNode.insertBefore(b, ref); else document.body.appendChild(b);
  }
  g.openRadar = openIt;
  g.addEventListener('load', init);
})(window);
