/* TiempoMDZ · Servidor de datos (Cloudflare Worker) — versión chica: radar del SMN, estaciones FePEDI/ISCAMEN/COVIAR y proxy de fuentes oficiales.
   NO usa KV, ni secretos, ni licencias. Pegá este archivo completo en Cloudflare → Workers → tu Worker → Edit code → Deploy.
   Probar: abrí  https://TU-WORKER.workers.dev/health  (tiene que decir ok: true) y  https://TU-WORKER.workers.dev/estaciones
   Después pegá la dirección del Worker en config.js → proxy: '...'.
   Opcional: Variable ALLOWED_ORIGIN (por defecto acepta https://clima.codemarketmdz.workers.dev y https://codemarketmdz-maker.github.io; varios separados por coma). */
const DEFAULT_ORIGIN = 'https://clima.codemarketmdz.workers.dev,https://codemarketmdz-maker.github.io';

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
let tokCache = { v: '', until: 0 };
function jwtExp(t) { try { const p = JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); return p.exp ? p.exp * 1000 : 0; } catch (e) { return 0; } }
async function smnToken(env, force) {
  if (env.SMN_TOKEN) return env.SMN_TOKEN;
  const now = Date.now();
  if (!force && tokCache.v && now < tokCache.until) return tokCache.v;
  const r = await fetch('https://www.smn.gob.ar/radar', { headers: { 'Accept': 'text/html' } });
  if (!r.ok) return '';
  const m = /localStorage\.setItem\(\s*['"]token['"]\s*,\s*['"]([A-Za-z0-9_\-.]+)['"]/.exec(await r.text());
  if (!m) return '';
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
      if (!tok) return json({ error: 'no pude obtener el acceso del SMN' }, 503);
      const ask = t => fetch('https://ws1.smn.gob.ar/v1/images/radar/' + id, { headers: { 'Accept': 'application/json', 'Authorization': 'JWT ' + t }, cf: { cacheTtl: 120, cacheEverything: true } });
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


export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin') || '', allowed = (env.ALLOWED_ORIGIN || DEFAULT_ORIGIN).split(',').map(s => s.trim());
    const path = new URL(req.url).pathname;
    const okO = allowed.includes('*') || allowed.includes(origin) || (!origin && (path === '/health' || path === '/estaciones' || path.startsWith('/radar/')));   // abrir la dirección en el navegador (sin Origin) sirve para probar
    const cors = { 'Access-Control-Allow-Origin': allowed.includes('*') ? '*' : (okO && origin ? origin : 'null'), 'Vary': 'Origin', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET, OPTIONS' };
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const send = (o, code) => new Response(JSON.stringify(o), { status: code || 200, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
    if (!okO) return send({ error: 'origen no permitido', origen: origin }, 403);
    try {
      if (path === '/health') return send({ ok: true, servicio: 'tiempomdz-datos', token_smn: env.SMN_TOKEN ? 'secreto' : 'automatico' });
      if (path === '/estaciones' && req.method === 'GET') {
        const up = await fetch('https://fepedi.evolus.com.ar/estaciones/data.json', { headers: { 'Accept': 'application/json' }, cf: { cacheTtl: 30, cacheEverything: true } });
        if (!up.ok) return send({ error: 'las estaciones respondieron ' + up.status }, 502);
        return new Response(up.body, { status: 200, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=30' } });
      }
      if (path === '/p' && req.method === 'GET') return proxyFetch(req, cors);
      if (path.startsWith('/radar/') && req.method === 'GET') return radarRoute(req, env, cors, path);
      return send({ ok: true, servicio: 'tiempomdz-datos' });
    } catch (e) { return send({ error: 'error interno' }, 500); }
  }
};
