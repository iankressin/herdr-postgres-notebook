import { compact, formatNumber } from "./format.js";
import { naturalTime, timeMs } from "./time.js";
import { lowest, highest } from "./numbers.js";

const HOLDS = { number: "numbers", time: "dates", bool: "yes or no", json: "JSON" };
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
