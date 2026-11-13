export function errorMessage(stderr) {
  if (stderr.includes("statement timeout")) return "The server stopped the query: it ran past the server's own statement timeout.";
  if (stderr.includes("no password supplied")) return "The server needs a password. Add it to ~/.pgpass.";
  const first = stderr.split("\n")[0].trim().replace(/^(psql: error: |ERROR:\s+|FATAL:\s+)/, "");
  return first || "psql failed with no message.";
}

// The errors a rewrite can fix: the server read the query and refused it. Not a lost
// connection, a missing password, a timeout, missing rights, or a write in a read-only session.
const NOT_THE_QUERY = /read-only transaction|statement timeout|canceling statement|permission denied|out of memory/i;
export const fixable = (stderr) => /\bERROR:/.test(String(stderr ?? "")) && !NOT_THE_QUERY.test(stderr);
