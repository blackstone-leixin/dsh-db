/**
 * PostgreSQL driver adapter, mirroring the MySQL adapter's contract.
 *
 * pg is imported lazily for the same reason as mysql2: a missing driver must
 * fail one connection operation with a clear message, not the host boot.
 */

import { normalizeRows } from '../values.js'
import { quoteIdent } from '../values.js'

/** Cached dynamic import. */
let pgModule

/** Load pg with an actionable failure message. */
export async function loadPg() {
  if (pgModule !== undefined) return pgModule
  try {
    const mod = await import('pg')
    pgModule = mod.Pool !== undefined ? mod : mod.default
    return pgModule
  } catch (error) {
    throw new Error(
      'pg 驱动未安装：请在插件目录执行 `npm install pg`（或通过 dsh plugin 安装时自动安装依赖）。原始错误：'
      + (error instanceof Error ? error.message : String(error)),
    )
  }
}

/** Map common PostgreSQL type OIDs onto readable names. */
const PG_TYPES = {
  16: 'bool', 17: 'bytea', 18: 'char', 19: 'name', 20: 'int8', 21: 'int2',
  23: 'int4', 24: 'regproc', 25: 'text', 26: 'oid', 114: 'json', 142: 'xml',
  700: 'float4', 701: 'float8', 790: 'money', 829: 'macaddr', 869: 'inet',
  650: 'cidr', 1042: 'bpchar', 1043: 'varchar', 1082: 'date', 1083: 'time',
  1114: 'timestamp', 1184: 'timestamptz', 1186: 'interval', 1266: 'timetz',
  1560: 'bit', 1562: 'varbit', 1700: 'numeric', 2950: 'uuid', 3802: 'jsonb',
  1000: 'bool[]', 1005: 'int2[]', 1007: 'int4[]', 1009: 'text[]',
  1015: 'varchar[]', 1016: 'int8[]', 1021: 'float4[]', 1022: 'float8[]',
  1231: 'numeric[]', 1182: 'date[]', 1115: 'timestamp[]', 1185: 'timestamptz[]',
  199: 'json[]', 3807: 'jsonb[]',
}

/** Build the pg TLS option for one store value. */
function sslOption(mode) {
  if (mode === 'disable' || mode === undefined) return false
  return mode === 'verify' ? { rejectUnauthorized: true } : { rejectUnauthorized: false }
}

/**
 * Create a pool for one (connection, database) pair.
 * @param {any} connection - stored connection entry.
 * @param {string|undefined} database - target database.
 * @param {{timeoutMs?:number}} [options] - pool options.
 * @returns {Promise<any>} pg Pool.
 */
export async function createPool(connection, database, options = {}) {
  const pg = await loadPg()
  return new pg.Pool({
    host: connection.host,
    port: connection.port,
    user: connection.user,
    password: connection.password ?? '',
    ...(database !== undefined && database !== '' ? { database } : {}),
    ssl: sslOption(connection.ssl),
    max: 4,
    idleTimeoutMillis: 30 * 60 * 1000,
    connectionTimeoutMillis: 10_000,
    application_name: 'dsh-db',
    ...(options.timeoutMs !== undefined ? { statement_timeout: options.timeoutMs, query_timeout: options.timeoutMs } : {}),
  })
}

/** End one pool. */
export async function closePool(pool) {
  try {
    await pool.end()
  } catch { /* already closed */ }
}

/** Test one pool and report the server version. */
export async function testPool(pool) {
  const started = Date.now()
  const result = await pool.query('SELECT version() AS version')
  const version = result.rows[0] !== undefined ? String(result.rows[0].version ?? '') : ''
  return { ok: true, version, latencyMs: Date.now() - started }
}

/**
 * List non-system schemas.
 * @param {any} pool - pg pool.
 * @param {string|undefined} search - optional name filter.
 */
export async function listSchemas(pool, search) {
  const params = []
  let filter = ''
  if (search !== undefined && search !== '') {
    filter = 'AND nspname ILIKE $1'
    params.push(`%${search}%`)
  }
  const result = await pool.query(
    `SELECT nspname AS name
     FROM pg_namespace
     WHERE nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
       AND nspname NOT LIKE 'pg_temp_%'
       AND nspname NOT LIKE 'pg_toast_temp_%'
       ${filter}
     ORDER BY nspname`,
    params,
  )
  return result.rows.map(row => ({ name: String(row.name) }))
}

/**
 * List tables, views and materialized views of one schema.
 * @param {any} pool - pg pool.
 * @param {string} schema - schema name.
 * @param {string|undefined} search - optional table-name filter.
 */
export async function listTables(pool, schema, search) {
  const params = [schema]
  let filter = ''
  if (search !== undefined && search !== '') {
    filter = 'AND c.relname ILIKE $2'
    params.push(`%${search}%`)
  }
  const result = await pool.query(
    `SELECT c.relname AS name,
            CASE c.relkind
              WHEN 'r' THEN 'table'
              WHEN 'p' THEN 'partitioned table'
              WHEN 'v' THEN 'view'
              WHEN 'm' THEN 'materialized view'
              WHEN 'f' THEN 'foreign table'
              ELSE 'table'
            END AS type,
            c.reltuples::bigint AS "rowCount",
            obj_description(c.oid, 'pg_class') AS comment
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = $1
       AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
       ${filter}
     ORDER BY c.relname`,
    params,
  )
  return result.rows.map(row => {
    const rowCount = Number(row.rowCount)
    return {
      name: String(row.name),
      type: String(row.type),
      ...(Number.isFinite(rowCount) && rowCount >= 0 ? { rowCount } : {}),
      ...(row.comment === null || row.comment === '' ? {} : { comment: String(row.comment) }),
    }
  })
}

/**
 * List columns of one table, including primary-key membership.
 * @param {any} pool - pg pool.
 * @param {string} schema - schema name.
 * @param {string} table - table name.
 */
export async function listColumns(pool, schema, table) {
  const regclass = quoteIdent('postgres', schema) + '.' + quoteIdent('postgres', table)
  const result = await pool.query(
    `SELECT a.attname AS name,
            format_type(a.atttypid, a.atttypmod) AS type,
            NOT a.attnotnull AS nullable,
            pg_get_expr(d.adbin, d.adrelid) AS "defaultValue",
            col_description(a.attrelid, a.attnum) AS comment,
            a.attnum AS position,
            EXISTS (
              SELECT 1 FROM pg_index i
              WHERE i.indrelid = a.attrelid
                AND i.indisprimary
                AND a.attnum = ANY (i.indkey)
            ) AS "primaryKey"
     FROM pg_attribute a
     LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
     WHERE a.attrelid = $1::regclass
       AND a.attnum > 0
       AND NOT a.attisdropped
     ORDER BY a.attnum`,
    [regclass],
  )
  return result.rows.map(row => ({
    name: String(row.name),
    type: String(row.type),
    nullable: row.nullable === true,
    primaryKey: row.primaryKey === true,
    ...(row.defaultValue === null || row.defaultValue === undefined ? {} : { defaultValue: String(row.defaultValue) }),
    ...(row.comment === null || row.comment === '' ? {} : { comment: String(row.comment) }),
    position: Number(row.position),
  }))
}

/**
 * List every table and its columns for one schema in one query, shaped for
 * the editor's autocomplete.
 * @param {any} pool - pg pool.
 * @param {string} schema - schema name.
 */
export async function listCatalog(pool, schema) {
  const result = await pool.query(
    `SELECT c.relname AS "tableName",
            a.attname AS name,
            format_type(a.atttypid, a.atttypmod) AS type,
            EXISTS (
              SELECT 1 FROM pg_index i
              WHERE i.indrelid = a.attrelid
                AND i.indisprimary
                AND a.attnum = ANY (i.indkey)
            ) AS "primaryKey"
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
     WHERE n.nspname = $1
       AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
     ORDER BY c.relname, a.attnum
     LIMIT 50000`,
    [schema],
  )
  const tables = new Map()
  for (const row of result.rows) {
    const table = String(row.tableName)
    let entry = tables.get(table)
    if (entry === undefined) {
      entry = { name: table, columns: [] }
      tables.set(table, entry)
    }
    entry.columns.push({
      name: String(row.name),
      type: String(row.type),
      primaryKey: row.primaryKey === true,
    })
  }
  return [...tables.values()].slice(0, 2000)
}

/**
 * Search table/view names across every non-system schema, or only one schema
 * when `schema` is given.
 * @param {any} pool - pg pool.
 * @param {string} query - case-insensitive substring.
 * @param {string|undefined} [schema] - scope to one schema.
 */
export async function searchTables(pool, query, schema) {
  const params = [`%${query}%`]
  let scope = ''
  if (schema !== undefined && schema !== '') {
    scope = 'AND n.nspname = $2'
    params.push(schema)
  }
  const result = await pool.query(
    `SELECT n.nspname AS schema,
            c.relname AS name,
            CASE c.relkind
              WHEN 'v' THEN 'view'
              WHEN 'm' THEN 'materialized view'
              ELSE 'table'
            END AS type
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
       AND n.nspname NOT LIKE 'pg_temp_%'
       AND n.nspname NOT LIKE 'pg_toast_temp_%'
       AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
       AND c.relname ILIKE $1
       ${scope}
     ORDER BY n.nspname, c.relname
     LIMIT 200`,
    params,
  )
  return result.rows.map(row => ({
    schema: String(row.schema),
    name: String(row.name),
    type: String(row.type),
  }))
}

/** Map one pg FieldDef onto the shared column shape. */
function mapField(field) {
  return {
    name: String(field.name ?? ''),
    dataType: PG_TYPES[field.dataTypeID] ?? `oid:${field.dataTypeID}`,
  }
}

/**
 * Execute SQL on one PostgreSQL connection.
 * @param {any} pool - pg pool.
 * @param {{sql:string, readOnly:boolean, maxRows:number, timeoutMs:number, schema?:string}} options - query options.
 */
export async function runQuery(pool, options) {
  const started = Date.now()
  const client = await pool.connect()
  let broken = false
  let inTransaction = false
  try {
    if (options.readOnly) {
      await client.query('BEGIN TRANSACTION READ ONLY')
      inTransaction = true
      await client.query(`SET LOCAL statement_timeout = ${Math.max(1, Math.floor(options.timeoutMs))}`)
      if (options.schema !== undefined && options.schema !== '') {
        await client.query(`SET LOCAL search_path TO ${quoteIdent('postgres', options.schema)}`)
      }
    } else {
      await client.query(`SET statement_timeout = ${Math.max(1, Math.floor(options.timeoutMs))}`)
      if (options.schema !== undefined && options.schema !== '') {
        await client.query(`SET search_path TO ${quoteIdent('postgres', options.schema)}`)
      }
    }
    const raw = await client.query({ text: options.sql, rowMode: 'array' })
    const results = Array.isArray(raw) ? raw : [raw]
    const result = results[results.length - 1]
    const fields = Array.isArray(result.fields) ? result.fields : []
    const rows = Array.isArray(result.rows) ? result.rows : []
    const total = rows.length
    const sliced = total > options.maxRows ? rows.slice(0, options.maxRows) : rows
    return {
      columns: fields.map(mapField),
      rows: normalizeRows(sliced),
      rowCount: sliced.length,
      durationMs: Date.now() - started,
      command: String(result.command ?? 'SELECT'),
      ...(fields.length === 0 && typeof result.rowCount === 'number' ? { affectedRows: result.rowCount } : {}),
      ...(total > options.maxRows ? { truncated: true, totalRows: total } : {}),
      ...(results.length > 1 ? { warning: `${results.length} 条语句按顺序执行，仅展示最后一条的结果` } : {}),
    }
  } catch (error) {
    broken = true
    throw error
  } finally {
    if (inTransaction) {
      // SET LOCAL values revert on rollback, so the client can be reused.
      try { await client.query('ROLLBACK') } catch { broken = true }
      client.release(broken)
    } else {
      // A read-write statement may have changed session state (SET, search_path,
      // temporary tables). Destroy the client instead of pooling that state.
      client.release(true)
    }
  }
}
