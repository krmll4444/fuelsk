/**
 * Download brand logos from benzin.sk into pwa/icons/brands/
 * and write brands.json for the PWA.
 *
 * Prefer full banners (obr/logo/logo_*.gif); also keep 12×12 small/{id}.gif.
 *
 * Usage: node engine/fetch_brand_logos.mjs
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from './sources/benzin.mjs';
import { decodeWin1250 } from './sources/encoding.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'pwa/icons/brands');
const FIXTURE = path.join(ROOT, 'engine/test/fixtures/home.html');
const BRANDS_PAGE =
  'https://www.benzin.sk/index.php?selected_id=163&article_id=-1&network=-1&kraj_id=-1&okres_id=-1&obec_id=-1&brand_id=-1&pump_id=-1';

export function normalizeBrandKey(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function brandNameFromTitle(title) {
  return String(title || '')
    .replace(/^Čerpacie stanice\s+/i, '')
    .replace(/^Čerpacia stanica\s+/i, '')
    .trim();
}

function parseBrandSelect(html) {
  const m = html.match(/name=["']price_search_brand["'][^>]*>([\s\S]*?)<\/select>/i);
  if (!m) return [];
  const out = [];
  const re = /<option\s+value=["'](\d+)["']\s*>([^<]+)<\/option>/gi;
  let x;
  while ((x = re.exec(m[1]))) {
    const id = Number(x[1]);
    const name = x[2].replace(/\s+/g, ' ').trim();
    if (!Number.isFinite(id) || id < 0 || !name || name.startsWith('---')) continue;
    out.push({ id, name });
  }
  return out;
}

/** brand_id → { logo path, title } from Siete ČS grid */
function parseBrandLogos(html) {
  const re =
    /brand_id=(\d+)&pump_id=-1[^>]*>\s*<img[^>]+src=['"](obr\/logo\/[^'"]+)['"][^>]*(?:title|alt)=['"]([^'"]*)['"]/gi;
  /** @type {Map<number, { path: string, title: string }>} */
  const map = new Map();
  let m;
  while ((m = re.exec(html))) {
    const id = Number(m[1]);
    const p = m[2];
    if (!Number.isFinite(id) || /spacer\.gif$/i.test(p)) continue;
    map.set(id, { path: p, title: m[3] });
  }
  return map;
}

const EXTRA_ALIASES = [
  ['AS 24', 'AS24'],
  ['1SPS a.s.', '1.SPS'],
  ['Tankujeme!', 'Tankujeme'],
  ['DALIOIL', 'DaliOil'],
  ['Gas', 'GAS'],
  ['Gulf', 'GULF'],
  ['SPP CNG', 'SPP CNG'],
  ['JOPI', 'Jopi Trade'],
  ['Flavia', 'Flaga'],
  ['Flavia Art', 'Flaga'],
  ['LPG Flaga', 'Flaga'],
  ['LPG FLAVIA', 'Flaga'],
  ['Sadka', 'Sadka'],
  ['SADKA', 'Sadka'],
  ['Pumpa', 'PUMPA Nováky'],
  ['Pumpa Snina', 'PUMPA Nováky'],
  ['Ing. Tibor Zagiba', 'Zagiba'],
  ['TAM Autohof', 'TAM Autohof'],
];

async function download(client, url, dest) {
  const buf = await client.fetchBytes(url);
  if (buf.length < 40) throw new Error(`too small ${buf.length}`);
  if (buf[0] !== 0x47 || buf[1] !== 0x49) throw new Error('not gif');
  await fs.writeFile(dest, buf);
  return buf.length;
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const client = createClient({ delayMs: 250 });

  let html;
  try {
    html = await client.fetchHtml(BRANDS_PAGE);
  } catch (err) {
    console.warn('live brands page failed, using fixture:', err.message);
    html = decodeWin1250(await fs.readFile(FIXTURE));
  }

  const selectBrands = parseBrandSelect(html);
  if (!selectBrands.length) {
    const fix = decodeWin1250(await fs.readFile(FIXTURE));
    selectBrands.push(...parseBrandSelect(fix));
  }
  const logoById = parseBrandLogos(html);
  console.log(`select=${selectBrands.length} logos_on_page=${logoById.size}`);

  /** @type {Record<string, object>} */
  const byId = {};
  /** @type {Record<string, object>} */
  const byKey = {};

  for (const b of selectBrands) {
    const logoMeta = logoById.get(b.id);
    const name = brandNameFromTitle(logoMeta?.title) || b.name;
    let bannerFile = null;
    let iconFile = null;

    if (logoMeta?.path) {
      const base = path.basename(logoMeta.path);
      const dest = path.join(OUT_DIR, base);
      try {
        const n = await download(client, `https://www.benzin.sk/${logoMeta.path}`, dest);
        bannerFile = base;
        console.log(`banner ${b.id} ${name} → ${base} (${n}b)`);
      } catch (err) {
        console.warn(`banner fail ${b.id} ${name}: ${err.message}`);
      }
    }

    const iconName = `icon-${b.id}.gif`;
    try {
      const n = await download(
        client,
        `https://www.benzin.sk/obr/logo/small/${b.id}.gif`,
        path.join(OUT_DIR, iconName),
      );
      iconFile = iconName;
      console.log(`icon ${b.id} (${n}b)`);
    } catch (err) {
      console.warn(`icon fail ${b.id}: ${err.message}`);
    }

    if (!bannerFile && !iconFile) continue;

    const entry = {
      id: b.id,
      name,
      selectName: b.name,
      file: bannerFile || iconFile,
      banner: bannerFile,
      icon: iconFile,
    };
    byId[String(b.id)] = entry;
    byKey[normalizeBrandKey(name)] = entry;
    byKey[normalizeBrandKey(b.name)] = entry;
  }

  for (const [from, to] of EXTRA_ALIASES) {
    const a = normalizeBrandKey(from);
    const b = normalizeBrandKey(to);
    if (byKey[b] && !byKey[a]) byKey[a] = byKey[b];
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    source: 'https://www.benzin.sk/obr/logo/',
    count: Object.keys(byId).length,
    byId,
    byKey,
  };
  await fs.writeFile(path.join(OUT_DIR, 'brands.json'), JSON.stringify(manifest, null, 2));
  // also mirror under pwa/data for easy fetch if icons path is awkward
  await fs.writeFile(
    path.join(ROOT, 'pwa/data/brands.json'),
    JSON.stringify(manifest, null, 2),
  );
  console.log(`done: ${manifest.count} brands → ${OUT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
