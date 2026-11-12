# Postgres Notebook

A Postgres browser for the Herdr app. Each database gets a tab. On the left, an explorer lists the databases on your server, your saved notebooks in folders, and the tables. On the right, the open notebook reads as one page of SQL queries, each shown as a printed table, a chart or a column summary. Every session is read-only, and results of any size scroll smoothly.

![Postgres Notebook](preview.png)

## What you see

The tab has two parts side by side.

**Explorer** (left, 272px, `theme().chrome`), top to bottom:

1. **Server.** One line in mono, 12.5px, showing `user@host:port`, with a small pencil. A click turns it into a text field with an accent border. Under the field, dim text says "Enter connects. Esc cancels." A bad value shows "Use user@host:port, for example app@localhost:5432." in `ansi1`.
2. **Databases.** One 30px row each, with a database icon at 15px. The open one has a `selected` background, an accent icon and a reload button. The list scrolls past seven rows.
3. **Notebooks.** A heading with two icon buttons, + (new notebook) and folder-plus (new folder). Below it is a tree of 30px rows, indented 16px a level: chevron (folders only), folder, open folder or page icon at 14px, then the name. Folders come first, then notebooks, each sorted by name without regard to case. The open notebook has a `selected` background. A "…" button shows on hover.
4. **Tables.** A filter field (32px, `theme().background`, accent border while typing). Under it are schema groups, and table rows with their size on disk in mono, 11px. A chevron shows a table's columns, each with a type mark and a key for primary-key columns.

**Notebook page** (right, `theme().background`, 56px side padding, content at most 1040px wide, 44px between sections):

- The notebook's name in Source Serif 4, 36px, semibold. Under it, its folder path in muted text (`Ops / Daily checks`) and "Read-only. Nothing here can change the database." On the right, **Run all**.
- Each query has:
  - A title row: the title in Source Serif 4, 22px; the **Table · Chart · Summary** switch, which shows once there are rows; a × to remove the query; and the **Run** pill (`solid`, with ⌘↵).
  - The SQL block: editable, `theme().canvas`, radius 12, a 55% accent border while focused, soft wrap.
  - Then the error ("The query failed" in `ansi1`, the message in mono), "No rows.", or the result in the chosen view. Last comes the result line, for example `50 rows · 4 columns · 33 ms`.
- At the end, **Add a query**. An empty notebook says "Click a table on the left, or add a query."

## How it behaves

- **Opening.** Tab props are `{ database, notebook? }`. A tab opens `notebook` if given, else the database's last opened notebook, else the first one. Opening a notebook runs all its queries at once, and each result shows as it lands. A database with no notebook file gets an **Overview** notebook with two queries on Postgres's own catalog: "Tables by size" and "Settings by category".
- **Databases.** A click on another database goes to that database's tab, or opens one named `pg: <database>`. The reload button reads the databases and tables again.
- **Server.** Enter on a good value saves it to the shared key `pg.server`, and every pg tab follows. Each server keeps its own notebooks.
- **Tables.** A click adds `select * from schema.table limit 100` to the open notebook and runs it. With no notebook open, it first makes one named after the table. A click on a column adds its name to the query you last edited.
- **Tree.** A folder row or its chevron folds the folder open or shut. A notebook row opens it. A right-click, or the "…" button, opens a menu under the row (180px, `popover`) with Rename, Move to…, Duplicate (notebooks only) and Delete:
  - Rename turns the row into a text field. Enter or a click elsewhere saves. Esc cancels. An empty name is refused.
  - Move to… opens a small list under the row: "Top level" and every folder. It leaves out the item itself and anything inside it, and marks the current place with "here".
  - Duplicate makes "<name> copy" beside the notebook and opens it.
  - Delete removes a folder at once and moves its contents up one level. For a notebook, the row asks first: "Delete <name>? Delete / Keep".
- **Titles.** A click on the page title or a query title edits it in place. A query title left empty, or the same as the automatic one, stays automatic. The automatic title is the table the query reads, in words ("Order items").
- **No limits.** A query returns every row and runs until it ends, up to the 10 minutes Herdr allows any program. The table draws only the rows on screen.
- **Views.** Until you pick one, a result that charts well, with more than one row, opens as Chart. Anything else opens as Table. Your pick is saved with the query.
- **Charts** come from column kinds only:
  - a number over a date: bars on a real time axis;
  - a number per text label: horizontal bars, largest first, top 16, then "and N more, smaller";
  - two numbers: a scatter;
  - one number: a 20-range histogram;
  - text only: rows per value;
  - dates only: rows over time.

  Identifiers, code, prose and URLs never become an axis. When there are several numbers, **Measure** chips pick one, and the chip saves the column's name. Bars are at most 24px thick, 2px apart, rounded 4px at the data end. Gridlines sit at 0, 50% and 100%, with a 52px y-axis. Every bar and dot has a tooltip. One series uses one color: `ansi4`, and `accent` on hover. When two time points are closer than a fiftieth of the span, they are summed into 50 equal slices, and the chart says so.
- **Summary.** One line per column: name, what it holds (numbers, dates, yes or no, JSON, code, categories, identifiers, text), filled %, distinct count, then range and average, or the most common value.
- **Table.** Rules above and below, no vertical lines. Numbers sit on the right in mono. Ids and code are in mono and muted. Dates read as "Nov 11 · 21:05". Empty values show "—". Booleans read as true or false.
- **Saving.** Notebooks save to `~/.config/herdr-app/pg-notebooks/<server>/<database>.json` about 600ms after the last change. Results are never saved. Two tabs on the same database stay in step: a rename in one shows in the other within two seconds. A file that does not parse is kept as `<database>.json.corrupt-<time>`, and a notice says so.

## Built from

- **Mod:** `mods/pg/`, with `mod.json` `{ "place": "none", "title": "Postgres Notebook" }`. It runs in tabs, opened by `tab.new {mod: "pg", name: "pg: <db>", props: {database}}`.
- **Optional sidebar list:** the same mod with props `{ "view": "panel" }`, put in a layout's sidebar column, lists the databases. A click opens or selects that database's tab.
- **Files:**
  - `logic.js` holds the server text, psql arguments, CSV, catalog SQL and quoting.
  - `notebooks.js` holds the file shape, ids, the path rule, checking a file, tree steps and sorting.
  - `shape.js` holds value kinds, column profiles, chart choice, time slices, histograms and formatting.
  - `store.js` holds reading and writing the file.
  - `main.js` holds the view's state and actions.
  - `ui/*.js` draws.
  - `logic.js`, `notebooks.js` and `shape.js` have no app imports, and `node --test` runs their tests.
- **Programs:** `psql`, with `-X -w --csv` and a read-only session (`default_transaction_read_only=on`). For a query, psql writes the rows to a temporary file (`-o`, in `~/.config/herdr-app/data/pg/`). That skips `exec`'s 8 MiB output cap, and the mod deletes the file after reading it. `exec` gets `timeout: 600000`, the most Herdr allows.
- **herdr:** `exec`, `readTextFile`, `writeTextFile` (with `expected`), `watchFolder`, `notify`, `appHome`, `shared`/`setShared` (`pg.server`), `run` (`tab.select`, `tab.new`), `spaces`, `theme`, `settings`, `props`.
- **gpui-base:** `EditorState`/`Editor` (SQL, soft wrap), `InputState`/`Input`, `v_virtual_list` with `Scrollbar` (the result table), and `Popup` (the row menu, anchored `top_right`).
- **File shape (version 1):** `{ version, server, database, lastOpened, folders: [{id, name, parent, open}], notebooks: [{id, name, folder, created, updated, queries: [{id, title, sql, view, measure}]}] }`. `view` is null, "table", "chart" or "summary". `measure` is a column name or null.
- **Art:** `icons/*.svg` (24 viewBox, stroke 2, round caps, `currentColor`). `fonts/` holds Source Serif 4 Regular and Semibold (SIL OFL, `fonts/OFL.md`).

## Watch out

- Every change is a step from one document to the next, kept until a write lands. `writeTextFile` refuses a stale write. Then read the file again, replay the unsaved steps on top of it, and write once more. A step that no longer applies (its item is gone) must return the document unchanged.
- The SQL block being typed in must not take SQL from another tab's write. Every other block does.
- The mod's script engine ignores `localeCompare` options and compares by code point. Sort on `toLowerCase()`. A Node test will not catch this.
- The engine is far slower than Node at character loops and regexes. Parse CSV with `indexOf`, not character by character. Base the column guesses (ids, code, prose, labels) on the first 2,000 rows, and count filled and distinct values over all rows. Work out widths, chart data and summaries once per result. `Math.min(...values)` overflows on a few hundred thousand values, so use a loop.
- `"transparent"` is not a color. Use `"#00000000"`.
- `cx.notify()` throws during `render`, and `EditorState.new`/`InputState.new` only work in `init`, handlers or spawned tasks.
- The root takes focus on mouse down, so text fields and SQL blocks stop the mouse down from reaching it.
- Menu rows act on `on_mouse_down`, not `on_click`.
- Text wraps only when every flex parent has `min_w(0)`.
- The SQL block's height counts wrapped lines: about 8.2px per character at 13.5px mono, and 24px per line, measured with `on_size_change`.
- psql gives booleans as `t`/`f` and nulls as `<<NULL>>`. Values over 600 characters are cut.
- Fonts in `fonts/` load when Herdr starts or the look changes (theme or zoom).
- `herdr-app check` renders once with no notebook loaded. Look at the real thing with `herdr-app shot`.
- Writing notebooks under `mods/` would reload the mod on every save. Keep them in `pg-notebooks/`.

## Done when

1. `node --test` passes in `mods/pg/`, and `herdr-app check mods/pg` passes.
2. On any database: make two folders, one inside the other; make three notebooks; rename one; move one into the inner folder; duplicate one; delete the outer folder and see its contents move up; delete a notebook after the inline question.
3. After quitting and restarting Herdr, the folders, notebooks, queries, chosen views and measures are all there, and the tab opens on the last notebook.
4. Two tabs on the same database: a rename in one shows in the other within two seconds.
5. Each of the six chart types appears for a query of that shape. A failing query shows its error. An empty result shows "No rows."
6. A query returning 60,000 rows (about 14 MB) shows all of them in under a few seconds and scrolls. A query that runs for 12 seconds finishes.
7. Changing the server in the explorer switches to that server's notebooks.
