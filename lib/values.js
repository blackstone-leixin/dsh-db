/**
 * Value normalization and SQL helpers shared by both database drivers.
 *
 * Every driver row is normalized to JSON-safe scalars before it leaves the
 * host process: Dates become ISO strings, Buffers become a short hex preview,
 * BigInts become decimal strings, and long text is truncated. The browser and
 * the agent tool then always receive lossless-enough JSON, never a raw
 * mysql2/pg object graph.
 */

/** Maximum characters kept from one text/JSON cell. */
export const MAX_CELL_CHARS = 4000

/** Maximum bytes shown for a binary cell. */
const MAX_BINARY_BYTES = 64

/** JSON.stringify that survives BigInt values. */
function safeJson(value) {
  try {
    return JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? String(item) : item)
  } catch {
    try {
      return String(value)
    } catch {
      return '[unserializable]'
    }
  }
}

/** Truncate one string with an explicit marker. */
function clip(text) {
  if (text.length <= MAX_CELL_CHARS) return text
  return text.slice(0, MAX_CELL_CHARS) + `… (${text.length} chars)`
}

/**
 * Normalize one database cell to a JSON-safe value.
 * @param {unknown} value - driver value.
 * @returns {string|number|boolean|null} JSON-safe cell.
 */
export function normalizeValue(value) {
  if (value === null || value === undefined) return null
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value)
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'string') return clip(value)
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
  if (Buffer.isBuffer(value)) {
    const shown = value.subarray(0, MAX_BINARY_BYTES).toString('hex')
    return value.length > MAX_BINARY_BYTES
      ? `0x${shown}… (${value.length} bytes)`
      : `0x${shown}`
  }
  if (value instanceof Uint8Array) {
    const shown = Buffer.from(value.buffer, value.byteOffset, value.byteLength)
      .subarray(0, MAX_BINARY_BYTES)
      .toString('hex')
    return value.byteLength > MAX_BINARY_BYTES
      ? `0x${shown}… (${value.byteLength} bytes)`
      : `0x${shown}`
  }
  if (Array.isArray(value) || typeof value === 'object') return clip(safeJson(value))
  return clip(String(value))
}

/** Normalize one row (array or object) into an array of cells. */
export function normalizeRow(row) {
  if (Array.isArray(row)) return row.map(normalizeValue)
  if (row !== null && typeof row === 'object') {
    return Object.values(row).map(normalizeValue)
  }
  return [normalizeValue(row)]
}

/** Normalize a list of rows. */
export function normalizeRows(rows) {
  return (rows ?? []).map(normalizeRow)
}

/**
 * Rough SQL classifier used by the browser for a write warning and by the
 * agent tool's human-readable output. Enforcement is NOT done here: a
 * read-only connection runs every statement inside a database-enforced
 * read-only transaction, which is authoritative.
 * @param {string} sql - SQL text.
 * @returns {{keyword:string, write:boolean, multiple:boolean}}
 */
export function classifySql(sql) {
  const stripped = stripCommentsAndStrings(sql)
  const match = /^\s*\(*\s*([a-zA-Z]+)/.exec(stripped)
  const keyword = match === null ? '' : match[1].toUpperCase()
  const writeKeywords = new Set([
    'INSERT', 'UPDATE', 'DELETE', 'MERGE', 'REPLACE', 'TRUNCATE',
    'CREATE', 'ALTER', 'DROP', 'RENAME', 'COMMENT', 'GRANT', 'REVOKE',
    'VACUUM', 'ANALYZE', 'REINDEX', 'CLUSTER', 'REFRESH', 'CALL', 'DO',
    'COPY', 'LOAD', 'IMPORT', 'EXPORT', 'LOCK', 'UNLOCK', 'SET', 'BEGIN',
    'START', 'COMMIT', 'ROLLBACK', 'SAVEPOINT', 'USE',
  ])
  return {
    keyword,
    write: writeKeywords.has(keyword),
    multiple: countStatements(sql) > 1,
  }
}

/**
 * Replace string literals, quoted identifiers, and comments with spaces so a
 * keyword scan sees only SQL structure. This is intentionally coarse — it is
 * a UX hint, not a parser.
 * @param {string} sql - SQL text.
 * @returns {string} structural skeleton.
 */
export function stripCommentsAndStrings(sql) {
  let out = ''
  let i = 0
  const n = sql.length
  while (i < n) {
    const ch = sql[i]
    const next = sql[i + 1]
    if (ch === '-' && next === '-') {
      const end = sql.indexOf('\n', i + 2)
      i = end < 0 ? n : end
      out += ' '
      continue
    }
    // MySQL `#` line comment.
    if (ch === '#') {
      const end = sql.indexOf('\n', i + 1)
      i = end < 0 ? n : end
      out += ' '
      continue
    }
    if (ch === '/' && next === '*') {
      const end = sql.indexOf('*/', i + 2)
      i = end < 0 ? n : end + 2
      out += ' '
      continue
    }
    // PostgreSQL dollar-quoted string: $$...$$ or $tag$...$tag$.
    if (ch === '$') {
      const tag = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i))
      if (tag !== null) {
        const marker = tag[0]
        const end = sql.indexOf(marker, i + marker.length)
        i = end < 0 ? n : end + marker.length
        out += ' '
        continue
      }
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch
      i += 1
      while (i < n) {
        if (sql[i] === '\\' && quote !== '`') {
          i += 2
          continue
        }
        if (sql[i] === quote) {
          if (sql[i + 1] === quote) {
            i += 2
            continue
          }
          i += 1
          break
        }
        i += 1
      }
      out += ' '
      continue
    }
    out += ch
    i += 1
  }
  return out
}

/** Count semicolon-separated statements (coarse, quote-aware enough for a hint). */
function countStatements(sql) {
  const skeleton = stripCommentsAndStrings(sql)
  const parts = skeleton.split(';').map(part => part.trim()).filter(part => part !== '')
  return parts.length
}

/**
 * Enforce the read-only policy BEFORE a statement reaches the server.
 *
 * The database's own read-only transaction is the authority, but MySQL ends a
 * transaction implicitly on DDL and a multi-statement payload can COMMIT out
 * of it, so a statement allowlist is a second, cheap gate. This also turns the
 * common "try an UPDATE on a read-only connection" mistake into a clear
 * message instead of a driver error.
 * @param {string} sql - one SQL statement.
 * @throws {Error} when the statement is not read-only.
 */
export function assertReadOnlyStatement(sql) {
  if (typeof sql !== 'string' || sql.trim() === '') throw new Error('sql is required')
  if (countStatements(sql) > 1) {
    throw new Error('只读连接一次只能执行一条语句；请在 GUI 中关闭该连接的「只读」后再执行多条语句')
  }
  const skeleton = stripCommentsAndStrings(sql)
  const match = /^\s*\(*\s*([a-zA-Z]+)/.exec(skeleton)
  const keyword = match === null ? '' : match[1].toUpperCase()
  const allowed = new Set(['SELECT', 'SHOW', 'DESCRIBE', 'DESC', 'EXPLAIN', 'WITH', 'VALUES', 'TABLE'])
  if (!allowed.has(keyword)) {
    throw new Error(`只读连接拒绝 ${keyword === '' ? '该' : keyword} 语句；只允许 SELECT / SHOW / DESCRIBE / EXPLAIN / WITH … SELECT / VALUES / TABLE。若确需写入，请在 GUI 中关闭该连接的「只读」`)
  }
  if (keyword === 'WITH' && (!/\bSELECT\b/i.test(skeleton) || /\b(INSERT|UPDATE|DELETE|MERGE|REPLACE|CREATE|ALTER|DROP|TRUNCATE|CALL|DO|COPY|SET)\b/i.test(skeleton))) {
    throw new Error('只读连接只允许 WITH … SELECT 形式；检测到数据修改关键字')
  }
  if (keyword === 'EXPLAIN' && /\b(INSERT|UPDATE|DELETE|REPLACE|MERGE|CREATE|ALTER|DROP|TRUNCATE)\b/i.test(skeleton)) {
    throw new Error('只读连接拒绝 EXPLAIN 数据修改语句（EXPLAIN ANALYZE 会真正执行它）')
  }
  if (/\bINTO\s+(OUTFILE|DUMPFILE)\b/i.test(skeleton) || (keyword === 'SELECT' && /\bINTO\b/i.test(skeleton))) {
    throw new Error('只读连接拒绝 SELECT … INTO（会写文件或建表）')
  }
}


/**
 * Quote one identifier for the target database.
 * @param {'mysql'|'postgres'} type - database type.
 * @param {string} name - raw identifier.
 * @returns {string} quoted identifier.
 */
export function quoteIdent(type, name) {
  const text = String(name)
  if (type === 'mysql') return '`' + text.replace(/`/g, '``') + '`'
  return '"' + text.replace(/"/g, '""') + '"'
}

/**
 * Build a fully qualified table name.
 * @param {'mysql'|'postgres'} type - database type.
 * @param {string|undefined} database - MySQL database (ignored for PostgreSQL).
 * @param {string|undefined} schema - PostgreSQL schema.
 * @param {string} table - table name.
 * @returns {string} qualified, quoted table reference.
 */
export function qualifyTable(type, database, schema, table) {
  if (type === 'mysql') {
    return database !== undefined && database !== ''
      ? quoteIdent(type, database) + '.' + quoteIdent(type, table)
      : quoteIdent(type, table)
  }
  return schema !== undefined && schema !== ''
    ? quoteIdent(type, schema) + '.' + quoteIdent(type, table)
    : quoteIdent(type, table)
}
