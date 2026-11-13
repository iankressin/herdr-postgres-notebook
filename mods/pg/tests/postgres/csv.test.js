import { test } from "node:test";
import assert from "node:assert/strict";
import { NULL_MARK, parseCsv, parseRows } from "../../src/postgres/csv.js";

test("csv: reads plain fields", () => {
  assert.deepEqual(parseCsv("a,b\n1,2\n"), [["a", "b"], ["1", "2"]]);
});

test("csv: reads an empty field", () => {
  assert.deepEqual(parseCsv("a,b\n,2\n"), [["a", "b"], ["", "2"]]);
});

test("csv: reads a comma, a doubled quote and a newline inside quotes", () => {
  assert.deepEqual(parseCsv('a\n"x,""y""\nz"\n'), [["a"], ['x,"y"\nz']]);
});

test("csv: reads text with no final newline", () => {
  assert.deepEqual(parseCsv("a,b\n1,2"), [["a", "b"], ["1", "2"]]);
});

test("csv: a quoted field followed by more text keeps both", () => {
  assert.deepEqual(parseCsv('"q"tail,x\n'), [["qtail", "x"]]);
});

test("csv: a line ending in a comma has an empty last field", () => {
  assert.deepEqual(parseCsv("a,\nb,"), [["a", ""], ["b", ""]]);
});

test("csv: reads an empty result as no lines", () => {
  assert.deepEqual(parseCsv(""), []);
});

test("rows: splits the header from the rows and maps the mark to null", () => {
  const { header, rows } = parseRows(`id,name\n1,${NULL_MARK}\n2,\n`);
  assert.deepEqual(header, ["id", "name"]);
  assert.deepEqual(rows, [["1", null], ["2", ""]]);
});

test("rows: a result with a header only has no rows", () => {
  assert.deepEqual(parseRows("id,name\n").rows, []);
});
