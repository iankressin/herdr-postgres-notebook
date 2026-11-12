// The explorer on the left: the server, the databases, the open database's notebooks, its tables.
import { div } from "gpui-kit";
import { h_flex, v_flex, Input, Popup } from "gpui-base";
import { SERVER_HELP, filterTables, groupBySchema } from "../logic.js";
import { moveTargets, treeRows } from "../notebooks.js";
import { formatBytes, ident, kindOfType } from "../shape.js";
import { CLEAR, alpha, icon, iconButton, keepFocus, kindIcon, mono } from "./kit.js";

const row = () => h_flex().h(30).flex_none().px(8).gap(8).items_center().rounded(8);
const heading = (text, t) => div().flex_1().text_size(12).font_medium().text_color(t.muted).child(text);

export function explorer(view, t) {
  return v_flex().w(272).flex_none().h_full().min_h(0).bg(t.chrome)
    .child(server(view, t))
    .child(v_flex().id("pg-explorer").flex_1().min_h(0).overflow_y_scrollbar().px(10).pb(80)
      .child(databases(view, t))
      .when(Boolean(view.db), (e) => e.child(notebooks(view, t)).child(tables(view, t))));
}

function server(view, t) {
  const editing = view.edit?.key === "server";
  const note = (text, color) => div().px(8).text_size(11.5).line_height("140%").text_color(color).child(text);
  return v_flex().flex_none().px(10).pt(14).pb(4).gap(5)
    .child(editing
      ? keepFocus(h_flex().id("pg-server-field").h(30).px(8).items_center().rounded(8).bg(t.background).border_1().border_color(t.accent).cursor_text()
        .child(div().flex_1().min_w(0).child(Input.new(view.serverInput).h_full().text_size(12.5).font_family(mono()))))
      : row().id("pg-server").cursor_pointer().hover((st) => st.bg(t.hover)).tooltip("Change the server")
        .on_click((_e, cx) => view.editServer(cx))
        .child(div().flex_1().min_w(0).truncate().text_size(12.5).font_family(mono()).text_color(t.muted).child(view.server))
        .child(icon("pencil", 11, t.dim)))
    .when(editing && Boolean(view.serverError), (e) => e.child(note(SERVER_HELP, t.ansi1)))
    .when(editing && !view.serverError, (e) => e.child(note("Enter connects. Esc cancels.", t.dim)))
    .when(!editing && Boolean(view.databasesError), (e) => e.child(note(view.databasesError, t.ansi1)));
}

function databases(view, t) {
  const spinning = view.loadingTables;
  return v_flex().flex_none().pt(8)
    .when(view.databases.length === 0 && !view.databasesError, (e) => e.child(div().px(8).py(6).text_size(12.5).text_color(t.dim).child("Loading databases…")))
    .child(v_flex().id("pg-dbs").max_h(30 * 7).overflow_y_scrollbar().gap(2).children(view.databases.map((name) => {
      const on = name === view.db;
      return row().id(`pg-db-${name}`).cursor_pointer().when(on, (e) => e.bg(t.selected)).hover((st) => st.bg(on ? t.selected : t.hover))
        .on_click((_e, cx) => view.goToDatabase(name, cx))
        .child(icon("database", 15, on ? t.accent : t.dim))
        .child(div().flex_1().min_w(0).truncate().text_size(13.5).when(on, (e) => e.font_medium()).text_color(on ? t.foreground : t.muted).child(name))
        .when(on, (e) => e.child(div().id("pg-refresh").size(22).flex_none().flex().items_center().justify_center().rounded(6).hover((st) => st.bg(t.hover))
          .tooltip("Load again").on_click((_e, cx) => { cx.stop_propagation(); view.refresh(cx); })
          .child(spinning ? icon("spinner", 12, t.muted).spin(900) : icon("refresh", 12, t.muted))));
    })));
}

// ── Notebooks ────────────────────────────────────────────────────────────────

function notebooks(view, t) {
  const file = view.file;
  const rows = file?.state === "ready" ? treeRows(file.doc) : [];
  const ready = file?.state === "ready";
  return v_flex().flex_none()
    .child(h_flex().px(8).pt(20).pb(6).gap(2).items_center()
      .child(heading("Notebooks", t))
      .when(ready, (e) => e
        .child(iconButton("pg-new-notebook", "plus", t).tooltip("New notebook").on_click((_e, cx) => view.newNotebook(cx)))
        .child(iconButton("pg-new-folder", "folder-plus", t).tooltip("New folder").on_click((_e, cx) => view.newFolder(cx)))))
    .when(!file || file.state === "loading", (e) => e.child(div().px(8).py(4).text_size(12.5).text_color(t.dim).child("Reading notebooks…")))
    .when(file?.state === "broken", (e) => e.child(div().px(8).py(4).text_size(12.5).text_color(t.ansi1).child("The notebooks file could not be read.")))
    .when(ready && rows.length === 0, (e) => e.child(div().px(8).py(4).text_size(12.5).text_color(t.dim).child("No notebooks yet.")))
    .children(rows.flatMap((r) => treeRow(view, r, t)));
}

function treeRow(view, r, t) {
  const { kind, item, depth } = r;
  const id = item.id;
  const pad = 8 + depth * 16;
  const folder = kind === "folder";
  const mark = folder ? icon(item.open ? "folder-open" : "folder", 14, t.dim) : icon("notebook", 14, id === view.nbId ? t.accent : t.dim);
  const chevron = folder ? icon(item.open ? "chevron-down" : "chevron-right", 11, t.dim) : div().w(11).flex_none();

  if (view.edit?.key === `rename:${id}`) {
    return [row().id(`pg-rename-${id}`).pl(pad).bg(t.background).border_1().border_color(t.accent)
      .child(chevron).child(mark)
      .child(keepFocus(div().id(`pg-rename-field-${id}`).flex_1().min_w(0).h_full().cursor_text().child(Input.new(view.editInput).h_full().text_size(13.5))))];
  }

  if (view.ui.deleting === id) {
    const choice = (key, label, color, action) => div().id(`pg-del-${key}-${id}`).h(22).px(8).flex().items_center().rounded(6).cursor_pointer()
      .text_size(12).font_medium().text_color(color).hover((st) => st.bg(t.hover)).on_click(action).child(label);
    return [row().id(`pg-del-${id}`).pl(pad).pr(4).bg(alpha(t.ansi1, 0.1))
      .child(div().flex_1().min_w(0).truncate().text_size(13).text_color(t.foreground).child(`Delete ${item.name}?`))
      .child(choice("yes", "Delete", t.ansi1, (_e, cx) => view.deleteItem(id, cx)))
      .child(choice("no", "Keep", t.muted, (_e, cx) => view.closeMenus(cx)))];
  }

  const open = !folder && id === view.nbId;
  const shown = view.ui.hover === id || view.ui.menu === id;
  const line = row().id(`pg-row-${id}`).w_full().pl(pad).pr(4).cursor_pointer()
    .when(open, (e) => e.bg(t.selected)).hover((st) => st.bg(open ? t.selected : t.hover))
    .on_hover((hovered, cx) => view.hoverRow(id, hovered, cx))
    .on_click((_e, cx) => (folder ? view.toggleFolder(id, cx) : view.openNotebook(id, cx)))
    .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); view.openMenu(id, cx); })
    .child(chevron).child(mark)
    .child(div().flex_1().min_w(0).truncate().text_size(13.5).when(open, (e) => e.font_medium()).text_color(open ? t.foreground : t.muted).child(item.name))
    .child(iconButton(`pg-more-${id}`, "more", t).when(!shown, (e) => e.invisible()).tooltip("More")
      .on_click((_e, cx) => { cx.stop_propagation(); view.openMenu(id, cx); }));
  const withMenu = Popup.new(`pg-menu-${id}`, line).anchor("top_right")
    .when(view.ui.menu === id, (p) => p.content(menu(view, r, t)));
  return view.ui.moving === id ? [withMenu, moveList(view, id, depth, t)] : [withMenu];
}

function menu(view, r, t) {
  const id = r.item.id;
  const entry = (key, name, label, action, danger = false) => h_flex().id(`pg-menu-${key}-${id}`).h(30).px(10).gap(10).items_center().rounded(7).cursor_pointer()
    .text_size(13).text_color(danger ? t.ansi1 : t.foreground).hover((st) => st.bg(t.hover))
    .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); action(cx); })
    .child(icon(name, 13, danger ? t.ansi1 : t.muted)).child(label);
  return v_flex().id(`pg-menu-body-${id}`).w(180).mt(4).p(4).gap(1).rounded(10).bg(t.popover).border_1().border_color(t.border).shadow_lg()
    .on_mouse_down_out((_e, cx) => view.closeMenus(cx))
    .child(entry("rename", "pencil", "Rename", (cx) => view.startRename(id, cx)))
    .child(entry("move", "move", "Move to…", (cx) => view.startMove(id, cx)))
    .when(r.kind === "notebook", (e) => e.child(entry("copy", "copy", "Duplicate", (cx) => view.duplicateNotebook(id, cx))))
    .child(entry("delete", "trash", "Delete", (cx) => view.askDelete(id, cx), true));
}

function moveList(view, id, depth, t) {
  return v_flex().id(`pg-move-${id}`).flex_none().ml(8 + depth * 16).my(4).p(4).gap(1).rounded(9).bg(t.background).border_1().border_color(t.border)
    .child(div().px(8).pt(2).pb(4).text_size(11.5).text_color(t.dim).child("Move to"))
    .children(moveTargets(view.file.doc, id).map((target) => h_flex().id(`pg-move-${id}-${target.id ?? "top"}`).h(28).flex_none()
      .pl(8 + target.depth * 14).pr(8).gap(8).items_center().rounded(7).text_size(13)
      .when(target.here, (e) => e.text_color(t.dim))
      .when(!target.here, (e) => e.text_color(t.foreground).cursor_pointer().hover((st) => st.bg(t.hover)).on_click((_e, cx) => view.moveItem(id, target.id, cx)))
      .child(target.id === null ? div().w(13).flex_none() : icon("folder", 13, t.dim))
      .child(div().flex_1().min_w(0).truncate().child(target.name))
      .when(target.here, (e) => e.child(div().text_size(11).child("here")))))
    .child(h_flex().id(`pg-move-cancel-${id}`).h(26).flex_none().px(8).items_center().rounded(7).cursor_pointer().text_size(12).text_color(t.muted)
      .hover((st) => st.bg(t.hover)).on_click((_e, cx) => view.closeMenus(cx)).child("Cancel"));
}

// ── Tables ───────────────────────────────────────────────────────────────────

function tables(view, t) {
  const state = view.tables;
  const groups = groupBySchema(filterTables(state.list, view.tableFilter));
  return v_flex().flex_none()
    .child(h_flex().px(8).pt(20).pb(6).child(heading("Tables", t)))
    .child(keepFocus(h_flex().id("pg-filter").h(32).px(10).gap(8).items_center().rounded(9).bg(t.background).border_1()
      .border_color(view.typingFilter ? t.accent : CLEAR).cursor_text()
      .child(icon("search", 13, view.typingFilter ? t.accent : t.dim))
      .child(div().flex_1().min_w(0).child(Input.new(view.filterInput).h_full().text_size(13)))))
    .when(state.loading && state.list.length === 0, (e) => e.child(div().px(8).py(8).text_size(12.5).text_color(t.dim).child("Reading tables…")))
    .when(Boolean(state.error), (e) => e.child(div().px(8).py(8).text_size(12).text_color(t.ansi1).child(state.error)))
    .when(!state.loading && !state.error && state.list.length === 0, (e) => e.child(div().px(8).py(8).text_size(12.5).text_color(t.dim).child("This database has no tables.")))
    .children(groups.flatMap((group) => [
      div().px(8).pt(14).pb(6).text_size(12).font_medium().text_color(t.muted).child(group.schema),
      ...group.tables.flatMap((table) => tableRows(view, table, t)),
    ]));
}

function tableRows(view, table, t) {
  const key = `${table.schema}.${table.name}`;
  const open = Boolean(view.tableOpen[key]);
  const cols = view.columns[key];
  const stat = view.stats.get(key);
  const head = row().id(`pg-t-${key}`).cursor_pointer().hover((st) => st.bg(t.hover)).tooltip("Query this table")
    .on_click((_e, cx) => view.queryTable(table, cx))
    .child(div().id(`pg-chev-${key}`).size(18).flex_none().flex().items_center().justify_center().rounded(5).hover((st) => st.bg(t.hover))
      .tooltip("Show columns")
      .on_click((_e, cx) => { cx.stop_propagation(); view.toggleTable(table, cx); })
      .child(icon(open ? "chevron-down" : "chevron-right", 12, t.dim)))
    .child(div().flex_1().min_w(0).truncate().text_size(13.5).text_color(t.foreground).child(table.name))
    .when(Boolean(stat?.bytes), (e) => e.child(div().flex_none().text_size(11).font_family(mono()).text_color(t.dim).child(formatBytes(stat.bytes))));
  if (!open) return [head];
  if (cols?.loading) return [head, div().pl(34).py(4).text_size(12).text_color(t.dim).child("Reading columns…")];
  if (cols?.error) return [head, div().pl(34).py(4).text_size(12).text_color(t.ansi1).child(cols.error)];
  return [head, ...(cols?.list ?? []).map((c) => h_flex().id(`pg-col-${key}.${c.name}`).h(26).flex_none().pl(34).pr(8).gap(8).items_center().rounded(7)
    .cursor_pointer().hover((st) => st.bg(t.hover)).tooltip("Add to the query")
    .on_click((_e, cx) => view.insertText(ident(c.name), cx))
    .child(kindIcon(kindOfType(c.type), t, 11))
    .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(t.muted).child(c.name))
    .when(c.pk !== null, (e) => e.child(icon("key", 10, t.ansi3))))];
}
