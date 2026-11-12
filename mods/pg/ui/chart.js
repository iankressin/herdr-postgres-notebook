// A query's result as a chart, under a row that picks the chart and its numbers. Which chart, and
// every value it draws, comes from shape.js; this file only draws. DRAW has one drawer per key
// of CHARTS.
import { Background, PathBuilder, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { MAX_SERIES, chartChoices, chartData, chartDrawn, chartName, chartTitle, compact, formatNumber, plan, words } from "../shape.js";
import { alpha, icon, mono } from "./kit.js";

const H = 220;
// A series' color is its place in this list. Scatter groups use the first three.
const PALETTE = ["ansi4", "ansi3", "ansi5", "ansi6", "ansi2", "ansi1"];
// A chart whose rows times series pass this is worked out on the view's worker, not while
// drawing: Herdr interrupts a render that runs past about 50 ms, the rest of the page needs its
// share, and a line over 240 rows took 14 to 24 ms to work out and draw there.
const INLINE_WORK = 120;
const LINES = new Set(["line", "area", "step", "total"]);

const colorOf = (slot, t) => (slot >= 0 ? t[PALETTE[slot]] : t.dim);
const pct = (f) => `${(f * 100).toFixed(3)}%`;
const quiet = (text, t) => div().py(24).text_size(13).text_color(t.muted).child(text);

function yAxis(lo, hi, t) {
  return v_flex().w(52).flex_none().h(H).justify_between().items_end().pr(8).text_size(11).font_family(mono()).text_color(t.dim)
    .child(div().child(compact(hi))).child(div().child(compact((hi + lo) / 2))).child(div().child(compact(lo)));
}

// Hairlines at the top, middle and bottom, and a stronger one at zero when the values cross it.
function grid(lo, hi, t) {
  const lines = [0, 0.5, 1].map((f) => div().absolute().left(0).right(0).top(Math.round(f * (H - 1))).h(1).bg(alpha(t.foreground, 0.07)));
  if (lo < 0 && hi > 0) lines.push(div().absolute().left(0).right(0).top(Math.round((hi / (hi - lo)) * (H - 1))).h(1).bg(alpha(t.foreground, 0.2)));
  return lines;
}

function xLabels(d, t) {
  const row = h_flex().pl(52).text_size(11).text_color(t.dim);
  if (d.each) return row.gap(2).children(d.ticks.map((label) => div().flex_1().min_w(0).text_center().truncate().child(label)));
  return row.justify_between().children(d.ticks.map((label) => div().child(label)));
}

function legend(items, t) {
  return h_flex().flex_wrap().gap(14).children(items.map((item) => h_flex().gap(6).items_center()
    .child(div().size(10).flex_none().rounded(3).bg(colorOf(item.color, t)))
    .child(div().text_size(12).text_color(t.muted).child(item.name))));
}

const moreLine = (n, t, smaller = false) => div().pt(4).text_size(12).text_color(t.dim).child(`and ${formatNumber(String(n))} more${smaller ? ", smaller" : ""}`);

// One series is one color, accent on hover; with a negative value, gains and losses differ.
function markColor(d, m, t) {
  if (d.signed) return m.to < m.from ? t.ansi1 : t.ansi2;
  return colorOf(m.color, t);
}

// A column from `from` to `to`, square where it starts and rounded at its outer end. A segment
// stacked on another leaves 2px between them.
function columnMark(id, m, d, t, single) {
  const y = (v) => ((d.hi - v) / (d.hi - d.lo || 1)) * H;
  const up = m.to > m.from;
  let top = y(Math.max(m.from, m.to));
  let bottom = y(Math.min(m.from, m.to));
  if (m.inner && up) bottom -= 2;
  if (m.inner && !up) top += 2;
  const height = Math.max(m.outer ? 2 : 1, Math.round(bottom - top));
  return div().id(id).absolute().left(0).right(0).top(Math.round(up ? bottom - height : top)).h(height).bg(markColor(d, m, t))
    .when(m.outer && up, (e) => e.rounded_tl(4).rounded_tr(4))
    .when(m.outer && !up, (e) => e.rounded_bl(4).rounded_br(4))
    .when(single, (e) => e.hover((st) => st.bg(t.accent)))
    .tooltip(m.tip);
}

// Columns, stacked columns, grouped columns, the histogram and rows over time. On a time or
// number axis each column stands at its value; otherwise the columns share the width evenly.
function columnsChart(d, c) {
  const { t, id } = c;
  const grouped = d.form === "grouped";
  const positioned = !grouped && (d.axis === "time" || d.axis === "number");
  const single = d.legend.length === 0;
  const marks = (pt, k) => (grouped
    ? [h_flex().absolute().inset_0().gap(1).children(Array.from({ length: d.slotCount }, (_v, s) => {
      const m = pt.marks.find((mark) => mark.series === s);
      return div().flex_1().min_w(0).h_full().relative().when(Boolean(m), (e) => e.child(columnMark(`pg-col-${id}-${k}-${s}`, m, d, t, false)));
    }))]
    : pt.marks.map((m, j) => columnMark(`pg-col-${id}-${k}-${j}`, m, d, t, single)));
  const width = grouped ? 24 * d.slotCount + d.slotCount - 1 : 24;
  const body = positioned
    ? div().absolute().top(0).bottom(0).left(0).right(d.barWidth).children(d.points.map((pt, k) => div().absolute().top(0).h(H)
      .left(pct(d.points.length === 1 ? 0.5 : pt.x)).w(d.barWidth).children(marks(pt, k))))
    : h_flex().absolute().inset_0().gap(2).children(d.points.map((pt, k) => h_flex().flex_1().min_w(0).h_full().justify_center()
      .child(div().relative().w_full().max_w(width).h_full().children(marks(pt, k)))));
  return v_flex().gap(6)
    .when(d.legend.length > 0, (e) => e.child(legend(d.legend, t)))
    .child(h_flex().items_start()
      .child(yAxis(d.lo, d.hi, t))
      .child(div().flex_1().min_w(0).relative().h(H).children(grid(d.lo, d.hi, t)).child(body)))
    .child(xLabels(d, t))
    .when(d.more > 0, (e) => e.child(moreLine(d.more, t)));
}

// One bar per label, square at zero and rounded at its value. With negative values, bars grow
// both ways from a zero line.
function barList(d, c) {
  const { t, id } = c;
  const span = d.hi - d.lo || 1;
  const zero = -d.lo / span;
  return v_flex().gap(4)
    .children(d.shown.map((b, k) => {
      const w = Math.max(b.value !== 0 ? 0.005 : 0, Math.abs(b.value) / span);
      const down = b.value < 0;
      return h_flex().id(`pg-hbar-${id}-${k}`).h(26).gap(12).items_center().rounded(6).hover((st) => st.bg(t.hover)).tooltip(b.tip)
        .child(div().w(200).flex_none().truncate().text_size(12.5).text_color(t.muted).child(b.label))
        .child(div().flex_1().min_w(0).h_full().relative()
          .when(d.signed, (e) => e.child(div().absolute().top(0).bottom(0).left(pct(zero)).w(1).bg(alpha(t.foreground, 0.2))))
          .child(div().absolute().top(5).bottom(5).left(pct(down ? zero - w : zero)).w(pct(w))
            .bg(d.signed ? (down ? t.ansi1 : t.ansi2) : t.ansi4)
            .when(down, (e) => e.rounded_tl(4).rounded_bl(4))
            .when(!down, (e) => e.rounded_tr(4).rounded_br(4))))
        .child(div().w(76).flex_none().text_right().text_size(12).font_family(mono()).text_color(t.foreground).child(compact(b.value)));
    }))
    .when(d.more > 0, (e) => e.child(moreLine(d.more, t, true)));
}

function shareBars(d, c) {
  const { t, id } = c;
  return v_flex().gap(4)
    .child(div().pb(6).child(legend(d.legend, t)))
    .children(d.rows.map((row, k) => h_flex().h(26).gap(12).items_center()
      .child(div().w(200).flex_none().truncate().text_size(12.5).text_color(t.muted).child(row.label))
      .child(h_flex().flex_1().min_w(0).h(16).children(row.parts.map((part, j) => {
        const last = j === row.parts.length - 1;
        return h_flex().id(`pg-share-${id}-${k}-${j}`).flex_none().h_full().w(pct(part.share / 100)).items_center().justify_center().overflow_hidden()
          .bg(colorOf(part.color, t)).tooltip(part.tip)
          .when(!last, (e) => e.border_r(2).border_color(t.background))
          .when(last, (e) => e.rounded_tr(4).rounded_br(4))
          .when(part.share >= 9, (e) => e.child(div().text_size(10.5).font_medium().text_color(t.background).child(`${Math.round(part.share)}%`)));
      })))
      .child(div().w(76).flex_none().text_right().text_size(12).font_family(mono()).text_color(t.foreground).child(compact(row.total)))))
    .when(d.more > 0, (e) => e.child(moreLine(d.more, t, true)));
}

// A dot whose corner is on its point: one element, for the many same-size dots of a scatter.
const cornerDot = (id, left, top, size, color, tip, t) => div().id(id).absolute().left(`${left}%`).top(`${top}%`).size(size).rounded_full()
  .bg(alpha(color, 0.85)).border_2().border_color(t.background).hover((st) => st.bg(t.accent)).tooltip(tip);

// A dot centered on its point, whatever its size.
const dot = (id, left, top, size, color, tip, t) => div().absolute().left(`${left}%`).top(`${top}%`).size(0)
  .child(cornerDot(id, 0, 0, size, color, tip, t).left(-size / 2).top(-size / 2));

// Runs of points with a value, split where a value is missing. A step line goes across, then up
// or down.
function runsOf(d, s) {
  const span = d.hi - d.lo || 1;
  const runs = [];
  let run = null;
  s.values.forEach((v, k) => {
    if (v !== v) {
      run = null;
      return;
    }
    const pt = [d.points[k].x, (d.hi - v) / span];
    if (!run) runs.push((run = [pt]));
    else {
      if (d.step) run.push([pt[0], run[run.length - 1][1]]);
      run.push(pt);
    }
  });
  return runs;
}

// A line's geometry and where its hover columns stand depend only on the chart's data, so they
// are built once and reused on every redraw: building them takes Herdr's engine longer than
// drawing them.
const geometry = new WeakMap();
function lineGeometry(d) {
  if (geometry.has(d)) return geometry.get(d);
  const zero = pct(Math.min(1, Math.max(0, d.hi / (d.hi - d.lo || 1))));
  const series = d.series.map((s) => {
    const runs = runsOf(d, s);
    const long = runs.filter((run) => run.length > 1);
    const through = (builder, points) => points.reduce((b, [x, y]) => b.line_to(pct(x), pct(y)), builder);
    return {
      // One closed shape from zero up the line and back down: a move_to inside it would start a
      // second shape, and close() would then cut across from the line's end to its start.
      washes: d.wash ? long.map((run) => through(PathBuilder.fill().move_to(pct(run[0][0]), zero), run)
        .line_to(pct(run[run.length - 1][0]), zero).close().build()) : [],
      lines: long.map((run) => through(PathBuilder.stroke(2).move_to(pct(run[0][0]), pct(run[0][1])), run.slice(1)).build()),
      dots: runs.filter((run) => run.length === 1).map(([[x, y]]) => [x * 100, y * 100]),
    };
  });
  const xs = d.points.map((pt) => pt.x);
  const hits = xs.map((x, k) => {
    const left = k === 0 ? 0 : (xs[k - 1] + x) / 2;
    const right = k === xs.length - 1 ? 1 : (x + xs[k + 1]) / 2;
    return [pct(left), pct(right - left)];
  });
  const shape = { series, hits };
  geometry.set(d, shape);
  return shape;
}

// Lines, areas, steps and running totals. Each point has a full-height column to hover, which
// says every series' value there.
function lineChart(d, c) {
  const { t, id } = c;
  const shape = lineGeometry(d);
  const layer = (path, paint) => window.paint_path(path, paint).absolute().top(0).left(0).size_full();
  const layers = d.series.flatMap((s, si) => {
    const color = colorOf(s.color, t);
    const { washes, lines, dots } = shape.series[si];
    return [
      ...washes.map((path) => layer(path, Background.solid(color).opacity(0.12))),
      ...lines.map((path) => layer(path, color)),
      ...dots.map(([x, y], k) => dot(`pg-pt-${id}-${si}-${k}`, x, y, 6, color, s.name, t)),
    ];
  });
  const hits = d.points.map((pt, k) => div().id(`pg-hit-${id}-${k}`).absolute().top(0).bottom(0).left(shape.hits[k][0]).w(shape.hits[k][1])
    .hover((st) => st.bg(alpha(t.foreground, 0.06))).tooltip(pt.tip));
  return v_flex().gap(6)
    .when(d.legend.length > 0, (e) => e.child(legend(d.legend, t)))
    .child(h_flex().items_start()
      .child(yAxis(d.lo, d.hi, t))
      .child(div().flex_1().min_w(0).relative().h(H).children(grid(d.lo, d.hi, t)).children(layers).children(hits)))
    .child(xLabels(d, t));
}

function dotsChart(d, c) {
  const { t, id } = c;
  return v_flex().gap(6)
    .when(d.legend.length > 0, (e) => e.child(legend(d.legend, t)))
    .child(h_flex().items_start()
      .child(yAxis(d.y0, d.y1, t))
      .child(div().flex_1().min_w(0).relative().h(H).children(grid(d.y0, d.y1, t))
        .children(d.points.map((p, k) => (d.sized ? dot : cornerDot)(`pg-dot-${id}-${k}`, p.left, p.top, p.diameter, colorOf(p.color, t), p.tip, t)))))
    .child(h_flex().pl(52).justify_between().text_size(11).font_family(mono()).text_color(t.dim)
      .child(div().child(compact(d.x0))).child(div().child(words(d.xName))).child(div().child(compact(d.x1))));
}

function tiles(d, c) {
  const { t } = c;
  return h_flex().flex_wrap().children(d.tiles.map((tile, k) => v_flex().min_w(0).py(10).pr(28).gap(6)
    .when(k > 0, (e) => e.pl(28).border_l(1).border_color(alpha(t.foreground, 0.1)))
    .child(div().text_size(12).text_color(t.muted).child(tile.name))
    .child(div().text_size(28).font_semibold().text_color(t.foreground).child(tile.value))));
}

// The measure as a bar from zero, its value just past the bar's end.
function divergingBar(row, d, t) {
  const pad = 0.18;
  const start = d.lo < 0 ? pad : 0;
  const end = d.hi > 0 ? 1 - pad : 1;
  const at = (v) => start + ((v - d.lo) / (d.hi - d.lo || 1)) * (end - start);
  const zero = at(0);
  const w = Math.max(row.value !== 0 ? 0.005 : 0, Math.abs(at(row.value) - zero));
  const down = row.value < 0;
  const bar = div().h(16).flex_none().w(pct(w)).bg(d.signed ? (down ? t.ansi1 : t.ansi2) : t.ansi4)
    .when(down, (e) => e.rounded_tl(4).rounded_bl(4))
    .when(!down, (e) => e.rounded_tr(4).rounded_br(4));
  const value = div().flex_none().px(6).text_size(12).font_family(mono()).text_color(t.foreground).child(compact(row.value));
  return div().flex_1().min_w(0).h_full().relative()
    .when(d.signed, (e) => e.child(div().absolute().top(0).bottom(0).left(pct(zero)).w(1).bg(alpha(t.foreground, 0.2))))
    .child(h_flex().absolute().inset_0().items_center()
      .when(!down, (e) => e.child(div().flex_none().w(pct(zero))).child(bar).child(value))
      .when(down, (e) => e.child(div().flex_1()).child(value).child(bar).child(div().flex_none().w(pct(1 - zero)))));
}

function barTable(d, c) {
  const { t, id } = c;
  const rule = (strength) => div().h(1).w_full().bg(alpha(t.foreground, strength));
  const other = (text) => div().w(96).flex_none().pr(16).text_right().truncate().child(text);
  return v_flex()
    .child(rule(0.22))
    .child(h_flex().h(34).items_center().text_size(12).font_semibold().text_color(t.muted)
      .child(div().w(200).flex_none().pr(16).truncate().child(d.head.label))
      .children(d.head.others.map(other))
      .child(div().flex_1().min_w(0).truncate().child(d.head.measure)))
    .child(rule(0.1))
    .children(d.rows.map((row, k) => h_flex().id(`pg-brow-${id}-${k}`).h(34).items_center().border_b(1).border_color(alpha(t.border, 0.5))
      .text_size(13).hover((st) => st.bg(t.hover)).tooltip(row.tip)
      .child(div().w(200).flex_none().pr(16).truncate().text_color(t.foreground).child(row.label))
      .children(row.others.map((text) => other(text).font_family(mono()).text_color(t.muted)))
      .child(divergingBar(row, d, t))))
    .when(d.more > 0, (e) => e.child(moreLine(d.more, t, true)));
}

// Works out what a chart draws, before it is drawn: in the task that reads a result, or on the
// view's worker.
export function prepareChart(result, p) {
  const data = chartData(result, p);
  if (data && LINES.has(p.type)) lineGeometry(data);
}

const DRAW = {
  bars: barList,
  columns: columnsChart,
  stacked: columnsChart,
  grouped: columnsChart,
  share: shareBars,
  line: lineChart,
  area: lineChart,
  step: lineChart,
  total: lineChart,
  scatter: dotsChart,
  bubbles: dotsChart,
  histogram: columnsChart,
  count: (d, c) => (d.form === "bars" ? barList(d, c) : columnsChart(d, c)),
  tiles,
  bartable: barTable,
};

// Big results are worked out on the view's worker. The page says "Drawing…" until then; a chart
// that failed says so instead of waiting forever.
const queued = new WeakMap();
function dataFor(view, result, p) {
  if (chartDrawn(result, p) || result.rows.length * Math.max(1, p.series.length) <= INLINE_WORK) return { data: chartData(result, p) };
  let states = queued.get(result);
  if (!states) queued.set(result, (states = new Map()));
  const key = JSON.stringify([p.type, p.x, p.y, p.series, p.size, p.group]);
  if (!states.has(key)) {
    states.set(key, "drawing");
    view.drawLater(() => {
      try {
        prepareChart(result, p);
      } catch (e) {
        states.set(key, "failed");
        throw e;
      }
    });
  }
  return { state: states.get(key) };
}

function typePicker(view, query, result, p, t) {
  const active = p.auto ? null : p.type;
  const chip = div().id(`pg-chart-${query.id}-auto`).h(24).px(9).flex().items_center().rounded(7).cursor_pointer().text_size(12)
    .when(active === null, (e) => e.bg(t.selected).text_color(t.foreground))
    .when(active !== null, (e) => e.text_color(t.muted).hover((st) => st.bg(t.hover)))
    .on_click((_e, cx) => view.setChart(query, null, cx))
    .child("Auto");
  return h_flex().gap(2).items_center().child(chip).children(chartChoices(result).map((key) => {
    const on = key === active;
    return div().id(`pg-chart-${query.id}-${key}`).w(26).h(24).flex_none().flex().items_center().justify_center().rounded(7).cursor_pointer()
      .when(on, (e) => e.bg(t.selected))
      .when(!on, (e) => e.hover((st) => st.bg(t.hover)))
      .tooltip(chartName(key))
      .on_click((_e, cx) => view.setChart(query, key, cx))
      .child(icon(`chart-${key}`, 15, on ? t.foreground : t.muted));
  }));
}

const numberChip = (id, on, t) => h_flex().id(id).h(24).px(9).gap(6).items_center().rounded(7).cursor_pointer().text_size(12)
  .when(on, (e) => e.bg(t.selected).text_color(t.foreground))
  .when(!on, (e) => e.text_color(t.muted).hover((st) => st.bg(t.hover)));

// One-number charts pick their measure; many-number charts turn series on and off, each chip
// showing the color its series has.
function numberPicker(view, query, result, p, t) {
  const h = result.header;
  if (p.numbers === "none" || p.options.length <= 1) return null;
  const heading = (text) => div().pr(6).text_size(12).text_color(t.dim).child(text);
  if (p.numbers === "one") {
    return h_flex().gap(2).items_center().child(heading("Measure")).children(p.options.map((i) => numberChip(`pg-measure-${query.id}-${i}`, i === p.y, t)
      .on_click((_e, cx) => view.setMeasure(query, h[i], cx))
      .child(h[i])));
  }
  return h_flex().flex_wrap().gap(2).items_center().child(heading("Numbers")).children(p.options.map((i, k) => {
    const at = p.series.indexOf(i);
    const slot = at >= 0 ? p.colors[at] : k < MAX_SERIES ? k : -1;
    return numberChip(`pg-series-${query.id}-${i}`, at >= 0, t)
      .on_click((_e, cx) => view.toggleSeries(query, h[i], cx))
      .child(div().size(8).flex_none().rounded(2).bg(colorOf(slot, t)).when(at < 0, (e) => e.opacity(0.4)))
      .child(h[i]);
  }));
}

export function chart(view, query, result, t) {
  const p = plan(result, query);
  if (!p) return quiet("Nothing to chart here: the result has no numbers, dates or repeated labels.", t);
  const { data, state } = dataFor(view, result, p);
  const title = chartTitle(p, result.header);
  const numbers = numberPicker(view, query, result, p, t);
  let body;
  if (state === "failed") body = quiet("This chart could not be drawn.", t);
  else if (state) body = div().h(H + 24).flex().items_center().text_size(13).text_color(t.muted).child("Drawing…");
  else if (!data) body = quiet("Nothing to chart: the values are empty.", t);
  else body = DRAW[p.type](data, { t, id: query.id });
  return v_flex().gap(14).pt(6)
    .child(h_flex().flex_wrap().gap(10).items_center()
      .child(typePicker(view, query, result, p, t))
      .child(div().flex_1())
      .when(Boolean(numbers), (e) => e.child(numbers)))
    .when(Boolean(p.refused), (e) => e.child(div().text_size(12).text_color(t.dim).child(`${chartName(p.refused)} does not fit this result.`)))
    .when(Boolean(title) || Boolean(data?.note), (e) => e.child(h_flex().gap(12).items_baseline()
      .when(Boolean(title), (el) => el.child(div().text_size(14).font_semibold().text_color(t.foreground).child(title)))
      .when(Boolean(data?.note), (el) => el.child(div().text_size(12).text_color(t.dim).child(data.note)))))
    .child(body);
}
