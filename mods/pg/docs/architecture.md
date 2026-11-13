# Architecture

The root `main.js` exports `Pg` from `src/app/pg-view.js`. Herdr constructs that view for a notebook tab or the database sidebar. The view composes the application; it does not implement SQL execution, CSV reading, chart algorithms, or filesystem persistence.

## Responsibilities

Paths below are relative to `src/`.

| Module | Owns |
| --- | --- |
| `app/pg-view.js` | Selected server/database/notebook, input actions, saved-document synchronization, view composition |
| `app/query-session.js` | Query editors, execution state, stale results, shared result-memory accounting, cleanup |
| `postgres/connection.js` | Server parsing, SQL quoting, connection strings, psql arguments |
| `postgres/catalog.js` | Catalog SQL, parsing, table filtering |
| `postgres/client.js` | Catalog execution and query output-file ownership on process failure |
| `postgres/csv.js`, `postgres/errors.js` | CSV parsing and error classification |
| `notebooks/document.js` | Document validation and immutable notebook/folder/query changes |
| `notebooks/file.js` | Serialized storage operations, pending changes, conflict replay, recovery |
| `results/` | Bounded reading, column profiles, formatting, summaries, result files, memoization |
| `charts/roles.js`, `charts/plan.js` | Eligible axes/series and chart selection |
| `charts/prepare.js`, `charts/data.js`, `charts/scale.js` | Reusable preparation, aggregation, axis bounds |
| `ai/protocol.js`, `ai/assistant.js` | Agent request/response format and job coordination |
| `runtime/services.js` | Process and storage adapter construction |
| `runtime/view-worker.js` | Asynchronous dispatch in the owning view's context |
| `ui/` | Native elements, rendering helpers, navigation, editor construction |

## Dependency rules

Domain modules import domain modules. They do not import rendering or host adapters. Charts depend on result descriptions; result formatting and reading may use PostgreSQL quoting and CSV rules. Notebook documents may use catalog queries for the default notebook.

UI modules read application state and call explicit actions. The application composes UI and runtime adapters. The adapters supply process and filesystem operations through constructor arguments. The assistant's host integration stays in `ai/assistant.js`; its request format stays independently testable.

`scripts/check-modules.js` enforces allowed directory dependencies, restricts direct host imports, rejects cycles and unreachable source files, and links the full entry-point graph to catch missing named exports. Runtime source never imports development scripts or tests.

## Interfaces that matter

`createPostgresClient({ exec, currentServer, resultFiles })` exposes `catalog(database, sql)`, `query(database, sql)`, and `listDatabases()`. A successful query transfers ownership of its CSV file to the caller. A failed execution removes its temporary file before rejecting.

`createResultFiles({ fs, exec, directory, downloads })` exposes allocation, bounded reading, saving, deletion, and cleanup. Filesystem paths and process invocation stay here rather than in rendering code.

`NotebookFile(server, database, storage)` accepts `home`, `fs`, `readTextFile`, `writeTextFile`, and `notify`. `change(step)` accepts an immutable document transformation. `save()` serializes writes and replays pending steps if the stored document changed; `reload()` merges external changes with pending local edits.

`QuerySession(view, dependencies)` owns live cells and accepts the PostgreSQL client, result files, editor factory, result preparation, and notifications. Its view collaborator supplies the current notebook/database, document changes, active query, and task dispatch. Removing or releasing a cell invalidates its execution token so a late result cannot restore it.

Chart preparation and rendering share `results/cache.js`. Keep this as a single module: duplicating it would repeat expensive work during rendering. Result parsing and preparation remain separate resumable steps.

## Compatibility

The root entry point, mod metadata, tab props, document version, and notebook storage paths retain their existing contracts. Icons and fonts remain host-loadable assets. `jsconfig.json` describes the host JavaScript environment; Node is used for development checks and tests.

| Former file | Current location |
| --- | --- |
| `main.js` | Entry point plus `app/pg-view.js`, `app/query-session.js`, and runtime adapters |
| `logic.js` | `postgres/` and `ui/navigation.js` |
| `shape.js` | `results/` and `charts/` |
| `notebooks.js`, `store.js` | `notebooks/document.js`, `notebooks/file.js` |
| `result.js` | `results/reader.js` |
| `ai.js`, `assistant.js` | `ai/protocol.js`, `ai/assistant.js` |
| `panel.js`, `ui/*.js` | `ui/` |
