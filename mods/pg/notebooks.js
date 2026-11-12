// Saved notebooks for one server and database: the file's shape, reading and checking it, and
// every change to it as a step from one document to the next. No app imports, so `node --test`
// can run it.
//
// Each step returns a new document and leaves the old one alone. When a step no longer applies
// (its item is gone, its id is taken), it returns the document unchanged. That lets the view
// replay its unsaved steps on top of a file another tab wrote meanwhile.
import { SETTINGS_BY_CATEGORY, TABLES_BY_SIZE } from "./logic.js";

export const VERSION = 1;
export const VIEWS = ["table", "chart", "summary"];
export const TOO_BIG = 900 * 1024;

export const safeName = (text) => String(text).replace(/[^A-Za-z0-9@._-]/g, "_");
export const notebooksDir = (home, server) => `${home}/pg-notebooks/${safeName(server)}`;
export const notebooksPath = (home, server, database) => `${notebooksDir(home, server)}/${safeName(database)}.json`;

export function newId(prefix, now = Date.now(), random = Math.random) {
  return `${prefix}_${now.toString(36)}${Math.floor(random() * 36 ** 4).toString(36).padStart(4, "0")}`;
}

// Ids of things made together with a notebook come from its id, so replaying the step that
// made them makes the same ids.
const childId = (prefix, parent, i) => `${prefix}_${parent.slice(2)}${i.toString(36)}`;

export const emptyDoc = (server, database) => ({ version: VERSION, server, database, lastOpened: null, folders: [], notebooks: [] });

export const newQuery = (id, sql, title = "") => ({ id, title, sql, view: null, measure: null, chart: null, x: null, series: null });

export const serialize = (doc) => `${JSON.stringify(doc, null, 2)}\n`;

// ── Reading a file ───────────────────────────────────────────────────────────

class Broken extends Error {}
const fail = (reason) => { throw new Broken(reason); };
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const text = (v, what) => (typeof v === "string" ? v : fail(`${what} is not text.`));
const id = (v, what) => (typeof v === "string" && v.trim() !== "" ? v : fail(`${what} has no id.`));
const name = (v, what) => text(v, what).trim() || "Untitled";
const ref = (v, what) => (v === null || v === undefined ? null : text(v, what));
const list = (v, what) => (Array.isArray(v) ? v : fail(`${what} is not a list.`));

// The file as text, to `{ doc }` or `{ error }`. Wrong types are an error; references to folders
// that do not exist, and folders inside themselves, are moved to the top level.
export function parseDoc(raw) {
  let data;
  try { data = JSON.parse(raw); } catch (e) { return { error: `It is not JSON (${e.message}).` }; }
  try {
    if (!isObject(data)) fail("It is not a JSON object.");
    if (data.version !== VERSION) fail(`Its version is ${JSON.stringify(data.version)}, not ${VERSION}.`);
    const folders = list(data.folders, "folders").map((f, i) => {
      const what = `Folder ${i + 1}`;
      if (!isObject(f)) fail(`${what} is not an object.`);
      return { id: id(f.id, what), name: name(f.name, `${what}'s name`), parent: ref(f.parent, `${what}'s parent`), open: f.open !== false };
    });
    const notebooks = list(data.notebooks, "notebooks").map((n, i) => {
      const what = `Notebook ${i + 1}`;
      if (!isObject(n)) fail(`${what} is not an object.`);
      return {
        id: id(n.id, what),
        name: name(n.name, `${what}'s name`),
        folder: ref(n.folder, `${what}'s folder`),
        created: ref(n.created, `${what}'s created time`),
        updated: ref(n.updated, `${what}'s updated time`),
        queries: list(n.queries, `${what}'s queries`).map((q, k) => {
          const qwhat = `Query ${k + 1} of ${what.toLowerCase()}`;
          if (!isObject(q)) fail(`${qwhat} is not an object.`);
          return {
            id: id(q.id, qwhat),
            title: q.title === undefined || q.title === null ? "" : text(q.title, `${qwhat}'s title`),
            sql: text(q.sql, `${qwhat}'s SQL`),
            view: VIEWS.includes(q.view) ? q.view : null,
            measure: typeof q.measure === "string" ? q.measure : null,
            chart: typeof q.chart === "string" ? q.chart : null,
            x: typeof q.x === "string" ? q.x : null,
            series: Array.isArray(q.series) && q.series.every((s) => typeof s === "string") ? q.series : null,
          };
        }),
      };
    });
    const ids = [...folders.map((f) => f.id), ...notebooks.flatMap((n) => [n.id, ...n.queries.map((q) => q.id)])];
    const twice = ids.find((x, i) => ids.indexOf(x) !== i);
    if (twice) fail(`The id ${twice} is used twice.`);
    const known = new Set(folders.map((f) => f.id));
    for (const f of folders) if (!known.has(f.parent)) f.parent = null;
    for (const n of notebooks) if (!known.has(n.folder)) n.folder = null;
    for (const f of folders) if (loops(folders, f)) f.parent = null;
    const lastOpened = notebooks.some((n) => n.id === data.lastOpened) ? data.lastOpened : null;
    return { doc: { version: VERSION, server: ref(data.server, "server") ?? "", database: ref(data.database, "database") ?? "", lastOpened, folders, notebooks } };
  } catch (e) {
    if (e instanceof Broken) return { error: e.message };
    throw e;
  }
}

function loops(folders, start) {
  const seen = new Set();
  for (let f = start; f; f = folders.find((g) => g.id === f.parent)) {
    if (seen.has(f.id)) return true;
    seen.add(f.id);
  }
  return false;
}

// ── Finding things ───────────────────────────────────────────────────────────

export const folderOf = (doc, id) => doc.folders.find((f) => f.id === id) ?? null;
export const notebookOf = (doc, id) => doc.notebooks.find((n) => n.id === id) ?? null;
export const itemOf = (doc, id) => folderOf(doc, id) ?? notebookOf(doc, id);
const placeOf = (doc, id) => folderOf(doc, id)?.parent ?? notebookOf(doc, id)?.folder ?? null;

// Plain comparison of lower-cased names: the app's script engine ignores localeCompare's options.
const byName = (a, b) => {
  const [x, y] = [a.name.toLowerCase(), b.name.toLowerCase()];
  return x < y ? -1 : x > y ? 1 : a.id < b.id ? -1 : 1;
};

export const childrenOf = (doc, folder) => ({
  folders: doc.folders.filter((f) => f.parent === folder).sort(byName),
  notebooks: doc.notebooks.filter((n) => n.folder === folder).sort(byName),
});

// The explorer's rows in order: folders first, then notebooks, each by name; a shut folder
// hides what is in it.
export function treeRows(doc, { all = false } = {}, folder = null, depth = 0) {
  const { folders, notebooks } = childrenOf(doc, folder);
  return [
    ...folders.flatMap((f) => [{ kind: "folder", item: f, depth }, ...(all || f.open ? treeRows(doc, { all }, f.id, depth + 1) : [])]),
    ...notebooks.map((n) => ({ kind: "notebook", item: n, depth })),
  ];
}

export const firstNotebook = (doc) => treeRows(doc, { all: true }).find((r) => r.kind === "notebook")?.item ?? null;

// The folder names from the top down to this folder.
export function folderPath(doc, id) {
  const path = [];
  for (let f = folderOf(doc, id); f; f = folderOf(doc, f.parent)) path.unshift(f.name);
  return path;
}

// Whether `id` is the folder `ancestor` or anything inside it.
export function isInside(doc, id, ancestor) {
  for (let f = folderOf(doc, id); f; f = folderOf(doc, f.parent)) if (f.id === ancestor) return true;
  return false;
}

export const canMove = (doc, id, target) => Boolean(itemOf(doc, id)) && (target === null || Boolean(folderOf(doc, target)))
  && !(folderOf(doc, id) && target !== null && isInside(doc, target, id));

// Where an item can go: the top level, then every folder in tree order, leaving out the item
// itself and what is inside it. `here` marks where it is now.
export function moveTargets(doc, id) {
  const now = placeOf(doc, id);
  const folders = treeRows({ ...doc, notebooks: [] }, { all: true })
    .filter((r) => canMove(doc, id, r.item.id))
    .map((r) => ({ id: r.item.id, name: r.item.name, depth: r.depth + 1, here: r.item.id === now }));
  return [{ id: null, name: "Top level", depth: 0, here: now === null }, ...folders];
}

// What a person would call a query that has no title: the table it reads, in words.
export function autoTitle(sql) {
  const from = String(sql).match(/\bfrom\s+([\w."]+)/i)?.[1]?.replace(/"/g, "");
  if (!from) return "Untitled query";
  const words = from.split(".").pop().replace(/^pg_stat_/, "").replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export const queryTitle = (query) => query.title.trim() || autoTitle(query.sql);

// ── Steps ────────────────────────────────────────────────────────────────────

const withNotebook = (doc, id, change, now) => (notebookOf(doc, id)
  ? { ...doc, notebooks: doc.notebooks.map((n) => (n.id === id ? { ...change(n), updated: now } : n)) }
  : doc);

export function addFolder(doc, { id, name, parent = null }) {
  if (itemOf(doc, id) || (parent !== null && !folderOf(doc, parent))) return doc;
  return { ...doc, folders: [...doc.folders, { id, name: name.trim() || "New folder", parent, open: true }] };
}

export function addNotebook(doc, { id, name, folder = null, now, queries = [] }) {
  if (itemOf(doc, id)) return doc;
  const place = folder !== null && folderOf(doc, folder) ? folder : null;
  return { ...doc, notebooks: [...doc.notebooks, { id, name: name.trim() || "Untitled", folder: place, created: now, updated: now, queries }] };
}

// The notebook a database gets when it has none: two queries on Postgres's own catalog.
export function addOverview(doc, { id, now }) {
  if (doc.notebooks.length > 0) return doc;
  const queries = [
    newQuery(childId("q", id, 0), TABLES_BY_SIZE, "Tables by size"),
    newQuery(childId("q", id, 1), SETTINGS_BY_CATEGORY, "Settings by category"),
  ];
  return addNotebook(doc, { id, name: "Overview", now, queries });
}

export function rename(doc, id, name, now) {
  const clean = name.trim();
  if (!clean || itemOf(doc, id)?.name === clean) return doc;
  if (folderOf(doc, id)) return { ...doc, folders: doc.folders.map((f) => (f.id === id ? { ...f, name: clean } : f)) };
  return withNotebook(doc, id, (n) => ({ ...n, name: clean }), now);
}

export function move(doc, id, target, now) {
  if (!canMove(doc, id, target) || placeOf(doc, id) === target) return doc;
  if (folderOf(doc, id)) return { ...doc, folders: doc.folders.map((f) => (f.id === id ? { ...f, parent: target } : f)) };
  return withNotebook(doc, id, (n) => ({ ...n, folder: target }), now);
}

// A folder's contents move to the folder above it; nothing inside is lost.
export function remove(doc, id) {
  const folder = folderOf(doc, id);
  if (folder) {
    return {
      ...doc,
      folders: doc.folders.filter((f) => f.id !== id).map((f) => (f.parent === id ? { ...f, parent: folder.parent } : f)),
      notebooks: doc.notebooks.map((n) => (n.folder === id ? { ...n, folder: folder.parent } : n)),
    };
  }
  if (!notebookOf(doc, id)) return doc;
  return { ...doc, notebooks: doc.notebooks.filter((n) => n.id !== id), lastOpened: doc.lastOpened === id ? null : doc.lastOpened };
}

export function duplicate(doc, id, { id: copy, now }) {
  const source = notebookOf(doc, id);
  if (!source || itemOf(doc, copy)) return doc;
  const queries = source.queries.map((q, i) => ({ ...q, id: childId("q", copy, i) }));
  return addNotebook(doc, { id: copy, name: `${source.name} copy`, folder: source.folder, now, queries });
}

export function setFolderOpen(doc, id, open) {
  if (folderOf(doc, id)?.open === open || !folderOf(doc, id)) return doc;
  return { ...doc, folders: doc.folders.map((f) => (f.id === id ? { ...f, open } : f)) };
}

export const setLastOpened = (doc, id) => (doc.lastOpened === id || !notebookOf(doc, id) ? doc : { ...doc, lastOpened: id });

export function addQuery(doc, notebook, query, now) {
  if (notebookOf(doc, notebook)?.queries.some((q) => q.id === query.id)) return doc;
  return withNotebook(doc, notebook, (n) => ({ ...n, queries: [...n.queries, query] }), now);
}

export function removeQuery(doc, notebook, query, now) {
  if (!notebookOf(doc, notebook)?.queries.some((q) => q.id === query)) return doc;
  return withNotebook(doc, notebook, (n) => ({ ...n, queries: n.queries.filter((q) => q.id !== query) }), now);
}

// `change` holds any of title, sql, view, measure, chart, x and series. Columns are saved by name,
// so the choices survive the columns moving around.
export function updateQuery(doc, notebook, query, change, now) {
  const old = notebookOf(doc, notebook)?.queries.find((q) => q.id === query);
  if (!old || Object.entries(change).every(([k, v]) => old[k] === v)) return doc;
  return withNotebook(doc, notebook, (n) => ({ ...n, queries: n.queries.map((q) => (q.id === query ? { ...q, ...change } : q)) }), now);
}
