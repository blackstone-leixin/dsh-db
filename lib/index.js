/**
 * dsh-db — host half. Mounts the database engine (pooled MySQL/MariaDB and
 * PostgreSQL connections), the /api/dsh-db route family, the agent tools
 * (db_list, db_search, db_schema, db_query), and an optional system-prompt
 * announcement.
 * The browser half (./client) renders the connection manager, schema tree and
 * SQL console. Everything rides official NPM SDK packages — no dsh source
 * changes.
 */

import z from '@deepseek-ai/schemastery'
import { ConnectionStore } from './store.js'
import { DbEngine } from './engine.js'
import { makeRoutes } from './routes.js'
import { dbListTool, dbQueryTool, dbSchemaTool, dbSearchTool } from './tools.js'

/** Stable cordis plugin name. */
export const name = 'db'

/** Services required before the database surfaces can mount. */
export const inject = ['webServer', 'tools', 'systemPrompt']

/** Plugin config as a profile patch declares it. */
export const Config = z.object({
  /** Master switch for the plugin (routes, tools, prompt section). */
  enabled: z.boolean().default(true).volatile(),
  /** Announce the plugin and its tools to every agent (off keeps prompts clean). */
  announceToAgent: z.boolean().default(false).volatile(),
  /** Default row cap for GUI and agent queries. */
  maxRows: z.number().default(500).volatile(),
  /** Default statement timeout in milliseconds. */
  queryTimeoutMs: z.number().default(30000).volatile(),
})

/** The stable reference a `volatile()` config field resolves to. */
function readConfigField(field, fallback) {
  if (field === undefined) return fallback
  if (typeof field === 'object' && field !== null && typeof field.get === 'function') {
    const value = field.get()
    return value === undefined ? fallback : value
  }
  return field
}

/** Order of the announcement section within the shared tool-guidance band. */
const SECTION_ORDER = 160

/** The four agent-tool names this plugin's announcement describes. */
const DB_TOOL_NAMES = ['db_list', 'db_search', 'db_schema', 'db_query']

/** Model-facing announcement: plugin presence, capabilities, and limits. */
export const DB_GUIDANCE = '本机已安装 dsh-db 插件（DSH 数据库连接）：侧边栏「数据库」入口。能力：连接 MySQL/MariaDB 与 PostgreSQL；树形浏览库 / 模式 / 表 / 字段（类型、可空、默认值、主键、注释）；SQL 编辑器与结果表格；db_list 列出连接、db_search 按表名搜索、db_schema 逐层查看结构、db_query 执行单条 SQL。连接由用户在 GUI 中配置，Agent 不能创建或修改；密码以明文存于 $DSH_HOME/dsh-db.json（0600）。连接默认只读：SQL 在数据库强制的只读事务中执行，写操作会被数据库拒绝，只有用户能在 GUI 中关闭只读。SQL 结果原样返回、可能含敏感数据；大结果默认截断（500 行，最多 5000 行），语句默认 30 秒超时。用户提到「数据库 / MySQL / MariaDB / PostgreSQL / 表结构 / 查库 / 执行 SQL」时即指本插件，请据此协作。'

/**
 * Mount the engine, routes, tools, and announcement.
 * @param {import('@deepseek-ai/cordis').Context} ctx - host plugin context.
 * @param {any} [config] - resolved plugin config.
 */
export const apply = mountOnce('dsh-db', applyImpl)

function applyImpl(ctx, config) {
  const store = new ConnectionStore()
  const engine = new DbEngine(store, {
    maxRows: readConfigField(config?.maxRows, 500),
    queryTimeoutMs: readConfigField(config?.queryTimeoutMs, 30_000),
  })
  ctx.effect(() => () => { void engine.dispose() }, 'dsh-db: engine')

  const routes = makeRoutes({ store, engine })
  const tools = [dbListTool(engine), dbSearchTool(engine), dbSchemaTool(engine), dbQueryTool(engine)]

  /** @type {(() => void)|undefined} */
  let disposeRoutes
  /** @type {(() => void)|undefined} */
  let disposeTools
  /** @type {(() => void)|undefined} */
  let disposeSection

  const resolve = () => ({
    enabled: readConfigField(config?.enabled, true) !== false,
    announceToAgent: readConfigField(config?.announceToAgent, false) === true,
    maxRows: readConfigField(config?.maxRows, 500),
    queryTimeoutMs: readConfigField(config?.queryTimeoutMs, 30_000),
  })

  const sync = () => {
    const value = resolve()
    if (disposeSection !== undefined) { disposeSection(); disposeSection = undefined }
    if (disposeRoutes !== undefined) { disposeRoutes(); disposeRoutes = undefined }
    if (disposeTools !== undefined) { disposeTools(); disposeTools = undefined }
    if (!value.enabled) return

    // Settings edits reach the running instance without a remount; keep the
    // engine defaults in step with them.
    engine.defaultMaxRows = Math.min(5000, Math.max(1, Math.trunc(Number(value.maxRows) || 500)))
    engine.defaultTimeoutMs = Math.min(120_000, Math.max(1_000, Math.trunc(Number(value.queryTimeoutMs) || 30_000)))

    if (value.announceToAgent) {
      disposeSection = ctx.systemPrompt.section({
        name: 'plugin:dsh-db',
        order: SECTION_ORDER,
        // The announcement names the db_* tools, so it renders only while at
        // least one of them is reachable for the rendering scope.
        text: visibleToolText(ctx.tools, DB_TOOL_NAMES, DB_GUIDANCE),
      })
    }
    disposeRoutes = ctx.effect(
      () => {
        const disposers = routes.map(route => ctx.webServer.register(route))
        return () => { for (const dispose of disposers) dispose() }
      },
      'dsh-db: routes',
    )
    disposeTools = ctx.effect(
      () => {
        const disposers = tools.map(tool => ctx.tools.register(tool))
        return () => { for (const dispose of disposers) dispose() }
      },
      'dsh-db: tools',
    )
  }

  // A settings edit is committed into this instance's config references and
  // announced on the owning fiber, so the surfaces are re-derived here.
  ctx.on('loader/volatile-update', () => { sync() })
  sync()
}

/**
 * Render the announcement only while at least one named tool is visible to
 * the rendering scope (same convention as the official tool packages).
 * @param {{get(name:string, scope?:unknown):unknown}} tools - tool registry.
 * @param {string[]} names - tool names the guidance describes.
 * @param {string} value - guidance text.
 * @returns {(context: {scope?: unknown}) => string} section text provider.
 */
function visibleToolText(tools, names, value) {
  return (context) => {
    try {
      for (const name of names) {
        if (tools.get(name, context?.scope) !== undefined) return value
      }
      return ''
    } catch {
      return value
    }
  }
}

/**
 * Host single-instance guard: a second mount of the same package (standalone
 * install plus an aggregate row) is a no-op while the first live fiber owns it.
 * @param {string} packageName - npm package identity.
 * @param {Function} fn - plugin apply.
 * @returns {Function} guarded apply.
 */
function mountOnce(packageName, fn) {
  return (...args) => {
    const registry = globalThis
    const mounted = registry[Symbol.for('dsh-web.mounted-plugins')] instanceof Set
      ? registry[Symbol.for('dsh-web.mounted-plugins')]
      : (registry[Symbol.for('dsh-web.mounted-plugins')] = new Set())
    if (mounted.has(packageName)) return undefined
    mounted.add(packageName)
    args[0]?.effect?.(() => () => { mounted.delete(packageName) })
    return fn(...args)
  }
}
