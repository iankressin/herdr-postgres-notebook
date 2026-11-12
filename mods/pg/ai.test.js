// Run with: cd ~/.config/herdr-app/mods/pg && node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { agentPhase, firstMessage, fixable, jobText, psqlCommand, readAnswer, shellWord } from "./ai.js";

test("server errors about the query can be fixed; connection, timeout and rights errors cannot", () => {
  assert.equal(fixable('ERROR:  syntax error at or near "selec"\nLINE 1: selec 1\n        ^'), true);
  assert.equal(fixable('ERROR:  column "nme" does not exist\nLINE 1: select nme from users'), true);
  assert.equal(fixable('ERROR:  relation "userz" does not exist'), true);
  assert.equal(fixable('psql: error: connection to server at "localhost" (::1), port 5432 failed: Connection refused'), false);
  assert.equal(fixable("psql: error: fe_sendauth: no password supplied"), false);
  assert.equal(fixable("ERROR:  canceling statement due to statement timeout"), false);
  assert.equal(fixable("ERROR:  cannot execute DELETE in a read-only transaction"), false);
  assert.equal(fixable("ERROR:  permission denied for table secrets"), false);
  assert.equal(fixable(""), false);
  assert.equal(fixable(undefined), false);
});

test("shell words survive the shell unchanged", () => {
  for (const text of ["plain", "host='a b' port='5432'", "it's", 'say "hi"', "$HOME `x` \\n !", "a\\'b"]) {
    const out = execFileSync("sh", ["-c", `printf %s ${shellWord(text)}`], { encoding: "utf8" });
    assert.equal(out, text);
  }
});

test("the psql command connects read-only to the right database", () => {
  const command = psqlCommand({ host: "localhost", port: 5432, user: "app" }, "shop");
  const argv = execFileSync("sh", ["-c", `set -- ${command.replace(/^psql /, "")}; for a; do printf '%s\\n' "$a"; done`], { encoding: "utf8" }).trim().split("\n");
  assert.deepEqual(argv.slice(0, 3), ["-X", "-w", "-d"]);
  assert.match(argv[3], /dbname='shop'/);
  assert.match(argv[3], /user='app'/);
  assert.match(argv[3], /default_transaction_read_only=on/);
});

test("an answer is read with or without fences, and its title line is taken off", () => {
  assert.deepEqual(readAnswer("select 1"), { sql: "select 1", title: "" });
  assert.deepEqual(readAnswer("```sql\nselect 1\n```\n"), { sql: "select 1", title: "" });
  assert.deepEqual(readAnswer("-- title: Orders per day\nselect day, count(*)\nfrom orders\ngroup by day"), {
    sql: "select day, count(*)\nfrom orders\ngroup by day", title: "Orders per day",
  });
  assert.deepEqual(readAnswer("\r\n-- Title:  Top customers \r\nselect 1;\r\n"), { sql: "select 1;", title: "Top customers" });
  assert.deepEqual(readAnswer("-- just a note\nselect 1"), { sql: "-- just a note\nselect 1", title: "" });
  assert.equal(readAnswer("  \n"), null);
  assert.equal(readAnswer("-- title: Nothing"), null);
});

test("the agent's phase follows its terminal", () => {
  assert.equal(agentPhase(undefined), "gone");
  assert.equal(agentPhase({ state: "exited", status: "idle", turn: 2 }), "gone");
  assert.equal(agentPhase({ state: "live", turn: 0 }), "starting");
  assert.equal(agentPhase({ state: "live", status: "idle", turn: 0 }), "starting");
  assert.equal(agentPhase({ state: "live", status: "working", turn: 0 }), "working");
  assert.equal(agentPhase({ state: "live", status: "blocked", turn: 1 }), "blocked");
  assert.equal(agentPhase({ state: "live", status: "idle", turn: 1 }), "stopped");
  assert.equal(agentPhase({ state: "live", status: "done", turn: 3 }), "stopped");
});

const base = {
  server: "app@localhost:5432", database: "shop", psql: "psql -X -w -d x", notebook: "Daily checks",
  tables: ["public.orders", "public.customers"], others: [{ title: "Orders", sql: "select * from orders" }], answer: "/tmp/answers/j_1",
};

test("a write brief carries the request, the tables, the other queries and where to answer", () => {
  const text = jobText({ ...base, kind: "write", request: "top 10 customers\nby revenue" });
  assert.match(text, /> top 10 customers\n> by revenue/);
  assert.match(text, /public\.orders, public\.customers/);
  assert.match(text, /### Orders\n\n```sql\nselect \* from orders\n```/);
  assert.match(text, /\/tmp\/answers\/j_1\.sql/);
  assert.match(text, /\/tmp\/answers\/j_1\.txt/);
  assert.match(text, /-- title:/);
  assert.match(text, /psql -X -w -d x/);
});

test("an edit brief carries the query and its last columns; a fix brief carries psql's error", () => {
  const edit = jobText({ ...base, kind: "edit", request: "only last week", sql: "select * from orders", columns: ["id", "total"], rows: 1 });
  assert.match(edit, /> only last week/);
  assert.match(edit, /1 row with the columns id, total/);
  assert.doesNotMatch(edit, /-- title:/);
  const fix = jobText({ ...base, kind: "fix", sql: "selec 1", error: 'ERROR:  syntax error at or near "selec"' });
  assert.match(fix, /```sql\nselec 1\n```/);
  assert.match(fix, /syntax error at or near "selec"/);
});

test("the long parts of a brief are capped", () => {
  const tables = Array.from({ length: 450 }, (_, i) => `public.t${i}`);
  const others = Array.from({ length: 50 }, (_, i) => ({ title: `Q${i}`, sql: "x".repeat(400) }));
  const text = jobText({ ...base, kind: "write", request: "anything", tables, others });
  assert.match(text, /public\.t399, and 50 more\./);
  assert.doesNotMatch(text, /public\.t400/);
  assert.ok((text.match(/### Q/g) ?? []).length < 20);
});

test("a brief tells a database with no tables from one not listed yet", () => {
  assert.match(jobText({ ...base, kind: "write", request: "x", tables: [] }), /no tables or views of its own/);
  assert.match(jobText({ ...base, kind: "write", request: "x", tables: null }), /not listed its tables yet/);
});

test("the first message points at the brief", () => {
  assert.equal(firstMessage("/a/jobs/j_1.md"), "Read /a/jobs/j_1.md and do what it says.");
});
