// Run with: cd ~/.config/herdr-app/mods/pg && node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import { NULL_MARK, parseCsv, parseRows, readCsv } from "./logic.js";
import { NOTHING, ONE, ALL, fileName, readSlice, roomLeft, startReading } from "./result.js";
import { CELL_CHARS } from "./shape.js";

const read = (text, room = roomLeft(NOTHING), cut = false) => {
  const r = startReading(text, cut);
  let slices = 0;
  while (!r.done) { readSlice(r, room); slices++; }
  return { ...r, slices };
};
const csv = (n, cols = 2) => `${Array.from({ length: cols }, (_, c) => `c${c}`).join(",")}\n${Array.from({ length: n }, (_, i) => Array.from({ length: cols }, (_, c) => `v${i}_${c}`).join(",")).join("\n")}\n`;

test("readCsv: lines read in pieces are the lines read at once", () => {
  const text = 'a,b\n1,"two\nlines"\n3,"say ""hi"""\n4,\n5,6';
  const pieces = [];
  for (let at = 0; at < text.length;) {
    const { lines, next } = readCsv(text, at, 2);
    assert.ok(next > at);
    pieces.push(...lines);
    at = next;
  }
  assert.deepEqual(pieces, parseCsv(text));
});

test("a small result is read whole, with nulls", () => {
  const r = read(`id,name\n1,ada\n2,${NULL_MARK}\n`);
  assert.deepEqual(r.header, ["id", "name"]);
  assert.deepEqual(r.rows, [["1", "ada"], ["2", null]]);
  assert.equal(r.whole, true);
  assert.equal(r.values, 4);
  assert.equal(r.chars, 5);
  assert.equal(r.text, null);
});

test("a result read a slice at a time is the same as one read at once", () => {
  const text = csv(40000);
  const r = read(text);
  assert.ok(r.slices > 1);
  assert.equal(r.whole, true);
  assert.ok(r.rows.length === 40000 && JSON.stringify(r.rows) === JSON.stringify(parseRows(text).rows));
});

test("reading stops at the most rows, values or characters a result may hold", () => {
  const rows = read(csv(10), { rows: 4, values: 1000, chars: 1000 });
  assert.equal(rows.rows.length, 4);
  assert.equal(rows.whole, false);
  const values = read(csv(10, 3), { rows: 100, values: 7, chars: 1000 });
  assert.equal(values.rows.length, 2);
  assert.equal(values.values, 6);
  const chars = read(csv(10), { rows: 100, values: 1000, chars: 20 });
  assert.equal(chars.rows.length, 2);
  assert.equal(chars.whole, false);
});

test("one result holds at most 50,000 rows", () => {
  const r = read(csv(ONE.rows + 10, 1));
  assert.equal(ONE.rows, 50000);
  assert.equal(r.rows.length, ONE.rows);
  assert.equal(r.whole, false);
});

test("a result with no room left reads no rows", () => {
  const r = read(csv(3), roomLeft({ values: ALL.values, chars: 0 }));
  assert.deepEqual(r.rows, []);
  assert.equal(r.whole, false);
});

test("the start of a bigger file drops its last line, which may stop partway", () => {
  const r = read('id,note\n1,one\n2,"two\nhalf', roomLeft(NOTHING), true);
  assert.deepEqual(r.rows, [["1", "one"]]);
  assert.equal(r.whole, false);
  assert.equal(r.values, 2);
  assert.equal(r.chars, 4);
});

test("a long value is cut, and counted as cut", () => {
  const r = read(`body\n${"x".repeat(CELL_CHARS + 100)}\n`);
  assert.equal(r.rows[0][0].length, CELL_CHARS);
  assert.equal(r.chars, CELL_CHARS);
});

test("the room left is what the other results do not hold", () => {
  assert.deepEqual(roomLeft(NOTHING), { rows: ONE.rows, values: ONE.values, chars: ONE.chars });
  assert.deepEqual(roomLeft({ values: ALL.values - 10, chars: ALL.chars - 5 }), { rows: ONE.rows, values: 10, chars: 5 });
});

test("fileName keeps a title readable and safe", () => {
  assert.equal(fileName("Orders by day"), "Orders by day");
  assert.equal(fileName("a/b: c?"), "a_b_ c_");
  assert.equal(fileName(".hidden"), "_hidden");
  assert.equal(fileName("  "), "result");
});
