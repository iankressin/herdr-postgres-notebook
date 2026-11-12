// One query on the notebook page: its title row, its SQL, then its result as a table, a chart
// or a summary, and the result line.
import { div } from "gpui-kit";
import { h_flex, v_flex, Editor, Input } from "gpui-base";
import { LIMIT } from "../logic.js";
import { queryTitle } from "../notebooks.js";
import { defaultView } from "../shape.js";
import { chart } from "./chart.js";
import { summary } from "./summary.js";
import { printedTable } from "./table.js";
import { CLEAR, SERIF, alpha, icon, keepFocus, mono } from "./kit.js";

const VIEWS = [["table", "Table"], ["chart", "Chart"], ["summary", "Summary"]];

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const resultLine = (cell) => {
  const { header, rows } = cell.result;
  return `${plural(rows.length, "row")}${rows.length >= LIMIT ? `, the first ${LIMIT}` : ""} · ${plural(header.length, "column")} · ${cell.ms} ms`;
};

export const viewOf = (query, result) => query.view ?? defaultView(result);

function title(view, query, t) {
  if (view.edit?.key === `qtitle:${query.id}`) {
    return keepFocus(div().id(`pg-qtitle-field-${query.id}`).flex_1().min_w(0).h(34).px(6).rounded(8).border_1().border_color(t.accent).cursor_text()
      .child(Input.new(view.editInput).h_full().font_family(SERIF).text_size(22).font_semibold()));
  }
  return div().id(`pg-qtitle-${query.id}`).flex_1().min_w(0).truncate().font_family(SERIF).text_size(22).font_semibold().text_color(t.foreground)
    .cursor_text().tooltip("Rename this query").on_click((_e, cx) => view.editQueryTitle(query, cx))
    .child(queryTitle(query));
}

function viewSwitch(view, query, mode, t) {
  return h_flex().p(3).gap(2).rounded(10).bg(alpha(t.foreground, 0.05)).children(VIEWS.map(([key, label]) => {
    const on = mode === key;
    return div().id(`pg-view-${query.id}-${key}`).h(24).px(10).flex().items_center().rounded(7).cursor_pointer().text_size(12.5)
      .when(on, (e) => e.bg(t.background).text_color(t.foreground).font_medium())
      .when(!on, (e) => e.text_color(t.muted).hover((st) => st.text_color(t.foreground)))
      .on_click((_e, cx) => view.setView(query, key, cx))
      .child(label);
  }));
}

function runButton(view, cell, t) {
  return h_flex().id(`pg-run-${cell.id}`).h(30).pl(12).pr(10).gap(8).items_center().rounded_full().cursor_pointer()
    .bg(cell.running ? alpha(t.ansi3, 0.18) : t.solid).text_color(cell.running ? t.ansi3 : t.solid_foreground).text_size(12.5).font_semibold()
    .on_click((_e, cx) => view.runCell(cell, cx))
    .child(cell.running ? icon("spinner", 12, t.ansi3).spin(800) : icon("play", 11, t.solid_foreground))
    .child(cell.running ? "Running" : "Run")
    .when(!cell.running, (e) => e.child(div().text_size(11.5).font_weight(400).opacity(0.55).child("⌘↵")));
}

// Wrapped lines count too, so the block is measured once laid out: about 8.2px per character
// at 13.5px mono, 24px per line.
function sqlBlock(cell, t) {
  const sql = cell.editor.value();
  const perLine = Math.max(30, Math.floor(((cell.edWidth ?? 900) - 28) / 8.2));
  const lines = Math.max(2, sql.split("\n").reduce((n, line) => n + Math.max(1, Math.ceil(line.length / perLine)), 0));
  return keepFocus(div().id(`pg-ed-${cell.id}`).h(Math.min(380, lines * 24 + 30)).px(10).py(12).rounded(12).bg(t.canvas)
    .border_1().border_color(cell.focused ? alpha(t.accent, 0.55) : CLEAR)
    .on_size_change((size, cx) => { if (Math.abs((cell.edWidth ?? 0) - size.width) > 4) { cell.edWidth = size.width; cx.notify(); } })
    .child(Editor.new(cell.editor).size_full()));
}

function errorBlock(cell, t) {
  return v_flex().gap(6)
    .child(h_flex().gap(8).items_center().text_size(13.5).font_medium().text_color(t.ansi1)
      .child(div().size(7).rounded_full().bg(t.ansi1)).child("The query failed"))
    .child(div().pl(15).text_size(13).font_family(mono()).text_color(alpha(t.ansi1, 0.85)).child(cell.error));
}

export function querySection(view, query, cell, t) {
  const result = cell.result;
  const hasRows = Boolean(result) && result.rows.length > 0;
  const mode = hasRows ? viewOf(query, result) : null;
  return v_flex().id(`pg-q-${query.id}`).flex_none().gap(14)
    .on_key_down((e, cx) => {
      if (e.keystroke !== "cmd-enter" && e.keystroke !== "ctrl-enter") return;
      view.runCell(cell, cx);
      cx.stop_propagation();
    })
    .child(h_flex().gap(10).items_center()
      .child(title(view, query, t))
      .when(hasRows, (e) => e.child(viewSwitch(view, query, mode, t)))
      .child(div().id(`pg-del-${query.id}`).size(28).flex_none().flex().items_center().justify_center().rounded(8).cursor_pointer()
        .hover((st) => st.bg(t.hover)).tooltip("Remove this query")
        .on_click((_e, cx) => view.removeQuery(query, cx))
        .child(icon("close", 13, t.dim)))
      .child(runButton(view, cell, t)))
    .child(sqlBlock(cell, t))
    .when(Boolean(cell.error), (e) => e.child(errorBlock(cell, t)))
    .when(Boolean(result) && !hasRows, (e) => e.child(div().text_size(13).text_color(t.muted)
      .child(result.header.length ? `No rows. ${plural(result.header.length, "column")} · ${cell.ms} ms` : `Done in ${cell.ms} ms. It returned no rows.`)))
    .when(hasRows, (e) => e
      .child(mode === "chart" ? chart(view, query, result, t) : mode === "summary" ? summary(result, t) : printedTable(query.id, result, t))
      .child(div().text_size(12).text_color(t.dim).child(resultLine(cell))));
}
