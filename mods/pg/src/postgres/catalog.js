import { parseRows } from "./csv.js";
import { quoteIdent, quoteLiteral } from "./connection.js";

export const LIST_DATABASES_SQL = "select datname from pg_database where datallowconn and not datistemplate order by datname";

export const parseDatabases = (text) => parseRows(text).rows.map(([name]) => name);

export const LIST_TABLES_SQL = `select n.nspname as schema, c.relname as name, c.relkind as kind
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('r', 'p', 'v', 'm', 'f')
  and n.nspname not in ('pg_catalog', 'information_schema')
  and n.nspname not like 'pg_toast%' and n.nspname not like 'pg_temp%'
order by 1, 2`;

export const parseTables = (text) => parseRows(text).rows.map(([schema, name, kind]) => ({ schema, name, kind }));

export function filterTables(tables, query) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return tables.filter((t) => {
    const text = `${t.schema}.${t.name}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });
}

export function groupBySchema(tables) {
  const groups = new Map();
  for (const table of tables) {
    if (!groups.has(table.schema)) groups.set(table.schema, []);
    groups.get(table.schema).push(table);
  }
  return [...groups].map(([schema, list]) => ({ schema, tables: list }));
}

// Starters that read Postgres's own catalog, so they mean something on any database.
export const TABLES_BY_SIZE = `select n.nspname as schema, c.relname as table, greatest(c.reltuples, 0)::bigint as rows,
  pg_total_relation_size(c.oid) as bytes
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('r', 'p', 'm')
  and n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg_toast%'
order by bytes desc`;

export const SETTINGS_BY_CATEGORY = `select category, count(*) as settings
from pg_settings
group by category
order by settings desc`;

// Size on disk and the planner's row estimate of every table, for the explorer.
export const STATS_SQL = `select n.nspname, c.relname, pg_total_relation_size(c.oid), greatest(c.reltuples, 0)::bigint
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('r', 'p', 'm') and n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg_toast%'`;

export const parseStats = (text) => new Map(parseRows(text).rows.map(([schema, table, bytes, estimate]) => [`${schema}.${table}`, { bytes: Number(bytes), estimate: Number(estimate) }]));

export function columnsSql(schema, table) {
  const name = quoteLiteral(`${quoteIdent(schema)}.${quoteIdent(table)}`);
  return `select a.attname as name, format_type(a.atttypid, a.atttypmod) as type,
  case when a.attnotnull then 'no' else 'yes' end as nullable,
  pg_get_expr(d.adbin, d.adrelid) as "default",
  array_position(i.indkey::int2[], a.attnum) as pk
from pg_attribute a
left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
left join pg_index i on i.indrelid = a.attrelid and i.indisprimary
where a.attrelid = to_regclass(${name}) and a.attnum > 0 and not a.attisdropped
order by a.attnum`;
}

export function parseColumns(text) {
  return parseRows(text).rows.map(([name, type, nullable, def, pk]) => ({
    name,
    type,
    nullable: nullable === "yes",
    default: def,
    pk: pk === null ? null : Number(pk),
  }));
}
