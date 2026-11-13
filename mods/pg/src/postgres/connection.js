import { NULL_MARK } from "./csv.js";

const DEFAULT_PORT = 5432;

export const DEFAULT_SERVER = `localhost:${DEFAULT_PORT}`;
export const SERVER_KEY = "pg.server";
export const SERVER_HELP = "Use user@host:port, for example app@localhost:5432.";

const SERVER_PATTERN = /^(?:([^@\s]+)@)?([^:@\s]+)(?::(\d+))?$/;

// The text is user@host:port. The user and the port are optional. Without a user, psql picks the user.
export function parseServer(text) {
  const match = String(text ?? "").trim().match(SERVER_PATTERN);
  if (!match) return null;
  const [, user = null, host, port = DEFAULT_PORT] = match;
  const number = Number(port);
  return number >= 1 && number <= 65535 ? { host, port: number, user } : null;
}

export const serverText = (stored) => (parseServer(stored) ? String(stored).trim() : DEFAULT_SERVER);
export const quoteLiteral = (text) => `'${text.replace(/'/g, "''")}'`;
export const quoteIdent = (name) => `"${name.replace(/"/g, '""')}"`;

const conninfoValue = (text) => `'${text.replace(/[\\']/g, "\\$&")}'`;

export function conninfo({ host, port, user }, database) {
  const userField = user ? `user=${conninfoValue(user)} ` : "";
  return `host=${conninfoValue(host)} port=${conninfoValue(String(port))} ${userField}dbname=${conninfoValue(database)} `
    + `connect_timeout=5 application_name=herdr-pg `
    + `options='-c default_transaction_read_only=on'`;
}

// With `output`, psql writes the result to that file instead of stdout.
export function psqlArgs(server, database, sql, output = null) {
  return ["-X", "-w", "--csv", "-P", `null=${NULL_MARK}`, "-d", conninfo(server, database), "-c", sql, ...(output ? ["-o", output] : [])];
}
