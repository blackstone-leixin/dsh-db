/**
 * The database engine: pool lifecycle, schema browsing, and SQL execution
 * shared by the HTTP routes (browser half) and the agent tools.
 *
 * Pools are cached per (connection id, database) and reused across tree
 * expansions and queries. `dropConnection` is called when a connection is
 * edited or deleted so stale credentials can never be reused.
 */

import * as mysqlDriver from './drivers/mysql.js'
import * as postgresDriver from './drivers/postgres.js'
import { defaultPort, typeLabel } from './store.js'
import { assertReadOnlyStatement } from './values.js'

/** Hard caps that keep a runaway schema or result set from flooding the UI. */
export const MAX_TREE_ITEMS = 2000
export const MAX_ROWS_CAP = 5000
export const MAX_TIMEOUT_MS = 120_000

/** The driver module for one database type. */
function driverFor(type) {
  return type === 'postgres' ? postgresDriver : mysqlDriver
}

/**
 * Render a driver error into one actionable line.
 * @param {unknown} error - thrown value.
 * @returns {string} human-readable message.
 */
export function describeDbError(error) {
  if (!(error instanceof Error)) return String(error)
  const extra = /** @type {any} */ (error)
  const parts = []
  if (typeof extra.code === 'string' && extra.code !== '') parts.push(`[${extra.code}]`)
  parts.push(extra.sqlMessage ?? extra.message)
  if (typeof extra.detail === 'string' && extra.detail !== '') parts.push(`detail: ${extra.detail}`)
  if (typeof extra.hint === 'string' && extra.hint !== '') parts.push(`hint: ${extra.hint}`)
  if (typeof extra.position === 'string' && extra.position !== '') parts.push(`position: ${extra.position}`)
  return parts.join(' ')
}

/** Error codes/messages that mean "this pooled socket is gone". */
const CONNECTION_ERROR_CODES = new Set([
  'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'EHOSTUNREACH', 'ENETUNREACH',
  'PROTOCOL_CONNECTION_LOST', 'PROTOCOL_SEQUENCE_TIMEOUT', 'ER_SERVER_SHUTDOWN',
  'ER_CONNECTION_KILLED', '57P01', '08006', '08003',
])

/**
 * Whether a driver error is a dead/closed connection (usually after the
 * database's own idle timeout) that a fresh pool can recover from.
 * @param {unknown} error - thrown value.
 */
export function isConnectionError(error) {
  if (error === null || error === undefined) return false
  const extra = /** @type {any} */ (error)
  if (typeof extra.code === 'string' && CONNECTION_ERROR_CODES.has(extra.code)) return true
  const text = extra instanceof Error ? extra.message : String(extra)
  return /ECONNRESET|ETIMEDOUT|EPIPE|PROTOCOL_CONNECTION_LOST|PROTOCOL_SEQUENCE_TIMEOUT|Connection lost|Server has gone away/i.test(text)
}

/** Clamp a number into [min, max], falling back to the default. */
function clampInt(value, fallback, min, max) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(value)))
}

/** Close one pool, ignoring an already-closed one. */
async function closePoolOf(pool) {
  try {
    await pool.end()
  } catch { /* already closed */ }
}

/** Cap a tree item list and mark the truncation. */
function capItems(payload) {
  if (payload.items.length <= MAX_TREE_ITEMS) return payload
  return {
    ...payload,
    items: payload.items.slice(0, MAX_TREE_ITEMS),
    truncated: true,
    totalItems: payload.items.length,
  }
}

/** The database engine. */
export class DbEngine {
  /**
   * @param {import('./store.js').ConnectionStore} store - connection store.
   * @param {{maxRows?:number, queryTimeoutMs?:number}} [options] - defaults.
   */
  constructor(store, options = {}) {
    this.store = store
    this.defaultMaxRows = clampInt(options.maxRows, 500, 1, MAX_ROWS_CAP)
    this.defaultTimeoutMs = clampInt(options.queryTimeoutMs, 30_000, 1_000, MAX_TIMEOUT_MS)
    /** @type {Map<string, {creating:Promise<any>|undefined, pool:any|undefined, lastUsed:number}>} */
    this.pools = new Map()
    this.maxPools = 32
    this.disposed = false
  }

  /** List connection summaries, optionally filtered. */
  list(query) {
    const text = typeof query === 'string' ? query.trim().toLowerCase() : ''
    return this.store.list()
      .map(entry => this.store.summarize(entry))
      .filter(entry => text === ''
        || entry.name.toLowerCase().includes(text)
        || entry.host.toLowerCase().includes(text)
        || entry.type.includes(text)
        || (entry.database ?? '').toLowerCase().includes(text))
  }

  /**
   * Resolve a connection reference (id or name) and throw a helpful error.
   * @param {string} ref - id or name.
   * @returns {any} stored entry.
   */
  require(ref) {
    const entry = this.store.resolve(ref)
    if (entry !== undefined) return entry
    const names = this.store.list().map(candidate => candidate.name)
    throw new Error(`connection '${ref}' not found${names.length === 0 ? '（尚未配置任何连接）' : `；可用连接：${names.join(', ')}`}`)
  }

  /** The pool key for one connection/database pair. */
  poolKey(connection, database) {
    return connection.id + '\u0000' + (database ?? '')
  }

  /**
   * Get or create the pool for a connection/database pair.
   * @param {any} connection - stored entry.
   * @param {string|undefined} database - target database.
   * @returns {Promise<any>} driver pool.
   */
  async getPool(connection, database) {
    if (this.disposed) throw new Error('database engine disposed')
    const key = this.poolKey(connection, database)
    const existing = this.pools.get(key)
    if (existing !== undefined) {
      existing.lastUsed = Date.now()
      return existing.pool !== undefined ? existing.pool : existing.creating
    }
    const driver = driverFor(connection.type)
    const entry = { creating: undefined, pool: undefined, lastUsed: Date.now() }
    entry.creating = driver.createPool(connection, database, { timeoutMs: this.defaultTimeoutMs })
      .then(pool => {
        entry.pool = pool
        entry.creating = undefined
        return pool
      })
      .catch(error => {
        this.pools.delete(key)
        throw new Error(describeDbError(error))
      })
    this.pools.set(key, entry)
    this.evictPools()
    return entry.creating
  }

  /**
   * Drop one cached pool (connection id + database), closing it in the
   * background. Used when a stale pooled socket is detected.
   * @param {string} id - connection id.
   * @param {string|undefined} database - database key.
   */
  dropPool(id, database) {
    const key = id + '\u0000' + (database ?? '')
    const entry = this.pools.get(key)
    if (entry === undefined) return
    this.pools.delete(key)
    if (entry.pool !== undefined) {
      void closePoolOf(entry.pool)
    } else if (entry.creating !== undefined) {
      void entry.creating.then(pool => closePoolOf(pool)).catch(() => undefined)
    }
  }

  /**
   * Run one read-only metadata operation, retrying once on a fresh pool when
   * the cached pool turns out to hold a dead socket (the usual state after the
   * database's idle timeout). Writes are never retried here.
   * @param {any} connection - stored entry.
   * @param {string|undefined} database - database key.
   * @param {(pool:any) => Promise<any>} operation - read operation.
   */
  async readWithRetry(connection, database, operation) {
    try {
      return await operation(await this.getPool(connection, database))
    } catch (error) {
      if (!isConnectionError(error)) throw error
      this.dropPool(connection.id, database)
      return await operation(await this.getPool(connection, database))
    }
  }

  /** Close the least-recently-used pools above the cap. */
  evictPools() {
    if (this.pools.size <= this.maxPools) return
    const entries = [...this.pools.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed)
    for (const [key, entry] of entries) {
      if (this.pools.size <= this.maxPools) break
      this.pools.delete(key)
      if (entry.pool !== undefined) {
        void closePoolOf(entry.pool)
      } else if (entry.creating !== undefined) {
        void entry.creating.then(pool => closePoolOf(pool)).catch(() => undefined)
      }
    }
  }

  /**
   * Test a stored connection.
   * @param {string} ref - id or name.
   */
  async test(ref) {
    const connection = this.require(ref)
    try {
      const result = await this.readWithRetry(connection, connection.database, pool => driverFor(connection.type).testPool(pool))
      return { ...result, connection: this.store.summarize(connection) }
    } catch (error) {
      throw new Error(describeDbError(error))
    }
  }

  /**
   * Test an unsaved form draft without persisting it. When `baseId` names a
   * stored connection, a blank password reuses the stored secret (the edit
   * form never receives it).
   * @param {any} draft - form values.
   * @param {string|undefined} baseId - stored connection being edited.
   */
  async testDraft(draft, baseId) {
    if (typeof draft !== 'object' || draft === null) throw new Error('draft is required')
    const type = draft.type === 'postgres' ? 'postgres' : 'mysql'
    if (typeof draft.host !== 'string' || draft.host.trim() === '') throw new Error('host is required')
    if (typeof draft.user !== 'string' || draft.user.trim() === '') throw new Error('user is required')
    const port = clampInt(draft.port, defaultPort(type), 1, 65535)
    const base = baseId !== undefined ? this.store.findById(baseId) : undefined
    const password = typeof draft.password === 'string' && draft.password !== ''
      ? draft.password
      : (base?.password ?? '')
    const temp = {
      id: `draft_${Date.now()}`,
      name: 'draft',
      type,
      host: draft.host.trim(),
      port,
      user: draft.user.trim(),
      password,
      ssl: typeof draft.ssl === 'string' ? draft.ssl : 'disable',
      readOnly: true,
    }
    const pool = await driverFor(type).createPool(
      temp,
      typeof draft.database === 'string' && draft.database.trim() !== '' ? draft.database.trim() : undefined,
      { timeoutMs: this.defaultTimeoutMs },
    )
    try {
      const result = await driverFor(type).testPool(pool)
      return { ...result, type: typeLabel(type) }
    } catch (error) {
      throw new Error(describeDbError(error))
    } finally {
      await driverFor(type).closePool(pool)
    }
  }

  /**
   * Fetch the table/column catalog for one scope in one round trip; the
   * editor's autocomplete uses it for table and column suggestions.
   * @param {{id:string, database?:string, schema?:string}} request - catalog request.
   */
  async catalog(request) {
    const connection = this.require(request.id)
    const driver = driverFor(connection.type)
    if (connection.type === 'mysql') {
      const database = typeof request.database === 'string' && request.database !== ''
        ? request.database
        : connection.database
      if (database === undefined || database === '') {
        throw new Error('请先选择数据库（MySQL 的表 / 字段补全需要库名）')
      }
      try {
        return {
          database,
          tables: await this.readWithRetry(connection, database, pool => driver.listCatalog(pool, database)),
          connection: this.store.summarize(connection),
        }
      } catch (error) {
        throw new Error(describeDbError(error))
      }
    }
    const schema = typeof request.schema === 'string' && request.schema !== '' ? request.schema : undefined
    if (schema === undefined) {
      throw new Error('请先选择 schema（PostgreSQL 的表 / 字段补全需要 schema）')
    }
    try {
      return {
        schema,
        tables: await this.readWithRetry(connection, connection.database, pool => driver.listCatalog(pool, schema)),
        connection: this.store.summarize(connection),
      }
    } catch (error) {
      throw new Error(describeDbError(error))
    }
  }

  /**
   * Search table/view names across the connection, or one database/schema.
   * @param {{id:string, query:string, database?:string, schema?:string}} request - search request.
   */
  async search(request) {
    const connection = this.require(request.id)
    const query = typeof request.query === 'string' ? request.query.trim() : ''
    if (query === '') return { tables: [], connection: this.store.summarize(connection) }
    const driver = driverFor(connection.type)
    const database = connection.type === 'mysql'
      ? (typeof request.database === 'string' && request.database !== '' ? request.database : undefined)
      : connection.database
    const schema = connection.type === 'postgres'
      ? (typeof request.schema === 'string' && request.schema !== '' ? request.schema : undefined)
      : undefined
    try {
      const tables = await this.readWithRetry(connection, database, pool => driver.searchTables(pool, query, connection.type === 'mysql' ? database : schema))
      return { tables, connection: this.store.summarize(connection) }
    } catch (error) {
      throw new Error(describeDbError(error))
    }
  }

  /**
   * Browse one tree level.
   * @param {{id:string, database?:string, schema?:string, table?:string, query?:string}} request - tree request.
   */
  async tree(request) {
    const connection = this.require(request.id)
    const type = connection.type
    const driver = driverFor(type)
    const search = typeof request.query === 'string' && request.query.trim() !== '' ? request.query.trim() : undefined

    if (type === 'mysql') {
      const database = request.database !== undefined && request.database !== '' ? request.database : undefined
      if (database !== undefined && request.table !== undefined && request.table !== '') {
        try {
          const items = await this.readWithRetry(connection, database, pool => driver.listColumns(pool, database, request.table))
          return { level: 'columns', database, table: request.table, items, connection: this.store.summarize(connection) }
        } catch (error) {
          throw new Error(describeDbError(error))
        }
      }
      if (database !== undefined) {
        try {
          const items = await this.readWithRetry(connection, database, pool => driver.listTables(pool, database, search))
          return capItems({ level: 'tables', database, items, connection: this.store.summarize(connection) })
        } catch (error) {
          throw new Error(describeDbError(error))
        }
      }
      try {
        const items = await this.readWithRetry(connection, undefined, pool => driver.listDatabases(pool, search))
        return capItems({ level: 'databases', items, connection: this.store.summarize(connection) })
      } catch (error) {
        throw new Error(describeDbError(error))
      }
    }

    // PostgreSQL
    const schema = request.schema !== undefined && request.schema !== '' ? request.schema : undefined
    if (schema !== undefined && request.table !== undefined && request.table !== '') {
      try {
        const items = await this.readWithRetry(connection, connection.database, pool => driver.listColumns(pool, schema, request.table))
        return { level: 'columns', schema, table: request.table, items, connection: this.store.summarize(connection) }
      } catch (error) {
        throw new Error(describeDbError(error))
      }
    }
    if (schema !== undefined) {
      try {
        const items = await this.readWithRetry(connection, connection.database, pool => driver.listTables(pool, schema, search))
        return capItems({ level: 'tables', schema, items, connection: this.store.summarize(connection) })
      } catch (error) {
        throw new Error(describeDbError(error))
      }
    }
    try {
      const items = await this.readWithRetry(connection, connection.database, pool => driver.listSchemas(pool, search))
      return capItems({ level: 'schemas', items, connection: this.store.summarize(connection) })
    } catch (error) {
      throw new Error(describeDbError(error))
    }
  }

  /**
   * Execute one SQL statement under the connection's read-only policy.
   * @param {{id:string, sql:string, database?:string, schema?:string, maxRows?:number, timeoutMs?:number}} request - query request.
   */
  async query(request) {
    const connection = this.require(request.id)
    if (typeof request.sql !== 'string' || request.sql.trim() === '') throw new Error('sql is required')
    const database = typeof request.database === 'string' && request.database !== ''
      ? request.database
      : connection.database
    const schema = typeof request.schema === 'string' && request.schema !== '' ? request.schema : undefined
    const maxRows = clampInt(request.maxRows, this.defaultMaxRows, 1, MAX_ROWS_CAP)
    const timeoutMs = clampInt(request.timeoutMs, this.defaultTimeoutMs, 1_000, MAX_TIMEOUT_MS)
    const readOnly = connection.readOnly !== false
    if (readOnly) assertReadOnlyStatement(request.sql)
    const driver = driverFor(connection.type)
    const pool = await this.getPool(connection, database)
    try {
      const result = await driver.runQuery(pool, {
        sql: request.sql,
        readOnly,
        maxRows,
        timeoutMs,
        ...(connection.type === 'postgres' && schema !== undefined ? { schema } : {}),
      })
      return {
        ...result,
        readOnly,
        database: database ?? null,
        ...(schema !== undefined ? { schema } : {}),
        connection: {
          id: connection.id,
          name: connection.name,
          type: connection.type,
          typeLabel: typeLabel(connection.type),
        },
      }
    } catch (error) {
      throw new Error(describeDbError(error))
    }
  }

  /** Close and forget every pool of one connection (after edit/delete). */
  dropConnection(id) {
    for (const [key, entry] of [...this.pools]) {
      if (!key.startsWith(id + '\u0000')) continue
      this.pools.delete(key)
      if (entry.pool !== undefined) {
        void closePoolOf(entry.pool)
      } else if (entry.creating !== undefined) {
        void entry.creating.then(pool => closePoolOf(pool)).catch(() => undefined)
      }
    }
  }

  /** Close every pool. */
  async dispose() {
    this.disposed = true
    const closers = []
    for (const entry of this.pools.values()) {
      if (entry.pool !== undefined) closers.push(closePoolOf(entry.pool))
      else if (entry.creating !== undefined) closers.push(entry.creating.then(pool => closePoolOf(pool)).catch(() => undefined))
    }
    this.pools.clear()
    await Promise.all(closers)
  }
}
