/* TiempoMDZ · servidor de licencias (Cloudflare Workers + KV, plan gratuito).
   Qué resuelve: la prueba gratis y las licencias las decide el SERVIDOR, no el navegador.
   - Prueba de 5 días: se registra por (1) ID de instalación, (2) huella del navegador/dispositivo y (3) IP. Borrar los datos del sitio,
     usar otra pestaña/modo incógnito o cambiar el ID no reinicia la prueba: se reconoce por huella o por IP + huella básica.
   - Respuesta firmada (ECDSA P-256): la página verifica la firma con la clave PÚBLICA; no se puede falsificar editando el navegador.
   - Licencias: las carga el dueño (admin.html) cuando confirma el pago; no hay claves que se puedan compartir.
   - La IP la lee el servidor (CF-Connecting-IP) y solo se guarda un hash con sal: no se almacena la IP.
   Configuración (Settings del Worker):
     KV namespace con nombre LIC · Secrets: SIGN_PRIVATE (JWK privada), ADMIN_KEY, IP_SALT · Variable: ALLOWED_ORIGIN (ej. https://usuario.github.io) */
const TRIAL_DAYS = 5, TOKEN_HOURS = 72, DAY = 864e5, KEEP = 400 * 86400;
const PLAN_DAYS = { M: 30, S: 182, A: 365 };

const enc = new TextEncoder();
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
async function sha(s) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)))].map(b => b.toString(16).padStart(2, '0')).join(''); }
function ipKey(ip) {            // IPv4 completa; IPv6 por /64 (el usuario rota los últimos 64 bits)
  if (ip.includes(':')) return ip.split(':').slice(0, 4).join(':');
  return ip;
}
function same(a, b) { a = String(a); b = String(b); if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }
let keyCache = null;
async function signer(env) {
  if (!keyCache) keyCache = await crypto.subtle.importKey('jwk', JSON.parse(env.SIGN_PRIVATE), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  return keyCache;
}
async function sign(env, payload) {
  const body = b64u(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, await signer(env), enc.encode(body));
  return body + '.' + b64u(sig);
}
const validId = s => /^TMDZ-[A-Z0-9]{12}$/.test(s || '');
const validHex = s => /^[a-f0-9]{16,64}$/.test(s || '');

async function status(req, env) {
  let b = {}; try { b = JSON.parse(await req.text()); } catch (e) { }
  if (!validId(b.device) || !validHex(b.fp) || !validHex(b.fpl)) return { error: 'datos inválidos', code: 400 };
  const now = Date.now(), salt = env.IP_SALT || '';
  const ipH = (await sha(salt + '|ip|' + ipKey(req.headers.get('CF-Connecting-IP') || ''))).slice(0, 32);
  const fpH = (await sha(salt + '|fp|' + b.fp)).slice(0, 32), flH = (await sha(salt + '|fl|' + b.fpl)).slice(0, 32);
  const base = { v: 1, device: b.device, now, exp: now + TOKEN_HOURS * 3600e3 };

  const lic = await env.LIC.get('lic:' + b.device, 'json');
  if (lic && lic.exp > now) return { token: await sign(env, { ...base, state: 'licensed', tier: lic.tier, plan: lic.plan, expiry: lic.exp }) };

  // Prueba: se reconoce al mismo dispositivo por ID, por huella o por IP + huella básica.
  let t = await env.LIC.get('dev:' + b.device, 'json'), via = t ? 'id' : '';
  if (!t) { t = await env.LIC.get('fp:' + fpH, 'json'); if (t) via = 'huella'; }
  if (!t) { const r = await env.LIC.get('ip:' + ipH, 'json'); if (r && r.fl === flH) { t = r; via = 'ip'; } }
  const rec = { start: t ? t.start : now, fp: fpH, ip: ipH, fl: flH, device: b.device };
  if (!t || via !== 'id') await env.LIC.put('dev:' + b.device, JSON.stringify(rec), { expirationTtl: KEEP });
  if (!t) { await env.LIC.put('fp:' + fpH, JSON.stringify(rec), { expirationTtl: KEEP }); await env.LIC.put('ip:' + ipH, JSON.stringify(rec), { expirationTtl: KEEP }); }
  const end = rec.start + TRIAL_DAYS * DAY;
  if (now < end) return { token: await sign(env, { ...base, state: 'trial', tier: 'pro', expiry: end, start: rec.start }) };
  return { token: await sign(env, { ...base, state: 'expired', reason: lic ? 'license' : 'trial', tier: 'basic', expiry: lic ? lic.exp : end, start: rec.start }) };
}

async function admin(req, env, path) {
  const auth = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!env.ADMIN_KEY || !same(auth, env.ADMIN_KEY)) return { error: 'no autorizado', code: 401 };
  let b = {}; if (req.method === 'POST') { try { b = JSON.parse(await req.text()); } catch (e) { } }
  if (path === '/admin/list') {
    const l = await env.LIC.list({ prefix: 'lic:', limit: 200 }), out = [];
    for (const k of l.keys) { const v = await env.LIC.get(k.name, 'json'); if (v) out.push({ device: k.name.slice(4), ...v }); }
    return { licenses: out.sort((x, y) => y.exp - x.exp) };
  }
  if (!validId(b.device)) return { error: 'ID de instalación inválido (formato TMDZ-XXXXXXXXXXXX)', code: 400 };
  if (path === '/admin/grant') {
    const days = Number(b.days) || PLAN_DAYS[b.plan]; if (!days || days < 1 || days > 800) return { error: 'plan o días inválidos', code: 400 };
    const tier = b.tier === 'basic' ? 'basic' : 'pro', old = await env.LIC.get('lic:' + b.device, 'json'), from = Math.max(Date.now(), old && old.exp || 0);
    const rec = { tier, plan: b.plan || 'X', exp: from + days * DAY, at: Date.now(), note: String(b.note || '').slice(0, 80) };   // renovar suma días
    await env.LIC.put('lic:' + b.device, JSON.stringify(rec)); return { ok: true, ...rec };
  }
  if (path === '/admin/revoke') { await env.LIC.delete('lic:' + b.device); return { ok: true }; }
  if (path === '/admin/reset-trial') {     // vuelve a dar prueba a ese dispositivo (p. ej. dos teléfonos iguales en la misma red)
    const r = await env.LIC.get('dev:' + b.device, 'json');
    await env.LIC.delete('dev:' + b.device);
    if (r) { await env.LIC.delete('fp:' + r.fp); await env.LIC.delete('ip:' + r.ip); }
    return { ok: true, existia: !!r };
  }
  return { error: 'ruta desconocida', code: 404 };
}


/* ---------- Proxy de fuentes oficiales (SMN, INPRES, METAR, Contingencias) ----------
   La página no puede leerlas directo (CORS). El Worker las pide desde el servidor de Cloudflare más cercano y devuelve el texto con CORS.
   Solo GET, solo estos sitios, y solo desde ALLOWED_ORIGIN. Los ZIP del SMN se descomprimen acá. */
const PROXY_HOSTS = /^(?:[\w-]+\.)*(?:smn\.gob\.ar|inpres\.gob\.ar|aviationweather\.gov|mendoza\.gov\.ar|tgftp\.ncep\.noaa\.gov|fepedi\.evolus\.com\.ar)$/i;
async function zipFirst(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let e = buf.length - 22; while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error('zip');
  let p = dv.getUint32(e + 16, true);
  for (let n = dv.getUint16(e + 10, true); n > 0; n--) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('zip');
    const method = dv.getUint16(p + 10, true), cs = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nl)); p += 46 + nl + xl + cl;
    if (name.endsWith('/')) continue;
    const st = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true), raw = buf.subarray(st, st + cs);
    if (method === 0) return raw;
    const out = new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw')));
    return new Uint8Array(await out.arrayBuffer());
  }
  throw new Error('zip vacío');
}
function toText(buf, charset) {
  if (charset) { try { return new TextDecoder(charset).decode(buf); } catch (e) { } }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (e) { return new TextDecoder('windows-1252').decode(buf); }
}
async function proxyFetch(req, cors) {
  let target; try { target = new URL(new URL(req.url).searchParams.get('url')); } catch (e) { return new Response('url inválida', { status: 400, headers: cors }); }
  if (!/^https?:$/.test(target.protocol) || !PROXY_HOSTS.test(target.hostname)) return new Response('host no permitido', { status: 403, headers: cors });
  try {
    const up = await fetch(target.href, { headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Mobile Safari/537.36', 'Accept': '*/*' }, cf: { cacheTtl: 60, cacheEverything: true }, redirect: 'follow' });
    const h = { ...cors, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=60' };
    if (!up.ok) return new Response('upstream ' + up.status, { status: up.status === 429 || up.status === 503 ? up.status : 502, headers: h });
    let buf = new Uint8Array(await up.arrayBuffer());
    const ct = up.headers.get('content-type') || '';
    if (/zip/i.test(ct) || /zipopendata/i.test(target.href) || (buf[0] === 0x50 && buf[1] === 0x4b)) buf = await zipFirst(buf);
    return new Response(toText(buf, (ct.match(/charset=([^;\s]+)/i) || [])[1]), { status: 200, headers: h });
  } catch (e) { return new Response('error ' + String(e && e.message || e).slice(0, 60), { status: 502, headers: cors }); }
}

/* ---------- Radares del SMN (lista de imágenes e imágenes) ----------
   La lista de imágenes del SMN (ws1.smn.gob.ar/v1/images/radar/<ID>) pide un token. El SMN confirmó que el uso es público y que no tiene otro token:
   el Worker obtiene el mismo token que su página de radar entrega a cualquier visitante y lo renueva solo cuando vence.
   Si el SMN te da uno propio, guardalo como Secret SMN_TOKEN del Worker y se usa ese. El token nunca va en el código de la página.
   Las respuestas se guardan 2 min (lista) y 5 min (imágenes) en la red de Cloudflare: muchos usuarios no multiplican los pedidos al SMN. */
const RADAR_ID = /^(?:COMP_(?:ARG|CEN|NOR)|RMA\d{1,2}_240|ANG_240|PAR_240|PER_240)$/;
const RADAR_FILE = /^[A-Za-z0-9_]{6,80}\.png$/;
let tokCache = { v: '', until: 0 }, tokWhy = '';
const SMN_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
function jwtExp(t) { try { const p = JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); return p.exp ? p.exp * 1000 : 0; } catch (e) { return 0; } }
async function smnToken(env, force) {
  if (env.SMN_TOKEN) return env.SMN_TOKEN;
  const now = Date.now();
  if (!force && tokCache.v && now < tokCache.until) return tokCache.v;
  tokWhy = '';
  const r = await fetch('https://www.smn.gob.ar/radar', { headers: { 'User-Agent': SMN_UA, 'Accept': 'text/html,application/xhtml+xml', 'Accept-Language': 'es-AR,es;q=0.9' } });
  if (!r.ok) { tokWhy = 'la página del SMN respondió ' + r.status; return ''; }
  const html = await r.text();
  const m = /setItem\(\s*['"]token['"]\s*,\s*['"]([A-Za-z0-9_\-.]+)['"]/.exec(html) || /(eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/.exec(html);
  if (!m) { tokWhy = 'no encontré el token en la página del SMN (' + html.length + ' bytes)'; return ''; }
  const exp = jwtExp(m[1]);
  tokCache = { v: m[1], until: Math.min(exp ? exp - 120e3 : now + 20 * 60e3, now + 6 * 3600e3) };
  return m[1];
}
async function radarRoute(req, env, cors, path) {
  const json = (o, code, ttl) => new Response(JSON.stringify(o), { status: code, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': ttl ? 'public, max-age=' + ttl : 'no-store' } });
  const q = new URL(req.url).searchParams;
  if (path === '/radar/list') {
    const id = q.get('id') || '';
    if (!RADAR_ID.test(id)) return json({ error: 'radar desconocido' }, 400);
    try {
      let tok = await smnToken(env, false);
      if (!tok) return json({ error: 'no pude obtener el acceso del SMN' + (tokWhy ? ' (' + tokWhy + ')' : '') }, 503);
      const ask = t => fetch('https://ws1.smn.gob.ar/v1/images/radar/' + id, { headers: { 'User-Agent': SMN_UA, 'Accept': 'application/json', 'Authorization': 'JWT ' + t }, cf: { cacheTtl: 120, cacheEverything: true } });
      let up = await ask(tok);
      if ((up.status === 401 || up.status === 403) && !env.SMN_TOKEN) { tok = await smnToken(env, true); if (tok) up = await ask(tok); }
      if (!up.ok) return json({ error: 'el SMN respondió ' + up.status }, up.status === 401 || up.status === 403 ? 502 : (up.status === 429 || up.status === 503 ? up.status : 502));
      const j = await up.json();
      return json({ id: j.id || id, product: j.product || '', radar: j.radar || '', list: Array.isArray(j.list) ? j.list.filter(f => RADAR_FILE.test(f)).slice(0, 40) : [] }, 200, 120);
    } catch (e) { return json({ error: 'no pude consultar al SMN' }, 502); }
  }
  if (path === '/radar/img') {
    const f = q.get('f') || '';
    if (!RADAR_FILE.test(f)) return json({ error: 'archivo inválido' }, 400);
    try {
      const up = await fetch('https://estaticos.smn.gob.ar/vmsr/radar/' + f, { cf: { cacheTtl: 300, cacheEverything: true } });
      if (!up.ok) return json({ error: 'el SMN respondió ' + up.status }, up.status === 404 ? 404 : 502);
      return new Response(up.body, { status: 200, headers: { ...cors, 'Content-Type': up.headers.get('content-type') || 'image/png', 'Cache-Control': 'public, max-age=300' } });
    } catch (e) { return json({ error: 'no pude consultar al SMN' }, 502); }
  }
  return json({ error: 'ruta desconocida' }, 404);
}

/* ---------- Disparador confiable (Cron Trigger de Cloudflare) ----------
   El "cron" de GitHub Actions se atrasa horas en repositorios chicos (por eso los rayos llegaban con 197 min de demora).
   Este disparador llama a GitHub cada 5 min para ejecutar los workflows en hora.
   Config: Secret GH_TOKEN (token de GitHub con permiso Actions: Read and write sobre esos repos) y variable DISPATCH, por ejemplo:
   [{"repo":"codemarketmdz-maker/tiempomdz-rayos","workflow":"rayos.yml","ref":"main"},{"repo":"codemarketmdz-maker/Clima","workflow":"datos.yml","ref":"main"}]
   Cada workflow debe tener "on: workflow_dispatch". */
async function dispatchAll(env) {
  let list = []; try { list = JSON.parse(env.DISPATCH || '[]'); } catch (e) { return; }
  if (!env.GH_TOKEN) return;
  await Promise.all(list.slice(0, 5).map(async j => {
    if (!/^[A-Za-z0-9][\w.-]*\/[A-Za-z0-9][\w.-]*$/.test(j.repo || '') || !/^[A-Za-z0-9][\w.-]*\.ya?ml$/.test(j.workflow || '')) return;
    try {
      await fetch('https://api.github.com/repos/' + j.repo + '/actions/workflows/' + j.workflow + '/dispatches', {
        method: 'POST', headers: { 'Authorization': 'Bearer ' + env.GH_TOKEN, 'Accept': 'application/vnd.github+json', 'User-Agent': 'tiempomdz-licencias', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
        body: JSON.stringify({ ref: j.ref || 'main' })
      });
    } catch (e) { }
  }));
}

export default {
  async scheduled(event, env, ctx) { ctx.waitUntil(dispatchAll(env)); },
  async fetch(req, env) {
    const origin = req.headers.get('Origin') || '', allowed = (env.ALLOWED_ORIGIN || '*').split(',').map(s => s.trim());
    const okO = allowed.includes('*') || allowed.includes(origin);
    const cors = { 'Access-Control-Allow-Origin': allowed.includes('*') ? '*' : (okO ? origin : 'null'), 'Vary': 'Origin', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const send = (o, code) => new Response(JSON.stringify(o), { status: code || o.code || 200, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
    if (!okO) return send({ error: 'origen no permitido' }, 403);
    const path = new URL(req.url).pathname;
    try {
      if (path === '/p' && req.method === 'GET') return proxyFetch(req, cors);
      if (path.startsWith('/radar/') && req.method === 'GET') return radarRoute(req, env, cors, path);
      if (path === '/status' && req.method === 'POST') return send(await status(req, env));
      if (path.startsWith('/admin/')) return send(await admin(req, env, path));
      return send({ ok: true, servicio: 'tiempomdz-licencias' });
    } catch (e) { return send({ error: 'error interno' }, 500); }
  }
};
