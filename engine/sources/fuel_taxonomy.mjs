/**
 * Unified fuel taxonomy for Slovakia.
 *
 * User-facing groups (primary):
 *   natural95       — звичайний 95 (E5 / basic)
 *   natural95_plus  — 95 з присадками / «преміум 95»
 *   natural98       — 98
 *   natural100      — ~100 октан (99+/100 Racing тощо)
 *   diesel          — звичайний дизель
 *   diesel_plus     — дизель з присадками
 *
 * Secondary (kept, not primary UI): lpg, cng, adblue
 *
 * Brand marketing names → unified key (case-insensitive substring / regex).
 * Sources: benzin.sk select codes, Slovnaft Efecta/Vermila, OMV MaxxMotion,
 * Shell FuelSave/V-Power, MOL EVO/Dynamic, Orlen EFFECT (public product pages).
 */

export const FUEL_META = {
  natural95: {
    id: 'natural95',
    labelUk: '95 звичайний',
    labelSk: 'Natural 95',
    group: 'petrol',
    primary: true,
  },
  natural95_plus: {
    id: 'natural95_plus',
    labelUk: '95 з присадками',
    labelSk: 'Natural 95+',
    group: 'petrol',
    primary: true,
  },
  natural98: {
    id: 'natural98',
    labelUk: '98',
    labelSk: 'Natural 98',
    group: 'petrol',
    primary: true,
  },
  natural100: {
    id: 'natural100',
    labelUk: '100 / 99+',
    labelSk: 'Natural 99+/100',
    group: 'petrol',
    primary: true,
  },
  diesel: {
    id: 'diesel',
    labelUk: 'Дизель',
    labelSk: 'Diesel',
    group: 'diesel',
    primary: true,
  },
  diesel_plus: {
    id: 'diesel_plus',
    labelUk: 'Дизель з присадками',
    labelSk: 'Diesel+',
    group: 'diesel',
    primary: true,
  },
  lpg: { id: 'lpg', labelUk: 'LPG', labelSk: 'LPG', group: 'gas', primary: false },
  cng: { id: 'cng', labelUk: 'CNG', labelSk: 'CNG', group: 'gas', primary: false },
  adblue: { id: 'adblue', labelUk: 'AdBlue', labelSk: 'AdBlue', group: 'other', primary: false },
};

/** benzin.sk price_search_fuel / fuel_id → unified key */
export const BENZIN_FUEL_CODES = {
  2: 'natural95', // Natural95
  32: 'natural95', // Normal95 (UNI)
  4096: 'natural95_plus', // Natural95+
  4: 'natural98',
  128: 'natural100', // Natural99+ (aditiv. 99/100)
  8: 'diesel',
  256: 'diesel_plus',
  16: 'lpg',
  16384: 'cng',
  8192: 'adblue',
};

/**
 * Legacy internal keys (stage 1) → unified.
 * natural99_plus was the old name for ~100 octane.
 */
export const LEGACY_KEY_ALIASES = {
  natural99_plus: 'natural100',
};

/**
 * Free-text / brand product name → unified key.
 * Order matters: more specific (plus/premium) before base.
 */
export const NAME_RULES = [
  // Diesel premium first
  { key: 'diesel_plus', re: /diesel\+|diesel\s*\+|maxxmotion\s*diesel|v-?power\s*diesel|dynamic\s*diesel|efecta?\s*diesel\s*\+|vermila\s*diesel|evo\s*diesel\s*\+|nitro\+?\s*diesel|aditiv.*diesel|premium\s*diesel/i },
  { key: 'diesel', re: /\bdiesel\b|\bnafta\b|efecta?\s*diesel|fuel\s*save\s*diesel|evo\s*diesel/i },

  // Petrol 100 / 99+
  { key: 'natural100', re: /natural\s*99|99\+|100\s*(oct|okt|racing)?|v-?power\s*racing|vermila|racing\s*100|maxxmotion\s*100|super\s*100/i },

  // 98
  { key: 'natural98', re: /natural\s*98|\b98\b|v-?power(?!\s*diesel)/i },

  // 95 premium / additives
  { key: 'natural95_plus', re: /natural\s*95\+|95\s*\+|95\s*natural\+|maxxmotion\s*95|efecta?\s*95\+|nitro\+?\s*95|aditiv.*95|premium\s*95|plus\s*95/i },

  // 95 base
  { key: 'natural95', re: /natural\s*95|normal\s*95|\b95\b|efecta?\s*95|fuel\s*save\s*95|evo\s*95|benzin\s*95/i },

  { key: 'adblue', re: /adblue|ad-?blue/i },
  { key: 'lpg', re: /\blpg\b|autogas/i },
  { key: 'cng', re: /\bcng\b/i },
];

/** Known brand product cards (documentation + matching hints). */
export const BRAND_PRODUCTS = {
  Slovnaft: [
    { name: 'Efecta 95', key: 'natural95' },
    { name: 'Efecta Diesel', key: 'diesel' },
    { name: 'Vermila / Racing 100', key: 'natural100' },
    { name: 'LPG', key: 'lpg' },
  ],
  OMV: [
    { name: 'OMV 95', key: 'natural95' },
    { name: 'MaxxMotion 95', key: 'natural95_plus' },
    { name: 'OMV Diesel', key: 'diesel' },
    { name: 'MaxxMotion Diesel', key: 'diesel_plus' },
    { name: 'MaxxMotion 100', key: 'natural100' },
    { name: 'AdBlue', key: 'adblue' },
  ],
  Shell: [
    { name: 'FuelSave 95', key: 'natural95' },
    { name: 'V-Power', key: 'natural95_plus' },
    { name: 'V-Power Racing', key: 'natural100' },
    { name: 'FuelSave Diesel', key: 'diesel' },
    { name: 'V-Power Diesel', key: 'diesel_plus' },
  ],
  MOL: [
    { name: 'EVO 95', key: 'natural95' },
    { name: 'Dynamic 95+', key: 'natural95_plus' },
    { name: 'EVO Diesel', key: 'diesel' },
    { name: 'Dynamic Diesel', key: 'diesel_plus' },
  ],
  Orlen: [
    { name: 'EFFECT 95', key: 'natural95' },
    { name: 'EFFECT Diesel', key: 'diesel' },
    { name: 'VORTEX / premium', key: 'natural95_plus' },
  ],
};

export function unifyFuelKey(raw) {
  if (raw == null) return null;
  if (typeof raw === 'number') return BENZIN_FUEL_CODES[raw] || null;
  const s = String(raw).trim();
  if (!s) return null;
  if (FUEL_META[s]) return s;
  if (LEGACY_KEY_ALIASES[s]) return LEGACY_KEY_ALIASES[s];
  // numeric string code
  if (/^\d+$/.test(s)) return BENZIN_FUEL_CODES[Number(s)] || null;
  for (const rule of NAME_RULES) {
    if (rule.re.test(s)) return rule.key;
  }
  return null;
}

export function fuelLabel(key, lang = 'uk') {
  const meta = FUEL_META[key];
  if (!meta) return key;
  return lang === 'sk' ? meta.labelSk : meta.labelUk;
}

export function primaryFuelKeys() {
  return Object.values(FUEL_META).filter((m) => m.primary).map((m) => m.id);
}

/** Normalize a prices object to unified keys (merge legacy). */
export function normalizePricesObject(prices) {
  const out = {};
  for (const [k, v] of Object.entries(prices || {})) {
    const key = unifyFuelKey(k) || k;
    if (!v || v.eur == null) continue;
    // Prefer more specific / keep fresher
    const prev = out[key];
    if (!prev || (v.updatedAt && (!prev.updatedAt || v.updatedAt >= prev.updatedAt))) {
      out[key] = {
        ...v,
        sourceLabel: v.sourceLabel || k,
        unified: key,
      };
    }
  }
  return out;
}
