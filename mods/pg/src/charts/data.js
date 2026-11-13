import { compact, formatNumber, words } from "../results/format.js";
import { naturalTime } from "../results/time.js";
import { highest } from "../results/numbers.js";
import { valuesOf, groupsOf, sumsOf } from "./prepare.js";
import { bounds } from "./scale.js";
import { MAX_BARS, MAX_COLUMNS, MAX_GROUPED, MAX_POINTS, MAX_DOTS, MAX_OTHERS, SLICES, BINS, GROUP_COLORS } from "./constants.js";

const figure = (v) => formatNumber(String(Math.round(v * 100) / 100));
// ── Along x: columns and lines ──

// How a slot of x combines the groups that land in it.
export const SUM = "sum";
export const MEAN = "mean";
export const LAST = "last";
export const TOTAL = "total";

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
export function columnsData(result, p, form) {
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
export function lineData(result, p, how) {
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
export function barsData(result, p, values) {
  const groups = groupsOf(result, p.x);
  if (groups.n === 0) return null;
  const shown = topGroups(values, groups.n, MAX_BARS).map((g) => ({ label: groups.keys[g], value: values[g], tip: `${groups.keys[g]} · ${figure(values[g])}` }));
  const { lo, hi } = bounds(shown.map((b) => b.value), true);
  return {
    shown, lo, hi, signed: lo < 0, more: groups.n - shown.length,
    note: groups.n < groups.counted ? `${p.y === null ? "rows counted" : "summed"} per ${result.header[p.x]}` : null,
  };
}

export function countData(result, p) {
  if (p.axis === "label") {
    const bars = barsData(result, p, groupsOf(result, p.x).rows);
    return bars && { ...bars, form: "bars" };
  }
  const a = alongX(result, p, { cap: MAX_COLUMNS, slices: SLICES, crowd: SLICES, sums: true }, SUM);
  return a && columnsOut(result, p, a, "plain", a.s.sliced ? `rows in ${a.s.m} equal time slices` : null);
}

// One bar per label, split into each series' share of the label's total. Negative values count
// as nothing.
export function shareData(result, p) {
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

export function barTableData(result, p) {
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
export function dotsData(result, p) {
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

export function histogramData(result, p) {
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

export function tilesData(result, p) {
  const row = result.rows[0];
  if (!row || p.series.length === 0) return null;
  return { tiles: p.series.map((i) => ({ name: words(result.header[i]), value: row[i] === null || row[i] === "" ? "—" : formatNumber(row[i]) })) };
}
