// The printed table: rules above and below, no vertical lines, numbers on the right in figures,
// identifiers and code in mono, the rest as text. No pills, chips or pictures inside cells.
import { div } from "gpui-kit";
import { h_flex, v_flex, v_virtual_list, Scrollbar } from "gpui-base";
import { arrayItems, formatNumber, jsonPreview, naturalTime } from "../shape.js";
import { alpha, memo, mono } from "./kit.js";

const ROW = 36;

function value(v, kind, col, t) {
  if (v === null || v === "") return div().text_color(t.dim).child("—");
  if (kind === "number" && !col.idLike) return div().w_full().text_right().font_family(mono()).text_size(13).child(formatNumber(v));
  if (kind === "time") return div().truncate().text_color(t.muted).child(naturalTime(v));
  if (kind === "bool") return div().text_color(v === "t" ? t.foreground : t.dim).child(v === "t" ? "true" : "false");
  if (kind === "json") return div().min_w(0).truncate().text_color(t.muted).child(jsonPreview(v));
  if (kind === "array") return div().min_w(0).truncate().child(arrayItems(v).join(", "));
  if (kind === "binary") return div().text_color(t.dim).child("binary");
  if (col.idLike || col.code) return div().min_w(0).truncate().font_family(mono()).text_size(12.5).text_color(t.muted).child((kind === "uuid" ? v.slice(0, 8) : v).replace(/\s+/g, " "));
  return div().min_w(0).truncate().child(v.replace(/[\r\n\t]+/g, " "));
}

// From the first rows only: enough to size the columns, cheap on a million rows.
function widths({ header, rows: all, kinds, prof }) {
  const rows = all.length > 2000 ? all.slice(0, 2000) : all;
  const shown = (v, i) => (v === null ? 1 : kinds[i] === "number" ? formatNumber(v).length : v.length);
  const longest = header.map((name, i) => Math.min(44, rows.reduce((m, row) => Math.max(m, shown(row[i], i)), name.length)));
  const fixed = { time: 150, bool: 70, json: 380, uuid: 110, binary: 90 };
  return header.map((name, i) => {
    const c = prof.cols[i];
    const head = name.length * 7.5 + 24;
    if (c.code || c.prose) return 440;
    if (kinds[i] === "number") return Math.max(head, 120, Math.min(220, longest[i] * 8.2 + 24));
    return Math.max(head, fixed[kinds[i]] ?? Math.max(80, longest[i] * 8 + 28));
  });
}

export const columnWidths = (result) => memo(result, "widths", () => widths(result));

export function printedTable(id, result, t) {
  const { header, rows, kinds, prof } = result;
  const w = columnWidths(result);
  const total = w.reduce((a, b) => a + b, 0);
  const rule = (strength) => div().h(1).w_full().bg(alpha(t.foreground, strength));
  return div().id(`pg-x-${id}`).w_full().overflow_x_scrollbar()
    .child(v_flex().min_w(total)
      .child(rule(0.22))
      .child(h_flex().h(36).children(header.map((name, i) => h_flex().w(w[i]).flex_none().pr(16).items_center()
        .when(kinds[i] === "number", (e) => e.justify_end())
        .child(div().truncate().text_size(12).font_semibold().text_color(t.muted).child(name)))))
      .child(rule(0.1))
      // Only the rows on screen are drawn, so a result of any size scrolls smoothly.
      .child(v_flex().relative().w_full().h(Math.min(420, rows.length * ROW))
        .child(v_virtual_list(`pg-y-${id}`, rows.length, ROW, (r) => String(r), (range) => rows.slice(range.start, range.end).map((row, k) => {
          const r = range.start + k;
          return h_flex().id(`pg-r-${id}-${r}`).w_full().h(ROW).flex_none().border_b(1).border_color(alpha(t.border, 0.5)).text_size(13.5).hover((st) => st.bg(t.hover))
            .children(row.map((v, i) => h_flex().w(w[i]).flex_none().h_full().pr(16).items_center().min_w(0).child(value(v, kinds[i], prof.cols[i], t))));
        })).size_full())
        .child(Scrollbar.vertical(`pg-y-${id}`).absolute().inset_0()))
      .child(rule(0.22)));
}
