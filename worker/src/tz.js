/* Time-zone helpers built on Intl (no libraries). */

const formatters = new Map();
function fmt(tz) {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    formatters.set(tz, f);
  }
  return f;
}

export function isValidTimeZone(tz) {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return false;
  try { fmt(tz).format(0); return true; } catch (e) { return false; }
}

/* wall-clock parts of instant `ms` in `tz` */
export function zonedParts(ms, tz) {
  const p = {};
  for (const { type, value } of fmt(tz).formatToParts(new Date(ms))) p[type] = value;
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute, s: +p.second };
}

function offsetMs(ms, tz) {
  const p = zonedParts(ms, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000;
}

/* UTC instant for local date y-m-d at `minutes` after local midnight in `tz`.
   minutes may be negative or >= 1440 (rolls into neighbouring days). */
export function zonedToUtc(y, m, d, minutes, tz) {
  const wall = Date.UTC(y, m - 1, d, 0, minutes);
  let utc = wall - offsetMs(wall, tz);
  const second = offsetMs(utc, tz);            // correct once near DST transitions
  if (wall - second !== utc) utc = wall - second;
  return utc;
}
