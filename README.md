# Postgres Notebook for Herdr

A Postgres browser mod for the [Herdr app](https://herdr.dev). Keep notebooks of SQL queries for each database, sort them into folders, and see each result as a table, a chart or a summary of its columns.

![Postgres Notebook](preview.png)

## What it does to your machine

- It runs `psql` on your machine for every query. Sessions are read-only (`default_transaction_read_only=on`), and each statement stops after 10 seconds. It never asks for a password: put one in `~/.pgpass`.
- It saves notebooks to `~/.config/herdr-app/pg-notebooks/<server>/<database>.json`. It saves no query results.
- It reaches nothing on the network except the Postgres server you name.

## Install

1. Install the PostgreSQL client (`psql`).
2. Copy `mods/pg/` into `~/.config/herdr-app/mods/`. If you already have a mod called `pg`, rename the folder, and rename the `mods/pg/` paths inside it to match.
3. Restart Herdr once, so it loads the serif font in `mods/pg/fonts/`.
4. Open a tab: `herdr-app do tab.new --mod pg --name "pg: mydb" --props '{"database":"mydb"}'`. Click the server line at the top left to set `user@host:port`.

`RECIPE.md` describes the mod in full, for anyone who wants to build it again from scratch.

## Tests

```sh
cd mods/pg && node --test
```

The font, Source Serif 4, is © Adobe and licensed under the SIL Open Font License (`mods/pg/fonts/OFL.md`).
