import { quoteIdent } from "../postgres/connection.js";

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
