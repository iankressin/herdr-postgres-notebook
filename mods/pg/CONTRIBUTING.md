# Contributing

## Making a change

1. Locate the behavior's owner using [the architecture guide](docs/architecture.md).
2. Add or update a behavior test in the matching `tests/` directory. Keep domain rules executable without the desktop host.
3. Change the owning module and its direct callers. Use explicit relative imports with `.js` extensions.
4. Run `npm run check`. For a native UI or runtime change, also run `npm run check:host` and exercise the affected behavior in Herdr.

Use two-space indentation, double quotes, semicolons, and the existing naming style. `.editorconfig` supplies shared whitespace rules. Keep comments for constraints and decisions that are not evident from the code.

## Dependencies and runtime

Herdr executes ES modules directly. Node APIs belong in tests and scripts; application code uses the host adapters. Do not install npm packages named after host modules or add a bundler to resolve them.

Pass process, filesystem, editor, and notification dependencies to code that coordinates those operations. Tests should exercise observable behavior across those interfaces, including failures and concurrent operations.

Preserve the saved notebook format and asset locations unless a change explicitly includes a migration. Query execution code must keep cleanup and stale-completion handling together.

## Validation

`npm run check` checks the entire runtime import graph and runs the test suite. The GitHub Actions workflow runs those checks on Node 22 and 24. Coverage is available separately with `npm run test:coverage`; assertions about behavior matter more than a percentage.

The native check only verifies the initial render. For changes affecting loaded notebooks, exercise opening a notebook, running and rerunning queries, changing result views, saving edits, and closing the tab. Report any inability to run the host check separately from automated results.

Herdr generates `gpui-kit.d.ts` files. Leave them to the host; the root `jsconfig.json` includes one declaration file for editor support. Tests and scripts use Node and are intentionally outside that editor configuration.

## References

The repository's [feature reference](https://github.com/iankressin/herdr-postgres-notebook/blob/main/RECIPE.md) predates this layout. Treat its paths and embedded source listings as historical references. Current locations and responsibilities are documented in `docs/architecture.md`.
