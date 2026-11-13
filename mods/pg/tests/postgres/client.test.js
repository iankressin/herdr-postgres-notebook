import { test } from "node:test";
import assert from "node:assert/strict";
import { createPostgresClient } from "../../src/postgres/client.js";

function client(exec) {
  const removed = [];
  const postgres = createPostgresClient({
    exec,
    currentServer: () => "reader@localhost:5432",
    resultFiles: {
      create: async () => "/results/query.csv",
      forget: async (file) => { removed.push(file); },
    },
  });
  return { postgres, removed };
}

test("catalog results are parsed as database names", async () => {
  const { postgres } = client(async (command, args) => {
    assert.equal(command, "psql");
    assert.ok(args.includes("--csv"));
    assert.match(args[args.indexOf("-d") + 1], /default_transaction_read_only=on/);
    return { code: 0, stdout: "datname\npostgres\nshop\n", stderr: "" };
  });
  assert.deepEqual(await postgres.listDatabases(), ["postgres", "shop"]);
});

test("queries write to a file with the existing execution timeout", async () => {
  const { postgres, removed } = client(async (_command, args, options) => {
    assert.deepEqual(args.slice(-2), ["-o", "/results/query.csv"]);
    assert.equal(options.timeout, 600000);
    assert.equal(args[args.indexOf("-c") + 1], "select 1");
    return { code: 0, stdout: "", stderr: "" };
  });
  assert.equal(await postgres.query("shop", "select 1"), "/results/query.csv");
  assert.deepEqual(removed, []);
});

test("a failed query removes its file and retains the diagnostic for repair", async () => {
  const { postgres, removed } = client(async () => ({ code: 1, stderr: "ERROR: column missing does not exist\nLINE 1: select missing\n" }));
  await assert.rejects(postgres.query("shop", "select missing"), (error) => {
    assert.equal(error.message, "column missing does not exist");
    assert.match(error.detail, /LINE 1/);
    assert.equal(error.fixable, true);
    return true;
  });
  assert.deepEqual(removed, ["/results/query.csv"]);
});

test("failure to start psql removes its output file", async () => {
  const { postgres, removed } = client(async () => { throw new Error("spawn: not found"); });
  await assert.rejects(postgres.query("shop", "select 1"), /Install the PostgreSQL client/);
  assert.deepEqual(removed, ["/results/query.csv"]);
});
