// One notebooks file on disk, the document shown from it, and the steps not yet saved.
//
// Every change is a step (doc → doc, from document.js) applied at once and kept in `pending`
// until a write lands. When another tab wrote the file first, the write is refused as stale:
// then the file is read again and the pending steps are replayed on top of it.
import { TOO_BIG, emptyDoc, notebooksDir, notebooksPath, parseDoc, serialize } from "./document.js";

const messageOf = (e) => String(e?.message ?? e);
const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");

export class NotebookFile {
  constructor(server, database, storage) {
    this.storage = storage;
    this.server = server;
    this.database = database;
    this.dir = notebooksDir(storage.home, server);
    this.path = notebooksPath(storage.home, server, database);
    this.doc = emptyDoc(server, database);
    // The file as last read or written, null while there is no file. Writes pass it as `expected`.
    this.text = null;
    this.pending = [];
    this.changes = 0;
    // loading → ready, or broken when the file could not be read: then nothing is written over it.
    this.state = "loading";
    this.fresh = false;
    this.failed = null;
    this.chain = Promise.resolve();
  }

  // One file task at a time, so a reload never lands in the middle of a save.
  serial(work) {
    const run = this.chain.then(work);
    this.chain = run.catch(() => {});
    return run;
  }

  rebase(text, doc) {
    this.text = text;
    this.doc = this.pending.reduce((d, step) => step(d), doc ?? emptyDoc(this.server, this.database));
  }

  load() {
    return this.serial(async () => {
      await this.storage.fs.mkdir(this.dir, { recursive: true }).catch(() => {});
      let text;
      try {
        text = await this.storage.readTextFile(this.path);
      } catch (e) {
        this.state = "broken";
        this.storage.notify({ title: "Could not read the notebooks", body: `${messageOf(e)} (${this.path}). Changes here will not be saved.`, level: "error" });
        return;
      }
      if (text === null) {
        this.fresh = true;
        this.rebase(null, null);
        this.state = "ready";
        return;
      }
      const parsed = parseDoc(text);
      if (parsed.error) {
        const aside = `${this.path}.corrupt-${stamp()}`;
        try {
          await this.storage.fs.writeFile(aside, await this.storage.fs.readFile(this.path));
          await this.storage.fs.unlink(this.path);
        } catch (e) {
          this.state = "broken";
          this.storage.notify({ title: "Could not read the notebooks", body: `${parsed.error} Moving it aside failed too: ${messageOf(e)}`, level: "error" });
          return;
        }
        this.storage.notify({ title: "The notebooks file was damaged", body: `${parsed.error} It is kept as ${aside}, and this database starts with no notebooks.`, level: "warning", timeout: 12000 });
        this.rebase(null, null);
        this.state = "ready";
        return;
      }
      if (text.length > TOO_BIG) {
        this.storage.notify({ title: "The notebooks file is getting large", body: `${Math.round(text.length / 1024)} KB of 1 MB. Past that it cannot be read. Move some queries to another database's notebooks or delete old ones.`, level: "warning" });
      }
      this.rebase(text, parsed.doc);
      this.state = "ready";
    });
  }

  // Applies a step now; the view saves a moment later. A step that changes nothing is dropped.
  change(step) {
    const next = step(this.doc);
    if (next === this.doc) return false;
    this.doc = next;
    this.pending.push(step);
    this.changes++;
    return true;
  }

  // True when another tab's write was merged in, so the view must show the merged document.
  save() {
    return this.serial(async () => {
      let rebased = false;
      for (let tries = 0; this.state === "ready" && this.pending.length > 0; tries++) {
        const count = this.pending.length;
        const text = serialize(this.doc);
        try {
          await this.storage.fs.mkdir(this.dir, { recursive: true });
          await this.storage.writeTextFile(this.path, text, this.text);
          this.text = text;
          this.pending = this.pending.slice(count);
          this.failed = null;
          return rebased;
        } catch (e) {
          const there = await this.storage.readTextFile(this.path).catch(() => undefined);
          const parsed = typeof there === "string" ? parseDoc(there) : null;
          if (tries < 3 && there !== undefined && there !== this.text && !parsed?.error) {
            this.rebase(there, parsed?.doc ?? null);
            rebased = true;
            continue;
          }
          const reason = parsed?.error ? `The file changed and can no longer be read: ${parsed.error}` : messageOf(e);
          if (this.failed !== reason) {
            this.storage.notify({ title: "Could not save the notebooks", body: `${reason} The change is kept here and saved with the next one.`, level: "error" });
          }
          this.failed = reason;
          return rebased;
        }
      }
      return rebased;
    });
  }

  // After the folder changed: true when the file now holds something this view had not seen.
  reload() {
    return this.serial(async () => {
      if (this.state !== "ready") return false;
      const there = await this.storage.readTextFile(this.path).catch(() => undefined);
      if (there === undefined || there === this.text) return false;
      if (there === null) {
        this.rebase(null, null);
        return true;
      }
      const parsed = parseDoc(there);
      if (parsed.error) return false;
      this.rebase(there, parsed.doc);
      return true;
    });
  }
}
