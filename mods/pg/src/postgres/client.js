import { errorMessage, fixable } from "./errors.js";
import { parseServer, psqlArgs } from "./connection.js";
import { LIST_DATABASES_SQL, parseDatabases } from "./catalog.js";

export const ADMIN_DATABASE = "postgres";
const QUERY_MS = 600000;
const messageOf = (e) => String(e?.message ?? e);

function execFailed(e) {
  const message = messageOf(e);
  if (/time/i.test(message)) throw new Error("The query ran for 10 minutes, the longest Herdr lets a program run.");
  if (/not found|no such file|spawn/i.test(message)) throw new Error("Could not start psql. Install the PostgreSQL client.");
  throw new Error(message);
}
// psql's whole message stays on the error: an agent asked to fix the query reads it.
function queryFailed(stderr) {
  return Object.assign(new Error(errorMessage(stderr)), { detail: stderr.trim(), fixable: fixable(stderr) });
}

export function createPostgresClient({ exec, currentServer, resultFiles }) {
  // For the catalog: small answers, read from stdout.
  async function runPsql(database, sql) {
    const result = await exec("psql", psqlArgs(parseServer(currentServer()), database, sql)).catch(execFailed);
    if (result.code !== 0) throw new Error(errorMessage(result.stderr));
    return result.stdout;
  }
  // For a person's query: psql writes the rows to a file, which skips exec's 8 MiB output cap and
  // keeps a result too big for Herdr whole, to save. Returns the file.
  async function runQuery(database, sql) {
    const file = await resultFiles.create();
    try {
      const result = await exec("psql", psqlArgs(parseServer(currentServer()), database, sql, file), { timeout: QUERY_MS }).catch(execFailed);
      if (result.code !== 0) throw queryFailed(result.stderr);
      return file;
    } catch (e) {
      await resultFiles.forget(file);
      throw e;
    }
  }

  return {
    catalog: runPsql,
    query: runQuery,
    listDatabases: async () => parseDatabases(await runPsql(ADMIN_DATABASE, LIST_DATABASES_SQL)),
  };
}
