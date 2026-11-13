# Postgres Notebook

A native Herdr mod for browsing PostgreSQL databases, organizing SQL notebooks, and displaying results as tables, charts, or summaries.

## Development

Use Node.js 22 or newer for development (`.node-version` selects 24). Herdr supplies the runtime modules; PostgreSQL's `psql` client executes queries. There are no npm dependencies and no build step.

```sh
npm ci
npm run check
```

| Command | Purpose |
| --- | --- |
| `npm test` | Run behavior and integration tests |
| `npm run test:watch` | Rerun tests while editing |
| `npm run test:coverage` | Report Node test coverage |
| `npm run check:modules` | Check syntax, imports, exports, dependency direction, and cycles |
| `npm run check` | Run module checks and all tests; also used in CI |
| `npm run check:host` | Load the native mod in Herdr, with a 40-second timeout |

The module checker uses Node's experimental VM module API for linking. It does not execute application code. It is a structural check, not a type checker or a replacement for testing the native UI.

## Project layout

```text
main.js                 Herdr entry point
mod.json                Herdr mod metadata
src/
  app/                  View coordination and query/editor lifecycle
  postgres/             Connection rules, CSV, catalog queries, execution
  notebooks/            Notebook documents and conflict-aware persistence
  results/              Reading, profiling, formatting, summaries, files
  charts/               Chart selection, preparation, aggregation, scales
  ai/                   Assistant requests and job lifecycle
  runtime/              Host adapters and view-owned task dispatch
  ui/                   Native rendering and editor construction
tests/                  Tests grouped by subject
scripts/                Development checks
docs/                   Architecture documentation
icons/                  Native UI assets
fonts/                  Bundled fonts and their licenses
```

Keep this project installed as Herdr's `pg` mod to run it. Herdr loads the root `main.js` directly and reloads source changes. Running `main.js` with Node will not launch the application: `herdr`, `gpui-kit`, and `gpui-base` are supplied by the desktop host.

Notebook data is stored separately from the source tree. This reorganization requires no saved-data migration.

See [architecture](docs/architecture.md) for module responsibilities and [contributing](CONTRIBUTING.md) for the change workflow. The repository's [feature reference](https://github.com/iankressin/herdr-postgres-notebook/blob/main/RECIPE.md) describes existing behavior.
