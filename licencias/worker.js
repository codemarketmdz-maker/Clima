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

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin') || '', allowed = (env.ALLOWED_ORIGIN || '*').split(',').map(s => s.trim());
    const okO = allowed.includes('*') || allowed.includes(origin);
    const cors = { 'Access-Control-Allow-Origin': allowed.includes('*') ? '*' : (okO ? origin : 'null'), 'Vary': 'Origin', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const send = (o, code) => new Response(JSON.stringify(o), { status: code || o.code || 200, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
    if (!okO) return send({ error: 'origen no permitido' }, 403);
    const path = new URL(req.url).pathname;
    try {
      if (path === '/status' && req.method === 'POST') return send(await status(req, env));
      if (path.startsWith('/admin/')) return send(await admin(req, env, path));
      return send({ ok: true, servicio: 'tiempomdz-licencias' });
    } catch (e) { return send({ error: 'error interno' }, 500); }
  }
};
