const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function splitTime(v) {
  const m = String(v).match(/^(\d{4}-\d\d-\d\d)(?:[ T](\d\d:\d\d(?::\d\d)?))?/);
  return m ? { date: m[1], clock: m[2] ?? "" } : null;
}

// Postgres prints "2026-01-02 03:04:05.123456+00"; Date.parse wants a T, milliseconds and +00:00.
// Only an offset after a clock is one: the "-02" of a bare date "2026-01-02" is its day.
const parsedTimeMs = (v) => Date.parse(String(v).replace(" ", "T").replace(/(\.\d{3})\d+/, "$1").replace(/(:\d\d(?:\.\d+)?[+-]\d\d)$/, "$1:00"));

function digits(s, from, to) {
  let n = 0;
  for (let i = from; i < to; i++) {
    const d = s.charCodeAt(i) - 48;
    if (!(d >= 0 && d <= 9)) return NaN;
    n = n * 10 + d;
  }
  return n;
}

// The same answer as parsedTimeMs, read by position: Herdr's script engine runs regexes so slowly
// that a time chart over every row would outlast the half second a mod may run at once. A clock
// without an offset is local time, as Date.parse reads it. Anything unusual takes the slow road.
export function timeMs(v) {
  const s = String(v);
  const year = s.charCodeAt(4) === 45 && s.charCodeAt(7) === 45 ? digits(s, 0, 4) : NaN;
  if (!(year >= 100)) return parsedTimeMs(s);
  const month = digits(s, 5, 7) - 1;
  const day = digits(s, 8, 10);
  if (s.length === 10) return Date.UTC(year, month, day);
  const t = s.charCodeAt(10);
  if ((t !== 32 && t !== 84) || s.charCodeAt(13) !== 58 || s.charCodeAt(16) !== 58) return parsedTimeMs(s);
  const hour = digits(s, 11, 13);
  const minute = digits(s, 14, 16);
  const second = digits(s, 17, 19);
  let i = 19;
  let ms = 0;
  if (s.charCodeAt(i) === 46) {
    let end = i + 1;
    while (end < s.length && s.charCodeAt(end) >= 48 && s.charCodeAt(end) <= 57) end++;
    if (end === i + 1) return parsedTimeMs(s);
    ms = digits(`${s.slice(i + 1, Math.min(end, i + 4))}00`, 0, 3);
    i = end;
  }
  if (i === s.length) {
    const local = new Date(year, month, day, hour, minute, second, ms).getTime();
    return Number.isFinite(local) ? local : parsedTimeMs(s);
  }
  const sign = s.charCodeAt(i) === 43 ? 1 : s.charCodeAt(i) === 45 ? -1 : 0;
  const rest = s.length - i;
  if (!sign || (rest !== 3 && !(rest === 6 && s.charCodeAt(i + 3) === 58))) return parsedTimeMs(s);
  const offset = digits(s, i + 1, i + 3) * 60 + (rest === 6 ? digits(s, i + 4, i + 6) : 0);
  const utc = Date.UTC(year, month, day, hour, minute, second, ms) - sign * offset * 60000;
  return Number.isFinite(utc) ? utc : parsedTimeMs(s);
}

export function naturalTime(v, now = new Date()) {
  const p = splitTime(v);
  if (!p) return String(v);
  const [y, m, d] = p.date.split("-");
  const thisYear = String(now.getFullYear()) === y;
  const day = `${MONTHS[Number(m) - 1]} ${Number(d)}${thisYear ? "" : `, ${y}`}`;
  return p.clock ? `${day} · ${p.clock.slice(0, 5)}` : day;
}
