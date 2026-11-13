import { test } from "node:test";
import assert from "node:assert/strict";
import { QuerySession } from "../../src/app/query-session.js";
import { newQuery } from "../../src/notebooks/document.js";

function session(t) {
  const tasks = [];
  const pending = [];
  const removed = [];
  const notebook = { queries: [newQuery("q_one", "select 1")] };
  const cx = { notify() {}, sleep: async () => {} };
  const view = {
    db: "shop", nbId: "n_one", active: null,
    notebook: () => notebook,
    spawn: (_cx, work) => { tasks.push(work(cx)); },
  };
  const queries = new QuerySession(view, {
    postgres: { query: (db, sql) => new Promise((resolve, reject) => pending.push({ db, sql, resolve, reject })) },
    resultFiles: {
      readStart: async (file) => ({ bytes: 10, text: `value\n${file}\n`, cut: false }),
      forget: async (file) => { if (file) removed.push(file); },
    },
    createEditor: (sql) => ({
      released: false,
      handlers: new Map(),
      on(event, handler) { this.handlers.set(event, handler); },
      emit(event, cx, payload = {}) { this.handlers.get(event)?.(payload, cx); },
      value: () => sql,
      set_value(next) { sql = next; },
      release() { this.released = true; },
    }),
    prepare: () => [],
    notify() {},
  });
  queries.syncCells();
  t.after(() => queries.releaseCells());
  return { queries, cell: queries.cells.get("q_one"), notebook, cx, pending, tasks, removed };
}

test("a query publishes its rows and removes the temporary CSV", async (t) => {
  const s = session(t);
  s.queries.runCell(s.cell, s.cx);
  assert.equal(s.cell.running, true);
  s.pending[0].resolve("first");
  await Promise.all(s.tasks);
  assert.deepEqual(s.cell.result.rows, [["first"]]);
  assert.equal(s.cell.running, false);
  assert.deepEqual(s.removed, ["first"]);
});

test("command-enter in the SQL editor executes its current query", async (t) => {
  const s = session(t);
  s.cell.editor.set_value("select 2");
  s.cell.editor.emit("submit", s.cx, { secondary: true });
  assert.equal(s.pending.length, 1);
  assert.equal(s.pending[0].db, "shop");
  assert.equal(s.pending[0].sql, "select 2");
  assert.equal(s.cell.running, true);
  s.pending[0].resolve("submitted");
  await Promise.all(s.tasks);
  assert.deepEqual(s.cell.result.rows, [["submitted"]]);
});

test("plain and shift-enter in the SQL editor do not execute a query", (t) => {
  const s = session(t);
  s.cell.editor.emit("submit", s.cx);
  s.cell.editor.emit("submit", s.cx, { shift: true });
  assert.equal(s.pending.length, 0);
  assert.equal(s.cell.running, false);
});

test("an older query cannot replace a newer result", async (t) => {
  const s = session(t);
  s.queries.runCell(s.cell, s.cx);
  s.queries.runCell(s.cell, s.cx);
  s.pending[1].resolve("new");
  await s.tasks[1];
  s.pending[0].resolve("old");
  await s.tasks[0];
  assert.deepEqual(s.cell.result.rows, [["new"]]);
  assert.deepEqual(s.removed.sort(), ["new", "old"]);
});

test("an older cleanup cannot stop a newer query's spinner", async (t) => {
  const s = session(t);
  let cleanupStarted;
  let finishCleanup;
  const started = new Promise((resolve) => { cleanupStarted = resolve; });
  const cleanup = new Promise((resolve) => { finishCleanup = resolve; });
  s.queries.files.forget = async (file) => {
    if (file === "old") { cleanupStarted(); await cleanup; }
  };
  s.queries.runCell(s.cell, s.cx);
  s.pending[0].resolve("old");
  await started;
  s.queries.runCell(s.cell, s.cx);
  finishCleanup();
  await s.tasks[0];
  assert.equal(s.cell.running, true);
  s.pending[1].resolve("new");
  await s.tasks[1];
  assert.deepEqual(s.cell.result.rows, [["new"]]);
});

for (const action of ["close", "remove"]) {
  test(`a query finishing after ${action} releases its file without restoring the result`, async (t) => {
    const s = session(t);
    s.queries.runCell(s.cell, s.cx);
    if (action === "close") await s.queries.releaseCells();
    else {
      s.notebook.queries = [];
      s.queries.syncCells();
    }
    s.pending[0].resolve("obsolete");
    await Promise.all(s.tasks);
    assert.equal(s.cell.result, null);
    assert.equal(s.cell.editor.released, true);
    assert.equal(s.queries.cells.size, 0);
    assert.ok(s.removed.includes("obsolete"));
  });
}

test("execution errors stop the spinner and retain repair information", async (t) => {
  const s = session(t);
  s.queries.runCell(s.cell, s.cx);
  s.pending[0].reject(Object.assign(new Error("unknown column"), { detail: "ERROR: unknown column", fixable: true }));
  await Promise.all(s.tasks);
  assert.equal(s.cell.running, false);
  assert.equal(s.cell.error, "unknown column");
  assert.equal(s.cell.errorDetail, "ERROR: unknown column");
  assert.equal(s.cell.fixable, true);
  assert.equal(s.cell.result, null);
});
