/**
 * Agent tools: db_list, db_search, db_schema, db_query. They talk to the same
 * engine the web GUI uses, so a connection configured in the GUI is
 * immediately operable by any agent, and the GUI's read-only switch applies to
 * both surfaces.
 *
 * Each tool renders a compact text report; the structured value is only
 * `{ text }` so the tool bridge never has to validate a wide row payload.
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import { classifySql } from './values.js'

/** One text content block. */
function text(value) {
  return [{ type: 'text', text: value }]
}

/** Tool output schema for a pre-rendered text report. */
const TEXT_OUTPUT = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      text: { type: 'string', required: true },
    },
  },
  render: (_args, value) => text(value.text),
}

/** Clip one cell for a model-facing table. */
function clipCell(value, max = 160) {
  if (value === null || value === undefined) return 'NULL'
  const rendered = typeof value === 'string' ? value : String(value)
  const oneLine = rendered.replace(/\r?\n/g, '\\n').replace(/\|/g, '\\|')
  return oneLine.length > max ? oneLine.slice(0, max) + '…' : oneLine
}

/** Render a markdown table from the shared column/row shape. */
function renderResultTable(columns, rows, options = {}) {
  const maxRows = options.maxRows ?? 50
  const maxColumns = options.maxColumns ?? 24
  if (columns.length === 0) return 'OK'
  const shownColumns = columns.slice(0, maxColumns)
  const header = shownColumns.map(column => `${column.name}${column.dataType !== undefined ? ` (${column.dataType})` : ''}`)
  const lines = [
    '| ' + header.join(' | ') + ' |',
    '| ' + shownColumns.map(() => '---').join(' | ') + ' |',
  ]
  for (const row of rows.slice(0, maxRows)) {
    lines.push('| ' + shownColumns.map((_column, index) => clipCell(row[index])).join(' | ') + ' |')
  }
  const notes = []
  if (rows.length > maxRows) notes.push(`… ${rows.length - maxRows} more rows not shown`)
  if (columns.length > maxColumns) notes.push(`… ${columns.length - maxColumns} more columns not shown`)
  return notes.length === 0 ? lines.join('\n') : lines.join('\n') + '\n' + notes.join('\n')
}

/** Render a connection row list. */
function renderConnections(connections) {
  if (connections.length === 0) return 'No database connections configured. Ask the user to add one in the GUI (sidebar → Database).'
  const lines = [
    '| name | type | host:port | database | mode |',
    '| --- | --- | --- | --- | --- |',
  ]
  for (const entry of connections) {
    lines.push(`| ${entry.name} | ${entry.type} | ${entry.host}:${entry.port} | ${entry.database ?? '-'} | ${entry.readOnly ? 'read-only' : 'read-write'} |`)
  }
  return lines.join('\n')
}

/** Render one tree level. */
function renderSchema(result) {
  const connection = result.connection
  const heading = `Connection: ${connection.name} (${connection.type})\n`
  if (result.level === 'databases' || result.level === 'schemas') {
    const noun = result.level === 'databases' ? 'databases' : 'schemas'
    if (result.items.length === 0) return `${heading}No ${noun} found.`
    const rows = result.items.map(item => `| ${item.name} |${item.system === true ? ' system |' : ' |'}`)
    return `${heading}\n| ${noun.replace(/s$/, '')} | |\n| --- | --- |\n${rows.join('\n')}`
  }
  if (result.level === 'tables') {
    const scope = result.database ?? result.schema ?? ''
    const lines = [
      `${heading}Scope: ${scope}`,
      '',
      `| table | type | rows (approx) | comment |`,
      '| --- | --- | --- | --- |',
    ]
    for (const item of result.items.slice(0, 200)) {
      lines.push(`| ${item.name} | ${item.type} | ${item.rowCount ?? '-'} | ${item.comment ?? ''} |`)
    }
    if (result.items.length > 200) lines.push(`\n… only the first 200 of ${result.items.length} objects are shown`)
    if (result.truncated === true) lines.push(`\n… only the first ${result.items.length} of ${result.totalItems} objects are shown`)
    return lines.join('\n')
  }
  const lines = [
    `${heading}Table: ${result.database !== undefined ? result.database + '.' : ''}${result.schema !== undefined ? result.schema + '.' : ''}${result.table}`,
    '',
    '| column | type | nullable | default | primary key | comment |',
    '| --- | --- | --- | --- | --- | --- |',
  ]
  for (const item of result.items) {
    lines.push(`| ${item.name} | ${item.type} | ${item.nullable ? 'yes' : 'no'} | ${item.defaultValue ?? ''} | ${item.primaryKey ? 'yes' : ''} | ${item.comment ?? ''} |`)
  }
  return lines.join('\n')
}

/** Render one query result. */
function renderQuery(result) {
  const meta = `${result.connection.name} · ${result.readOnly ? 'read-only transaction' : 'read-write'}${result.database !== null && result.database !== undefined ? ` · ${result.database}` : ''}`
  const timing = `${result.durationMs} ms`
  if (result.columns.length === 0) {
    const affected = result.affectedRows !== undefined ? `affected rows: ${result.affectedRows}` : 'statement completed'
    return `${affected}\n${meta} · ${timing}`
  }
  const table = renderResultTable(result.columns, result.rows)
  const notes = [`${result.rowCount} row(s) · ${timing}`]
  if (result.truncated === true) notes.push(`truncated: showing ${result.rowCount} of ${result.totalRows ?? 'more'} rows`)
  if (result.warning !== undefined) notes.push(result.warning)
  return `${table}\n\n${notes.join(' · ')}\n${meta}`
}

/** The connection-list tool. */
export function dbListTool(engine) {
  return defineTool({
    name: 'db_list',
    description: 'List configured database connections (name, type, host, database, read-only mode). Use db_search to find a table by name, db_schema to inspect structure, and db_query to run SQL. Connections are configured by the user in the GUI; agents cannot create or edit them.',
    parameters: {
      query: { type: 'string', description: 'Optional fuzzy match against name, host, type, or default database.' },
    },
    output: {
      ...TEXT_OUTPUT,
      render: (_args, value) => text(value.text),
    },
    isConcurrencySafe: () => true,
    async execute(args) {
      return { text: renderConnections(engine.list(args.query)) }
    },
  })
}

/** The table-name search tool. */
export function dbSearchTool(engine) {
  return defineTool({
    name: 'db_search',
    description: 'Search table and view names across every database (MySQL) or non-system schema (PostgreSQL) on a connection; substring match, up to 200 hits. Use it when you know part of a table name, then call db_schema with the exact database/schema and table to inspect columns.',
    parameters: {
      connection: { type: 'string', required: true, description: 'Connection name or id from db_list.' },
      query: { type: 'string', required: true, description: 'Substring to match against table/view names.' },
    },
    output: {
      ...TEXT_OUTPUT,
      render: (_args, value) => text(value.text),
    },
    async execute(args) {
      try {
        const result = await engine.search({ id: args.connection, query: args.query })
        const tables = result.tables ?? []
        if (tables.length === 0) return { text: `No tables or views matching "${args.query}".` }
        const lines = [
          '| database/schema | table | type |',
          '| --- | --- | --- |',
        ]
        for (const table of tables) {
          lines.push(`| ${table.database ?? table.schema ?? ''} | ${table.name} | ${table.type} |`)
        }
        if (tables.length >= 200) lines.push('\n… only the first 200 matches are shown')
        return { text: lines.join('\n') }
      } catch (error) {
        return { text: `db_search failed: ${error instanceof Error ? error.message : String(error)}` }
      }
    },
  })
}

/** The schema-browsing tool. */
export function dbSchemaTool(engine) {
  return defineTool({
    name: 'db_schema',
    description: 'Browse a database connection as a tree, one level per call: omit database/schema to list databases (MySQL) or schemas (PostgreSQL); pass database (MySQL) or schema (PostgreSQL) to list its tables/views; also pass table to list its columns with types, nullability, defaults and primary-key flags.',
    parameters: {
      connection: { type: 'string', required: true, description: 'Connection name or id from db_list.' },
      database: { type: 'string', description: 'MySQL database name (omit to list databases).' },
      schema: { type: 'string', description: 'PostgreSQL schema name (omit to list schemas).' },
      table: { type: 'string', description: 'Table or view name; requires database (MySQL) or schema (PostgreSQL).' },
      query: { type: 'string', description: 'Optional substring filter for the listed names.' },
    },
    output: {
      ...TEXT_OUTPUT,
      render: (_args, value) => text(value.text),
    },
    async execute(args) {
      try {
        const result = await engine.tree({
          id: args.connection,
          database: args.database,
          schema: args.schema,
          table: args.table,
          query: args.query,
        })
        return { text: renderSchema(result) }
      } catch (error) {
        return { text: `db_schema failed: ${error instanceof Error ? error.message : String(error)}` }
      }
    },
  })
}

/** The SQL-execution tool. */
export function dbQueryTool(engine) {
  return defineTool({
    name: 'db_query',
    description: 'Execute ONE SQL statement on a configured database connection and return the rows as a table. Read-only connections run the statement inside a database-enforced read-only transaction, so writes fail with a database error; only the user can turn read-only off in the GUI. Use db_schema first to learn real table and column names. Results are capped (default 500 rows, max 5000).',
    parameters: {
      connection: { type: 'string', required: true, description: 'Connection name or id from db_list.' },
      sql: { type: 'string', required: true, description: 'One SQL statement. No parameter binding: inline literals carefully.' },
      database: { type: 'string', description: 'MySQL database to run in (defaults to the connection database).' },
      schema: { type: 'string', description: 'PostgreSQL search_path schema (defaults to the server default).' },
      maxRows: { type: 'integer', description: 'Row cap (default 500, max 5000).' },
      timeoutMs: { type: 'integer', description: 'Statement timeout in milliseconds (default 30000, max 120000).' },
    },
    output: {
      ...TEXT_OUTPUT,
      render: (_args, value) => text(value.text),
    },
    async execute(args) {
      const hint = classifySql(args.sql)
      try {
        const result = await engine.query({
          id: args.connection,
          sql: args.sql,
          database: args.database,
          schema: args.schema,
          maxRows: args.maxRows,
          timeoutMs: args.timeoutMs,
        })
        return { text: renderQuery(result) }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const extra = hint.write
          ? '\nHint: this statement looks like a write. The connection may be read-only; the user can disable read-only for the connection in the GUI.'
          : ''
        return { text: `db_query failed: ${message}${extra}` }
      }
    },
  })
}
