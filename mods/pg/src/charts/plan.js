import { words } from "../results/format.js";
import { memo, hasMemo } from "../results/cache.js";
import { MAX_SERIES, DEFAULT_SERIES, MAX_TILES } from "./constants.js";
import { ALONG, axisOf, rolesOf } from "./roles.js";
import { sumsOf } from "./prepare.js";
import { MEAN, LAST, TOTAL, columnsData, lineData, barsData, countData, shareData, barTableData, dotsData, histogramData, tilesData } from "./data.js";

const lower = (h, i) => words(h[i]).toLowerCase();
function namesOf(h, cols) {
  const names = cols.map((i, k) => (k === 0 ? words(h[i]) : lower(h, i)));
  if (names.length > 3) return `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`;
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0];
}
const byX = (p, h) => `${namesOf(h, p.series)} by ${lower(h, p.x)}`;

// Every chart a person can pick, in the picker's order. `numbers` says what the chips under the
// picker choose: one measure, many series, or none. `along` lists the columns it can run along,
// `need` is how many numbers it needs besides the x, `pick` settles columns that depend on the
// measure.
export const CHARTS = [
  { key: "bars", name: "Bars", numbers: "one", along: ALONG.label, need: 1, title: byX, data: (res, p) => barsData(res, p, sumsOf(res, p.x, p.y).sum) },
  { key: "columns", name: "Columns", numbers: "one", along: ALONG.any, need: 1, title: byX, data: (res, p) => columnsData(res, p, "plain") },
  { key: "stacked", name: "Stacked columns", numbers: "many", along: ALONG.any, need: 2, title: byX, data: (res, p) => columnsData(res, p, "stacked") },
  { key: "grouped", name: "Grouped columns", numbers: "many", along: ALONG.any, need: 2, title: byX, data: (res, p) => columnsData(res, p, "grouped") },
  { key: "share", name: "100% bars", numbers: "many", along: ALONG.label, need: 2, title: (p, h) => `Share of ${namesOf(h, p.series).toLowerCase()} by ${lower(h, p.x)}`, data: shareData },
  { key: "line", name: "Line", numbers: "many", along: ALONG.any, need: 1, title: byX, data: (res, p) => lineData(res, p, MEAN) },
  { key: "area", name: "Area", numbers: "one", along: ALONG.any, need: 1, title: byX, data: (res, p) => lineData(res, p, MEAN) },
  { key: "step", name: "Step", numbers: "many", along: ALONG.any, need: 1, title: byX, data: (res, p) => lineData(res, p, LAST) },
  { key: "total", name: "Running total", numbers: "one", along: ALONG.continuous, need: 1, title: (p, h) => `Running total of ${lower(h, p.y)} by ${lower(h, p.x)}`, data: (res, p) => lineData(res, p, TOTAL) },
  {
    key: "scatter", name: "Scatter", numbers: "one", along: ALONG.numbers, need: 1, against: true,
    pick: (p, r) => ({ ...p, group: r.cats[0] ?? null }),
    title: (p, h) => `${words(h[p.y])} against ${lower(h, p.x)}`, data: dotsData,
  },
  {
    key: "bubbles", name: "Bubbles", numbers: "one", along: ALONG.numbers, need: 2, against: true,
    pick: (p, r) => ({ ...p, size: p.options.find((i) => i !== p.y), group: r.cats[0] ?? null }),
    title: (p, h) => `${words(h[p.y])} against ${lower(h, p.x)}, sized by ${lower(h, p.size)}`, data: dotsData,
  },
  { key: "histogram", name: "Histogram", numbers: "one", along: ALONG.none, need: 1, title: (p, h) => `Spread of ${lower(h, p.y)}`, data: histogramData },
  { key: "count", name: "Count", numbers: "none", along: ALONG.counting, need: 0, title: (p, h) => `Rows by ${lower(h, p.x)}`, data: countData },
  {
    key: "tiles", name: "Big numbers", numbers: "none", along: (r) => (r.rows === 1 ? [null] : []), need: 1,
    pick: (p) => ({ ...p, series: p.options.slice(0, MAX_TILES) }), title: () => null, data: tilesData,
  },
  { key: "bartable", name: "Table with bars", numbers: "one", along: ALONG.label, need: 2, title: byX, data: barTableData },
];
const CHART = new Map(CHARTS.map((c) => [c.key, c]));

// What Automatic picks: the first chart here that fits and meets its condition.
const AUTO = [["tiles"], ["columns", (r) => r.times.length > 0], ["bars"], ["scatter"], ["histogram"], ["count"]];

// The saved x and measure as column indexes, -1 when unset or gone.
const wanted = (result, choice) => ({ want: result.header.indexOf(choice?.x ?? null), m: result.header.indexOf(choice?.measure ?? null) });

// Where a chart runs along: the chosen column when the chart can use it, else its usual one. The
// numbers left over are what it can draw.
function placeOf(chart, r, want, m) {
  const xs = chart.along(r, m);
  if (xs.length === 0) return null;
  const x = xs.includes(want) ? want : xs[0];
  return { xs, x, options: r.nums.filter((i) => i !== x) };
}

function fits(chart, r, want, m) {
  const place = placeOf(chart, r, want, m);
  return place !== null && place.options.length >= chart.need;
}

export const chartChoices = (result, choice = {}) => {
  const r = rolesOf(result);
  const { want, m } = wanted(result, choice);
  return CHARTS.filter((c) => fits(c, r, want, m)).map((c) => c.key);
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
// Automatic), `x`, `measure` (column names) and `series` (column names). A saved chart that does
// not fit falls back to Automatic and is named in `refused`. `xs` are the columns it could run
// along instead, `against` says the x is a second number rather than what the values are by.
export function plan(result, choice = {}) {
  const r = rolesOf(result);
  const { want, m } = wanted(result, choice);
  const asked = CHART.get(choice?.chart) ?? null;
  const chart = asked && fits(asked, r, want, m) ? asked : automatic(r, want, m);
  if (!chart) return null;
  const { xs, x, options } = placeOf(chart, r, want, m);
  const h = result.header;
  let p = { type: chart.key, numbers: chart.numbers, auto: chart !== asked, refused: asked && chart !== asked ? asked.key : null,
    axis: axisOf(r, x), x, xs: xs.filter((i) => i !== null), against: Boolean(chart.against),
    y: null, series: [], colors: [], size: null, group: null, options };
  if (chart.numbers === "one") {
    p.y = options.includes(m) ? m : options[0];
    p.series = [p.y];
  }
  if (chart.numbers === "many") p.series = chosenSeries(h, options, choice?.series);
  if (chart.pick) p = chart.pick(p, r);
  p.colors = chart.numbers === "many" ? colorsOf(p.series, options) : p.series.map(() => 0);
  return p;
}

function automatic(r, want, m) {
  for (const [key, when] of AUTO) {
    const chart = CHART.get(key);
    if (fits(chart, r, want, m) && (!when || when(r))) return chart;
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
export const chartDrawn = (result, p) => hasMemo(result, chartKey(p));
