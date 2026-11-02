// Temperatura de topes de nube medida por satélite (GOES-East banda 13, NASA GIBS).
// Es una observación real (no un pronóstico): topes muy fríos = nubes muy altas = tormenta intensa.
// Devuelve para cada punto la temperatura mínima (°C) en un radio de ~10 km y la fracción de píxeles muy fríos.
import { inflateSync } from 'node:zlib';

const LAYER = 'GOES-East_ABI_Band13_Clean_Infrared';
const Z = 6, TS = 256;
const CMAP_URL = 'https://gibs.earthdata.nasa.gov/colormaps/v1.3/Clean_Longwave_Infrared_Window_Band.xml';
let cmap = null; // Map "r,g,b" -> °C

async function getColormap() {
  if (cmap) return cmap;
  const r = await fetch(CMAP_URL, { signal: AbortSignal.timeout(6000) });
  if (!r.ok) throw new Error('colormap HTTP ' + r.status);
  const xml = await r.text();
  const m = new Map();
  const re = /rgb="(\d+),(\d+),(\d+)"[^>]*?value="\(([-+\d.INF]+),([-+\d.INF]+)\]"/g;
  let x;
  while ((x = re.exec(xml))) {
    const a = parseFloat(x[4]), b = parseFloat(x[5]);
    const v = isFinite(a) && isFinite(b) ? (a + b) / 2 : isFinite(a) ? a : b;
    const k = x[1] + ',' + x[2] + ',' + x[3];
    if (!m.has(k)) m.set(k, v);
  }
  if (m.size < 50) throw new Error('colormap inválido');
  cmap = m;
  return m;
}

// Decodificador PNG mínimo (8 bits, RGBA/RGB/paleta, sin entrelazado)
function decodePNG(buf) {
  let i = 8, w = 0, h = 0, ct = 0, bd = 0, pal = null, trns = null;
  const idat = [];
  while (i < buf.length) {
    const len = buf.readUInt32BE(i), type = buf.toString('ascii', i + 4, i + 8), d = buf.subarray(i + 8, i + 8 + len);
    if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); bd = d[8]; ct = d[9]; if (d[12]) throw new Error('PNG entrelazado'); }
    else if (type === 'PLTE') pal = d;
    else if (type === 'tRNS') trns = d;
    else if (type === 'IDAT') idat.push(d);
    else if (type === 'IEND') break;
    i += 12 + len;
  }
  if (bd !== 8) throw new Error('PNG bit depth ' + bd);
  const bpp = ct === 6 ? 4 : ct === 2 ? 3 : ct === 3 ? 1 : ct === 4 ? 2 : ct === 0 ? 1 : 0;
  if (!bpp) throw new Error('PNG tipo ' + ct);
  const raw = inflateSync(Buffer.concat(idat)), stride = w * bpp;
  const px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, o = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[o + x - bpp] : 0, b = y ? px[o - stride + x] : 0, c = x >= bpp && y ? px[o - stride + x - bpp] : 0;
      let v = raw[src + x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[o + x] = v & 255;
    }
  }
  // Devuelve función (x,y) -> [r,g,b] o null si transparente
  return (x, y) => {
    const o = y * stride + x * bpp;
    if (ct === 6) return px[o + 3] < 128 ? null : [px[o], px[o + 1], px[o + 2]];
    if (ct === 2) return [px[o], px[o + 1], px[o + 2]];
    if (ct === 3) { const k = px[o]; if (trns && k < trns.length && trns[k] < 128) return null; return [pal[k * 3], pal[k * 3 + 1], pal[k * 3 + 2]]; }
    if (ct === 4) return px[o + 1] < 128 ? null : [px[o], px[o], px[o]];
    return [px[o], px[o], px[o]];
  };
}

function colorToC(m, rgb) {
  const k = rgb.join(',');
  if (m.has(k)) return m.get(k);
  let best = null, bd = 1e9; // color no exacto: el más cercano (si es razonablemente parecido)
  for (const [kk, v] of m) {
    const c = kk.split(','), d = (c[0] - rgb[0]) ** 2 + (c[1] - rgb[1]) ** 2 + (c[2] - rgb[2]) ** 2;
    if (d < bd) { bd = d; best = v; }
  }
  const val = bd <= 300 ? best : null;
  m.set(k, val);
  return val;
}

const worldPx = (lat, lon) => {
  const n = TS * 2 ** Z;
  const s = Math.sin(lat * Math.PI / 180);
  return [(lon + 180) / 360 * n, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n];
};

export default async (req) => {
  const q = new URL(req.url).searchParams;
  const lats = (q.get('lat') || '').split(',').map(Number), lons = (q.get('lon') || '').split(',').map(Number);
  const pts = lats.map((la, i) => [la, lons[i]]).filter(p => isFinite(p[0]) && isFinite(p[1]) && Math.abs(p[0]) <= 80 && Math.abs(p[1]) <= 180);
  if (!pts.length || pts.length !== lats.length || pts.length > 40) return Response.json({ error: true, reason: 'coordenadas inválidas' }, { status: 400 });

  try {
    const m = await getColormap();
    const tiles = new Map();
    const getTile = (tx, ty) => {
      const k = tx + '/' + ty;
      if (!tiles.has(k)) tiles.set(k, (async () => {
        const u = `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${LAYER}/default/default/GoogleMapsCompatible_Level6/${Z}/${ty}/${tx}.png`;
        const r = await fetch(u, { signal: AbortSignal.timeout(8000) });
        if (!r.ok) throw new Error('tile HTTP ' + r.status);
        return decodePNG(Buffer.from(await r.arrayBuffer()));
      })().catch(() => null));
      return tiles.get(k);
    };

    const out = await Promise.all(pts.map(async ([lat, lon]) => {
      const [wx, wy] = worldPx(lat, lon);
      const kmPerPx = 40075 * Math.cos(lat * Math.PI / 180) / (TS * 2 ** Z);
      const R = Math.max(2, Math.round(10 / kmPerPx)); // ~10 km de radio
      let min = Infinity, n = 0, cold = 0;
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
        if (dx * dx + dy * dy > R * R) continue;
        const X = Math.floor(wx) + dx, Y = Math.floor(wy) + dy;
        const t = await getTile(Math.floor(X / TS), Math.floor(Y / TS));
        if (!t) continue;
        const rgb = t(((X % TS) + TS) % TS, ((Y % TS) + TS) % TS);
        if (!rgb) continue;
        const v = colorToC(m, rgb);
        if (v == null) continue;
        n++;
        if (v < min) min = v;
        if (v <= -52) cold++;
      }
      return n ? { min: Math.round(min * 10) / 10, cold: Math.round(cold / n * 100) / 100 } : null;
    }));
    if (!out.some(Boolean)) throw new Error('sin datos de satélite');
    return Response.json({ source: 'GOES-East', data: out }, {
      headers: {
        'Cache-Control': 'public, max-age=120',
        'Netlify-CDN-Cache-Control': 'public, max-age=0, s-maxage=600, stale-while-revalidate=300, durable',
        'Netlify-Vary': 'query'
      }
    });
  } catch (e) {
    return Response.json({ error: true, reason: (e && e.message) || 'error' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
};

export const config = { path: '/api/cloudtops' };
