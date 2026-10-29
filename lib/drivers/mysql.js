/**
 * MySQL / MariaDB driver adapter.
 *
 * The plugin never imports mysql2 at module load: a driver that is not
 * installed must degrade into an actionable per-connection error instead of
 * failing the whole dsh host boot. `loadMysql` caches the successful import.
 */

import { normalizeRows, normalizeValue } from '../values.js'

/** Cached dynamic import. */
let mysqlModule

/** Load mysql2/promise with an actionable failure message. */
export async function loadMysql() {
  if (mysqlModule !== undefined) return mysqlModule
  try {
    const mod = await import('mysql2/promise')
    mysqlModule = mod.createPool !== undefined ? mod : mod.default
    return mysqlModule
  } catch (error) {
    throw new Error(
      'mysql2 驱动未安装：请在插件目录执行 `npm install mysql2`（或通过 dsh plugin 安装时自动安装依赖）。原始错误：'
      + (error instanceof Error ? error.message : String(error)),
    )
  }
}

/** Map MySQL column type codes onto readable names. */
const MYSQL_TYPES = {
  0: 'DECIMAL', 1: 'TINYINT', 2: 'SMALLINT', 3: 'INT', 4: 'FLOAT', 5: 'DOUBLE',
  6: 'NULL', 7: 'TIMESTAMP', 8: 'BIGINT', 9: 'MEDIUMINT', 10: 'DATE', 11: 'TIME',
  12: 'DATETIME', 13: 'YEAR', 14: 'NEWDATE', 15: 'VARCHAR', 16: 'BIT',
  245: 'JSON', 246: 'DECIMAL', 247: 'ENUM', 248: 'SET', 249: 'TINYBLOB',
  250: 'MEDIUMBLOB', 251: 'LONGBLOB', 252: 'BLOB', 253: 'VAR_STRING',
  254: 'STRING', 255: 'GEOMETRY',
}

/** Build the mysql2 TLS option for one store value. */
function sslOption(mode) {
  if (mode === 'disable' || mode === undefined) return undefined
  // 'require' encrypts without verifying the server certificate (the common
  // cloud-provider default); 'verify' validates against the platform CA store.
  return mode === 'verify' ? { rejectUnauthorized: true } : { rejectUnauthorized: false }
}

/**
 * Create a pool for one (connection, database) pair.
 * @param {any} connection - stored connection entry.
 * @param {string|undefined} database - selected database, when any.
 * @param {{timeoutMs?:number}} [options] - pool options.
 * @returns {Promise<any>} mysql2 pool.
 */
export async function createPool(connection, database, options = {}) {
  const mysql = await loadMysql()
  return mysql.createPool({
    host: connection.host,
    port: connection.port,
    user: connection.user,
    password: connection.password ?? '',
    ...(database !== undefined && database !== '' ? { database } : {}),
    ssl: sslOption(connection.ssl),
    connectionLimit: 4,
    maxIdle: 4,
    idleTimeout: 30 * 60 * 1000,
    waitForConnections: true,
    queueLimit: 0,
    charset: 'utf8mb4',
    timezone: 'local',
    connectTimeout: 10_000,
    enableKeepAlive: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
    decimalNumbers: false,
    multipleStatements: false,
    dateStrings: false,
    ...(options.timeoutMs !== undefined ? { connectTimeout: Math.min(options.timeoutMs, 10_000) } : {}),
  })
}

/** End one pool. */
export async function closePool(pool) {
  try {
    await pool.end()
  } catch { /* already closed */ }
}

/** Cap on metadata queries: a stale pooled socket must not hang the GUI. */
const METADATA_TIMEOUT_MS = 15_000

/**
 * Run one metadata query with mysql2's own timeout. On expiry mysql2 destroys
 * the connection — exactly what a half-open socket after a server-side idle
 * timeout needs — and the pool builds a fresh one for the next attempt.
 * @param {any} pool - mysql2 pool.
 * @param {string} sql - parameterized SQL.
 * @param {any[]} [params] - placeholder values.
 */
function timedQuery(pool, sql, params) {
  const options = { sql, timeout: METADATA_TIMEOUT_MS }
  return params === undefined ? pool.query(options) : pool.query(options, params)
}

/** Test one pool and report the server version. */
export async function testPool(pool) {
  const started = Date.now()
  const [rows] = await timedQuery(pool, 'SELECT VERSION() AS version')
  const version = Array.isArray(rows) && rows[0] !== undefined ? String(rows[0].version ?? '') : ''
  return { ok: true, version, latencyMs: Date.now() - started }
}

/**
 * List databases (information_schema is available on every connection).
 * @param {any} pool - mysql2 pool.
 * @param {string|undefined} search - optional name filter.
 */
export async function listDatabases(pool, search) {
  const like = search === undefined || search === '' ? undefined : `%${search}%`
  const sql = `SELECT SCHEMA_NAME AS name, DEFAULT_CHARACTER_SET_NAME AS charset
               FROM information_schema.SCHEMATA
               ${like === undefined ? '' : 'WHERE SCHEMA_NAME LIKE ?'}
               ORDER BY SCHEMA_NAME`
  const [rows] = like === undefined ? await timedQuery(pool, sql) : await timedQuery(pool, sql, [like])
  const system = new Set(['information_schema', 'performance_schema', 'mysql', 'sys'])
  return rows.map(row => ({
    name: String(row.name),
    charset: row.charset === null ? undefined : String(row.charset),
    system: system.has(String(row.name)),
  }))
}

/**
 * List tables and views of one database.
 * @param {any} pool - mysql2 pool.
 * @param {string} database - database name.
 * @param {string|undefined} search - optional table-name filter.
 */
export async function listTables(pool, database, search) {
  const like = search === undefined || search === '' ? undefined : `%${search}%`
  const params = [database]
  let filter = ''
  if (like !== undefined) {
    filter = 'AND TABLE_NAME LIKE ?'
    params.push(like)
  }
  const [rows] = await timedQuery(
    pool,
    `SELECT TABLE_NAME AS name, TABLE_TYPE AS kind, TABLE_ROWS AS rowCount,
            TABLE_COMMENT AS comment, ENGINE AS engine
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = ? ${filter}
     ORDER BY TABLE_NAME`,
    params,
  )
  return rows.map(row => ({
    name: String(row.name),
    type: String(row.kind).toUpperCase().includes('VIEW') ? 'view' : 'table',
    ...(row.rowCount === null || row.rowCount === undefined ? {} : { rowCount: Number(row.rowCount) }),
    ...(row.engine === null || row.engine === undefined ? {} : { engine: String(row.engine) }),
    ...(row.comment === null || row.comment === '' ? {} : { comment: String(row.comment) }),
  }))
}

/**
 * List columns of one table.
 * @param {any} pool - mysql2 pool.
 * @param {string} database - database name.
 * @param {string} table - table name.
 */
export async function listColumns(pool, database, table) {
  const [rows] = await timedQuery(
    pool,
    `SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type, IS_NULLABLE AS nullable,
            COLUMN_KEY AS columnKey, COLUMN_DEFAULT AS defaultValue, EXTRA AS extra,
            COLUMN_COMMENT AS comment, ORDINAL_POSITION AS position,
            CHARACTER_MAXIMUM_LENGTH AS charLength, NUMERIC_PRECISION AS numPrecision
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
     ORDER BY ORDINAL_POSITION`,
    [database, table],
  )
  return rows.map(row => ({
    name: String(row.name),
    type: String(row.type),
    nullable: String(row.nullable).toUpperCase() === 'YES',
    primaryKey: String(row.columnKey) === 'PRI',
    ...(row.defaultValue === null || row.defaultValue === undefined ? {} : { defaultValue: normalizeValue(row.defaultValue) }),
    ...(row.extra === null || row.extra === '' ? {} : { extra: String(row.extra) }),
    ...(row.comment === null || row.comment === '' ? {} : { comment: String(row.comment) }),
    position: Number(row.position),
  }))
}

/**
 * List every table and its columns for one database in one query, shaped for
 * the editor's autocomplete (a compact table -> columns catalog).
 * @param {any} pool - mysql2 pool.
 * @param {string} database - database name.
 */
export async function listCatalog(pool, database) {
  const [rows] = await timedQuery(
    pool,
    `SELECT TABLE_NAME AS tableName, COLUMN_NAME AS name, COLUMN_TYPE AS type,
            COLUMN_KEY AS columnKey
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ?
     ORDER BY TABLE_NAME, ORDINAL_POSITION
     LIMIT 50000`,
    [database],
  )
  const tables = new Map()
  for (const row of rows) {
    const table = String(row.tableName)
    let entry = tables.get(table)
    if (entry === undefined) {
      entry = { name: table, columns: [] }
      tables.set(table, entry)
    }
    entry.columns.push({
      name: String(row.name),
      type: String(row.type),
      primaryKey: String(row.columnKey) === 'PRI',
    })
  }
  return [...tables.values()].slice(0, 2000)
}

/**
 * Search table/view names across every database on the connection, or only
 * one database when `database` is given.
 * @param {any} pool - mysql2 pool.
 * @param {string} query - substring to match (LIKE, case-insensitive under the collation).
 * @param {string|undefined} [database] - scope to one database.
 */
export async function searchTables(pool, query, database) {
  const params = [`%${query}%`]
  let scope = ''
  if (database !== undefined && database !== '') {
    scope = 'AND TABLE_SCHEMA = ?'
    params.push(database)
  }
  const [rows] = await timedQuery(
    pool,
    `SELECT TABLE_SCHEMA AS db, TABLE_NAME AS name, TABLE_TYPE AS kind
     FROM information_schema.TABLES
     WHERE TABLE_NAME LIKE ? ${scope}
     ORDER BY TABLE_SCHEMA, TABLE_NAME
     LIMIT 200`,
    params,
  )
  return rows.map(row => ({
    database: String(row.db),
    name: String(row.name),
    type: String(row.kind).toUpperCase().includes('VIEW') ? 'view' : 'table',
  }))
}

/** Map one mysql2 field onto the shared column shape. */
function mapField(field) {
  return {
    name: String(field.name ?? ''),
    dataType: MYSQL_TYPES[field.type] ?? (field.type !== undefined ? `type:${field.type}` : 'unknown'),
  }
}

/**
 * Execute one SQL statement.
 * @param {any} pool - mysql2 pool.
 * @param {{sql:string, readOnly:boolean, maxRows:number, timeoutMs:number}} options - query options.
 */
export async function runQuery(pool, options) {
  const started = Date.now()
  const connection = await pool.getConnection()
  let inTransaction = false
  try {
    if (options.readOnly) {
      await connection.query({ sql: 'START TRANSACTION READ ONLY', timeout: METADATA_TIMEOUT_MS })
      inTransaction = true
    }
    const [rows, fields] = await connection.query({
      sql: options.sql,
      rowsAsArray: true,
      timeout: options.timeoutMs,
    })
    // Multiple result sets (CALL): `fields` is an array of field arrays.
    if (Array.isArray(fields) && fields.length > 0 && Array.isArray(fields[0])) {
      for (let index = rows.length - 1; index >= 0; index -= 1) {
        if (Array.isArray(rows[index]) && Array.isArray(fields[index]) && fields[index].length > 0) {
          return buildResult(rows[index], fields[index], options, started)
        }
      }
      return {
        columns: [],
        rows: [],
        rowCount: 0,
        durationMs: Date.now() - started,
        command: 'CALL',
      }
    }
    if (Array.isArray(rows)) {
      return buildResult(rows, Array.isArray(fields) ? fields : [], options, started)
    }
    return {
      columns: [],
      rows: [],
      rowCount: 0,
      durationMs: Date.now() - started,
      command: 'OK',
      affectedRows: typeof rows.affectedRows === 'number' ? rows.affectedRows : 0,
      ...(rows.insertId !== undefined && Number(rows.insertId) !== 0 ? { insertId: String(rows.insertId) } : {}),
      ...(rows.info !== undefined && rows.info !== '' ? { info: String(rows.info) } : {}),
    }
  } finally {
    if (inTransaction) {
      try { await connection.query({ sql: 'ROLLBACK', timeout: 5_000 }) } catch { /* connection lost */ }
    }
    // A read-write statement may have changed session state (USE, SET,
    // temporary tables, user variables). Never hand such a connection to the
    // next pooled query: destroy it instead. Read-only statements roll back
    // and go back to the pool.
    if (options.readOnly) {
      try { connection.release() } catch { /* destroyed by a timeout */ }
    } else {
      try { connection.destroy() } catch { /* already gone */ }
    }
  }
}

/** Build the shared result shape from one result set. */
function buildResult(rows, fields, options, started) {
  const total = rows.length
  const sliced = total > options.maxRows ? rows.slice(0, options.maxRows) : rows
  return {
    columns: fields.map(mapField),
    rows: normalizeRows(sliced),
    rowCount: sliced.length,
    durationMs: Date.now() - started,
    command: 'SELECT',
    ...(total > options.maxRows ? { truncated: true, totalRows: total } : {}),
  }
}
