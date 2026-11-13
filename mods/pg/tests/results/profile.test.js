import { test } from "node:test";
import assert from "node:assert/strict";
import { CELL_CHARS } from "../../src/results/limits.js";
import { describe } from "../../src/results/profile.js";
import { formatNumber } from "../../src/results/format.js";
import { summarize } from "../../src/results/summary.js";

test("summary: a number column gives its range and average", () => {
  assert.deepEqual(summarize(describe(["amount"], [["10"], ["20"], ["30"]]))[0], {
    name: "amount", holds: "numbers", filled: "100%", distinct: "3", range: "10 to 30, average 20",
  });
});

test("summary: a mostly empty column says how full it is", () => {
  assert.equal(summarize(describe(["note"], [["hello"], [null], [null], [""]]))[0].filled, "25%");
});

test("describe: values longer than 600 characters are cut, and null stays null", () => {
  const { rows } = describe(["body"], [["x".repeat(700)], [null], ["short"]]);
  assert.deepEqual(rows.map(([v]) => v), ["x".repeat(CELL_CHARS), null, "short"]);
  assert.equal(CELL_CHARS, 600);
});

test("formatNumber: groups thousands and keeps four decimals, and leaves other text alone", () => {
  assert.equal(formatNumber("-1234567.891011"), "-1,234,567.8910");
  assert.equal(formatNumber("1000"), "1,000");
  assert.equal(formatNumber("999"), "999");
  for (const text of ["", "-", "1.", ".5", "1e+21", "12a", "1,000"]) assert.equal(formatNumber(text), text);
});
