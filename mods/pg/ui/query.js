// One query on the notebook page: its title row, its SQL, then its result as a table, a chart
// or a summary, and the result line.
import { div } from "gpui-kit";
import { h_flex, v_flex, Editor, Input } from "gpui-base";
import { home } from "herdr";
import { queryTitle } from "../notebooks.js";
import { chartPreparations, defaultView, formatBytes, formatNumber, plan } from "../shape.js";
import { chart, prepareChart } from "./chart.js";
import { summary, summaryLines } from "./summary.js";
import { columnWidths, printedTable } from "./table.js";
import { composer, doneLine, editButton, fixButton, jobStrip } from "./ai.js";
import { CLEAR, SERIF, alpha, button, icon, keepFocus, mono } from "./kit.js";

const VIEWS = [["table", "Table"], ["chart", "Chart"], ["summary", "Summary"]];

const plural = (n, word) => `${formatNumber(String(n))} ${word}${n === 1 ? "" : "s"}`;
const shortPath = (path) => (path.startsWith(`${home()}/`) ? `~${path.slice(home().length)}` : path);

function resultLine(view, query, cell, t) {
  const { header, rows } = cell.result;
  const cut = cell.cut;
  const counts = `${cut ? `First ${plural(rows.length, "row")} of a ${formatBytes(cut.bytes)} result` : plural(rows.length, "row")} · ${plural(header.length, "column")} · ${cell.ms} ms`;
  return h_flex().gap(6).items_center().text_size(12).text_color(t.dim)
    .child(div().child(counts))
    .when(Boolean(cut?.saved), (e) => e.child(div().child(`· Saved whole to ${shortPath(cut.saved)}`)))
    .when(Boolean(cut?.file), (e) => e.child(div().child("·")).child(div().id(`pg-save-${cell.id}`).cursor_pointer().text_color(t.muted)
      .hover((st) => st.text_color(t.foreground))
      .on_click((_e, cx) => view.saveResult(cell, query, cx))
      .child(cut.saving ? "Saving…" : "Save all as CSV")));
}

// A result bigger than Herdr can hold: show what fits, save all of it, or let it go.
function askBlock(view, query, cell, t) {
  const cut = cell.cut;
  const shown = cell.result.rows.length;
  const size = formatBytes(cut.bytes);
  const choice = (key, label, iconName, primary = false) => button(`pg-${key}-${cell.id}`, t)
    .when(primary, (e) => e.bg(alpha(t.foreground, 0.07)).text_color(t.foreground))
    .child(icon(iconName, 12, primary ? t.foreground : t.muted)).child(label);
  return v_flex().gap(10)
    .child(h_flex().gap(8).items_center().text_size(13.5).font_medium().text_color(t.foreground)
      .child(div().size(7).rounded_full().bg(t.ansi3)).child("This result is too big to show in full"))
    .child(div().pl(15).max_w(640).text_size(13).line_height("150%").text_color(t.muted)
      .child(shown > 0
        ? `As CSV it is ${size}. Herdr can show its first ${plural(shown, "row")}.`
        : `As CSV it is ${size}, more than Herdr can show next to the other results open now.`))
    .when(Boolean(cut.saved), (e) => e.child(div().pl(15).text_size(13).text_color(t.muted).child(`Saved whole to ${shortPath(cut.saved)}.`)))
    .child(h_flex().pl(15).gap(6)
      .when(shown > 0, (e) => e.child(choice("show", `Show the first ${plural(shown, "row")}`, "play", true)
        .on_click((_e, cx) => view.showFirstRows(cell, cx))))
      .when(Boolean(cut.file), (e) => e.child(choice("save", cut.saving ? "Saving…" : "Save all as CSV", "download")
        .on_click((_e, cx) => view.saveResult(cell, query, cx))))
      .child(choice("drop", "Discard", "trash").on_click((_e, cx) => view.discardResult(cell, cx))));
}

export const viewOf = (query, result) => query.view ?? defaultView(result);

// What the table, the summary and the charts work out from all the rows, as separate steps.
// The page runs them in a task before it shows the result: Herdr interrupts a render that runs
// past about 50 ms, and a pass over 50,000 rows takes longer than that. The query's own chart
// is worked out last, so it shows at once; other charts take their turn on the view's worker.
export const preparations = (result, query) => [
  () => columnWidths(result),
  () => summaryLines(result),
  ...chartPreparations(result),
  () => {
    const p = plan(result, query);
    if (p) prepareChart(result, p);
  },
];

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

// A query the server refused can go to an agent to fix, unless one is already on it.
function errorBlock(view, query, cell, canFix, t) {
  return v_flex().gap(6)
    .child(h_flex().gap(8).items_center().text_size(13.5).font_medium().text_color(t.ansi1)
      .child(div().size(7).rounded_full().bg(t.ansi1)).child("The query failed"))
    .child(div().pl(15).text_size(13).font_family(mono()).text_color(alpha(t.ansi1, 0.85)).child(cell.error))
    .when(canFix, (e) => e.child(h_flex().pl(15).pt(4).child(fixButton(view, query, t))));
}

export function querySection(view, query, cell, t) {
  const choice = cell.cut?.choice ?? null;
  const asking = choice === "ask" && Boolean(cell.result);
  const result = asking ? null : cell.result;
  const hasRows = Boolean(result) && result.rows.length > 0;
  const mode = hasRows ? viewOf(query, result) : null;
  const job = view.ai.jobOf(query.id);
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
      .child(runButton(view, cell, t))
      .child(editButton(view, query, t)))
    .when(view.asking === query.id, (e) => e.child(composer(view, query.id, t)))
    .when(Boolean(job) && !job.done, (e) => e.child(jobStrip(view, query, job, t)))
    .child(sqlBlock(cell, t))
    .when(Boolean(job?.done), (e) => e.child(doneLine(view, query, job, t)))
    .when(Boolean(cell.error), (e) => e.child(errorBlock(view, query, cell, cell.fixable && (!job || Boolean(job.done || job.failed)), t)))
    .when(asking, (e) => e.child(askBlock(view, query, cell, t)))
    .when(choice === "drop", (e) => e.child(div().text_size(13).text_color(t.muted)
      .child(`Discarded a ${formatBytes(cell.cut.bytes)} result.${cell.cut.saved ? ` All of it is in ${shortPath(cell.cut.saved)}.` : ""}`)))
    .when(Boolean(result) && !hasRows, (e) => e.child(div().text_size(13).text_color(t.muted)
      .child(result.header.length ? `No rows. ${plural(result.header.length, "column")} · ${cell.ms} ms` : `Done in ${cell.ms} ms. It returned no rows.`)))
    .when(hasRows, (e) => e
      .child(mode === "chart" ? chart(view, query, result, t) : mode === "summary" ? summary(result, t) : printedTable(query.id, result, t))
      .child(resultLine(view, query, cell, t)));
}
