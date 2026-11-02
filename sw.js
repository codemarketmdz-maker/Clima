/* Service worker – Clima Mendoza en Vivo */
importScripts('detect.js?v=7');

const CACHE = 'clima-v7';
const SHELL = [
  './', 'index.html', 'detect.js?v=7','manifest.webmanifest', 'icon-192.png', 'icon-512.png',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.allSettled(SHELL.map(u => c.add(u)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const mine = url.origin === location.origin || url.hostname === 'cdnjs.cloudflare.com';
  if (!mine || url.pathname.startsWith('/api/')) return;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(r => { const cp = r.clone(); caches.open(CACHE).then(c => c.put(req, cp)); return r; })
      .catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
    return;
  }
  const store = r => { if (r && r.ok) { const cp = r.clone(); caches.open(CACHE).then(c => c.put(req, cp)); } return r; };
  if (url.origin === location.origin) {
    // Archivos propios: siempre la versión nueva si hay red (evita mezclar versiones)
    e.respondWith(fetch(req).then(store).catch(() => caches.match(req)));
  } else {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(store)));
  }
});

/* ---- Almacenamiento mínimo (IndexedDB) ---- */
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('clima', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function kvGet(k) {
  const d = await idb();
  return new Promise(res => { const q = d.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => res(undefined); });
}
async function kvSet(k, v) {
  const d = await idb();
  return new Promise(res => { const t = d.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = () => res(); t.onerror = () => res(); });
}

self.addEventListener('message', e => {
  const d = e.data || {};
  if (d.type === 'state') {
    e.waitUntil(Promise.all([kvSet('cfg', d.cfg), kvSet('locs', d.locs || []), kvSet('notified', d.notified || {})]));
  }
});

/* ---- Chequeo en segundo plano (ubicación + todas las fincas) ---- */
async function check() {
  const cfg = mergeCfg(await kvGet('cfg'));
  const locs = (await kvGet('locs')) || [];
  if (!locs.length) return true;
  const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  if (wins.some(w => w.visibilityState === 'visible')) return true; // la app abierta avisa sola

  const events = [];
  let ok = false;
  try {
    const lp = locs.map(l => [l.lat, l.lon]);
    const [arr, ct] = await Promise.all([fetchWeather(lp, { full: true, hourly: true }), fetchCloudTops(lp)]);
    attachCloudTops(arr, ct);
    arr.forEach((d, i) => { if (d && d.current && locs[i]) events.push(...detectPoint(d.current, d.hourly, cfg, locs[i].name)); });
    ok = true;
  } catch (e) {}
  for (const l of locs) {
    try { events.push(...quakeEvents(await fetchUSGS(l, cfg), l, l.name)); ok = true; } catch (e) {}
  }

  const map = (await kvGet('notified')) || {};
  const now = Date.now();
  for (const ev of events) {
    if (!shouldNotify(map, ev, cfg, now)) continue;
    const n = notifOptions(ev, cfg);
    await self.registration.showNotification(n.title, n.opts);
  }
  pruneNotified(map, events);
  await kvSet('notified', map);
  return ok;
}

self.addEventListener('periodicsync', e => { if (e.tag === 'clima-check') e.waitUntil(check()); });
// Reintento automático cuando vuelve la conexión
self.addEventListener('sync', e => {
  if (e.tag === 'clima-check') e.waitUntil(check().then(ok => { if (!ok) throw new Error('sin conexión, reintentar'); }));
});

/* Push desde un servidor (opcional): payload JSON {title, body, tag, type} */
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) {}
  e.waitUntil(self.registration.showNotification(d.title || 'Alerta de clima', {
    body: d.body || '', tag: d.tag || 'push', renotify: true, icon: 'icon-192.png', badge: 'icon-192.png',
    vibrate: [300, 150, 300], requireInteraction: true, data: { type: d.type || '' },
    actions: [{ action: 'call', title: '📞 Llamar 911' }, { action: 'open', title: 'Qué hacer' }]
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const type = (e.notification.data || {}).type || '';
  e.waitUntil((async () => {
    if (e.action === 'call') {
      try { await self.clients.openWindow('tel:911'); return; } catch (x) {}
    }
    const ws = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of ws) {
      if ('focus' in w) { await w.focus(); w.postMessage({ type: 'openAlert', alert: type, call: e.action === 'call' }); return; }
    }
    await self.clients.openWindow('./?alert=' + encodeURIComponent(type) + (e.action === 'call' ? '&call=1' : ''));
  })());
});
