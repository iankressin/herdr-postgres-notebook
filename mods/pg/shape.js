// What a query result holds and how to chart it, with no app imports, so `node --test` can run them.
// Every decision comes from what a column holds (its type or its values), never from what one
// dataset happens to call its columns.
import { quoteIdent } from "./logic.js";

export const CELL_CHARS = 600;
export const MAX_BARS = 16;
export const SLICES = 50;

const NUM = /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/;
const TIME = /^\d{4}-\d\d-\d\d([ T]\d\d:\d\d(:\d\d(\.\d+)?)?([+-]\d\d(:?\d\d)?|Z)?)?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID_VALUE = /^(0x)?[0-9a-f]{12,}$|^[0-9a-f]{8}-[0-9a-f]{4}-|^\d{7,}$|^[a-z]+[:_-]\d+$/i;
const SEMANTIC = /^(success|succeeded|ok|done|complete|completed|pass|passed|active|healthy|enabled|yes|fail|failed|failure|error|errored|crashed|dead|rejected|invalid|fatal|running|started|pending|queued|in_progress|building|working|open|closed|warn|warning|skipped|cancelled|canceled|partial|stale|draft|archived|paused)$/i;
const URL_VALUE = /^https?:\/\/\S+$/i;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const HOLDS = { number: "numbers", time: "dates", bool: "yes or no", json: "JSON" };

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
  return header.map((name, i) => {
    const column = byName.get(name);
    return column ? kindOfType(column.type) : kindOfValues(rows.map((r) => r[i]));
  });
}

export const isUrl = (v) => typeof v === "string" && URL_VALUE.test(v);

export function looksLikeCode(v) {
  const s = String(v).trim();
  return /^(select|insert|update|delete|with|create|alter|drop|begin|commit|explain|set|show|copy|grant|vacuum|analyze)\b/i.test(s)
    || (s.length > 60 && (s.match(/[{}();=<>[\]]/g)?.length ?? 0) / s.length > 0.06);
}

const mostlyCode = (values) => values.length > 0 && values.filter(looksLikeCode).length / values.length >= 0.5;

export function profileOf(header, rows, kinds, columns = []) {
  const byName = new Map(columns.map((c) => [c.name, c]));
  const cols = header.map((name, i) => {
    const kind = kinds[i];
    const values = rows.map((r) => r[i]).filter((v) => v !== null && v !== "");
    const n = values.length;
    const distinct = new Set(values).size;
    const avgLen = n ? values.reduce((s, v) => s + v.length, 0) / n : 0;
    const spaced = n ? values.filter((v) => /\S\s+\S/.test(v)).length / n : 0;
    const pk = (byName.get(name)?.pk ?? null) !== null;
    const idLike = pk || kind === "uuid" || /(^|_)id$|[a-z]Id$/.test(name) || (n > 0 && values.every((v) => ID_VALUE.test(v)))
      || (kind === "number" && n > 0 && values.every((v) => /^-?\d{9,}$/.test(v)));
    const category = kind === "text" && !idLike && n > 0 && avgLen <= 28 && spaced < 0.5
      && (n >= 4 ? distinct <= Math.max(2, Math.min(10, n / 3)) : values.every((v) => SEMANTIC.test(v)));
    const nums = kind === "number" ? values.map(Number).filter(Number.isFinite) : [];
    return {
      name, kind, pk, n, distinct, avgLen, spaced, idLike, category,
      url: kind === "text" && n > 0 && values.filter(isUrl).length / n >= 0.5,
      code: kind === "text" && mostlyCode(values),
      prose: kind === "text" && avgLen >= 80 && spaced >= 0.8 && !mostlyCode(values),
      max: nums.length ? Math.max(...nums.map(Math.abs)) : 0,
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

export function formatNumber(v) {
  const s = String(v);
  if (!/^-?\d+(\.\d+)?$/.test(s)) return s;
  const [int, frac] = s.split(".");
  const sign = int.startsWith("-") ? "-" : "";
  const grouped = int.replace("-", "").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return sign + grouped + (frac ? "." + frac.slice(0, 4) : "");
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
export const timeMs = (v) => Date.parse(String(v).replace(" ", "T").replace(/(\.\d{3})\d+/, "$1").replace(/(:\d\d(?:\.\d+)?[+-]\d\d)$/, "$1:00"));

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

// Which chart fits, from the kinds of the columns and nothing else. `measure` is a column name.
export function plan(result, measure) {
  const { header: h, kinds, prof } = result;
  const m = h.indexOf(measure);
  const idx = h.map((_n, i) => i);
  const nums = idx.filter((i) => kinds[i] === "number" && !prof.cols[i].idLike);
  const times = idx.filter((i) => kinds[i] === "time");
  const labels = idx.filter((i) => kinds[i] === "text" && !prof.cols[i].idLike && !prof.cols[i].code && !prof.cols[i].prose && !prof.cols[i].url);
  const y = nums.includes(m) ? m : nums[0];
  if (y !== undefined && times.length) return { type: "time", x: times[0], y, nums };
  if (y !== undefined && labels.length) {
    const unique = labels.find((i) => prof.cols[i].distinct === prof.cols[i].n);
    return { type: "bars", x: prof.label >= 0 && labels.includes(prof.label) ? prof.label : unique ?? labels[0], y, nums };
  }
  if (nums.length >= 2) return { type: "scatter", x: nums[0], y: nums.includes(m) && m !== nums[0] ? m : nums[1], nums };
  if (nums.length === 1) return { type: "spread", x: nums[0], y: null, nums };
  if (labels.length) return { type: "count", x: labels[0], y: null, nums };
  if (times.length) return { type: "timecount", x: times[0], y: null, nums };
  return null;
}

export const defaultView = (result) => (plan(result, null) && result.rows.length > 1 ? "chart" : "table");

export function chartTitle(p, header) {
  const x = words(header[p.x]).toLowerCase();
  if (p.type === "time" || p.type === "bars") return `${words(header[p.y])} by ${x}`;
  if (p.type === "count" || p.type === "timecount") return `Rows by ${x}`;
  if (p.type === "scatter") return `${words(header[p.y])} against ${x}`;
  return `Spread of ${x}`;
}

export function measureChoices(p) {
  if (!(p.type === "time" || p.type === "bars" || p.type === "scatter") || p.nums.length <= 1) return [];
  return p.nums.filter((i) => p.type !== "scatter" || i !== p.x);
}

// Bars stand at their moment on a real time axis, so uneven gaps look uneven. `y` null counts rows.
export function timeSeries(result, x, y) {
  const pts = result.rows.map((r) => ({ at: timeMs(r[x]), raw: r[x], value: y === null ? 1 : Number(r[y]) || 0 }))
    .filter((p) => Number.isFinite(p.at)).sort((a, b) => a.at - b.at);
  if (pts.length === 0) return null;
  const min = pts[0].at;
  const span = Math.max(1, pts[pts.length - 1].at - min);
  // Points closer than a bar's width would overlap: then sum them into equal time slices.
  const crowded = pts.some((p, k) => k > 0 && p.at - pts[k - 1].at < span / SLICES);
  const slices = crowded ? SLICES : Math.min(60, new Set(pts.map((p) => p.at)).size);
  let points = pts.map((p) => ({ at: p.at, value: p.value, tip: `${naturalTime(p.raw)} · ${formatNumber(String(p.value))}` }));
  let note = null;
  if (crowded || slices < pts.length || pts.length > 120) {
    const sums = new Array(slices).fill(0);
    for (const p of pts) sums[Math.min(slices - 1, Math.floor(((p.at - min) / span) * slices))] += p.value;
    points = sums.map((v, k) => {
      const at = min + (span * k) / slices;
      return { at, value: v, tip: `${naturalTime(new Date(at).toISOString())} · ${formatNumber(String(Math.round(v * 100) / 100))}` };
    });
    note = `${y === null ? "rows" : "summed"} in ${slices} equal time slices`;
  }
  const tick = (f) => naturalTime(new Date(min + span * f).toISOString());
  return {
    min, span, points, note,
    barWidth: points.length <= 12 ? 24 : points.length <= 40 ? 10 : 5,
    ticks: [tick(0), tick(0.5), tick(1)],
  };
}

// An empty value is missing, not zero.
const filled = (v) => v !== null && v !== "";

export function spread(result, x) {
  const values = result.rows.map((r) => r[x]).filter(filled).map(Number).filter(Number.isFinite);
  if (values.length === 0) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const n = min === max ? 1 : 20;
  const bins = new Array(n).fill(0);
  for (const v of values) bins[n === 1 ? 0 : Math.min(n - 1, Math.floor(((v - min) / (max - min)) * n))]++;
  const width = (max - min) / n;
  return {
    points: bins.map((c, k) => ({ key: k, value: c, tip: `${compact(min + width * k)} to ${compact(min + width * (k + 1))} · ${c} row${c === 1 ? "" : "s"}` })),
    labels: [compact(min), compact((min + max) / 2), compact(max)],
    note: "rows per range of values",
  };
}

// One bar per label, largest first; labels repeated across rows are summed. `y` null counts rows.
export function barTotals(result, x, y) {
  const totals = new Map();
  for (const r of result.rows) {
    const key = r[x] ?? "—";
    totals.set(key, (totals.get(key) ?? 0) + (y === null ? 1 : Number(r[y]) || 0));
  }
  const all = [...totals].sort((a, b) => b[1] - a[1]);
  return {
    shown: all.slice(0, MAX_BARS).map(([label, value]) => ({ label, value, tip: `${label} · ${formatNumber(String(Math.round(value * 100) / 100))}` })),
    more: Math.max(0, all.length - MAX_BARS),
    note: totals.size < result.rows.length ? `${y === null ? "rows counted" : "summed"} per ${result.header[x]}` : null,
  };
}

export function scatterPoints(result, x, y) {
  const h = result.header;
  const pts = result.rows.filter((r) => filled(r[x]) && filled(r[y])).map((r) => [Number(r[x]), Number(r[y])]).filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
  if (pts.length === 0) return null;
  const x0 = Math.min(...pts.map((p) => p[0]));
  const x1 = Math.max(...pts.map((p) => p[0]));
  const y0 = Math.min(0, ...pts.map((p) => p[1]));
  const y1 = Math.max(...pts.map((p) => p[1]));
  // 97%, not 100%, so the last dot stays inside the plot.
  const fx = (v) => (x1 === x0 ? 50 : ((v - x0) / (x1 - x0)) * 97);
  const fy = (v) => (y1 === y0 ? 50 : 97 - ((v - y0) / (y1 - y0)) * 97);
  return {
    points: pts.slice(0, 500).map(([a, b]) => ({
      a, b, left: fx(a), top: fy(b), tip: `${h[x]} ${formatNumber(String(a))} · ${h[y]} ${formatNumber(String(b))}`,
    })),
    x0, x1, y0, y1,
  };
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
    return `${compact(Math.min(...nums))} to ${compact(Math.max(...nums))}, average ${compact(avg)}`;
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
  const [top, n] = [...counts].sort((a, b) => b[1] - a[1])[0];
  return n > 1 ? `${top.length > 48 ? `${top.slice(0, 48)}…` : top} (${n} rows)` : "every value different";
}
