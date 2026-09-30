#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createClient,
  collectRegion,
  collectCities,
  collectFromFixtures,
  REGION_CODES,
} from './sources/benzin.mjs';
import { resolveCities, SK_CITIES, uniqueRegions } from './sources/cities.mjs';
import { geocodeStations, FIXTURE_GEOSEED } from './geocode.mjs';
import { enrichStations } from './sources/enrich.mjs';
import { normalizePricesObject } from './sources/fuel_taxonomy.mjs';
import { fetchOsmFuel } from './sources/osm.mjs';
import { mergeStations } from './sources/merge.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const FIXTURES = path.join(__dirname, 'test', 'fixtures');
const DATA_DIR = path.join(ROOT, 'data');
const GEOCACHE_PATH = path.join(DATA_DIR, 'geocache.json');
const NETWORKS_PATH = path.join(DATA_DIR, 'networks.json');

function parseArgs(argv) {
  const args = {
    dryRun: false,
    limit: null,
    region: null,
    town: '',
    cities: null,
    skipGeocode: false,
    skipOsm: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--limit') args.limit = Number(argv[++i]);
    else if (a === '--region') args.region = argv[++i];
    else if (a === '--town') args.town = argv[++i];
    else if (a === '--cities') args.cities = argv[++i];
    else if (a === '--skip-geocode') args.skipGeocode = true;
    else if (a === '--skip-osm') args.skipOsm = true;
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

function loadDotEnv() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    if (process.env[m[1]] == null) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const json = `${JSON.stringify(data, null, 2)}\n`;
  fs.writeFileSync(filePath, json, 'utf8');
  return json;
}

function writeStations(stations, { networks = null, dryRun = false } = {}) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const out = {
    generatedAt: new Date().toISOString(),
    stations,
  };
  // Dry-run must not wipe live data — write beside it.
  const fileName = dryRun ? 'stations.dry-run.json' : 'stations.json';
  const networksName = dryRun ? 'networks.dry-run.json' : 'networks.json';
  const json = writeJson(path.join(DATA_DIR, fileName), out);
  if (networks) {
    writeJson(path.join(DATA_DIR, networksName), {
      generatedAt: out.generatedAt,
      networks,
    });
  }
  if (!dryRun) {
    const pwaData = path.join(ROOT, 'pwa', 'data');
    fs.mkdirSync(pwaData, { recursive: true });
    fs.writeFileSync(path.join(pwaData, 'stations.json'), json, 'utf8');
    if (networks) {
      fs.writeFileSync(
        path.join(pwaData, 'networks.json'),
        `${JSON.stringify({ generatedAt: out.generatedAt, networks }, null, 2)}\n`,
        'utf8',
      );
    }
  }
  return path.join(DATA_DIR, fileName);
}

function dryRunCollect(log) {
  const searchHtml = new TextDecoder('windows-1250').decode(
    fs.readFileSync(path.join(FIXTURES, 'search_kosice_natural95plus.html')),
  );

  const stationPages = new Map();
  for (const name of ['station_609.html', 'station_221.html']) {
    const buf = fs.readFileSync(path.join(FIXTURES, name));
    const html = new TextDecoder('windows-1250').decode(buf);
    const id = Number(name.match(/station_(\d+)/)[1]);
    stationPages.set(id, html);
  }

  const priceImages = new Map();
  const priceDir = path.join(FIXTURES, 'prices');
  for (const file of fs.readdirSync(priceDir)) {
    const m = file.match(/^(\d+)_(\d+)\.png$/);
    if (!m) continue;
    priceImages.set(`${m[1]}_${m[2]}`, fs.readFileSync(path.join(priceDir, file)));
  }

  return collectFromFixtures({
    searchHtml,
    stationPages,
    priceImages,
    region: 'KE',
    log,
  });
}

function resolveCityList(args) {
  const fromCli = args.cities
    ? args.cities.split(',').map((s) => s.trim()).filter(Boolean)
    : null;
  const fromEnv = process.env.CITIES
    ? process.env.CITIES.split(',').map((s) => s.trim()).filter(Boolean)
    : null;
  const ids = fromCli || (fromEnv && fromEnv[0] !== 'all' ? fromEnv : null);
  return resolveCities({ cityIds: ids, allCities: !ids });
}

async function main() {
  loadDotEnv();
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(`Usage: node engine/index.mjs [options]

  Default (live): collect all PWA settings cities (${SK_CITIES.length} towns).

  --dry-run          No network; parse fixtures → data/stations.dry-run.json (does not overwrite live data)
  --cities id,id     Subset of settings cities (e.g. kosice,bratislava)
  --region KE        Single kraj mode (legacy; use with optional --town)
  --town Košice      Town filter for --region mode
  --limit N          Cap station detail fetches (per city in multi-city mode)
  --skip-geocode     Skip Nominatim / use geocache + fixture seed only
  --skip-osm         Skip OpenStreetMap fuel POIs

  Env: CITIES=all | kosice,bratislava   DAY_WINDOW   REQUEST_DELAY_MS
`);
    process.exit(0);
  }

  const log = (...a) => console.log(...a);
  const singleRegion = Boolean(args.region || args.town);
  let osmRegion = 'SK';
  let stations;

  if (args.dryRun) {
    log('mode: dry-run (fixtures only)');
    stations = dryRunCollect(log);
    osmRegion = 'KE';
  } else if (singleRegion) {
    const region = args.region || 'KE';
    if (REGION_CODES[region] == null) {
      console.error(`Unknown region ${region}. Known: ${Object.keys(REGION_CODES).join(', ')}`);
      process.exit(1);
    }
    const client = createClient({
      delayMs: process.env.REQUEST_DELAY_MS,
      userAgent: process.env.USER_AGENT,
    });
    log(`mode: live region=${region} town=${args.town || '(empty)'} delay=${client.delayMs}ms`);
    stations = await collectRegion({
      client,
      regionCode: region,
      town: args.town,
      day: Number(process.env.DAY_WINDOW || 14),
      limit: args.limit ?? Infinity,
      log,
    });
    osmRegion = region;
  } else {
    const cities = resolveCityList(args);
    const regions = uniqueRegions(cities);
    const client = createClient({
      delayMs: process.env.REQUEST_DELAY_MS,
      userAgent: process.env.USER_AGENT,
    });
    log(
      `mode: live cities=${cities.map((c) => c.id).join(',')} regions=${regions.join(',')} delay=${client.delayMs}ms`,
    );
    stations = await collectCities({
      client,
      cities,
      day: Number(process.env.DAY_WINDOW || 14),
      limit: args.limit ?? Infinity,
      log,
    });
    osmRegion = 'SK';
  }

  if (!args.skipGeocode) {
    await geocodeStations(stations, {
      cachePath: GEOCACHE_PATH,
      email: process.env.NOMINATIM_EMAIL,
      userAgent: process.env.USER_AGENT,
      delayMs: 1100,
      seed: FIXTURE_GEOSEED,
      offline: args.dryRun,
      log,
    });
  }

  const osmCachePath = path.join(DATA_DIR, `osm_fuel_${osmRegion.toLowerCase()}.json`);
  let osmStations = [];
  if (!args.skipOsm) {
    try {
      if (args.dryRun && fs.existsSync(osmCachePath)) {
        osmStations = JSON.parse(fs.readFileSync(osmCachePath, 'utf8')).stations || [];
        log(`osm: loaded cache ${osmStations.length}`);
      } else if (!args.dryRun) {
        osmStations = await fetchOsmFuel({ region: osmRegion, log });
        writeJson(osmCachePath, {
          generatedAt: new Date().toISOString(),
          region: osmRegion,
          stations: osmStations,
        });
      } else if (fs.existsSync(path.join(DATA_DIR, 'osm_fuel_sk.json'))) {
        osmStations =
          JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'osm_fuel_sk.json'), 'utf8'))
            .stations || [];
        log(`osm: loaded SK cache ${osmStations.length}`);
      }
    } catch (err) {
      log(`osm: skipped (${err.message})`);
      if (fs.existsSync(osmCachePath)) {
        osmStations = JSON.parse(fs.readFileSync(osmCachePath, 'utf8')).stations || [];
        log(`osm: fallback cache ${osmStations.length}`);
      }
    }
  }

  if (osmStations.length) {
    const before = stations.length;
    stations = mergeStations(stations, osmStations);
    log(`merge: ${before} priced + ${osmStations.length} osm → ${stations.length} total`);
  }

  for (const s of stations) {
    s.prices = normalizePricesObject(s.prices);
  }
  const { networks } = enrichStations(stations);
  const uniformBrands = Object.entries(networks)
    .filter(([, n]) => n.mostlyUniform)
    .map(([b]) => b);
  log(
    `enrich: labels ok; mostly-uniform networks: ${uniformBrands.join(', ') || '—'}`,
  );

  const withPrices = stations.filter((s) => Object.keys(s.prices || {}).length > 0);
  const withCoords = stations.filter((s) => s.lat != null && s.lon != null);
  const openN = stations.filter((s) => s.openNow === true).length;
  const closedN = stations.filter((s) => s.openNow === false).length;
  log(
    `stations=${stations.length} withPrices=${withPrices.length} withCoords=${withCoords.length} open=${openN} closed=${closedN} pricePoints=${withPrices.reduce((n, s) => n + Object.keys(s.prices || {}).length, 0)}`,
  );

  const outPath = writeStations(stations, { networks, dryRun: args.dryRun });
  log(`wrote ${outPath}${args.dryRun ? ' (dry-run; live stations.json untouched)' : ''}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
