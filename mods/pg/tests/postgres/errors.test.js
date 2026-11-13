import { test } from "node:test";
import assert from "node:assert/strict";
import { errorMessage, fixable } from "../../src/postgres/errors.js";

test("error: a timeout set on the server gets a clear message", () => {
  assert.equal(errorMessage("ERROR:  canceling statement due to statement timeout\n"), "The server stopped the query: it ran past the server's own statement timeout.");
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
