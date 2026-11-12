import * as fs from "fs/promises";
import { View } from "gpui-kit";
import { h_flex, EditorState, InputState } from "gpui-base";
import { appHome, exec, home, notify, props, run, setShared, shared, spaces, theme, watchFolder } from "herdr";
import { fixable } from "./ai.js";
import { Assistant } from "./assistant.js";
import { Panel } from "./panel.js";
import {
  LIST_DATABASES_SQL,
  LIST_TABLES_SQL,
  SERVER_KEY,
  STATS_SQL,
  columnsSql,
  errorMessage,
  openCommand,
  parseColumns,
  parseDatabases,
  parseServer,
  parseStats,
  parseTables,
  psqlArgs,
  serverText,
} from "./logic.js";
import * as nb from "./notebooks.js";
import { NOTHING, READ_BYTES, fileName, readSlice, roomLeft, startReading } from "./result.js";
import { describe, ident, toggledSeries } from "./shape.js";
import { NotebookFile } from "./store.js";
import { explorer } from "./ui/explorer.js";
import { mono, syntax } from "./ui/kit.js";
import { page } from "./ui/page.js";
import { preparations } from "./ui/query.js";

const ADMIN_DATABASE = "postgres";
const SAVE_AFTER_MS = 600;
// The longest Herdr lets a program run. Queries have no limit of their own.
const QUERY_MS = 600000;

const currentServer = () => serverText(shared(SERVER_KEY));
const messageOf = (e) => String(e?.message ?? e);
const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

function execFailed(e) {
  const message = messageOf(e);
  if (/time/i.test(message)) throw new Error("The query ran for 10 minutes, the longest Herdr lets a program run.");
  if (/not found|no such file|spawn/i.test(message)) throw new Error("Could not start psql. Install the PostgreSQL client.");
  throw new Error(message);
}

// For the catalog: small answers, read from stdout.
async function runPsql(database, sql) {
  const result = await exec("psql", psqlArgs(parseServer(currentServer()), database, sql)).catch(execFailed);
  if (result.code !== 0) throw new Error(errorMessage(result.stderr));
  return result.stdout;
}

// Every result open in any pg tab. All of Herdr's mods share one script heap, so the room for
// results is counted across tabs; module code is shared by every copy of the mod, so this is too.
const holders = new Set();

const resultsDir = () => `${appHome()}/data/pg`;
const forget = (file) => (file ? fs.unlink(file).catch(() => {}) : Promise.resolve());

// psql's whole message stays on the error: an agent asked to fix the query reads it.
function queryFailed(stderr) {
  return Object.assign(new Error(errorMessage(stderr)), { detail: stderr.trim(), fixable: fixable(stderr) });
}

// For a person's query: psql writes the rows to a file, which skips exec's 8 MiB output cap and
// keeps a result too big for Herdr whole, to save. Returns the file.
async function runQuery(database, sql) {
  const dir = resultsDir();
  const file = `${dir}/result-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}.csv`;
  await fs.mkdir(dir, { recursive: true });
  try {
    const result = await exec("psql", psqlArgs(parseServer(currentServer()), database, sql, file), { timeout: QUERY_MS }).catch(execFailed);
    if (result.code !== 0) throw queryFailed(result.stderr);
    return file;
  } catch (e) {
    await forget(file);
    throw e;
  }
}

// The file's size and its text: all of it, or its first READ_BYTES when it is bigger. Herdr's
// readFile refuses files over 64 MiB, so the start of a big one is copied out with head first.
async function readStart(file) {
  const size = await exec("wc", ["-c", file]).catch(() => null);
  const bytes = size?.code === 0 ? parseInt(size.stdout.trim(), 10) || 0 : 0;
  if (bytes === 0) return { bytes, text: "", cut: false };
  if (bytes <= READ_BYTES) return { bytes, text: await fs.readFile(file, "utf8"), cut: false };
  const start = `${file}.start`;
  try {
    const copy = await exec("sh", ["-c", 'head -c "$1" "$2" > "$3"', "sh", String(READ_BYTES), file, start]);
    if (copy.code !== 0) throw new Error(copy.stderr.trim() || "Could not read the result.");
    return { bytes, text: await fs.readFile(start, "utf8"), cut: true };
  } finally {
    await forget(start);
  }
}

const listDatabases = async () => parseDatabases(await runPsql(ADMIN_DATABASE, LIST_DATABASES_SQL));

export default class Pg extends View {
  init(_props, cx) {
    this.startWorker(cx);
    this.server = currentServer();
    // The app refuses an import from another mod folder, so the sidebar panel is a second view of this mod.
    if (props()?.view === "panel") {
      this.panel = new Panel(listDatabases, this, cx);
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
    this.spawn(cx, async () => { await exec("find", [resultsDir(), "-name", "result-*", "-mmin", "+1440", "-delete"]).catch(() => {}); });
  }

  // Every task of this view runs on one worker, started in init. All pg tabs share one script engine,
  // and code that runs after an await can be inside another tab's call: a task started there belongs
  // to that tab and redraws it, and naming this view as its owner throws. The worker's cx always
  // belongs to this view, whichever call wakes it.
  startWorker(cx) {
    this.jobs = [];
    this.wake = null;
    cx.spawn(async (cx) => {
      while (!this.closed) {
        const job = this.jobs.shift();
        if (job) {
          Promise.resolve().then(() => job(cx)).catch((e) => console.error(e));
          continue;
        }
        await new Promise((resolve) => { this.wake = resolve; });
      }
    });
  }

  spawn(_cx, job) {
    this.jobs.push(job);
    const wake = this.wake;
    this.wake = null;
    wake?.();
  }

  async close() {
    this.closed = true;
    this.wake?.();
    if (this.panel) return;
    await Promise.all([this.file?.save(), this.releaseCells(), this.ai.stopAll()]);
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
    this.releaseCells();
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
    this.spawn(cx, async (cx) => {
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
      this.spawn(cx, async (cx) => {
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
    // `held`: what its result keeps in memory. `cut`: set when the result did not fit, as
    // { bytes, file, saved, saving, choice: "ask" | "show" | "drop" }; `file` is psql's whole result.
    // `temp`: psql's file while the result is being read.
    // `fixable`: the server refused the query itself, so an agent may fix it; `errorDetail` is psql's whole message.
    const cell = { id: query.id, running: false, result: null, error: null, errorDetail: null, fixable: false, ms: null, token: 0, edWidth: null, focused: false, held: NOTHING, cut: null, temp: null };
    holders.add(cell);
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
      holders.delete(cell);
      this.dropResult(cell);
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
    const gone = [...this.cells.values()].map((cell) => {
      holders.delete(cell);
      cell.editor.release();
      return this.dropResult(cell);
    });
    this.cells.clear();
    this.active = null;
    return Promise.all(gone);
  }

  recordSql(cell, cx) {
    const { nbId } = this;
    const sql = cell.editor.value();
    this.change((d) => nb.updateQuery(d, nbId, cell.id, { sql }, now()), cx);
  }

  // Rows go in a slice at a time, while they fit the room other results leave. A result that does
  // not fit keeps psql's file, and the page asks what to do with it.
  runCell(cell, cx) {
    const source = cell.editor.value().trim();
    if (!source || !this.db) return;
    const { db } = this;
    const token = ++cell.token;
    const start = Date.now();
    this.dropResult(cell);
    cell.running = true;
    cell.error = null;
    cell.errorDetail = null;
    cell.fixable = false;
    cx.notify();
    this.spawn(cx, async (cx) => {
      let file = null;
      try {
        file = await runQuery(db, source);
        if (token !== cell.token) return;
        cell.temp = file;
        const { bytes, text, cut } = await readStart(file);
        const reading = startReading(text, cut);
        while (!reading.done) {
          if (token !== cell.token) return;
          readSlice(reading, roomLeft(this.held(cell)));
          cell.held = { values: reading.values, chars: reading.chars };
          await cx.sleep(0);
        }
        if (token !== cell.token) return;
        const result = describe(reading.header, reading.rows);
        const query = this.notebook()?.queries.find((q) => q.id === cell.id) ?? null;
        for (const step of preparations(result, query)) {
          await cx.sleep(0);
          if (token !== cell.token) return;
          step();
        }
        cell.result = result;
        if (!reading.whole) {
          cell.cut = { bytes, file, saved: null, saving: false, choice: "ask" };
          file = null;
        }
      } catch (e) {
        if (token !== cell.token) return;
        // The engine throws null when it has no memory left even for an error.
        cell.error = e === null || /out of memory/i.test(messageOf(e))
          ? "Herdr ran out of memory for this result. Discard other big results, then run it again."
          : messageOf(e);
        cell.errorDetail = e?.detail ?? null;
        cell.fixable = Boolean(e?.fixable);
        cell.result = null;
        cell.held = NOTHING;
      } finally {
        if (cell.temp === file) cell.temp = null;
        await forget(file);
      }
      cell.ms = Date.now() - start;
      cell.running = false;
      cx.notify();
    });
  }

  // What every other result in every pg tab keeps in memory, those still being read included.
  held(except) {
    let values = 0;
    let chars = 0;
    for (const cell of holders) {
      if (cell === except) continue;
      values += cell.held.values;
      chars += cell.held.chars;
    }
    return { values, chars };
  }

  dropResult(cell) {
    const files = [cell.cut?.file, cell.temp];
    cell.result = null;
    cell.held = NOTHING;
    cell.cut = null;
    cell.temp = null;
    return Promise.all(files.map(forget));
  }

  showFirstRows(cell, cx) {
    if (cell.cut) cell.cut.choice = "show";
    cx.notify();
  }

  discardResult(cell, cx) {
    const cut = cell.cut;
    if (!cut) return;
    this.dropResult(cell);
    cell.cut = { bytes: cut.bytes, file: null, saved: cut.saved, saving: false, choice: "drop" };
    cx.notify();
  }

  // The whole result goes to Downloads, named after the query. psql's file moves there as it is.
  saveResult(cell, query, cx) {
    const cut = cell.cut;
    if (!cut?.file || cut.saving) return;
    cut.saving = true;
    cx.notify();
    this.spawn(cx, async (cx) => {
      try {
        const dir = `${home()}/Downloads`;
        await exec("mkdir", ["-p", dir]);
        const name = fileName(nb.queryTitle(query));
        let target = `${dir}/${name}.csv`;
        for (let n = 2; await fs.exists(target); n++) target = `${dir}/${name} ${n}.csv`;
        const moved = await exec("mv", ["-n", cut.file, target]);
        if (moved.code !== 0 || !(await fs.exists(target))) throw new Error(moved.stderr.trim() || `Could not move it to ${target}.`);
        cut.file = null;
        cut.saved = target;
      } catch (e) {
        notify({ title: "Could not save the result", body: messageOf(e), level: "error" });
      }
      cut.saving = false;
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
    this.ai.stop(query.id);
    if (this.asking === query.id) this.asking = null;
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

  // `chart` is a key of CHARTS, or null for Automatic.
  setChart(query, chart, cx) {
    const { nbId } = this;
    this.change((d) => nb.updateQuery(d, nbId, query.id, { chart }, now()), cx);
    cx.notify();
  }

  // Starts from the series drawn now, so the first click keeps the default ones. Turning off the
  // last series, or on a seventh, does nothing.
  toggleSeries(query, name, cx) {
    const result = this.cells.get(query.id)?.result;
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
    this.syncCells();
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
