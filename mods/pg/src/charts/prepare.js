import { memo } from "../results/cache.js";
import { timeMs } from "../results/time.js";
import { ALONG, rolesOf } from "./roles.js";

// A column as numbers (a time column as milliseconds), NaN where a value is empty or unreadable.
export const valuesOf = (result, i) => memo(result, `values:${i}`, () => parseInto(result, i, new Float64Array(result.rows.length), 0, result.rows.length));

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
export const groupsOf = (result, x) => memo(result, `groups:${x}`, () => (result.kinds[x] === "text" ? labelGroups(result, x) : placedGroups(result, x)));

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
export const sumsOf = (result, x, c) => memo(result, `sums:${x}:${c}`, () => {
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
// The steps that parse and group a result for its charts, each one pass over the rows, so the
// task reading a result can run them one at a time between frames.
export function chartPreparations(result) {
  const r = rolesOf(result);
  const axes = new Set([ALONG.any(r)[0], r.label].filter((i) => i >= 0));
  const counted = new Set([r.labels[0], r.cats[0]].filter((i) => i >= 0 && !axes.has(i)));
  return [
    ...[...r.nums, ...r.times.slice(0, 1)].flatMap((i) => parseSteps(result, i)),
    ...[...axes, ...counted].map((x) => () => groupsOf(result, x)),
    ...[...axes].map((x) => () => { for (const c of r.nums) if (c !== x) sumsOf(result, x, c); }),
  ];
}
