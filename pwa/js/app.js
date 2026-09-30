import {
  SK_CITIES,
  cityById,
  suggestAddresses,
  debounce,
  fetchCityBoundary,
  pointInGeoJSON,
} from './places.mjs';
import { routeDriving, tripCosts } from './routing.mjs';
import { LANGS, getLang, setLang, t, applyStaticI18n } from './i18n.mjs';

const PRIMARY_FUELS = [
  'natural95',
  'natural95_plus',
  'natural98',
  'natural100',
  'diesel',
  'diesel_plus',
];

/** On-screen prices older than this are hidden (kept in JSON for stats). */
const FRESH_PRICE_DAYS = 3;

const DEFAULT_SETTINGS = {
  fuel: 'natural95_plus',
  consumption: 7,
  tankLiters: 40,
  radiusKm: 10,
  maxDetourKm: 10,
  theme: 'system',
  lang: 'sk',
  cityId: 'kosice',
  homeLabel: '',
  homeLat: null,
  homeLon: null,
};

const DATA_URLS = ['./data/stations.json', '../data/stations.json'];

const state = {
  stations: [],
  generatedAt: null,
  settings: loadSettings(),
  userPos: null,
  selectedId: null,
  map: null,
  cluster: null,
  markersById: new Map(),
  meanPrice: null,
  homeMarker: null,
  cityLayer: null,
  cityGeojson: null,
  cityBoundarySource: null,
  brandLogos: null,
  compare: { a: null, b: null },
  compareLayers: { a: null, b: null },
  compareMarkers: { a: null, b: null },
  compareRouteCache: { a: null, b: null },
  _compareRouteSeq: 0,
};

function loadSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem('fuelsk.settings') || '{}') };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function fuelLabel(key) {
  const k = key === 'natural99_plus' ? 'natural100' : key;
  return t(k) !== k ? t(k) : k;
}

function labelUi(key) {
  const map = {
    best_price: { text: t('bestPrice'), className: 'tag deal' },
    below_average: { text: t('belowAvg'), className: 'tag good' },
    network_price: { text: t('networkPrice'), className: 'tag net' },
    open_now: { text: t('openNow'), className: 'tag open' },
    closed_now: { text: t('closedNow'), className: 'tag closed' },
  };
  return map[key];
}

function localeTag() {
  return getLang() === 'en' ? 'en-GB' : 'sk-SK';
}

function applyLanguage() {
  setLang(state.settings.lang || 'sk');
  applyStaticI18n();
  fillLangSelect();
  fillFuelSelects();
  fillBrandSelect();
  updateHomeMarker();
  updateCompareMeta();
  const a = state.compare.a && state.stations.find((s) => s.id === state.compare.a);
  const b = state.compare.b && state.stations.find((s) => s.id === state.compare.b);
  if (!a) {
    const el = document.getElementById('slot-a-name');
    if (el) el.textContent = t('pickA');
  }
  if (!b) {
    const el = document.getElementById('slot-b-name');
    if (el) el.textContent = t('pickB');
  }
  updateComparePickUi();
  const runBtn = document.getElementById('btn-run-compare');
  if (runBtn && !runBtn.disabled) runBtn.textContent = t('runCompare');
}

function saveSettings(next) {
  const prevLang = state.settings.lang;
  state.settings = { ...state.settings, ...next };
  localStorage.setItem('fuelsk.settings', JSON.stringify(state.settings));
  applyTheme();
  if (next.lang != null && next.lang !== prevLang) applyLanguage();
  updateHomeMarker();
  updateCompareMeta();
}

/** Prefer home → GPS → city center for radius / compare origin. */
function originPos() {
  const s = state.settings;
  if (s.homeLat != null && s.homeLon != null) {
    return { lat: s.homeLat, lon: s.homeLon, source: 'home' };
  }
  if (state.userPos) return { ...state.userPos, source: 'gps' };
  const city = cityById(s.cityId);
  if (city) return { lat: city.lat, lon: city.lon, source: 'city' };
  return null;
}

/**
 * Origin for the radius filter while browsing a settings city.
 * Home/GPS outside the selected city must not wipe the city map empty.
 */
function radiusOrigin() {
  const city = cityById(state.settings.cityId);
  const preferred =
    state.settings.homeLat != null && state.settings.homeLon != null
      ? { lat: state.settings.homeLat, lon: state.settings.homeLon, source: 'home' }
      : state.userPos
        ? { ...state.userPos, source: 'gps' }
        : null;

  if (preferred) {
    if (!state.cityGeojson || pointInGeoJSON(preferred.lat, preferred.lon, state.cityGeojson)) {
      return preferred;
    }
  }
  if (city) return { lat: city.lat, lon: city.lon, source: 'city' };
  return preferred || originPos();
}

function inSelectedCity(station) {
  if (!state.cityGeojson) return true;
  return pointInGeoJSON(station.lat, station.lon, state.cityGeojson);
}

function filteredStations({ requirePrice = false } = {}) {
  const f = getFilters();
  const origin = radiusOrigin();
  return state.stations
    .map((s) => {
      const price = freshPrice(s, f.fuel);
      const dist = origin ? haversineKm(origin, { lat: s.lat, lon: s.lon }) : null;
      return { station: s, price, dist };
    })
    .filter(({ station, price, dist }) => {
      if (!inSelectedCity(station)) return false;
      if (requirePrice && (!price || price.eur == null)) return false;
      if (f.brand && station.brand !== f.brand) return false;
      if (f.radiusKm > 0 && origin && (dist == null || dist > f.radiusKm)) return false;
      if (f.openOnly) {
        const open = isOpenNow(station);
        if (open === false) return false;
      }
      return true;
    })
    .sort((a, b) => {
      const ap = a.price?.eur;
      const bp = b.price?.eur;
      if (ap != null && bp != null && ap !== bp) return ap - bp;
      if (ap != null && bp == null) return -1;
      if (ap == null && bp != null) return 1;
      return (a.dist ?? 1e9) - (b.dist ?? 1e9);
    });
}

function homePinHtml() {
  return `<div class="home-pin" title="${escapeHtml(t('home'))}">
    <span class="home-pin-disk" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="18" height="18" focusable="false">
        <path fill="currentColor" d="M12 3.2 3.5 10.2c-.3.25-.35.7-.1 1 .25.3.7.35 1 .1L6 9.8V19c0 .55.45 1 1 1h3.2v-5.2h3.6V20H17c.55 0 1-.45 1-1v-9.2l1.6 1.3c.3.25.75.2 1-.1.25-.3.2-.75-.1-1L12 3.2z"/>
      </svg>
    </span>
  </div>`;
}

function updateHomeMarker() {
  if (!state.map) return;
  const s = state.settings;
  if (s.homeLat == null || s.homeLon == null) {
    if (state.homeMarker) {
      state.map.removeLayer(state.homeMarker);
      state.homeMarker = null;
    }
    return;
  }
  const latlng = [s.homeLat, s.homeLon];
  const icon = L.divIcon({
    className: 'home-marker',
    html: homePinHtml(),
    iconSize: [36, 42],
    iconAnchor: [18, 40],
  });
  if (!state.homeMarker) {
    state.homeMarker = L.marker(latlng, { icon, zIndexOffset: 800 }).addTo(state.map);
    state.homeMarker.bindTooltip(t('home'), { permanent: false });
  } else {
    state.homeMarker.setLatLng(latlng);
    state.homeMarker.setIcon(icon);
    state.homeMarker.setTooltipContent(t('home'));
  }
}

function updateCompareMeta() {
  const el = document.getElementById('compare-origin-meta');
  if (!el) return;
  const o = originPos();
  if (!o) {
    el.textContent = t('setHomeOrGps');
    return;
  }
  el.textContent =
    o.source === 'home'
      ? t('fromHome', { label: state.settings.homeLabel || '…' })
      : o.source === 'gps'
        ? t('fromGps')
        : t('fromCity', { name: cityById(state.settings.cityId)?.name || '' });
}

function applyTheme() {
  const theme = state.settings.theme;
  const dark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

function haversineKm(a, b) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function daysAgo(isoDate) {
  if (!isoDate) return Infinity;
  const ts = Date.parse(isoDate.length === 10 ? `${isoDate}T12:00:00Z` : isoDate);
  if (!Number.isFinite(ts)) return Infinity;
  return (Date.now() - ts) / 86400000;
}

function formatAge(isoDate) {
  const d = daysAgo(isoDate);
  if (!Number.isFinite(d) || d === Infinity) return t('unknownDate');
  if (d < 1) return t('today');
  if (d < 2) return t('dayAgo');
  return t('daysAgo', { n: Math.floor(d) });
}

function formatPrice(eur) {
  return eur.toFixed(3).replace('.', ',');
}

function priceLevel(eur, mean) {
  if (mean == null || !Number.isFinite(eur)) return 'na';
  if (eur <= mean * 0.985) return 'cheap';
  if (eur >= mean * 1.015) return 'dear';
  return 'mid';
}

function minutesOf(hhmm) {
  const m = String(hhmm).match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h === 24 && min === 0) return 24 * 60;
  return h * 60 + min;
}

/** Live open/closed from hours (Europe/Bratislava). */
function isOpenNow(station) {
  const hours = station.hours;
  if (!hours?.length) return station.openNow ?? null;
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Bratislava',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]));
  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const day = weekdayMap[parts.weekday];
  const nowMin = Number(parts.hour) * 60 + Number(parts.minute);
  const today = hours.filter((h) => h.day === day);
  if (!today.length) return false;
  for (const slot of today) {
    const a = minutesOf(slot.open);
    const b = minutesOf(slot.close);
    if (a == null || b == null) continue;
    if (a === 0 && b >= 24 * 60) return true;
    if (b > a && nowMin >= a && nowMin < b) return true;
    if (b <= a && (nowMin >= a || nowMin < b)) return true;
  }
  return false;
}

function dealInfo(rows) {
  if (!rows.length) return { mean: null, bestEur: null, byId: new Map() };
  const mean = rows.reduce((n, r) => n + r.price.eur, 0) / rows.length;
  const bestEur = Math.min(...rows.map((r) => r.price.eur));
  const byId = new Map();
  for (const r of rows) {
    const labels = [];
    if (r.price.eur === bestEur) labels.push('best_price');
    if (r.price.eur <= mean * 0.985) labels.push('below_average');
    byId.set(r.station.id, labels);
  }
  return { mean, bestEur, byId };
}

function stationBadges(station, dealLabels = []) {
  const labels = new Set([...(station.labels || []), ...dealLabels]);
  const open = isOpenNow(station);
  labels.delete('open_now');
  labels.delete('closed_now');
  if (open === true) labels.add('open_now');
  if (open === false) labels.add('closed_now');
  const order = ['best_price', 'below_average', 'network_price', 'open_now', 'closed_now'];
  return order
    .filter((k) => labels.has(k) && labelUi(k))
    .map((k) => {
      const ui = labelUi(k);
      return `<span class="${ui.className}">${ui.text}</span>`;
    })
    .join('');
}

async function loadStations() {
  let lastErr;
  for (const url of DATA_URLS) {
    try {
      const res = await fetch(url, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`${url} ${res.status}`);
      const data = await res.json();
      state.stations = (data.stations || [])
        .filter((s) => s.lat != null && s.lon != null)
        .map((s) => {
          if (s.prices?.natural99_plus && !s.prices.natural100) {
            s.prices.natural100 = s.prices.natural99_plus;
            delete s.prices.natural99_plus;
          }
          return s;
        });
      state.generatedAt = data.generatedAt || null;
      return;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('stations.json');
}

function currentFuel() {
  return document.getElementById('filter-fuel').value || state.settings.fuel;
}

function getFilters() {
  return {
    fuel: currentFuel(),
    brand: document.getElementById('filter-brand').value,
    radiusKm: Number(document.getElementById('filter-radius').value),
    openOnly: document.getElementById('filter-open')?.checked === true,
  };
}

function stationPrice(station, fuel) {
  if (fuel === 'natural100') {
    return station.prices?.natural100 || station.prices?.natural99_plus || null;
  }
  return station.prices?.[fuel] || null;
}

/** Price for UI/map only if updated within FRESH_PRICE_DAYS. */
function freshPrice(station, fuel) {
  const p = stationPrice(station, fuel);
  if (!p || p.eur == null) return null;
  if (daysAgo(p.updatedAt) > FRESH_PRICE_DAYS) return null;
  return p;
}

function mapStations() {
  return filteredStations({ requirePrice: false }).filter(
    (r) => r.station.lat != null && r.station.lon != null,
  );
}

function listStations() {
  return filteredStations({ requirePrice: false });
}

function fillFuelSelects() {
  const fuelEl = document.getElementById('filter-fuel');
  const settingsFuel = document.getElementById('settings-fuel');
  if (!fuelEl || !settingsFuel) return;

  const fuels = new Set();
  for (const s of state.stations) {
    for (const k of Object.keys(s.prices || {})) fuels.add(k === 'natural99_plus' ? 'natural100' : k);
  }
  const ordered = state.stations.length
    ? [
        ...PRIMARY_FUELS.filter((k) => fuels.has(k)),
        ...[...fuels].filter((k) => !PRIMARY_FUELS.includes(k)),
      ]
    : [...PRIMARY_FUELS];

  const opts = ordered.map((k) => `<option value="${k}">${fuelLabel(k)}</option>`).join('');
  fuelEl.innerHTML = opts;
  settingsFuel.innerHTML = opts;
  const preferred = fuels.has(state.settings.fuel)
    ? state.settings.fuel
    : state.settings.fuel === 'natural99_plus' && fuels.has('natural100')
      ? 'natural100'
      : ordered[0];
  if (preferred) {
    fuelEl.value = preferred;
    settingsFuel.value = preferred;
  }
}

function fillBrandSelect() {
  const el = document.getElementById('filter-brand');
  if (!el) return;
  const brands = [...new Set(state.stations.map((s) => s.brand).filter(Boolean))].sort();
  el.innerHTML =
    `<option value="">${t('brandAll')}</option>` +
    brands.map((b) => `<option value="${b}">${b}</option>`).join('');
}

function fillLangSelect() {
  const el = document.getElementById('settings-lang');
  if (!el) return;
  el.innerHTML = LANGS.map((l) => `<option value="${l.id}">${l.label}</option>`).join('');
  el.value = state.settings.lang || 'sk';
}

function initMap() {
  state.map = L.map('map', {
    zoomControl: false,
    attributionControl: true,
  }).setView([48.72, 21.26], 11);

  L.control.zoom({ position: 'topright' }).addTo(state.map);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap',
  }).addTo(state.map);

  state.cluster = L.markerClusterGroup({
    showCoverageOnHover: false,
    maxClusterRadius: 48,
  });
  state.map.addLayer(state.cluster);
}

async function loadCityBoundary(cityId) {
  const id = cityId || state.settings.cityId;
  const meta = document.getElementById('list-meta');
  if (meta) meta.textContent = t('cityBoundaryLoading');

  if (state.cityLayer) {
    state.map.removeLayer(state.cityLayer);
    state.cityLayer = null;
  }
  state.cityGeojson = null;
  state.cityBoundarySource = null;

  try {
    const { geojson, source } = await fetchCityBoundary(id);
    state.cityGeojson = geojson;
    state.cityBoundarySource = source;
    state.cityLayer = L.geoJSON(geojson, {
      style: {
        color: '#0f3d2e',
        weight: 2.5,
        opacity: 0.85,
        fillColor: '#1a5c45',
        fillOpacity: 0.08,
        dashArray: source === 'bbox' ? '6 4' : null,
      },
      className: 'city-boundary',
    }).addTo(state.map);
    // Keep boundary under markers
    state.cityLayer.bringToBack();
    if (source === 'bbox' && meta) {
      meta.textContent = t('cityBoundaryFail');
    }
  } catch {
    if (meta) meta.textContent = t('cityBoundaryFail');
  }
}

function fitToCityOrStations(rows) {
  if (state.cityLayer) {
    try {
      state.map.fitBounds(state.cityLayer.getBounds().pad(0.06));
      return;
    } catch {
      /* fall through */
    }
  }
  if (rows.length) {
    const bounds = L.latLngBounds(rows.map((r) => [r.station.lat, r.station.lon]));
    const origin = originPos();
    if (origin) bounds.extend([origin.lat, origin.lon]);
    state.map.fitBounds(bounds.pad(0.15));
  }
}

function markerHtml(eur) {
  const label = eur != null ? formatPrice(eur) : '—';
  return `<span>${label}</span>`;
}

const BRAND_FALLBACK = {
  slovnaft: { bg: '#c8102e', fg: '#fff', letter: 'S' },
  omv: { bg: '#0070ad', fg: '#fff', letter: 'O' },
  shell: { bg: '#fbce07', fg: '#dd1d21', letter: 'Sh' },
  mol: { bg: '#009640', fg: '#fff', letter: 'M' },
  orlen: { bg: '#e30613', fg: '#fff', letter: 'Or' },
  benzina: { bg: '#f36c00', fg: '#fff', letter: 'B' },
  tesco: { bg: '#00539f', fg: '#fff', letter: 'T' },
  gulf: { bg: '#ff6600', fg: '#fff', letter: 'G' },
};

const BRANDS_URLS = ['./icons/brands/brands.json', './data/brands.json'];
const BRAND_ICON_BASE = './icons/brands/';

function normalizeBrandKey(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

async function loadBrandLogos() {
  for (const url of BRANDS_URLS) {
    try {
      const res = await fetch(url, { cache: 'force-cache' });
      if (!res.ok) continue;
      const data = await res.json();
      state.brandLogos = data;
      return;
    } catch {
      /* try next */
    }
  }
  state.brandLogos = { byKey: {}, byId: {} };
}

function brandLogoEntry(brand) {
  const logos = state.brandLogos;
  if (!logos?.byKey || !brand) return null;
  const key = normalizeBrandKey(brand);
  if (logos.byKey[key]) return logos.byKey[key];
  // longest partial match (avoid short false positives)
  let best = null;
  let bestLen = 0;
  for (const [k, v] of Object.entries(logos.byKey)) {
    if (k.length < 4) continue;
    if (key.includes(k) || k.includes(key)) {
      if (k.length > bestLen) {
        best = v;
        bestLen = k.length;
      }
    }
  }
  return best;
}

function brandLogoUrl(brand) {
  const entry = brandLogoEntry(brand);
  if (!entry) return null;
  // Banner (≈140×40) reads better in a circle with object-fit:contain than 12×12 icons
  const file = entry.banner || entry.file || entry.icon;
  return file ? `${BRAND_ICON_BASE}${file}` : null;
}

function brandBannerUrl(brand) {
  return brandLogoUrl(brand);
}

function brandMark(brand) {
  const key = String(brand || '').toLowerCase();
  for (const [k, v] of Object.entries(BRAND_FALLBACK)) {
    if (key.includes(k)) return { ...v, title: brand || k };
  }
  const letter = (brand || '?').trim().slice(0, 2) || '?';
  return { bg: '#4b5563', fg: '#fff', letter, title: brand || 'ČS' };
}

function brandPinHtml(station) {
  const m = brandMark(station.brand);
  const logo = brandLogoUrl(station.brand);
  const slot = compareSlotFor(station.id);
  const cmp = slot ? ` compare-${slot}` : '';
  if (logo) {
    return `<div class="brand-pin with-logo${cmp}" style="--pin-bg:#fff" title="${escapeHtml(m.title)}">
      <span class="brand-pin-disk has-logo">
        <img src="${escapeHtml(logo)}" alt="" loading="lazy" decoding="async" />
      </span>
    </div>`;
  }
  return `<div class="brand-pin${cmp}" style="--pin-bg:${m.bg};--pin-fg:${m.fg}" title="${escapeHtml(m.title)}">
    <span class="brand-pin-disk">${escapeHtml(m.letter)}</span>
  </div>`;
}

function brandChipHtml(station) {
  const m = brandMark(station.brand);
  const logo = brandLogoUrl(station.brand);
  if (logo) {
    return `<div class="price-chip brand-chip has-logo" title="${escapeHtml(m.title)}">
      <img src="${escapeHtml(logo)}" alt="${escapeHtml(m.title)}" loading="lazy" decoding="async" />
    </div>`;
  }
  return `<div class="price-chip brand-chip" style="background:${m.bg}">${escapeHtml(m.letter)}</div>`;
}

function compareSlotFor(stationId) {
  if (!stationId) return null;
  if (state.compare.a === stationId) return 'a';
  if (state.compare.b === stationId) return 'b';
  return null;
}

const COMPARE_COLORS = {
  a: '#1f7a4d',
  b: '#e08a1e',
};

function priceMarkerIcon(station, price, { isBest = false } = {}) {
  const level = priceLevel(price.eur, state.meanPrice);
  const slot = compareSlotFor(station.id);
  const cmp = slot ? ` compare-${slot}` : '';
  return L.divIcon({
    className: `price-marker ${level}${isBest ? ' best' : ''}${cmp}`,
    html: markerHtml(price.eur),
    iconSize: [56, slot ? 34 : 28],
    iconAnchor: [28, slot ? 28 : 14],
  });
}

function brandMarkerIcon(station) {
  const slot = compareSlotFor(station.id);
  return L.divIcon({
    className: `brand-marker${slot ? ` compare-${slot}` : ''}`,
    html: brandPinHtml(station),
    iconSize: [36, 42],
    iconAnchor: [18, 40],
  });
}

function clearCompareLayer(which) {
  const layer = state.compareLayers[which];
  if (layer && state.map) state.map.removeLayer(layer);
  state.compareLayers[which] = null;
}

function clearCompareMarker(which) {
  const m = state.compareMarkers[which];
  if (m && state.map) state.map.removeLayer(m);
  state.compareMarkers[which] = null;
}

function originCacheKey(origin) {
  if (!origin) return null;
  return `${origin.lat.toFixed(5)},${origin.lon.toFixed(5)}`;
}

function fitCompareBounds() {
  if (!state.map) return;
  const pts = [];
  const origin = originPos();
  if (origin) pts.push([origin.lat, origin.lon]);
  for (const which of ['a', 'b']) {
    const layer = state.compareLayers[which];
    if (layer?.getBounds) {
      try {
        const b = layer.getBounds();
        if (b.isValid()) {
          pts.push(b.getSouthWest(), b.getNorthEast());
        }
      } catch {
        /* ignore */
      }
    }
    const id = state.compare[which];
    const s = id && state.stations.find((x) => x.id === id);
    if (s?.lat != null) pts.push([s.lat, s.lon]);
  }
  if (pts.length < 2) return;
  try {
    state.map.fitBounds(L.latLngBounds(pts).pad(0.18));
  } catch {
    /* ignore */
  }
}

function syncCompareFloatMarkers(rowsById = null) {
  if (!state.map) return;
  for (const which of ['a', 'b']) {
    clearCompareMarker(which);
    const id = state.compare[which];
    if (!id) continue;
    const station = state.stations.find((s) => s.id === id);
    if (!station?.lat || station.lon == null) continue;

    const row = rowsById?.get(id);
    const price = row?.price ?? freshPrice(station, currentFuel());
    const deal = state.dealById?.get(id) || [];
    const icon =
      price?.eur != null
        ? priceMarkerIcon(station, price, { isBest: deal.includes('best_price') })
        : brandMarkerIcon(station);

    const marker = L.marker([station.lat, station.lon], {
      icon,
      zIndexOffset: 1000,
      keyboard: false,
    }).addTo(state.map);
    marker.on('click', () => selectStation(station.id, { fromMap: true }));
    state.compareMarkers[which] = marker;
  }
}

async function syncCompareRoutes() {
  if (!state.map) return;
  const seq = ++state._compareRouteSeq;
  const origin = originPos();
  const oKey = originCacheKey(origin);

  for (const which of ['a', 'b']) {
    const id = state.compare[which];
    if (!id || !origin) {
      clearCompareLayer(which);
      state.compareRouteCache[which] = null;
      continue;
    }
    const station = state.stations.find((s) => s.id === id);
    if (!station?.lat || station.lon == null) {
      clearCompareLayer(which);
      state.compareRouteCache[which] = null;
      continue;
    }

    const cache = state.compareRouteCache[which];
    let geometry = null;
    if (cache && cache.stationId === id && cache.originKey === oKey && cache.geometry) {
      geometry = cache.geometry;
    } else {
      try {
        const route = await routeDriving(
          origin,
          { lat: station.lat, lon: station.lon },
          { geometry: true },
        );
        if (seq !== state._compareRouteSeq) return;
        geometry = route.geometry;
        state.compareRouteCache[which] = {
          stationId: id,
          originKey: oKey,
          geometry,
          distanceKm: route.distanceKm,
          durationMin: route.durationMin,
        };
      } catch (err) {
        console.warn(`compare route ${which}:`, err.message);
        clearCompareLayer(which);
        state.compareRouteCache[which] = null;
        continue;
      }
    }

    clearCompareLayer(which);
    if (!geometry) continue;
    const color = COMPARE_COLORS[which];
    const layer = L.geoJSON(
      { type: 'Feature', geometry, properties: { slot: which } },
      {
        style: {
          color,
          weight: 5,
          opacity: 0.9,
          lineCap: 'round',
          lineJoin: 'round',
        },
      },
    ).addTo(state.map);
    layer.bringToFront();
    state.compareLayers[which] = layer;
  }

  if (seq === state._compareRouteSeq) fitCompareBounds();
}

function syncCompareOverlays(rows = null) {
  const byId = new Map();
  if (rows) {
    for (const r of rows) byId.set(r.station.id, r);
  }
  syncCompareFloatMarkers(byId.size ? byId : null);
  void syncCompareRoutes();
}

function rebuildMarkers(rows) {
  state.cluster.clearLayers();
  state.markersById.clear();
  const pricedRows = rows.filter((r) => r.price?.eur != null);
  const deals = dealInfo(pricedRows);
  state.meanPrice = deals.mean;
  state.dealById = deals.byId;

  const compareIds = new Set([state.compare.a, state.compare.b].filter(Boolean));

  for (const { station, price } of rows) {
    if (compareIds.has(station.id)) continue;

    let icon;
    if (price?.eur != null) {
      const deal = deals.byId.get(station.id) || [];
      icon = priceMarkerIcon(station, price, { isBest: deal.includes('best_price') });
    } else {
      icon = brandMarkerIcon(station);
    }
    const marker = L.marker([station.lat, station.lon], {
      icon,
      opacity: price?.eur != null ? 1 : 0.92,
    });
    marker.on('click', () => selectStation(station.id, { fromMap: true }));
    state.cluster.addLayer(marker);
    state.markersById.set(station.id, marker);
  }

  syncCompareOverlays(rows);
  if (!state.compare.a && !state.compare.b) fitToCityOrStations(rows);
}

function renderList(rows) {
  const list = document.getElementById('station-list');
  const meta = document.getElementById('list-meta');
  const fuel = currentFuel();
  const priced = rows.filter((r) => r.price?.eur != null);
  const deals = dealInfo(priced);
  state.meanPrice = deals.mean;
  state.dealById = deals.byId;

  if (!rows.length) {
    list.innerHTML = `<li class="empty">${t('listEmpty')}</li>`;
    meta.textContent = originPos() ? t('listTryRadius') : t('listEnableLoc');
    return;
  }

  meta.textContent =
    `${rows.length} ${t('onMap')} · ${priced.length} ${t('withPrice')} · ${fuelLabel(fuel)}` +
    (state.meanPrice != null ? ` · ${t('avg')} ${formatPrice(state.meanPrice)} €` : '');

  list.innerHTML = rows
    .slice(0, 60)
    .map(({ station, price, dist }, i) => {
      const distLabel = dist != null ? `${dist.toFixed(1)} km` : '';
      const hasPrice = price?.eur != null;
      const level = hasPrice ? priceLevel(price.eur, state.meanPrice) : 'na';
      const badges = stationBadges(station, deals.byId.get(station.id) || []);
      const chip = hasPrice
        ? `<div class="price-chip ${level}">${formatPrice(price.eur)}</div>`
        : brandChipHtml(station);
      const sub = hasPrice
        ? `${escapeHtml(station.brand || '')} · ${formatAge(price.updatedAt)}`
        : `${escapeHtml(station.brand || 'ČS')} · ${t('noFreshPrice')}`;
      return `<li data-id="${station.id}" style="--i:${i}" class="${station.id === state.selectedId ? 'active' : ''}${hasPrice ? '' : ' no-price'}">
        ${chip}
        <div>
          <div class="name">${escapeHtml(station.name || station.brand || station.id)}</div>
          <div class="sub">${sub}</div>
          <div class="tags">${badges}</div>
        </div>
        <div class="dist">${distLabel}</div>
      </li>`;
    })
    .join('');

  list.querySelectorAll('li[data-id]').forEach((li) => {
    li.addEventListener('click', () => selectStation(li.dataset.id));
  });
}

function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function selectStation(id, { fromMap = false } = {}) {
  const station = state.stations.find((s) => s.id === id);
  if (!station) return;
  state.selectedId = id;

  document.getElementById('tab-station').disabled = false;
  showPanel('station');

  document.getElementById('station-title').textContent = station.name || station.brand || id;
  const open = isOpenNow(station);
  const openLabel =
    open === true ? ` · ${t('openNow').toLowerCase()}` : open === false ? ` · ${t('closedNow').toLowerCase()}` : '';
  document.getElementById('station-address').textContent =
    `${station.address || ''}${openLabel}${station.hoursSummary ? ` · ${station.hoursSummary}` : ''}`;

  const body = document.getElementById('station-body');
  const deal = state.dealById?.get(id) || [];
  const badges = stationBadges(station, deal);
  const logo = brandLogoUrl(station.brand);
  const logoBlock = logo
    ? `<div class="station-logo"><img src="${escapeHtml(logo)}" alt="${escapeHtml(station.brand || '')}" /></div>`
    : '';
  const entries = Object.entries(station.prices || {})
    .filter(([, p]) => p?.eur != null && daysAgo(p.updatedAt) <= FRESH_PRICE_DAYS)
    .sort((a, b) => a[0].localeCompare(b[0]));
  const pricesBlock = entries.length
    ? `<div class="price-rows">${entries
        .map(([fuel, p]) => {
          const key = fuel === 'natural99_plus' ? 'natural100' : fuel;
          const active = key === currentFuel() ? ' style="border-color: var(--accent)"' : '';
          return `<div class="price-row"${active}>
        <div>
          <div class="fuel">${fuelLabel(key)}</div>
          <span class="age">${formatAge(p.updatedAt)}${p.sourceLabel ? ` · ${escapeHtml(p.sourceLabel)}` : ''}</span>
        </div>
        <div class="eur">${formatPrice(p.eur)} €</div>
      </div>`;
        })
        .join('')}</div>`
    : `<p class="empty">${t('noFreshPricesCard', { days: FRESH_PRICE_DAYS })}</p>`;
  body.innerHTML = `
    ${logoBlock}
    <div class="tags block">${badges}</div>
    ${pricesBlock}`;

  const apple = `https://maps.apple.com/?daddr=${station.lat},${station.lon}&dirflg=d`;
  const google = `https://www.google.com/maps/dir/?api=1&destination=${station.lat},${station.lon}`;
  document.getElementById('btn-route-apple').href = apple;
  document.getElementById('btn-route-google').href = google;

  updateComparePickUi(id);

  const marker = state.markersById.get(id);
  if (marker) {
    state.map.setView([station.lat, station.lon], Math.max(state.map.getZoom(), 14), {
      animate: !fromMap,
    });
  }

  renderList(listStations());
}

function refresh() {
  const rows = mapStations();
  rebuildMarkers(rows);
  renderList(listStations());
  const stamp = document.getElementById('data-stamp');
  stamp.textContent = state.generatedAt
    ? `${getLang() === 'en' ? 'Data updated' : 'Dáta aktualizované'}: ${new Date(state.generatedAt).toLocaleString(localeTag())}`
    : '';
}

function isDesktopLayout() {
  return window.matchMedia('(min-width: 820px)').matches;
}

function sheetSnapHeights() {
  const max = Math.max(180, window.innerHeight - 56);
  const peek = Math.min(128, max * 0.22);
  const mid = Math.min(max * 0.46, 420);
  const full = Math.min(max * 0.82, max - 8);
  return { peek, mid, full };
}

function applySheetHeight(sheet, px, { animate = true } = {}) {
  if (!sheet || isDesktopLayout()) return;
  const { peek, full } = sheetSnapHeights();
  const h = Math.max(peek, Math.min(full, px));
  if (!animate) sheet.classList.add('dragging');
  sheet.style.height = `${Math.round(h)}px`;
  document.documentElement.style.setProperty('--sheet-h', `${Math.round(h)}px`);
  if (!animate) {
    requestAnimationFrame(() => sheet.classList.remove('dragging'));
  }
  clearTimeout(state._sheetMapTimer);
  state._sheetMapTimer = setTimeout(() => state.map?.invalidateSize({ animate: false }), 80);
}

function snapSheet(sheet, preferred) {
  if (!sheet || isDesktopLayout()) return;
  const snaps = sheetSnapHeights();
  const name = preferred || sheet.dataset.sheetSnap || 'mid';
  const h = snaps[name] || snaps.mid;
  sheet.dataset.sheetSnap = name in snaps ? name : 'mid';
  applySheetHeight(sheet, h, { animate: true });
}

function nearestSnap(height) {
  const snaps = sheetSnapHeights();
  const entries = Object.entries(snaps);
  let best = entries[0];
  let bestDist = Math.abs(height - best[1]);
  for (const e of entries) {
    const d = Math.abs(height - e[1]);
    if (d < bestDist) {
      best = e;
      bestDist = d;
    }
  }
  return { name: best[0], height: best[1] };
}

function bindSheetGestures() {
  document.querySelectorAll('.sheet').forEach((sheet) => {
    const grab = sheet.querySelector('[data-sheet-drag]');
    if (!grab) return;

    let startY = 0;
    let startH = 0;
    let dragging = false;

    const onStart = (clientY) => {
      if (isDesktopLayout()) return false;
      dragging = true;
      startY = clientY;
      startH = sheet.getBoundingClientRect().height;
      sheet.classList.add('dragging');
      return true;
    };

    const onMove = (clientY) => {
      if (!dragging) return;
      const dy = startY - clientY; // drag up → taller
      applySheetHeight(sheet, startH + dy, { animate: false });
      sheet.classList.add('dragging');
    };

    const onEnd = () => {
      if (!dragging) return;
      dragging = false;
      sheet.classList.remove('dragging');
      const h = sheet.getBoundingClientRect().height;
      const snap = nearestSnap(h);
      sheet.dataset.sheetSnap = snap.name;
      applySheetHeight(sheet, snap.height, { animate: true });
    };

    grab.addEventListener(
      'touchstart',
      (e) => {
        if (e.touches.length !== 1) return;
        onStart(e.touches[0].clientY);
      },
      { passive: true },
    );
    grab.addEventListener(
      'touchmove',
      (e) => {
        if (!dragging || e.touches.length !== 1) return;
        onMove(e.touches[0].clientY);
        e.preventDefault();
      },
      { passive: false },
    );
    grab.addEventListener('touchend', onEnd);
    grab.addEventListener('touchcancel', onEnd);

    grab.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') return;
      if (!onStart(e.clientY)) return;
      grab.setPointerCapture?.(e.pointerId);
      const move = (ev) => onMove(ev.clientY);
      const up = () => {
        grab.releasePointerCapture?.(e.pointerId);
        grab.removeEventListener('pointermove', move);
        grab.removeEventListener('pointerup', up);
        onEnd();
      };
      grab.addEventListener('pointermove', move);
      grab.addEventListener('pointerup', up);
    });
  });

  window.addEventListener('resize', () => {
    const open = document.querySelector('.sheet.open');
    if (open) snapSheet(open, open.dataset.sheetSnap);
  });
}

function setFiltersDrawer(open) {
  const drawer = document.getElementById('filters-drawer');
  const backdrop = document.getElementById('filters-backdrop');
  const btn = document.getElementById('btn-filters');
  if (!drawer) return;
  drawer.classList.toggle('open', open);
  drawer.setAttribute('aria-hidden', open ? 'false' : 'true');
  if (backdrop) {
    if (open) {
      backdrop.hidden = false;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => backdrop.classList.add('open'));
      });
    } else {
      backdrop.classList.remove('open');
      const hide = () => {
        if (!backdrop.classList.contains('open')) backdrop.hidden = true;
        backdrop.removeEventListener('transitionend', hide);
      };
      backdrop.addEventListener('transitionend', hide);
      setTimeout(hide, 320);
    }
  }
  btn?.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function bindFiltersDrawer() {
  const open = () => setFiltersDrawer(true);
  const close = () => setFiltersDrawer(false);
  document.getElementById('btn-filters')?.addEventListener('click', () => {
    const drawer = document.getElementById('filters-drawer');
    setFiltersDrawer(!drawer?.classList.contains('open'));
  });
  document.getElementById('btn-filters-close')?.addEventListener('click', close);
  document.getElementById('filters-backdrop')?.addEventListener('click', close);
  document.getElementById('filters')?.addEventListener('change', () => {
    // keep drawer open after change so user can tweak multiple filters
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });
}

function showPanel(name) {
  for (const id of ['list', 'station', 'compare', 'settings']) {
    const panel = document.getElementById(`panel-${id}`);
    if (!panel) continue;
    const isOpen = id === name;
    panel.hidden = !isOpen;
    panel.classList.toggle('open', isOpen);
    panel.classList.remove('sheet-enter');
    if (isOpen) {
      snapSheet(panel, panel.dataset.sheetSnap || (id === 'settings' ? 'full' : 'mid'));
      requestAnimationFrame(() => {
        panel.classList.add('sheet-enter');
        clearTimeout(panel._enterTimer);
        panel._enterTimer = setTimeout(() => panel.classList.remove('sheet-enter'), 520);
      });
    }
  }
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.panel === name);
  });
  if (name === 'compare') updateCompareMeta();
  setTimeout(() => state.map?.invalidateSize(), 50);
}

function updateComparePickUi(currentStationId = state.selectedId) {
  const aId = state.compare.a;
  const bId = state.compare.b;
  const aStation = aId && state.stations.find((s) => s.id === aId);
  const bStation = bId && state.stations.find((s) => s.id === bId);
  const short = (s) => {
    if (!s) return t('compareSlotEmpty');
    const name = s.name || s.brand || s.id;
    return name.length > 22 ? `${name.slice(0, 20)}…` : name;
  };

  const btnA = document.getElementById('btn-compare-a');
  const btnB = document.getElementById('btn-compare-b');
  const statusA = document.getElementById('compare-a-status');
  const statusB = document.getElementById('compare-b-status');
  if (!btnA || !btnB) return;

  btnA.classList.toggle('is-active', currentStationId != null && aId === currentStationId);
  btnB.classList.toggle('is-active', currentStationId != null && bId === currentStationId);

  if (statusA) {
    statusA.textContent =
      currentStationId && aId === currentStationId
        ? t('compareSlotThis')
        : aStation
          ? short(aStation)
          : t('compareSlotEmpty');
  }
  if (statusB) {
    statusB.textContent =
      currentStationId && bId === currentStationId
        ? t('compareSlotThis')
        : bStation
          ? short(bStation)
          : t('compareSlotEmpty');
  }
}

function setCompareSlot(which, stationId) {
  const station = state.stations.find((s) => s.id === stationId);
  if (!station) return;
  state.compare[which] = station.id;
  document.getElementById(`slot-${which}-name`).textContent =
    station.name || station.brand || station.id;
  const ready = state.compare.a && state.compare.b && state.compare.a !== state.compare.b;
  document.getElementById('btn-run-compare').disabled = !ready;
  document.getElementById('compare-result').hidden = true;
  updateComparePickUi(stationId);
  showPanel('compare');
  // Rebuild markers so A/B float above clusters + draw driving routes from origin.
  rebuildMarkers(mapStations());
}

async function runCompare() {
  const origin = originPos();
  const resultEl = document.getElementById('compare-result');
  const btn = document.getElementById('btn-run-compare');
  if (!origin) {
    resultEl.hidden = false;
    resultEl.innerHTML = `<p class="empty">${t('noOrigin')}</p>`;
    return;
  }
  const fuel = currentFuel();
  const a = state.stations.find((s) => s.id === state.compare.a);
  const b = state.stations.find((s) => s.id === state.compare.b);
  if (!a || !b) return;

  const priceA = freshPrice(a, fuel);
  const priceB = freshPrice(b, fuel);

  btn.disabled = true;
  btn.textContent = t('calculating');
  resultEl.hidden = false;
  resultEl.innerHTML = `<p class="meta">${t('routing')}</p>`;

  try {
    const [routeA, routeB] = await Promise.all([
      routeDriving(origin, { lat: a.lat, lon: a.lon }),
      routeDriving(origin, { lat: b.lat, lon: b.lon }),
    ]);
    const c = Number(state.settings.consumption) || 7;
    const L = Number(state.settings.tankLiters) || 40;

    const pack = (route, price) => {
      const litersBurned = (route.distanceKm * c) / 100;
      if (!price) {
        return {
          litersBurned,
          driveEur: null,
          fillEur: null,
          totalEur: null,
          hasPrice: false,
        };
      }
      const cost = tripCosts({
        distanceKm: route.distanceKm,
        priceEur: price.eur,
        consumptionL100: c,
        tankLiters: L,
      });
      return { ...cost, hasPrice: true };
    };

    const costA = pack(routeA, priceA);
    const costB = pack(routeB, priceB);
    const bothPriced = costA.hasPrice && costB.hasPrice;

    const closer =
      routeA.distanceKm < routeB.distanceKm - 0.05
        ? 'A'
        : routeB.distanceKm < routeA.distanceKm - 0.05
          ? 'B'
          : 'tie';
    const faster =
      routeA.durationMin < routeB.durationMin - 0.5
        ? 'A'
        : routeB.durationMin < routeA.durationMin - 0.5
          ? 'B'
          : 'tie';
    const cheaper = bothPriced
      ? costA.totalEur < costB.totalEur - 0.01
        ? 'A'
        : costB.totalEur < costA.totalEur - 0.01
          ? 'B'
          : 'tie'
      : null;

    const card = (letter, station, route, price, cost, flags) => {
      const priceRow = price
        ? `<li><span>${t('priceFuel')}</span><strong>${formatPrice(price.eur)} €/l</strong></li>`
        : `<li><span>${t('priceFuel')}</span><strong>${t('noPriceDays', { days: FRESH_PRICE_DAYS })}</strong></li>`;
      const driveRow = cost.hasPrice
        ? `<li><span>${t('burnOnWay')}</span><strong>${cost.litersBurned.toFixed(2)} l ≈ ${cost.driveEur.toFixed(2)} €</strong></li>`
        : `<li><span>${t('burnOnWay')}</span><strong>${cost.litersBurned.toFixed(2)} l</strong></li>`;
      const moneyRows = cost.hasPrice
        ? `<li><span>${t('fill', { L })}</span><strong>${cost.fillEur.toFixed(2)} €</strong></li>
           <li class="total"><span>${t('totalTrip')}</span><strong>${cost.totalEur.toFixed(2)} €</strong></li>`
        : `<li class="total"><span>${t('tripSummary')}</span><strong>${route.distanceKm.toFixed(1)} km · ${Math.round(route.durationMin)} ${t('min')}</strong></li>`;

      return `
      <div class="compare-card${flags.winCost || flags.winDist ? ' win' : ''}">
        <div class="compare-card-head">
          <span class="slot-label">${letter}</span>
          <strong>${escapeHtml(station.name || station.brand || letter)}</strong>
          ${flags.winCost ? `<span class="tag deal">${t('cheaperOverall')}</span>` : ''}
          ${flags.winDist && !flags.winCost ? `<span class="tag deal">${t('closer')}</span>` : ''}
          ${flags.winTime ? `<span class="tag good">${t('faster')}</span>` : ''}
        </div>
        <ul class="compare-stats">
          ${priceRow}
          <li><span>${t('path')}</span><strong>${route.distanceKm.toFixed(1)} km</strong></li>
          <li><span>${t('time')}</span><strong>${Math.round(route.durationMin)} ${t('min')}</strong></li>
          ${driveRow}
          ${moneyRows}
        </ul>
      </div>`;
    };

    let verdict;
    if (bothPriced) {
      const delta = Math.abs(costA.totalEur - costB.totalEur);
      verdict =
        cheaper === 'tie'
          ? t('verdictTieMoney')
          : t('verdictCheaper', { who: cheaper, eur: delta.toFixed(2), L });
    } else if (!priceA && !priceB) {
      verdict =
        closer === 'tie'
          ? t('verdictNoPriceTie')
          : t('verdictNoPriceCloser', {
              who: closer,
              km: Math.abs(routeA.distanceKm - routeB.distanceKm).toFixed(1),
            });
    } else {
      verdict =
        closer === 'tie'
          ? t('verdictOnePriceTie')
          : t('verdictOnePriceCloser', { who: closer });
    }

    resultEl.innerHTML = `
      <p class="compare-verdict">${verdict}</p>
      <div class="compare-grid">
        ${card('A', a, routeA, priceA, costA, {
          winCost: cheaper === 'A',
          winDist: closer === 'A',
          winTime: faster === 'A',
        })}
        ${card('B', b, routeB, priceB, costB, {
          winCost: cheaper === 'B',
          winDist: closer === 'B',
          winTime: faster === 'B',
        })}
      </div>`;
  } catch (err) {
    resultEl.innerHTML = `<p class="empty">${t('routeError', { msg: escapeHtml(err.message) })}</p>`;
  } finally {
    btn.disabled = !(state.compare.a && state.compare.b);
    btn.textContent = t('runCompare');
  }
}

function bindHomeAutocomplete() {
  const input = document.getElementById('settings-home');
  const list = document.getElementById('home-suggest');
  if (!input || !list) return;

  const run = debounce(async () => {
    const q = input.value.trim();
    if (q.length < 3) {
      list.hidden = true;
      list.innerHTML = '';
      return;
    }
    const city = cityById(state.settings.cityId);
    try {
      const hits = await suggestAddresses(q, {
        lat: city?.lat ?? state.settings.homeLat,
        lon: city?.lon ?? state.settings.homeLon,
        lang: getLang(),
      });
      if (!hits.length) {
        list.hidden = true;
        return;
      }
      list.innerHTML = hits
        .map(
          (h, i) =>
            `<li data-i="${i}" data-lat="${h.lat}" data-lon="${h.lon}">${escapeHtml(h.label)}</li>`,
        )
        .join('');
      list.hidden = false;
      list.querySelectorAll('li').forEach((li) => {
        li.addEventListener('mousedown', (e) => {
          e.preventDefault();
          input.value = li.textContent;
          state._pendingHome = {
            homeLabel: li.textContent,
            homeLat: Number(li.dataset.lat),
            homeLon: Number(li.dataset.lon),
          };
          list.hidden = true;
        });
      });
    } catch {
      list.hidden = true;
    }
  }, 300);

  input.addEventListener('input', () => {
    state._pendingHome = null;
    run();
  });
  input.addEventListener('blur', () =>
    setTimeout(() => {
      list.hidden = true;
    }, 150),
  );
}

function fillCitySelect() {
  const el = document.getElementById('settings-city');
  if (!el) return;
  el.innerHTML = SK_CITIES.map((c) => `<option value="${c.id}">${c.name}</option>`).join('');
  el.value = state.settings.cityId || 'kosice';
}

function bindUi() {
  document.getElementById('filters').addEventListener('change', () => {
    if (document.getElementById('filter-fuel').value) {
      saveSettings({ fuel: document.getElementById('filter-fuel').value });
    }
    const r = Number(document.getElementById('filter-radius').value);
    if (r > 0) saveSettings({ radiusKm: r });
    refresh();
  });
  document.getElementById('filter-open')?.addEventListener('change', refresh);

  bindFiltersDrawer();
  bindSheetGestures();

  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      if (tab.disabled) return;
      showPanel(tab.dataset.panel);
    });
  });

  document.getElementById('btn-back-list').addEventListener('click', () => showPanel('list'));
  document.getElementById('btn-settings').addEventListener('click', () => showPanel('settings'));
  document.getElementById('btn-locate').addEventListener('click', () => locateUser(true));

  document.getElementById('btn-compare-a')?.addEventListener('click', () => {
    if (state.selectedId) setCompareSlot('a', state.selectedId);
  });
  document.getElementById('btn-compare-b')?.addEventListener('click', () => {
    if (state.selectedId) setCompareSlot('b', state.selectedId);
  });
  document.getElementById('btn-run-compare')?.addEventListener('click', () => runCompare());

  fillLangSelect();
  fillCitySelect();
  bindHomeAutocomplete();

  // Live city preview: outline + filter as soon as city changes
  document.getElementById('settings-city')?.addEventListener('change', async (e) => {
    const cityId = e.target.value;
    const city = cityById(cityId);
    state.settings.cityId = cityId;
    localStorage.setItem('fuelsk.settings', JSON.stringify(state.settings));
    // City outline already scopes results — don't apply Košice GPS radius to Žilina.
    const radiusEl = document.getElementById('filter-radius');
    if (radiusEl) radiusEl.value = '0';
    if (city && state.map) state.map.setView([city.lat, city.lon], 12);
    await loadCityBoundary(cityId);
    refresh();
  });

  document.getElementById('settings-lang')?.addEventListener('change', (e) => {
    saveSettings({ lang: e.target.value });
    refresh();
  });

  const form = document.getElementById('settings-form');
  form.fuel.value = state.settings.fuel;
  form.consumption.value = state.settings.consumption;
  form.tankLiters.value = state.settings.tankLiters;
  form.radiusKm.value = state.settings.radiusKm;
  form.maxDetourKm.value = state.settings.maxDetourKm;
  form.theme.value = state.settings.theme;
  form.cityId.value = state.settings.cityId || 'kosice';
  form.homeLabel.value = state.settings.homeLabel || '';
  if (form.lang) form.lang.value = state.settings.lang || 'sk';

  // initial sheet height
  const list = document.getElementById('panel-list');
  if (list?.classList.contains('open')) snapSheet(list, 'mid');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const cityId = String(fd.get('cityId') || 'kosice');
    const homeLabel = String(fd.get('homeLabel') || '').trim();
    const pending = state._pendingHome;
    const next = {
      lang: String(fd.get('lang') || 'sk'),
      fuel: String(fd.get('fuel')),
      consumption: Number(fd.get('consumption')),
      tankLiters: Number(fd.get('tankLiters')),
      radiusKm: Number(fd.get('radiusKm')),
      maxDetourKm: Number(fd.get('maxDetourKm')),
      theme: String(fd.get('theme')),
      cityId,
    };
    if (pending && pending.homeLabel === homeLabel) {
      next.homeLabel = pending.homeLabel;
      next.homeLat = pending.homeLat;
      next.homeLon = pending.homeLon;
    } else if (!homeLabel) {
      next.homeLabel = '';
      next.homeLat = null;
      next.homeLon = null;
    } else if (homeLabel === state.settings.homeLabel) {
      // keep existing coords
    } else {
      next.homeLabel = homeLabel;
      next.homeLat = null;
      next.homeLon = null;
    }
    const cityChanged = cityId !== state.settings.cityId;
    saveSettings(next);
    state._pendingHome = null;
    document.getElementById('filter-fuel').value = state.settings.fuel;
    document.getElementById('filter-radius').value = String(state.settings.radiusKm);
    const city = cityById(cityId);
    if (city && state.map) state.map.setView([city.lat, city.lon], 12);
    if (cityChanged) await loadCityBoundary(cityId);
    refresh();
    showPanel('list');
  });

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
}

function locateUser(fly = false) {
  const btn = document.getElementById('btn-locate');
  if (!navigator.geolocation) {
    if (originPos()) {
      document.getElementById('filter-radius').value = String(state.settings.radiusKm || 10);
    } else {
      document.getElementById('filter-radius').value = '0';
    }
    refresh();
    return;
  }
  btn?.classList.add('is-locating');
  const clearLocating = () => btn?.classList.remove('is-locating');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      clearLocating();
      state.userPos = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      if (!state.userMarker) {
        state.userMarker = L.circleMarker([state.userPos.lat, state.userPos.lon], {
          radius: 7,
          color: '#fff',
          weight: 2,
          fillColor: '#2563eb',
          fillOpacity: 1,
        }).addTo(state.map);
      } else {
        state.userMarker.setLatLng([state.userPos.lat, state.userPos.lon]);
      }
      if (fly) state.map.setView([state.userPos.lat, state.userPos.lon], 12);
      document.getElementById('filter-radius').value = String(state.settings.radiusKm || 10);
      refresh();
    },
    () => {
      clearLocating();
      if (originPos()) {
        document.getElementById('list-meta').textContent = t('gpsFallbackHome');
        document.getElementById('filter-radius').value = String(state.settings.radiusKm || 10);
      } else {
        document.getElementById('list-meta').textContent = t('gpsFallbackAll');
        document.getElementById('filter-radius').value = '0';
      }
      refresh();
    },
    { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 },
  );
}

async function main() {
  setLang(state.settings.lang || 'sk');
  applyTheme();
  applyStaticI18n();
  bindUi();
  initMap();
  updateHomeMarker();
  updateCompareMeta();

  await loadBrandLogos();

  try {
    await loadStations();
  } catch (err) {
    document.getElementById('list-meta').textContent = t('dataError', { msg: err.message });
    return;
  }

  fillFuelSelects();
  fillBrandSelect();
  document.getElementById('filter-fuel').value = state.settings.fuel;

  const city = cityById(state.settings.cityId);
  if (city) state.map.setView([city.lat, city.lon], 12);

  await loadCityBoundary(state.settings.cityId);

  if (originPos()) {
    document.getElementById('filter-radius').value = String(state.settings.radiusKm || 10);
  } else {
    document.getElementById('filter-radius').value = '0';
  }
  refresh();
  locateUser(false);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

main();
