/**
 * Connection store: one JSON file (`$DSH_HOME/dsh-db.json`, defaulting to
 * `~/.dsh`) holding every database connection, written atomically
 * (tmp + rename, file mode 0600). Passwords live in this user-owned file in
 * plaintext — the same trust model as dsh-ssh's host store. Document it,
 * never log it, never return it to the browser or the model.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { dshHome } from './dsh-home.js'

/** File format version. */
const FORMAT_VERSION = 1

/** Supported database types. */
export const DB_TYPES = ['mysql', 'postgres']

/** Supported TLS modes. */
export const SSL_MODES = ['disable', 'require', 'verify']

/** Store file location: $DSH_HOME/dsh-db.json. */
export function storePath() {
  return join(dshHome(), 'dsh-db.json')
}

/** Default TCP port per database type. */
export function defaultPort(type) {
  return type === 'postgres' ? 5432 : 3306
}

/** The display label for a database type. */
export function typeLabel(type) {
  return type === 'postgres' ? 'PostgreSQL' : 'MySQL'
}

/** Trim a string field, returning undefined for an empty result. */
function optionalText(value) {
  if (typeof value !== 'string') return undefined
  return value.trim() === '' ? undefined : value.trim()
}

/** Validate one connection payload. @returns {string|undefined} error message. */
export function validateConnectionPayload(payload, { partial = false } = {}) {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return 'body must be a JSON object'
  const p = /** @type {Record<string, unknown>} */ (payload)
  if (!partial || p.name !== undefined) {
    if (typeof p.name !== 'string' || p.name.trim() === '') return 'name is required'
    if (p.name.trim().length > 64) return 'name must be at most 64 characters'
  }
  if (!partial || p.type !== undefined) {
    if (typeof p.type !== 'string' || !DB_TYPES.includes(p.type)) return 'type must be mysql or postgres'
  }
  if (!partial || p.host !== undefined) {
    if (typeof p.host !== 'string' || p.host.trim() === '') return 'host is required'
  }
  if (!partial || p.user !== undefined) {
    if (typeof p.user !== 'string' || p.user.trim() === '') return 'user is required'
  }
  if (p.port !== undefined && (typeof p.port !== 'number' || !Number.isInteger(p.port) || p.port < 1 || p.port > 65535)) {
    return 'port must be an integer in 1..65535'
  }
  if (p.password !== undefined && typeof p.password !== 'string') return 'password must be a string when provided'
  if (p.database !== undefined && typeof p.database !== 'string') return 'database must be a string when provided'
  if (p.ssl !== undefined && (typeof p.ssl !== 'string' || !SSL_MODES.includes(p.ssl))) {
    return 'ssl must be disable, require or verify'
  }
  if (p.readOnly !== undefined && typeof p.readOnly !== 'boolean') return 'readOnly must be a boolean'
  if (p.description !== undefined && typeof p.description !== 'string') return 'description must be a string when provided'
  return undefined
}

/** The connection store. Pure file I/O — no cordis dependency, unit-testable. */
export class ConnectionStore {
  /** @param {string} [path] - store file path (defaults to the standard location). */
  constructor(path) {
    /** @type {string} */
    this.path = resolve(path ?? storePath())
    /** @type {{mtimeMs:number,size:number,file:{version:number,connections:any[]}}|undefined} */
    this.cache = undefined
  }

  /** Load all entries (empty store when the file is absent). */
  list() {
    return this.load().connections
  }

  /** Find one entry by id. */
  findById(id) {
    return this.list().find(entry => entry.id === id)
  }

  /**
   * Resolve an agent/user reference: exact id, exact name, then a
   * case-insensitive name match.
   * @param {string} ref - connection id or name.
   * @returns {any|undefined} the entry.
   */
  resolve(ref) {
    const text = typeof ref === 'string' ? ref.trim() : ''
    if (text === '') return undefined
    const entries = this.list()
    return entries.find(entry => entry.id === text)
      ?? entries.find(entry => entry.name === text)
      ?? entries.find(entry => entry.name.toLowerCase() === text.toLowerCase())
  }

  /** Secret-free projection for the browser and agent surfaces. */
  summarize(entry) {
    return {
      id: entry.id,
      name: entry.name,
      type: entry.type,
      host: entry.host,
      port: entry.port,
      user: entry.user,
      ...(entry.database !== undefined ? { database: entry.database } : {}),
      ssl: entry.ssl,
      readOnly: entry.readOnly,
      hasPassword: typeof entry.password === 'string' && entry.password !== '',
      ...(entry.description !== undefined ? { description: entry.description } : {}),
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    }
  }

  /** Create one entry. Throws on name collision or invalid payload. */
  create(payload) {
    const error = validateConnectionPayload(payload)
    if (error !== undefined) throw new Error(error)
    const name = payload.name.trim()
    const file = this.load()
    if (file.connections.some(entry => entry.name.toLowerCase() === name.toLowerCase())) {
      throw new Error(`connection name '${name}' already exists`)
    }
    const now = Date.now()
    const type = payload.type
    const entry = {
      id: `db_${randomUUID().slice(0, 12)}`,
      name,
      type,
      host: payload.host.trim(),
      port: payload.port ?? defaultPort(type),
      user: payload.user.trim(),
      password: typeof payload.password === 'string' ? payload.password : '',
      ...(optionalText(payload.database) !== undefined ? { database: optionalText(payload.database) } : {}),
      ssl: payload.ssl ?? 'disable',
      readOnly: payload.readOnly !== false,
      ...(optionalText(payload.description) !== undefined ? { description: optionalText(payload.description) } : {}),
      createdAt: now,
      updatedAt: now,
    }
    file.connections.push(entry)
    this.save(file)
    return entry
  }

  /** Update the fields present in `patch`; unknown ids throw. */
  update(id, patch) {
    const error = validateConnectionPayload(patch, { partial: true })
    if (error !== undefined) throw new Error(error)
    const file = this.load()
    const entry = file.connections.find(candidate => candidate.id === id)
    if (entry === undefined) throw new Error('connection not found')
    if (patch.name !== undefined) {
      const name = patch.name.trim()
      if (file.connections.some(candidate => candidate.id !== id && candidate.name.toLowerCase() === name.toLowerCase())) {
        throw new Error(`connection name '${name}' already exists`)
      }
      entry.name = name
    }
    if (patch.type !== undefined) entry.type = patch.type
    if (patch.host !== undefined) entry.host = patch.host.trim()
    if (patch.port !== undefined) entry.port = patch.port
    if (patch.user !== undefined) entry.user = patch.user.trim()
    // `password: undefined` keeps the stored secret; an explicit string sets it
    // (empty string clears it). The browser omits the field when untouched.
    if (patch.password !== undefined) entry.password = patch.password
    if (patch.database !== undefined) {
      const database = optionalText(patch.database)
      if (database === undefined) delete entry.database
      else entry.database = database
    }
    if (patch.ssl !== undefined) entry.ssl = patch.ssl
    if (patch.readOnly !== undefined) entry.readOnly = patch.readOnly === true
    if (patch.description !== undefined) {
      const description = optionalText(patch.description)
      if (description === undefined) delete entry.description
      else entry.description = description
    }
    entry.updatedAt = Date.now()
    this.save(file)
    return entry
  }

  /** Remove one entry. */
  delete(id) {
    const file = this.load()
    const index = file.connections.findIndex(candidate => candidate.id === id)
    if (index < 0) throw new Error('connection not found')
    file.connections.splice(index, 1)
    this.save(file)
  }

  /** @returns {{version:number,connections:any[]}} */
  load() {
    let stats
    try {
      stats = statSync(this.path)
    } catch {
      this.cache = undefined
      return { version: FORMAT_VERSION, connections: [] }
    }
    if (this.cache !== undefined && this.cache.mtimeMs === stats.mtimeMs && this.cache.size === stats.size) {
      return this.cache.file
    }
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8'))
      if (typeof parsed !== 'object' || parsed === null || !Array.isArray(parsed.connections)) {
        throw new Error('store file shape invalid')
      }
      const file = { version: FORMAT_VERSION, connections: parsed.connections }
      this.cache = { mtimeMs: stats.mtimeMs, size: stats.size, file }
      return file
    } catch {
      // A corrupt store must not brick the plugin, and must not be silently
      // overwritten: move it aside for manual recovery.
      this.cache = undefined
      try {
        renameSync(this.path, `${this.path}.corrupt-${Date.now()}`)
      } catch { /* best effort */ }
      return { version: FORMAT_VERSION, connections: [] }
    }
  }

  /** @param {{version:number,connections:any[]}} file */
  save(file) {
    const dir = dirname(this.path)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 })
    const tmp = this.path + '.tmp'
    writeFileSync(tmp, JSON.stringify(file, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 })
    renameSync(tmp, this.path)
    this.cache = undefined
  }
}
