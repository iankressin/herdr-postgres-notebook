// Run with: cd ~/.config/herdr-app/mods/pg && node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import { CELL_CHARS, barTotals, defaultView, describe, plan, scatterPoints, spread, summarize, timeSeries } from "./shape.js";

const at = (day, hour = 0) => `2026-01-${String(day).padStart(2, "0")} ${String(hour).padStart(2, "0")}:00:00+00`;
const chartOf = (header, rows, measure = null) => {
  const p = plan(describe(header, rows), measure);
  return p && { type: p.type, x: p.x, y: p.y };
};
const sum = (points) => points.reduce((total, p) => total + p.value, 0);

test("plan: a number over a date is a time chart", () => {
  assert.deepEqual(chartOf(["day", "total"], [[at(1), "10"], [at(2), "20"]]), { type: "time", x: 0, y: 1 });
});

test("plan: a number per text label is a bar chart", () => {
  const rows = [["north", "10"], ["south", "20"], ["east", "5"]];
  assert.deepEqual(chartOf(["region", "sales"], rows), { type: "bars", x: 0, y: 1 });
});

test("plan: two numbers are a scatter", () => {
  const rows = [["170", "60"], ["180", "75"], ["165", "58"]];
  assert.deepEqual(chartOf(["height", "weight"], rows), { type: "scatter", x: 0, y: 1 });
});

test("plan: one number is a spread", () => {
  assert.deepEqual(chartOf(["price"], [["3"], ["9"], ["4"]]), { type: "spread", x: 0, y: null });
});

test("plan: text alone counts rows per value", () => {
  assert.deepEqual(chartOf(["status"], [["active"], ["failed"], ["active"]]), { type: "count", x: 0, y: null });
});

test("plan: dates alone count rows over time", () => {
  assert.deepEqual(chartOf(["created_at"], [[at(1)], [at(2)], [at(5)]]), { type: "timecount", x: 0, y: null });
});

test("plan: id columns are never the measure or the axis", () => {
  const rows = [["1", "u_1", "10"], ["2", "u_2", "20"], ["3", "u_3", "5"]];
  assert.deepEqual(chartOf(["id", "user_id", "amount"], rows), { type: "spread", x: 2, y: null });
});

test("plan: a saved measure name picks that column", () => {
  const rows = [[at(1), "5", "100"], [at(2), "8", "140"]];
  assert.equal(chartOf(["day", "visits", "revenue"], rows, "revenue").y, 2);
});

test("plan: an unknown measure name falls back to the first number", () => {
  const rows = [[at(1), "5", "100"], [at(2), "8", "140"]];
  assert.equal(chartOf(["day", "visits", "revenue"], rows, "refunds").y, 1);
});

test("default view: one chartable row shows as a table", () => {
  assert.equal(defaultView(describe(["region", "sales"], [["north", "10"]])), "table");
});

test("default view: several chartable rows show as a chart", () => {
  assert.equal(defaultView(describe(["region", "sales"], [["north", "10"], ["south", "20"]])), "chart");
});

test("default view: a result with nothing to chart shows as a table", () => {
  assert.equal(defaultView(describe(["payload"], [['{"a":1}'], ['{"a":2}']])), "table");
});

test("time: points closer than a fiftieth of the span are summed into 50 slices", () => {
  const rows = [...Array.from({ length: 10 }, (_, h) => [at(1, h), String(h + 1)]), [at(31), "100"]];
  const series = timeSeries(describe(["day", "total"], rows), 0, 1);
  assert.equal(series.points.length, 50);
  assert.equal(sum(series.points), 155);
  assert.equal(series.points[0].value, 55);
  assert.equal(series.points[49].value, 100);
  assert.equal(series.note, "summed in 50 equal time slices");
});

test("time: counting crowded rows says rows, not summed", () => {
  const rows = [...Array.from({ length: 10 }, (_, h) => [at(1, h)]), [at(31)]];
  const series = timeSeries(describe(["created_at"], rows), 0, null);
  assert.equal(sum(series.points), 11);
  assert.equal(series.note, "rows in 50 equal time slices");
});

test("time: well-spaced points keep one bar each in time order, with no note", () => {
  const rows = [[at(3), "9"], [at(1), "5"], [at(2), "7"]];
  const series = timeSeries(describe(["day", "total"], rows), 0, 1);
  assert.deepEqual(series.points.map((p) => p.value), [5, 7, 9]);
  assert.equal(series.note, null);
});

test("bars: repeated labels are summed and sorted largest first", () => {
  const rows = [["a", "1"], ["b", "5"], ["a", "7"], ["c", "2"]];
  const bars = barTotals(describe(["region", "sales"], rows), 0, 1);
  assert.deepEqual(bars.shown.map((b) => [b.label, b.value]), [["a", 8], ["b", 5], ["c", 2]]);
  assert.equal(bars.more, 0);
  assert.equal(bars.note, "summed per region");
});

test("bars: past 16 labels, the smallest are left out and counted", () => {
  const rows = Array.from({ length: 20 }, (_, i) => [`label ${i + 1}`, String(i + 1)]);
  const bars = barTotals(describe(["region", "sales"], rows), 0, 1);
  assert.equal(bars.shown.length, 16);
  assert.equal(bars.shown[0].label, "label 20");
  assert.equal(bars.more, 4);
});

test("spread: 20 ranges count every value", () => {
  const rows = Array.from({ length: 100 }, (_, i) => [String(i + 1)]);
  const histogram = spread(describe(["price"], rows), 0);
  assert.equal(histogram.points.length, 20);
  assert.equal(sum(histogram.points), 100);
  assert.deepEqual(histogram.labels, ["1", "50.5", "100"]);
});

test("spread: a column of one value is a single range", () => {
  const histogram = spread(describe(["n"], [["7"], ["7"], ["7"], ["7"]]), 0);
  assert.deepEqual(histogram.points.map((p) => p.value), [4]);
});

test("summary: a number column gives its range and average", () => {
  assert.deepEqual(summarize(describe(["amount"], [["10"], ["20"], ["30"]]))[0], {
    name: "amount", holds: "numbers", filled: "100%", distinct: "3", range: "10 to 30, average 20",
  });
});

test("summary: a mostly empty column says how full it is", () => {
  assert.equal(summarize(describe(["note"], [["hello"], [null], [null], [""]]))[0].filled, "25%");
});

test("describe: values longer than 600 characters are cut, and null stays null", () => {
  const { rows } = describe(["body"], [["x".repeat(700)], [null], ["short"]]);
  assert.deepEqual(rows.map(([v]) => v), ["x".repeat(CELL_CHARS), null, "short"]);
  assert.equal(CELL_CHARS, 600);
});

test("time: a date column with no clock charts on a time axis", () => {
  const result = describe(["day", "orders"], [["2026-01-01", "3"], ["2026-01-08", "5"], ["2026-01-15", "2"]]);
  assert.equal(plan(result, null).type, "time");
  const series = timeSeries(result, 0, 1);
  assert.deepEqual(series.points.map((p) => p.value), [3, 5, 2]);
  assert.equal(series.span, 14 * 86400000);
});

test("spread and scatter: an empty value is missing, not zero", () => {
  const prices = describe(["price"], [["50"], [null], ["60"], [""]]);
  assert.deepEqual(spread(prices, 0).labels, ["50", "55", "60"]);
  const pairs = describe(["a", "b"], [["1", "2"], [null, "5"], ["3", "4"]]);
  assert.deepEqual(scatterPoints(pairs, 0, 1).points.map((p) => [p.a, p.b]), [[1, 2], [3, 4]]);
});

test("large results: half a million values chart and summarize without overflowing the stack", () => {
  const rows = Array.from({ length: 500000 }, (_, i) => [String(i % 997), String(i)]);
  const result = describe(["a", "b"], rows);
  assert.equal(sum(spread(result, 0).points), 500000);
  assert.equal(scatterPoints(result, 0, 1).x1, 996);
  assert.match(summarize(result)[1].range, /^0 to 500\.0K/);
});
