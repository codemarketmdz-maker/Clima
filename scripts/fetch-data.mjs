// TiempoMDZ · copia de fuentes oficiales para la página (same-origin, sin CORS).
// Lo ejecuta GitHub Actions (.github/workflows/datos.yml). Guarda en data/: map.json + data/f/<hash>.
// La página (proxy.js) lee esas copias primero; si están viejas o no existen, usa los proxies.
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data'), FILES = path.join(DATA, 'f'), MAP = path.join(DATA, 'map.json');
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36 TiempoMDZ-snapshot';
const METAR_IDS = 'SAME,SAMR,SAMM,SANU,SAOU,SANL,SAZN,SACO,SAAR,SAEZ,SABE,SCEL,SANT,SASA,SAZR';
const SOURCES = [
  ['https://aviationweather.gov/api/data/metar?ids=' + METAR_IDS + '&format=json&hours=3', 'metar'],
  ['https://www.inpres.gob.ar/seismology/xultimos.html', 'inpres'],
  ['https://contingencias.mendoza.gov.ar/web1/Alertadeheladas/alertadeheladas.php', 'mza']
];
const CAP_SOURCES = ['https://ssl.smn.gob.ar/CAP/AR.php', 'https://ssl.smn.gob.ar/feeds/CAP/rss_alertaCAP_nuevo.xml', 'https://ssl.smn.gob.ar/feeds/CAP/avisocortoplazo/'];
const capStamp = u => { const m = String(u).match(/(20\d{2})_?(\d{2})_?(\d{2})_?(\d{2})_?(\d{2})/); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) + 3 * 3600e3 : 0; };
function capLinks(body, base) {       // misma lógica que detect.js
  const out = new Map(), re = /(?:https?:\/\/[^\s"'<>\]\)]+|[A-Za-z0-9_\-.\/]+)\.xml(?:\?[^\s"'<>\]\)]*)?/gi; let m;
  while ((m = re.exec(body))) {
    let abs; try { abs = new URL(m[0].replace(/&amp;/g, '&'), base).href; } catch (e) { continue; }
    if (!/\/cap/i.test(abs) && !/cap_|_cap/i.test(abs)) continue;
    if (/rss|\.xsl/i.test(abs.split('/').pop())) continue;
    if (abs === base) continue;
    out.set(abs, true);
  }
  return [...out.keys()];
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const hash = u => createHash('sha1').update(u).digest('hex').slice(0, 16);

export async function get(fetchImpl, url, tries = 2) {
  let err;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetchImpl(url, { headers: { 'User-Agent': UA, 'Accept': '*/*' }, signal: AbortSignal.timeout(25000), redirect: 'follow' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const buf = Buffer.from(await r.arrayBuffer());
      const ct = (r.headers.get('content-type') || '') + ' ' + buf.subarray(0, 2048).toString('latin1');
      const cs = (ct.match(/charset\s*=\s*["']?([\w-]+)/i) || [])[1] || 'utf-8';
      let text; try { text = new TextDecoder(cs).decode(buf); } catch (e) { text = buf.toString('utf8'); }
      return text;
    } catch (e) { err = e; await sleep(1500); }
  }
  throw err;
}

export async function main(fetchImpl = fetch, now = Date.now()) {
  await fs.mkdir(FILES, { recursive: true });
  let map = { at: now, items: {} };
  try { const old = JSON.parse(await fs.readFile(MAP, 'utf8')); if (old && old.items) map.items = old.items; } catch (e) { }
  const log = [], put = async (url, text) => {
    const name = hash(url) + '.txt';
    await fs.writeFile(path.join(FILES, name), text);
    map.items[url] = { f: name, at: now };
  };
  for (const [url, label] of SOURCES) {
    try { await put(url, await get(fetchImpl, url)); log.push('OK   ' + label); } catch (e) { log.push('FALLÓ ' + label + ': ' + e.message); }
  }
  // SMN: se guardan las fuentes (índice) y los archivos CAP nuevos
  const links = new Map(); let smnOk = false;
  for (const src of CAP_SOURCES) {
    try {
      const body = await get(fetchImpl, src); await put(src, body); smnOk = true; log.push('OK   SMN ' + src);
      capLinks(body, src).forEach(u => links.set(u, true));
      if (links.size) break;
    } catch (e) { log.push('FALLÓ SMN ' + src + ': ' + e.message); }
    await sleep(500);
  }
  const cutoff = now - 4 * 864e5;
  const cand = [...links.keys()].map(u => ({ u, st: capStamp(u) })).filter(x => !x.st || x.st > cutoff).sort((a, b) => b.st - a.st).slice(0, 40);
  let n = 0;
  for (const x of cand) {
    if (map.items[x.u]) { map.items[x.u].at = now; continue; }      // un CAP no cambia: si ya está, se conserva
    try { await put(x.u, await get(fetchImpl, x.u, 1)); n++; } catch (e) { log.push('FALLÓ CAP ' + x.u.split('/').pop() + ': ' + e.message); }
    await sleep(400);
  }
  if (smnOk) log.push('SMN: ' + cand.length + ' avisos candidatos, ' + n + ' nuevos');
  // limpieza: se descartan CAP viejos y archivos huérfanos
  const keep = new Set(SOURCES.map(s => s[0]).concat(CAP_SOURCES, cand.map(x => x.u)));
  for (const u of Object.keys(map.items)) if (!keep.has(u) || now - map.items[u].at > 3 * 864e5) delete map.items[u];
  const used = new Set(Object.values(map.items).map(v => v.f));
  for (const f of await fs.readdir(FILES)) if (f !== '.gitkeep' && !used.has(f)) await fs.unlink(path.join(FILES, f));
  await fs.writeFile(MAP, JSON.stringify(map));
  console.log(log.join('\n'));
  return { map, log };
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main().catch(e => { console.error(e); process.exit(0); });
