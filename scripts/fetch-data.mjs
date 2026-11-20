// TiempoMDZ · copias de las fuentes oficiales (mismo origen que la página → sin CORS).
// Lo ejecuta GitHub Actions (.github/workflows/datos.yml). Escribe data/map.json y data/f/<hash>.txt.
// Las URL guardadas son EXACTAMENTE las que pide la página (observed.js, smn.js, detect.js, ui2.js).
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data'), FILES = path.join(DATA, 'f'), MAP = path.join(DATA, 'map.json');
const UA = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Mobile Safari/537.36 TiempoMDZ-snapshot';
const METAR_IDS = ['SAME', 'SAMR', 'SAMM', 'SANU', 'SAOU'];
const SMN_ZIP = 'https://ssl.smn.gob.ar/dpd/zipopendata.php?dato=';
const CAP_FEED = 'https://ssl.smn.gob.ar/CAP/AR.php';
const SOURCES = [
  { url: 'https://aviationweather.gov/api/data/metar?ids=' + METAR_IDS.join(',') + '&format=raw&hours=3', label: 'METAR' },
  ...METAR_IDS.map(id => ({ url: 'https://tgftp.ncep.noaa.gov/data/observations/metar/stations/' + id + '.TXT', label: 'METAR ' + id })),
  { url: 'https://fepedi.evolus.com.ar/estaciones/data.json', label: 'Estaciones FePEDI/ISCAMEN/COVIAR' },
  { url: 'https://www.inpres.gob.ar/mapa/sismos.xml', label: 'INPRES xml' },
  { url: 'https://www.inpres.gob.ar/seismology/xultimos.html', label: 'INPRES html' },
  { url: 'https://contingencias.mendoza.gov.ar/web1/Alertadeheladas/alertadeheladas.php', label: 'Mendoza heladas' },
  { url: SMN_ZIP + 'tiepre', label: 'SMN estado del tiempo', zip: true },
  { url: SMN_ZIP + 'pron5d', label: 'SMN pronóstico 5 días', zip: true }
];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const hash = u => createHash('sha1').update(u).digest('hex').slice(0, 16);

// Igual que OfficialProxy.kt: charset declarado; si no, UTF-8 válido o Latin-1.
function toText(buf, declared) {
  if (declared) { try { return new TextDecoder(declared).decode(buf); } catch (e) { } }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (e) { return new TextDecoder('latin1').decode(buf); }
}
// Primer archivo de un ZIP (por el directorio central, soporta "data descriptor").
export function firstZipEntry(zip) {
  let e = zip.length - 22; while (e >= 0 && zip.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) throw new Error('ZIP inválido');
  let p = zip.readUInt32LE(e + 16);
  for (let n = zip.readUInt16LE(e + 10); n > 0; n--) {
    if (zip.readUInt32LE(p) !== 0x02014b50) throw new Error('ZIP dañado');
    const method = zip.readUInt16LE(p + 10), csize = zip.readUInt32LE(p + 20), nl = zip.readUInt16LE(p + 28), xl = zip.readUInt16LE(p + 30), cl = zip.readUInt16LE(p + 32), off = zip.readUInt32LE(p + 42);
    const name = zip.toString('utf8', p + 46, p + 46 + nl);
    p += 46 + nl + xl + cl;
    if (name.endsWith('/')) continue;
    const start = off + 30 + zip.readUInt16LE(off + 26) + zip.readUInt16LE(off + 28), raw = zip.subarray(start, start + csize);
    return method === 0 ? raw : inflateRawSync(raw);
  }
  throw new Error('ZIP vacío');
}
export async function get(fetchImpl, url, opt = {}) {
  let err;
  for (let i = 0; i < (opt.tries || 2); i++) {
    try {
      const r = await fetchImpl(url, { headers: { 'User-Agent': UA, 'Accept': '*/*' }, signal: AbortSignal.timeout(25000), redirect: 'follow' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      let buf = Buffer.from(await r.arrayBuffer());
      const ct = r.headers.get('content-type') || '';
      if (opt.zip) return toText(firstZipEntry(buf), null);
      return toText(buf, (ct.match(/charset=([^;\s]+)/i) || [])[1]);
    } catch (e) { err = e; await sleep(1500); }
  }
  throw err;
}
const xmlDecode = s => String(s).replace(/&amp;/g, '&').trim();
// Misma selección de avisos CAP que detect.js (loadCapItems)
export function capLinks(body) {
  const links = [];
  const re = /<a\b[^>]*href=["']([^"']+\.xml(?:\?[^"']*)?)["'][^>]*>([\s\S]*?)<\/a>/gi; let m;
  while ((m = re.exec(body)) && links.length < 100) {
    if (!/(zonda|viento|torment|lluv|granizo|helad|nieve|nevad|calor|fr[ií]o|temperatur|niebla|polvo|inunda|tormenta|alerta|aviso)/i.test(m[1] + ' ' + m[2])) continue;
    try { links.push(new URL(m[1], CAP_FEED).href); } catch (e) { }
  }
  if (!links.length) { const lr = /<link[^>]*>(https?:[^<]+\.xml[^<]*)<\/link>/gi; while ((m = lr.exec(body)) && links.length < 100) links.push(xmlDecode(m[1])); }
  return [...new Set(links)].slice(0, 80);
}

export async function main(fetchImpl = fetch, now = Date.now()) {
  await fs.mkdir(FILES, { recursive: true });
  const map = { at: now, items: {} }, old = { items: {} };
  try { Object.assign(old, JSON.parse(await fs.readFile(MAP, 'utf8'))); } catch (e) { }
  const log = [];
  const put = async (url, text) => { const f = hash(url) + '.txt'; await fs.writeFile(path.join(FILES, f), text); map.items[url] = { f, at: now }; };
  const keepOld = url => { if (old.items && old.items[url]) map.items[url] = old.items[url]; };   // si falla, queda la copia anterior (la página la descarta si es vieja)
  for (const s of SOURCES) {
    try { await put(s.url, await get(fetchImpl, s.url, { zip: s.zip })); log.push('OK     ' + s.label); }
    catch (e) { keepOld(s.url); log.push('FALLÓ  ' + s.label + ' → ' + e.message); }
  }
  try {
    const body = await get(fetchImpl, CAP_FEED); await put(CAP_FEED, body);
    const links = capLinks(body); let nuevos = 0, fallos = 0;
    for (const u of links) {
      if (old.items && old.items[u]) { map.items[u] = { f: old.items[u].f, at: now }; continue; }   // un CAP no cambia: se reutiliza y sigue vigente mientras esté en el feed
      try { await put(u, await get(fetchImpl, u, { tries: 1 })); nuevos++; } catch (e) { fallos++; }
      await sleep(300);
    }
    log.push('OK     SMN avisos CAP: ' + links.length + ' en el feed, ' + nuevos + ' nuevos, ' + fallos + ' con error');
  } catch (e) { keepOld(CAP_FEED); Object.keys(old.items || {}).forEach(u => { if (/\/CAP\//i.test(u) && u !== CAP_FEED) keepOld(u); }); log.push('FALLÓ  SMN avisos CAP → ' + e.message); }
  const used = new Set(Object.values(map.items).map(v => v.f));
  for (const f of await fs.readdir(FILES)) if (f !== '.gitkeep' && !used.has(f)) await fs.unlink(path.join(FILES, f));
  await fs.writeFile(MAP, JSON.stringify(map));
  console.log(log.join('\n'));
  return { map, log };
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main().catch(e => { console.error(e); process.exit(0); });
