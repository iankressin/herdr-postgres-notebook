// The open notebook as one page: its name, its folder, Run all, then each query.
import { div } from "gpui-kit";
import { h_flex, v_flex, Input } from "gpui-base";
import { folderPath } from "../notebooks.js";
import { querySection } from "./query.js";
import { SERIF, button, icon, keepFocus } from "./kit.js";

export function page(view, t) {
  return div().id("pg-page").flex_1().min_w(0).h_full().overflow_y_scrollbar().bg(t.background)
    .child(v_flex().w_full().px(56).pt(40).pb(120).items_center()
      .child(v_flex().w_full().max_w(1040).gap(44).children(body(view, t))));
}

const bigTitle = (text, t) => div().font_family(SERIF).text_size(36).font_semibold().text_color(t.foreground).child(text);

function notice(heading, text, t, action = null) {
  return [v_flex().gap(10)
    .child(bigTitle(heading, t))
    .child(div().max_w(640).text_size(14).line_height("150%").text_color(t.muted).child(text))
    .when(Boolean(action), (e) => e.child(h_flex().pt(6).child(action)))];
}

function body(view, t) {
  const file = view.file;
  if (!view.db) return notice("Postgres", view.databasesError ?? "Reading the databases…", t);
  if (view.databases.length > 0 && !view.databases.includes(view.db)) {
    return notice(view.db, `This server has no database named ${view.db}. Pick one on the left.`, t);
  }
  if (!file || file.state === "loading") return notice(view.db, "Reading notebooks…", t);
  if (file.state === "broken") return notice(view.db, "The notebooks file could not be read, so nothing here is saved. The notice says why.", t);
  const notebook = view.notebook();
  if (!notebook) {
    return notice(view.db, "No notebook is open. Make one, or click a table on the left to query it.", t,
      button("pg-first-notebook", t).on_click((_e, cx) => view.newNotebook(cx)).child(icon("plus", 12, t.muted)).child("New notebook"));
  }
  const path = folderPath(file.doc, notebook.folder);
  const sections = notebook.queries.flatMap((q) => (view.cells.has(q.id) ? [querySection(view, q, view.cells.get(q.id), t)] : []));
  return [
    h_flex().gap(16).items_end()
      .child(v_flex().flex_1().min_w(0).gap(8)
        .child(view.edit?.key === "title"
          ? keepFocus(div().id("pg-title-field").h(52).px(6).rounded(10).border_1().border_color(t.accent).cursor_text()
            .child(Input.new(view.editInput).h_full().font_family(SERIF).text_size(36).font_semibold()))
          : bigTitle(notebook.name, t).id("pg-title").cursor_text().tooltip("Rename this notebook").on_click((_e, cx) => view.editTitle(cx)))
        .when(path.length > 0, (e) => e.child(div().text_size(13.5).text_color(t.muted).child(path.join(" / "))))
        .child(div().max_w(640).text_size(14).line_height("150%").text_color(t.muted).child("Read-only. Nothing here can change the database.")))
      .when(sections.length > 0, (e) => e.child(button("pg-run-all", t).on_click((_e, cx) => view.runAll(cx)).child(icon("play", 11, t.muted)).child("Run all"))),
    ...(sections.length > 0 ? sections : [div().text_size(14).text_color(t.muted).child("Click a table on the left, or add a query.")]),
    h_flex().child(button("pg-add", t).on_click((_e, cx) => view.addQuery("select ", cx)).child(icon("plus", 12, t.muted)).child("Add a query")),
  ];
}
