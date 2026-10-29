/**
 * dsh-db — browser half. Runs inside the DSH web GUI's module loader.
 *
 * Registers the sidebar entry ("数据库") and the center-column page: a
 * connection manager, a lazy tree over databases/schemas → tables/views →
 * columns, and a SQL console with a result grid. DOM mounting failures are
 * logged, never thrown: the web shell fails the whole boot when a plugin apply
 * throws, and an external plugin must not take the GUI down.
 *
 * This file is hand-written in the loader format (`window.__ModuleLoader__`)
 * on purpose: the plugin has no build step, so the shipped file is the source.
 */
window.__ModuleLoader__.load({
	id: 'dsh-db',
	factory: (require) => {
		const module = { exports: {} }
		const exports = module.exports
		Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
		const React = require('react')
		const { useCallback, useEffect, useMemo, useRef, useState } = React
		const h = React.createElement

		// ---------------------------------------------------------------- api
		const DB_API = {
			connections: '/api/dsh-db/connections',
			test: '/api/dsh-db/test',
			tree: '/api/dsh-db/tree',
			catalog: '/api/dsh-db/catalog',
			search: '/api/dsh-db/search',
			disconnect: '/api/dsh-db/disconnect',
			query: '/api/dsh-db/query',
		}

		/** Parse one fetch response into JSON or an actionable error. */
		async function readResponse(response) {
			let body = null
			try {
				body = await response.json()
			} catch { /* non-JSON error body */ }
			if (!response.ok) {
				const message = body !== null && typeof body === 'object' && typeof body.error === 'string'
					? body.error
					: `HTTP ${response.status}`
				const error = new Error(message)
				error.status = response.status
				throw error
			}
			return body
		}

		/**
		 * Fetch JSON with a hard client-side deadline. A half-open pooled DB
		 * socket inside the host must not leave the panel on "loading" forever.
		 * @param {string} url - same-origin route.
		 * @param {RequestInit} init - fetch init.
		 * @param {number} timeoutMs - deadline in milliseconds.
		 */
		async function requestJson(url, init, timeoutMs) {
			const controller = new AbortController()
			const timer = window.setTimeout(() => controller.abort(), timeoutMs)
			try {
				const response = await fetch(url, { ...init, signal: controller.signal })
				return await readResponse(response)
			} catch (error) {
				if (error !== null && typeof error === 'object' && (error.name === 'AbortError' || error.code === 20)) {
					throw new Error('请求超时（' + Math.round(timeoutMs / 1000) + ' 秒），请重试')
				}
				throw error
			} finally {
				window.clearTimeout(timer)
			}
		}

		/** Small control-plane calls; metadata allows for the host's retry. */
		const CONNECTION_TIMEOUT_MS = 20_000
		const METADATA_TIMEOUT_MS = 40_000
		const QUERY_TIMEOUT_MS = 130_000

		/** Browser-side API client (same origin, plain fetch). */
		const api = {
			async listConnections(query) {
				const search = typeof query === 'string' && query !== '' ? '?query=' + encodeURIComponent(query) : ''
				const body = await requestJson(DB_API.connections + search, {}, CONNECTION_TIMEOUT_MS)
				return body.connections
			},
			async createConnection(payload) {
				const body = await requestJson(DB_API.connections, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify(payload),
				}, CONNECTION_TIMEOUT_MS)
				return body.connection
			},
			async updateConnection(id, payload) {
				const body = await requestJson(DB_API.connections + '?id=' + encodeURIComponent(id), {
					method: 'PATCH',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify(payload),
				}, CONNECTION_TIMEOUT_MS)
				return body.connection
			},
			async deleteConnection(id) {
				await requestJson(DB_API.connections + '?id=' + encodeURIComponent(id), { method: 'DELETE' }, CONNECTION_TIMEOUT_MS)
			},
			async test(target) {
				const body = await requestJson(DB_API.test, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify(target),
				}, METADATA_TIMEOUT_MS)
				return body.result
			},
			async tree(node) {
				const body = await requestJson(DB_API.tree, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify(node),
				}, METADATA_TIMEOUT_MS)
				return body.result
			},
			async catalog(node) {
				const body = await requestJson(DB_API.catalog, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify(node),
				}, METADATA_TIMEOUT_MS)
				return body.result
			},
			async search(node) {
				const body = await requestJson(DB_API.search, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify(node),
				}, METADATA_TIMEOUT_MS)
				return body.result
			},
			async disconnect(id) {
				await requestJson(DB_API.disconnect, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ id }),
				}, CONNECTION_TIMEOUT_MS)
			},
			async query(payload) {
				const body = await requestJson(DB_API.query, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify(payload),
				}, QUERY_TIMEOUT_MS)
				return body.result
			},
		}

		// ---------------------------------------------------------------- i18n
		const ZH = {
			'entry.label': '数据库',
			'entry.tooltip': '数据库连接与 SQL 控制台',
			'panel.title': '数据库',
			'panel.back': '返回会话',
			'conn.new': '新建连接',
			'conn.title': '连接',
			'conn.empty': '还没有数据库连接',
			'conn.emptyHint': '添加一个 MySQL/MariaDB 或 PostgreSQL 连接，即可浏览库表结构并执行 SQL。',
			'conn.search': '搜索连接…',
			'conn.edit': '编辑',
			'conn.delete': '删除',
			'conn.disconnect': '断开连接',
			'conn.disconnected': '已断开连接（下次查询会自动重连）',
			'conn.deleteConfirm': '确定删除连接「{name}」？此操作不会影响数据库本身。',
			'conn.test': '测试连接',
			'conn.testing': '测试中…',
			'conn.save': '保存',
			'conn.saving': '保存中…',
			'conn.cancel': '取消',
			'conn.name': '名称',
			'conn.type': '类型',
			'conn.host': '主机',
			'conn.port': '端口',
			'conn.user': '用户名',
			'conn.password': '密码',
			'conn.passwordKeep': '留空则保持原密码',
			'conn.database': '默认数据库',
			'conn.databaseHint': 'MySQL 可留空；PostgreSQL 留空时使用用户名同名库',
			'conn.ssl': 'TLS',
			'conn.ssl.disable': '关闭',
			'conn.ssl.require': '加密（不校验证书）',
			'conn.ssl.verify': '加密并校验证书',
			'conn.readOnly': '只读连接',
			'conn.readOnlyHint': '开启后，GUI 与 Agent 的 SQL 都在数据库强制的只读事务中执行，写操作会被拒绝。',
			'conn.description': '备注',
			'conn.testOk': '连接成功 · {version} · {ms} ms',
			'conn.created': '连接已创建',
			'conn.updated': '连接已保存',
			'conn.deleted': '连接已删除',
			'conn.required': '请填写名称、主机和用户名',
			'dialog.new': '新建数据库连接',
			'dialog.edit': '编辑数据库连接',
			'tree.title': '结构',
			'tree.search': '搜索表名…',
			'tree.searching': '搜索中…',
			'tree.searchEmpty': '没有匹配的表',
			'tree.searchScope': '搜索范围',
			'tree.scopeCurrent': '当前库',
			'tree.scopeAll': '全部库',
			'tree.loading': '加载中…',
			'tree.empty': '没有可显示的库或模式',
			'tree.emptyTables': '没有表或视图',
			'tree.emptyColumns': '没有字段',
			'tree.retry': '重试',
			'tree.system': '系统',
			'tree.truncated': '仅显示前 {count} 项',
			'editor.placeholder': '在此输入 SQL，Ctrl+Enter 执行…',
			'editor.run': '执行',
			'editor.running': '执行中…',
			'editor.clear': '清空',
			'editor.suggest': '提示',
			'editor.hint': 'Ctrl+Enter 执行 · Ctrl+Space 补全',
			'editor.scope': '作用域',
			'suggest.empty': '没有匹配的表或字段',
			'agent.copy': '复制给 Agent',
			'agent.copied': '查询指令已复制，粘贴到会话发送即可',
			'agent.failed': '复制失败，请手动选择 SQL',
			'common.copied': '已复制',
			'menu.refresh': '刷新',
			'menu.refreshColumns': '刷新字段',
			'menu.structure': '查看表结构',
			'menu.preview': '预览前 100 行',
			'menu.copyName': '复制名称',
			'menu.copyQualified': '复制全限定名',
			'menu.askAgent': '复制给 Agent',
			'menu.insert': '插入到编辑器',
			'menu.copyType': '复制「字段 类型」',
			'structure.title': '表结构',
			'structure.column': '字段',
			'structure.type': '类型',
			'structure.nullable': '可空',
			'structure.default': '默认值',
			'structure.primaryKey': '主键',
			'structure.extra': '额外',
			'structure.comment': '注释',
			'structure.loading': '加载字段中…',
			'structure.empty': '没有字段信息',
			'structure.preview': '预览数据',
			'structure.askAgent': '复制给 Agent',
			'result.placeholder': '执行 SQL 后，结果会显示在这里',
			'result.rows': '{count} 行',
			'result.affected': '影响 {count} 行',
			'result.duration': '{ms} ms',
			'result.truncated': '已截断，仅显示前 {count} 行',
			'result.copy': '复制',
			'result.copied': '已复制',
			'readonly.badge': '只读',
			'readwrite.badge': '可写',
			'common.refresh': '刷新',
			'common.close': '关闭',
			'common.loading': '加载中…',
			'error.noConnection': '请先选择一个连接',
			'error.title': '出错',
			'error.dismiss': '知道了',
		}

		const EN = {
			'entry.label': 'Database',
			'entry.tooltip': 'Database connections and SQL console',
			'panel.title': 'Databases',
			'panel.back': 'Back to conversation',
			'conn.new': 'New connection',
			'conn.title': 'Connections',
			'conn.empty': 'No database connections yet',
			'conn.emptyHint': 'Add a MySQL/MariaDB or PostgreSQL connection to browse schemas and run SQL.',
			'conn.search': 'Search connections…',
			'conn.edit': 'Edit',
			'conn.delete': 'Delete',
			'conn.disconnect': 'Disconnect',
			'conn.disconnected': 'Disconnected (the next query reconnects)',
			'conn.deleteConfirm': 'Delete connection "{name}"? This does not touch the database itself.',
			'conn.test': 'Test',
			'conn.testing': 'Testing…',
			'conn.save': 'Save',
			'conn.saving': 'Saving…',
			'conn.cancel': 'Cancel',
			'conn.name': 'Name',
			'conn.type': 'Type',
			'conn.host': 'Host',
			'conn.port': 'Port',
			'conn.user': 'User',
			'conn.password': 'Password',
			'conn.passwordKeep': 'Leave blank to keep the stored password',
			'conn.database': 'Default database',
			'conn.databaseHint': 'Optional for MySQL; PostgreSQL falls back to a database named after the user',
			'conn.ssl': 'TLS',
			'conn.ssl.disable': 'Off',
			'conn.ssl.require': 'Encrypted (no certificate check)',
			'conn.ssl.verify': 'Encrypted and verified',
			'conn.readOnly': 'Read-only connection',
			'conn.readOnlyHint': 'When enabled, GUI and agent SQL run in a database-enforced read-only transaction; writes are rejected.',
			'conn.description': 'Description',
			'conn.testOk': 'Connected · {version} · {ms} ms',
			'conn.created': 'Connection created',
			'conn.updated': 'Connection saved',
			'conn.deleted': 'Connection deleted',
			'conn.required': 'Name, host and user are required',
			'dialog.new': 'New database connection',
			'dialog.edit': 'Edit database connection',
			'tree.title': 'Structure',
			'tree.search': 'Search tables…',
			'tree.searching': 'Searching…',
			'tree.searchEmpty': 'No matching tables',
			'tree.searchScope': 'Search scope',
			'tree.scopeCurrent': 'This DB',
			'tree.scopeAll': 'All DBs',
			'tree.loading': 'Loading…',
			'tree.empty': 'No databases or schemas',
			'tree.emptyTables': 'No tables or views',
			'tree.emptyColumns': 'No columns',
			'tree.retry': 'Retry',
			'tree.system': 'system',
			'tree.truncated': 'Showing the first {count} items',
			'editor.placeholder': 'Type SQL here, Ctrl+Enter to run…',
			'editor.run': 'Run',
			'editor.running': 'Running…',
			'editor.clear': 'Clear',
			'editor.suggest': 'Suggest',
			'editor.hint': 'Ctrl+Enter to run · Ctrl+Space to complete',
			'editor.scope': 'Scope',
			'suggest.empty': 'No matching tables or columns',
			'agent.copy': 'Ask agent',
			'agent.copied': 'Query prompt copied — paste it into the chat',
			'agent.failed': 'Copy failed; select the SQL manually',
			'common.copied': 'Copied',
			'menu.refresh': 'Refresh',
			'menu.refreshColumns': 'Refresh columns',
			'menu.structure': 'View structure',
			'menu.preview': 'Preview first 100 rows',
			'menu.copyName': 'Copy name',
			'menu.copyQualified': 'Copy qualified name',
			'menu.askAgent': 'Ask agent',
			'menu.insert': 'Insert into editor',
			'menu.copyType': 'Copy "column type"',
			'structure.title': 'Table structure',
			'structure.column': 'Column',
			'structure.type': 'Type',
			'structure.nullable': 'Nullable',
			'structure.default': 'Default',
			'structure.primaryKey': 'PK',
			'structure.extra': 'Extra',
			'structure.comment': 'Comment',
			'structure.loading': 'Loading columns…',
			'structure.empty': 'No column information',
			'structure.preview': 'Preview data',
			'structure.askAgent': 'Ask agent',
			'result.placeholder': 'Run SQL to see results here',
			'result.rows': '{count} rows',
			'result.affected': '{count} rows affected',
			'result.duration': '{ms} ms',
			'result.truncated': 'Truncated to the first {count} rows',
			'result.copy': 'Copy',
			'result.copied': 'Copied',
			'readonly.badge': 'read-only',
			'readwrite.badge': 'read-write',
			'common.refresh': 'Refresh',
			'common.close': 'Close',
			'common.loading': 'Loading…',
			'error.noConnection': 'Select a connection first',
			'error.title': 'Error',
			'error.dismiss': 'Dismiss',
		}

		const LANG = (() => {
			try {
				const value = (navigator.languages && navigator.languages[0]) || navigator.language || 'zh'
				return String(value).toLowerCase().startsWith('en') ? 'en' : 'zh'
			} catch {
				return 'zh'
			}
		})()
		const DICT = LANG === 'en' ? EN : ZH

		/** Translate one key, interpolating `{name}` placeholders. */
		function t(key, vars) {
			let value = DICT[key] !== undefined ? DICT[key] : (ZH[key] !== undefined ? ZH[key] : key)
			if (vars !== undefined) {
				for (const name of Object.keys(vars)) value = value.split('{' + name + '}').join(String(vars[name]))
			}
			return value
		}

		// --------------------------------------------------------------- styles
		const STYLE_ID = 'dsh-db-styles'
		const CSS = `
.dshdb-root{flex:1 1 auto;height:100%;min-height:0;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#1f2328);font-family:var(--dsw-font-family,system-ui,-apple-system,"Segoe UI",sans-serif);font-size:13px;--dshdb-border:var(--dsw-alias-border-l1,#e6e8eb);--dshdb-border-strong:var(--dsw-alias-border-l2,#d0d7de);--dshdb-secondary:var(--dsw-alias-label-secondary,#57606a);--dshdb-tertiary:var(--dsw-alias-label-tertiary,#8b949e);--dshdb-hover:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.09));--dshdb-accent:var(--dsw-alias-state-business-primary,#3b82f6);--dshdb-danger:var(--dsw-alias-state-error-primary,#d1242f);--dshdb-success:var(--dsw-alias-state-success-primary,#1a7f37);--dshdb-mono:var(--dsw-font-family-code,ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace);}
.dshdb-root *{box-sizing:border-box;}
.dshdb-header{display:flex;align-items:center;gap:10px;padding:10px 16px;border-bottom:1px solid var(--dshdb-border);flex:none;}
.dshdb-title{margin:0;font-size:16px;font-weight:700;white-space:nowrap;}
.dshdb-spacer{flex:1;}
.dshdb-btn{display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 11px;border:1px solid var(--dshdb-border-strong);border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary,#1f2328);font-size:12px;font-family:inherit;cursor:pointer;white-space:nowrap;}
.dshdb-btn:hover{background:var(--dshdb-hover);}
.dshdb-btn:disabled{opacity:.5;cursor:default;}
.dshdb-btn.primary{background:var(--dsw-alias-button-info-fill,#2563eb);border-color:transparent;color:var(--dsw-alias-label-primary-foreground,#fff);}
.dshdb-btn.primary:hover{background:var(--dsw-alias-button-info-hover,#1d4ed8);}
.dshdb-btn.danger{color:var(--dshdb-danger);border-color:color-mix(in srgb,var(--dshdb-danger) 45%,transparent);}
.dshdb-btn.ghost{border-color:transparent;color:var(--dshdb-secondary);}
.dshdb-btn.ghost:hover{color:var(--dsw-alias-label-primary,#1f2328);}
.dshdb-btn.small{height:24px;padding:0 8px;font-size:11px;}
.dshdb-icon-btn{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;padding:0;border:none;border-radius:6px;background:transparent;color:var(--dshdb-secondary);cursor:pointer;}
.dshdb-icon-btn:hover{background:var(--dshdb-hover);color:var(--dsw-alias-label-primary,#1f2328);}
.dshdb-body{flex:1;display:flex;min-height:0;}
.dshdb-left{width:308px;min-width:220px;max-width:46%;display:flex;flex-direction:column;min-height:0;border-right:1px solid var(--dshdb-border);}
.dshdb-conns{flex:none;max-height:46%;overflow:auto;padding:8px;border-bottom:1px solid var(--dshdb-border);}
.dshdb-conns-head{display:flex;align-items:center;gap:8px;padding:0 2px 6px;}
.dshdb-conns-title{font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--dshdb-tertiary);flex:none;}
.dshdb-input{height:30px;padding:0 9px;border:1px solid var(--dshdb-border-strong);border-radius:8px;background:var(--dsw-specific-input-major,#fff);color:var(--dsw-alias-label-primary,#1f2328);font-size:12px;font-family:inherit;outline:none;min-width:0;text-transform:none;letter-spacing:normal;}
.dshdb-input:focus{border-color:var(--dshdb-accent);}
.dshdb-input.compact{height:26px;font-size:11px;flex:1;}
.dshdb-conn{display:flex;align-items:center;gap:8px;padding:7px 8px;border-radius:8px;cursor:pointer;position:relative;}
.dshdb-conn:hover{background:var(--dshdb-hover);}
.dshdb-conn[data-active]{background:var(--dshdb-hover);}
.dshdb-conn[data-active]:before{content:"";position:absolute;left:0;top:8px;bottom:8px;width:2px;border-radius:2px;background:var(--dshdb-accent);}
.dshdb-conn-icon{display:flex;color:var(--dshdb-accent);flex:none;}
.dshdb-conn-body{min-width:0;flex:1;}
.dshdb-conn-name{font-weight:600;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.dshdb-conn-meta{font-size:11px;color:var(--dshdb-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.dshdb-conn-actions{display:flex;gap:1px;opacity:0;transition:opacity .12s;flex:none;}
.dshdb-conn:hover .dshdb-conn-actions,.dshdb-conn:focus-within .dshdb-conn-actions{opacity:1;}
.dshdb-badge{display:inline-flex;align-items:center;height:16px;padding:0 5px;border:1px solid var(--dshdb-border-strong);border-radius:999px;font-size:10px;line-height:1;color:var(--dshdb-secondary);}
.dshdb-badge.mysql{color:#0b7285;border-color:rgba(11,114,133,.45);}
.dshdb-badge.postgres{color:#3b5bdb;border-color:rgba(59,91,219,.45);}
.dshdb-badge.ro{color:var(--dshdb-success);border-color:color-mix(in srgb,var(--dshdb-success) 45%,transparent);}
.dshdb-badge.rw{color:#b45309;border-color:rgba(180,83,9,.45);}
.dshdb-tree{flex:1;min-height:0;overflow:auto;padding:6px 6px 18px;}
.dshdb-tree-head{display:flex;align-items:center;gap:6px;padding:4px 6px 6px;font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--dshdb-tertiary);}
.dshdb-tree-head .dshdb-input{flex:1;min-width:70px;margin-left:6px;text-transform:none;letter-spacing:normal;}
.dshdb-scope-btn{flex:none;height:26px;padding:0 7px;border:1px solid var(--dshdb-border-strong);border-radius:7px;background:transparent;color:var(--dshdb-secondary);font-family:inherit;font-size:10px;cursor:pointer;white-space:nowrap;text-transform:none;letter-spacing:normal;}
.dshdb-scope-btn:hover{background:var(--dshdb-hover);}
.dshdb-node{display:flex;align-items:center;gap:5px;width:100%;padding:4px 6px;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary,#1f2328);font-family:inherit;font-size:12px;text-align:left;cursor:pointer;min-height:24px;}
.dshdb-node:hover{background:var(--dshdb-hover);}
.dshdb-node[data-active]{background:var(--dshdb-hover);}
.dshdb-chev{display:inline-flex;align-items:center;justify-content:center;width:12px;height:12px;color:var(--dshdb-tertiary);transition:transform .12s;flex:none;}
.dshdb-chev[data-open]{transform:rotate(90deg);}
.dshdb-node-icon{display:inline-flex;align-items:center;color:var(--dshdb-tertiary);flex:none;}
.dshdb-node-icon.db{color:#0b7285;}
.dshdb-node-icon.schema{color:#b45309;}
.dshdb-node-icon.table{color:#3b5bdb;}
.dshdb-node-icon.view{color:#7c3aed;}
.dshdb-node-icon.column{color:var(--dshdb-tertiary);}
.dshdb-node-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;}
.dshdb-node-meta{margin-left:auto;padding-left:8px;font-size:10px;color:var(--dshdb-tertiary);white-space:nowrap;flex:none;}
.dshdb-node-meta.pk{color:#b45309;font-weight:600;}
.dshdb-tree-status{padding:6px 8px 6px 26px;font-size:11px;color:var(--dshdb-tertiary);}
.dshdb-tree-error{margin:4px 8px 4px 26px;padding:6px 8px;border-radius:6px;font-size:11px;color:var(--dshdb-danger);background:color-mix(in srgb,var(--dshdb-danger) 8%,transparent);}
.dshdb-main{flex:1;display:flex;flex-direction:column;min-width:0;min-height:0;}
.dshdb-toolbar{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--dshdb-border);flex:none;min-height:42px;}
.dshdb-scope{font-size:12px;color:var(--dshdb-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.dshdb-scope b{color:var(--dsw-alias-label-primary,#1f2328);font-weight:600;}
.dshdb-editor-wrap{position:relative;padding:10px 12px 0;flex:none;}
.dshdb-editor{display:block;width:100%;height:176px;min-height:90px;max-height:60vh;resize:vertical;padding:10px 12px;border:1px solid var(--dshdb-border-strong);border-radius:10px;background:var(--dsw-specific-input-major,#fff);color:var(--dsw-alias-label-primary,#1f2328);font-family:var(--dshdb-mono);font-size:12.5px;line-height:1.55;outline:none;tab-size:2;}
.dshdb-editor:focus{border-color:var(--dshdb-accent);}
.dshdb-editor::placeholder{color:var(--dshdb-tertiary);}
.dshdb-suggest{position:absolute;z-index:30;width:min(320px,calc(100% - 24px));max-height:236px;overflow:auto;padding:4px;border:1px solid var(--dshdb-border-strong);border-radius:9px;background:var(--dsw-alias-bg-base,#fff);box-shadow:var(--dsw-shadow-lv3,0 18px 48px rgba(15,23,42,.24));}
.dshdb-suggest-item{display:flex;align-items:center;gap:7px;padding:4px 7px;border-radius:6px;cursor:pointer;font-size:12px;white-space:nowrap;color:var(--dsw-alias-label-primary,#1f2328);}
.dshdb-suggest-item[data-active]{background:var(--dshdb-hover);}
.dshdb-suggest-kind{flex:none;min-width:34px;font-size:9px;letter-spacing:.04em;color:var(--dshdb-tertiary);}
.dshdb-suggest-label{overflow:hidden;text-overflow:ellipsis;font-family:var(--dshdb-mono);}
.dshdb-suggest-detail{margin-left:auto;padding-left:10px;font-size:10px;color:var(--dshdb-tertiary);overflow:hidden;text-overflow:ellipsis;}
.dshdb-suggest-empty{padding:6px 8px;font-size:11px;color:var(--dshdb-tertiary);}
.dshdb-result-head{display:flex;align-items:center;gap:10px;padding:8px 12px;flex:none;font-size:11px;color:var(--dshdb-tertiary);min-height:30px;}
.dshdb-result-head b{color:var(--dshdb-secondary);font-weight:600;}
.dshdb-error{margin:0 12px 8px;padding:8px 10px;border:1px solid color-mix(in srgb,var(--dshdb-danger) 40%,transparent);border-radius:8px;background:color-mix(in srgb,var(--dshdb-danger) 7%,transparent);color:var(--dshdb-danger);font-size:12px;white-space:pre-wrap;word-break:break-word;}
.dshdb-result{flex:1;min-height:0;overflow:auto;margin:0 12px 12px;border:1px solid var(--dshdb-border);border-radius:10px;background:var(--dsw-alias-bg-base,#fff);}
.dshdb-table{border-collapse:separate;border-spacing:0;min-width:100%;font-size:12px;}
.dshdb-table th{position:sticky;top:0;z-index:1;padding:6px 10px;text-align:left;white-space:nowrap;background:var(--dsw-alias-bg-layer-2,#f6f8fa);border-bottom:1px solid var(--dshdb-border);font-weight:600;color:var(--dshdb-secondary);}
.dshdb-table th .type{display:block;font-weight:400;font-size:9.5px;color:var(--dshdb-tertiary);margin-top:1px;}
.dshdb-table td{padding:5px 10px;border-bottom:1px solid var(--dshdb-border);font-family:var(--dshdb-mono);font-size:11.5px;white-space:pre;max-width:420px;overflow:hidden;text-overflow:ellipsis;vertical-align:top;}
.dshdb-table tbody tr:last-child td{border-bottom:none;}
.dshdb-table tbody tr:hover td{background:var(--dshdb-hover);}
.dshdb-null{color:var(--dshdb-tertiary);font-style:italic;}
.dshdb-empty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:36px 24px;text-align:center;color:var(--dshdb-tertiary);}
.dshdb-empty-icon{color:var(--dshdb-tertiary);opacity:.55;}
.dshdb-empty-title{font-size:14px;font-weight:600;color:var(--dshdb-secondary);}
.dshdb-empty-hint{font-size:12px;max-width:380px;line-height:1.6;}
.dshdb-overlay{position:fixed;inset:0;z-index:1200;display:flex;align-items:center;justify-content:center;padding:16px;background:var(--dsw-alias-bg-mask-1,rgba(15,23,42,.38));}
.dshdb-dialog{width:min(580px,100%);max-height:min(92vh,760px);overflow:auto;padding:18px 20px;border:1px solid var(--dshdb-border-strong);border-radius:14px;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#1f2328);box-shadow:var(--dsw-shadow-lv3,0 18px 48px rgba(15,23,42,.24));}
.dshdb-dialog-title{margin:0 0 14px;font-size:15px;font-weight:700;}
.dshdb-form{display:grid;grid-template-columns:1fr 1fr;gap:10px 12px;}
.dshdb-field{display:flex;flex-direction:column;gap:4px;min-width:0;}
.dshdb-field.full{grid-column:1/-1;}
.dshdb-field label{font-size:11px;color:var(--dshdb-secondary);}
.dshdb-field input[type=number]{font-family:var(--dshdb-mono);}
.dshdb-check{display:flex;align-items:flex-start;gap:8px;cursor:pointer;}
.dshdb-check input{margin:2px 0 0;flex:none;accent-color:var(--dshdb-accent);}
.dshdb-check-text{display:flex;flex-direction:column;gap:2px;}
.dshdb-hint{font-size:10.5px;line-height:1.5;color:var(--dshdb-tertiary);}
.dshdb-test{margin-top:10px;padding:7px 10px;border-radius:8px;font-size:11.5px;word-break:break-word;}
.dshdb-test.ok{color:var(--dshdb-success);background:color-mix(in srgb,var(--dshdb-success) 8%,transparent);}
.dshdb-test.fail{color:var(--dshdb-danger);background:color-mix(in srgb,var(--dshdb-danger) 8%,transparent);}
.dshdb-dialog-error{margin-top:10px;color:var(--dshdb-danger);font-size:11.5px;}
.dshdb-dialog-actions{display:flex;align-items:center;gap:8px;margin-top:16px;}
.dshdb-dialog.wide{width:min(860px,100%);}
.dshdb-structure{max-height:min(58vh,520px);overflow:auto;margin-top:10px;border:1px solid var(--dshdb-border);border-radius:9px;}
.dshdb-structure .dshdb-table{font-size:11.5px;}
.dshdb-menu{position:fixed;z-index:1500;min-width:196px;max-width:280px;padding:4px;border:1px solid var(--dshdb-border-strong);border-radius:9px;background:var(--dsw-alias-bg-base,#fff);box-shadow:var(--dsw-shadow-lv3,0 18px 48px rgba(15,23,42,.24));}
.dshdb-menu-title{padding:4px 9px 6px;font-size:10px;letter-spacing:.04em;text-transform:uppercase;color:var(--dshdb-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.dshdb-menu-item{display:flex;align-items:center;gap:8px;width:100%;padding:6px 9px;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary,#1f2328);font-family:inherit;font-size:12px;text-align:left;cursor:pointer;white-space:nowrap;}
.dshdb-menu-item:hover{background:var(--dshdb-hover);}
.dshdb-menu-item.danger{color:var(--dshdb-danger);}
.dshdb-menu-sep{height:1px;margin:4px 6px;background:var(--dshdb-border);}
.dshdb-spin{animation:dshdb-spin 1s linear infinite;}
@keyframes dshdb-spin{to{transform:rotate(360deg)}}
.dshdb-toast{position:absolute;right:14px;top:56px;z-index:3;padding:7px 11px;border-radius:8px;background:var(--dsw-alias-bg-layer-2,#f6f8fa);border:1px solid var(--dshdb-border-strong);box-shadow:var(--dsw-shadow-lv2,0 6px 18px rgba(15,23,42,.12));font-size:11.5px;color:var(--dshdb-secondary);}
@media (max-width:860px){.dshdb-left{width:250px;}.dshdb-scope{display:none;}}
`

		/**
		 * Inject the panel stylesheet, replacing any copy from an earlier plugin
		 * version. Replacing matters on hot reload: the module updates while the
		 * old `<style>` element survives, which would leave newly added rules
		 * (context menu, scope toggle) unstyled until a full page reload.
		 */
		function ensureStyles() {
			const existing = document.getElementById(STYLE_ID)
			if (existing !== null) existing.remove()
			const style = document.createElement('style')
			style.id = STYLE_ID
			style.textContent = CSS
			document.head.appendChild(style)
			return style
		}

		// ---------------------------------------------------------------- utils
		const PANEL_ID = 'db'
		/** Stable empty list so memo dependencies do not churn. */
		const EMPTY_TABLES = []

		/** Display label for a connection type. */
		function typeLabel(type) {
			return type === 'postgres' ? 'PostgreSQL' : 'MySQL'
		}

		/** Default port for a connection type. */
		function defaultPort(type) {
			return type === 'postgres' ? 5432 : 3306
		}

		/** Quote one identifier for the target database. */
		function quoteIdent(type, name) {
			const text = String(name)
			if (type === 'mysql') return '`' + text.split('`').join('``') + '`'
			return '"' + text.split('"').join('""') + '"'
		}

		/** Build a qualified table reference for a preview query. */
		function qualifyTable(type, database, schema, table) {
			if (type === 'mysql') {
				return database !== undefined && database !== ''
					? quoteIdent(type, database) + '.' + quoteIdent(type, table)
					: quoteIdent(type, table)
			}
			return schema !== undefined && schema !== ''
				? quoteIdent(type, schema) + '.' + quoteIdent(type, table)
				: quoteIdent(type, table)
		}

		/** Stable tree-node identity. */
		function treeKey(node) {
			return JSON.stringify({
				id: node.id,
				database: node.database !== undefined ? node.database : null,
				schema: node.schema !== undefined ? node.schema : null,
				table: node.table !== undefined ? node.table : null,
			})
		}

		/** Read one localStorage value without throwing. */
		function readStorage(key) {
			try {
				return window.localStorage.getItem(key)
			} catch {
				return null
			}
		}

		/** Write one localStorage value without throwing. */
		function writeStorage(key, value) {
			try {
				window.localStorage.setItem(key, value)
			} catch { /* storage unavailable */ }
		}

		/** Shrink a long cell for the grid. */
		function cellText(value) {
			if (value === null || value === undefined) return null
			return String(value)
		}

		/** Current scope caption. */
		function scopeCaption(connection, current) {
			if (connection === null) return ''
			if (connection.type === 'mysql') {
				const database = current.database !== undefined ? current.database : connection.database
				return database !== undefined && database !== '' ? database : '—'
			}
			return current.schema !== undefined && current.schema !== '' ? current.schema : (connection.database ?? 'public')
		}

		// ---------------------------------------------------------- sql suggest
		/** Keyword completions offered by the editor (uppercase, insert text). */
		const SQL_KEYWORDS = [
			'SELECT', 'FROM', 'WHERE', 'JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN', 'FULL JOIN', 'CROSS JOIN',
			'GROUP BY', 'ORDER BY', 'HAVING', 'LIMIT', 'OFFSET', 'DISTINCT', 'AS', 'ON', 'AND', 'OR', 'NOT',
			'NULL', 'IS NULL', 'IS NOT NULL', 'IN', 'BETWEEN', 'LIKE', 'EXISTS',
			'COUNT(*)', 'COUNT(', 'SUM(', 'AVG(', 'MIN(', 'MAX(', 'COALESCE(', 'CAST(',
			'INSERT INTO', 'UPDATE', 'DELETE FROM', 'SET', 'VALUES', 'CREATE TABLE', 'ALTER TABLE', 'DROP TABLE',
			'UNION', 'UNION ALL', 'EXPLAIN', 'SHOW TABLES', 'DESCRIBE', 'ASC', 'DESC', 'WITH',
			'CASE WHEN', 'THEN', 'ELSE', 'END', 'CURRENT_TIMESTAMP',
		]

		/** Insert text for one keyword (no trailing space after an opening paren). */
		function keywordInsert(keyword) {
			return keyword.endsWith('(') ? keyword : keyword + ' '
		}

		/** Quote an identifier for insertion only when it needs quoting. */
		function identifierInsert(type, name) {
			const text = String(name)
			const plain = /^[A-Za-z_][A-Za-z0-9_$]*$/.test(text)
			const reserved = SQL_KEYWORDS.some(keyword => keyword.replace(/\($/, '').toUpperCase() === text.toUpperCase())
			return plain && !reserved ? text : quoteIdent(type, text)
		}

		/** Short badge text for one completion kind. */
		function suggestionKindLabel(kind) {
			if (kind === 'keyword') return 'KW'
			if (kind === 'database') return 'DB'
			if (kind === 'schema') return 'SCHEMA'
			if (kind === 'table') return 'TABLE'
			if (kind === 'column') return 'COL'
			return String(kind).toUpperCase()
		}

		/**
		 * Whether the caret sits inside a string literal or a comment, where
		 * completions would be noise. Coarse by design; the editor is not a parser.
		 * @param {string} text - text before the caret.
		 */
		function insideStringOrComment(text) {
			let single = false
			let lineComment = false
			let blockComment = false
			for (let index = 0; index < text.length; index += 1) {
				const ch = text[index]
				const next = text[index + 1]
				if (lineComment) {
					if (ch === '\n') lineComment = false
					continue
				}
				if (blockComment) {
					if (ch === '*' && next === '/') { blockComment = false; index += 1 }
					continue
				}
				if (single) {
					if (ch === '\\') { index += 1; continue }
					if (ch === "'") {
						if (next === "'") { index += 1; continue }
						single = false
					}
					continue
				}
				if ((ch === '-' && next === '-') || ch === '#') { lineComment = true; if (ch === '-') index += 1; continue }
				if (ch === '/' && next === '*') { blockComment = true; index += 1; continue }
				if (ch === "'") { single = true; continue }
			}
			return single || lineComment || blockComment
		}

		/**
		 * Caret pixel position relative to the editor's wrapper, using a hidden
		 * mirror div with the textarea's exact typography.
		 * @param {HTMLTextAreaElement} editor - source textarea.
		 * @returns {{left:number, top:number}} wrapper-relative point below the caret.
		 */
		function caretPoint(editor) {
			const wrap = editor.parentElement
			if (wrap === null) return { left: 12, top: 32 }
			const style = window.getComputedStyle(editor)
			const mirror = document.createElement('div')
			const copied = [
				'boxSizing', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
				'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
				'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing', 'lineHeight',
				'textTransform', 'textIndent', 'tabSize',
			]
			for (const name of copied) mirror.style[name] = style[name]
			mirror.style.position = 'absolute'
			mirror.style.visibility = 'hidden'
			mirror.style.top = '0'
			mirror.style.left = '0'
			mirror.style.width = editor.offsetWidth + 'px'
			mirror.style.height = 'auto'
			mirror.style.overflow = 'hidden'
			mirror.style.whiteSpace = 'pre-wrap'
			mirror.style.wordWrap = 'break-word'
			mirror.textContent = editor.value.slice(0, editor.selectionStart)
			const marker = document.createElement('span')
			marker.textContent = '\u200b'
			mirror.appendChild(marker)
			wrap.appendChild(mirror)
			const markerLeft = marker.offsetLeft
			const markerTop = marker.offsetTop
			mirror.remove()
			const wrapRect = wrap.getBoundingClientRect()
			const editorRect = editor.getBoundingClientRect()
			const lineHeight = parseFloat(style.lineHeight) || 18
			const left = Math.min(
				Math.max(4, editorRect.left - wrapRect.left + markerLeft - editor.scrollLeft),
				Math.max(4, wrap.clientWidth - 328),
			)
			const top = editorRect.top - wrapRect.top + markerTop - editor.scrollTop + lineHeight + 4
			return { left, top }
		}

		// ---------------------------------------------------------------- icons
		function DatabaseIcon({ size }) {
			return h('svg', { viewBox: '0 0 16 16', width: size, height: size, fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' },
				h('ellipse', { cx: 8, cy: 3.4, rx: 5.1, ry: 2.1 }),
				h('path', { d: 'M2.9 3.4v3.1c0 1.16 2.28 2.1 5.1 2.1s5.1-.94 5.1-2.1V3.4' }),
				h('path', { d: 'M2.9 6.5v3.1c0 1.16 2.28 2.1 5.1 2.1s5.1-.94 5.1-2.1V6.5' }),
				h('path', { d: 'M2.9 9.6v3c0 1.16 2.28 2.1 5.1 2.1s5.1-.94 5.1-2.1v-3' }))
		}

		function ChevronIcon({ open }) {
			return h('svg', { viewBox: '0 0 12 12', width: 10, height: 10, fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true', className: 'dshdb-chev', 'data-open': open ? '' : undefined },
				h('path', { d: 'M4.5 2.5L8 6l-3.5 3.5' }))
		}

		function SchemaIcon({ size }) {
			return h('svg', { viewBox: '0 0 16 16', width: size, height: size, fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' },
				h('path', { d: 'M1.9 4.2c0-.6.5-1.1 1.1-1.1h3l1.4 1.6h5.6c.6 0 1.1.5 1.1 1.1v6.1c0 .6-.5 1.1-1.1 1.1H3c-.6 0-1.1-.5-1.1-1.1V4.2z' }))
		}

		function TableIcon({ size }) {
			return h('svg', { viewBox: '0 0 16 16', width: size, height: size, fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' },
				h('rect', { x: 2.2, y: 2.8, width: 11.6, height: 10.4, rx: 1.2 }),
				h('path', { d: 'M2.2 5.9h11.6M6.3 5.9v7.3' }))
		}

		function ViewIcon({ size }) {
			return h('svg', { viewBox: '0 0 16 16', width: size, height: size, fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' },
				h('path', { d: 'M1.6 8s2.4-4 6.4-4 6.4 4 6.4 4-2.4 4-6.4 4-6.4-4-6.4-4z' }),
				h('circle', { cx: 8, cy: 8, r: 1.8 }))
		}

		function ColumnIcon({ size }) {
			return h('svg', { viewBox: '0 0 16 16', width: size, height: size, fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' },
				h('path', { d: 'M3.5 4.5h9M3.5 8h9M3.5 11.5h5.5' }))
		}

		function PlusIcon() {
			return h('svg', { viewBox: '0 0 16 16', width: 13, height: 13, fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', 'aria-hidden': 'true' }, h('path', { d: 'M8 3v10M3 8h10' }))
		}

		function RefreshIcon() {
			return h('svg', { viewBox: '0 0 16 16', width: 13, height: 13, fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' },
				h('path', { d: 'M13.2 8a5.2 5.2 0 1 1-1.6-3.8' }),
				h('path', { d: 'M13.2 2.6v3.2H10' }))
		}

		function PencilIcon() {
			return h('svg', { viewBox: '0 0 16 16', width: 12, height: 12, fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' },
				h('path', { d: 'M11.1 2.4l2.5 2.5-8 8-3.1.6.6-3.1 8-8z' }))
		}

		function TrashIcon() {
			return h('svg', { viewBox: '0 0 16 16', width: 12, height: 12, fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' },
				h('path', { d: 'M2.6 4.4h10.8M6.1 4.4V3.1h3.8v1.3M4.1 4.4l.7 8.5h6.4l.7-8.5' }))
		}

		function PowerIcon() {
			return h('svg', { viewBox: '0 0 16 16', width: 12, height: 12, fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' },
				h('path', { d: 'M8 2.4v5' }),
				h('path', { d: 'M4.4 4.3a5.2 5.2 0 1 0 7.2 0' }))
		}

		function PlayIcon() {
			return h('svg', { viewBox: '0 0 16 16', width: 12, height: 12, fill: 'currentColor', 'aria-hidden': 'true' }, h('path', { d: 'M4.5 2.8v10.4L13 8z' }))
		}

		function SpinnerIcon() {
			return h('svg', { viewBox: '0 0 16 16', width: 12, height: 12, fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', 'aria-hidden': 'true', className: 'dshdb-spin' },
				h('path', { d: 'M8 2.2a5.8 5.8 0 1 1-5.3 3.4' }))
		}

		/** The sidebar glyph the shell asks for. */
		function DbPanelIcon({ size }) {
			return h('svg', { viewBox: '0 0 16 16', width: size, height: size, fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true', 'data-dsh-panel-entry': PANEL_ID },
				h('ellipse', { cx: 8, cy: 3.4, rx: 5.1, ry: 2.1 }),
				h('path', { d: 'M2.9 3.4v3.1c0 1.16 2.28 2.1 5.1 2.1s5.1-.94 5.1-2.1V3.4' }),
				h('path', { d: 'M2.9 6.5v3.1c0 1.16 2.28 2.1 5.1 2.1s5.1-.94 5.1-2.1V6.5' }),
				h('path', { d: 'M2.9 9.6v3c0 1.16 2.28 2.1 5.1 2.1s5.1-.94 5.1-2.1v-3' }))
		}

		// ------------------------------------------------------------ connection
		function blankConnection() {
			return {
				name: '',
				type: 'mysql',
				host: '127.0.0.1',
				port: 3306,
				user: 'root',
				password: '',
				database: '',
				ssl: 'disable',
				readOnly: true,
				description: '',
			}
		}

		/** Create/edit dialog. */
		function ConnectionDialog({ initial, onClose, onSaved }) {
			const editing = initial !== null && initial !== undefined
			const [form, setForm] = useState(() => {
				if (!editing) return blankConnection()
				return {
					name: initial.name,
					type: initial.type,
					host: initial.host,
					port: initial.port,
					user: initial.user,
					password: '',
					database: initial.database ?? '',
					ssl: initial.ssl ?? 'disable',
					readOnly: initial.readOnly !== false,
					description: initial.description ?? '',
				}
			})
			const [saving, setSaving] = useState(false)
			const [testing, setTesting] = useState(false)
			const [testResult, setTestResult] = useState(null)
			const [formError, setFormError] = useState('')

			/** Update one form field. */
			function set(key, value) {
				setForm(previous => ({ ...previous, [key]: value }))
			}

			/** Swap the port when the type changes away from a default. */
			function setType(type) {
				setForm(previous => {
					const wasDefault = Number(previous.port) === 3306 || Number(previous.port) === 5432 || previous.port === ''
					return { ...previous, type, port: wasDefault ? defaultPort(type) : previous.port }
				})
			}

			useEffect(() => {
				const onKeyDown = event => {
					if (event.key === 'Escape' && !saving) onClose()
				}
				window.addEventListener('keydown', onKeyDown)
				return () => window.removeEventListener('keydown', onKeyDown)
			}, [onClose, saving])

			/** Validate and save. */
			async function save() {
				if (form.name.trim() === '' || form.host.trim() === '' || form.user.trim() === '') {
					setFormError(t('conn.required'))
					return
				}
				setSaving(true)
				setFormError('')
				try {
					const payload = {
						name: form.name.trim(),
						type: form.type,
						host: form.host.trim(),
						port: Number(form.port),
						user: form.user.trim(),
						password: form.password,
						database: form.database.trim(),
						ssl: form.ssl,
						readOnly: form.readOnly,
						description: form.description.trim(),
					}
					if (editing && form.password === '') delete payload.password
					const connection = editing
						? await api.updateConnection(initial.id, payload)
						: await api.createConnection(payload)
					onSaved(connection)
				} catch (error) {
					setFormError(error instanceof Error ? error.message : String(error))
				} finally {
					setSaving(false)
				}
			}

			/** Test the current form values without saving. */
			async function test() {
				setTesting(true)
				setTestResult(null)
				setFormError('')
				try {
					const draft = { ...form, port: Number(form.port) }
					const result = await api.test({ draft, baseId: editing ? initial.id : undefined })
					setTestResult({ ok: true, text: t('conn.testOk', { version: result.version ?? '', ms: result.latencyMs ?? 0 }) })
				} catch (error) {
					setTestResult({ ok: false, text: error instanceof Error ? error.message : String(error) })
				} finally {
					setTesting(false)
				}
			}

			return h('div', { className: 'dshdb-overlay', onMouseDown: event => { if (event.target === event.currentTarget && !saving) onClose() } },
				h('div', { className: 'dshdb-dialog', role: 'dialog', 'aria-modal': 'true', onMouseDown: event => event.stopPropagation() },
					h('h3', { className: 'dshdb-dialog-title' }, editing ? t('dialog.edit') : t('dialog.new')),
					h('div', { className: 'dshdb-form' },
						h('div', { className: 'dshdb-field' },
							h('label', null, t('conn.name')),
							h('input', { className: 'dshdb-input', value: form.name, autoFocus: true, onChange: event => set('name', event.target.value), placeholder: 'local-mysql' })),
						h('div', { className: 'dshdb-field' },
							h('label', null, t('conn.type')),
							h('select', { className: 'dshdb-input', value: form.type, onChange: event => setType(event.target.value) },
								h('option', { value: 'mysql' }, 'MySQL / MariaDB'),
								h('option', { value: 'postgres' }, 'PostgreSQL'))),
						h('div', { className: 'dshdb-field' },
							h('label', null, t('conn.host')),
							h('input', { className: 'dshdb-input', value: form.host, onChange: event => set('host', event.target.value), placeholder: '127.0.0.1' })),
						h('div', { className: 'dshdb-field' },
							h('label', null, t('conn.port')),
							h('input', { className: 'dshdb-input', type: 'number', min: 1, max: 65535, value: form.port, onChange: event => set('port', event.target.value) })),
						h('div', { className: 'dshdb-field' },
							h('label', null, t('conn.user')),
							h('input', { className: 'dshdb-input', value: form.user, onChange: event => set('user', event.target.value), autoComplete: 'off' })),
						h('div', { className: 'dshdb-field' },
							h('label', null, t('conn.password')),
							h('input', { className: 'dshdb-input', type: 'password', value: form.password, onChange: event => set('password', event.target.value), placeholder: editing ? t('conn.passwordKeep') : '', autoComplete: 'new-password' })),
						h('div', { className: 'dshdb-field' },
							h('label', null, t('conn.database')),
							h('input', { className: 'dshdb-input', value: form.database, onChange: event => set('database', event.target.value), placeholder: form.type === 'postgres' ? 'postgres' : 'app' })),
						h('div', { className: 'dshdb-field' },
							h('label', null, t('conn.ssl')),
							h('select', { className: 'dshdb-input', value: form.ssl, onChange: event => set('ssl', event.target.value) },
								h('option', { value: 'disable' }, t('conn.ssl.disable')),
								h('option', { value: 'require' }, t('conn.ssl.require')),
								h('option', { value: 'verify' }, t('conn.ssl.verify')))),
						h('div', { className: 'dshdb-field full' },
							h('label', { className: 'dshdb-check' },
								h('input', { type: 'checkbox', checked: form.readOnly, onChange: event => set('readOnly', event.target.checked) }),
								h('span', { className: 'dshdb-check-text' },
									h('span', null, t('conn.readOnly')),
									h('span', { className: 'dshdb-hint' }, t('conn.readOnlyHint'))))),
						h('div', { className: 'dshdb-field full' },
							h('label', null, t('conn.description')),
							h('input', { className: 'dshdb-input', value: form.description, onChange: event => set('description', event.target.value) })))
					,
					testResult !== null && h('div', { className: 'dshdb-test ' + (testResult.ok ? 'ok' : 'fail') }, testResult.text),
					formError !== '' && h('div', { className: 'dshdb-dialog-error' }, formError),
					h('div', { className: 'dshdb-dialog-actions' },
						h('button', { type: 'button', className: 'dshdb-btn', onClick: test, disabled: testing || saving }, testing ? t('conn.testing') : t('conn.test')),
						h('span', { className: 'dshdb-spacer' }),
						h('button', { type: 'button', className: 'dshdb-btn ghost', onClick: onClose, disabled: saving }, t('conn.cancel')),
						h('button', { type: 'button', className: 'dshdb-btn primary', onClick: save, disabled: saving || testing }, saving ? t('conn.saving') : t('conn.save'))))
			)
		}

		// ----------------------------------------------------------------- tree
		/** One tree row (database, schema, table/view). */
		function TreeNode({ node, kind, item, depth, open, active, onClick, onDoubleClick, onContextMenu }) {
			const label = item.name
			let meta = ''
			if (kind === 'database' && item.system === true) meta = t('tree.system')
			if (kind === 'table') {
				const bits = []
				if (item.type === 'view') bits.push(LANG === 'en' ? 'view' : '视图')
				else if (item.type === 'materialized view') bits.push(LANG === 'en' ? 'mat view' : '物化视图')
				if (typeof item.rowCount === 'number') bits.push('~' + item.rowCount)
				meta = bits.join(' · ')
			}
			const icon = kind === 'database'
				? h(DatabaseIcon, { size: 12 })
				: kind === 'schema'
					? h(SchemaIcon, { size: 12 })
					: item.type === 'view' || item.type === 'materialized view'
						? h(ViewIcon, { size: 12 })
						: h(TableIcon, { size: 12 })
			const iconClass = kind === 'database' ? 'db' : kind === 'schema' ? 'schema' : (item.type === 'view' || item.type === 'materialized view') ? 'view' : 'table'
			const doubleClickHint = LANG === 'en' ? 'Double-click to preview 100 rows' : '双击预览 100 行'
			const title = (item.comment !== undefined && item.comment !== '' ? item.comment + '\n' : '') + label
				+ (kind === 'table' ? '\n' + doubleClickHint : '')
			return h('button', {
				type: 'button',
				className: 'dshdb-node',
				title,
				'data-active': active ? '' : undefined,
				style: { paddingLeft: 6 + depth * 14 },
				onClick,
				onDoubleClick,
				onContextMenu,
			},
				h(ChevronIcon, { open }),
				h('span', { className: 'dshdb-node-icon ' + iconClass }, icon),
				h('span', { className: 'dshdb-node-label' }, label),
				meta !== '' && h('span', { className: 'dshdb-node-meta' }, meta))
		}

		/** One column row. */
		function ColumnNode({ column, depth, active, onClick, onContextMenu }) {
			return h('button', {
				type: 'button',
				className: 'dshdb-node',
				title: (column.comment !== undefined ? column.comment + '\n' : '') + column.name + ' · ' + column.type,
				'data-active': active ? '' : undefined,
				style: { paddingLeft: 6 + depth * 14 + 12 },
				onClick,
				onContextMenu,
			},
				h('span', { className: 'dshdb-node-icon column' }, h(ColumnIcon, { size: 11 })),
				h('span', { className: 'dshdb-node-label' }, column.name),
				column.primaryKey === true && h('span', { className: 'dshdb-node-meta pk' }, 'PK'),
				h('span', { className: 'dshdb-node-meta', style: column.primaryKey === true ? { paddingLeft: 4 } : undefined }, column.type))
		}

		// ----------------------------------------------------------------- page
		/** The database panel page. */
		function DbPage({ onClose }) {
			const [connections, setConnections] = useState([])
			const [loading, setLoading] = useState(true)
			const [selectedId, setSelectedId] = useState(() => readStorage('dsh-db:selected') ?? '')
			const [filter, setFilter] = useState('')
			const [error, setError] = useState('')
			const [dialog, setDialog] = useState(null)
			const [structure, setStructure] = useState(null)
			const [contextMenu, setContextMenu] = useState(null)
			const [toast, setToast] = useState('')
			const [tree, setTree] = useState({})
			const [expanded, setExpanded] = useState({})
			const [activeKey, setActiveKey] = useState('')
			const [current, setCurrent] = useState({})
			const [sql, setSql] = useState('')
			const [result, setResult] = useState(null)
			const [queryError, setQueryError] = useState('')
			const [running, setRunning] = useState(false)
			const [catalog, setCatalog] = useState({ key: '', tables: [], loadingKey: '' })
			const [suggest, setSuggest] = useState(null)
			const [tableSearch, setTableSearch] = useState('')
			const [searchResults, setSearchResults] = useState(null)
			const [searching, setSearching] = useState(false)
			const [searchAll, setSearchAll] = useState(false)
			const editorRef = useRef(null)
			const treeRef = useRef(tree)
			treeRef.current = tree
			const catalogRef = useRef(catalog)
			catalogRef.current = catalog
			const suggestRef = useRef(suggest)
			suggestRef.current = suggest
			const searchTimerRef = useRef(0)
			const searchSeqRef = useRef(0)

			const selected = useMemo(
				() => connections.find(connection => connection.id === selectedId) ?? null,
				[connections, selectedId],
			)
			const filtered = useMemo(() => {
				const text = filter.trim().toLowerCase()
				if (text === '') return connections
				return connections.filter(connection =>
					connection.name.toLowerCase().includes(text)
					|| connection.host.toLowerCase().includes(text)
					|| (connection.database ?? '').toLowerCase().includes(text)
					|| connection.type.includes(text))
			}, [connections, filter])

			/** Scope autocomplete is relative to: the clicked scope, else the connection default. */
			const effectiveScope = useMemo(() => {
				if (selected === null) return { database: undefined, schema: undefined }
				if (selected.type === 'mysql') return { database: current.database ?? selected.database, schema: undefined }
				return { database: undefined, schema: current.schema }
			}, [selected, current])
			const scopeKey = (selected?.id ?? '') + '|' + (effectiveScope.database ?? '') + '|' + (effectiveScope.schema ?? '')
			const scopeCatalog = useMemo(
				() => (catalog.key === scopeKey ? catalog.tables : EMPTY_TABLES),
				[catalog, scopeKey],
			)

			/** Merge the lazily loaded tree with the bulk catalog for completions. */
			const suggestionData = useMemo(() => {
				const scopes = []
				const tables = []
				const tableKeys = new Set()
				const columnsByTable = new Map()
				const addScope = (name, kind) => {
					const text = String(name)
					if (scopes.some(scope => scope.kind === kind && scope.name.toLowerCase() === text.toLowerCase())) return
					scopes.push({ name: text, kind })
				}
				const addTable = (table) => {
					const key = `${table.database ?? ''}|${table.schema ?? ''}|${table.name}`.toLowerCase()
					if (tableKeys.has(key)) return
					tableKeys.add(key)
					tables.push({
						name: String(table.name),
						type: table.type,
						database: table.database,
						schema: table.schema,
						key,
					})
				}
				const setColumns = (node, columns) => {
					columnsByTable.set(
						`${node.database ?? ''}|${node.schema ?? ''}|${node.table}`.toLowerCase(),
						Array.isArray(columns) ? columns : [],
					)
				}
				for (const [key, entry] of Object.entries(tree)) {
					if (entry === undefined || entry.status !== 'loaded') continue
					let node
					try { node = JSON.parse(key) } catch { continue }
					if (node === null || typeof node !== 'object') continue
					if (entry.level === 'databases') {
						for (const item of entry.items) addScope(item.name, 'database')
					} else if (entry.level === 'schemas') {
						for (const item of entry.items) addScope(item.name, 'schema')
					} else if (entry.level === 'tables') {
						for (const item of entry.items) addTable({ ...item, database: node.database, schema: node.schema })
					} else if (entry.level === 'columns') {
						setColumns(node, entry.items)
					}
				}
				for (const table of scopeCatalog) {
					addTable({ name: table.name, database: effectiveScope.database, schema: effectiveScope.schema })
					setColumns({ database: effectiveScope.database, schema: effectiveScope.schema, table: table.name }, table.columns)
				}
				return { scopes, tables, columnsByTable }
			}, [tree, scopeCatalog, effectiveScope])

			/** Tables belonging to the current scope (all known tables before a scope is picked). */
			const scopeTables = useMemo(() => {
				if (effectiveScope.database === undefined && effectiveScope.schema === undefined) return suggestionData.tables
				return suggestionData.tables.filter(table => selected !== null && selected.type === 'mysql'
					? (table.database ?? '') === effectiveScope.database
					: (table.schema ?? '') === effectiveScope.schema)
			}, [suggestionData, effectiveScope, selected])

			/** Every known column, deduped by name, for contexts where no table is known. */
			const allColumns = useMemo(() => {
				const seen = new Map()
				for (const columns of suggestionData.columnsByTable.values()) {
					for (const column of columns) if (!seen.has(column.name)) seen.set(column.name, column)
				}
				return [...seen.values()]
			}, [suggestionData])

			/** Reload the connection list. */
			const refreshConnections = useCallback(async () => {
				setLoading(true)
				try {
					const rows = await api.listConnections()
					setConnections(rows)
					setError('')
				} catch (loadError) {
					setError(loadError instanceof Error ? loadError.message : String(loadError))
				} finally {
					setLoading(false)
				}
			}, [])

			useEffect(() => {
				void refreshConnections()
			}, [refreshConnections])

			// Keep the selection valid as the list changes.
			useEffect(() => {
				if (connections.length === 0) {
					if (selectedId !== '') setSelectedId('')
					return
				}
				if (!connections.some(connection => connection.id === selectedId)) {
					setSelectedId(connections[0].id)
				}
			}, [connections, selectedId])

			/** Reload the connection list and the selected connection's tree. */
			const refreshAll = useCallback(async () => {
				await refreshConnections()
				if (selectedId !== '') {
					setTree({})
					setExpanded({})
					setActiveKey('')
					await loadNode({ id: selectedId }, true)
				}
			}, [refreshConnections, selectedId])

			/** Load one tree node (idempotent unless forced). */
			async function loadNode(node, force) {
				const key = treeKey(node)
				const existing = treeRef.current[key]
				if (!force && existing !== undefined && (existing.status === 'loading' || existing.status === 'loaded')) return
				setTree(previous => ({ ...previous, [key]: { status: 'loading', items: [], level: '' } }))
				try {
					const data = await api.tree(node)
					setTree(previous => ({
						...previous,
						[key]: {
							status: 'loaded',
							items: data.items,
							level: data.level,
							truncated: data.truncated === true,
							totalItems: data.totalItems,
						},
					}))
				} catch (loadError) {
					setTree(previous => ({
						...previous,
						[key]: { status: 'error', items: [], error: loadError instanceof Error ? loadError.message : String(loadError) },
					}))
				}
			}

			// A new connection selection resets the tree and restores its draft.
			useEffect(() => {
				setTree({})
				setExpanded({})
				setActiveKey('')
				setCurrent({})
				setResult(null)
				setQueryError('')
				setError('')
				setCatalog({ key: '', tables: [], loadingKey: '' })
				setSuggest(null)
				window.clearTimeout(searchTimerRef.current)
				setTableSearch('')
				setSearchResults(null)
				setSearching(false)
				setSearchAll(false)
				if (selectedId === '') {
					setSql('')
					return
				}
				writeStorage('dsh-db:selected', selectedId)
				setSql(readStorage('dsh-db:draft:' + selectedId) ?? '')
				void loadNode({ id: selectedId }, true)
			}, [selectedId])

			// Prefetch the default database's table/column catalog for completions.
			useEffect(() => {
				if (selected !== null && selected.type === 'mysql' && selected.database !== undefined) {
					void loadCatalog({ database: selected.database })
				}
			}, [selected])

			// When the catalog or tree finishes loading while the popup is open,
			// refresh it in place so newly known tables/columns appear.
			useEffect(() => {
				if (suggestRef.current === null) return
				const editor = editorRef.current
				if (editor !== null) setSuggest(buildSuggestions(editor, true))
			}, [catalog, tree])

			// Auto-dismiss the small toast.
			useEffect(() => {
				if (toast === '') return undefined
				const timer = window.setTimeout(() => setToast(''), 1800)
				return () => window.clearTimeout(timer)
			}, [toast])

			// Dismiss the context menu on any outside interaction.
			useEffect(() => {
				if (contextMenu === null) return undefined
				const close = () => setContextMenu(null)
				const onKey = event => { if (event.key === 'Escape') close() }
				window.addEventListener('mousedown', close)
				window.addEventListener('keydown', onKey)
				window.addEventListener('resize', close)
				window.addEventListener('scroll', close, true)
				return () => {
					window.removeEventListener('mousedown', close)
					window.removeEventListener('keydown', onKey)
					window.removeEventListener('resize', close)
					window.removeEventListener('scroll', close, true)
				}
			}, [contextMenu])

			// Escape closes the table-structure dialog.
			useEffect(() => {
				if (structure === null) return undefined
				const onKey = event => { if (event.key === 'Escape') setStructure(null) }
				window.addEventListener('keydown', onKey)
				return () => window.removeEventListener('keydown', onKey)
			}, [structure])

			/** Toggle a tree node, loading it on first open. */
			function toggle(node) {
				const key = treeKey(node)
				setActiveKey(key)
				const open = expanded[key] === true
				setExpanded(previous => ({ ...previous, [key]: !open }))
				if (!open) void loadNode(node)
			}

			/** Select the query scope implied by a node and load its completion catalog. */
			function applyScope(node) {
				if (node.database !== undefined) {
					setCurrent({ database: node.database })
					void loadCatalog({ database: node.database })
					return
				}
				if (node.schema !== undefined) {
					setCurrent({ schema: node.schema })
					void loadCatalog({ schema: node.schema })
				}
			}

			/** Save the editor draft for the selected connection. */
			function updateSql(value) {
				setSql(value)
				if (selectedId !== '') writeStorage('dsh-db:draft:' + selectedId, value)
			}

			/** Load the bulk table/column catalog for one scope (idempotent per scope). */
			async function loadCatalog(scope) {
				if (selected === null) return
				const database = selected.type === 'mysql'
					? (scope !== undefined && scope.database !== undefined && scope.database !== '' ? scope.database : selected.database)
					: undefined
				const schema = selected.type === 'postgres'
					? (scope !== undefined && scope.schema !== undefined && scope.schema !== '' ? scope.schema : current.schema)
					: undefined
				if (selected.type === 'mysql' && (database === undefined || database === '')) return
				if (selected.type === 'postgres' && (schema === undefined || schema === '')) return
				const key = `${selected.id}|${database ?? ''}|${schema ?? ''}`
				if (catalogRef.current.key === key || catalogRef.current.loadingKey === key) return
				catalogRef.current = { ...catalogRef.current, loadingKey: key }
				setCatalog(previous => ({ ...previous, loadingKey: key }))
				try {
					const data = await api.catalog({ id: selected.id, database, schema })
					setCatalog({ key, tables: Array.isArray(data.tables) ? data.tables : [], loadingKey: '' })
				} catch {
					setCatalog({ key, tables: [], loadingKey: '' })
				}
			}

			/** Debounced table search, scoped to the current DB/schema unless "all" is on. */
			function onTableSearch(value, all) {
				const includeAll = all !== undefined ? all : searchAll
				setTableSearch(value)
				window.clearTimeout(searchTimerRef.current)
				const text = value.trim()
				if (text === '' || selected === null) {
					setSearchResults(null)
					setSearching(false)
					return
				}
				const scope = selected.type === 'mysql'
					? (includeAll || effectiveScope.database === undefined ? {} : { database: effectiveScope.database })
					: (includeAll || effectiveScope.schema === undefined ? {} : { schema: effectiveScope.schema })
				const seq = searchSeqRef.current + 1
				searchSeqRef.current = seq
				setSearchResults(null)
				setSearching(true)
				searchTimerRef.current = window.setTimeout(async () => {
					try {
						let tables
						try {
							const result = await api.search({ id: selected.id, query: text, ...scope })
							tables = Array.isArray(result.tables) ? result.tables : []
						} catch (error) {
							// An older host has no /search route (404). Degrade to the
							// existing /tree query filter, which is scoped to one DB/schema.
							if (error !== null && typeof error === 'object' && error.status === 404
								&& (scope.database !== undefined || scope.schema !== undefined)) {
								const tree = await api.tree({ id: selected.id, query: text, ...scope })
								tables = (Array.isArray(tree.items) ? tree.items : []).map(item => ({
									...scope,
									name: item.name,
									type: item.type,
								}))
							} else {
								throw error
							}
						}
						if (searchSeqRef.current !== seq) return
						setSearchResults(tables)
					} catch (error) {
						if (searchSeqRef.current !== seq) return
						setSearchResults([])
						setError(error instanceof Error ? error.message : String(error))
					} finally {
						if (searchSeqRef.current === seq) setSearching(false)
					}
				}, 250)
			}

			/** Jump from a search hit to its scope/table and preview it. */
			function openSearchResult(row) {
				if (selected === null) return
				const scope = selected.type === 'mysql'
					? { database: row.database !== undefined ? row.database : effectiveScope.database }
					: { schema: row.schema !== undefined ? row.schema : effectiveScope.schema }
				const scopeNode = { id: selected.id, ...scope }
				const tableNode = { ...scopeNode, table: row.name }
				setCurrent(scope)
				setExpanded(previous => ({ ...previous, [treeKey(scopeNode)]: true, [treeKey(tableNode)]: true }))
				void loadCatalog(scope)
				void loadNode(scopeNode)
				void loadNode(tableNode)
				setActiveKey(treeKey(tableNode))
				setTableSearch('')
				setSearchResults(null)
				setSearching(false)
				const target = qualifyTable(selected.type, scope.database, scope.schema, row.name)
				const text = 'SELECT * FROM ' + target + ' LIMIT 100;'
				updateSql(text)
				void run(text)
			}

			/** Close this connection's pooled sockets; the next query reconnects. */
			async function disconnectConnection(connection) {
				try {
					await api.disconnect(connection.id)
					if (selectedId === connection.id) {
						setCatalog({ key: '', tables: [], loadingKey: '' })
						setSearchResults(null)
					}
					setToast(t('conn.disconnected'))
				} catch (error) {
					setError(error instanceof Error ? error.message : String(error))
				}
			}

			/** Open a fixed-position context menu at the pointer. */
			function openContextMenu(event, title, items) {
				event.preventDefault()
				event.stopPropagation()
				const width = 240
				const height = 36 + items.length * 28
				setContextMenu({
					x: Math.max(8, Math.min(event.clientX, window.innerWidth - width - 8)),
					y: Math.max(8, Math.min(event.clientY, window.innerHeight - height - 8)),
					title,
					items,
				})
			}

			/** Copy text and show a toast; `message` overrides the default copy toast. */
			async function copyToClipboard(text, message) {
				const copied = await copyText(text)
				setToast(copied ? (message !== undefined ? message : t('common.copied')) : t('agent.failed'))
			}

			/** Prompt text for asking the agent about one specific table. */
			function buildTablePrompt(node, item) {
				if (selected === null) return ''
				const owner = selected.type === 'mysql' ? node.database : node.schema
				const qualified = qualifyTable(selected.type, node.database, node.schema, item.name)
				const call = ['connection="' + selected.name + '"']
				if (node.database !== undefined) call.push('database="' + node.database + '"')
				if (node.schema !== undefined) call.push('schema="' + node.schema + '"')
				if (LANG === 'en') {
					return [
						'Use the dsh-db plugin to inspect and query one table.',
						'Connection: ' + selected.name + ' (' + typeLabel(selected.type) + ')',
						'Table: ' + qualified + (owner !== undefined ? ' in ' + owner : ''),
						'First call db_schema with ' + call.join(', ') + ', table="' + item.name + '" to list its columns.',
						'Then call db_query with ' + call.join(', ') + ', sql="SELECT * FROM ' + qualified + ' LIMIT 100".',
						'Show the column list and the rows as tables; report any error verbatim.',
					].join('\n')
				}
				return [
					'请使用 dsh-db 插件查看并查询一张表。',
					'连接：' + selected.name + '（' + typeLabel(selected.type) + '）',
					'表：' + qualified + (owner !== undefined ? '（' + owner + '）' : ''),
					'先调用 db_schema（' + call.join('，') + '，table="' + item.name + '"）查看字段。',
					'再调用 db_query（' + call.join('，') + '，sql="SELECT * FROM ' + qualified + ' LIMIT 100"）。',
					'把字段列表和结果整理成表格；如果报错，原样返回。',
				].join('\n')
			}

			/** Open the detailed structure dialog for one table. */
			async function openStructure(node, item) {
				if (selected === null) return
				const tableNode = { id: selected.id, database: node.database, schema: node.schema, table: item.name }
				setContextMenu(null)
				applyScope(tableNode)
				setStructure({ node: tableNode, item, status: 'loading', columns: [], error: '' })
				const cached = treeRef.current[treeKey(tableNode)]
				if (cached !== undefined && cached.status === 'loaded') {
					setStructure({ node: tableNode, item, status: 'loaded', columns: cached.items, error: '' })
					return
				}
				try {
					const data = await api.tree({
						id: selected.id,
						database: tableNode.database,
						schema: tableNode.schema,
						table: item.name,
					})
					if (data.level !== 'columns') throw new Error('unexpected tree level: ' + data.level)
					setStructure({ node: tableNode, item, status: 'loaded', columns: data.items, error: '' })
				} catch (error) {
					setStructure({ node: tableNode, item, status: 'error', columns: [], error: error instanceof Error ? error.message : String(error) })
				}
			}

			/** Context menu for a table/view node. */
			function openTableMenu(event, node, item) {
				if (selected === null) return
				const tableNode = { id: selected.id, database: node.database, schema: node.schema, table: item.name }
				applyScope(tableNode)
				setActiveKey(treeKey(tableNode))
				const qualified = qualifyTable(selected.type, tableNode.database, tableNode.schema, tableNode.table)
				openContextMenu(event, qualified, [
					{ label: t('menu.structure'), onSelect: () => { void openStructure(tableNode, item) } },
					{ label: t('menu.preview'), onSelect: () => { applyScope(tableNode); previewTable(tableNode) } },
					{ separator: true },
					{ label: t('menu.copyName'), onSelect: () => { void copyToClipboard(tableNode.table) } },
					{ label: t('menu.copyQualified'), onSelect: () => { void copyToClipboard(qualified) } },
					{ label: t('menu.askAgent'), onSelect: () => { void copyToClipboard(buildTablePrompt(tableNode, item), t('agent.copied')) } },
					{ separator: true },
					{ label: t('menu.refreshColumns'), onSelect: () => {
						setExpanded(previous => ({ ...previous, [treeKey(tableNode)]: true }))
						void loadNode(tableNode, true)
					} },
				])
			}

			/** Context menu for a table search hit (same actions as a tree table). */
			function openSearchResultMenu(event, row) {
				if (selected === null) return
				const node = selected.type === 'mysql'
					? { id: selected.id, database: row.database }
					: { id: selected.id, schema: row.schema }
				openTableMenu(event, node, { name: row.name, type: row.type })
			}

			/** Context menu for a database/schema node. */
			function openScopeMenu(event, node, item) {
				applyScope(node)
				openContextMenu(event, item.name, [
					{ label: t('menu.refresh'), onSelect: () => {
						setExpanded(previous => ({ ...previous, [treeKey(node)]: true }))
						void loadNode(node, true)
					} },
					{ label: t('menu.copyName'), onSelect: () => { void copyToClipboard(item.name) } },
				])
			}

			/** Context menu for a column row. */
			function openColumnMenu(event, column, tableNode) {
				if (selected === null) return
				openContextMenu(event, column.name, [
					{ label: t('menu.insert'), onSelect: () => insertColumn(column.name) },
					{ label: t('menu.copyName'), onSelect: () => { void copyToClipboard(column.name) } },
					{ label: t('menu.copyType'), onSelect: () => { void copyToClipboard(column.name + ' ' + column.type) } },
					{ separator: true },
					{ label: t('menu.structure'), onSelect: () => { void openStructure(tableNode, { name: tableNode.table }) } },
				])
			}

			/** Context menu for a connection row. */
			function openConnectionMenu(event, connection) {
				openContextMenu(event, connection.name, [
					{ label: t('conn.edit'), onSelect: () => editConnection(connection) },
					{ label: t('conn.disconnect'), onSelect: () => { void disconnectConnection(connection) } },
					{ separator: true },
					{ label: t('conn.delete'), danger: true, onSelect: () => { void deleteConnection(connection) } },
				])
			}

			/** Find a known table by (optionally qualified) name, current scope first. */
			function findTable(name) {
				if (selected === null) return null
				const parts = String(name).replace(/[`"\[\]]/g, '').split('.').filter(Boolean)
				const text = parts[parts.length - 1]
				if (text === undefined) return null
				const wanted = text.toLowerCase()
				if (parts.length >= 2) {
					const scopeName = parts[parts.length - 2].toLowerCase()
					const qualified = suggestionData.tables.find(table => table.name.toLowerCase() === wanted
						&& (selected.type === 'mysql'
							? (table.database ?? '').toLowerCase() === scopeName
							: (table.schema ?? '').toLowerCase() === scopeName))
					if (qualified !== undefined) return qualified
				}
				const inScope = suggestionData.tables.find(table => table.name.toLowerCase() === wanted
					&& (selected.type === 'mysql'
						? (table.database ?? '') === (effectiveScope.database ?? '')
						: (table.schema ?? '') === (effectiveScope.schema ?? '')))
				return inScope ?? suggestionData.tables.find(table => table.name.toLowerCase() === wanted) ?? null
			}

			/** Columns known for one table (tree expansion or bulk catalog). */
			function columnsFor(table) {
				if (table === null) return []
				return suggestionData.columnsByTable.get(table.key) ?? []
			}

			/** Find a known database/schema by name. */
			function findScope(name) {
				const wanted = String(name).replace(/[`"\[\]]/g, '').toLowerCase()
				return suggestionData.scopes.find(scope => scope.name.toLowerCase() === wanted) ?? null
			}

			/** Table names referenced by FROM/JOIN in the text before the caret. */
			function tablesInQuery(text) {
				const names = []
				const pattern = /\b(?:FROM|JOIN)\s+([A-Za-z0-9_$."`\[\]]+)/gi
				let match
				while ((match = pattern.exec(text)) !== null) {
					const parts = match[1].replace(/[`"\[\]]/g, '').split('.').filter(Boolean)
					const name = parts[parts.length - 1]
					if (name !== undefined && !names.includes(name)) names.push(name)
				}
				return names
			}

			/** FROM/JOIN aliases in the text before the caret (`users u`, `users AS u`). */
			function aliasesInQuery(text) {
				const aliases = new Map()
				const pattern = /\b(?:FROM|JOIN)\s+([A-Za-z0-9_$."`\[\]]+)(?:\s+(?:AS\s+)?([A-Za-z_][A-Za-z0-9_$]*))?/gi
				const stop = new Set(['WHERE', 'ON', 'GROUP', 'ORDER', 'LIMIT', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'FULL', 'CROSS', 'UNION', 'HAVING', 'SET', 'VALUES', 'AS'])
				let match
				while ((match = pattern.exec(text)) !== null) {
					const parts = match[1].replace(/[`"\[\]]/g, '').split('.').filter(Boolean)
					const table = parts[parts.length - 1]
					const alias = match[2]
					if (table === undefined || alias === undefined) continue
					if (stop.has(alias.toUpperCase())) continue
					aliases.set(alias.toLowerCase(), table)
				}
				return aliases
			}

			/**
			 * Build the completion list for the caret: keywords, tables, columns,
			 * or the members of a `scope.` / `table.` qualifier.
			 * @param {HTMLTextAreaElement} editor - editor owning the caret.
			 * @param {boolean} force - open even without a typed prefix (Ctrl+Space).
			 * @returns {null|{items:Array,index:number,start:number,end:number,left:number,top:number}} popup state.
			 */
			function buildSuggestions(editor, force) {
				if (selected === null) return null
				const before = editor.value.slice(0, editor.selectionStart)
				if (!force && insideStringOrComment(before)) return null
				const tokenMatch = /[A-Za-z0-9_$\u0080-\uFFFF.]+$/.exec(before)
				const token = tokenMatch === null ? '' : tokenMatch[0]
				const dot = token.lastIndexOf('.')
				const qualifier = dot >= 0 ? token.slice(0, dot).replace(/[`"\[\]]/g, '') : ''
				const prefix = dot >= 0 ? token.slice(dot + 1) : token
				const context = qualifier !== ''
					? 'qualified'
					: /\b(?:FROM|JOIN|UPDATE|INTO|TABLE)\s+[A-Za-z0-9_$."`\[\]]*$/i.test(before)
						? 'table'
						: /\b(?:SELECT|WHERE|HAVING|ON|AND|OR|SET|BY|VALUES)\s+[A-Za-z0-9_$."`\[\]]*$/i.test(before)
							? 'column'
							: 'any'
				if (!force && prefix === '' && qualifier === '' && context === 'any') return null
				const start = editor.selectionStart - prefix.length
				const end = editor.selectionStart
				// First keystroke in a scope also asks the host for the bulk
				// catalog, so table/column names arrive without expanding the tree.
				if (scopeCatalog.length === 0
					&& (effectiveScope.database !== undefined || effectiveScope.schema !== undefined)
					&& catalogRef.current.loadingKey !== scopeKey) {
					void loadCatalog(effectiveScope)
				}
				const items = []
				const seen = new Set()
				const push = (label, insert, kind, detail) => {
					const key = kind + '\u0000' + insert
					if (seen.has(key)) return
					seen.add(key)
					items.push({ label, insert, kind, detail: detail ?? '' })
				}
				const matches = label => prefix === '' || label.toLowerCase().startsWith(prefix.toLowerCase())
				if (context === 'qualified') {
					const aliases = aliasesInQuery(before)
					const table = findTable(aliases.get(qualifier.toLowerCase()) ?? qualifier)
					if (table !== null) {
						for (const column of columnsFor(table)) {
							if (!matches(column.name)) continue
							push(column.name, identifierInsert(selected.type, column.name), 'column',
								column.type + (column.primaryKey === true ? ' · PK' : ''))
						}
					} else {
						const scope = findScope(qualifier)
						if (scope !== null) {
							for (const table of suggestionData.tables) {
								const owner = selected.type === 'mysql' ? table.database : table.schema
								if ((owner ?? '').toLowerCase() !== scope.name.toLowerCase()) continue
								if (!matches(table.name)) continue
								push(table.name, identifierInsert(selected.type, table.name), 'table',
									table.type === 'view' ? 'view' : 'table')
							}
						}
					}
				} else if (context === 'table') {
					for (const table of scopeTables) {
						if (!matches(table.name)) continue
						push(table.name, identifierInsert(selected.type, table.name), 'table',
							table.type === 'view' ? 'view' : 'table')
					}
					for (const scope of suggestionData.scopes) {
						if (!matches(scope.name)) continue
						push(scope.name, scope.name + '.', scope.kind, scope.kind)
					}
				} else if (context === 'column') {
					const referenced = tablesInQuery(before)
					const columns = []
					for (const name of referenced) {
						const table = findTable(name)
						if (table !== null) columns.push(...columnsFor(table))
					}
					const pool = columns.length > 0 ? columns : allColumns
					for (const column of pool) {
						if (!matches(column.name)) continue
						push(column.name, identifierInsert(selected.type, column.name), 'column',
							column.type + (column.primaryKey === true ? ' · PK' : ''))
					}
					for (const keyword of ['AND', 'OR', 'AS', 'IN', 'LIKE', 'IS NULL', 'IS NOT NULL', 'BETWEEN', 'ORDER BY', 'GROUP BY', 'LIMIT', 'ASC', 'DESC']) {
						if (!matches(keyword)) continue
						push(keyword, keywordInsert(keyword), 'keyword', '')
					}
				} else {
					for (const keyword of SQL_KEYWORDS) {
						if (!matches(keyword)) continue
						push(keyword, keywordInsert(keyword), 'keyword', '')
					}
					for (const table of scopeTables) {
						if (!matches(table.name)) continue
						push(table.name, identifierInsert(selected.type, table.name), 'table',
							table.type === 'view' ? 'view' : 'table')
					}
					for (const scope of suggestionData.scopes) {
						if (!matches(scope.name)) continue
						push(scope.name, scope.name + '.', scope.kind, scope.kind)
					}
					for (const column of allColumns) {
						if (!matches(column.name)) continue
						push(column.name, identifierInsert(selected.type, column.name), 'column',
							column.type + (column.primaryKey === true ? ' · PK' : ''))
					}
				}
				const filtered = items
					.slice()
					.sort((left, right) => {
						const leftExact = prefix !== '' && left.label.toLowerCase() === prefix.toLowerCase() ? 0 : 1
						const rightExact = prefix !== '' && right.label.toLowerCase() === prefix.toLowerCase() ? 0 : 1
						if (leftExact !== rightExact) return leftExact - rightExact
						return left.label.length - right.label.length
					})
					.slice(0, 12)
				if (filtered.length === 0 && !force) return null
				const point = caretPoint(editor)
				return { items: filtered, index: 0, start, end, left: point.left, top: point.top }
			}

			/** Replace the current word with a completion and keep the caret after it. */
			function acceptSuggestion(item) {
				const editor = editorRef.current
				const currentSuggest = suggestRef.current
				if (editor === null || currentSuggest === null) return
				const chosen = item ?? currentSuggest.items[currentSuggest.index]
				if (chosen === undefined) return
				const next = editor.value.slice(0, currentSuggest.start) + chosen.insert + editor.value.slice(currentSuggest.end)
				updateSql(next)
				setSuggest(null)
				window.requestAnimationFrame(() => {
					try {
						editor.focus()
						const position = currentSuggest.start + chosen.insert.length
						editor.setSelectionRange(position, position)
						// Picking a database/schema appends a dot: immediately offer
						// that scope's tables.
						if (chosen.kind === 'database' || chosen.kind === 'schema') {
							window.setTimeout(() => {
								if (editorRef.current === editor) setSuggest(buildSuggestions(editor, true))
							}, 40)
						}
					} catch { /* editor gone */ }
				})
			}

			/** Open completions at the caret (toolbar button). */
			function openSuggestions() {
				const editor = editorRef.current
				if (editor === null) return
				editor.focus()
				setSuggest(buildSuggestions(editor, true))
			}

			/** Build a paste-ready instruction for the conversation's db_query tool. */
			function buildAgentPrompt() {
				if (selected === null) return ''
				const scope = effectiveScope
				const readOnlyNow = selected.readOnly !== false
				let statement = sql.trim()
				let active = null
				try { active = JSON.parse(activeKey) } catch { active = null }
				if (statement === '' && active !== null && active.table !== undefined) {
					const target = qualifyTable(
						selected.type,
						active.database !== undefined ? active.database : scope.database,
						active.schema !== undefined ? active.schema : scope.schema,
						active.table,
					)
					statement = 'SELECT * FROM ' + target + ' LIMIT 100;'
				}
				if (statement === '') {
					statement = selected.type === 'mysql'
						? 'SHOW TABLES;'
						: "SELECT table_schema, table_name FROM information_schema.tables\nWHERE table_schema NOT IN ('pg_catalog', 'information_schema')\nORDER BY 1, 2;"
				}
				const database = scope.database !== undefined ? scope.database : undefined
				const schema = scope.schema !== undefined ? scope.schema : undefined
				const call = ['connection="' + selected.name + '"']
				if (database !== undefined) call.push('database="' + database + '"')
				if (schema !== undefined) call.push('schema="' + schema + '"')
				if (LANG === 'en') {
					return [
						'Use the dsh-db plugin to query a database.',
						'Connection: ' + selected.name + ' (' + typeLabel(selected.type) + ', ' + (readOnlyNow ? 'read-only' : 'read-write') + ')',
						'Scope: ' + (database !== undefined ? database : (schema !== undefined ? schema : '-')),
						'SQL:',
						'```sql',
						statement,
						'```',
						'Call db_query with ' + call.join(', ') + '. Show the rows as a table and report any error verbatim.',
					].join('\n')
				}
				return [
					'请使用 dsh-db 插件查询数据库。',
					'连接：' + selected.name + '（' + typeLabel(selected.type) + '，' + (readOnlyNow ? '只读' : '可写') + '）',
					'作用域：' + (database !== undefined ? database : (schema !== undefined ? schema : '-')),
					'SQL：',
					'```sql',
					statement,
					'```',
					'请调用 db_query（' + call.join('，') + '），把结果整理成表格展示；如果报错，原样返回。',
				].join('\n')
			}

			/** Copy text to the clipboard, with a legacy fallback. */
			async function copyText(text) {
				try {
					if (navigator.clipboard !== undefined) {
						await navigator.clipboard.writeText(text)
						return true
					}
				} catch { /* fall through */ }
				try {
					const area = document.createElement('textarea')
					area.value = text
					area.style.position = 'fixed'
					area.style.opacity = '0'
					document.body.appendChild(area)
					area.select()
					const copied = document.execCommand('copy')
					area.remove()
					return copied
				} catch {
					return false
				}
			}

			/** Copy the current scope/SQL as an agent instruction. */
			async function askAgent() {
				const prompt = buildAgentPrompt()
				if (prompt === '') return
				const copied = await copyText(prompt)
				setToast(copied ? t('agent.copied') : t('agent.failed'))
			}

			/** Editor key handling: completion keys first, then run/indent. */
			function onEditorKeyDown(event) {
				const currentSuggest = suggestRef.current
				if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
					event.preventDefault()
					const editor = event.currentTarget
					const selectedText = editor.value.slice(editor.selectionStart, editor.selectionEnd).trim()
					void run(selectedText !== '' ? selectedText : undefined)
					return
				}
				if ((event.ctrlKey || event.metaKey) && event.code === 'Space') {
					event.preventDefault()
					setSuggest(buildSuggestions(event.currentTarget, true))
					return
				}
				if (currentSuggest !== null && currentSuggest.items.length > 0) {
					if (event.key === 'ArrowDown') {
						event.preventDefault()
						setSuggest({ ...currentSuggest, index: (currentSuggest.index + 1) % currentSuggest.items.length })
						return
					}
					if (event.key === 'ArrowUp') {
						event.preventDefault()
						setSuggest({ ...currentSuggest, index: (currentSuggest.index - 1 + currentSuggest.items.length) % currentSuggest.items.length })
						return
					}
					if (event.key === 'Enter' || event.key === 'Tab') {
						event.preventDefault()
						acceptSuggestion()
						return
					}
				}
				if (currentSuggest !== null && event.key === 'Escape') {
					event.preventDefault()
					setSuggest(null)
					return
				}
				if (event.key === 'Tab') {
					event.preventDefault()
					const editor = event.currentTarget
					const start = editor.selectionStart
					const end = editor.selectionEnd
					const next = sql.slice(0, start) + '  ' + sql.slice(end)
					updateSql(next)
					window.requestAnimationFrame(() => {
						try { editor.setSelectionRange(start + 2, start + 2) } catch { /* gone */ }
					})
				}
			}

			/** Insert a quoted column name at the cursor. */
			function insertColumn(name) {
				if (selected === null) return
				const quoted = quoteIdent(selected.type, name)
				const editor = editorRef.current
				if (editor === null) {
					updateSql(sql + quoted)
					return
				}
				const start = typeof editor.selectionStart === 'number' ? editor.selectionStart : sql.length
				const end = typeof editor.selectionEnd === 'number' ? editor.selectionEnd : start
				const next = sql.slice(0, start) + quoted + sql.slice(end)
				updateSql(next)
				window.requestAnimationFrame(() => {
					try {
						editor.focus()
						const position = start + quoted.length
						editor.setSelectionRange(position, position)
					} catch { /* editor gone */ }
				})
			}

			/** Run one statement. */
			async function run(text) {
				setSuggest(null)
				if (selected === null) {
					setQueryError(t('error.noConnection'))
					return
				}
				const source = (text !== undefined ? text : sql).trim()
				if (source === '') return
				setRunning(true)
				setQueryError('')
				setResult(null)
				try {
					const data = await api.query({
						id: selected.id,
						sql: source,
						database: current.database,
						schema: current.schema,
					})
					setResult(data)
				} catch (runError) {
					setQueryError(runError instanceof Error ? runError.message : String(runError))
				} finally {
					setRunning(false)
				}
			}

			/** Preview a table's first rows. */
			function previewTable(node) {
				if (selected === null) return
				const database = node.database !== undefined ? node.database : current.database
				const schema = node.schema !== undefined ? node.schema : current.schema
				const target = qualifyTable(selected.type, database, schema, node.table)
				const text = 'SELECT * FROM ' + target + ' LIMIT 100;'
				updateSql(text)
				void run(text)
			}

			/** Open the edit dialog for one connection. */
			function editConnection(connection) {
				setDialog({ mode: 'edit', connection })
			}

			/** Delete one connection after confirmation. */
			async function deleteConnection(connection) {
				if (!window.confirm(t('conn.deleteConfirm', { name: connection.name }))) return
				try {
					await api.deleteConnection(connection.id)
					if (selectedId === connection.id) setSelectedId('')
					await refreshConnections()
					setToast(t('conn.deleted'))
				} catch (deleteError) {
					setError(deleteError instanceof Error ? deleteError.message : String(deleteError))
				}
			}

			/** After a dialog save. */
			async function onSaved(connection) {
				setDialog(null)
				await refreshConnections()
				setSelectedId(connection.id)
				setToast(t(connection.createdAt === connection.updatedAt ? 'conn.created' : 'conn.updated'))
			}

			/** Build a tree node from a scope item. */
			function scopeNode(item) {
				if (selected === null) return { id: '' }
				return selected.type === 'mysql'
					? { id: selected.id, database: item.name }
					: { id: selected.id, schema: item.name }
			}

			/** Render table children of one scope node. */
			function renderTables(node, depth) {
				const key = treeKey(node)
				const entry = tree[key]
				const open = expanded[key] === true
				if (!open) return null
				if (entry === undefined || entry.status === 'loading') {
					return h('div', { className: 'dshdb-tree-status' }, t('tree.loading'))
				}
				if (entry.status === 'error') {
					return h('div', { className: 'dshdb-tree-error' }, entry.error)
				}
				if (entry.items.length === 0) {
					return h('div', { className: 'dshdb-tree-status' }, t('tree.emptyTables'))
				}
				return entry.items.map(item => renderTableNode({ ...node, table: item.name }, depth + 1, item))
			}

			/** Render one table node and, when open, its columns. */
			function renderTableNode(node, depth, item) {
				const key = treeKey(node)
				const entry = tree[key]
				const open = expanded[key] === true
				return h(React.Fragment, { key },
					h(TreeNode, {
						node,
						kind: 'table',
						item,
						depth,
						open,
						active: activeKey === key,
						onClick: () => { applyScope(node); toggle(node) },
						onDoubleClick: () => { applyScope(node); previewTable(node) },
						onContextMenu: event => openTableMenu(event, node, item),
					}),
					open && (entry === undefined || entry.status === 'loading')
						? h('div', { className: 'dshdb-tree-status' }, t('tree.loading'))
						: null,
					open && entry !== undefined && entry.status === 'error'
						? h('div', { className: 'dshdb-tree-error' }, entry.error)
						: null,
					open && entry !== undefined && entry.status === 'loaded' && entry.items.length === 0
						? h('div', { className: 'dshdb-tree-status' }, t('tree.emptyColumns'))
						: null,
					open && entry !== undefined && entry.status === 'loaded'
						? entry.items.map(column => h(ColumnNode, {
							key: column.name,
							column,
							depth,
							active: false,
							onClick: () => insertColumn(column.name),
							onContextMenu: event => openColumnMenu(event, column, node),
						}))
						: null,
				)
			}

			/** Render one database/schema scope node. */
			function renderScopeNode(item) {
				const node = scopeNode(item)
				const key = treeKey(node)
				const open = expanded[key] === true
				const isMysql = selected.type === 'mysql'
				return h(React.Fragment, { key },
					h(TreeNode, {
						node,
						kind: isMysql ? 'database' : 'schema',
						item,
						depth: 0,
						open,
						active: (isMysql ? current.database === item.name : current.schema === item.name) || activeKey === key,
						onClick: () => { applyScope(node); toggle(node) },
						onContextMenu: event => openScopeMenu(event, node, item),
					}),
					renderTables(node, 0),
				)
			}

			/** Search hits replace the tree while a query is typed. */
			function renderSearchResults() {
				if (searching) return h('div', { className: 'dshdb-tree-status' }, t('tree.searching'))
				if (searchResults === null) return null
				if (searchResults.length === 0) return h('div', { className: 'dshdb-tree-status' }, t('tree.searchEmpty'))
				return h('div', null, searchResults.map(row => {
					const owner = row.database !== undefined ? row.database : row.schema
					const isView = row.type === 'view' || row.type === 'materialized view'
					return h('button', {
						key: String(owner) + '|' + row.name + '|' + row.type,
						type: 'button',
						className: 'dshdb-node',
						title: (owner !== undefined ? owner + '.' : '') + row.name,
						onClick: () => openSearchResult(row),
						onContextMenu: event => openSearchResultMenu(event, row),
					},
						h('span', { className: 'dshdb-node-icon ' + (isView ? 'view' : 'table') }, isView ? h(ViewIcon, { size: 11 }) : h(TableIcon, { size: 11 })),
						h('span', { className: 'dshdb-node-label' }, row.name),
						h('span', { className: 'dshdb-node-meta' }, (owner !== undefined ? owner + ' · ' : '') + (isView ? (LANG === 'en' ? 'view' : '视图') : (LANG === 'en' ? 'table' : '表'))))
				}))
			}

			/** Render the whole tree body for the selected connection. */
			function renderTree() {
				if (selected === null) {
					return h('div', { className: 'dshdb-empty' },
						h('div', { className: 'dshdb-empty-icon' }, h(DatabaseIcon, { size: 34 })),
						h('div', { className: 'dshdb-empty-title' }, t('conn.empty')),
						h('div', { className: 'dshdb-empty-hint' }, t('conn.emptyHint')),
						h('button', { type: 'button', className: 'dshdb-btn primary', onClick: () => setDialog({ mode: 'new' }) },
							h(PlusIcon), t('conn.new')))
				}
				const key = treeKey({ id: selected.id })
				const entry = tree[key]
				if (entry === undefined || entry.status === 'loading') {
					return h('div', { className: 'dshdb-tree-status' }, t('tree.loading'))
				}
				if (entry.status === 'error') {
					return h('div', { className: 'dshdb-tree-error' },
						h('div', null, entry.error),
						h('button', { type: 'button', className: 'dshdb-btn small', style: { marginTop: 6 }, onClick: () => { void loadNode({ id: selected.id }, true) } }, t('tree.retry')))
				}
				if (entry.items.length === 0) {
					return h('div', { className: 'dshdb-tree-status' }, t('tree.empty'))
				}
				return h('div', null,
					entry.items.map(item => renderScopeNode(item)),
					entry.truncated === true
						? h('div', { className: 'dshdb-tree-status' }, t('tree.truncated', { count: entry.items.length }))
						: null)
			}

			/** Render the result grid. */
			function renderResult() {
				if (queryError !== '') {
					return h('div', { className: 'dshdb-error' }, queryError)
				}
				if (result === null) {
					return h('div', { className: 'dshdb-empty' },
						h('div', { className: 'dshdb-empty-title' }, t('result.placeholder')))
				}
				if (result.columns.length === 0) {
					return h('div', { className: 'dshdb-empty' },
						h('div', { className: 'dshdb-empty-title' },
							t('result.affected', { count: result.affectedRows !== undefined ? result.affectedRows : 0 })),
						h('div', { className: 'dshdb-empty-hint' }, t('result.duration', { ms: result.durationMs })))
				}
				return h('table', { className: 'dshdb-table' },
					h('thead', null,
						h('tr', null,
							result.columns.map((column, index) => h('th', { key: index, title: column.name },
								column.name,
								column.dataType !== undefined ? h('span', { className: 'type' }, column.dataType) : null)))),
					h('tbody', null,
						result.rows.map((row, rowIndex) => h('tr', { key: rowIndex },
							row.map((value, columnIndex) => {
								const text = cellText(value)
								return h('td', {
									key: columnIndex,
									title: text !== null && text.length > 80 ? text : undefined,
								}, text === null ? h('span', { className: 'dshdb-null' }, 'NULL') : text)
							})))))
			}

			/** The table-structure dialog (null when closed). */
			function renderStructureDialog() {
				if (structure === null) return null
				const metaParts = [
					structure.item.type !== undefined ? String(structure.item.type) : '',
					typeof structure.item.rowCount === 'number' ? '~' + structure.item.rowCount + ' rows' : '',
					structure.item.comment !== undefined ? String(structure.item.comment) : '',
				].filter(part => part !== '')
				const headerCells = [
					h('th', { key: 'pos' }, '#'),
					h('th', { key: 'name' }, t('structure.column')),
					h('th', { key: 'type' }, t('structure.type')),
					h('th', { key: 'nullable' }, t('structure.nullable')),
					h('th', { key: 'default' }, t('structure.default')),
					h('th', { key: 'pk' }, t('structure.primaryKey')),
					h('th', { key: 'extra' }, t('structure.extra')),
					h('th', { key: 'comment' }, t('structure.comment')),
				]
				const rows = structure.columns.map((column, index) => h('tr', { key: column.name + '|' + index },
					h('td', null, String(column.position !== undefined ? column.position : index + 1)),
					h('td', null, column.name),
					h('td', null, column.type),
					h('td', null, column.nullable === true ? 'YES' : 'NO'),
					h('td', null, column.defaultValue !== undefined && column.defaultValue !== null ? String(column.defaultValue) : ''),
					h('td', null, column.primaryKey === true ? 'PK' : ''),
					h('td', null, column.extra !== undefined ? String(column.extra) : ''),
					h('td', null, column.comment !== undefined ? String(column.comment) : '')))
				const content = structure.status === 'loading'
					? h('div', { className: 'dshdb-tree-status' }, t('structure.loading'))
					: structure.status === 'error'
						? h('div', { className: 'dshdb-error', style: { margin: '8px' } }, structure.error)
						: structure.columns.length === 0
							? h('div', { className: 'dshdb-tree-status' }, t('structure.empty'))
							: h('div', { className: 'dshdb-structure' },
								h('table', { className: 'dshdb-table' },
									h('thead', null, h('tr', null, headerCells)),
									h('tbody', null, rows)))
				const actions = h('div', { className: 'dshdb-dialog-actions' },
					h('button', {
						type: 'button',
						className: 'dshdb-btn',
						onClick: () => { const node = structure.node; setStructure(null); previewTable(node) },
					}, t('structure.preview')),
					h('button', {
						type: 'button',
						className: 'dshdb-btn',
						onClick: () => { void copyToClipboard(buildTablePrompt(structure.node, structure.item), t('agent.copied')) },
					}, t('structure.askAgent')),
					h('span', { className: 'dshdb-spacer' }),
					h('button', {
						type: 'button',
						className: 'dshdb-btn primary',
						onClick: () => setStructure(null),
					}, t('common.close')))
				return h('div', {
					className: 'dshdb-overlay',
					onMouseDown: event => { if (event.target === event.currentTarget) setStructure(null) },
				},
					h('div', {
						className: 'dshdb-dialog wide',
						role: 'dialog',
						'aria-modal': 'true',
						onMouseDown: event => event.stopPropagation(),
					},
						h('h3', { className: 'dshdb-dialog-title' }, t('structure.title') + ' · ' + structureTitle),
						metaParts.length > 0 && h('div', { className: 'dshdb-hint' }, metaParts.join(' · ')),
						content,
						actions))
			}

			/** The right-click menu (null when closed). */
			function renderContextMenu() {
				if (contextMenu === null) return null
				return h('div', {
					className: 'dshdb-menu',
					style: { position: 'fixed', zIndex: 1500, left: contextMenu.x, top: contextMenu.y },
					onMouseDown: event => event.stopPropagation(),
					onContextMenu: event => event.preventDefault(),
				},
					contextMenu.title !== undefined && h('div', { className: 'dshdb-menu-title' }, contextMenu.title),
					contextMenu.items.map((item, index) => item.separator === true
						? h('div', { key: 'sep-' + index, className: 'dshdb-menu-sep' })
						: h('button', {
							key: 'item-' + index,
							type: 'button',
							className: 'dshdb-menu-item' + (item.danger === true ? ' danger' : ''),
							onClick: () => { setContextMenu(null); item.onSelect() },
						}, item.label)))
			}

			const readOnly = selected !== null && selected.readOnly !== false
			const scope = selected !== null ? scopeCaption(selected, current) : ''
			const structureTitle = structure !== null && selected !== null
				? qualifyTable(selected.type, structure.node.database, structure.node.schema, structure.node.table)
				: ''
			const hasSearchScope = selected !== null && (selected.type === 'mysql'
				? effectiveScope.database !== undefined
				: effectiveScope.schema !== undefined)

			return h('div', { className: 'dshdb-root', 'data-dsh-db-view': '', 'data-dsh-plugin': 'db' },
				h('div', { className: 'dshdb-header' },
					h('button', { type: 'button', className: 'dshdb-btn ghost', 'data-dsh-center-view-back': '', onClick: onClose, title: t('panel.back') },
						h('span', { 'aria-hidden': 'true' }, '‹'),
						h('span', null, t('panel.back'))),
					h('h2', { className: 'dshdb-title' }, t('panel.title')),
					h('span', { className: 'dshdb-spacer' }),
					h('button', { type: 'button', className: 'dshdb-btn', onClick: () => { void refreshAll() }, disabled: loading, title: t('common.refresh') },
						h(RefreshIcon), t('common.refresh')),
					h('button', { type: 'button', className: 'dshdb-btn primary', onClick: () => setDialog({ mode: 'new' }) },
						h(PlusIcon), t('conn.new'))),

				error !== '' && h('div', { className: 'dshdb-error', style: { marginTop: 10 } },
					h('div', null, error),
					h('button', { type: 'button', className: 'dshdb-btn small', style: { marginTop: 6 }, onClick: () => setError('') }, t('error.dismiss'))),

				h('div', { className: 'dshdb-body' },
					h('aside', { className: 'dshdb-left' },
						h('div', { className: 'dshdb-conns' },
							h('div', { className: 'dshdb-conns-head' },
								h('span', { className: 'dshdb-conns-title' }, t('conn.title')),
								connections.length > 3 && h('input', {
									className: 'dshdb-input compact',
									placeholder: t('conn.search'),
									value: filter,
									onChange: event => setFilter(event.target.value),
								})),
							loading && connections.length === 0
								? h('div', { className: 'dshdb-tree-status' }, t('common.loading'))
								: filtered.map(connection => h('div', {
									key: connection.id,
									className: 'dshdb-conn',
									role: 'button',
									tabIndex: 0,
									'data-active': selectedId === connection.id ? '' : undefined,
									onClick: () => setSelectedId(connection.id),
									onKeyDown: event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedId(connection.id) } },
									onContextMenu: event => openConnectionMenu(event, connection),
								},
									h('span', { className: 'dshdb-conn-icon' }, h(DatabaseIcon, { size: 15 })),
									h('div', { className: 'dshdb-conn-body' },
										h('div', { className: 'dshdb-conn-name' }, connection.name),
										h('div', { className: 'dshdb-conn-meta' },
											typeLabel(connection.type) + ' · ' + connection.host + ':' + connection.port
											+ (connection.database !== undefined ? ' / ' + connection.database : '')),
										h('div', { style: { marginTop: 3, display: 'flex', gap: 4 } },
											h('span', { className: 'dshdb-badge ' + connection.type }, typeLabel(connection.type)),
											h('span', { className: 'dshdb-badge ' + (connection.readOnly ? 'ro' : 'rw') },
												connection.readOnly ? t('readonly.badge') : t('readwrite.badge')))),
									h('div', { className: 'dshdb-conn-actions' },
										h('button', {
											type: 'button',
											className: 'dshdb-icon-btn',
											title: t('conn.disconnect'),
											onClick: event => { event.stopPropagation(); void disconnectConnection(connection) },
										}, h(PowerIcon)),
										h('button', {
											type: 'button',
											className: 'dshdb-icon-btn',
											title: t('conn.edit'),
											onClick: event => { event.stopPropagation(); editConnection(connection) },
										}, h(PencilIcon)),
										h('button', {
											type: 'button',
											className: 'dshdb-icon-btn',
											title: t('conn.delete'),
											onClick: event => { event.stopPropagation(); void deleteConnection(connection) },
										}, h(TrashIcon)))))),
						h('div', { className: 'dshdb-tree' },
							selected !== null && h('div', { className: 'dshdb-tree-head' },
								h('span', null, t('tree.title')),
								h('input', {
									className: 'dshdb-input compact',
									placeholder: t('tree.search'),
									value: tableSearch,
									onChange: event => onTableSearch(event.target.value),
									onKeyDown: event => {
										if (event.key === 'Escape') {
											event.preventDefault()
											onTableSearch('')
										}
									},
								}),
								hasSearchScope && h('button', {
									type: 'button',
									className: 'dshdb-scope-btn',
									title: t('tree.searchScope'),
									onClick: () => {
										const next = !searchAll
										setSearchAll(next)
										if (tableSearch.trim() !== '') onTableSearch(tableSearch, next)
									},
								}, searchAll ? t('tree.scopeAll') : t('tree.scopeCurrent'))),
							selected !== null && tableSearch.trim() !== '' ? renderSearchResults() : renderTree())),

					h('main', { className: 'dshdb-main' },
						h('div', { className: 'dshdb-toolbar' },
							selected !== null && h('span', { className: 'dshdb-scope' },
								h('b', null, selected.name),
								' · ',
								t('editor.scope') + ': ',
								h('b', null, scope)),
							selected !== null && h('span', { className: 'dshdb-badge ' + (readOnly ? 'ro' : 'rw') },
								readOnly ? t('readonly.badge') : t('readwrite.badge')),
							h('span', { className: 'dshdb-spacer' }),
							selected !== null && h('button', {
								type: 'button',
								className: 'dshdb-btn ghost',
								onClick: () => { void askAgent() },
								disabled: running,
								title: t('agent.copy'),
							}, t('agent.copy')),
							selected !== null && h('button', {
								type: 'button',
								className: 'dshdb-btn',
								onClick: openSuggestions,
								disabled: running,
								title: t('editor.hint'),
							}, t('editor.suggest')),
							selected !== null && h('button', {
								type: 'button',
								className: 'dshdb-btn',
								onClick: () => { updateSql('') },
								disabled: running,
							}, t('editor.clear')),
							selected !== null && h('button', {
								type: 'button',
								className: 'dshdb-btn primary',
								onClick: () => { void run() },
								disabled: running || sql.trim() === '',
								title: t('editor.hint'),
							}, running ? h(SpinnerIcon) : h(PlayIcon), running ? t('editor.running') : t('editor.run'))),

						h('div', { className: 'dshdb-editor-wrap' },
							h('textarea', {
								ref: editorRef,
								className: 'dshdb-editor',
								value: sql,
								spellCheck: false,
								placeholder: t('editor.placeholder'),
								onChange: event => {
									updateSql(event.target.value)
									setSuggest(buildSuggestions(event.target, false))
								},
								onKeyDown: onEditorKeyDown,
								onClick: () => setSuggest(null),
								onBlur: () => { window.setTimeout(() => setSuggest(null), 120) },
								onScroll: () => setSuggest(null),
							}),
							suggest !== null && h('div', {
								className: 'dshdb-suggest',
								style: { left: suggest.left, top: suggest.top },
							},
								suggest.items.length === 0
									? h('div', { className: 'dshdb-suggest-empty' }, t('suggest.empty'))
									: suggest.items.map((item, index) => h('div', {
										key: item.kind + '\u0000' + item.insert,
										className: 'dshdb-suggest-item',
										'data-active': index === suggest.index ? '' : undefined,
										onMouseEnter: () => setSuggest(previous => (previous === null ? null : { ...previous, index })),
										onMouseDown: event => { event.preventDefault(); acceptSuggestion(item) },
									},
										h('span', { className: 'dshdb-suggest-kind' }, suggestionKindLabel(item.kind)),
										h('span', { className: 'dshdb-suggest-label' }, item.label),
										item.detail !== '' && h('span', { className: 'dshdb-suggest-detail' }, item.detail))))),

						h('div', { className: 'dshdb-result-head' },
							selected === null
								? h('span', null, '')
								: result !== null
									? h(React.Fragment, null,
										result.columns.length > 0
											? h('b', null, t('result.rows', { count: result.rowCount }))
											: h('b', null, t('result.affected', { count: result.affectedRows ?? 0 })),
										h('span', null, t('result.duration', { ms: result.durationMs })),
										result.truncated === true
											? h('span', { style: { color: 'var(--dshdb-danger)' } }, t('result.truncated', { count: result.rowCount }))
											: null,
										result.warning !== undefined ? h('span', null, result.warning) : null)
									: h('span', null, t('editor.hint'))),

						queryError !== ''
							? h('div', { className: 'dshdb-error' }, queryError)
							: h('div', { className: 'dshdb-result' }, renderResult())),

					toast !== '' ? h('div', { className: 'dshdb-toast' }, toast) : null),

				dialog !== null && h(ConnectionDialog, {
					initial: dialog.mode === 'edit' ? dialog.connection : null,
					onClose: () => setDialog(null),
					onSaved: connection => { void onSaved(connection) },
				}),

				/* old inline structure/context dialog kept out of the argument list
				structure !== null && h('div', {
					className: 'dshdb-overlay',
					onMouseDown: event => { if (event.target === event.currentTarget) setStructure(null) },
				},
					h('div', {
						className: 'dshdb-dialog wide',
						role: 'dialog',
						'aria-modal': 'true',
						onMouseDown: event => event.stopPropagation(),
					},
						h('h3', { className: 'dshdb-dialog-title' }, t('structure.title') + ' · ' + structureTitle),
						(structure.item.type !== undefined || structure.item.comment !== undefined || structure.item.rowCount !== undefined) && h('div', { className: 'dshdb-hint' },
							[
								structure.item.type !== undefined ? String(structure.item.type) : '',
								typeof structure.item.rowCount === 'number' ? '~' + structure.item.rowCount + ' rows' : '',
								structure.item.comment !== undefined ? String(structure.item.comment) : '',
							].filter(part => part !== '').join(' · ')),
						h('div', { className: 'dshdb-structure' },
							structure.status === 'loading'
								? h('div', { className: 'dshdb-tree-status' }, t('structure.loading'))
								: structure.status === 'error'
									? h('div', { className: 'dshdb-error', style: { margin: '8px' } }, structure.error)
									: structure.columns.length === 0
										? h('div', { className: 'dshdb-tree-status' }, t('structure.empty'))
										: h('table', { className: 'dshdb-table' },
											h('thead', null,
												h('tr', null,
													h('th', null, '#'),
													h('th', null, t('structure.column')),
													h('th', null, t('structure.type')),
													h('th', null, t('structure.nullable')),
													h('th', null, t('structure.default')),
													h('th', null, t('structure.primaryKey')),
													h('th', null, t('structure.extra')),
													h('th', null, t('structure.comment')))),
											h('tbody', null,
												structure.columns.map((column, index) => h('tr', { key: column.name + '|' + index },
													h('td', null, String(column.position !== undefined ? column.position : index + 1)),
													h('td', null, column.name),
													h('td', null, column.type),
													h('td', null, column.nullable === true ? 'YES' : 'NO'),
													h('td', null, column.defaultValue !== undefined && column.defaultValue !== null ? String(column.defaultValue) : ''),
													h('td', null, column.primaryKey === true ? 'PK' : ''),
													h('td', null, column.extra !== undefined ? String(column.extra) : ''),
													h('td', null, column.comment !== undefined ? String(column.comment) : '')))))),
						h('div', { className: 'dshdb-dialog-actions' },
							h('button', {
								type: 'button',
								className: 'dshdb-btn',
								onClick: () => { const node = structure.node; setStructure(null); previewTable(node) },
							}, t('structure.preview')),
							h('button', {
								type: 'button',
								className: 'dshdb-btn',
								onClick: () => { void copyToClipboard(buildTablePrompt(structure.node, structure.item), t('agent.copied')) },
							}, t('structure.askAgent')),
							h('span', { className: 'dshdb-spacer' }),
							h('button', {
								type: 'button',
								className: 'dshdb-btn primary',
								onClick: () => setStructure(null),
							}, t('common.close'))))),

				contextMenu !== null && h('div', {
					className: 'dshdb-menu',
					style: { left: contextMenu.x, top: contextMenu.y },
					onMouseDown: event => event.stopPropagation(),
					onContextMenu: event => event.preventDefault(),
				},
					contextMenu.title !== undefined && h('div', { className: 'dshdb-menu-title' }, contextMenu.title),
					contextMenu.items.map((item, index) => item.separator === true
						? h('div', { key: 'sep-' + index, className: 'dshdb-menu-sep' })
						: h('button', {
							key: 'item-' + index,
							type: 'button',
							className: 'dshdb-menu-item' + (item.danger === true ? ' danger' : ''),
							onClick: () => { setContextMenu(null); item.onSelect() },
						}, item.label))),
				*/
				renderStructureDialog(),
				renderContextMenu(),
			)
		}

		// ------------------------------------------------------------ boundary
		/** Keep one component crash from taking the whole panel down. */
		class PanelBoundary extends React.Component {
			constructor(props) {
				super(props)
				this.state = { error: null }
			}

			static getDerivedStateFromError(error) {
				return { error }
			}

			componentDidCatch(error) {
				console.warn('[dsh-db] panel render failed:', error)
			}

			render() {
				if (this.state.error !== null) {
					return h('div', { className: 'dshdb-root' },
						h('div', { className: 'dshdb-empty' },
							h('div', { className: 'dshdb-empty-title' }, t('error.title')),
							h('div', { className: 'dshdb-empty-hint' }, String(this.state.error && this.state.error.message ? this.state.error.message : this.state.error))))
				}
				return this.props.children
			}
		}

		/** The main-slot page. */
		function DbPanelPage({ onClose }) {
			return h('div', { style: { height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' } },
				h(PanelBoundary, null, h(DbPage, { onClose })))
		}

		/** Required client services. */
		const inject = ['slots', 'layout']

		/**
		 * Register the sidebar entry and the center-column page.
		 * @param {any} ctx - client root context.
		 * @param {() => void} onClose - return the layout to the conversation.
		 */
		function registerPanel(ctx, onClose) {
			const slots = ctx.slots
			const disposers = []
			disposers.push(slots.inject('sidebar.panellist', () => slots.register({
				name: 'sidebar.panellist',
				id: PANEL_ID,
				order: 45,
				label: () => t('entry.label'),
			}, DbPanelIcon)))
			disposers.push(slots.inject('main', () => slots.register({
				name: 'main',
				key: PANEL_ID,
				inject: () => ({ onClose }),
			}, DbPanelPage)))
			return () => {
				for (const dispose of disposers.splice(0)) dispose()
			}
		}

		/** Mount the database panel. */
		function apply(ctx) {
			// The stylesheet is page-scoped and shared across remounts; removing it
			// on dispose would race a hot-reloaded instance, so it stays for the
			// page lifetime (a reload drops it with the document).
			ensureStyles()
			let disposePanel = () => {}
			try {
				disposePanel = registerPanel(ctx, () => {
					try {
						const layout = ctx.get('layout')
						layout?.selectPanel?.(null)
					} catch { /* layout not ready */ }
				})
			} catch (error) {
				// Registration failures degrade the panel, never the GUI.
				console.warn('[dsh-db] panel registration failed:', error)
			}
			ctx.effect(() => () => {
				disposePanel()
			}, 'dsh-db: ui mounts')
		}

		exports.apply = apply
		exports.inject = inject
		return module.exports
	},
})
