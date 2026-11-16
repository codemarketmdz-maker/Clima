/* TiempoMDZ Web · acceso a fuentes oficiales sin CORS.
   GitHub Pages es estático: el navegador bloquea (CORS) la lectura directa de SMN, INPRES, METAR (aviationweather.gov)
   y Contingencias Mendoza. Este archivo intercepta fetch() SOLO para esos sitios y los pide a través de un proxy:
     1) el proxy propio (Cloudflare Worker, ver worker.js) si CM_CFG.proxy está configurado  → recomendado, estable
     2) proxies públicos de respaldo (pueden fallar o limitar pedidos).
   Si ninguno responde, el error llega al código existente, que ya lo informa como "sin datos" (nunca "sin riesgo"). */
(function (g) {
  'use strict';
  const HOSTS = /^(?:[\w-]+\.)*(?:smn\.gob\.ar|inpres\.gob\.ar|aviationweather\.gov|mendoza\.gov\.ar|tgftp\.ncep\.noaa\.gov)$/i;
  const TRY_DIRECT = /(^|\.)aviationweather\.gov$/i;   // algunos endpoints de NOAA sí traen CORS: se prueba directo una vez
  const PUBLIC = [
    ['allorigins', u => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u)],
    ['codetabs', u => 'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(u)],
    ['thingproxy', u => 'https://thingproxy.freeboard.io/fetch/' + u]
  ];
  const nativeFetch = g.fetch.bind(g);
  const directBad = {};
  const cfg = () => { const c = g.CM_CFG || {}, u = c.proxy || c.licUrl; return u ? String(u).replace(/\/+$/, '') : ''; };
  const short = e => String((e && (e.name === 'AbortError' ? 'tiempo' : e.message)) || e).slice(0, 18);

  /* Todas las rutas se piden EN PARALELO y gana la primera que responde bien (antes se probaban una por una y no alcanzaba el tiempo).
     Se ignora el tiempo límite del código que llama: los proxies son más lentos que una conexión directa; el tope propio es MAX_MS. */
  /* Copias hechas por GitHub Actions (data/map.json, ver scripts/fetch-data.mjs): mismo origen, sin CORS, instantáneas.
     Se usan solo si son recientes; si no existen o están viejas, se sigue con proxy propio / públicos. */
  const snapMax = () => cfg() ? 20 * 60e3 : 3 * 3600e3;   // con Worker propio hay datos en vivo: la copia solo sirve si es muy reciente
  let snapMap = null, snapAt = 0, snapPromise = null;
  const snapUrl = p => new URL(p, g.location.href.split('#')[0].replace(/[^\/]*$/, '')).href;
  function loadMap() {
    if (snapMap && Date.now() - snapAt < 60e3) return Promise.resolve(snapMap);
    if (snapPromise) return snapPromise;
    snapPromise = nativeFetch(snapUrl('data/map.json') + '?t=' + Math.floor(Date.now() / 60e3), { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null).catch(() => null)
      .then(m => { snapMap = m && m.items ? m : { items: {} }; snapAt = Date.now(); return snapMap; })
      .finally(() => { snapPromise = null; });
    return snapPromise;
  }
  async function fromSnapshot(href, u) {
    try {
      const m = await loadMap(); let e = m.items[href];
      if (!e || Date.now() - e.at > snapMax()) return null;
      const r = await nativeFetch(snapUrl('data/f/' + e.f) + '?v=' + e.at, { cache: 'no-store' });
      return r.ok ? r : null;
    } catch (err) { return null; }
  }
  const MAX_MS = 16000;
  g.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url);
    let u; try { u = new URL(url, g.location && g.location.href); } catch (e) { return nativeFetch(input, init); }
    const method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    if (method !== 'GET' || !/^https?:$/.test(u.protocol) || u.origin === (g.location && g.location.origin) || !HOSTS.test(u.hostname)) return nativeFetch(input, init);

    const href = u.href, base = Object.assign({}, init); delete base.signal; delete base.mode;
    const routes = [];
    const onlySnap = /zipopendata/i.test(href) && !cfg();   // viene en ZIP: sin Worker propio solo sirve la copia descomprimida por Actions
    if (onlySnap) return fromSnapshot(href, u).then(sn => { if (sn) return sn; throw new TypeError('SMN datos abiertos: sin copia reciente'); });
    if (TRY_DIRECT.test(u.hostname) && !directBad[u.hostname]) routes.push({ n: 'directo', url: href, direct: true });
    if (cfg()) routes.push({ n: 'propio', url: cfg() + '/p?url=' + encodeURIComponent(href), own: true });
    if (!onlySnap || cfg()) PUBLIC.forEach(p => { if (!/zipopendata/i.test(href)) routes.push({ n: p[0], url: p[1](href) }); });

    return fromSnapshot(href, u).then(snap => snap || new Promise((resolve, reject) => {
      const ctrls = [], errs = []; let left = routes.length, done = false, last = null;
      const finish = (fn, v) => { if (done) return; done = true; clearTimeout(tm); ctrls.forEach(c => { try { c.abort(); } catch (e) { } }); fn(v); };
      const tm = setTimeout(() => finish(reject, new Error('sin respuesta: ' + errs.join(', '))), MAX_MS);
      const fail = (r, why) => { errs.push(r.n + ' ' + why); if (--left === 0) { if (last) finish(resolve, last); else finish(reject, new Error(errs.join(', '))); } };
      routes.forEach(r => {
        const c = new AbortController(); ctrls.push(c);
        nativeFetch(r.url, Object.assign({}, base, { signal: c.signal, mode: 'cors', credentials: 'omit' })).then(resp => {
          // 429/503 reales del SMN pasan tal cual (el código existente espera unos minutos); 401/403/5xx de un proxy no cuentan
          if (resp.ok || (r.own && resp.status !== 502 && resp.status !== 504 && resp.status !== 403)) finish(resolve, resp);
          else { if (resp.status === 429 || resp.status === 503) last = resp; fail(r, 'HTTP ' + resp.status); }
        }, e => { if (r.direct) directBad[u.hostname] = true; fail(r, short(e)); });
      });
    }));
  };
})(window);
