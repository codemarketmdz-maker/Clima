/* TiempoMDZ Web · acceso a fuentes oficiales sin CORS.
   GitHub Pages es estático: el navegador bloquea (CORS) la lectura directa de SMN, INPRES, METAR (aviationweather.gov)
   y Contingencias Mendoza. Este archivo intercepta fetch() SOLO para esos sitios y los pide a través de un proxy:
     1) el proxy propio (Cloudflare Worker, ver worker.js) si CM_CFG.proxy está configurado  → recomendado, estable
     2) proxies públicos de respaldo (pueden fallar o limitar pedidos).
   Si ninguno responde, el error llega al código existente, que ya lo informa como "sin datos" (nunca "sin riesgo"). */
(function (g) {
  'use strict';
  const HOSTS = /^(?:[\w-]+\.)*(?:smn\.gob\.ar|inpres\.gob\.ar|aviationweather\.gov|mendoza\.gov\.ar)$/i;
  const TRY_DIRECT = /(^|\.)aviationweather\.gov$/i;   // algunos endpoints de NOAA sí traen CORS: se prueba directo una vez
  const PUBLIC = [
    u => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u),
    u => 'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(u),
    u => 'https://corsproxy.io/?url=' + encodeURIComponent(u)
  ];
  const nativeFetch = g.fetch.bind(g);
  const directBad = {};          // host -> true si el pedido directo falló por CORS
  let lastGood = -1;             // índice del último proxy público que funcionó
  const cfg = () => (g.CM_CFG && g.CM_CFG.proxy ? String(g.CM_CFG.proxy).replace(/\/+$/, '') : '');

  function attempt(url, init, outer, ms) {
    const ac = new AbortController(), t = setTimeout(() => ac.abort(), ms);
    const onAbort = () => ac.abort();
    if (outer) { if (outer.aborted) ac.abort(); else outer.addEventListener('abort', onAbort, { once: true }); }
    const o = Object.assign({}, init, { signal: ac.signal, mode: 'cors', credentials: 'omit' });
    return nativeFetch(url, o).finally(() => { clearTimeout(t); if (outer) outer.removeEventListener('abort', onAbort); });
  }

  g.fetch = async function (input, init) {
    let url = typeof input === 'string' ? input : (input && input.url);
    let u; try { u = new URL(url, g.location && g.location.href); } catch (e) { return nativeFetch(input, init); }
    const method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    if (method !== 'GET' || !/^https?:$/.test(u.protocol) || u.origin === (g.location && g.location.origin) || !HOSTS.test(u.hostname)) return nativeFetch(input, init);

    const outer = init && init.signal, href = u.href;
    const base = Object.assign({}, init); delete base.signal; delete base.mode;
    if (outer && outer.aborted) return nativeFetch(input, init);
    const routes = [];
    if (TRY_DIRECT.test(u.hostname) && !directBad[u.hostname]) routes.push({ name: 'directo', url: href, ms: 4500, direct: true });
    if (cfg()) routes.push({ name: 'proxy propio', url: cfg() + '/?url=' + encodeURIComponent(href), ms: 12000, own: true });
    const order = PUBLIC.map((f, i) => i); if (lastGood > 0) { order.splice(lastGood, 1); order.unshift(lastGood); }
    order.forEach(i => routes.push({ name: 'proxy público ' + (i + 1), url: PUBLIC[i](href), ms: 9000, idx: i }));

    let lastErr = null, lastResp = null;
    for (const r of routes) {
      if (outer && outer.aborted) break;
      try {
        const resp = await attempt(r.url, base, outer, r.ms);
        // 429/503 del SMN: se devuelve tal cual para que el código existente aplique su espera (backoff)
        if (resp.ok || (r.own && resp.status !== 502 && resp.status !== 504 && resp.status !== 403)) { if (r.idx != null) lastGood = r.idx; return resp; }
        lastResp = resp; lastErr = new Error(r.name + ' HTTP ' + resp.status);
      } catch (e) {
        lastErr = e; if (r.direct) directBad[u.hostname] = true;
        if (outer && outer.aborted) throw e;
      }
    }
    if (lastResp) return lastResp;
    throw lastErr || new TypeError('Sin acceso a ' + u.hostname);
  };
})(window);
