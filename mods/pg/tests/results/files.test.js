import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createResultFiles } from "../../src/results/files.js";
import { READ_BYTES } from "../../src/results/reader.js";

const execute = promisify(execFile);
const exec = async (program, args) => {
  try { return { code: 0, ...await execute(program, args) }; }
  catch (error) { return { code: error.code, stdout: error.stdout, stderr: error.stderr }; }
};

async function resultFiles(t) {
  const dir = await fs.mkdtemp(join(tmpdir(), "pg-results-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return {
    downloads: join(dir, "downloads"),
    files: createResultFiles({
      fs: { ...fs, exists: (path) => fs.access(path).then(() => true, () => false) },
      exec, directory: join(dir, "query results"), downloads: join(dir, "downloads"),
    }),
  };
}

test("a small result is read whole", async (t) => {
  const { files } = await resultFiles(t);
  const path = await files.create();
  await fs.writeFile(path, "value\n1\n");
  assert.deepEqual(await files.readStart(path), { bytes: 8, text: "value\n1\n", cut: false });
});

test("a large result reads only its prefix and cleans up the slice", async (t) => {
  const { files } = await resultFiles(t);
  const path = await files.create();
  await fs.writeFile(path, "a".repeat(READ_BYTES + 10));
  const result = await files.readStart(path);
  assert.equal(result.bytes, READ_BYTES + 10);
  assert.equal(result.text.length, READ_BYTES);
  assert.equal(result.cut, true);
  await assert.rejects(fs.access(`${path}.start`), { code: "ENOENT" });
  assert.equal((await fs.stat(path)).size, READ_BYTES + 10);
});

test("saving a result preserves an existing file with the same name", async (t) => {
  const { files, downloads } = await resultFiles(t);
  const path = await files.create();
  await fs.writeFile(path, "new result");
  await fs.mkdir(downloads);
  await fs.writeFile(join(downloads, "Report.csv"), "existing result");
  assert.equal(await files.save(path, "Report"), join(downloads, "Report 2.csv"));
  assert.equal(await fs.readFile(join(downloads, "Report.csv"), "utf8"), "existing result");
  assert.equal(await fs.readFile(join(downloads, "Report 2.csv"), "utf8"), "new result");
  await assert.rejects(fs.access(path), { code: "ENOENT" });
});

test("discarding a result is safe to repeat", async (t) => {
  const { files } = await resultFiles(t);
  const path = await files.create();
  await fs.writeFile(path, "rows");
  await files.forget(path);
  await files.forget(path);
  await files.forget(null);
  await assert.rejects(fs.access(path), { code: "ENOENT" });
});
