import * as nb from "../notebooks/document.js";
import { NOTHING, readSlice, roomLeft, startReading } from "../results/reader.js";
import { describe } from "../results/profile.js";

// One budget across all open notebook tabs, including results still being read.
const holders = new Set();
const messageOf = (e) => String(e?.message ?? e);
const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

export class QuerySession {
  constructor(view, { postgres, resultFiles, createEditor, prepare, notify }) {
    this.view = view;
    this.postgres = postgres;
    this.files = resultFiles;
    this.createEditor = createEditor;
    this.prepare = prepare;
    this.notify = notify;
    this.cells = new Map();
  }

  makeCell(query) {
    // `held`: what its result keeps in memory. `cut`: set when the result did not fit, as
    // { bytes, file, saved, saving, choice: "ask" | "show" | "drop" }; `file` is psql's whole result.
    // `temp`: psql's file while the result is being read.
    // `fixable`: the server refused the query itself, so an agent may fix it; `errorDetail` is psql's whole message.
    const cell = { id: query.id, running: false, result: null, error: null, errorDetail: null, fixable: false, ms: null, token: 0, edWidth: null, focused: false, held: NOTHING, cut: null, temp: null };
    holders.add(cell);
    cell.editor = this.createEditor(query.sql);
    cell.editor.on("focus", (_e, cx) => { this.view.active = query.id; cell.focused = true; cx.notify(); });
    cell.editor.on("blur", (_e, cx) => { cell.focused = false; cx.notify(); });
    cell.editor.on("change", (_e, cx) => { this.recordSql(cell, cx); cx.notify(); });
    cell.editor.on("submit", (e, cx) => { if (e.secondary) this.runCell(cell, cx); });
    return cell;
  }

  // An editor for each query of the open notebook, showing the document's SQL. Typing not yet
  // saved is already in the document: its steps replay on top of another tab's write.
  syncCells() {
    const queries = this.view.notebook()?.queries ?? [];
    const ids = new Set(queries.map((q) => q.id));
    for (const [id, cell] of this.cells) {
      if (ids.has(id)) continue;
      this.releaseCell(cell);
      this.cells.delete(id);
    }
    for (const query of queries) {
      const cell = this.cells.get(query.id);
      if (!cell) this.cells.set(query.id, this.makeCell(query));
      else if (cell.editor.value() !== query.sql) cell.editor.set_value(query.sql);
    }
  }

  releaseCells() {
    const gone = [...this.cells.values()].map((cell) => this.releaseCell(cell));
    this.cells.clear();
    this.view.active = null;
    return Promise.all(gone);
  }

  releaseCell(cell) {
    cell.token++;
    cell.running = false;
    holders.delete(cell);
    cell.editor.release();
    return this.dropResult(cell);
  }

  recordSql(cell, cx) {
    const { nbId } = this.view;
    const sql = cell.editor.value();
    this.view.change((d) => nb.updateQuery(d, nbId, cell.id, { sql }, now()), cx);
  }

  // Rows go in a slice at a time, while they fit the room other results leave. A result that does
  // not fit keeps psql's file, and the page asks what to do with it.
  runCell(cell, cx) {
    const source = cell.editor.value().trim();
    if (!source || !this.view.db) return;
    const { db } = this.view;
    const token = ++cell.token;
    const start = Date.now();
    this.dropResult(cell);
    cell.running = true;
    cell.error = null;
    cell.errorDetail = null;
    cell.fixable = false;
    cx.notify();
    this.view.spawn(cx, async (cx) => {
      let file = null;
      try {
        file = await this.postgres.query(db, source);
        if (token !== cell.token) return;
        cell.temp = file;
        const { bytes, text, cut } = await this.files.readStart(file);
        const reading = startReading(text, cut);
        while (!reading.done) {
          if (token !== cell.token) return;
          readSlice(reading, roomLeft(this.held(cell)));
          cell.held = { values: reading.values, chars: reading.chars };
          await cx.sleep(0);
        }
        if (token !== cell.token) return;
        const result = describe(reading.header, reading.rows);
        const query = this.view.notebook()?.queries.find((q) => q.id === cell.id) ?? null;
        for (const step of this.prepare(result, query)) {
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
        await this.files.forget(file);
      }
      if (token !== cell.token) return;
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
    return Promise.all(files.map((file) => this.files.forget(file)));
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
    this.view.spawn(cx, async (cx) => {
      try {
        const target = await this.files.save(cut.file, nb.queryTitle(query));
        cut.file = null;
        cut.saved = target;
      } catch (e) {
        this.notify({ title: "Could not save the result", body: messageOf(e), level: "error" });
      }
      cut.saving = false;
      cx.notify();
    });
  }

  runAll(cx) {
    for (const query of this.view.notebook()?.queries ?? []) {
      const cell = this.cells.get(query.id);
      if (cell) this.runCell(cell, cx);
    }
  }
}
