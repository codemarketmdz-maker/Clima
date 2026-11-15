/* Licencia: prueba gratis de 3 días y luego plan mensual / semestral / anual.
   La verificación real la hace la app nativa (clave firmada); esto es la pantalla. Solo corre dentro de la app Android. */
(function (g) {
  'use strict';
  if (!g.AndroidBridge) return;
  const $ = id => document.getElementById(id);
  const C = g.CM_CFG || {};
  const PLANS = [['M', 'Mensual', '1 mes'], ['S', 'Semestral', '6 meses'], ['A', 'Anual', '12 meses']];
  const J = (f, a) => { try { return JSON.parse(a === undefined ? AndroidBridge[f]() : AndroidBridge[f](a)); } catch (e) { return null; } };
  let st = null;

  function left(ms) {
    const m = Math.max(0, Math.floor(ms / 60000)), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60);
    return d >= 1 ? d + ' d ' + h + ' h' : h >= 1 ? h + ' h ' + (m % 60) + ' min' : (m % 60) + ' min';
  }
  const fdate = ms => new Date(ms).toLocaleDateString('es-AR');

  function waLink(plan) {
    const p = PLANS.find(x => x[0] === plan);
    const t = 'Hola ' + (C.brand || '') + ', quiero la licencia ' + p[1].toUpperCase() + ' de TiempoMDZ. Mi ID de celular es: ' + st.device;
    return 'https://wa.me/' + (C.waNumber || '') + '?text=' + encodeURIComponent(t);
  }

  function paintBtn() {
    const b = $('licBtn'); if (!b || !st) return;
    b.style.display = 'inline-block'; b.className = '';
    const two = (a, c) => { b.innerHTML = '<small></small><b></b>'; b.firstChild.textContent = a; b.lastChild.textContent = c; };
    if (st.state === 'licensed') {
      const soon = st.msLeft < 7 * 864e5;
      two(soon ? '🔑 Vence en' : '🔑 Licencia', left(st.msLeft));
      b.classList.add(soon ? 'warn' : 'ok');
    } else if (st.state === 'trial') { two('🔑 Prueba gratis', left(st.msLeft)); b.classList.add('warn'); }
    else { two('🔑 Licencia', 'Vencida'); b.classList.add('bad'); }
  }

  function paintModal() {
    if (!st) return;
    const blocked = st.state === 'expired', box = $('licStatus');
    $('licClose').style.display = blocked ? 'none' : '';
    $('licModal').classList.toggle('lock', blocked);
    $('licSos').style.display = blocked ? '' : 'none';
    let t, c;
    if (st.state === 'licensed') { t = '✅ Licencia ' + (st.plan === 'M' ? 'mensual' : st.plan === 'S' ? 'semestral' : st.plan === 'A' ? 'anual' : '') + ' activa · vence el ' + fdate(st.expiry) + ' (' + left(st.msLeft) + ')'; c = 'ok'; }
    else if (st.state === 'trial') { t = '🎁 Prueba gratis: te quedan ' + left(st.msLeft) + '. Después necesitás una licencia para seguir recibiendo avisos.'; c = 'warn'; }
    else if (st.reason === 'clock') { t = '⏰ La fecha/hora del celular está atrasada. Corregila (Ajustes → Fecha y hora automática) para seguir.'; c = 'bad'; }
    else { t = st.reason === 'license' ? '⛔ Tu licencia venció el ' + fdate(st.expiry) + '. Renovala para volver a recibir avisos.' : '⛔ Terminó la prueba gratis de 3 días. Elegí un plan para seguir recibiendo avisos.'; c = 'bad'; }
    box.textContent = t; box.className = 'msg ' + c;
    $('licDev').textContent = st.device;
  }

  function buildPlans() {
    const box = $('licPlans'); box.innerHTML = '';
    PLANS.forEach(([k, name, dur]) => {
      const d = document.createElement('div'); d.className = 'lp';
      const price = (C.prices && C.prices[k]) || '';
      d.innerHTML = '<div class="lpt"><b></b><small></small></div><div class="lpb"></div>';
      d.querySelector('b').textContent = name + (price ? ' · ' + price : '');
      d.querySelector('small').textContent = dur;
      const bx = d.querySelector('.lpb'), link = C.mpLinks && C.mpLinks[k];
      if (link) { const a = document.createElement('button'); a.className = 'btn g'; a.textContent = '💳 Pagar'; a.onclick = () => { hap(); window.open(link, '_blank'); }; bx.appendChild(a); }
      const w = document.createElement('button'); w.className = 'btn'; w.textContent = '💬 Pedir por WhatsApp';
      w.onclick = () => { hap(); window.open(waLink(k), '_blank'); }; bx.appendChild(w);
      box.appendChild(d);
    });
  }

  function refresh() {
    const s = J('licenseStatus'); if (!s) return;
    const was = st && st.state; st = s; paintBtn(); paintModal();
    if (s.state === 'expired' && was !== 'expired') open();
    if (s.state !== 'expired' && was === 'expired') $('licModal').classList.remove('active');
  }
  function open() { buildPlans(); paintModal(); $('licModal').classList.add('active'); }

  function init() {
    $('licBtn').onclick = () => { hap(); refresh(); open(); };
    $('licClose').onclick = () => $('licModal').classList.remove('active');
    $('licSos').onclick = () => { if (typeof openSOS === 'function') openSOS(''); };
    $('licCopy').onclick = () => { hap(); AndroidBridge.copyText(st.device); fb($('licCopy'), 'ok', '✔ Copiado', 1800); };
    $('licPaste').onclick = () => { hap(); const t = AndroidBridge.readClipboard(); if (t) { $('licKey').value = t.trim(); fb($('licPaste'), 'ok', '✔ Pegado', 1500); } else fb($('licPaste'), 'warn', 'Portapapeles vacío', 1800); };
    $('licGo').onclick = () => {
      const k = $('licKey').value.trim(), b = $('licGo');
      if (!k) { fb(b, 'warn', 'Pegá la clave', 1800); return; }
      hap(); fb(b, 'busy', '⏳ Verificando…');
      setTimeout(() => {
        const r = J('activateLicense', k) || { ok: false, msg: 'No se pudo verificar.' };
        const m = $('licMsg'); m.textContent = r.msg; m.className = 'msg ' + (r.ok ? 'ok' : 'bad');
        fb(b, r.ok ? 'ok' : 'bad', r.ok ? '✔ Activada' : '✖ No válida', 2500);
        if (r.ok) { $('licKey').value = ''; refresh(); if (st.state !== 'expired') setTimeout(() => $('licModal').classList.remove('active'), 1800); }
      }, 400);
    };
    refresh(); setInterval(refresh, 30000);
    const r0 = g.onNativeResume; g.onNativeResume = () => { if (r0) r0(); refresh(); };
  }
  g.addEventListener('load', init);
})(window);
