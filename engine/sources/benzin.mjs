import { encodeWin1250Query, decodeWin1250 } from './encoding.mjs';
import { ocrPricePng } from './price_ocr.mjs';
import { BENZIN_FUEL_CODES, unifyFuelKey, normalizePricesObject } from './fuel_taxonomy.mjs';
import { parseOpeningHours, formatHoursSummary } from './hours.mjs';

export const BASE_URL = 'https://www.benzin.sk/index.php';
export const PRICE_IMAGE_URL = 'https://www.benzin.sk/priceimage.php';

/** Kraj codes from benzin.sk <select name="price_search_region"> */
export const REGION_CODES = {
  BB: 1,
  BA: 2,
  KE: 3,
  NR: 4,
  PO: 5,
  TN: 6,
  TT: 7,
  ZA: 8,
};

/** @deprecated use BENZIN_FUEL_CODES / unifyFuelKey — kept for tests */
export const FUEL_CODES = BENZIN_FUEL_CODES;

export const DEFAULT_FUEL_CODE = 4096; // Natural95+ — listing crawl

const DEFAULT_UA =
  'FuelSK/0.1 (+https://github.com/krmll/fuelsk; local collector; respectful crawl)';

/**
 * @param {object} opts
 * @param {string} [opts.userAgent]
 * @param {number} [opts.delayMs]
 * @param {(url: string) => Promise<{html?: string, buffer?: Buffer}>} [opts.fetchFn]
 */
export function createClient(opts = {}) {
  const userAgent = opts.userAgent || process.env.USER_AGENT || DEFAULT_UA;
  const delayMs = Number(opts.delayMs ?? process.env.REQUEST_DELAY_MS ?? 1500);
  let lastAt = 0;

  async function throttle() {
    const wait = delayMs - (Date.now() - lastAt);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastAt = Date.now();
  }

  async function fetchBytes(url) {
    if (opts.fetchFn) {
      const r = await opts.fetchFn(url);
      if (r.buffer) return Buffer.from(r.buffer);
      if (r.html) return Buffer.from(r.html, 'utf8');
      throw new Error(`fetchFn returned nothing for ${url}`);
    }
    await throttle();
    const res = await fetch(url, {
      headers: {
        'User-Agent': userAgent,
        Accept: 'text/html,image/png,*/*',
        'Accept-Language': 'sk,uk,en;q=0.8',
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return Buffer.from(await res.arrayBuffer());
  }

  async function fetchHtml(url) {
    const buf = await fetchBytes(url);
    return decodeWin1250(buf);
  }

  return { fetchBytes, fetchHtml, userAgent, delayMs };
}

export function buildSearchUrl({
  town = '',
  region = REGION_CODES.KE,
  brand = -1,
  fuel = DEFAULT_FUEL_CODE,
  day = 14,
} = {}) {
  const qs = encodeWin1250Query({
    price_search_town: town,
    price_submit: 'Vyhľadať',
    price_search_region: String(region),
    price_search_brand: String(brand),
    price_search_fuel: String(fuel),
    price_search_day: String(day),
    selected_id: '118',
    article_id: '-1',
  });
  return `${BASE_URL}?${qs}`;
}

export function buildStationUrl({ pumpId, brandId = -1 }) {
  const qs = new URLSearchParams({
    selected_id: '163',
    article_id: '-1',
    kraj_id: '-1',
    okres_id: '-1',
    obec_id: '-1',
    brand_id: String(brandId),
    pump_id: String(pumpId),
  });
  return `${BASE_URL}?${qs}`;
}

export function buildPriceImageUrl({ pumpId, fuelId, day = 14 }) {
  const qs = new URLSearchParams({
    price_type: '1',
    posun: String(day),
    pump_id: String(pumpId),
    fuel_id: String(fuelId),
  });
  return `${PRICE_IMAGE_URL}?${qs}`;
}

/** Parse DD.MM.YYYY → YYYY-MM-DD (or null). */
export function parseSkDate(text) {
  const m = String(text).trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!m) return null;
  const [, d, mo, y] = m;
  return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

/**
 * Parse search-result rows.
 * Prices in the list are PNGs — we only take metadata here.
 * @returns {Array<{pumpId, brandId, brand, place, street, address, updatedAt, fresh, fuelId}>}
 */
export function parseSearchResults(html, { fuelId = DEFAULT_FUEL_CODE } = {}) {
  const header = html.match(
    /Zoznam čerpacích staníc s cenami paliva:[\s\S]*?<table[\s\S]*?class='price_header'[\s\S]*?<\/tr>([\s\S]*?)<\/table>/i,
  );
  const section = header ? header[1] : html;

  const rowRe =
    /<tr class='pump_list_row\d+'[^>]*>([\s\S]*?)<\/tr>/gi;
  const results = [];
  let row;
  while ((row = rowRe.exec(section))) {
    const body = row[1];
    const link = body.match(
      /brand_id=(\d+)&pump_id=(\d+)['"][^>]*>([^<]+)<\/a>/i,
    );
    if (!link) continue;
    const brandId = Number(link[1]);
    const pumpId = Number(link[2]);
    const brand = link[3].trim();

    const placeMatch = body.match(
      /pump_id=\d+['"][^>]*>\s*<b>([^<]+)<\/b>\s*<br\s*\/?>\s*([^<]*?)\s*<\/a>/i,
    );
    const place = placeMatch ? placeMatch[1].trim() : '';
    const street = placeMatch ? placeMatch[2].trim() : '';
    const address = [street, place].filter(Boolean).join(', ');

    const dateMatch = body.match(/>(\d{1,2}\.\d{1,2}\.\d{4})</);
    const updatedAt = dateMatch ? parseSkDate(dateMatch[1]) : null;
    const fresh = /obr\/euro\.gif/i.test(body);

    results.push({
      pumpId,
      brandId,
      brand,
      place,
      street,
      address,
      updatedAt,
      fresh,
      fuelId: Number(fuelId),
    });
  }

  // Dedupe by pumpId (keep first / cheapest-sort order).
  const seen = new Set();
  return results.filter((r) => {
    if (seen.has(r.pumpId)) return false;
    seen.add(r.pumpId);
    return true;
  });
}

/**
 * Parse station detail page for name/address and available fuel ids + dates.
 * Prices themselves are images — returned as fuelId list to OCR separately.
 */
export function parseStationPage(html, { pumpId } = {}) {
  const header = html.match(
    /<span id='pump_header'>([^<]+)<\/span>\s*<span id='pump_text'><br\s*\/?>\s*([\s\S]*?)<\/span>/i,
  );
  let brand = header ? header[1].trim() : null;
  let street = null;
  let postal = null;
  let place = null;
  if (header) {
    const lines = header[2]
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/?b>/gi, '')
      .split('\n')
      .map((s) => s.replace(/<[^>]+>/g, '').trim())
      .filter(Boolean);
    // e.g. "Osloboditeľov", "040 17 Košice - Barca"
    street = lines[0] || null;
    if (lines[1]) {
      const m = lines[1].match(/^(\d{3}\s?\d{2})\s+(.+)$/);
      if (m) {
        postal = m[1].replace(/\s+/, ' ');
        place = m[2].trim();
      } else {
        place = lines[1];
      }
    }
  }

  const nameParts = [brand, place].filter(Boolean);
  const name = nameParts.join(' ') || (pumpId != null ? `bsk-${pumpId}` : null);
  const address = [street, postal, place].filter(Boolean).join(', ');

  /** @type {Array<{fuelId: number, fuelKey: string, updatedAt: string|null, label: string}>} */
  const fuels = [];
  const priceRe =
    /priceimage\.php\?[^"'>\s]*pump_id=(\d+)[^"'>\s]*fuel_id=(\d+)[^"'>\s]*['"][^>]*title='([^']*)'/gi;
  let m;
  const seen = new Set();
  while ((m = priceRe.exec(html))) {
    const pid = Number(m[1]);
    if (pumpId != null && pid !== Number(pumpId)) continue;
    const fuelId = Number(m[2]);
    if (seen.has(fuelId)) continue;
    seen.add(fuelId);
    const title = m[3];
    const dateM = title.match(/(\d{1,2}\.\d{1,2}\.\d{4})/);
    const fuelKey = unifyFuelKey(fuelId);
    if (!fuelKey) continue;
    fuels.push({
      fuelId,
      fuelKey,
      updatedAt: dateM ? parseSkDate(dateM[1]) : null,
      label: title,
      sourceLabel: title.split(' - ')[0]?.trim() || title,
    });
  }

  // Fallback: fuel icon titles without matching priceimage order
  if (!fuels.length) {
    const iconRe =
      /\/obr\/paliva\/(?:\d+\/)?(\d+)\.jpg[^>]*title='([^']*Cena aktualizovaná[^']*)'/gi;
    while ((m = iconRe.exec(html))) {
      const fuelId = Number(m[1]);
      const fuelKey = unifyFuelKey(fuelId);
      if (seen.has(fuelId) || !fuelKey) continue;
      seen.add(fuelId);
      const dateM = m[2].match(/(\d{1,2}\.\d{1,2}\.\d{4})/);
      fuels.push({
        fuelId,
        fuelKey,
        updatedAt: dateM ? parseSkDate(dateM[1]) : null,
        label: m[2],
        sourceLabel: m[2].split(' - ')[0]?.trim() || m[2],
      });
    }
  }

  const hours = parseOpeningHours(html);

  return {
    pumpId: pumpId != null ? Number(pumpId) : null,
    brand,
    name,
    street,
    postal,
    place,
    address,
    lat: null,
    lon: null,
    hours,
    hoursSummary: formatHoursSummary(hours),
    fuels,
  };
}

export function toStationRecord(meta, prices, { region = 'KE' } = {}) {
  const id = `bsk-${meta.pumpId}`;
  return {
    id,
    name: meta.name || id,
    brand: meta.brand || null,
    address: meta.address || null,
    lat: meta.lat ?? null,
    lon: meta.lon ?? null,
    region,
    sources: ['benzin.sk'],
    hours: meta.hours || null,
    hoursSummary: meta.hoursSummary || null,
    labels: [],
    openNow: null,
    prices: normalizePricesObject(prices),
  };
}

/**
 * Collect stations for a region / town.
 * @param {object} options
 * @param {ReturnType<typeof createClient>} options.client
 * @param {number|string} [options.regionCode] numeric or KE
 * @param {string} [options.town]
 * @param {string} [options.cityId] settings city id (tagged on records)
 * @param {number} [options.day]
 * @param {number} [options.fuel] listing fuel code
 * @param {number} [options.limit] max stations (for tests)
 * @param {Set<string>} [options.skipIds] already collected station ids (`bsk-…`)
 * @param {(msg: string) => void} [options.log]
 */
export async function collectRegion(options) {
  const {
    client,
    town = '',
    cityId = null,
    day = Number(process.env.DAY_WINDOW || 14),
    fuel = DEFAULT_FUEL_CODE,
    limit = Infinity,
    skipIds = null,
    log = console.log,
  } = options;

  let regionCode = options.regionCode ?? REGION_CODES.KE;
  let regionKey = 'KE';
  if (typeof regionCode === 'string' && REGION_CODES[regionCode] != null) {
    regionKey = regionCode;
    regionCode = REGION_CODES[regionCode];
  } else {
    regionKey =
      Object.entries(REGION_CODES).find(([, v]) => v === Number(regionCode))?.[0] ||
      'KE';
  }

  const searchUrl = buildSearchUrl({ town, region: regionCode, fuel, day });
  log(`search ${searchUrl}`);
  let html = await client.fetchHtml(searchUrl);
  let list = parseSearchResults(html, { fuelId: fuel });

  if (!list.length && town === '') {
    log('empty town returned 0 rows; fallback town=Košice');
    html = await client.fetchHtml(
      buildSearchUrl({ town: 'Košice', region: regionCode, fuel, day }),
    );
    list = parseSearchResults(html, { fuelId: fuel });
  }

  if (skipIds?.size) {
    const before = list.length;
    list = list.filter((row) => !skipIds.has(`bsk-${row.pumpId}`));
    if (before !== list.length) {
      log(`list: skip ${before - list.length} already collected`);
    }
  }

  log(`list: ${list.length} stations`);
  const stations = [];
  const slice = list.slice(0, limit);

  for (const row of slice) {
    const stationUrl = buildStationUrl({
      pumpId: row.pumpId,
      brandId: row.brandId,
    });
    log(`station ${row.pumpId} ${row.brand} ${row.place}`);
    const stationHtml = await client.fetchHtml(stationUrl);
    const meta = parseStationPage(stationHtml, { pumpId: row.pumpId });
    if (!meta.brand) meta.brand = row.brand;
    if (!meta.address) meta.address = row.address;
    if (!meta.place) meta.place = row.place;
    if (!meta.street) meta.street = row.street;
    if (!meta.name || meta.name.startsWith('bsk-')) {
      meta.name = [meta.brand, meta.place || row.place].filter(Boolean).join(' ');
    }

    const fuels =
      meta.fuels.length > 0
        ? meta.fuels
        : [
            {
              fuelId: fuel,
              fuelKey: unifyFuelKey(fuel) || String(fuel),
              updatedAt: row.updatedAt,
              label: '',
            },
          ];

    /** @type {Record<string, {eur: number, updatedAt: string|null, source: string, sourceLabel?: string}>} */
    const prices = {};
    for (const f of fuels) {
      const imgUrl = buildPriceImageUrl({
        pumpId: row.pumpId,
        fuelId: f.fuelId,
        day,
      });
      try {
        const png = await client.fetchBytes(imgUrl);
        const eur = ocrPricePng(png);
        if (eur == null) {
          log(`  OCR failed fuel=${f.fuelId} (${f.fuelKey})`);
          continue;
        }
        const key = unifyFuelKey(f.fuelKey) || f.fuelKey;
        if (prices[key] && f.fuelId === 32) continue;
        prices[key] = {
          eur,
          updatedAt: f.updatedAt || row.updatedAt,
          source: 'benzin.sk',
          sourceLabel: f.sourceLabel || f.label || undefined,
        };
        log(`  ${key}=${eur} (${f.updatedAt || '?'})`);
      } catch (err) {
        log(`  price fetch failed fuel=${f.fuelId}: ${err.message}`);
      }
    }

    const rec = toStationRecord(
      { ...meta, hours: meta.hours, hoursSummary: meta.hoursSummary },
      prices,
      { region: regionKey },
    );
    if (cityId) rec.cityId = cityId;
    stations.push(rec);
  }

  return stations;
}

/**
 * Collect priced stations for every settings city (dedupe by pump id).
 * @param {object} options
 * @param {ReturnType<typeof createClient>} options.client
 * @param {Array<{id: string, name: string, region: string}>} options.cities
 * @param {number} [options.day]
 * @param {number} [options.limit] max detail fetches per city
 * @param {(msg: string) => void} [options.log]
 */
export async function collectCities(options) {
  const {
    client,
    cities,
    day = Number(process.env.DAY_WINDOW || 14),
    limit = Infinity,
    log = console.log,
  } = options;

  const seen = new Set();
  const all = [];

  for (const city of cities) {
    log(`\n=== city ${city.name} (${city.id}, ${city.region}) ===`);
    const part = await collectRegion({
      client,
      regionCode: city.region,
      town: city.name,
      cityId: city.id,
      day,
      limit,
      skipIds: seen,
      log,
    });
    for (const s of part) seen.add(s.id);
    all.push(...part);
    log(`city ${city.id}: +${part.length} (total ${all.length})`);
  }

  return all;
}

/**
 * Build stations from local fixtures (no network) — used by --dry-run.
 */
export function collectFromFixtures({
  searchHtml,
  stationPages, // Map pumpId -> html
  priceImages, // Map `${pumpId}_${fuelId}` -> Buffer
  region = 'KE',
  day = 14,
  log = console.log,
} = {}) {
  const list = parseSearchResults(searchHtml);
  log(`fixture list: ${list.length} stations`);
  const stations = [];

  for (const row of list) {
    const html = stationPages.get(Number(row.pumpId));
    if (!html) continue;
    const meta = parseStationPage(html, { pumpId: row.pumpId });
    if (!meta.brand) meta.brand = row.brand;
    if (!meta.address) meta.address = row.address;

    const prices = {};
    for (const f of meta.fuels) {
      const key = `${row.pumpId}_${f.fuelId}`;
      const png = priceImages.get(key);
      if (!png) continue;
      const eur = ocrPricePng(png);
      if (eur == null) continue;
      prices[f.fuelKey] = {
        eur,
        updatedAt: f.updatedAt || row.updatedAt,
        source: 'benzin.sk',
        sourceLabel: f.sourceLabel || undefined,
      };
    }
    stations.push(toStationRecord(meta, prices, { region }));
  }

  return stations;
}
