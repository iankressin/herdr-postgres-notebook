// One line per column: what it holds, how full it is, its range or most common value.
import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { memo, summarize } from "../shape.js";
import { alpha, mono } from "./kit.js";

export const summaryLines = (result) => memo(result, "summary", () => summarize(result));

export function summary(result, t) {
  const head = (text, w, right) => div().w(w).flex_none().pr(16).when(Boolean(right), (e) => e.text_right()).child(text);
  const figure = (text, w) => div().w(w).flex_none().pr(16).text_right().font_family(mono()).text_color(t.muted).child(text);
  return v_flex()
    .child(div().h(1).bg(alpha(t.foreground, 0.22)))
    .child(h_flex().h(34).items_center().text_size(12).font_semibold().text_color(t.muted)
      .child(head("Column", 220)).child(head("Holds", 110)).child(head("Filled", 80, true)).child(head("Distinct", 90, true))
      .child(div().flex_1().min_w(0).child("Range, or most common")))
    .child(div().h(1).bg(alpha(t.foreground, 0.1)))
    .children(summaryLines(result).map((line) => h_flex().h(34).items_center().border_b(1).border_color(alpha(t.border, 0.5)).text_size(13)
      .child(div().w(220).flex_none().pr(16).truncate().text_color(t.foreground).child(line.name))
      .child(div().w(110).flex_none().pr(16).text_color(t.muted).child(line.holds))
      .child(figure(line.filled, 80))
      .child(figure(line.distinct, 90))
      .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(line.range))));
}
