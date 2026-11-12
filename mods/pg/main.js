import { View } from "gpui-kit";
import { h_flex, EditorState, InputState } from "gpui-base";
import { exec, props, run, setShared, shared, spaces, theme, watchFolder } from "herdr";
import { Panel } from "./panel.js";
import {
  LIST_DATABASES_SQL,
  LIST_TABLES_SQL,
  SERVER_KEY,
  STATS_SQL,
  columnsSql,
  errorMessage,
  limited,
  openCommand,
  parseColumns,
  parseDatabases,
  parseRows,
  parseServer,
  parseStats,
  parseTables,
  psqlArgs,
  serverText,
} from "./logic.js";
import * as nb from "./notebooks.js";
import { describe, ident } from "./shape.js";
import { NotebookFile } from "./store.js";
import { explorer } from "./ui/explorer.js";
import { mono, syntax } from "./ui/kit.js";
import { page } from "./ui/page.js";

const ADMIN_DATABASE = "postgres";
const SAVE_AFTER_MS = 600;

const currentServer = () => serverText(shared(SERVER_KEY));
const messageOf = (e) => String(e?.message ?? e);
const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

async function runPsql(database, sql) {
  const result = await exec("psql", psqlArgs(parseServer(currentServer()), database, sql)).catch(() => {
    throw new Error("Could not start psql. Install the PostgreSQL client.");
  });
  if (result.code !== 0) throw new Error(errorMessage(result.stderr));
  return result.stdout;
}

const listDatabases = async () => parseDatabases(await runPsql(ADMIN_DATABASE, LIST_DATABASES_SQL));

export default class Pg extends View {
  init(_props, cx) {
    this.server = currentServer();
    // The app refuses an import from another mod folder, so the sidebar panel is a second view of this mod.
    if (props()?.view === "panel") {
      this.panel = new Panel(listDatabases, cx);
      return;
    }
    this.handle = cx.focus_handle();
    this.wantedNotebook = props()?.notebook ?? null;
    // Runtime state of each query of the open notebook (its editor, its last result), by query id.
    this.cells = new Map();
    this.active = null;
    this.load = 0;
    this.loadingTables = false;
    // One inline text field at a time: { key, input, commit }.
    this.edit = null;
    this.serverError = null;
    this.ui = { hover: null, menu: null, moving: null, deleting: null };

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
  }

  async close() {
    if (this.panel) return;
    await this.file?.save();
    this.releaseCells();
  }

  // ── Server and databases ───────────────────────────────────────────────────

  connect(database, cx) {
    this.file?.save();
    this.load++;
    this.databases = [];
    this.databasesError = null;
    this.db = null;
    this.file = null;
    this.releaseCells();
    this.loadDatabases(cx);
    if (database) this.openDatabase(database, cx);
  }

  // A save in one copy of the mod makes every copy draw again, and each copy then follows the new server.
  followServer(cx) {
    const server = currentServer();
    if (server === this.server) return;
    this.server = server;
    cx.spawn(async (cx) => {
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
    cx.spawn(async (cx) => {
      try {
        const list = await listDatabases();
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
    cx.spawn(async (cx) => {
      const [tables, stats] = await Promise.allSettled([runPsql(db, LIST_TABLES_SQL), runPsql(db, STATS_SQL)]);
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
      cx.spawn(async (cx) => {
        try {
          columns[key] = { loading: false, list: parseColumns(await runPsql(db, columnsSql(table.schema, table.name))) };
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
    this.releaseCells();
    this.nbId = null;
    this.closeMenus();
    const file = new NotebookFile(this.server, this.db);
    this.file = file;
    cx.spawn(async (cx) => {
      await file.load();
      if (this.file !== file) return;
      this.settle(cx);
      cx.notify();
      this.watch(file, cx);
    });
  }

  // Another tab wrote the file: show what is there now.
  watch(file, cx) {
    cx.spawn(async (cx) => {
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
    cx.spawn(async (cx) => {
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
      this.releaseCells();
      this.nbId = null;
      if (wanted) {
        this.showNotebook(wanted, cx);
        return;
      }
    }
    this.syncCells();
  }

  notebook() {
    return this.file?.state === "ready" ? nb.notebookOf(this.file.doc, this.nbId) : null;
  }

  // Opening a notebook runs every query in it.
  showNotebook(id, cx) {
    if (id !== this.nbId) {
      this.releaseCells();
      this.nbId = id;
      this.change((d) => nb.setLastOpened(d, id), cx);
    }
    this.syncCells();
    this.runAll(cx);
  }

  openNotebook(id, cx) {
    this.closeMenus();
    if (id !== this.nbId) this.showNotebook(id, cx);
    cx.notify();
  }

  // ── Queries ────────────────────────────────────────────────────────────────

  makeCell(query) {
    const cell = { id: query.id, running: false, result: null, error: null, ms: null, token: 0, edWidth: null, focused: false };
    cell.editor = EditorState.new({
      language: "sql", value: query.sql, font_family: mono(), font_size: 13.5, line_numbers: false, folding: false, soft_wrap: true, syntax: syntax(theme()),
    });
    cell.editor.on("focus", (_e, cx) => { this.active = query.id; cell.focused = true; cx.notify(); });
    cell.editor.on("blur", (_e, cx) => { cell.focused = false; cx.notify(); });
    cell.editor.on("change", (_e, cx) => { this.recordSql(cell, cx); cx.notify(); });
    return cell;
  }

  // An editor for each query of the open notebook, showing the document's SQL. Typing not yet
  // saved is already in the document: its steps replay on top of another tab's write.
  syncCells() {
    const queries = this.notebook()?.queries ?? [];
    const ids = new Set(queries.map((q) => q.id));
    for (const [id, cell] of this.cells) {
      if (ids.has(id)) continue;
      cell.editor.release();
      this.cells.delete(id);
    }
    for (const query of queries) {
      const cell = this.cells.get(query.id);
      if (!cell) this.cells.set(query.id, this.makeCell(query));
      else if (cell.editor.value() !== query.sql) cell.editor.set_value(query.sql);
    }
  }

  releaseCells() {
    for (const cell of this.cells.values()) cell.editor.release();
    this.cells.clear();
    this.active = null;
  }

  recordSql(cell, cx) {
    const { nbId } = this;
    const sql = cell.editor.value();
    this.change((d) => nb.updateQuery(d, nbId, cell.id, { sql }, now()), cx);
  }

  runCell(cell, cx) {
    const source = cell.editor.value().trim();
    if (!source || !this.db) return;
    const { db } = this;
    const token = ++cell.token;
    const start = Date.now();
    cell.running = true;
    cell.error = null;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const { header, rows } = parseRows(await runPsql(db, limited(source)));
        if (token !== cell.token) return;
        cell.result = describe(header, rows);
      } catch (e) {
        if (token !== cell.token) return;
        cell.error = messageOf(e);
        cell.result = null;
      }
      cell.ms = Date.now() - start;
      cell.running = false;
      cx.notify();
    });
  }

  runAll(cx) {
    for (const query of this.notebook()?.queries ?? []) {
      const cell = this.cells.get(query.id);
      if (cell) this.runCell(cell, cx);
    }
  }

  addQuery(sql, cx, { run = false } = {}) {
    const notebook = this.notebook();
    if (!notebook) return;
    const id = nb.newId("q");
    this.change((d) => nb.addQuery(d, notebook.id, nb.newQuery(id, sql), now()), cx);
    this.syncCells();
    this.active = id;
    if (run && this.cells.has(id)) this.runCell(this.cells.get(id), cx);
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
    const cell = this.cells.get(this.active) ?? [...this.cells.values()].at(-1);
    if (!cell) return;
    const value = cell.editor.value();
    cell.editor.set_value(value + (/[\s(,]$/.test(value) || value === "" ? "" : " ") + text);
    this.recordSql(cell, cx);
    cx.notify();
  }

  removeQuery(query, cx) {
    const { nbId } = this;
    this.change((d) => nb.removeQuery(d, nbId, query.id, now()), cx);
    this.syncCells();
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
      const sql = this.cells.get(query.id)?.editor.value() ?? query.sql;
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
