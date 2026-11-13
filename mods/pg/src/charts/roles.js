import { memo } from "../results/cache.js";

// The columns charts can use. Identifiers, code, prose and links are never an axis or a series.
export const rolesOf = (result) => memo(result, "roles", () => {
  const { kinds, prof } = result;
  const all = kinds.map((_k, i) => i);
  const col = (i) => prof.cols[i];
  const nums = all.filter((i) => kinds[i] === "number" && !col(i).idLike);
  const times = all.filter((i) => kinds[i] === "time");
  const labels = all.filter((i) => kinds[i] === "text" && !col(i).idLike && !col(i).code && !col(i).prose && !col(i).url);
  const unique = labels.find((i) => col(i).distinct === col(i).n);
  const label = labels.includes(prof.label) ? prof.label : unique ?? labels[0] ?? -1;
  return { kinds, nums, times, labels, cats: labels.filter((i) => col(i).category), label, rows: result.rows.length };
});
// The columns a chart can run along, its usual one first: the first time column, else the best
// label, else the first of two or more numbers. A number is an x only when another is left to draw.
const labelsFirst = (r) => (r.label >= 0 ? [r.label, ...r.labels.filter((i) => i !== r.label)] : []);
const twoNumbers = (r) => (r.nums.length >= 2 ? r.nums : []);
export const ALONG = {
  label: labelsFirst,
  any: (r) => [...r.times, ...labelsFirst(r), ...twoNumbers(r)],
  continuous: (r) => [...r.times, ...twoNumbers(r)],
  counting: (r) => [...r.labels, ...r.times],
  // A scatter's usual x is the first number that is not its measure.
  numbers: (r, m) => [...r.nums.filter((i) => i !== m), ...r.nums.filter((i) => i === m)],
  none: () => [null],
};
export const axisOf = (r, x) => (x === null ? null : r.kinds[x] === "time" ? "time" : r.kinds[x] === "number" ? "number" : "label");
