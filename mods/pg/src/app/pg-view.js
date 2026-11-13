import { View } from "gpui-kit";
import { h_flex, InputState } from "gpui-base";
import { props, run, setShared, spaces, theme, watchFolder } from "herdr";
import { Assistant } from "../ai/assistant.js";
import { Panel } from "../ui/panel.js";
import { SERVER_KEY, parseServer } from "../postgres/connection.js";
import { ADMIN_DATABASE } from "../postgres/client.js";
import { LIST_TABLES_SQL, STATS_SQL, columnsSql, parseColumns, parseStats, parseTables } from "../postgres/catalog.js";
import { openCommand } from "../ui/navigation.js";
import * as nb from "../notebooks/document.js";
import { ident } from "../results/format.js";
import { toggledSeries } from "../charts/plan.js";
import { NotebookFile } from "../notebooks/file.js";
import { currentServer, createServices } from "../runtime/services.js";
import { ViewWorker } from "../runtime/view-worker.js";
import { QuerySession } from "./query-session.js";
import { explorer } from "../ui/explorer.js";
import { page } from "../ui/page.js";
import { preparations } from "../ui/query.js";
import { createSqlEditor } from "../ui/query-editor.js";

const SAVE_AFTER_MS = 600;
const messageOf = (e) => String(e?.message ?? e);
const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

export default class Pg extends View {
  init(_props, cx) {
    this.worker = new ViewWorker(cx);
    this.services = createServices();
    this.server = currentServer();
    // The app refuses an import from another mod folder, so the sidebar panel is a second view of this mod.
    if (props()?.view === "panel") {
      this.panel = new Panel(() => this.services.postgres.listDatabases(), this, cx);
      return;
    }
    this.handle = cx.focus_handle();
    this.wantedNotebook = props()?.notebook ?? null;
    // Runtime state of each query of the open notebook (its editor, its last result), by query id.
    this.queries = new QuerySession(this, { ...this.services, createEditor: createSqlEditor, prepare: preparations });
    this.active = null;
    this.load = 0;
    this.loadingTables = false;
    // One inline text field at a time: { key, input, commit }.
    this.edit = null;
    this.serverError = null;
    this.ui = { hover: null, menu: null, moving: null, deleting: null };
    this.ai = new Assistant(this);
    this.ai.loadAgents(cx);
    // The open request box: "new" for a query to write, else the id of the query to edit.
    this.asking = null;
    this.askNew = InputState.new({ placeholder: "Describe the query you want, in your own words" });
    this.askEdit = InputState.new({ placeholder: "What should be different in its results?" });
    for (const input of [this.askNew, this.askEdit]) {
      input.on("submit", (_e, cx) => { if (this.askInput() === input) this.submitAsk(cx); });
    }

    this.serverInput = InputState.new({ placeholder: "user@host:port" });
    this.editInput = InputState.new({});
    for (const input of [this.serverInput, this.editInput]) {
      input.on("submit", (_e, cx) => { if (this.edit?.input === input) this.finishEdit(true, cx, true); });
      // A name left half typed is kept. The server field stays open until Enter or Esc: closing
      // it on a click elsewhere would pull the explorer up under the pointer and lose the click.
      input.on("blur", (_e, cx) => { if (this.edit?.input === input && this.edit.key !== "server") this.finishEdit(true, cx, false); });
    }

    this.tableFilter = "";
    this.typingFilter = false;
    this.filterInput = InputState.new({ placeholder: "Filter tables" });
    this.filterInput.on("change", (_e, cx) => { this.tableFilter = this.filterInput.value(); cx.notify(); });
    this.filterInput.on("focus", (_e, cx) => { this.typingFilter = true; cx.notify(); });
    this.filterInput.on("blur", (_e, cx) => { this.typingFilter = false; cx.notify(); });

    this.connect(props()?.database ?? null, cx);
    // Results kept for saving are deleted when their query reruns or the page closes; a crash
    // leaves them behind, so ones a day old go here.
    this.spawn(cx, async () => { await this.services.resultFiles.cleanup(); });
  }

  spawn(_cx, job) {
    this.worker.spawn(job);
  }

  async close() {
    this.closed = true;
    this.worker.close();
    if (this.panel) return;
    await Promise.all([this.file?.save(), this.queries.releaseCells(), this.ai.stopAll()]);
  }

  // ── Server and databases ───────────────────────────────────────────────────

  connect(database, cx) {
    this.file?.save();
    this.ai.stopAll();
    this.asking = null;
    this.load++;
    this.databases = [];
    this.databasesError = null;
    this.db = null;
    this.file = null;
    this.queries.releaseCells();
    this.loadDatabases(cx);
    if (database) this.openDatabase(database, cx);
  }

  // A save in one copy of the mod makes every copy draw again, and each copy then follows the new server.
  followServer(cx) {
    const server = currentServer();
    if (server === this.server) return;
    this.server = server;
    this.spawn(cx, async (cx) => {
      // This call comes from render, and cx.notify() throws in render. The sleep leaves that phase.
      await cx.sleep(0);
      if (this.panel) this.panel.reconnect(cx);
      else this.connect(this.db ?? props()?.database ?? null, cx);
      cx.notify();
    });
  }

  editServer(cx) {
    this.startEdit("server", this.serverInput, this.server, (text) => {
      const clean = text.trim();
      if (!parseServer(clean)) { this.serverError = true; return false; }
      if (clean !== this.server) setShared(SERVER_KEY, clean);
    }, cx);
  }

  loadDatabases(cx) {
    const load = this.load;
    this.spawn(cx, async (cx) => {
      try {
        const list = await this.services.postgres.listDatabases();
        if (load !== this.load) return;
        this.databases = list;
        this.databasesError = null;
        if (!this.db) {
          const first = list.find((d) => d !== ADMIN_DATABASE) ?? list[0];
          if (first) this.openDatabase(first, cx);
        }
        this.settle(cx);
      } catch (e) {
        if (load !== this.load) return;
        this.databasesError = messageOf(e);
      }
      cx.notify();
    });
  }

  // Each database has its own tab, so a click on another one goes to that tab.
  goToDatabase(name) {
    if (name === this.db) return;
    const [command, args] = openCommand(spaces(), name);
    run(command, args);
  }

  openDatabase(name, cx) {
    this.db = name;
    this.tables = { loading: true, list: [], error: null };
    this.stats = new Map();
    this.columns = {};
    this.tableOpen = {};
    this.loadTables(cx);
    this.openFile(cx);
  }

  loadTables(cx) {
    const { db, load } = this;
    this.loadingTables = true;
    this.spawn(cx, async (cx) => {
      const [tables, stats] = await Promise.allSettled([this.services.postgres.catalog(db, LIST_TABLES_SQL), this.services.postgres.catalog(db, STATS_SQL)]);
      if (load !== this.load || db !== this.db) return;
      this.tables = tables.status === "fulfilled"
        ? { loading: false, list: parseTables(tables.value), error: null }
        : { loading: false, list: [], error: messageOf(tables.reason) };
      if (stats.status === "fulfilled") this.stats = parseStats(stats.value);
      this.loadingTables = false;
      cx.notify();
    });
  }

  refresh(cx) {
    this.loadDatabases(cx);
    this.columns = {};
    this.tableOpen = {};
    this.loadTables(cx);
    cx.notify();
  }

  toggleTable(table, cx) {
    const key = `${table.schema}.${table.name}`;
    this.tableOpen[key] = !this.tableOpen[key];
    if (this.tableOpen[key] && !this.columns[key]) {
      const { db, columns } = this;
      columns[key] = { loading: true, list: [] };
      this.spawn(cx, async (cx) => {
        try {
          columns[key] = { loading: false, list: parseColumns(await this.services.postgres.catalog(db, columnsSql(table.schema, table.name))) };
        } catch (e) {
          columns[key] = { loading: false, list: [], error: messageOf(e) };
        }
        cx.notify();
      });
    }
    cx.notify();
  }

  // ── The notebooks file ─────────────────────────────────────────────────────

  openFile(cx) {
    this.queries.releaseCells();
    this.nbId = null;
    this.closeMenus();
    const file = new NotebookFile(this.server, this.db, this.services.notebookStorage);
    this.file = file;
    this.spawn(cx, async (cx) => {
      await file.load();
      if (this.file !== file) return;
      this.settle(cx);
      cx.notify();
      this.watch(file, cx);
    });
  }

  // Another tab wrote the file: show what is there now.
  watch(file, cx) {
    this.spawn(cx, async (cx) => {
      while (this.file === file) {
        try { await watchFolder(file.dir); } catch { await cx.sleep(2000); }
        if (this.file !== file) return;
        if (await file.reload()) {
          this.settle(cx);
          cx.notify();
        }
      }
    });
  }

  // Applies a step to the document now and writes the file once changes stop for a moment.
  change(step, cx) {
    const file = this.file;
    if (file?.state !== "ready" || !file.change(step)) return;
    const count = file.changes;
    this.spawn(cx, async (cx) => {
      await cx.sleep(SAVE_AFTER_MS);
      if (count !== file.changes) return;
      if ((await file.save()) && this.file === file) {
        this.settle(cx);
        cx.notify();
      }
    });
  }

  // Brings the page in line with the document: the Overview for a new database, an open
  // notebook when the shown one is gone, an editor for each of its queries.
  settle(cx) {
    const file = this.file;
    if (file?.state !== "ready") return;
    if (file.fresh && this.databases.includes(this.db)) {
      file.fresh = false;
      const id = nb.newId("n");
      this.change((d) => nb.addOverview(d, { id, now: now() }), cx);
    }
    const doc = file.doc;
    if (!nb.notebookOf(doc, this.nbId)) {
      const wanted = [this.wantedNotebook, doc.lastOpened, nb.firstNotebook(doc)?.id].find((id) => id && nb.notebookOf(doc, id));
      if (wanted) this.wantedNotebook = null;
      this.queries.releaseCells();
      this.nbId = null;
      if (wanted) {
        this.showNotebook(wanted, cx);
        return;
      }
    }
    this.queries.syncCells();
  }

  notebook() {
    return this.file?.state === "ready" ? nb.notebookOf(this.file.doc, this.nbId) : null;
  }

  // Opening a notebook runs every query in it.
  showNotebook(id, cx) {
    if (id !== this.nbId) {
      this.queries.releaseCells();
      this.nbId = id;
      this.change((d) => nb.setLastOpened(d, id), cx);
    }
    this.queries.syncCells();
    this.queries.runAll(cx);
  }

  openNotebook(id, cx) {
    this.closeMenus();
    if (id !== this.nbId) this.showNotebook(id, cx);
    cx.notify();
  }

  // ── Queries ────────────────────────────────────────────────────────────────

  addQuery(sql, cx, { run = false } = {}) {
    const notebook = this.notebook();
    if (!notebook) return;
    const id = nb.newId("q");
    this.change((d) => nb.addQuery(d, notebook.id, nb.newQuery(id, sql), now()), cx);
    this.queries.syncCells();
    this.active = id;
    if (run && this.queries.cells.has(id)) this.queries.runCell(this.queries.cells.get(id), cx);
    cx.notify();
  }

  // A click on a table adds a query for it; with no notebook open, a notebook named after it.
  queryTable(table, cx) {
    if (!this.notebook()) {
      const id = nb.newId("n");
      this.change((d) => nb.addNotebook(d, { id, name: table.name, now: now() }), cx);
      this.showNotebook(id, cx);
    }
    this.addQuery(`select *\nfrom ${ident(table.schema)}.${ident(table.name)}\nlimit 100`, cx, { run: true });
  }

  // A click on a column adds its name to the query being written.
  insertText(text, cx) {
    const cell = this.queries.cells.get(this.active) ?? [...this.queries.cells.values()].at(-1);
    if (!cell) return;
    const value = cell.editor.value();
    cell.editor.set_value(value + (/[\s(,]$/.test(value) || value === "" ? "" : " ") + text);
    this.queries.recordSql(cell, cx);
    cx.notify();
  }

  removeQuery(query, cx) {
    const { nbId } = this;
    this.ai.stop(query.id);
    if (this.asking === query.id) this.asking = null;
    this.change((d) => nb.removeQuery(d, nbId, query.id, now()), cx);
    this.queries.syncCells();
    cx.notify();
  }

  setView(query, view, cx) {
    const { nbId } = this;
    this.change((d) => nb.updateQuery(d, nbId, query.id, { view }, now()), cx);
    cx.notify();
  }

  // The measure is saved by column name, so it survives the columns moving around.
  setMeasure(query, measure, cx) {
    const { nbId } = this;
    this.change((d) => nb.updateQuery(d, nbId, query.id, { measure }, now()), cx);
    cx.notify();
  }

  // `chart` is a key of CHARTS, or null for Automatic.
  setChart(query, chart, cx) {
    const { nbId } = this;
    this.change((d) => nb.updateQuery(d, nbId, query.id, { chart }, now()), cx);
    cx.notify();
  }

  // `x` is the column the chart runs along, by name; null is the chart's usual one.
  setX(query, x, cx) {
    const { nbId } = this;
    this.change((d) => nb.updateQuery(d, nbId, query.id, { x }, now()), cx);
    cx.notify();
  }

  // Starts from the series drawn now, so the first click keeps the default ones. Turning off the
  // last series, or on a seventh, does nothing.
  toggleSeries(query, name, cx) {
    const result = this.queries.cells.get(query.id)?.result;
    const series = result ? toggledSeries(result, query, name) : null;
    if (!series) return;
    const { nbId } = this;
    this.change((d) => nb.updateQuery(d, nbId, query.id, { series }, now()), cx);
    cx.notify();
  }

  // Work too slow to do while drawing, such as a chart over a big result. The page draws again
  // once it is done.
  drawLater(work) {
    this.spawn(null, async (cx) => {
      await cx.sleep(0);
      try {
        work();
      } finally {
        cx.notify();
      }
    });
  }

  // ── Asking an agent ────────────────────────────────────────────────────────

  askInput(target = this.asking) {
    return target === "new" ? this.askNew : target ? this.askEdit : null;
  }

  // Its button again closes the box.
  openAsk(target, cx) {
    if (this.edit) this.finishEdit(this.edit.key !== "server", cx, false);
    this.closeMenus();
    if (this.asking === target) {
      this.closeAsk(cx);
      return;
    }
    this.asking = target;
    const input = this.askInput(target);
    input.set_value("");
    input.focus();
    cx.notify();
  }

  closeAsk(cx) {
    this.asking = null;
    this.handle.focus();
    cx.notify();
  }

  // A query to write starts as the request in a comment, so it is not lost if the agent fails.
  submitAsk(cx) {
    const target = this.asking;
    const request = this.askInput(target)?.value().trim();
    if (!request) return;
    this.closeMenus();
    this.closeAsk(cx);
    if (target !== "new") {
      this.ai.start("edit", target, request, cx);
      return;
    }
    const notebook = this.notebook();
    if (!notebook) return;
    const id = nb.newId("q");
    const sql = request.split("\n").map((line) => `-- ${line}`).join("\n");
    this.change((d) => nb.addQuery(d, notebook.id, nb.newQuery(id, sql), now()), cx);
    this.queries.syncCells();
    this.active = id;
    this.ai.start("write", id, request, cx);
  }

  // ── Inline text fields ─────────────────────────────────────────────────────

  startEdit(key, input, value, commit, cx) {
    if (this.edit) this.finishEdit(this.edit.key !== "server", cx, false);
    this.closeMenus();
    this.serverError = null;
    this.edit = { key, input, commit };
    input.set_value(value);
    input.focus();
    cx.notify();
  }

  // `commit` returning false keeps the field open (a server that does not parse).
  finishEdit(save, cx, refocus) {
    const edit = this.edit;
    if (!edit) return;
    if (save && edit.commit(edit.input.value(), cx) === false) {
      cx.notify();
      return;
    }
    this.edit = null;
    this.serverError = null;
    if (refocus) this.handle.focus();
    cx.notify();
  }

  editTitle(cx) {
    const notebook = this.notebook();
    if (!notebook) return;
    this.startEdit("title", this.editInput, notebook.name, (text, cx) => this.change((d) => nb.rename(d, notebook.id, text, now()), cx), cx);
  }

  // A title left empty, or the same as the automatic one, stays automatic.
  editQueryTitle(query, cx) {
    const { nbId } = this;
    this.startEdit(`qtitle:${query.id}`, this.editInput, nb.queryTitle(query), (text, cx) => {
      const sql = this.queries.cells.get(query.id)?.editor.value() ?? query.sql;
      const title = text.trim() === nb.autoTitle(sql) ? "" : text.trim();
      this.change((d) => nb.updateQuery(d, nbId, query.id, { title }, now()), cx);
    }, cx);
  }

  // ── The notebook tree ──────────────────────────────────────────────────────

  hoverRow(id, hovered, cx) {
    const next = hovered ? id : this.ui.hover === id ? null : this.ui.hover;
    if (next === this.ui.hover) return;
    this.ui.hover = next;
    cx.notify();
  }

  openMenu(id, cx) {
    this.ui = { ...this.ui, menu: id, moving: null, deleting: null };
    cx.notify();
  }

  closeMenus(cx) {
    this.ui = { hover: this.ui.hover, menu: null, moving: null, deleting: null };
    cx?.notify();
  }

  newNotebook(cx) {
    const id = nb.newId("n");
    this.change((d) => nb.addNotebook(d, { id, name: "Untitled", now: now() }), cx);
    this.showNotebook(id, cx);
    this.startRename(id, cx);
  }

  newFolder(cx) {
    const id = nb.newId("f");
    this.change((d) => nb.addFolder(d, { id, name: "New folder" }), cx);
    this.startRename(id, cx);
  }

  toggleFolder(id, cx) {
    const folder = nb.folderOf(this.file.doc, id);
    if (folder) this.change((d) => nb.setFolderOpen(d, id, !folder.open), cx);
    this.closeMenus(cx);
  }

  startRename(id, cx) {
    const item = nb.itemOf(this.file.doc, id);
    if (!item) return;
    this.startEdit(`rename:${id}`, this.editInput, item.name, (text, cx) => this.change((d) => nb.rename(d, id, text, now()), cx), cx);
  }

  startMove(id, cx) {
    this.ui = { ...this.ui, menu: null, moving: id, deleting: null };
    cx.notify();
  }

  // The folder it lands in, and the folders above that, open so it stays in sight.
  moveItem(id, target, cx) {
    this.change((d) => nb.move(d, id, target, now()), cx);
    for (let f = nb.folderOf(this.file.doc, target); f; f = nb.folderOf(this.file.doc, f.parent)) {
      const open = f.id;
      this.change((d) => nb.setFolderOpen(d, open, true), cx);
    }
    this.closeMenus(cx);
  }

  duplicateNotebook(id, cx) {
    const copy = nb.newId("n");
    this.change((d) => nb.duplicate(d, id, { id: copy, now: now() }), cx);
    this.closeMenus();
    this.showNotebook(copy, cx);
    cx.notify();
  }

  // A folder goes at once, since what is in it stays; a notebook asks first, in its row.
  askDelete(id, cx) {
    if (nb.folderOf(this.file.doc, id)) {
      this.deleteItem(id, cx);
      return;
    }
    this.ui = { ...this.ui, menu: null, moving: null, deleting: id };
    cx.notify();
  }

  deleteItem(id, cx) {
    this.change((d) => nb.remove(d, id), cx);
    this.closeMenus();
    this.settle(cx);
    cx.notify();
  }

  // ── Drawing ────────────────────────────────────────────────────────────────

  onKey(e, cx) {
    if (e.key !== "escape") return;
    if (this.edit) {
      this.finishEdit(false, cx, true);
    } else if (this.ui.menu || this.ui.moving || this.ui.deleting) {
      this.closeMenus(cx);
    } else if (this.asking) {
      this.closeAsk(cx);
    } else if (this.typingFilter) {
      this.filterInput.set_value("");
      this.tableFilter = "";
      this.handle.focus();
      cx.notify();
    } else {
      return;
    }
    cx.stop_propagation();
  }

  render(cx) {
    this.followServer(cx);
    if (this.panel) return this.panel.render();
    const t = theme();
    return h_flex().id("pg").size_full().min_h(0).overflow_hidden().bg(t.background).text_color(t.foreground).text_size(13)
      .track_focus(this.handle)
      .on_key_down((e, cx) => this.onKey(e, cx))
      .on_mouse_down("left", () => this.handle.focus())
      .child(explorer(this, t))
      .child(page(this, t));
  }
}
