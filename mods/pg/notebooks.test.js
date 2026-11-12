// Run with: cd ~/.config/herdr-app/mods/pg && node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addFolder,
  addNotebook,
  addOverview,
  addQuery,
  autoTitle,
  duplicate,
  emptyDoc,
  folderPath,
  move,
  moveTargets,
  newId,
  newQuery,
  notebooksPath,
  parseDoc,
  remove,
  rename,
  serialize,
  setLastOpened,
  treeRows,
  updateQuery,
} from "./notebooks.js";

const NOW = "2026-11-11T21:00:00Z";

// Ops / Daily (folder in folder), a notebook in each, one at the top level.
function sample() {
  let doc = emptyDoc("app@localhost:5432", "shop");
  doc = addFolder(doc, { id: "f_ops", name: "Ops" });
  doc = addFolder(doc, { id: "f_daily", name: "Daily", parent: "f_ops" });
  doc = addNotebook(doc, { id: "n_top", name: "Top", now: NOW });
  doc = addNotebook(doc, { id: "n_ops", name: "Ops notes", folder: "f_ops", now: NOW });
  doc = addNotebook(doc, { id: "n_daily", name: "Daily checks", folder: "f_daily", now: NOW, queries: [newQuery("q_1", "select 1")] });
  return doc;
}

const rows = (doc) => treeRows(doc).map((r) => `${"  ".repeat(r.depth)}${r.kind === "folder" ? "/" : ""}${r.item.name}`);

test("path: the server keeps letters, digits and @._- and the rest becomes _", () => {
  assert.equal(notebooksPath("/h", "app@localhost:5432", "shop"), "/h/pg-notebooks/app@localhost_5432/shop.json");
  assert.equal(notebooksPath("/h", "me@/var/run/pg:5432", "a b/c"), "/h/pg-notebooks/me@_var_run_pg_5432/a_b_c.json");
});

test("id: a one-letter prefix, then base-36 time and random characters", () => {
  assert.equal(newId("n", 36 ** 3, () => 0), "n_10000000");
  assert.match(newId("f"), /^f_[0-9a-z]{12,}$/);
});

test("file: a document round-trips through serialize and parse", () => {
  let doc = sample();
  doc = updateQuery(doc, "n_daily", "q_1", { view: "chart", measure: "rows", title: "Size" }, NOW);
  doc = setLastOpened(doc, "n_daily");
  assert.deepEqual(parseDoc(serialize(doc)).doc, doc);
});

test("file: a query's chart, x and series round-trip, and a new query has none", () => {
  const fresh = newQuery("q_x", "select 1");
  assert.deepEqual([fresh.chart, fresh.x, fresh.series], [null, null, null]);
  const doc = updateQuery(sample(), "n_daily", "q_1", { chart: "stacked", x: "region", series: ["revenue", "cost"] }, NOW);
  const read = parseDoc(serialize(doc)).doc.notebooks.find((n) => n.id === "n_daily").queries[0];
  assert.deepEqual([read.chart, read.x, read.series], ["stacked", "region", ["revenue", "cost"]]);
});

test("file: an x that is not text reads as null", () => {
  const raw = JSON.parse(serialize(sample()));
  const query = raw.notebooks.find((n) => n.id === "n_daily").queries[0];
  for (const x of [5, ["day"], { a: 1 }, undefined]) {
    query.x = x;
    assert.equal(parseDoc(JSON.stringify(raw)).doc.notebooks.find((n) => n.id === "n_daily").queries[0].x, null);
  }
});

test("file: a chart that is not text or series that are not a list of text read as null", () => {
  const doc = sample();
  const raw = JSON.parse(serialize(doc));
  const query = raw.notebooks.find((n) => n.id === "n_daily").queries[0];
  const read = (chart, series) => {
    Object.assign(query, { chart, series });
    return parseDoc(JSON.stringify(raw)).doc.notebooks.find((n) => n.id === "n_daily").queries[0];
  };
  for (const [chart, series] of [[5, "a"], [["bars"], [1, "a"]], [{}, { a: 1 }], [undefined, undefined]]) {
    const q = read(chart, series);
    assert.deepEqual([q.chart, q.series], [null, null], JSON.stringify([chart, series]));
  }
  assert.equal(read("pie", []).chart, "pie", "an unknown key is kept; the chart falls back when drawn");
});

test("file: text that is not JSON is refused with a reason", () => {
  assert.match(parseDoc("{ not json").error, /not JSON/);
});

test("file: a wrong version is refused with a reason", () => {
  assert.match(parseDoc(JSON.stringify({ ...emptyDoc("s", "d"), version: 2 })).error, /version is 2/);
});

test("file: a notebook whose queries are not a list is refused with a reason", () => {
  const doc = { ...emptyDoc("s", "d"), notebooks: [{ id: "n_a", name: "A", folder: null, queries: "select 1" }] };
  assert.equal(parseDoc(JSON.stringify(doc)).error, "Notebook 1's queries is not a list.");
});

test("file: an id used twice is refused", () => {
  const doc = addNotebook(addFolder(emptyDoc("s", "d"), { id: "x_1", name: "A" }), { id: "n_1", name: "B", now: NOW });
  const twice = { ...doc, notebooks: [{ ...doc.notebooks[0], id: "x_1" }] };
  assert.match(parseDoc(JSON.stringify(twice)).error, /x_1 is used twice/);
});

test("file: references to missing folders and folder loops land at the top level", () => {
  const doc = {
    ...emptyDoc("s", "d"),
    lastOpened: "n_gone",
    folders: [{ id: "f_a", name: "A", parent: "f_b", open: true }, { id: "f_b", name: "B", parent: "f_a", open: true }],
    notebooks: [{ id: "n_a", name: "A", folder: "f_gone", created: NOW, updated: NOW, queries: [] }],
  };
  const { doc: read } = parseDoc(JSON.stringify(doc));
  assert.equal(read.notebooks[0].folder, null);
  assert.equal(read.lastOpened, null);
  assert.ok(read.folders.some((f) => f.parent === null), "the loop is broken");
  assert.equal(treeRows(read, { all: true }).length, 3, "every item is still in the tree");
});

test("tree: folders come first, then notebooks, each by name without regard to case", () => {
  let doc = emptyDoc("s", "d");
  doc = addNotebook(doc, { id: "n_1", name: "beta", now: NOW });
  doc = addNotebook(doc, { id: "n_2", name: "Alpha", now: NOW });
  doc = addFolder(doc, { id: "f_1", name: "zebra" });
  doc = addFolder(doc, { id: "f_2", name: "Apple" });
  doc = addNotebook(doc, { id: "n_3", name: "Charlie", now: NOW });
  assert.deepEqual(rows(doc), ["/Apple", "/zebra", "Alpha", "beta", "Charlie"]);
});

test("tree: a shut folder hides what is inside it", () => {
  const doc = sample();
  assert.deepEqual(rows(doc), ["/Ops", "  /Daily", "    Daily checks", "  Ops notes", "Top"]);
  const shut = { ...doc, folders: doc.folders.map((f) => (f.id === "f_ops" ? { ...f, open: false } : f)) };
  assert.deepEqual(rows(shut), ["/Ops", "Top"]);
});

test("move: a folder cannot move into itself or a folder inside it", () => {
  const doc = sample();
  assert.equal(move(doc, "f_ops", "f_daily", NOW), doc);
  assert.equal(move(doc, "f_ops", "f_ops", NOW), doc);
  assert.deepEqual(moveTargets(doc, "f_ops").map((t) => t.name), ["Top level"]);
});

test("move: a notebook moves into a folder and the targets mark where it is", () => {
  const doc = move(sample(), "n_top", "f_daily", NOW);
  assert.deepEqual(rows(doc), ["/Ops", "  /Daily", "    Daily checks", "    Top", "  Ops notes"]);
  assert.deepEqual(moveTargets(doc, "n_top").map((t) => `${t.name}${t.here ? "*" : ""}`), ["Top level", "Ops", "Daily*"]);
});

test("delete: a folder's contents move up one level", () => {
  const doc = remove(sample(), "f_ops");
  assert.deepEqual(rows(doc), ["/Daily", "  Daily checks", "Ops notes", "Top"]);
  assert.deepEqual(folderPath(doc, "f_daily"), ["Daily"]);
});

test("delete: a notebook goes, and so does lastOpened when it pointed there", () => {
  const doc = remove(setLastOpened(sample(), "n_top"), "n_top");
  assert.equal(doc.notebooks.some((n) => n.id === "n_top"), false);
  assert.equal(doc.lastOpened, null);
});

test("rename: trims the name, and an empty name changes nothing", () => {
  const doc = sample();
  assert.equal(rename(doc, "f_daily", "  Mornings ", NOW).folders[1].name, "Mornings");
  assert.equal(rename(doc, "n_top", "   ", NOW), doc);
});

test("duplicate: the copy sits beside the notebook with new ids for it and its queries", () => {
  const doc = duplicate(sample(), "n_daily", { id: "n_copy", now: NOW });
  const copy = doc.notebooks.find((n) => n.id === "n_copy");
  assert.equal(copy.name, "Daily checks copy");
  assert.equal(copy.folder, "f_daily");
  assert.equal(copy.queries[0].sql, "select 1");
  assert.notEqual(copy.queries[0].id, "q_1");
  assert.equal(parseDoc(serialize(doc)).error, undefined, "ids stay unique");
});

test("overview: a database with no notebooks gets one with two catalog queries, once", () => {
  const doc = addOverview(emptyDoc("s", "d"), { id: "n_ov", now: NOW });
  assert.deepEqual(doc.notebooks.map((n) => n.name), ["Overview"]);
  assert.deepEqual(doc.notebooks[0].queries.map((q) => q.title), ["Tables by size", "Settings by category"]);
  assert.equal(addOverview(doc, { id: "n_other", now: NOW }), doc);
});

test("replay: unsaved steps applied to a file another tab wrote keep both changes", () => {
  const base = sample();
  const steps = [(d) => rename(d, "n_top", "Mine", NOW), (d) => addQuery(d, "n_top", newQuery("q_new", "select 2"), NOW)];
  const theirs = rename(base, "f_ops", "Theirs", NOW);
  const merged = steps.reduce((d, step) => step(d), theirs);
  assert.equal(merged.folders[0].name, "Theirs");
  assert.equal(merged.notebooks.find((n) => n.id === "n_top").name, "Mine");
  assert.equal(steps.reduce((d, step) => step(d), merged), merged, "replaying again changes nothing");
});

test("title: a query with no title is named after the table it reads", () => {
  assert.equal(autoTitle("select * from public.order_items limit 100"), "Order items");
  assert.equal(autoTitle('select * from "pg_stat_activity"'), "Activity");
  assert.equal(autoTitle("select 1"), "Untitled query");
});
