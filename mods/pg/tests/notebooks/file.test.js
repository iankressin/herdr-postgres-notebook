import { test } from "node:test";
import assert from "node:assert/strict";
import { NotebookFile } from "../../src/notebooks/file.js";
import { addNotebook, emptyDoc, parseDoc, serialize } from "../../src/notebooks/document.js";

function storage(initial = null) {
  const files = new Map();
  const notices = [];
  const adapter = {
    home: "/app",
    fs: {
      mkdir: async () => {},
      readFile: async (path) => files.get(path),
      writeFile: async (path, text) => { files.set(path, text); },
      unlink: async (path) => { files.delete(path); },
    },
    readTextFile: async (path) => files.get(path) ?? null,
    writeTextFile: async (path, text, expected) => {
      if ((files.get(path) ?? null) !== expected) throw new Error("stale write");
      files.set(path, text);
    },
    notify: (notice) => notices.push(notice),
  };
  const open = () => new NotebookFile("localhost:5432", "shop", adapter);
  const first = open();
  if (initial !== null) files.set(first.path, initial);
  return { first, open, files, adapter, notices };
}

const add = (id) => (doc) => addNotebook(doc, { id, name: id, now: "2026-01-01T00:00:00Z" });

test("two notebook files preserve both writers' changes", async () => {
  const { first, open, files } = storage();
  const second = open();
  await Promise.all([first.load(), second.load()]);
  first.change(add("n_first"));
  second.change(add("n_second"));
  await first.save();
  assert.equal(await second.save(), true);
  const saved = parseDoc(files.get(first.path)).doc;
  assert.deepEqual(saved.notebooks.map((n) => n.id), ["n_first", "n_second"]);
  assert.equal(second.pending.length, 0);
});

test("reload preserves pending edits on top of another writer", async () => {
  const { first, files } = storage();
  await first.load();
  first.change(add("n_local"));
  files.set(first.path, serialize(add("n_remote")(emptyDoc("localhost:5432", "shop"))));
  assert.equal(await first.reload(), true);
  assert.deepEqual(first.doc.notebooks.map((n) => n.id), ["n_remote", "n_local"]);
  await first.save();
  assert.equal(parseDoc(files.get(first.path)).doc.notebooks.length, 2);
});

test("a failed save keeps changes available for a later retry", async () => {
  const { first, adapter, files, notices } = storage();
  await first.load();
  first.change(add("n_kept"));
  const write = adapter.writeTextFile;
  adapter.writeTextFile = async () => { throw new Error("disk full"); };
  await first.save();
  assert.equal(first.pending.length, 1);
  assert.equal(first.doc.notebooks[0].id, "n_kept");
  assert.equal(notices.length, 1);
  adapter.writeTextFile = write;
  await first.save();
  assert.equal(first.pending.length, 0);
  assert.equal(parseDoc(files.get(first.path)).doc.notebooks[0].id, "n_kept");
});

test("a damaged notebook file is preserved before starting an empty document", async () => {
  const { first, files, notices } = storage("{broken");
  await first.load();
  assert.equal(first.state, "ready");
  assert.deepEqual(first.doc.notebooks, []);
  assert.equal(files.has(first.path), false);
  assert.ok([...files].some(([path, text]) => path.startsWith(`${first.path}.corrupt-`) && text === "{broken"));
  assert.equal(notices[0].level, "warning");
});

test("an unreadable notebook file cannot be overwritten", async () => {
  const { first, adapter, files } = storage("unreadable");
  adapter.readTextFile = async () => { throw new Error("permission denied"); };
  await first.load();
  assert.equal(first.state, "broken");
  first.change(add("n_unsaved"));
  await first.save();
  assert.equal(files.get(first.path), "unreadable");
});

test("edits made during a write remain pending for the next save", async () => {
  const { first, adapter, files } = storage();
  await first.load();
  first.change(add("n_first"));
  const write = adapter.writeTextFile;
  let entered;
  let release;
  const started = new Promise((resolve) => { entered = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  adapter.writeTextFile = async (...args) => { entered(); await gate; return write(...args); };
  const saving = first.save();
  await started;
  first.change(add("n_during"));
  release();
  await saving;
  assert.equal(first.pending.length, 1);
  assert.deepEqual(parseDoc(files.get(first.path)).doc.notebooks.map((n) => n.id), ["n_first"]);
  adapter.writeTextFile = write;
  await first.save();
  assert.deepEqual(parseDoc(files.get(first.path)).doc.notebooks.map((n) => n.id), ["n_first", "n_during"]);
});
