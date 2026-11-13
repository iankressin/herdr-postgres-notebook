import { test } from "node:test";
import assert from "node:assert/strict";
import { openCommand } from "../../src/ui/navigation.js";

const shownSpace = (...tabs) => ({ active: true, tabs });
const otherSpace = (...tabs) => ({ active: false, tabs });
const tab = (id, name) => ({ id, name });

test("open: a database with no tab gets a new browser tab", () => {
  assert.deepEqual(openCommand([shownSpace(tab("t1", "1"))], "shop"), [
    "tab.new",
    { mod: "pg", name: "pg: shop", props: { database: "shop" } },
  ]);
});

test("open: a database with a tab in the shown space selects that tab", () => {
  const spaces = [shownSpace(tab("t1", "1"), tab("t2", "pg: shop"))];
  assert.deepEqual(openCommand(spaces, "shop"), ["tab.select", { id: "t2" }]);
});

test("open: a tab in another space does not count", () => {
  const spaces = [otherSpace(tab("t9", "pg: shop")), shownSpace(tab("t1", "1"))];
  assert.equal(openCommand(spaces, "shop")[0], "tab.new");
});

test("open: the tab of a longer database name does not count", () => {
  const spaces = [shownSpace(tab("t2", "pg: shop_eu"))];
  assert.equal(openCommand(spaces, "shop")[0], "tab.new");
});

test("open: with no shown space, the command is a new tab", () => {
  assert.equal(openCommand([], "shop")[0], "tab.new");
});
