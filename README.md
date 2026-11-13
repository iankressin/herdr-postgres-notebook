# Postgres Notebook for Herdr

**Notebooks for Postgres. And your agent.** Asks the coding agent you already use. No new API key.

A Postgres browser mod for the [Herdr app](https://herdr.dev). Keep notebooks of SQL queries for each database, sort them into folders, and see each result as a table, a chart or a summary of its columns. When you'd rather not write the SQL yourself, ask the coding agent you already use: it writes a query from plain words, fixes one the server refused, or changes what a result shows.

![Demo: ask the agent for orders per day, run the query and change its chart](demo.gif)

## Charts

A result that charts well opens as a chart. A row of buttons above it picks the chart: **Auto**, or any type that fits the result. There are 15: bars, columns, stacked columns, grouped columns, 100% bars, line, area, step, running total, scatter, bubbles, histogram, count, big numbers, and a table with bars. A chart of one number lets you pick which one. A chart of several lets you turn each on and off. **By** chips pick the column a chart runs along. Your choices are saved with the query.

![Bars, columns, stacked columns, grouped columns, 100% bars, a table with bars and big numbers](charts-bars.png)

![Line, area, step, running total, scatter, bubbles, histogram and count](charts-lines.png)


## Ask your agent

Three buttons, each marked with a sparkle:

- **Ask AI for a query**, at the foot of the page beside **Add a query**. Describe what you want and press **Write it**. The agent writes the query; it lands in the notebook with a title, and the notebook runs it. In our tests, "How many connections does each database have right now?" came back in about 20 seconds as "Connections per database", drawn as a bar chart.
- **Fix with AI**, under the error when the server refuses a query: a syntax error, or a table or column that isn't there. The agent rewrites the query and the notebook runs it again. A `selec` typo took about 15 seconds.
- **Edit with AI**, to the right of **Run**. Say how the results should differ and press **Edit it**. The agent changes the query in place. Asked to "Leave out template databases, and add each one's share of all connections as a percentage", it took about 20 seconds, and the page then read *Edited by Claude Code: “…” · Undo*.

How it works:

- **It uses your agent.** The buttons start a coding agent you have installed and signed in to, such as Claude Code or Codex. The mod holds no API key and calls no AI service of its own. Pick the agent under **Ask with** in the request box; every pg tab keeps that choice.
- **You can watch it.** The agent runs in a terminal of its own, outside your tabs. While it works, a line under the query's title says what it is doing, with **Watch**, which opens its terminal over the tab so you can answer or steer it, and **Stop**. If it asks you something, the line says "Claude Code needs you".
- **It gets a short brief.** The mod tells the agent the database's read-only psql command, its table names, the notebook's other queries and the task. The brief asks it to look up what it needs with psql, run its query once to check it, and write the SQL to a file. The notebook then reads the file and runs the query itself.
- **The answer is an ordinary query.** It is saved with the notebook, and you can edit it like any other. After a fix or an edit, **Undo** puts back the query you had, until you hide that line or close the tab. A new query starts as your request in a SQL comment, so you keep the request if the agent fails.
- Closing the tab stops any agent still at work.

Limits:

- Only Claude Code has been tested end to end. The first time, Claude Code asks whether to trust the mod's work folder, `~/.config/herdr-app/data/pg/ai`; the line says it "has not started", and **Open** shows the question. Other agents may ask before they run psql.
- An answer took 15 to 20 seconds in our tests. The agent reads the schema and checks its query before it answers; a big schema takes longer.
- The agent has a shell. Only its brief and the read-only connection string keep it from writing to the database, and the session's read-only setting is a default, not a lock (see below). For a database that matters, connect as a role that can only read: on Postgres 14 or later, one granted `pg_read_all_data` and nothing more. Keep the passwords of stronger roles on that server out of `~/.pgpass` too: Claude Code may run any psql command without asking, and psql takes passwords from that file, so the agent can connect as any role it finds there.

## What it does to your machine

- It runs `psql` on your machine for every query. Sessions are read-only (`default_transaction_read_only=on`). That is each transaction's default: a query that asks for a read-write transaction can still write, so the role you connect as decides what is safe. It never asks for a password: put one in `~/.pgpass`.
- Queries have no time limit of their own. Herdr stops any program after 10 minutes.
- A result shows in full up to 50,000 rows, or fewer when rows are wide. All of Herdr's mods share a small script memory, so the notebook holds only so much at once across its tabs. When a result does not fit, the notebook asks what to do with it: show its first rows, save all of it as CSV, or discard it.
- psql writes each result to a temporary file in `~/.config/herdr-app/data/pg/`. The mod deletes the file once it has read it. For a result too big to show, it keeps the file until you save or discard the result, run the query again or close the tab. A file left behind by a crash goes after a day.
- It saves notebooks to `~/.config/herdr-app/pg-notebooks/<server>/<database>.json`. It saves a query's result only when you choose **Save all as CSV**: then psql's file moves to `~/Downloads/<query title>.csv`.
- The AI buttons start your chosen agent with `hc run`, in `~/.config/herdr-app/data/pg/ai`. The mod writes the brief to `jobs/<id>.md` there, and the agent writes its answer to `answers/<id>.sql` (or `.txt` when it can't do the task). The mod deletes both when the job ends.
- The first time you ask, it writes `~/.config/herdr-app/data/pg/ai/.claude/settings.json`. That file lets Claude Code run `psql`, read that folder and write answers there without asking each time. The mod doesn't change it after that.
- The mod itself reaches nothing on the network except the Postgres server you name. The agents it starts reach their AI provider, and send it what they read: the brief (your server's `user@host:port`, the database name, up to 400 table names, the notebook's other queries, the query, and its error or its last result's column names and row count) and whatever psql shows them, which can include rows of your data.

## Install

1. Install the PostgreSQL client (`psql`).
2. Copy `mods/pg/` into `~/.config/herdr-app/mods/`. If you already have a mod called `pg`, rename the folder, and rename the `mods/pg/` paths inside it to match.
3. Restart Herdr once, so it loads the serif font in `mods/pg/fonts/`.
4. Open a tab: `herdr-app do tab.new --mod pg --name "pg: mydb" --props '{"database":"mydb"}'`. Click the server line at the top left to set `user@host:port`.
5. For the AI buttons: install a coding agent Herdr can start, such as Claude Code, and sign in to it. Without one, the notebook works as before.

`RECIPE.md` describes the mod in full, for anyone who wants to build it again from scratch.

## Development

```sh
cd mods/pg
npm ci
npm run check
```

The mod is organized into application, PostgreSQL, notebooks, results, charts, AI, runtime, and UI modules. See the [development guide](mods/pg/README.md), [architecture](mods/pg/docs/architecture.md), and [contributing guide](mods/pg/CONTRIBUTING.md).

## License

MIT (`LICENSE`). The font, Source Serif 4, is © Adobe and licensed under the SIL Open Font License (`mods/pg/fonts/OFL.md`).
