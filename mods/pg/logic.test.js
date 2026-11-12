// Run with: cd ~/.config/herdr-app/mods/pg && node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SERVER,
  LIST_TABLES_SQL,
  NULL_MARK,
  columnsSql,
  conninfo,
  errorMessage,
  filterTables,
  groupBySchema,
  openCommand,
  parseColumns,
  parseCsv,
  parseRows,
  parseServer,
  parseTables,
  psqlArgs,
  quoteIdent,
  quoteLiteral,
  serverText,
} from "./logic.js";

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

test("quote: a literal doubles its single quotes", () => {
  assert.equal(quoteLiteral("it's"), "'it''s'");
});

test("quote: an identifier doubles its double quotes", () => {
  assert.equal(quoteIdent('a"b'), '"a""b"');
});

const SERVER = { host: "db.example.com", port: 6543, user: "app" };

test("server: reads the user, the host and the port", () => {
  assert.deepEqual(parseServer("app@db.example.com:6543"), SERVER);
});

test("server: with no user, the user is null so that psql picks it", () => {
  assert.deepEqual(parseServer("localhost:5432"), { host: "localhost", port: 5432, user: null });
});

test("server: with no port, the port is 5432", () => {
  assert.equal(parseServer("localhost").port, 5432);
});

test("server: a socket folder can be the host", () => {
  assert.equal(parseServer("/var/run/postgresql").host, "/var/run/postgresql");
});

test("server: ignores spaces around the text", () => {
  assert.equal(parseServer("  localhost:5432 ").host, "localhost");
});

for (const bad of ["", "   ", "a b", "host:abc", "host:70000", "host:0", "@host", "a@b@c", ":5432", undefined]) {
  test(`server: refuses ${JSON.stringify(bad)}`, () => {
    assert.equal(parseServer(bad), null);
  });
}

test("server: the default is the standard local port", () => {
  assert.equal(DEFAULT_SERVER, "localhost:5432");
});

test("server: with nothing stored, the text is the default", () => {
  assert.equal(serverText(undefined), DEFAULT_SERVER);
});

test("server: with a bad value stored, the text is the default", () => {
  assert.equal(serverText("bad host"), DEFAULT_SERVER);
});

test("server: with a good value stored, the text is that value", () => {
  assert.equal(serverText("app@db:1"), "app@db:1");
});

test("conninfo: connects with the host, the port, the user and the database", () => {
  assert.match(conninfo(SERVER, "shop"), /^host='db\.example\.com' port='6543' user='app' dbname='shop' /);
});

test("conninfo: with no user, the text has no user field", () => {
  assert.doesNotMatch(conninfo({ ...SERVER, user: null }, "shop"), /user=/);
});

test("conninfo: a quote in the user stays inside its value", () => {
  assert.match(conninfo({ ...SERVER, user: "a'b" }, "shop"), /user='a\\'b' /);
});

test("conninfo: every session is read-only", () => {
  assert.match(conninfo(SERVER, "shop"), /-c default_transaction_read_only=on/);
});

test("conninfo: sets no statement timeout, so long queries run to the end", () => {
  assert.doesNotMatch(conninfo(SERVER, "shop"), /statement_timeout/);
});

test("conninfo: escapes a quote and a backslash in the database name", () => {
  assert.match(conninfo(SERVER, "a'b\\c"), /dbname='a\\'b\\\\c' /);
});

test("psql args: never prompt, skip psqlrc, use CSV and mark NULL", () => {
  const args = psqlArgs(SERVER, "shop", "select 1");
  assert.ok(args.includes("-d"));
  assert.match(args[args.indexOf("-d") + 1], /^host='db\.example\.com' /);
  assert.ok(args.includes("-w"));
  assert.ok(args.includes("-X"));
  assert.ok(args.includes("--csv"));
  assert.ok(args.includes(`null=${NULL_MARK}`));
  assert.deepEqual(args.slice(-2), ["-c", "select 1"]);
});

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

test("error: a timeout set on the server gets a clear message", () => {
  assert.equal(errorMessage("ERROR:  canceling statement due to statement timeout\n"), "The server stopped the query: it ran past the server's own statement timeout.");
});

test("psql args: write the result to a file when asked, and to stdout otherwise", () => {
  const args = psqlArgs(SERVER, "shop", "select 1", "/tmp/r.csv");
  assert.deepEqual(args.slice(-2), ["-o", "/tmp/r.csv"]);
  assert.equal(psqlArgs(SERVER, "shop", "select 1").includes("-o"), false);
});

test("error: removes the prefix and keeps the first line", () => {
  assert.equal(errorMessage('ERROR:  relation "x" does not exist\nLINE 1: select\n'), 'relation "x" does not exist');
  assert.equal(errorMessage("psql: error: connection refused\n\tmore\n"), "connection refused");
});

test("error: has a text when psql gives none", () => {
  assert.equal(errorMessage(""), "psql failed with no message.");
});

test("error: a missing password points to the password file", () => {
  const stderr = 'psql: error: connection to server at "localhost" (127.0.0.1), port 5432 failed: fe_sendauth: no password supplied\n';
  assert.equal(errorMessage(stderr), "The server needs a password. Add it to ~/.pgpass.");
});
