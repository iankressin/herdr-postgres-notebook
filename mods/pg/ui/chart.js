// A query's result as a chart. Which chart comes from plan() in shape.js; this file only draws.
// One series, one color: ansi4, accent on hover.
import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { barTotals, chartTitle, compact, formatNumber, measureChoices, plan, scatterPoints, spread, timeSeries, words } from "../shape.js";
import { alpha, memo, mono } from "./kit.js";

const H = 220;

const height = (value, max) => Math.max(value > 0 ? 2 : 0, Math.round((value / (max || 1)) * H));

function yAxis(max, t) {
  return v_flex().w(52).flex_none().h(H).justify_between().items_end().pr(8).text_size(11).font_family(mono()).text_color(t.dim)
    .child(div().child(compact(max))).child(div().child(compact(max / 2))).child(div().child("0"));
}

const grid = (t) => [0, 0.5, 1].map((f) => div().absolute().left(0).right(0).top(Math.round(f * (H - 1))).h(1).bg(alpha(t.foreground, 0.07)));

const xLabels = (labels, t) => h_flex().pl(52).justify_between().text_size(11).text_color(t.dim).children(labels.map((l) => div().child(l)));

// Columns from a common baseline: at most 24px wide, 2px apart, 4px rounded at the top.
function columnChart(points, labels, t) {
  const max = Math.max(0, ...points.map((p) => p.value));
  return v_flex().gap(6)
    .child(h_flex().items_start()
      .child(yAxis(max, t))
      .child(div().flex_1().min_w(0).relative().h(H).children(grid(t))
        .child(h_flex().h(H).items_end().gap(2).children(points.map((p, k) => div().id(`pg-bar-${k}`).flex_1().max_w(24).min_w(1)
          .h(height(p.value, max)).rounded_tl(4).rounded_tr(4).bg(t.ansi4).hover((st) => st.bg(t.accent)).tooltip(p.tip))))))
    .child(xLabels(labels, t));
}

// Bars stand at their moment on a real time axis, so uneven gaps look uneven.
function timeChart(series, t) {
  const { points, min, span, barWidth } = series;
  const max = Math.max(0, ...points.map((p) => p.value));
  const plot = div().flex_1().min_w(0).relative().h(H).children(grid(t))
    .child(div().absolute().top(0).bottom(0).left(0).right(barWidth).children(points.map((p, k) => div().id(`pg-tbar-${k}`).absolute().bottom(0)
      .left(`${span === 1 ? 50 : ((p.at - min) / span) * 100}%`).w(barWidth)
      .h(height(p.value, max)).rounded_tl(4).rounded_tr(4).bg(t.ansi4).hover((st) => st.bg(t.accent)).tooltip(p.tip))));
  return v_flex().gap(6).child(h_flex().items_start().child(yAxis(max, t)).child(plot)).child(xLabels(series.ticks, t));
}

// One bar per label, longest first, square at the baseline and rounded at the data end.
function barChart(bars, t) {
  const max = Math.max(0, ...bars.shown.map((b) => b.value));
  return v_flex().gap(4)
    .children(bars.shown.map((b, k) => h_flex().id(`pg-hbar-${k}`).h(26).gap(12).items_center().rounded(6).hover((st) => st.bg(t.hover)).tooltip(b.tip)
      .child(div().w(200).flex_none().truncate().text_size(12.5).text_color(t.muted).child(b.label))
      .child(div().flex_1().min_w(0).h(16).child(div().h_full().rounded_tr(4).rounded_br(4).bg(t.ansi4)
        .w(`${Math.max(b.value > 0 ? 0.5 : 0, (b.value / (max || 1)) * 100)}%`)))
      .child(div().w(76).flex_none().text_right().text_size(12).font_family(mono()).text_color(t.foreground).child(compact(b.value)))))
    .when(bars.more > 0, (e) => e.child(div().pt(4).text_size(12).text_color(t.dim).child(`and ${formatNumber(String(bars.more))} more, smaller`)));
}

function scatterChart(dots, xName, t) {
  return v_flex().gap(6)
    .child(h_flex().items_start()
      .child(yAxis(dots.y1, t))
      .child(div().flex_1().min_w(0).relative().h(H).children(grid(t))
        .children(dots.points.map((d, k) => div().id(`pg-dot-${k}`).absolute().left(`${d.left}%`).top(`${d.top}%`).size(10).rounded_full()
          .bg(alpha(t.ansi4, 0.85)).border_2().border_color(t.background).hover((st) => st.bg(t.accent)).tooltip(d.tip)))))
    .child(h_flex().pl(52).justify_between().text_size(11).font_family(mono()).text_color(t.dim)
      .child(div().child(compact(dots.x0))).child(div().child(words(xName))).child(div().child(compact(dots.x1))));
}

function drawn(result, p, t) {
  const once = (work) => memo(result, `${p.type}:${p.x}:${p.y}`, work);
  if (p.type === "time" || p.type === "timecount") {
    const series = once(() => timeSeries(result, p.x, p.y));
    return series && { el: timeChart(series, t), note: series.note };
  }
  if (p.type === "bars" || p.type === "count") {
    const bars = once(() => barTotals(result, p.x, p.y));
    return { el: barChart(bars, t), note: bars.note };
  }
  if (p.type === "scatter") {
    const dots = once(() => scatterPoints(result, p.x, p.y));
    return dots && { el: scatterChart(dots, result.header[p.x], t), note: null };
  }
  const bins = once(() => spread(result, p.x));
  return bins && { el: columnChart(bins.points, bins.labels, t), note: bins.note };
}

export function chart(view, query, result, t) {
  const p = plan(result, query.measure);
  const quiet = (text) => div().py(24).text_size(13).text_color(t.muted).child(text);
  if (!p) return quiet("Nothing to chart here: the result has no numbers, dates or repeated labels.");
  const shown = drawn(result, p, t);
  if (!shown) return quiet("Nothing to chart: the values are empty.");
  const choices = measureChoices(p);
  return v_flex().gap(14).pt(6)
    .child(h_flex().gap(12).items_baseline()
      .child(div().text_size(14).font_semibold().text_color(t.foreground).child(chartTitle(p, result.header)))
      .when(Boolean(shown.note), (e) => e.child(div().text_size(12).text_color(t.dim).child(shown.note)))
      .child(div().flex_1())
      .when(choices.length > 0, (e) => e.child(h_flex().gap(2).items_center()
        .child(div().pr(6).text_size(12).text_color(t.dim).child("Measure"))
        .children(choices.map((i) => {
          const on = i === p.y;
          return div().id(`pg-measure-${query.id}-${i}`).h(24).px(9).flex().items_center().rounded(7).cursor_pointer().text_size(12)
            .when(on, (el) => el.bg(t.selected).text_color(t.foreground))
            .when(!on, (el) => el.text_color(t.muted).hover((st) => st.bg(t.hover)))
            .on_click((_e, cx) => view.setMeasure(query, result.header[i], cx))
            .child(result.header[i]);
        })))))
    .child(shown.el);
}
