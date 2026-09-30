import iconv from 'iconv-lite';

/** Percent-encode a string as windows-1250 bytes (not UTF-8). */
export function encodeWin1250Component(str) {
  const bytes = iconv.encode(String(str), 'win1250');
  let out = '';
  for (const b of bytes) {
    if (
      (b >= 0x30 && b <= 0x39) ||
      (b >= 0x41 && b <= 0x5a) ||
      (b >= 0x61 && b <= 0x7a) ||
      b === 0x2d ||
      b === 0x2e ||
      b === 0x5f ||
      b === 0x7e
    ) {
      out += String.fromCharCode(b);
    } else if (b === 0x20) {
      out += '+';
    } else {
      out += `%${b.toString(16).toUpperCase().padStart(2, '0')}`;
    }
  }
  return out;
}

/** Build a query string with windows-1250 values. */
export function encodeWin1250Query(params) {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeWin1250Component(v)}`)
    .join('&');
}

/** Decode a windows-1250 ArrayBuffer / Buffer / Uint8Array to a JS string. */
export function decodeWin1250(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  // Prefer Node TextDecoder when available; fall back to iconv-lite.
  try {
    return new TextDecoder('windows-1250').decode(bytes);
  } catch {
    return iconv.decode(Buffer.from(bytes), 'win1250');
  }
}
