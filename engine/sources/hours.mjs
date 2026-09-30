/**
 * Opening hours parse + open-now check (Europe/Bratislava).
 */

const DAY_MAP = {
  pondelok: 1,
  utorok: 2,
  streda: 3,
  štrvrtok: 4,
  stvrtok: 4,
  piatok: 5,
  sobota: 6,
  nedeľa: 0,
  nedela: 0,
};

/** Parse benzin.sk openhours_box → [{day:0-6, open:"HH:MM", close:"HH:MM"}] */
export function parseOpeningHours(html) {
  const box = html.match(/id=["']openhours_box["'][^>]*>([\s\S]*?)<\/div>/i);
  if (!box) return null;
  const rows = [];
  const re =
    /<td[^>]*id=["']oht["'][^>]*>([^<]+)<\/td>\s*<td[^>]*id=["']ohd["'][^>]*>([^<]+)<\/td>\s*<td[^>]*>\s*-\s*<\/td>\s*<td[^>]*id=["']ohd["'][^>]*>([^<]+)<\/td>/gi;
  let m;
  while ((m = re.exec(box[1]))) {
    const dayName = m[1].trim().toLowerCase().normalize('NFC');
    const day = DAY_MAP[dayName];
    if (day == null) continue;
    rows.push({
      day,
      open: normalizeTime(m[2]),
      close: normalizeTime(m[3]),
    });
  }
  return rows.length ? rows : null;
}

function normalizeTime(t) {
  const s = String(t).trim();
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return s;
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

function minutesOf(hhmm) {
  const m = String(hhmm).match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  // 24:00 → end of day
  if (h === 24 && min === 0) return 24 * 60;
  return h * 60 + min;
}

/**
 * @param {Array<{day:number, open:string, close:string}>|null} hours
 * @param {Date} [now]
 * @param {string} [timeZone]
 */
export function isOpenAt(hours, now = new Date(), timeZone = 'Europe/Bratislava') {
  if (!hours || !hours.length) return { open: null, reason: 'unknown' };

  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const day = weekdayMap[parts.weekday];
  const nowMin = Number(parts.hour) * 60 + Number(parts.minute);

  const today = hours.filter((h) => h.day === day);
  if (!today.length) return { open: false, reason: 'closed_today' };

  for (const slot of today) {
    const a = minutesOf(slot.open);
    const b = minutesOf(slot.close);
    if (a == null || b == null) continue;
    // 00:00–24:00 = always open that day
    if (a === 0 && b >= 24 * 60) return { open: true, reason: '24h' };
    if (b > a) {
      if (nowMin >= a && nowMin < b) return { open: true, reason: 'open' };
    } else {
      // overnight window
      if (nowMin >= a || nowMin < b) return { open: true, reason: 'open_overnight' };
    }
  }
  return { open: false, reason: 'outside_hours' };
}

export function formatHoursSummary(hours) {
  if (!hours?.length) return null;
  const all24 = hours.every((h) => h.open === '00:00' && (h.close === '24:00' || h.close === '00:00'));
  if (all24 && hours.length >= 7) return '24/7';
  return null;
}
