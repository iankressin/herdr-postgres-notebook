import { test } from "node:test";
import assert from "node:assert/strict";
import { chartChoices, chartData, defaultView, plan, toggledSeries } from "../../src/charts/plan.js";
import { chartPreparations } from "../../src/charts/prepare.js";
import { describe } from "../../src/results/profile.js";
import { summarize } from "../../src/results/summary.js";
import { yTicks } from "../../src/charts/scale.js";

const at = (day, hour = 0) => `2026-01-${String(day).padStart(2, "0")} ${String(hour).padStart(2, "0")}:00:00+00`;
const hours = (i) => new Date(Date.UTC(2026, 0, 1) + i * 3600000).toISOString().replace("T", " ").replace(".000Z", "+00");
const planOf = (header, rows, choice = {}) => plan(describe(header, rows), choice);
const auto = (header, rows) => {
  const p = planOf(header, rows);
  return p && { type: p.type, axis: p.axis, x: p.x, y: p.y };
};
const drawn = (header, rows, choice = {}) => {
  const result = describe(header, rows);
  const p = plan(result, choice);
  return { p, d: chartData(result, p) };
};
// A column chart's value at each point: the top of its single mark, or 0 when it has none.
const columnValues = (d) => d.points.map((pt) => pt.marks.reduce((v, m) => v + m.to - m.from, 0));
const sum = (values) => values.reduce((a, b) => a + b, 0);

test("automatic: a number over a date is columns on a time axis", () => {
  assert.deepEqual(auto(["day", "total"], [[at(1), "10"], [at(2), "20"]]), { type: "columns", axis: "time", x: 0, y: 1 });
});

test("automatic: a number per text label is bars", () => {
  const rows = [["north", "10"], ["south", "20"], ["east", "5"]];
  assert.deepEqual(auto(["region", "sales"], rows), { type: "bars", axis: "label", x: 0, y: 1 });
});

test("automatic: two numbers are a scatter of the second against the first", () => {
  const rows = [["170", "60"], ["180", "75"], ["165", "58"]];
  assert.deepEqual(auto(["height", "weight"], rows), { type: "scatter", axis: "number", x: 0, y: 1 });
});

test("automatic: one number is a histogram", () => {
  assert.deepEqual(auto(["price"], [["3"], ["9"], ["4"]]), { type: "histogram", axis: null, x: null, y: 0 });
});

test("automatic: text alone counts rows per value", () => {
  assert.deepEqual(auto(["status"], [["active"], ["failed"], ["active"]]), { type: "count", axis: "label", x: 0, y: null });
});

test("automatic: dates alone count rows over time", () => {
  assert.deepEqual(auto(["created_at"], [[at(1)], [at(2)], [at(5)]]), { type: "count", axis: "time", x: 0, y: null });
});

test("automatic: one row with numbers is big numbers, and still opens as a table", () => {
  const header = ["region", "orders", "revenue"];
  const rows = [["north", "12", "1500.5"]];
  assert.equal(planOf(header, rows).type, "tiles");
  assert.equal(defaultView(describe(header, rows)), "table");
  const { d } = drawn(header, rows);
  assert.deepEqual(d.tiles, [{ name: "Orders", value: "12" }, { name: "Revenue", value: "1,500.5" }]);
});

test("automatic: id columns are never the measure or the axis", () => {
  const rows = [["1", "u_1", "10"], ["2", "u_2", "20"], ["3", "u_3", "5"]];
  assert.deepEqual(auto(["id", "user_id", "amount"], rows), { type: "histogram", axis: null, x: null, y: 2 });
});

test("measure: a saved name picks that column, an unknown one falls back to the first number", () => {
  const rows = [[at(1), "5", "100"], [at(2), "8", "140"]];
  assert.equal(planOf(["day", "visits", "revenue"], rows, { measure: "revenue" }).y, 2);
  assert.equal(planOf(["day", "visits", "revenue"], rows, { measure: "refunds" }).y, 1);
});

test("default view: several chartable rows show as a chart, nothing to chart shows as a table", () => {
  assert.equal(defaultView(describe(["region", "sales"], [["north", "10"], ["south", "20"]])), "chart");
  assert.equal(defaultView(describe(["payload"], [['{"a":1}'], ['{"a":2}']])), "table");
});

// Small results shaped for each chart, and which charts each one offers.
const SHAPES = {
  labelOne: [["region", "sales"], [["north", "10"], ["south", "20"], ["east", "5"]]],
  labelTwo: [["region", "sales", "cost"], [["north", "10", "4"], ["south", "20", "9"], ["east", "5", "1"]]],
  threeNumbers: [["a", "b", "c"], [["1", "2", "3"], ["4", "5", "6"], ["7", "8", "9"]]],
  timeOne: [["day", "total"], [[at(1), "10"], [at(2), "20"]]],
  oneRow: [["region", "sales"], [["north", "10"]]],
  timeOnly: [["created_at"], [[at(1)], [at(2)]]],
  numbersOnly: [["a", "b"], [["1", "2"], ["3", "4"]]],
};
const choicesOf = (shape) => chartChoices(describe(...SHAPES[shape]));

test("choices: a label and one number", () => {
  assert.deepEqual(choicesOf("labelOne"), ["bars", "columns", "line", "area", "step", "histogram", "count"]);
});

test("choices: a label and two numbers add the many-number charts and the table with bars", () => {
  assert.deepEqual(choicesOf("labelTwo"), ["bars", "columns", "stacked", "grouped", "share", "line", "area", "step", "total", "scatter", "histogram", "count", "bartable"]);
});

test("choices: bubbles need three numbers, and a running total a time or number axis", () => {
  assert.ok(choicesOf("threeNumbers").includes("bubbles"));
  assert.ok(!choicesOf("labelTwo").includes("bubbles"));
  assert.ok(choicesOf("timeOne").includes("total"));
  assert.ok(choicesOf("threeNumbers").includes("total"), "the first number is the x");
  assert.ok(choicesOf("labelTwo").includes("total"), "along a number, even beside a label");
  assert.ok(!choicesOf("labelOne").includes("total"), "one number cannot be both the x and the value");
});

test("y axis: values crossing zero label the zero line instead of the midpoint", () => {
  assert.deepEqual(yTicks(-610, 510, 220).map((t) => [t.value, Math.round(t.top)]), [[510, 0], [0, 100], [-610, 220]]);
  assert.deepEqual(yTicks(0, 40, 220).map((t) => [t.value, t.top]), [[40, 0], [20, 110], [0, 220]], "no negatives: top, middle, bottom");
  assert.deepEqual(yTicks(-1, 400, 220).map((t) => t.value), [400, -1], "a zero next to an end is left to the gridline");
});

const MIXED = [["day", "region", "sales", "cost"], [[at(1), "north", "10", "4"], [at(2), "south", "20", "9"], [at(3), "north", "5", "1"]]];

test("x: a chosen column the chart can run along is its x, with that column's kind of axis", () => {
  const along = (choice) => {
    const p = planOf(...MIXED, choice);
    return { type: p.type, axis: p.axis, x: p.x, y: p.y };
  };
  assert.deepEqual(along({ chart: "columns" }), { type: "columns", axis: "time", x: 0, y: 2 });
  assert.deepEqual(along({ chart: "columns", x: "region" }), { type: "columns", axis: "label", x: 1, y: 2 });
  assert.deepEqual(along({ chart: "columns", x: "sales" }), { type: "columns", axis: "number", x: 2, y: 3 }, "a number as x is no longer a value");
  assert.deepEqual(along({ chart: "bars", x: "day" }), { type: "bars", axis: "label", x: 1, y: 2 }, "bars run along labels only");
  assert.deepEqual(along({ chart: "columns", x: "refunds" }), { type: "columns", axis: "time", x: 0, y: 2 }, "an unknown name falls back");
  assert.deepEqual(along({ x: "region" }), { type: "columns", axis: "label", x: 1, y: 2 }, "Automatic uses it too");
});

test("x: each chart lists the columns it can run along, its usual one first", () => {
  assert.deepEqual(planOf(...MIXED, { chart: "columns" }).xs, [0, 1, 2, 3]);
  assert.deepEqual(planOf(...MIXED, { chart: "bars" }).xs, [1]);
  assert.deepEqual(planOf(...MIXED, { chart: "total" }).xs, [0, 2, 3]);
  assert.deepEqual(planOf(...MIXED, { chart: "count" }).xs, [1, 0]);
  assert.deepEqual(planOf(...MIXED, { chart: "histogram" }).xs, []);
});

test("x: columns along a chosen label sum each label's rows, in first-seen order", () => {
  const { d } = drawn(...MIXED, { chart: "columns", x: "region" });
  assert.deepEqual(d.points.map((pt) => pt.label), ["north", "south"]);
  assert.deepEqual(columnValues(d), [15, 20]);
});

test("x: a scatter runs against the chosen number, and its measure is one of the others", () => {
  const scatter = (choice) => {
    const p = planOf(...SHAPES.threeNumbers, { chart: "scatter", ...choice });
    return [p.x, p.y, p.against];
  };
  assert.deepEqual(scatter({}), [0, 1, true]);
  assert.deepEqual(scatter({ x: "c" }), [2, 0, true]);
  assert.deepEqual(scatter({ x: "c", measure: "b" }), [2, 1, true]);
  assert.deepEqual(scatter({ x: "b", measure: "b" }), [1, 0, true], "the x cannot also be the measure");
  assert.deepEqual(scatter({ measure: "a" }), [1, 0, true], "with no x saved, the measure's column is never the x");
});

test("x: count runs along a chosen time column instead of the label", () => {
  const p = planOf(...MIXED, { chart: "count", x: "day" });
  assert.deepEqual([p.axis, p.x], ["time", 0]);
});

test("choices: stacked, grouped and 100% bars need two numbers besides the x", () => {
  for (const key of ["stacked", "grouped", "share"]) assert.ok(!choicesOf("labelOne").includes(key), key);
  for (const key of ["stacked", "grouped"]) assert.ok(!choicesOf("numbersOnly").includes(key), `${key}: one number is the x`);
});

test("choices: big numbers only for exactly one row", () => {
  assert.ok(choicesOf("oneRow").includes("tiles"));
  assert.ok(!choicesOf("labelOne").includes("tiles"));
});

test("choices: count needs a label or a time column", () => {
  assert.deepEqual(choicesOf("timeOnly"), ["count"]);
  assert.ok(!choicesOf("numbersOnly").includes("count"));
});

test("refused: a saved chart that no longer fits falls back to Automatic and says which", () => {
  const p = planOf(...SHAPES.labelOne, { chart: "bubbles" });
  assert.deepEqual([p.type, p.auto, p.refused], ["bars", true, "bubbles"]);
  const unknown = planOf(...SHAPES.labelOne, { chart: "constructor" });
  assert.deepEqual([unknown.type, unknown.auto, unknown.refused], ["bars", true, null]);
  const kept = planOf(...SHAPES.labelOne, { chart: "line" });
  assert.deepEqual([kept.type, kept.auto, kept.refused], ["line", false, null]);
});

// Seven numbers over time, so series can be picked, reordered and capped.
const SEVEN = ["n1", "n2", "n3", "n4", "n5", "n6", "n7"];
const sevenRows = (order = SEVEN) => [0, 1, 2].map((i) => [at(i + 1), ...order.map((_n, k) => String(i + k))]);
const seriesNames = (header, p) => p.series.map((i) => header[i]);

test("series: chosen by name, in column order, and the same names after the columns move", () => {
  const header = ["day", ...SEVEN];
  const p = planOf(header, sevenRows(), { chart: "line", series: ["n3", "n1"] });
  assert.deepEqual(seriesNames(header, p), ["n1", "n3"]);
  const moved = ["day", ...[...SEVEN].reverse()];
  const q = planOf(moved, sevenRows(moved.slice(1)), { chart: "line", series: ["n3", "n1"] });
  assert.deepEqual(seriesNames(moved, q), ["n3", "n1"]);
});

test("series: unknown names are ignored, and none known means the first four", () => {
  const header = ["day", ...SEVEN];
  assert.deepEqual(seriesNames(header, planOf(header, sevenRows(), { chart: "line", series: ["gone", "n5"] })), ["n5"]);
  assert.deepEqual(seriesNames(header, planOf(header, sevenRows(), { chart: "line", series: ["gone"] })), ["n1", "n2", "n3", "n4"]);
  assert.deepEqual(seriesNames(header, planOf(header, sevenRows(), { chart: "line", series: null })), ["n1", "n2", "n3", "n4"]);
});

test("series: a series keeps its color when another is turned off", () => {
  const header = ["day", ...SEVEN];
  const result = describe(header, sevenRows());
  const before = plan(result, { chart: "line", series: ["n1", "n2", "n3"] });
  const names = toggledSeries(result, { chart: "line", series: ["n1", "n2", "n3"] }, "n2");
  assert.deepEqual(names, ["n1", "n3"]);
  const after = plan(result, { chart: "line", series: names });
  assert.deepEqual(before.colors, [0, 1, 2]);
  assert.deepEqual(after.colors, [0, 2]);
});

test("series: the last one stays on, a seventh is refused, and past the sixth colors never repeat", () => {
  const header = ["day", ...SEVEN];
  const result = describe(header, sevenRows());
  assert.equal(toggledSeries(result, { chart: "line", series: ["n4"] }, "n4"), null);
  const six = SEVEN.slice(0, 6);
  assert.equal(toggledSeries(result, { chart: "line", series: six }, "n7"), null);
  assert.deepEqual(toggledSeries(result, { chart: "line" }, "n6"), ["n1", "n2", "n3", "n4", "n6"], "starts from the default four");
  const late = plan(result, { chart: "line", series: ["n1", "n7"] });
  assert.deepEqual(late.colors, [0, 1]);
});

test("stacked: values are summed per x, positives stack up and negatives down from zero", () => {
  const rows = [["n", "5", "-2"], ["s", "3", "4"], ["n", "1", "0"]];
  const { d } = drawn(["region", "a", "b"], rows, { chart: "stacked" });
  assert.deepEqual(d.points.map((pt) => pt.label), ["n", "s"]);
  assert.deepEqual(d.points.map((pt) => pt.marks.map((m) => [m.from, m.to])), [[[0, 6], [0, -2]], [[0, 3], [3, 7]]]);
  assert.deepEqual([d.lo, d.hi], [-2, 7]);
  assert.deepEqual(d.points[1].marks.map((m) => [m.inner, m.outer]), [[false, false], [true, true]], "only the stack's end is rounded");
});

test("grouped: each series stands from zero, side by side", () => {
  const { d } = drawn(["region", "a", "b"], [["n", "5", "-2"], ["s", "3", "4"]], { chart: "grouped" });
  assert.deepEqual(d.points.map((pt) => pt.marks.map((m) => [m.series, m.from, m.to])), [[[0, 0, 5], [1, 0, -2]], [[0, 0, 3], [1, 0, 4]]]);
  assert.equal(d.slotCount, 2);
});

test("100% bars: each row's shares add up to 100, negatives count as nothing", () => {
  const rows = [["n", "1", "3"], ["s", "2", "2"], ["e", "5", "-1"]];
  const { d } = drawn(["region", "a", "b"], rows, { chart: "share" });
  assert.deepEqual(d.rows.map((r) => r.label), ["e", "n", "s"], "largest total first, ties in order of first appearance");
  assert.deepEqual(d.rows.map((r) => r.parts.map((part) => part.share)), [[100], [25, 75], [50, 50]]);
  for (const row of d.rows) assert.equal(sum(row.parts.map((part) => part.share)), 100);
});

test("running total: climbs through every point and ends at the column total", () => {
  const rows = Array.from({ length: 300 }, (_v, i) => [hours(i), String(i % 7)]);
  const { d } = drawn(["at", "v"], rows, { chart: "total" });
  const values = d.series[0].values;
  assert.equal(values.at(-1), sum(rows.map((r) => Number(r[1]))));
  assert.ok(values.every((v, k) => k === 0 || v >= values[k - 1]));
  assert.equal(d.note, "summed in 240 time slices");
});

// 481 hourly points over 480 hours: 240 slices of two points each, the last slice three.
const slicedRows = (value) => Array.from({ length: 481 }, (_v, i) => [hours(i), String(value(i))]);

test("line: past 240 points, each time slice is the average of its points", () => {
  const { d } = drawn(["at", "v"], slicedRows((i) => (i % 2 ? 10 : 0)), { chart: "line" });
  assert.equal(d.points.length, 240);
  assert.ok(d.series[0].values.slice(0, 239).every((v) => v === 5));
  assert.equal(d.series[0].values[239], 10 / 3);
  assert.equal(d.note, "averaged in 240 time slices");
});

test("step: past 240 points, each time slice keeps its last value", () => {
  const { d } = drawn(["at", "v"], slicedRows((i) => i), { chart: "step" });
  assert.deepEqual(d.series[0].values.slice(0, 3), [1, 3, 5]);
  assert.equal(d.series[0].values[239], 480);
  assert.equal(d.step, true);
});

test("columns: points closer than a fiftieth of the span are summed into 50 slices", () => {
  const rows = [...Array.from({ length: 10 }, (_v, h) => [at(1, h), String(h + 1)]), [at(31), "100"]];
  const { d } = drawn(["day", "total"], rows);
  const values = columnValues(d);
  assert.equal(values.length, 50);
  assert.equal(sum(values), 155);
  assert.equal(values[0], 55);
  assert.equal(values[49], 100);
  assert.equal(d.note, "summed in 50 equal time slices");
});

test("columns: evenly spaced points are summed a whole number at a time, so no column holds an extra one", () => {
  const rows = Array.from({ length: 73 }, (_v, i) => [String(-60 + 5 * i), "1"]);
  const { d } = drawn(["minute", "fills"], rows, { chart: "columns" });
  const values = columnValues(d);
  assert.equal(values.length, 37);
  assert.ok(values.slice(0, 36).every((v) => v === 2));
  assert.equal(values[36], 1);
  assert.deepEqual(d.points.slice(0, 2).map((pt) => pt.label), ["-60", "-50"]);
  assert.equal(d.note, "summed in 37 equal slices");
});

test("count over time: crowded rows say rows, not summed", () => {
  const rows = [...Array.from({ length: 10 }, (_v, h) => [at(1, h)]), [at(31)]];
  const { d } = drawn(["created_at"], rows);
  assert.equal(sum(columnValues(d)), 11);
  assert.equal(d.note, "rows in 50 equal time slices");
});

test("columns: well-spaced times keep one column each, in time order, with no note", () => {
  const { d } = drawn(["day", "total"], [[at(3), "9"], [at(1), "5"], [at(2), "7"]]);
  assert.deepEqual(columnValues(d), [5, 7, 9]);
  assert.deepEqual(d.points.map((pt) => pt.x), [0, 0.5, 1]);
  assert.equal(d.note, null);
});

test("columns: a date column with no clock stands on a time axis", () => {
  const { p, d } = drawn(["day", "orders"], [["2026-01-01", "3"], ["2026-01-08", "5"], ["2026-01-15", "2"]]);
  assert.equal(p.axis, "time");
  assert.deepEqual(columnValues(d), [3, 5, 2]);
});

test("columns: shuffled and reversed rows give the same columns as ordered ones", () => {
  const ordered = Array.from({ length: 40 }, (_v, i) => [hours(i * 24), String(i * 3 - 50)]);
  const shuffled = ordered.map((_r, i) => ordered[(i * 17) % 40]);
  const expected = columnValues(drawn(["at", "v"], ordered).d);
  assert.deepEqual(columnValues(drawn(["at", "v"], shuffled).d), expected);
  assert.deepEqual(columnValues(drawn(["at", "v"], [...ordered].reverse()).d), expected);
});

test("columns: on a number axis, equal values written differently are one column", () => {
  const { p, d } = drawn(["x", "y"], [["2", "10"], ["1", "5"], ["1.0", "7"], ["3", "1"]], { chart: "columns" });
  assert.equal(p.axis, "number");
  assert.deepEqual(columnValues(d), [12, 10, 1]);
});

test("line: unordered values bunched close together each keep their own point", () => {
  const rows = [["2", "10"], ["1", "5"], ["1000", "1"], ["3", "4"], ["1.0", "7"]];
  const { p, d } = drawn(["x", "y"], rows, { chart: "line" });
  assert.equal(p.axis, "number");
  assert.deepEqual(d.points.map((pt) => pt.label), ["1", "2", "3", "1,000"]);
  assert.deepEqual(d.series[0].values, [12, 10, 4, 1]);
});

test("columns: on a label axis, labels keep the order they first appear in and repeats are summed", () => {
  const { d } = drawn(["region", "sales"], [["b", "1"], ["a", "2"], ["b", "3"], ["c", "-4"]], { chart: "columns" });
  assert.deepEqual(d.points.map((pt) => pt.label), ["b", "a", "c"]);
  assert.deepEqual(columnValues(d), [4, 2, -4]);
  assert.equal(d.signed, true);
  assert.equal(d.note, "summed per region");
});

test("columns: a label axis shows its first 60 labels and counts the rest", () => {
  const rows = Array.from({ length: 75 }, (_v, i) => [`label ${i + 1}`, String(i)]);
  const { d } = drawn(["region", "sales"], rows, { chart: "columns" });
  assert.equal(d.points.length, 60);
  assert.equal(d.points.at(-1).label, "label 60");
  assert.equal(d.more, 15);
});

test("bars: repeated labels are summed and sorted largest first", () => {
  const { d } = drawn(["region", "sales"], [["a", "1"], ["b", "5"], ["a", "7"], ["c", "2"]]);
  assert.deepEqual(d.shown.map((b) => [b.label, b.value]), [["a", 8], ["b", 5], ["c", 2]]);
  assert.equal(d.more, 0);
  assert.equal(d.note, "summed per region");
});

test("bars: past 16 labels, the ones furthest from zero are kept, largest first", () => {
  const rows = Array.from({ length: 20 }, (_v, i) => [`label ${i + 1}`, String(i + 1)]);
  rows.push(["loss", "-30"], ["dip", "-25"]);
  const { d } = drawn(["region", "sales"], rows);
  assert.equal(d.shown.length, 16);
  assert.deepEqual(d.shown.map((b) => b.value), [20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, -25, -30]);
  assert.equal(d.more, 6);
  assert.equal(d.signed, true);
});

test("histogram: 20 ranges count every value, and an empty value is missing, not zero", () => {
  const { d } = drawn(["price"], Array.from({ length: 100 }, (_v, i) => [String(i + 1)]));
  assert.equal(d.points.length, 20);
  assert.equal(sum(columnValues(d)), 100);
  assert.deepEqual(d.ticks, ["1", "50.5", "100"]);
  assert.deepEqual(drawn(["price"], [["50"], [null], ["60"], [""]]).d.ticks, ["50", "55", "60"]);
  assert.deepEqual(columnValues(drawn(["n"], [["7"], ["7"], ["7"], ["7"]]).d), [4]);
});

test("scatter: an empty value is missing, not zero", () => {
  const { d } = drawn(["a", "b"], [["1", "2"], [null, "5"], ["3", "4"]]);
  assert.deepEqual(d.points.map((pt) => pt.tip), ["a 1 · b 2", "a 3 · b 4"]);
});

test("bubbles: x is the first other number, size the first number that is neither", () => {
  const header = ["a", "b", "c", "d"];
  const rows = [["1", "2", "3", "4"], ["5", "6", "7", "8"], ["9", "1", "2", "3"]];
  const picked = planOf(header, rows, { chart: "bubbles", measure: "a" });
  assert.deepEqual([picked.y, picked.x, picked.size], [0, 1, 2]);
  const usual = planOf(header, rows, { chart: "bubbles" });
  assert.deepEqual([usual.y, usual.x, usual.size], [1, 0, 2]);
  const { d } = drawn(header, rows, { chart: "bubbles", measure: "d" });
  assert.deepEqual(d.points.map((pt) => pt.diameter), [2 * (4 + 8 * Math.sqrt(2 / 6)), 2 * (4 + 8), 2 * (4 + 8 * Math.sqrt(1 / 6))], "sized by b, the largest b being 6");
});

test("scatter: dots take their category's color by row count, past three they share Other", () => {
  const kinds = { apple: 5, pear: 4, plum: 3, fig: 2, kiwi: 1 };
  const rows = Object.entries(kinds).flatMap(([kind, n]) => Array.from({ length: n }, (_v, i) => [kind, String(i), String(n)]));
  const { p, d } = drawn(["fruit", "size", "weight"], rows, { chart: "scatter" });
  assert.equal(p.group, 0);
  assert.deepEqual(d.legend, [{ name: "apple", color: 0 }, { name: "pear", color: 1 }, { name: "plum", color: 2 }, { name: "Other", color: -1 }]);
  const colorOf = Object.fromEntries(rows.map((r, k) => [r[0], d.points[k].color]));
  assert.deepEqual(colorOf, { apple: 0, pear: 1, plum: 2, fig: -1, kiwi: -1 });
});

test("table with bars: the largest measures, the other numbers beside them", () => {
  const rows = [["n", "5", "1", "10"], ["s", "-8", "2", "20"], ["e", "2", "3", "30"]];
  const { d } = drawn(["region", "change", "orders", "sales"], rows, { chart: "bartable" });
  assert.deepEqual(d.head, { label: "region", others: ["orders", "sales"], measure: "change" });
  assert.deepEqual(d.rows.map((r) => [r.label, r.value, ...r.others]), [["n", 5, "1", "10"], ["e", 2, "3", "30"], ["s", -8, "2", "20"]]);
  assert.equal(d.signed, true);
});

test("large results: half a million values chart and summarize without overflowing the stack", () => {
  const rows = Array.from({ length: 500000 }, (_v, i) => [String(i % 997), String(i)]);
  const result = describe(["a", "b"], rows);
  const histogram = chartData(result, plan(result, { chart: "histogram", measure: "a" }));
  assert.equal(sum(columnValues(histogram)), 500000);
  assert.equal(chartData(result, plan(result)).x1, 996);
  assert.match(summarize(result)[1].range, /^0 to 500\.0K/);
});

// Herdr's engine is many times slower than node, so these limits leave it room: a preparation
// step must finish in Herdr within half a second, and a chart drawn inline within 50 ms. Each
// step and chart is timed on three fresh copies of the result and judged by its fastest, so a
// pause to collect garbage does not fail the test.
test("speed: 50,000 rows prepare in short steps, and every chart is quick to work out after", () => {
  const sources = ["web", "app", "api", "cli", "bot"];
  const rows = Array.from({ length: 50000 }, (_v, i) => {
    const k = (i * 7919) % 50000;
    return [hours(k), `item number ${k}`, sources[i % 5], String((i * 31) % 1000 - 300), String((i % 97) + 0.5)];
  });
  const timed = (work) => {
    const start = performance.now();
    work();
    return performance.now() - start;
  };
  const fastest = (runs) => runs[0].map((_v, k) => Math.min(...runs.map((run) => run[k])));
  const report = [];
  for (const header of [["at", "name", "source", "change", "price"], ["x", "name", "source", "change", "price"]]) {
    const copy = header[0] === "at" ? rows : rows.map(([_t, ...rest], i) => [String(i), ...rest]);
    const results = [0, 1, 2].map(() => describe(header, copy));
    const steps = fastest(results.map((result) => chartPreparations(result).map(timed)));
    const keys = chartChoices(results[0]);
    const charts = fastest(results.map((result) => keys.map((key) => {
      const p = plan(result, { chart: key });
      return timed(() => assert.ok(chartData(result, p), `${key} draws something`));
    })));
    report.push(`${header[0]}: ${steps.length} steps, slowest ${Math.max(...steps).toFixed(1)} ms`, ...keys.map((key, k) => `${key} ${charts[k].toFixed(2)}`));
    assert.ok(Math.max(...steps) < 100, `a preparation step took ${Math.max(...steps).toFixed(1)} ms`);
    keys.forEach((key, k) => assert.ok(charts[k] < 10, `${key} took ${charts[k].toFixed(1)} ms`));
  }
  console.log(report.join(" · "));
});
