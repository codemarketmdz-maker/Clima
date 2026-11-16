/* Licencia: prueba gratis (con funciones Pro) y luego plan Básica o Pro, mensual / semestral / anual.
   VERSIÓN WEB: la prueba de 5 días se guarda en el navegador y la licencia se pide por WhatsApp. NO es antifraude (borrar los datos del sitio reinicia
   la prueba); la activación segura de claves necesita un servicio propio. En la app Android sigue la verificación nativa. */
(function (g) {
  'use strict';
  const WEB = !g.AndroidBridge;
  const $ = id => document.getElementById(id);
  const C = g.CM_CFG || {};
  const PLANS = [['M', 'Mensual', '1 mes'], ['S', 'Semestral', '6 meses'], ['A', 'Anual', '12 meses']];
  const TD0 = C.trialDays || 5, KEY = 'tmdz_web_trial_v2', TOK = 'tmdz_web_token_v3', SEEN = 'tmdz_first_seen';
  const lsg = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lss = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { } };
  const ck = n => { const m = document.cookie.match(new RegExp('(?:^|; )' + n + '=([^;]*)')); return m ? decodeURIComponent(m[1]) : null; };
  // ID de instalación: se guarda en dos lugares (localStorage + cookie) para que borrar uno no lo cambie
  function webDevice() {
    let id = lsg('tmdz_device_id') || ck('tmdz_did');
    if (!id || !/^TMDZ-[A-Z0-9]{12}$/.test(id)) id = 'TMDZ-' + ((g.crypto && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/-/g, '').slice(0, 12).toUpperCase());
    lss('tmdz_device_id', id); try { document.cookie = 'tmdz_did=' + id + '; max-age=63072000; path=/; SameSite=Lax'; } catch (e) { }
    return id;
  }
  const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  const sha = async s => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  const b64d = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  // Huella del dispositivo: no identifica a la persona; sirve para reconocer el mismo equipo aunque se borren los datos del sitio
  async function fingerprint() {
    const n = navigator, sc = screen; let gl = '', cv = '';
    try { const c = document.createElement('canvas'), x = c.getContext('webgl'), e = x && x.getExtension('WEBGL_debug_renderer_info'); gl = e ? x.getParameter(e.UNMASKED_RENDERER_WEBGL) + '|' + x.getParameter(e.UNMASKED_VENDOR_WEBGL) : ''; } catch (e) { }
    try { const c = document.createElement('canvas'); c.width = 200; c.height = 40; const x = c.getContext('2d'); x.textBaseline = 'top'; x.font = '16px Arial'; x.fillStyle = '#f60'; x.fillRect(10, 5, 80, 25); x.fillStyle = '#069'; x.fillText('TiempoMDZ ñ🌩 0123', 4, 8); cv = c.toDataURL().slice(-120); } catch (e) { }
    const tz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { return ''; } })();
    const lite = [n.platform, (n.languages || [n.language]).join(','), sc.width + 'x' + sc.height, sc.colorDepth, tz].join('|');
    const full = [lite, n.userAgent, n.hardwareConcurrency, n.deviceMemory, n.maxTouchPoints, g.devicePixelRatio, gl, cv].join('||');
    return { fp: await sha(full), fpl: await sha(lite) };
  }
  let pubKey = null;
  async function verify(tok, device) {
    if (!pubKey) pubKey = await crypto.subtle.importKey('jwk', C.licPub, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const [body, sig] = String(tok).split('.'); if (!body || !sig) return null;
    if (!await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pubKey, b64d(sig), new TextEncoder().encode(body))) return null;
    const p = JSON.parse(new TextDecoder().decode(b64d(body)));
    return p.device === device ? p : null;
  }
  // Estado a partir de un token firmado. La hora sale del servidor (+ el tiempo transcurrido), no del reloj del celular:
  // atrasar la fecha del equipo no estira la prueba.
  function fromToken(p, fetchedAt, device) {
    const now = p.now + Math.max(0, Date.now() - fetchedAt), left = p.expiry - now;
    if (now > p.exp) return null;      // token vencido: hay que consultar al servidor
    if (p.state === 'licensed') return left > 0 ? { state: 'licensed', tier: p.tier, plan: p.plan, msLeft: left, expiry: p.expiry, device } : { state: 'expired', reason: 'license', tier: 'basic', expiry: p.expiry, msLeft: 0, device };
    if (p.state === 'trial' && left > 0) return { state: 'trial', tier: 'pro', msLeft: left, device };
    return { state: 'expired', reason: p.reason || 'trial', tier: 'basic', expiry: p.expiry, msLeft: 0, device };
  }
  function localStatus() {         // sin servidor configurado (licUrl vacío): prueba solo local, NO segura
    let x = null; try { x = JSON.parse(lsg(KEY) || 'null'); } catch (e) { }
    if (!x || !x.started) { x = { started: Date.now() }; lss(KEY, JSON.stringify(x)); }
    const left = x.started + TD0 * 864e5 - Date.now();
    return left > 0 ? { state: 'trial', tier: 'pro', msLeft: left, device: webDevice() } : { state: 'expired', reason: 'trial', tier: 'basic', msLeft: 0, device: webDevice() };
  }
  let webSt = null, syncing = false;
  function cachedStatus(device) {
    if (!C.licUrl) return localStatus();
    try { const c = JSON.parse(lsg(TOK) || 'null'); if (c && c.device === device) { const s = fromToken(c.p, c.at, device); if (s) return s; } } catch (e) { }
    // Sin respuesta del servidor ni token vigente: 24 h de gracia desde la primera vez, para no dejar sin avisos por una caída
    let f = Number(lsg(SEEN)) || 0; if (!f) { f = Date.now(); lss(SEEN, String(f)); }
    const left = f + 864e5 - Date.now();
    return left > 0 ? { state: 'trial', tier: 'pro', msLeft: left, device, pending: true } : { state: 'expired', reason: 'offline', tier: 'basic', msLeft: 0, device };
  }
  async function webSync() {
    if (!C.licUrl || !C.licPub || syncing) return; syncing = true;
    try {
      const device = webDevice(), f = await fingerprint();
      const r = await fetch(String(C.licUrl).replace(/\/+$/, '') + '/status', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ device, fp: f.fp, fpl: f.fpl }), cache: 'no-store' });
      const j = await r.json(), p = j && j.token ? await verify(j.token, device) : null;
      if (p) { lss(TOK, JSON.stringify({ device, p, at: Date.now() })); lss(SEEN, String(Date.now())); }
    } catch (e) { /* sin conexión: se usa el último token firmado */ }
    syncing = false; webSt = null; try { g.dispatchEvent(new Event('cm-lic-sync')); } catch (e) { }
  }
  const J = (f, a) => { if (WEB) return f === 'licenseStatus' ? (webSt = cachedStatus(webDevice())) : { ok: false, msg: 'La activación de claves requiere un servicio seguro de licencias; en la versión web la licencia se pide por WhatsApp.' }; try { return JSON.parse(a === undefined ? AndroidBridge[f]() : AndroidBridge[f](a)); } catch (e) { return null; } };
  const TD = C.trialDays || 5;
  const TIERS = { B: 'Básica', P: 'Pro' };
  let st = null, shownTier = 'P';
  const isPro = () => !!st && st.state !== 'expired' && st.tier === 'pro';
  const tierName = () => st && st.tier === 'pro' ? 'PRO' : 'BÁSICA';
  // Tabla "qué incluye cada plan" (los números salen de la configuración, así que siempre coincide con lo que la app hace)
  function compareRows() {
    const lim = t => Object.assign({}, (g.TIER_LIMITS && g.TIER_LIMITS[t]) || {}, (C.limits && C.limits[t]) || {});
    const B = lim('basic'), P = lim('pro'), Y = '✅', N = '🔒';
    const yn = (b, p) => [b ? Y : N, p ? Y : N];
    return [
      ['Avisos oficiales del Servicio Meteorológico y de Contingencias Mendoza', Y, Y],
      ['Avisos de tormenta fuerte, viento fuerte y sismos', Y, Y],
      ['Sonido propio para cada tipo de aviso', Y, Y],
      ['Mapa con viento, nubes, lluvia y temperatura', Y, Y],
      ['Fincas o lugares guardados', String(B.fincas), String(P.fincas)],
      ['Pronóstico', B.forecastDays + ' días', P.forecastDays + ' días'],
      ['Aviso de heladas'].concat(yn(B.frost, P.frost)),
      ['Aviso específico de granizo' + (B.hail ? '' : ' (en Básica avisa como "tormenta fuerte")')].concat(yn(B.hail, P.hail)),
      ['Tormenta en camino, con minutos de llegada'].concat(yn(B.approach, P.approach))
    ];
  }
  function compareTable() {
    const wrap = document.createElement('div'); wrap.className = 'lic-cmp';
    const head = document.createElement('div'); head.className = 'cr ch';
    head.innerHTML = '<span>Qué incluye cada plan</span><span>Básica</span><span class="pro">Pro ⭐</span>';
    wrap.appendChild(head);
    compareRows().forEach(r => {
      const d = document.createElement('div'); d.className = 'cr';
      const a = document.createElement('span'), b = document.createElement('span'), c = document.createElement('span');
      a.textContent = r[0]; b.textContent = r[1]; c.textContent = r[2]; c.className = 'pro';
      d.appendChild(a); d.appendChild(b); d.appendChild(c); wrap.appendChild(d);
    });
    return wrap;
  }

  function left(ms) {
    const m = Math.max(0, Math.floor(ms / 60000)), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60);
    return d >= 1 ? d + ' d ' + h + ' h' : h >= 1 ? h + ' h ' + (m % 60) + ' min' : (m % 60) + ' min';
  }
  const fdate = ms => new Date(ms).toLocaleDateString('es-AR');

  function waLink(plan, tier) {
    const p = PLANS.find(x => x[0] === plan);
    const t = 'Hola ' + (C.brand || '') + ', quiero la licencia ' + TIERS[tier].toUpperCase() + ' ' + p[1].toUpperCase() + ' de TiempoMDZ. Mi ID de celular es: ' + st.device;
    return 'https://wa.me/' + (C.waNumber || '') + '?text=' + encodeURIComponent(t);
  }

  function paintBtn() {
    const b = $('licBtn'), tag = $('licTag'); if (!st) return;
    let txt, cls;
    if (st.state === 'licensed') { txt = tierName() + ' · ' + left(st.msLeft).split(' ').slice(0, 2).join(' '); cls = st.msLeft < 7 * 864e5 ? 'warn' : (st.tier === 'pro' ? 'pro' : 'ok'); }
    else if (st.state === 'trial') { txt = 'PRUEBA · ' + left(st.msLeft).split(' ').slice(0, 2).join(' '); cls = 'warn'; }
    else { txt = 'VENCIDA'; cls = 'bad'; }
    if (tag) { tag.style.display = 'inline-flex'; tag.className = 'lic-tag ' + cls; tag.textContent = txt; tag.title = 'Tu licencia'; }
    if (b) b.textContent = '🔑 ' + txt;
  }

  function paintModal() {
    if (!st) return;
    const blocked = st.state === 'expired', box = $('licStatus');
    $('licClose').style.display = blocked ? 'none' : '';
    $('licModal').classList.toggle('lock', blocked);
    $('licSos').style.display = blocked ? '' : 'none';
    let t, c;
    if (st.state === 'licensed') { t = '✅ Licencia ' + tierName() + ' ' + (st.plan === 'M' ? 'mensual' : st.plan === 'S' ? 'semestral' : st.plan === 'A' ? 'anual' : '') + ' activa · vence el ' + fdate(st.expiry) + ' (' + left(st.msLeft) + ')'; c = 'ok'; }
    else if (st.state === 'trial') { t = '🎁 Prueba gratis con todas las funciones Pro: te quedan ' + left(st.msLeft) + '. Después necesitás una licencia Básica o Pro para seguir recibiendo avisos.'; c = 'warn'; }
    else if (st.reason === 'offline') { t = '📡 No pude verificar tu licencia con el servidor. Conectate a internet para seguir (tus avisos se reanudan al verificar).'; c = 'bad'; }
    else if (st.reason === 'clock') { t = '⏰ La fecha/hora del celular está atrasada. Corregila (Ajustes → Fecha y hora automática) para seguir.'; c = 'bad'; }
    else { t = st.reason === 'license' ? '⛔ Tu licencia venció el ' + fdate(st.expiry) + '. Renovala para volver a recibir avisos.' : '⛔ Terminó la prueba gratis de ' + TD + ' días. Elegí un plan para seguir recibiendo avisos.'; c = 'bad'; }
    box.textContent = t; box.className = 'msg ' + c;
    $('licDev').textContent = st.device;
  }

  function buildPlans() {
    const box = $('licPlans'); box.innerHTML = '';
    const tabs = document.createElement('div'); tabs.className = 'lic-tabs';
    ['B', 'P'].forEach(t => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'lic-tab' + (t === shownTier ? ' on' : '');
      b.textContent = t === 'P' ? 'Pro ⭐' : 'Básica'; b.onclick = () => { hap(); shownTier = t; buildPlans(); };
      tabs.appendChild(b);
    });
    box.appendChild(compareTable());
    const pick = document.createElement('p'); pick.className = 'lic-pick'; pick.textContent = 'Elegí el plan que querés pedir:';
    box.appendChild(pick); box.appendChild(tabs);
    const note = document.createElement('p'); note.className = 'note'; note.textContent = 'Los avisos oficiales del SMN se muestran siempre, con cualquier licencia. Durante la prueba gratis tenés todo lo de Pro.';
    box.appendChild(note);
    PLANS.forEach(([k, name, dur]) => {
      const d = document.createElement('div'); d.className = 'lp';
      const price = (C.prices && C.prices[shownTier] && C.prices[shownTier][k]) || '';
      d.innerHTML = '<div class="lpt"><b></b><small></small></div><div class="lpb"></div>';
      d.querySelector('b').textContent = TIERS[shownTier] + ' ' + name.toLowerCase() + (price ? ' · ' + price : '');
      d.querySelector('small').textContent = dur;
      const bx = d.querySelector('.lpb'), link = C.mpLinks && C.mpLinks[shownTier] && C.mpLinks[shownTier][k];
      if (link) { const a = document.createElement('button'); a.className = 'btn g'; a.textContent = '💳 Pagar'; a.onclick = () => { hap(); window.open(link, '_blank'); }; bx.appendChild(a); }
      const w = document.createElement('button'); w.className = 'btn'; w.textContent = '💬 Pedir por WhatsApp';
      w.onclick = () => { hap(); window.open(waLink(k, shownTier), '_blank'); }; bx.appendChild(w);
      box.appendChild(d);
    });
  }

  function refresh() {
    const s = J('licenseStatus'); if (!s) return;
    const was = st && st.state, wasTier = g.CM_TIER; st = s;
    g.CM_TIER = (s.state !== 'expired' && s.tier === 'pro') ? 'pro' : 'basic';
    if (wasTier !== g.CM_TIER) { try { g.dispatchEvent(new Event('cm-tier')); } catch (e) { } }
    paintBtn(); paintModal();
    if (s.state === 'expired' && was !== 'expired') open();
    if (s.state !== 'expired' && was === 'expired') $('licModal').classList.remove('active');
  }
  g.openLicense = () => { refresh(); open(); };
  function open() { buildPlans(); paintModal(); $('licModal').classList.add('active'); }

  function init() {
    const openIt = () => { hap(); refresh(); open(); };
    $('licBtn').onclick = openIt; if ($('licTag')) $('licTag').onclick = openIt;
    $('licClose').onclick = () => $('licModal').classList.remove('active');
    $('licSos').onclick = () => { if (typeof openSOS === 'function') openSOS(''); };
    $('licCopy').onclick = () => { hap(); if (WEB) { try { navigator.clipboard.writeText(st.device).then(() => fb($('licCopy'), 'ok', '✔ Copiado', 1800), () => { $('licMsg').textContent = 'ID: ' + st.device; }); } catch (e) { $('licMsg').textContent = 'ID: ' + st.device; } } else { AndroidBridge.copyText(st.device); fb($('licCopy'), 'ok', '✔ Copiado', 1800); } };
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
    if (WEB) { ['licPaste', 'licKey', 'licGo'].forEach(i => { const e = $(i); if (e) e.style.display = 'none'; }); const t = document.querySelector('#licModal .sec:nth-of-type(2)'); const secs = document.querySelectorAll('#licModal .sec'); if (secs[1]) secs[1].style.display = 'none'; const m = $('licMsg'); if (m) { m.textContent = ''; } }
    if (WEB) { g.addEventListener('cm-lic-sync', refresh); webSync(); setInterval(() => { if (!document.hidden) webSync(); }, 3 * 3600e3); document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); }); }
    refresh(); setInterval(() => { if (!document.hidden) refresh(); }, 60000);
    const r0 = g.onNativeResume; g.onNativeResume = () => { if (r0) r0(); refresh(); };
  }
  g.addEventListener('load', init);
})(window);
