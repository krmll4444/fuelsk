import fs from 'node:fs';
import { PNG } from 'pngjs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const TEMPLATES_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'price_templates.json',
);

const templates = JSON.parse(fs.readFileSync(TEMPLATES_PATH, 'utf8'));

function loadPng(buf) {
  const png = PNG.sync.read(Buffer.isBuffer(buf) ? buf : Buffer.from(buf));
  const bin = Array.from({ length: png.height }, (_, y) =>
    Array.from({ length: png.width }, (_, x) => {
      const i = (png.width * y + x) << 2;
      return png.data[i] < 90 && png.data[i + 1] < 90 ? 1 : 0;
    }),
  );
  return { w: png.width, h: png.height, bin };
}

function inkRatio(img, x0, x1, y0, y1) {
  let d = 0;
  let t = 0;
  x0 = Math.max(0, Math.floor(x0));
  x1 = Math.min(img.w, Math.ceil(x1));
  y0 = Math.max(0, Math.floor(y0));
  y1 = Math.min(img.h, Math.ceil(y1));
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      t++;
      d += img.bin[y][x];
    }
  }
  return t ? d / t : 0;
}

function contentBounds(img, x0, x1, y0, y1) {
  let minX = x1;
  let maxX = x0;
  let minY = y1;
  let maxY = y0;
  let found = false;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (img.bin[y][x]) {
        found = true;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (!found) return null;
  return { x0: minX, x1: maxX + 1, y0: minY, y1: maxY + 1 };
}

function downsample(img, b, gw = 6, gh = 10) {
  let sig = '';
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      const sx0 = b.x0 + (gx * (b.x1 - b.x0)) / gw;
      const sx1 = b.x0 + ((gx + 1) * (b.x1 - b.x0)) / gw;
      const sy0 = b.y0 + (gy * (b.y1 - b.y0)) / gh;
      const sy1 = b.y0 + ((gy + 1) * (b.y1 - b.y0)) / gh;
      sig += inkRatio(img, sx0, sx1, sy0, sy1) > 0.3 ? '1' : '0';
    }
  }
  return sig;
}

function digitCells(img) {
  const cw = img.w / 4;
  const out = [];
  for (let i = 0; i < 4; i++) {
    const x0 = Math.round(i * cw) + 1;
    const x1 = Math.round((i + 1) * cw) - 1;
    const y0 = 1;
    let y1 = img.h - 1;
    if (i === 3) y1 = Math.round(img.h * 0.72);
    if (i === 0) {
      out.push(contentBounds(img, x0, x1, y0, Math.round(img.h * 0.78)));
    } else {
      out.push(contentBounds(img, x0, x1, y0, y1));
    }
  }
  return out;
}

function hamming(a, b) {
  const n = Math.min(a.length, b.length);
  let d = Math.abs(a.length - b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) d++;
  return d;
}

function matchDigit(sig) {
  let best = null;
  let bestD = Infinity;
  for (const [digit, list] of Object.entries(templates)) {
    for (const t of list) {
      const dist = hamming(sig, t);
      if (dist < bestD) {
        bestD = dist;
        best = digit;
      }
    }
  }
  // Reject weak matches (noise / unknown digit like 3).
  if (bestD > 12) return null;
  return best;
}

/**
 * OCR a benzin.sk priceimage.php PNG (82×28 yellow board, X.XXˣ).
 * @returns {number|null} price in EUR, e.g. 1.886
 */
export function ocrPricePng(buf) {
  if (!buf || buf.length < 100) return null;
  let img;
  try {
    img = loadPng(buf);
  } catch {
    return null;
  }
  // Large board is ~82×28; list thumbnail ~39×14 also has 4 panels.
  if (img.w < 30 || img.h < 10) return null;

  const cells = digitCells(img);
  let digits = '';
  for (const cell of cells) {
    if (!cell) return null;
    const d = matchDigit(downsample(img, cell));
    if (d == null) return null;
    digits += d;
  }
  const eur = Number(`${digits[0]}.${digits.slice(1)}`);
  if (!Number.isFinite(eur) || eur <= 0 || eur > 9) return null;
  return Math.round(eur * 1000) / 1000;
}
