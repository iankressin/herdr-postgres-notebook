import { test } from "node:test";
import assert from "node:assert/strict";
import { LIST_TABLES_SQL, columnsSql, filterTables, groupBySchema, parseColumns, parseTables } from "../../src/postgres/catalog.js";
import { NULL_MARK } from "../../src/postgres/csv.js";

test("tables: the list skips system schemas", () => {
  assert.match(LIST_TABLES_SQL, /not in \('pg_catalog', 'information_schema'\)/);
  assert.match(LIST_TABLES_SQL, /not like 'pg_toast%'/);
  assert.match(LIST_TABLES_SQL, /not like 'pg_temp%'/);
});

test("tables: the list includes tables and views", () => {
  assert.match(LIST_TABLES_SQL, /relkind in \('r', 'p', 'v', 'm', 'f'\)/);
});

test("tables: parses schema, name and kind", () => {
  assert.deepEqual(parseTables("schema,name,kind\npublic,users,r\n"), [{ schema: "public", name: "users", kind: "r" }]);
});

const TABLES = [
  { schema: "public", name: "users", kind: "r" },
  { schema: "public", name: "user_roles", kind: "r" },
  { schema: "billing", name: "invoices", kind: "r" },
];

test("filter: an empty query keeps all tables", () => {
  assert.equal(filterTables(TABLES, "  ").length, 3);
});

test("filter: matches a table name with no case sensitivity", () => {
  assert.deepEqual(filterTables(TABLES, "INVOICE").map((t) => t.name), ["invoices"]);
});

test("filter: matches the schema name", () => {
  assert.deepEqual(filterTables(TABLES, "billing").map((t) => t.name), ["invoices"]);
});

test("filter: all words must match", () => {
  assert.deepEqual(filterTables(TABLES, "public role").map((t) => t.name), ["user_roles"]);
});

test("schema groups: keep the order of the list", () => {
  const groups = groupBySchema([TABLES[2], TABLES[0], TABLES[1]]);
  assert.deepEqual(groups.map((g) => [g.schema, g.tables.length]), [["billing", 1], ["public", 2]]);
});

test("columns: the query reads the table by its quoted name", () => {
  assert.match(columnsSql("pub'lic", 'us"er'), /to_regclass\('"pub''lic"\."us""er"'\)/);
});

test("columns: parses the fields, with a null default and no key", () => {
  const columns = parseColumns(`name,type,nullable,default,pk\nnote,text,yes,${NULL_MARK},${NULL_MARK}\n`);
  assert.deepEqual(columns, [{ name: "note", type: "text", nullable: true, default: null, pk: null }]);
});

test("columns: parses a key position and a not-null column", () => {
  const columns = parseColumns(`name,type,nullable,default,pk\nid,integer,no,nextval('s'),0\n`);
  assert.deepEqual(columns, [{ name: "id", type: "integer", nullable: false, default: "nextval('s')", pk: 0 }]);
});
