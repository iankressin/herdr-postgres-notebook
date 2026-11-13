// The agent behind the AI buttons. Each request starts the person's chosen agent in a terminal
// of its own, with a brief to read; this checks for the answer file, puts the SQL in the query
// and runs it. The terminal is in no tab: the person sees it only when they open it.
import * as fs from "fs/promises";
import { appHome, hc, knownAgents, notify, run, setShared, shared, terminals } from "herdr";
import { AGENT_KEY, agentPhase, firstMessage, jobText, psqlCommand, readAnswer } from "./protocol.js";
import { parseServer } from "../postgres/connection.js";
import * as nb from "../notebooks/document.js";

const POLL_MS = 1000;
// An agent still silent after this long is most likely asking something first (Claude Code asks
// once whether to trust its folder), so the page offers to open it.
const SLOW_MS = 8000;
// Claude Code reads these settings from its folder: there it may run psql and write answers
// without asking each time. Other agents ask once, in their terminal.
const CLAUDE_SETTINGS = { permissions: { allow: ["Bash(psql:*)", "Read(./**)", "Edit(./answers/**)"] } };

const workDir = () => `${appHome()}/data/pg/ai`;
const messageOf = (e) => String(e?.message ?? e);
const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
const kill = (address) => (address ? hc(["kill", address]).catch(() => {}) : Promise.resolve());
const readIfThere = async (path) => ((await fs.exists(path)) ? fs.readFile(path, "utf8") : null);
const running = (job) => !job.done && !job.failed;

export class Assistant {
  constructor(view) {
    this.view = view;
    // One job per query, by query id: running, failed, or done (kept so it can be undone).
    this.jobs = new Map();
    // The installed agents, null until Herdr has said.
    this.agents = null;
    this.polling = false;
  }

  loadAgents(cx) {
    this.view.spawn(cx, async (cx) => {
      try {
        this.agents = (await knownAgents()).filter((a) => a.installed);
      } catch {
        this.agents = [];
      }
      cx.notify();
    });
  }

  // The person's pick, kept for every pg tab; else the agent they start most.
  agent() {
    const list = this.agents ?? [];
    return list.find((a) => a.key === shared(AGENT_KEY)) ?? list[0] ?? null;
  }

  choose(key) {
    setShared(AGENT_KEY, key);
  }

  jobOf(queryId) {
    return this.jobs.get(queryId) ?? null;
  }

  // failed, done, or what its terminal says: starting, working, blocked, stopped, gone.
  phase(job) {
    if (job.failed) return "failed";
    if (job.done) return "done";
    if (!job.terminal) return "starting";
    return agentPhase(terminals().find((t) => t.address === job.terminal));
  }

  // `kind` is write, edit or fix. A new job on a query replaces the one it had.
  start(kind, queryId, request, cx) {
    const view = this.view;
    const notebook = view.notebook();
    const query = notebook?.queries.find((q) => q.id === queryId);
    if (!query) return;
    const agent = this.agent();
    if (!agent) {
      notify({
        title: "No coding agent to ask",
        body: this.agents === null ? "Herdr is still checking which agents are installed. Try again in a moment." : "Install an agent Herdr can start, such as Claude Code or Codex, then try again.",
        level: "warning",
      });
      return;
    }
    this.stop(queryId);
    const cell = view.queries.cells.get(queryId);
    const id = nb.newId("j");
    const dir = workDir();
    const brief = `${dir}/jobs/${id}.md`;
    const answer = `${dir}/answers/${id}`;
    const text = jobText({
      kind,
      request,
      server: view.server,
      database: view.db,
      psql: psqlCommand(parseServer(view.server), view.db),
      sql: cell?.editor.value() ?? query.sql,
      error: cell?.errorDetail ?? cell?.error ?? "",
      columns: cell?.result?.header ?? [],
      rows: cell?.result?.rows.length ?? 0,
      tables: view.tables && !view.tables.loading ? view.tables.list.map((t) => `${t.schema}.${t.name}`) : null,
      notebook: notebook.name,
      others: notebook.queries.filter((q) => q.id !== queryId)
        .map((q) => ({ title: nb.queryTitle(q), sql: view.queries.cells.get(q.id)?.editor.value() ?? q.sql })),
      answer,
    });
    const job = { id, kind, queryId, nbId: notebook.id, request, agent: { key: agent.key, name: agent.name }, terminal: null, failed: null, done: false, before: null, brief, answer, started: Date.now(), slow: false };
    this.jobs.set(queryId, job);
    cx.notify();
    view.spawn(cx, async (cx) => {
      try {
        await prepare(dir);
        await fs.writeFile(brief, text);
        const started = await hc(["run", "--bg", "--json", "--no-parent", "--rm", "--name", `pg-${id}`, "--cwd", dir, "--label", `pg.job=${id}`,
          "--", ...agent.run, firstMessage(brief)]);
        if (started.code !== 0) throw new Error(started.stderr.trim() || started.stdout.trim() || "hc gave no reason.");
        const address = JSON.parse(started.stdout).address;
        if (this.jobs.get(queryId) !== job) {
          await kill(address);
          return;
        }
        job.terminal = address;
        this.poll(cx);
      } catch (e) {
        if (this.jobs.get(queryId) !== job) return;
        job.failed = `Could not start ${agent.name}: ${messageOf(e)}`;
        clean(job);
      }
      cx.notify();
    });
  }

  // One loop per pg tab while any agent is working.
  poll(cx) {
    if (this.polling) return;
    this.polling = true;
    this.view.spawn(cx, async (cx) => {
      while (!this.view.closed && [...this.jobs.values()].some((j) => running(j) && j.terminal)) {
        await cx.sleep(POLL_MS);
        for (const job of [...this.jobs.values()]) {
          if (running(job) && job.terminal && (await this.check(job, cx))) cx.notify();
        }
      }
      this.polling = false;
    });
  }

  // True when the job moved on: answered, refused, or its agent closed.
  async check(job, cx) {
    const sql = await readIfThere(`${job.answer}.sql`).catch(() => null);
    if (this.jobs.get(job.queryId) !== job) return false;
    if (sql !== null) {
      this.apply(job, sql, cx);
      return true;
    }
    const why = await readIfThere(`${job.answer}.txt`).catch(() => null);
    if (this.jobs.get(job.queryId) !== job) return false;
    if (why !== null) {
      this.fail(job, `${job.agent.name} could not do it: ${why.trim() || "it gave no reason."}`);
      return true;
    }
    const phase = agentPhase(terminals().find((t) => t.address === job.terminal));
    if (phase === "gone") {
      job.terminal = null;
      this.fail(job, `${job.agent.name} closed without an answer.`);
      return true;
    }
    if (phase === "starting" && !job.slow && Date.now() - job.started > SLOW_MS) {
      job.slow = true;
      return true;
    }
    return false;
  }

  fail(job, message) {
    job.failed = message;
    kill(job.terminal);
    job.terminal = null;
    clean(job);
  }

  // The answer goes in the document, so it is saved and every tab sees it, then the query runs.
  apply(job, text, cx) {
    const answer = readAnswer(text);
    if (!answer) {
      this.fail(job, `${job.agent.name} wrote an empty answer.`);
      return;
    }
    const view = this.view;
    const query = view.file?.state === "ready" ? nb.notebookOf(view.file.doc, job.nbId)?.queries.find((q) => q.id === job.queryId) : null;
    if (!query) {
      this.stop(job.queryId);
      return;
    }
    const cell = job.nbId === view.nbId ? view.queries.cells.get(job.queryId) : null;
    job.before = { sql: cell?.editor.value() ?? query.sql, title: query.title };
    const change = job.kind === "write" && answer.title ? { sql: answer.sql, title: answer.title } : { sql: answer.sql };
    view.change((d) => nb.updateQuery(d, job.nbId, job.queryId, change, now()), cx);
    view.queries.syncCells();
    if (cell) view.queries.runCell(cell, cx);
    job.done = true;
    kill(job.terminal);
    job.terminal = null;
    clean(job);
  }

  // Back to the SQL and title the query had before the agent's answer, and run it.
  undo(queryId, cx) {
    const job = this.jobOf(queryId);
    if (!job?.done || !job.before) return;
    this.jobs.delete(queryId);
    const { sql, title } = job.before;
    const view = this.view;
    view.change((d) => nb.updateQuery(d, job.nbId, queryId, { sql, title }, now()), cx);
    view.queries.syncCells();
    const cell = job.nbId === view.nbId ? view.queries.cells.get(queryId) : null;
    if (cell) view.queries.runCell(cell, cx);
    cx.notify();
  }

  watch(job) {
    if (job.terminal) run("terminal.peek", { terminal: job.terminal });
  }

  cancel(queryId, cx) {
    this.stop(queryId);
    cx.notify();
  }

  dismiss(queryId, cx) {
    this.jobs.delete(queryId);
    cx.notify();
  }

  stop(queryId) {
    const job = this.jobs.get(queryId);
    if (!job) return Promise.resolve();
    this.jobs.delete(queryId);
    return Promise.all([kill(job.terminal), clean(job)]);
  }

  stopAll() {
    return Promise.all([...this.jobs.keys()].map((id) => this.stop(id)));
  }
}

async function prepare(dir) {
  await fs.mkdir(`${dir}/jobs`, { recursive: true });
  await fs.mkdir(`${dir}/answers`, { recursive: true });
  const settings = `${dir}/.claude/settings.json`;
  if (!(await fs.exists(settings))) {
    await fs.mkdir(`${dir}/.claude`, { recursive: true });
    await fs.writeFile(settings, `${JSON.stringify(CLAUDE_SETTINGS, null, 2)}\n`);
  }
}

const clean = (job) => Promise.all([job.brief, `${job.answer}.sql`, `${job.answer}.txt`].map((p) => fs.unlink(p).catch(() => {})));
