/**
 * The /api/dsh-db route family: connection CRUD, connection testing, schema
 * tree expansion, and SQL execution. Every route is loopback-only — these
 * endpoints hold database credentials and run SQL, so a LAN-exposed dsh web
 * deployment must never serve them.
 */

import { readJsonBody, writeJson } from './http.js'
import { isLoopbackRequest } from './loopback.js'
import { describeDbError } from './engine.js'

/** Route paths, shared with the browser half's API client. */
export const DB_API = {
  connections: '/api/dsh-db/connections',
  test: '/api/dsh-db/test',
  tree: '/api/dsh-db/tree',
  catalog: '/api/dsh-db/catalog',
  search: '/api/dsh-db/search',
  disconnect: '/api/dsh-db/disconnect',
  query: '/api/dsh-db/query',
}

/** Query-string helper. */
function queryParam(url, name) {
  const value = url.searchParams.get(name)
  return value === null ? undefined : value
}

/**
 * Build every /api/dsh-db route.
 * @param {{store: import('./store.js').ConnectionStore, engine: import('./engine.js').DbEngine}} deps - store and engine.
 * @returns {import('@deepseek-ai/dsh-host-webserver').WebRoute[]} web routes.
 */
export function makeRoutes(deps) {
  const { store, engine } = deps

  /** Fence + method check. */
  const guard = (req, res, method) => {
    if (!isLoopbackRequest(req)) {
      writeJson(res, 403, { error: 'forbidden: loopback-only' })
      return false
    }
    if (req.method !== method) {
      writeJson(res, 405, { error: `method not allowed: ${req.method}` })
      return false
    }
    return true
  }

  return [
    {
      kind: 'exact',
      path: DB_API.connections,
      handler: async (req, res) => {
        if (!isLoopbackRequest(req)) {
          writeJson(res, 403, { error: 'forbidden: loopback-only' })
          return
        }
        const method = req.method ?? 'GET'
        const url = new URL(req.url ?? '/', 'http://localhost')
        if (method === 'GET') {
          writeJson(res, 200, { connections: engine.list(queryParam(url, 'query')) })
          return
        }
        if (method === 'POST') {
          const body = await readJsonBody(req)
          if (body === null) {
            writeJson(res, 400, { error: 'invalid JSON body' })
            return
          }
          try {
            const entry = store.create(body)
            writeJson(res, 201, { connection: store.summarize(entry) })
          } catch (error) {
            writeJson(res, 400, { error: error instanceof Error ? error.message : String(error) })
          }
          return
        }
        if (method !== 'PATCH' && method !== 'DELETE') {
          writeJson(res, 405, { error: `method not allowed: ${method}` })
          return
        }
        const id = queryParam(url, 'id')
        if (id === undefined || id === '') {
          writeJson(res, 400, { error: 'id query parameter is required' })
          return
        }
        if (method === 'PATCH') {
          const body = await readJsonBody(req)
          if (body === null) {
            writeJson(res, 400, { error: 'invalid JSON body' })
            return
          }
          try {
            const entry = store.update(id, body)
            // Credentials/host may have changed: never reuse the old pool.
            engine.dropConnection(id)
            writeJson(res, 200, { connection: store.summarize(entry) })
          } catch (error) {
            writeJson(res, 400, { error: error instanceof Error ? error.message : String(error) })
          }
          return
        }
        try {
          engine.dropConnection(id)
          store.delete(id)
          writeJson(res, 200, { ok: true })
        } catch (error) {
          writeJson(res, 400, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    {
      kind: 'exact',
      path: DB_API.test,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        const body = await readJsonBody(req)
        if (typeof body !== 'object' || body === null) {
          writeJson(res, 400, { error: 'invalid JSON body' })
          return
        }
        const payload = /** @type {Record<string, unknown>} */ (body)
        try {
          if (typeof payload.id === 'string' && payload.id !== '') {
            writeJson(res, 200, { result: await engine.test(payload.id) })
            return
          }
          if (typeof payload.draft === 'object' && payload.draft !== null) {
            const baseId = typeof payload.baseId === 'string' && payload.baseId !== '' ? payload.baseId : undefined
            writeJson(res, 200, { result: await engine.testDraft(payload.draft, baseId) })
            return
          }
          writeJson(res, 400, { error: 'id or draft is required' })
        } catch (error) {
          writeJson(res, 400, { error: describeDbError(error) })
        }
      },
    },
    {
      kind: 'exact',
      path: DB_API.tree,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        const body = await readJsonBody(req)
        if (typeof body !== 'object' || body === null) {
          writeJson(res, 400, { error: 'invalid JSON body' })
          return
        }
        const payload = /** @type {Record<string, unknown>} */ (body)
        if (typeof payload.id !== 'string' || payload.id === '') {
          writeJson(res, 400, { error: 'id is required' })
          return
        }
        try {
          writeJson(res, 200, { result: await engine.tree({
            id: payload.id,
            database: typeof payload.database === 'string' ? payload.database : undefined,
            schema: typeof payload.schema === 'string' ? payload.schema : undefined,
            table: typeof payload.table === 'string' ? payload.table : undefined,
            query: typeof payload.query === 'string' ? payload.query : undefined,
          }) })
        } catch (error) {
          writeJson(res, 400, { error: describeDbError(error) })
        }
      },
    },
    {
      kind: 'exact',
      path: DB_API.catalog,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        const body = await readJsonBody(req)
        if (typeof body !== 'object' || body === null) {
          writeJson(res, 400, { error: 'invalid JSON body' })
          return
        }
        const payload = /** @type {Record<string, unknown>} */ (body)
        if (typeof payload.id !== 'string' || payload.id === '') {
          writeJson(res, 400, { error: 'id is required' })
          return
        }
        try {
          writeJson(res, 200, { result: await engine.catalog({
            id: payload.id,
            database: typeof payload.database === 'string' ? payload.database : undefined,
            schema: typeof payload.schema === 'string' ? payload.schema : undefined,
          }) })
        } catch (error) {
          writeJson(res, 400, { error: describeDbError(error) })
        }
      },
    },
    {
      kind: 'exact',
      path: DB_API.search,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        const body = await readJsonBody(req)
        if (typeof body !== 'object' || body === null) {
          writeJson(res, 400, { error: 'invalid JSON body' })
          return
        }
        const payload = /** @type {Record<string, unknown>} */ (body)
        if (typeof payload.id !== 'string' || payload.id === '') {
          writeJson(res, 400, { error: 'id is required' })
          return
        }
        if (typeof payload.query !== 'string' || payload.query.trim() === '') {
          writeJson(res, 400, { error: 'query is required' })
          return
        }
        try {
          writeJson(res, 200, { result: await engine.search({
            id: payload.id,
            query: payload.query,
            database: typeof payload.database === 'string' ? payload.database : undefined,
            schema: typeof payload.schema === 'string' ? payload.schema : undefined,
          }) })
        } catch (error) {
          writeJson(res, 400, { error: describeDbError(error) })
        }
      },
    },
    {
      kind: 'exact',
      path: DB_API.disconnect,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        const body = await readJsonBody(req)
        if (typeof body !== 'object' || body === null) {
          writeJson(res, 400, { error: 'invalid JSON body' })
          return
        }
        const payload = /** @type {Record<string, unknown>} */ (body)
        if (typeof payload.id !== 'string' || payload.id === '') {
          writeJson(res, 400, { error: 'id is required' })
          return
        }
        try {
          engine.dropConnection(payload.id)
          writeJson(res, 200, { ok: true })
        } catch (error) {
          writeJson(res, 400, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    {
      kind: 'exact',
      path: DB_API.query,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        const body = await readJsonBody(req, 2 * 1024 * 1024)
        if (typeof body !== 'object' || body === null) {
          writeJson(res, 400, { error: 'invalid JSON body' })
          return
        }
        const payload = /** @type {Record<string, unknown>} */ (body)
        if (typeof payload.id !== 'string' || payload.id === '') {
          writeJson(res, 400, { error: 'id is required' })
          return
        }
        if (typeof payload.sql !== 'string' || payload.sql.trim() === '') {
          writeJson(res, 400, { error: 'sql is required' })
          return
        }
        try {
          writeJson(res, 200, { result: await engine.query({
            id: payload.id,
            sql: payload.sql,
            database: typeof payload.database === 'string' ? payload.database : undefined,
            schema: typeof payload.schema === 'string' ? payload.schema : undefined,
            maxRows: typeof payload.maxRows === 'number' ? payload.maxRows : undefined,
            timeoutMs: typeof payload.timeoutMs === 'number' ? payload.timeoutMs : undefined,
          }) })
        } catch (error) {
          writeJson(res, 400, { error: describeDbError(error) })
        }
      },
    },
  ]
}
