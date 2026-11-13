import { CELL_CHARS, SAMPLE } from "./limits.js";
import { highest } from "./numbers.js";

const NUM = /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/;
const TIME = /^\d{4}-\d\d-\d\d([ T]\d\d:\d\d(:\d\d(\.\d+)?)?([+-]\d\d(:?\d\d)?|Z)?)?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID_VALUE = /^(0x)?[0-9a-f]{12,}$|^[0-9a-f]{8}-[0-9a-f]{4}-|^\d{7,}$|^[a-z]+[:_-]\d+$/i;
const SEMANTIC = /^(success|succeeded|ok|done|complete|completed|pass|passed|active|healthy|enabled|yes|fail|failed|failure|error|errored|crashed|dead|rejected|invalid|fatal|running|started|pending|queued|in_progress|building|working|open|closed|warn|warning|skipped|cancelled|canceled|partial|stale|draft|archived|paused)$/i;
const URL_VALUE = /^https?:\/\/\S+$/i;
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
