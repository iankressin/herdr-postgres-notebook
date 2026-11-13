// What the pg tab asks of a coding agent and how it reads the answer back. No app imports, so
// `node --test` can run it.
//
// A request is a job: a Markdown brief the agent reads, and a file it writes its SQL to. The
// agent runs in a terminal of its own, so the person can open it and answer when it asks.
import { conninfo } from "../postgres/connection.js";

export const AGENT_KEY = "pg.agent";

// What each kind of job is called while it runs and once it is done.
export const VERBS = {
  write: { doing: "writing this query", done: "Written" },
  edit: { doing: "editing this query", done: "Edited" },
  fix: { doing: "fixing this query", done: "Fixed" },
};

const TABLES_LISTED = 400;
const OTHERS_CHARS = 6000;

// One shell word, quoted only when it needs it, so the agent can paste the command as it is.
export function shellWord(text) {
  const s = String(text);
  if (/^[\w@%+=:,./-]+$/.test(s)) return s;
  if (/[$`"\\!]/.test(s)) return `'${s.replace(/'/g, "'\\''")}'`;
  return `"${s}"`;
}

export const psqlCommand = (server, database) => `psql -X -w -d ${shellWord(conninfo(server, database))}`;

export const firstMessage = (jobPath) => `Read ${jobPath} and do what it says.`;

const quote = (text) => text.trim().split("\n").map((line) => `> ${line}`).join("\n");
const fence = (text, lang = "") => `\`\`\`${lang}\n${text.trim()}\n\`\`\``;

// `tables` is null while the notebook is still listing them.
function tablesLine(tables) {
  if (tables === null) return "The notebook has not listed its tables yet; look them up with psql.";
  if (tables.length === 0) return "It has no tables or views of its own; Postgres's own catalog is there as usual.";
  const shown = tables.slice(0, TABLES_LISTED).join(", ");
  const more = tables.length > TABLES_LISTED ? `, and ${tables.length - TABLES_LISTED} more` : "";
  return `Tables and views: ${shown}${more}.`;
}

function othersBlock(others) {
  let room = OTHERS_CHARS;
  const parts = [];
  for (const q of others) {
    const part = `### ${q.title}\n\n${fence(q.sql, "sql")}`;
    if (part.length > room) break;
    parts.push(part);
    room -= part.length;
  }
  return parts.length > 0 ? `Its other queries, for context:\n\n${parts.join("\n\n")}` : "It has no other queries yet.";
}

function taskBlock(job) {
  if (job.kind === "write") {
    return `Write a query that answers this request:\n\n${quote(job.request)}\n\n`
      + "When the query lists rows rather than counting or grouping them, end it with `limit 100` unless the request asks for more.";
  }
  if (job.kind === "edit") {
    const last = job.columns?.length
      ? `Its last result had ${job.rows} row${job.rows === 1 ? "" : "s"} with the columns ${job.columns.join(", ")}.`
      : "It has not returned rows yet.";
    return `Change this query so its results match this request:\n\n${quote(job.request)}\n\nThe query now:\n\n${fence(job.sql, "sql")}\n\n${last}\n\n`
      + "Keep whatever the request does not mention as it is.";
  }
  return `This query failed. Fix it so it runs, and keep what it was meant to show.\n\n${fence(job.sql, "sql")}\n\npsql said:\n\n${fence(job.error)}`;
}

// The brief for one job. `answer` is the path of the answer files, without the extension.
export function jobText(job) {
  const titleLine = job.kind === "write" ? " Its first line may be `-- title: <a few words>` naming what it shows." : "";
  return `# A query for a Postgres notebook

Someone is working in a SQL notebook on the Postgres database \`${job.database}\` (server ${job.server}).

## The database

Read it with psql. This session is read-only, and the notebook runs queries the same way:

    ${job.psql}

Look up what you need with \`\\dn\`, \`\\dt schema.*\`, \`\\d schema.table\` or the catalog. Never try to change the database, its data or its settings.

${tablesLine(job.tables ?? null)}

## The notebook "${job.notebook}"

${othersBlock(job.others ?? [])}

## The task

${taskBlock(job)}

## Your answer

1. Run your final query once with psql to check that it works.
2. Write it to ${job.answer}.sql: one SQL statement, no Markdown fences, no explanation.${titleLine}
3. If you can't do it (the request is unclear, or the data isn't there), write a sentence or two saying why to ${job.answer}.txt instead.

Write only that file, then stop. The notebook reads it as soon as it appears; the person does not see this terminal unless they open it.
`;
}

// The agent's SQL, and the title it gave, from what it wrote. Null when it wrote nothing.
export function readAnswer(text) {
  let body = String(text ?? "").replace(/\r\n/g, "\n").trim();
  const fenced = body.match(/^```[\w-]*\n([\s\S]*?)\n```$/);
  if (fenced) body = fenced[1].trim();
  let title = "";
  const first = body.match(/^--\s*title:[ \t]*(.*)(\n|$)/i);
  if (first) {
    title = first[1].trim();
    body = body.slice(first[0].length).trim();
  }
  return body ? { sql: body, title } : null;
}

// Where the agent's terminal is, from Herdr's `terminals()`: starting until it reports, then
// working, waiting on the person (blocked), stopped after a turn without an answer, or gone.
export function agentPhase(terminal) {
  if (!terminal || terminal.state !== "live") return "gone";
  if (terminal.status === "blocked") return "blocked";
  if ((terminal.status === "idle" || terminal.status === "done") && terminal.turn > 0) return "stopped";
  return terminal.status === "working" ? "working" : "starting";
}
