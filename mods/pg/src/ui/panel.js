// The small list of databases in the sidebar. A click opens the Postgres browser for that database.
import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { layout, run, spaces, theme } from "herdr";
import { openCommand } from "./navigation.js";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The sidebar is a narrow rail below this width, and a database name does not fit in the rail.
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

export class Panel {
  // `owner`: the view this panel draws in, which runs its tasks.
  constructor(listDatabases, owner, cx) {
    this.listDatabases = listDatabases;
    this.owner = owner;
    this.databases = [];
    this.error = null;
    this.loading = false;
    // A newer load makes the answer of an older load worthless.
    this.loadNumber = 0;
    this.load(cx);
  }

  reconnect(cx) {
    this.databases = [];
    this.error = null;
    this.load(cx);
  }

  load(cx) {
    const load = ++this.loadNumber;
    this.loading = true;
    cx.notify();
    this.owner.spawn(cx, async (cx) => {
      let databases = null;
      let error = null;
      try {
        databases = await this.listDatabases();
      } catch (e) {
        error = String(e?.message ?? e);
      }
      if (load !== this.loadNumber) return;
      if (databases) this.databases = databases;
      this.error = error;
      this.loading = false;
      cx.notify();
    });
  }

  open(database) {
    const [command, args] = openCommand(spaces(), database);
    run(command, args);
  }

  row(name, t) {
    return h_flex().id(`db-${name}`).h(24).flex_none().px(8).items_center().rounded(6).text_size(12).cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_click(() => this.open(name))
      .child(div().min_w(0).truncate().child(name));
  }

  render() {
    const t = theme();
    if (narrow()) return div().size_full().bg(t.chrome).border_t(1).border_color(t.border);
    const icon = svg("mods/pg/icons/panel-refresh.svg").size(12).flex_none().text_color(t.dim);
    return v_flex().size_full().min_h(0).bg(t.chrome).border_t(1).border_color(t.border).text_color(t.foreground)
      .child(h_flex().h(41).pt(14).pb(5).flex_none().pl(16).pr(10).items_center().justify_between()
        .child(div().text_size(11.5).font_medium().text_color(t.dim).child("Databases"))
        .child(div().id("db-refresh").w(20).h(20).flex().items_center().justify_center().rounded(5).cursor_pointer()
          .hover((s) => s.bg(t.hover))
          .tooltip("Load again")
          .on_click((_e, cx) => this.load(cx))
          .child(this.loading ? icon.spin(900) : icon)))
      .when(Boolean(this.error), (e) => e.child(div().flex_none().px(16).py(4).text_size(11).text_color(t.ansi1).child(this.error)))
      .child(v_flex().id("db-list").flex_1().min_h(0).px(8).overflow_y_scrollbar().children(this.databases.map((name) => this.row(name, t))));
  }
}
