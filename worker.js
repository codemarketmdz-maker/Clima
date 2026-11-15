/* TiempoMDZ · proxy propio (Cloudflare Workers, plan gratuito: 100.000 pedidos/día).
   Qué hace: lee SMN, INPRES, METAR (aviationweather.gov) y Contingencias Mendoza desde el servidor y los devuelve con CORS.
   Solo GET y solo esos sitios (no es un proxy abierto).

   Cómo publicarlo (5 minutos, sin instalar nada):
   1. https://dash.cloudflare.com → Workers & Pages → Create → Create Worker → nombre "tiempomdz-proxy" → Deploy.
   2. "Edit code" → borrá todo, pegá este archivo → Deploy.
   3. Copiá la URL (https://tiempomdz-proxy.TU-USUARIO.workers.dev) y ponela en config.js:  proxy: '…esa URL…'
   4. Cambiá ALLOWED_ORIGINS por tu página (ej. 'https://tuusuario.github.io') para que nadie más lo use. */
const ALLOWED_ORIGINS = ['*'];   // ej.: ['https://tuusuario.github.io']
const HOSTS = /^(?:[\w-]+\.)*(?:smn\.gob\.ar|inpres\.gob\.ar|aviationweather\.gov|mendoza\.gov\.ar)$/i;

export default {
  async fetch(req) {
    const origin = req.headers.get('Origin') || '';
    const okOrigin = ALLOWED_ORIGINS.includes('*') || ALLOWED_ORIGINS.includes(origin);
    const cors = { 'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes('*') ? '*' : (okOrigin ? origin : 'null'), 'Vary': 'Origin', 'Access-Control-Expose-Headers': 'x-proxy-error' };
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...cors, 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Max-Age': '86400' } });
    if (req.method !== 'GET' || !okOrigin) return new Response('forbidden', { status: 403, headers: cors });
    let target;
    try { target = new URL(new URL(req.url).searchParams.get('url')); } catch (e) { return new Response('url inválida', { status: 400, headers: cors }); }
    if (!/^https?:$/.test(target.protocol) || !HOSTS.test(target.hostname)) return new Response('host no permitido', { status: 403, headers: cors });
    try {
      const up = await fetch(target.href, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TiempoMDZ/1.0)', 'Accept': '*/*' },
        cf: { cacheTtl: 60, cacheEverything: true }
      });
      const h = new Headers(cors);
      h.set('Content-Type', up.headers.get('Content-Type') || 'text/plain; charset=utf-8');
      h.set('Cache-Control', 'public, max-age=60');
      return new Response(up.body, { status: up.status, headers: h });
    } catch (e) {
      return new Response('upstream error', { status: 502, headers: { ...cors, 'x-proxy-error': String(e && e.message || e).slice(0, 60) } });
    }
  }
};
