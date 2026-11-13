import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SERVER, conninfo, parseServer, psqlArgs, quoteIdent, quoteLiteral, serverText } from "../../src/postgres/connection.js";
import { NULL_MARK } from "../../src/postgres/csv.js";

const SERVER = { host: "db.example.com", port: 6543, user: "app" };

test("quote: a literal doubles its single quotes", () => {
  assert.equal(quoteLiteral("it's"), "'it''s'");
});

test("quote: an identifier doubles its double quotes", () => {
  assert.equal(quoteIdent('a"b'), '"a""b"');
});

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

test("psql args: write the result to a file when asked, and to stdout otherwise", () => {
  const args = psqlArgs(SERVER, "shop", "select 1", "/tmp/r.csv");
  assert.deepEqual(args.slice(-2), ["-o", "/tmp/r.csv"]);
  assert.equal(psqlArgs(SERVER, "shop", "select 1").includes("-o"), false);
});
