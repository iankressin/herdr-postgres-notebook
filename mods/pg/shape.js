// What a query result holds and how to chart it, with no app imports, so `node --test` can run them.
// Every decision comes from what a column holds (its type or its values), never from what one
// dataset happens to call its columns.
import { quoteIdent } from "./logic.js";

export const CELL_CHARS = 600;
// How many rows the guesses about a column look at. Counts still cover every row.
export const SAMPLE = 2000;

const NUM = /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/;
const TIME = /^\d{4}-\d\d-\d\d([ T]\d\d:\d\d(:\d\d(\.\d+)?)?([+-]\d\d(:?\d\d)?|Z)?)?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID_VALUE = /^(0x)?[0-9a-f]{12,}$|^[0-9a-f]{8}-[0-9a-f]{4}-|^\d{7,}$|^[a-z]+[:_-]\d+$/i;
const SEMANTIC = /^(success|succeeded|ok|done|complete|completed|pass|passed|active|healthy|enabled|yes|fail|failed|failure|error|errored|crashed|dead|rejected|invalid|fatal|running|started|pending|queued|in_progress|building|working|open|closed|warn|warning|skipped|cancelled|canceled|partial|stale|draft|archived|paused)$/i;
const URL_VALUE = /^https?:\/\/\S+$/i;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const HOLDS = { number: "numbers", time: "dates", bool: "yes or no", json: "JSON" };

// Math.min(...xs) overflows the stack on a few hundred thousand values.
const lowest = (xs) => xs.reduce((a, b) => (b < a ? b : a), Infinity);
const highest = (xs) => xs.reduce((a, b) => (b > a ? b : a), -Infinity);

export function kindOfType(type = "") {
  const t = type.toLowerCase();
  if (t.endsWith("[]")) return "array";
  if (/^(smallint|integer|bigint|real|double precision|numeric|decimal|money)/.test(t)) return "number";
  if (t === "boolean") return "bool";
  if (/^(timestamp|date\b|time\b)/.test(t)) return "time";
  if (/^jsonb?$/.test(t)) return "json";
  if (t === "uuid" || t === "oid") return "uuid";
  if (t === "bytea") return "binary";
  return "text";
}

export function kindOfValues(values) {
  const seen = values.filter((v) => v !== null && v !== "").slice(0, 40);
  if (seen.length === 0) return "text";
  if (seen.every((v) => NUM.test(v))) return "number";
  if (seen.every((v) => v === "t" || v === "f")) return "bool";
  if (seen.every((v) => TIME.test(v))) return "time";
  if (seen.every((v) => /^[[{]/.test(v) && /[\]}]$|…$/.test(v) && v.includes('"'))) return "json";
  if (seen.every((v) => UUID.test(v))) return "uuid";
  if (seen.every((v) => /^\\x[0-9a-f]*$/i.test(v))) return "binary";
  return "text";
}

// The kind of each column: from the catalog type when known, else from the values.
export function kindsFor(header, rows, columns = []) {
  const byName = new Map(columns.map((c) => [c.name, c]));
  const sample = rows.length > SAMPLE ? rows.slice(0, SAMPLE) : rows;
  return header.map((name, i) => {
    const column = byName.get(name);
    return column ? kindOfType(column.type) : kindOfValues(sample.map((r) => r[i]));
  });
}

export const isUrl = (v) => typeof v === "string" && URL_VALUE.test(v);

export function looksLikeCode(v) {
  const s = String(v).trim();
  return /^(select|insert|update|delete|with|create|alter|drop|begin|commit|explain|set|show|copy|grant|vacuum|analyze)\b/i.test(s)
    || (s.length > 60 && (s.match(/[{}();=<>[\]]/g)?.length ?? 0) / s.length > 0.06);
}

const mostlyCode = (values) => values.length > 0 && values.filter(looksLikeCode).length / values.length >= 0.5;

// The guesses (ids, code, prose, links, labels) read the first SAMPLE rows: Herdr's script
// engine runs regexes slowly, and a few thousand rows show what a column holds. How many rows
// are filled and how many values differ count every row.
export function profileOf(header, rows, kinds, columns = []) {
  const byName = new Map(columns.map((c) => [c.name, c]));
  const sample = rows.length > SAMPLE ? rows.slice(0, SAMPLE) : rows;
  const cols = header.map((name, i) => {
    const kind = kinds[i];
    const values = sample.map((r) => r[i]).filter((v) => v !== null && v !== "");
    const unique = new Set();
    let n = 0;
    for (const r of rows) {
      const v = r[i];
      if (v !== null && v !== "") { n++; unique.add(v); }
    }
    const distinct = unique.size;
    const seen = values.length;
    const avgLen = seen ? values.reduce((s, v) => s + v.length, 0) / seen : 0;
    const spaced = seen ? values.filter((v) => /\S\s+\S/.test(v)).length / seen : 0;
    const pk = (byName.get(name)?.pk ?? null) !== null;
    const idLike = pk || kind === "uuid" || /(^|_)id$|[a-z]Id$/.test(name) || (seen > 0 && values.every((v) => ID_VALUE.test(v)))
      || (kind === "number" && seen > 0 && values.every((v) => /^-?\d{9,}$/.test(v)));
    const category = kind === "text" && !idLike && n > 0 && avgLen <= 28 && spaced < 0.5
      && (n >= 4 ? distinct <= Math.max(2, Math.min(10, n / 3)) : values.every((v) => SEMANTIC.test(v)));
    const nums = kind === "number" ? values.map(Number).filter(Number.isFinite) : [];
    return {
      name, kind, pk, n, distinct, avgLen, spaced, idLike, category,
      url: kind === "text" && seen > 0 && values.filter(isUrl).length / seen >= 0.5,
      code: kind === "text" && mostlyCode(values),
      prose: kind === "text" && avgLen >= 80 && spaced >= 0.8 && !mostlyCode(values),
      max: nums.length ? highest(nums.map(Math.abs)) : 0,
      constant: n > 1 && distinct === 1,
    };
  });
  const scores = cols.map(labelScore);
  const best = scores.reduce((b, s, i) => (s > (scores[b] ?? -Infinity) ? i : b), -1);
  return { cols, label: best >= 0 && scores[best] >= 1.5 ? best : -1 };
}

// How well a column names its rows: unique, readable words, not an id or a paragraph.
function labelScore(c) {
  if (c.kind !== "text" || c.n === 0 || c.url || c.code || c.avgLen < 2 || c.avgLen > 140) return -Infinity;
  const unique = c.distinct / c.n;
  return c.spaced * 2 + (unique >= 0.9 ? 1 : unique >= 0.6 ? 0.3 : -1) - (c.idLike ? 2 : 0) - (c.category ? 1.5 : 0)
    + (/^(name|title|label|display_name|subject|headline|summary)$/i.test(c.name) ? 1.5 : 0);
}

export function describe(header, rows) {
  const cut = rows.map((row) => row.map((v) => (v !== null && v.length > CELL_CHARS ? v.slice(0, CELL_CHARS) : v)));
  const kinds = kindsFor(header, cut);
  return { header, rows: cut, kinds, prof: profileOf(header, cut, kinds) };
}

// Read by position, not by regex: charts and tables call this thousands of times, and Herdr's
// script engine runs a regex about ten times slower than this.
export function formatNumber(v) {
  const s = String(v);
  const start = s.charCodeAt(0) === 45 ? 1 : 0;
  if (s.length === start) return s;
  let dot = -1;
  for (let i = start; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 46 && dot < 0 && i > start && i < s.length - 1) dot = i;
    else if (c < 48 || c > 57) return s;
  }
  let int = "";
  for (let i = dot < 0 ? s.length : dot; i > start; i -= 3) int = s.slice(Math.max(start, i - 3), i) + (int ? `,${int}` : "");
  return (start ? "-" : "") + int + (dot < 0 ? "" : `.${s.slice(dot + 1, dot + 5)}`);
}

export function compact(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  const a = Math.abs(n);
  if (a >= 1e12) return `${(n / 1e12).toFixed(1)}T`;
  if (a >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (a >= 1e4) return `${(n / 1e3).toFixed(1)}K`;
  if (Number.isInteger(n)) return formatNumber(String(n));
  return String(Number(n.toPrecision(4)));
}

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

export function jsonPreview(text) {
  try {
    const v = JSON.parse(text);
    if (Array.isArray(v)) return `[ ${v.length} item${v.length === 1 ? "" : "s"} ]`;
    if (v && typeof v === "object") {
      const keys = Object.keys(v);
      return `{ ${keys.slice(0, 5).join(", ")}${keys.length > 5 ? `, +${keys.length - 5}` : ""} }`;
    }
    return String(v);
  } catch {
    const keys = [...String(text).matchAll(/"([^"]{1,40})"\s*:/g)].map((m) => m[1]).slice(0, 5);
    return keys.length ? `{ ${keys.join(", ")}, … }` : String(text).slice(0, 80);
  }
}

export function formatBytes(n) {
  if (!Number.isFinite(n)) return "";
  const units = ["B", "kB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n >= 10 || i === 0 ? Math.round(n) : n.toFixed(1)} ${units[i]}`;
}

export const ident = (name) => (/^[a-z_][a-z0-9_]*$/.test(name) ? name : quoteIdent(name));

// A column or key name in plain words: created_at → Created at, firstName → First name.
export const words = (name) => {
  const text = String(name).replace(/^_+/, "").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").toLowerCase().trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
};

export const arrayItems = (v) => String(v).replace(/^\{|\}$/g, "").split(",").filter((x) => x !== "").map((x) => x.replace(/^"|"$/g, ""));

// ── Charts ───────────────────────────────────────────────────────────────────
// A result's columns are parsed once and its rows grouped once per axis, in the task that reads
// the result (`chartPreparations`). Every chart is then worked out from those arrays, walking at
// most the groups or one column: a small result's while drawing, a big one's on the view's worker.

export const MAX_SERIES = 6;
const DEFAULT_SERIES = 4;
const MAX_BARS = 16;
const MAX_COLUMNS = 60;
const MAX_GROUPED = 40;
const MAX_POINTS = 240;
const MAX_DOTS = 500;
const MAX_TILES = 8;
const MAX_OTHERS = 4;
const SLICES = 50;
const BINS = 20;
// Scatter groups past the third share one color.
const GROUP_COLORS = 3;

// A result is drawn many times; anything worked out from all its rows is worked out once.
const derived = new WeakMap();
export function memo(result, key, work) {
  let known = derived.get(result);
  if (!known) derived.set(result, (known = new Map()));
  if (!known.has(key)) known.set(key, work());
  return known.get(key);
}

// A column as numbers (a time column as milliseconds), NaN where a value is empty or unreadable.
const valuesOf = (result, i) => memo(result, `values:${i}`, () => parseInto(result, i, new Float64Array(result.rows.length), 0, result.rows.length));

function parseInto(result, i, out, from, to) {
  const { rows } = result;
  const time = result.kinds[i] === "time";
  for (let r = from; r < to; r++) {
    const v = rows[r][i];
    const n = v === null || v === "" ? NaN : time ? timeMs(v) : Number(v);
    out[r] = Number.isFinite(n) ? n : NaN;
  }
  return out;
}

// Reading 50,000 times takes Herdr's engine longer than a step may run, so a column is parsed
// this many rows at a time.
const PARSE_ROWS = 10000;

function parseSteps(result, i) {
  const n = result.rows.length;
  const out = new Float64Array(n);
  const steps = [];
  for (let from = 0; from < n; from += PARSE_ROWS) steps.push(() => parseInto(result, i, out, from, Math.min(n, from + PARSE_ROWS)));
  steps.push(() => memo(result, `values:${i}`, () => out));
  return steps;
}

// Rows grouped by the value of column `x`. Labels keep the order they first appear in; times and
// numbers are sorted. `of` is each row's group, -1 when its value is missing; `at` is a group's
// time, number or first-seen place; `keys` its text as the result printed it.
const groupsOf = (result, x) => memo(result, `groups:${x}`, () => (result.kinds[x] === "text" ? labelGroups(result, x) : placedGroups(result, x)));

function labelGroups(result, x) {
  const { rows } = result;
  const index = new Map();
  const keys = [];
  const of = new Int32Array(rows.length);
  const count = new Uint32Array(rows.length);
  for (let r = 0; r < rows.length; r++) {
    const key = rows[r][x] ?? "—";
    let g = index.get(key);
    if (g === undefined) {
      g = keys.length;
      index.set(key, g);
      keys.push(key);
    }
    of[r] = g;
    count[g]++;
  }
  const n = keys.length;
  const at = new Float64Array(n);
  for (let g = 0; g < n; g++) at[g] = g;
  return { axis: "label", x, n, of, keys, at, rows: count.slice(0, n), counted: rows.length };
}

// Results usually come ordered by their time or number column: then one pass groups them.
// Otherwise the values are sorted natively (a typed array sorts without calling back into
// script, which Herdr's engine does slowly) and each row looks its value up among them. A map
// would be simpler, but Herdr's engine hashes whole numbers stored as floats so poorly that one
// keyed by them is ten times slower, and keying by text makes a string for every row.
function placedGroups(result, x) {
  const v = valuesOf(result, x);
  const axis = result.kinds[x] === "time" ? "time" : "number";
  let up = true;
  let down = true;
  let prev = NaN;
  for (let r = 0; r < v.length && (up || down); r++) {
    const value = v[r];
    if (value !== value) continue;
    if (value < prev) up = false;
    if (value > prev) down = false;
    prev = value;
  }
  return up || down ? orderedGroups(result, x, v, axis, up) : sortedGroups(result, x, v, axis);
}

function orderedGroups(result, x, v, axis, up) {
  let n = 0;
  let prev = NaN;
  for (let r = 0; r < v.length; r++) if (v[r] === v[r] && v[r] !== prev) { n++; prev = v[r]; }
  const of = new Int32Array(v.length);
  const at = new Float64Array(n);
  const count = new Uint32Array(n);
  const keys = new Array(n);
  let g = up ? -1 : n;
  let counted = 0;
  prev = NaN;
  for (let r = 0; r < v.length; r++) {
    const value = v[r];
    if (value !== value) {
      of[r] = -1;
      continue;
    }
    if (value !== prev) {
      g += up ? 1 : -1;
      at[g] = value;
      keys[g] = result.rows[r][x];
      prev = value;
    }
    of[r] = g;
    count[g]++;
    counted++;
  }
  return { axis, x, n, of, keys, at, rows: count, counted };
}

function sortedGroups(result, x, v, axis) {
  const sorted = v.slice().sort();
  const at = new Float64Array(v.length);
  let n = 0;
  for (let i = 0; i < sorted.length && sorted[i] === sorted[i]; i++) if (n === 0 || sorted[i] !== at[n - 1]) at[n++] = sorted[i];
  const find = finder(at, n);
  const of = new Int32Array(v.length);
  const count = new Uint32Array(n);
  const keys = new Array(n);
  let counted = 0;
  for (let r = 0; r < v.length; r++) {
    const g = v[r] === v[r] ? find(v[r]) : -1;
    of[r] = g;
    if (g < 0) continue;
    counted++;
    if (count[g]++ === 0) keys[g] = result.rows[r][x];
  }
  return { axis, x, n, of, keys, at: at.slice(0, n), rows: count, counted };
}

// Finds where a value sits in `at`, the first `n` of which are sorted and distinct. The range is
// cut into `n` equal buckets and a value is searched for only among the groups in its bucket.
// Each step of `bucket` rounds the same way for the same input and never goes down as the value
// goes up, so equal values share a bucket and each bucket's groups sit together in `at`.
function finder(at, n) {
  const min = at[0];
  const span = n > 1 ? at[n - 1] - min : 0;
  const bucket = (value) => (span ? Math.min(n - 1, Math.floor(((value - min) * n) / span)) : 0);
  const first = new Int32Array(n + 1);
  for (let g = 0; g < n; g++) first[bucket(at[g]) + 1]++;
  for (let b = 0; b < n; b++) first[b + 1] += first[b];
  return (value) => {
    const b = bucket(value);
    let lo = first[b];
    let hi = first[b + 1] - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (at[mid] < value) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
}

// Per group of `x`: the sum of column `c`, and how many of its rows have a value there.
const sumsOf = (result, x, c) => memo(result, `sums:${x}:${c}`, () => {
  const { of, n } = groupsOf(result, x);
  const v = valuesOf(result, c);
  const sum = new Float64Array(n);
  const filled = new Uint32Array(n);
  for (let r = 0; r < of.length; r++) {
    const g = of[r];
    const value = v[r];
    if (g >= 0 && value === value) {
      sum[g] += value;
      filled[g]++;
    }
  }
  return { sum, filled };
});

// The columns charts can use. Identifiers, code, prose and links are never an axis or a series.
const rolesOf = (result) => memo(result, "roles", () => {
  const { kinds, prof } = result;
  const all = kinds.map((_k, i) => i);
  const col = (i) => prof.cols[i];
  const nums = all.filter((i) => kinds[i] === "number" && !col(i).idLike);
  const times = all.filter((i) => kinds[i] === "time");
  const labels = all.filter((i) => kinds[i] === "text" && !col(i).idLike && !col(i).code && !col(i).prose && !col(i).url);
  const unique = labels.find((i) => col(i).distinct === col(i).n);
  const label = labels.includes(prof.label) ? prof.label : unique ?? labels[0] ?? -1;
  return { nums, times, labels, cats: labels.filter((i) => col(i).category), label, rows: result.rows.length };
});

// The steps that parse and group a result for its charts, each one pass over the rows, so the
// task reading a result can run them one at a time between frames.
export function chartPreparations(result) {
  const r = rolesOf(result);
  const axes = new Set([alongAxis(r)?.x, r.label].filter((i) => i >= 0));
  const counted = new Set([r.labels[0], r.cats[0]].filter((i) => i >= 0 && !axes.has(i)));
  return [
    ...[...r.nums, ...r.times.slice(0, 1)].flatMap((i) => parseSteps(result, i)),
    ...[...axes, ...counted].map((x) => () => groupsOf(result, x)),
    ...[...axes].map((x) => () => { for (const c of r.nums) if (c !== x) sumsOf(result, x, c); }),
  ];
}

const FREE = { axis: null, x: null };
// The first time column, else the best label, else the first of two or more numbers.
function alongAxis(r) {
  if (r.times.length) return { axis: "time", x: r.times[0] };
  if (r.label >= 0) return { axis: "label", x: r.label };
  if (r.nums.length >= 2) return { axis: "number", x: r.nums[0] };
  return null;
}
const byLabel = (r) => (r.label >= 0 ? { axis: "label", x: r.label } : null);
const continuous = (r) => {
  const a = alongAxis(r);
  return a && a.axis !== "label" ? a : null;
};
const counting = (r) => (r.labels.length ? { axis: "label", x: r.labels[0] } : r.times.length ? { axis: "time", x: r.times[0] } : null);

const lower = (h, i) => words(h[i]).toLowerCase();
function namesOf(h, cols) {
  const names = cols.map((i, k) => (k === 0 ? words(h[i]) : lower(h, i)));
  if (names.length > 3) return `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`;
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0];
}
const byX = (p, h) => `${namesOf(h, p.series)} by ${lower(h, p.x)}`;

// Every chart a person can pick, in the picker's order. `numbers` says what the chips under the
// picker choose: one measure, many series, or none. `place` finds the x, `need` is how many
// numbers it needs besides the x, `pick` settles columns that depend on the measure.
export const CHARTS = [
  { key: "bars", name: "Bars", numbers: "one", place: byLabel, need: 1, title: byX, data: (res, p) => barsData(res, p, sumsOf(res, p.x, p.y).sum) },
  { key: "columns", name: "Columns", numbers: "one", place: alongAxis, need: 1, title: byX, data: (res, p) => columnsData(res, p, "plain") },
  { key: "stacked", name: "Stacked columns", numbers: "many", place: alongAxis, need: 2, title: byX, data: (res, p) => columnsData(res, p, "stacked") },
  { key: "grouped", name: "Grouped columns", numbers: "many", place: alongAxis, need: 2, title: byX, data: (res, p) => columnsData(res, p, "grouped") },
  { key: "share", name: "100% bars", numbers: "many", place: byLabel, need: 2, title: (p, h) => `Share of ${namesOf(h, p.series).toLowerCase()} by ${lower(h, p.x)}`, data: shareData },
  { key: "line", name: "Line", numbers: "many", place: alongAxis, need: 1, title: byX, data: (res, p) => lineData(res, p, MEAN) },
  { key: "area", name: "Area", numbers: "one", place: alongAxis, need: 1, title: byX, data: (res, p) => lineData(res, p, MEAN) },
  { key: "step", name: "Step", numbers: "many", place: alongAxis, need: 1, title: byX, data: (res, p) => lineData(res, p, LAST) },
  { key: "total", name: "Running total", numbers: "one", place: continuous, need: 1, title: (p, h) => `Running total of ${lower(h, p.y)} by ${lower(h, p.x)}`, data: (res, p) => lineData(res, p, TOTAL) },
  {
    key: "scatter", name: "Scatter", numbers: "one", place: () => FREE, need: 2, measureAt: 1,
    pick: (p, r) => ({ ...p, axis: "number", x: p.options.find((i) => i !== p.y), group: r.cats[0] ?? null }),
    title: (p, h) => `${words(h[p.y])} against ${lower(h, p.x)}`, data: dotsData,
  },
  {
    key: "bubbles", name: "Bubbles", numbers: "one", place: () => FREE, need: 3, measureAt: 1,
    pick: (p, r) => {
      const x = p.options.find((i) => i !== p.y);
      return { ...p, axis: "number", x, size: p.options.find((i) => i !== p.y && i !== x), group: r.cats[0] ?? null };
    },
    title: (p, h) => `${words(h[p.y])} against ${lower(h, p.x)}, sized by ${lower(h, p.size)}`, data: dotsData,
  },
  { key: "histogram", name: "Histogram", numbers: "one", place: () => FREE, need: 1, title: (p, h) => `Spread of ${lower(h, p.y)}`, data: histogramData },
  { key: "count", name: "Count", numbers: "none", place: counting, need: 0, title: (p, h) => `Rows by ${lower(h, p.x)}`, data: countData },
  {
    key: "tiles", name: "Big numbers", numbers: "none", place: (r) => (r.rows === 1 ? FREE : null), need: 1,
    pick: (p) => ({ ...p, series: p.options.slice(0, MAX_TILES) }), title: () => null, data: tilesData,
  },
  { key: "bartable", name: "Table with bars", numbers: "one", place: byLabel, need: 2, title: byX, data: barTableData },
];
const CHART = new Map(CHARTS.map((c) => [c.key, c]));

// What Automatic picks: the first chart here that fits and meets its condition.
const AUTO = [["tiles"], ["columns", (r) => r.times.length > 0], ["bars"], ["scatter"], ["histogram"], ["count"]];

const optionsOf = (r, place) => r.nums.filter((i) => i !== place.x);

function fits(chart, r) {
  const place = chart.place(r);
  return place !== null && optionsOf(r, place).length >= chart.need;
}

export const chartChoices = (result) => {
  const r = rolesOf(result);
  return CHARTS.filter((c) => fits(c, r)).map((c) => c.key);
};

export const chartName = (key) => CHART.get(key)?.name ?? null;

// The series a many-number chart draws: the saved names that still exist, in column order, else
// the first four.
function chosenSeries(header, options, names) {
  const picked = Array.isArray(names) ? options.filter((i) => names.includes(header[i])) : [];
  return picked.length ? picked.slice(0, MAX_SERIES) : options.slice(0, DEFAULT_SERIES);
}

// A series' color is its place among the numbers that can be drawn, so it keeps its color when
// another is turned off. Past the sixth, a series takes a color no earlier series is using.
function colorsOf(series, options) {
  const slots = series.map((i) => {
    const k = options.indexOf(i);
    return k < MAX_SERIES ? k : -1;
  });
  const free = [0, 1, 2, 3, 4, 5].filter((s) => !slots.includes(s));
  return slots.map((s) => (s >= 0 ? s : free.shift()));
}

// The chart to draw and the columns it uses. `choice` holds the saved `chart` (a key, or null for
// Automatic), `measure` (a column name) and `series` (column names). A saved chart that does not
// fit falls back to Automatic and is named in `refused`.
export function plan(result, choice = {}) {
  const r = rolesOf(result);
  const asked = CHART.get(choice?.chart) ?? null;
  const chart = asked && fits(asked, r) ? asked : automatic(r);
  if (!chart) return null;
  const place = chart.place(r);
  const options = optionsOf(r, place);
  const h = result.header;
  let p = { type: chart.key, numbers: chart.numbers, auto: chart !== asked, refused: asked && chart !== asked ? asked.key : null,
    axis: place.axis, x: place.x, y: null, series: [], colors: [], size: null, group: null, options };
  if (chart.numbers === "one") {
    const m = h.indexOf(choice?.measure ?? null);
    p.y = options.includes(m) ? m : options[chart.measureAt ?? 0];
    p.series = [p.y];
  }
  if (chart.numbers === "many") p.series = chosenSeries(h, options, choice?.series);
  if (chart.pick) p = chart.pick(p, r);
  p.colors = chart.numbers === "many" ? colorsOf(p.series, options) : p.series.map(() => 0);
  return p;
}

function automatic(r) {
  for (const [key, when] of AUTO) {
    const chart = CHART.get(key);
    if (fits(chart, r) && (!when || when(r))) return chart;
  }
  return null;
}

export const defaultView = (result) => (plan(result) && result.rows.length > 1 ? "chart" : "table");

export const chartTitle = (p, header) => CHART.get(p.type).title(p, header);

// The series names after turning `name` on or off, or null when that is refused: the last one
// stays on, and at most six are on.
export function toggledSeries(result, choice, name) {
  const p = plan(result, choice);
  if (!p || p.numbers !== "many") return null;
  const h = result.header;
  const on = p.series.map((i) => h[i]);
  if (on.includes(name)) return on.length > 1 ? on.filter((n) => n !== name) : null;
  if (on.length >= MAX_SERIES || !p.options.some((i) => h[i] === name)) return null;
  return p.options.filter((i) => on.includes(h[i]) || h[i] === name).map((i) => h[i]);
}

// What the drawer draws for this plan, or null when there is nothing to draw.
const chartKey = (p) => `chart:${p.type}:${p.x}:${p.y}:${p.series}:${p.size}:${p.group}`;
export const chartData = (result, p) => memo(result, chartKey(p), () => CHART.get(p.type).data(result, p));
// Whether chartData for this plan is already worked out, so drawing it costs nothing.
export const chartDrawn = (result, p) => derived.get(result)?.has(chartKey(p)) ?? false;

const figure = (v) => formatNumber(String(Math.round(v * 100) / 100));

function bounds(values, withZero) {
  let lo = withZero ? 0 : Infinity;
  let hi = withZero ? 0 : -Infinity;
  for (const v of values) {
    if (v !== v) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (lo === Infinity) return { lo: 0, hi: 1 };
  if (lo === hi) return lo === 0 ? { lo: 0, hi: 1 } : { lo: Math.min(lo, 0), hi: Math.max(hi, 0) };
  return { lo, hi };
}

// ── Along x: columns and lines ──

// How a slot of x combines the groups that land in it.
const SUM = "sum";
const MEAN = "mean";
const LAST = "last";
const TOTAL = "total";

// Which slot each group lands in. A label axis keeps its first `cap` labels. A time or number
// axis keeps one slot per value, or cuts the span into `slices` equal slices when there are more
// than `cap` values or two are closer than span / `crowd` (columns that close would overlap).
function slotsOf(groups, { cap, slices = cap, crowd = 0, sums = false }) {
  const { n, at } = groups;
  if (groups.axis === "label") {
    const m = Math.min(n, cap);
    const slot = new Int32Array(m);
    for (let g = 0; g < m; g++) slot[g] = g;
    return { slot, m, sliced: false, more: n - m, min: 0, span: 0 };
  }
  const slot = new Int32Array(n);
  const min = at[0];
  const span = at[n - 1] - min;
  let crowded = n > cap;
  if (!crowded && crowd) for (let g = 1; g < n && !crowded; g++) crowded = at[g] - at[g - 1] < span / crowd;
  if (!crowded) {
    for (let g = 0; g < n; g++) slot[g] = g;
    return { slot, m: n, sliced: false, more: 0, min, span };
  }
  // Evenly spaced points summed into equal slices would land one in some slices and two in
  // others, drawing a sawtooth the data does not have. They are summed `per` at a time instead,
  // and the span stretched to whole slices so each slice still starts at its first point.
  const gap = span / (n - 1);
  if (sums && gap > 0 && evenly(at, n, gap)) {
    const per = Math.ceil(n / slices);
    const m = Math.ceil(n / per);
    for (let g = 0; g < n; g++) slot[g] = Math.floor(g / per);
    return { slot, m, sliced: true, more: 0, min, span: m * per * gap };
  }
  // Multiplying first keeps a point that sits on a slice's edge in that slice.
  for (let g = 0; g < n; g++) slot[g] = Math.min(slices - 1, Math.floor(((at[g] - min) * slices) / span));
  return { slot, m: slices, sliced: true, more: 0, min, span };
}

function evenly(at, n, gap) {
  for (let g = 1; g < n; g++) if (Math.abs(at[g] - at[g - 1] - gap) > gap * 1e-6) return false;
  return true;
}

// One value per slot, from the groups that have one: a slot none of them fills is NaN.
// A running total carries on through empty slots.
function fold(groups, s, values, filled, how) {
  const out = new Float64Array(s.m);
  const seen = new Uint32Array(s.m);
  for (let g = 0; g < s.slot.length; g++) {
    const k = s.slot[g];
    if (filled !== null && filled[g] === 0) continue;
    out[k] = how === LAST ? values[g] : out[k] + values[g];
    seen[k]++;
  }
  let total = 0;
  for (let k = 0; k < s.m; k++) {
    if (how === TOTAL) out[k] = total += out[k];
    else if (seen[k] === 0) out[k] = NaN;
    else if (how === MEAN) out[k] /= seen[k];
  }
  return out;
}

function slotText(groups, s, k) {
  if (!s.sliced) {
    const key = groups.keys[k];
    return groups.axis === "time" ? naturalTime(key) : groups.axis === "number" ? formatNumber(key) : key;
  }
  const v = s.min + (s.span * k) / s.m;
  return groups.axis === "time" ? naturalTime(new Date(v).toISOString()) : compact(v);
}

function slotX(groups, s, k) {
  if (groups.axis === "label") return (k + 0.5) / s.m;
  if (s.sliced) return k / s.m;
  return s.span ? (groups.at[k] - s.min) / s.span : 0.5;
}

// Labels under the x axis: every label when there are few, else the two ends; on a time or
// number axis, its start, middle and end.
const slotTicks = (points) => (points.length <= 12
  ? { ticks: points.map((pt) => pt.label), each: true }
  : { ticks: [points[0].label, points.at(-1).label], each: false });

function ticksOf(groups, s, points) {
  if (groups.axis === "label") return slotTicks(points);
  const at = (f) => (groups.axis === "time" ? naturalTime(new Date(s.min + s.span * f).toISOString()) : compact(s.min + s.span * f));
  return { ticks: [at(0), at(0.5), at(1)], each: false };
}

function alongX(result, p, cut, how) {
  const groups = groupsOf(result, p.x);
  if (groups.n === 0) return null;
  const s = slotsOf(groups, cut);
  const h = result.header;
  const series = p.series.length
    ? p.series.map((c, k) => {
      const { sum, filled } = sumsOf(result, p.x, c);
      return { name: h[c], color: p.colors[k], values: fold(groups, s, sum, filled, how) };
    })
    : [{ name: "rows", color: 0, values: fold(groups, s, groups.rows, null, SUM) }];
  const points = Array.from({ length: s.m }, (_v, k) => ({ x: slotX(groups, s, k), label: slotText(groups, s, k) }));
  const repeated = groups.n < groups.counted && !s.sliced;
  return { groups, s, series, points, axis: groups.axis, ...ticksOf(groups, s, points), repeated, more: s.more };
}

const legendOf = (series) => (series.length > 1 ? series.map((x) => ({ name: x.name, color: x.color })) : []);

// Columns: one bar per point; stacked: positives up and negatives down from zero; grouped: side
// by side. Each mark spans `from` to `to`; `outer` marks the end of a stack, which is rounded.
function columnsData(result, p, form) {
  const grouped = form === "grouped";
  const a = alongX(result, p, grouped ? { cap: MAX_GROUPED, crowd: MAX_GROUPED, sums: true } : { cap: MAX_COLUMNS, slices: SLICES, crowd: SLICES, sums: true }, SUM);
  if (!a) return null;
  return columnsOut(result, p, a, form, a.s.sliced ? `summed in ${a.s.m} ${a.axis === "time" ? "equal time slices" : "equal slices"}` : null);
}

function columnsOut(result, p, a, form, sliced) {
  const many = a.series.length > 1;
  const stacked = form === "stacked";
  let lo = 0;
  let hi = 0;
  const points = a.points.map((pt, k) => {
    let up = 0;
    let down = 0;
    const marks = [];
    a.series.forEach((ser, si) => {
      const v = ser.values[k];
      if (!(v === v) || v === 0) return;
      const from = !stacked ? 0 : v > 0 ? up : down;
      if (v > 0) up += v;
      else down += v;
      const tip = `${pt.label} · ${many ? `${ser.name} ` : ""}${figure(v)}`;
      marks.push({ series: si, from, to: from + v, color: ser.color, tip, outer: !stacked, inner: from !== 0 });
    });
    if (stacked) {
      const top = marks.filter((m) => m.to > 0).pop();
      const bottom = marks.filter((m) => m.to < 0).pop();
      if (top) top.outer = true;
      if (bottom) bottom.outer = true;
    }
    for (const m of marks) {
      lo = Math.min(lo, m.to);
      hi = Math.max(hi, m.to);
    }
    return { ...pt, marks };
  });
  const signed = !many && lo < 0;
  const n = points.length;
  // Grouped columns share the width evenly whatever the axis, so they are named one by one.
  const { ticks, each } = form === "grouped" ? slotTicks(a.points) : a;
  return {
    form, axis: a.axis, points, lo, hi: hi === lo ? 1 : hi, signed, ticks, each, more: a.more,
    legend: legendOf(a.series), slotCount: form === "grouped" ? a.series.length : 1,
    barWidth: n <= 12 ? 24 : n <= 40 ? 10 : 5,
    note: sliced ?? (a.repeated ? `${p.series.length ? "summed" : "rows counted"} per ${result.header[p.x]}` : null),
  };
}

// Lines: one per series. Past 240 points a time or number axis is cut into 240 slices, each the
// average of its points (a step line keeps the last); a label axis shows its first 240.
function lineData(result, p, how) {
  const a = alongX(result, p, { cap: MAX_POINTS }, how);
  if (!a) return null;
  const wash = how === TOTAL || p.type === "area";
  const { lo, hi } = bounds(a.series.flatMap((s) => [...s.values]), wash);
  const many = a.series.length > 1;
  const points = a.points.map((pt, k) => ({
    ...pt,
    tip: [pt.label, ...a.series.map((s) => (s.values[k] === s.values[k] ? `${many ? `${s.name} ` : ""}${figure(s.values[k])}` : null)).filter(Boolean)].join(" · "),
  }));
  const slices = `${a.s.m} ${a.axis === "time" ? "time slices" : "slices"}`;
  const x = result.header[p.x];
  let note = a.repeated ? `summed per ${x}` : null;
  if (a.more > 0) note = `the first ${a.s.m} of ${formatNumber(String(a.groups.n))} ${x} values`;
  if (a.s.sliced) note = how === LAST ? `last value in each of ${slices}` : `${how === TOTAL ? "summed" : "averaged"} in ${slices}`;
  return {
    axis: a.axis, points, series: a.series.map((s) => ({ name: s.name, color: s.color, values: [...s.values] })), lo, hi,
    ticks: a.ticks, each: a.each, wash, step: how === LAST, legend: legendOf(a.series), note,
  };
}

// ── By label: bars, shares, the table with bars ──

// The `k` groups furthest from zero, largest first. The cut comes from a native sort of the sizes.
function topGroups(values, n, k) {
  const picked = [];
  if (n <= k) for (let g = 0; g < n; g++) picked.push(g);
  else {
    const sizes = new Float64Array(n);
    for (let g = 0; g < n; g++) sizes[g] = Math.abs(values[g]);
    sizes.sort();
    const cut = sizes[n - k];
    for (let g = 0; g < n; g++) if (Math.abs(values[g]) > cut) picked.push(g);
    for (let g = 0; g < n && picked.length < k; g++) if (Math.abs(values[g]) === cut) picked.push(g);
  }
  return picked.sort((a, b) => values[b] - values[a] || a - b);
}

// One bar per label, largest first; labels repeated across rows are summed.
function barsData(result, p, values) {
  const groups = groupsOf(result, p.x);
  if (groups.n === 0) return null;
  const shown = topGroups(values, groups.n, MAX_BARS).map((g) => ({ label: groups.keys[g], value: values[g], tip: `${groups.keys[g]} · ${figure(values[g])}` }));
  const { lo, hi } = bounds(shown.map((b) => b.value), true);
  return {
    shown, lo, hi, signed: lo < 0, more: groups.n - shown.length,
    note: groups.n < groups.counted ? `${p.y === null ? "rows counted" : "summed"} per ${result.header[p.x]}` : null,
  };
}

function countData(result, p) {
  if (p.axis === "label") {
    const bars = barsData(result, p, groupsOf(result, p.x).rows);
    return bars && { ...bars, form: "bars" };
  }
  const a = alongX(result, p, { cap: MAX_COLUMNS, slices: SLICES, crowd: SLICES, sums: true }, SUM);
  return a && columnsOut(result, p, a, "plain", a.s.sliced ? `rows in ${a.s.m} equal time slices` : null);
}

// One bar per label, split into each series' share of the label's total. Negative values count
// as nothing.
function shareData(result, p) {
  const groups = groupsOf(result, p.x);
  if (groups.n === 0) return null;
  const sums = p.series.map((c) => sumsOf(result, p.x, c).sum);
  const totals = new Float64Array(groups.n);
  for (const sum of sums) for (let g = 0; g < groups.n; g++) if (sum[g] > 0) totals[g] += sum[g];
  const h = result.header;
  const rows = topGroups(totals, groups.n, MAX_BARS).map((g) => ({
    label: groups.keys[g],
    total: totals[g],
    parts: totals[g] > 0
      ? sums.map((sum, k) => {
        const share = (Math.max(0, sum[g]) / totals[g]) * 100;
        return { color: p.colors[k], share, tip: `${groups.keys[g]} · ${h[p.series[k]]} ${figure(sum[g])} · ${Math.round(share)}%` };
      }).filter((part) => part.share > 0)
      : [],
  }));
  return { rows, more: groups.n - rows.length, legend: p.series.map((c, k) => ({ name: h[c], color: p.colors[k] })) };
}

function barTableData(result, p) {
  const groups = groupsOf(result, p.x);
  if (groups.n === 0) return null;
  const h = result.header;
  const values = sumsOf(result, p.x, p.y).sum;
  const others = p.options.filter((i) => i !== p.y).slice(0, MAX_OTHERS);
  const otherSums = others.map((c) => sumsOf(result, p.x, c));
  const rows = topGroups(values, groups.n, MAX_BARS).map((g) => ({
    label: groups.keys[g],
    others: otherSums.map(({ sum, filled }) => (filled[g] ? compact(sum[g]) : "—")),
    value: values[g],
    tip: `${groups.keys[g]} · ${h[p.y]} ${figure(values[g])}`,
  }));
  const { lo, hi } = bounds(rows.map((row) => row.value), true);
  return {
    head: { label: h[p.x], others: others.map((c) => h[c]), measure: h[p.y] }, rows, lo, hi, signed: lo < 0, more: groups.n - rows.length,
    note: groups.n < groups.counted ? `summed per ${h[p.x]}` : null,
  };
}

// ── Single columns: dots, histogram, tiles ──

// Dots for the first 500 rows with both numbers; the scales cover every row. A bubble's size
// comes from a third number; dots take the color of their category's place by row count.
function dotsData(result, p) {
  const xs = valuesOf(result, p.x);
  const ys = valuesOf(result, p.y);
  const sizes = p.size === null ? null : valuesOf(result, p.size);
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = 0;
  let y1 = -Infinity;
  let biggest = 0;
  const kept = [];
  for (let r = 0; r < xs.length; r++) {
    const a = xs[r];
    const b = ys[r];
    if (!(a === a && b === b)) continue;
    if (a < x0) x0 = a;
    if (a > x1) x1 = a;
    if (b < y0) y0 = b;
    if (b > y1) y1 = b;
    if (sizes && sizes[r] > biggest) biggest = sizes[r];
    if (kept.length < MAX_DOTS) kept.push(r);
  }
  if (kept.length === 0) return null;
  const h = result.header;
  const groups = p.group === null ? null : groupsOf(result, p.group);
  const rank = groups ? groupRanks(groups) : null;
  // A scatter's dots hang from their corner and a bubble is centered on its point; either way the
  // dots stay inside the plot.
  const inset = sizes ? 1.5 : 0;
  const fx = (v) => inset + (x1 === x0 ? 50 - inset : ((v - x0) / (x1 - x0)) * 97);
  const fy = (v) => inset + (y1 === y0 ? 50 - inset : 97 - ((v - y0) / (y1 - y0)) * 97);
  const points = kept.map((r) => {
    const a = xs[r];
    const b = ys[r];
    const size = sizes ? sizes[r] : NaN;
    const g = groups ? groups.of[r] : -1;
    const tip = [`${h[p.x]} ${formatNumber(String(a))}`, `${h[p.y]} ${formatNumber(String(b))}`];
    if (sizes) tip.push(`${h[p.size]} ${size === size ? formatNumber(String(size)) : "—"}`);
    if (g >= 0) tip.push(groups.keys[g]);
    return {
      left: fx(a), top: fy(b), tip: tip.join(" · "),
      diameter: sizes ? 2 * (size > 0 && biggest > 0 ? 4 + 8 * Math.sqrt(size / biggest) : 4) : 10,
      color: g < 0 ? 0 : rank[g] < GROUP_COLORS ? rank[g] : -1,
    };
  });
  const legend = groups ? [...groups.keys].map((name, g) => ({ name, rank: rank[g] })).sort((a, b) => a.rank - b.rank) : [];
  return {
    points, x0, x1, y0, y1, xName: h[p.x], sized: sizes !== null,
    legend: legend.length > 1 ? [
      ...legend.slice(0, GROUP_COLORS).map((l) => ({ name: l.name, color: l.rank })),
      ...(legend.length > GROUP_COLORS ? [{ name: "Other", color: -1 }] : []),
    ] : [],
  };
}

// Each group's place by row count, most rows first; ties keep the order they first appear in.
function groupRanks(groups) {
  const order = Array.from({ length: groups.n }, (_v, g) => g).sort((a, b) => groups.rows[b] - groups.rows[a] || a - b);
  const rank = new Int32Array(groups.n);
  order.forEach((g, k) => { rank[g] = k; });
  return rank;
}

function histogramData(result, p) {
  const v = valuesOf(result, p.y);
  let min = Infinity;
  let max = -Infinity;
  for (let r = 0; r < v.length; r++) {
    if (v[r] < min) min = v[r];
    if (v[r] > max) max = v[r];
  }
  if (min === Infinity) return null;
  const n = min === max ? 1 : BINS;
  const bins = new Float64Array(n);
  for (let r = 0; r < v.length; r++) if (v[r] === v[r]) bins[n === 1 ? 0 : Math.min(n - 1, Math.floor(((v[r] - min) / (max - min)) * n))]++;
  const width = (max - min) / n;
  const points = [...bins].map((c, k) => ({
    x: (k + 0.5) / n,
    label: `${compact(min + width * k)} to ${compact(min + width * (k + 1))}`,
    marks: c ? [{ series: 0, from: 0, to: c, color: 0, outer: true, inner: false, tip: `${compact(min + width * k)} to ${compact(min + width * (k + 1))} · ${c} row${c === 1 ? "" : "s"}` }] : [],
  }));
  return {
    form: "plain", axis: "bins", points, lo: 0, hi: highest(bins) || 1, signed: false, slotCount: 1, more: 0, legend: [], barWidth: 24,
    ticks: [compact(min), compact((min + max) / 2), compact(max)], each: false, note: "rows per range of values",
  };
}

function tilesData(result, p) {
  const row = result.rows[0];
  if (!row || p.series.length === 0) return null;
  return { tiles: p.series.map((i) => ({ name: words(result.header[i]), value: row[i] === null || row[i] === "" ? "—" : formatNumber(row[i]) })) };
}

// One line per column: what it holds, how full it is, its range or most common value.
export function summarize(result, now = new Date()) {
  const { header, rows, kinds, prof } = result;
  return header.map((name, i) => {
    const values = rows.map((r) => r[i]).filter((v) => v !== null && v !== "");
    const c = prof.cols[i];
    return {
      name,
      holds: c.idLike ? "identifiers" : HOLDS[kinds[i]] ?? (c.code ? "code" : c.category ? "categories" : "text"),
      filled: `${rows.length ? Math.round((values.length / rows.length) * 100) : 0}%`,
      distinct: formatNumber(String(c.distinct)),
      range: rangeOf(values, kinds[i], c, now),
    };
  });
}

function rangeOf(values, kind, col, now) {
  if (values.length === 0) return "—";
  if (kind === "number" && !col.idLike) {
    const nums = values.map(Number);
    const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
    return `${compact(lowest(nums))} to ${compact(highest(nums))}, average ${compact(avg)}`;
  }
  if (kind === "time") {
    const ms = values.map(timeMs).filter(Number.isFinite).sort((a, b) => a - b);
    const day = (t) => naturalTime(new Date(t).toISOString(), now);
    return ms.length ? `${day(ms[0])} to ${day(ms[ms.length - 1])}` : "—";
  }
  if (kind === "bool") return `${Math.round((values.filter((v) => v === "t").length / values.length) * 100)}% true`;
  if (col.idLike) return "—";
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let top = null;
  let n = 0;
  for (const [v, c] of counts) if (c > n) { top = v; n = c; }
  return n > 1 ? `${top.length > 48 ? `${top.slice(0, 48)}…` : top} (${n} rows)` : "every value different";
}
