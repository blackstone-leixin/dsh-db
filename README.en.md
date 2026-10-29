# dsh-db · Database connections for DeepSeek Harness (MySQL / PostgreSQL)

English | [中文](README.md)

A database operations plugin for the DeepSeek Harness (DSH) web GUI and desktop app: **connection manager + database/schema/table/column tree + SQL console + 3 agent tools**. Modelled on the installed `@linxin666/dsh-ssh` plugin — mounted entirely through the official NPM SDK packages, with no DSH source changes.

## Features

| Feature | Description |
| --- | --- |
| Connections | Create, edit, test and delete MySQL/MariaDB and PostgreSQL connections. Passwords stay in the local `~/.dsh/dsh-db.json` (0600) and are never returned to the browser or the model. |
| Schema tree | connection → database (MySQL) / schema (PostgreSQL) → table/view → column, with column type, nullability, default, primary key and comment, plus approximate row count and table comment. |
| Table search | Type a table name at the top of the tree; it searches the current database/schema by default. The **This DB/All DBs** button switches scope. Up to 200 hits; clicking one locates it and previews `SELECT … LIMIT 100`. |
| Disconnect | Hover a connection row → power button: closes every pooled socket for that connection; the next query reconnects automatically. |
| Context menu | Table/view (including search hits): view structure (columns dialog), preview, copy name/qualified name, ask agent, refresh columns; connection: edit/disconnect/delete; column: insert/copy. |
| Quick preview | Double-click a table to run `SELECT * FROM <table> LIMIT 100`; click a column to insert its quoted name at the editor cursor. |
| SQL console | Multi-line editor, `Ctrl+Enter` to run, sticky-header result grid, duration/row-count/truncation status, raw database errors. |
| SQL completion | Keyword/table/column suggestions while typing, `Ctrl+Space` to open; `database.` / `table.` qualifiers and `FROM users u` aliases; quiet inside strings and comments. |
| Read-only by default | Every connection starts read-only: statements pass a keyword allowlist and then run inside a database-enforced read-only transaction. Only the user can turn read-only off in the GUI. |
| Pooling | One pool per (connection, database), idle-reaped after 30 minutes; editing or deleting a connection drops its pools so stale credentials are never reused. |
| Agent tools | `db_list`, `db_search`, `db_schema`, `db_query` share the GUI's connections and read-only policy. |
| Bilingual UI | Chinese / English, selected from the browser language. |

## Install

Requirements: DSH ≥ 0.2.1-rc.2, Node ≥ 22.19.

### Windows desktop (DSH Desktop)

DSH Desktop deliberately never writes `dsh` into the system PATH, so plain PowerShell reports "dsh is not recognized". Open **tray menu → Open DSH terminal** instead: that terminal puts the app's private `dsh`, `pnpm` and `node` shims on PATH and targets the active `desktop` profile. Then install the packed tarball, which lets the profile's pnpm resolve the plugin's dependencies:

```powershell
cd "<path-to-dsh-db>"
pnpm pack
dsh plugin add ".\dsh-db-0.3.4.tgz"
```

Restart DSH Desktop afterwards. For a linked checkout instead (run `pnpm install` first), or from a plain PowerShell, use the bundled binaries directly:

```powershell
$node = "D:\Program Files\DeepSeek Harness\resources\runtime\primary-runtime\dependencies\node\bin\node.exe"
$pnpm = "D:\Program Files\DeepSeek Harness\resources\runtime\primary-runtime\dependencies\pnpm\bin\pnpm.cjs"
$dsh  = "D:\Program Files\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd"
cd "<path-to-dsh-db>"
& $node $pnpm pack
& $dsh plugin --profile desktop add "$PWD\dsh-db-0.3.4.tgz"
```

### From a terminal (plain dsh web)

```sh
cd <this directory>
npm install
dsh plugin --profile desktop add "<absolute path to this directory>"
```

The sidebar then shows a **Database** entry. Remove with `dsh plugin --profile desktop remove dsh-db`.

> `dsh plugin add` links the package into the profile and applies `dsh.bundle.patch` from `package.json`, inserting the `id: db` row automatically. A manual copy into `~/.dsh/profiles/<name>/node_modules/dsh-db` also needs the `insert` entry from `cordis.patch.yml` appended to the profile's own `cordis.patch.yml`, followed by a restart.
>
> Without network access, at minimum `mysql2` and `pg` must be resolvable from this package directory. A missing driver does not break the DSH boot; the GUI and tools report an actionable "driver not installed" error.

## Usage

1. Sidebar → **Database** → **New connection**.
2. Fill in name, type, host, port, user and password. The default database is optional for MySQL; PostgreSQL falls back to a database named after the user.
3. **Test** validates the form before saving.
4. Expand connection → database/schema → tables. Double-click a table to preview 100 rows; click a column to insert its name into the SQL editor.
5. Write SQL and press `Ctrl+Enter` (`⌘+Enter` on macOS) to run. With a text selection, only the selection runs.
6. The tree header has a table search box. It searches the current database/schema by default; the **This DB/All DBs** button switches scope. Up to 200 hits; clicking a hit locates the table and previews the first 100 rows. `Esc` clears it.
7. Hover a connection row and click the power icon to close all its pooled sockets; the next query or tree expansion reconnects automatically.
8. Right-click a table/view (including a search hit): view structure (columns, types, nullability, defaults, PK, extra, comments), preview the first 100 rows, copy name, ask agent, refresh columns. Right-click a connection to edit/disconnect/delete; right-click a column to insert it or copy it.

### SQL completion

The editor suggests as you type, or press `Ctrl+Space` (`⌘+Space`) / click **Suggest** in the toolbar:

- keywords (`SELECT`, `FROM`, `JOIN`, `WHERE`, `GROUP BY`, …);
- tables and views known for the current database/schema;
- column names with type and primary-key markers;
- `database.` lists that database's tables; `table.` or `alias.` lists that table's columns (aliases from `FROM users u` work);
- `FROM` / `JOIN` prioritise tables; `SELECT` / `WHERE` / `ON` prioritise columns.

Use `↑` / `↓` to move, `Enter` or `Tab` to accept, `Esc` to close. Data comes from a one-shot catalog request per scope (prefetched when a connection or scope is selected) plus any expanded tree nodes; completion stays quiet inside strings and comments.

### Read-only mode

New connections are read-only. In that mode:

- Only `SELECT`, `SHOW`, `DESCRIBE`, `EXPLAIN`, `WITH … SELECT`, `VALUES` and `TABLE` are accepted, and only one statement at a time.
- Statements also run inside a database-enforced read-only transaction (`BEGIN TRANSACTION READ ONLY` on PostgreSQL, `START TRANSACTION READ ONLY` on MySQL), so the database itself rejects writes even if the allowlist is bypassed.
- `db_query` obeys the same switch as the GUI.

To write (`INSERT` / `UPDATE` / DDL / procedures), edit the connection and clear **Read-only connection**. Prefer a database-side read-only account for day-to-day browsing.

## Agent tools

| Tool | Purpose |
| --- | --- |
| `db_list` | List configured connections (name, type, host, default database, read-only/writable). |
| `db_search` | Search table/view names by substring across databases/schemas (up to 200 hits). |
| `db_schema` | Walk the tree one level per call: no database/schema → databases or schemas; `database` (MySQL) / `schema` (PostgreSQL) → tables/views; plus `table` → columns. |
| `db_query` | Run one SQL statement and return a Markdown table. Defaults: 500 rows, 30 s timeout (caps: 5000 rows, 120 s). |

### Using it from the conversation

All four tools are registered in every conversation. The plugin does not announce itself by default (`announceToAgent` is off to keep prompts clean), so either name it explicitly:

> Use db_query on connection `local-mysql`, database `app`, to select the first 10 rows of `users`.

or click **Ask agent** in the editor toolbar: it builds an instruction with the connection, database/schema and current SQL. If the editor is empty but a table was just clicked, it generates `SELECT * FROM <table> LIMIT 100`. Paste the copied prompt into the chat. Enable `announceToAgent` in the plugin settings if you want the model to know about the plugin automatically. Agents can never create/edit connections or bypass the read-only switch.

Agents cannot create, edit or delete connections and never see passwords. The plugin does not announce itself to agents unless `announceToAgent` is enabled in its settings.

## Configuration

| Field | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Master switch (routes, tools, prompt section). |
| `announceToAgent` | `false` | Add the plugin capability to the system prompt. |
| `maxRows` | `500` | Default result row cap. |
| `queryTimeoutMs` | `30000` | Default statement timeout. |

## Data and security

- Connections live in `$DSH_HOME/dsh-db.json` (default `~/.dsh/dsh-db.json`): versioned JSON, atomic writes, mode 0600.
- Passwords are stored in plaintext in that user-owned file — the same trust model as `dsh-ssh`'s host passwords. They are never returned to the browser; `db_list` only reports whether a password is set.
- Every `/api/dsh-db/*` route is loopback-only (socket address, Host, Origin and `Sec-Fetch-Site` fences).
- TLS modes: off, encrypted without certificate verification (common for cloud databases), and encrypted with system-CA verification. Custom CA files are not supported yet.
- SQL results are returned verbatim and may contain sensitive data; `db_query` output enters the session log.
- The read-only allowlist is UX plus defence in depth, not a permissions model. Enforce real limits with database grants.

## Development (no build step)

The plugin ships plain JavaScript in `lib/`; there is no TypeScript or bundling step, so `lib/` is the source:

```
dsh-db/
├── package.json          # dsh.bundle.patch / dsh.client / exports
├── cordis.patch.yml      # inserts the id=db plugin row
├── icon.svg
├── lib/
│   ├── index.js          # host entry: Config / routes / tools / prompt section
│   ├── store.js          # ~/.dsh/dsh-db.json store and validation
│   ├── engine.js         # pools, tree queries, SQL execution, read-only policy
│   ├── routes.js         # /api/dsh-db route family (loopback fence)
│   ├── tools.js          # db_list / db_search / db_schema / db_query
│   ├── values.js         # cell normalization, identifier quoting, read-only allowlist
│   ├── http.js           # bounded JSON body / JSON response helpers
│   ├── loopback.js       # loopback trust fence (adapted from dsh-ssh, Apache-2.0)
│   ├── dsh-home.js       # $DSH_HOME resolution
│   ├── drivers/
│   │   ├── mysql.js      # mysql2/promise adapter
│   │   └── postgres.js   # pg adapter
│   └── client.js         # browser half (DSH module-loader format, React.createElement)
├── README.md
└── README.en.md
```

- The host half is ordinary ESM; `mysql2`, `pg`, `@deepseek-ai/schemastery` and `@deepseek-ai/dsh-tools` resolve through the profile's runtime rules.
- The browser half ships in the DSH lazy-CJS bundle format:

  ```js
  window.__ModuleLoader__.load({ id: 'dsh-db', factory: (require) => { /* ... */ } })
  ```

  It only `require('react')` (a platform-baseline module), so no `dsh.client.external` entry and no JSX/tsdown step is needed.
- The panel registers its sidebar row through `ctx.slots.inject('sidebar.panellist')` and its page through `ctx.slots.inject('main')`, the same public slots `dsh-ssh` uses.
- Styles are injected once from `apply`, scoped under `.dshdb-root`, and use DSH's `--dsw-*` theme tokens with light/dark fallbacks.

## Stuck on "loading" after idling?

Fixed in 0.2.1: MySQL drops pooled connections after its `wait_timeout`. Metadata queries now time out after 15 s; a dead connection (`ECONNRESET`, `PROTOCOL_SEQUENCE_TIMEOUT`, …) discards the pool and retries once on a fresh one. The browser adds 20 s (control plane) / 40 s (metadata) deadlines, so a stalled request becomes a retryable error instead of an endless spinner. Restart DSH Desktop after upgrading.

## Table search returns 404?

The browser bundle and the Host process are from different versions: the new UI calls `/api/dsh-db/search`, but the running Host still has the old route table. Quit DSH Desktop from the tray and start it again. From 0.3.2, if the Host lacks `/search`, the client falls back to the existing `/tree` filter for the current database instead of surfacing a 404.

## Known limitations

- MySQL/MariaDB and PostgreSQL only; no SQLite, SQL Server or Oracle.
- One SQL statement per execution (`multipleStatements` is off; read-only mode rejects multi-statement payloads outright).
- Result sets are truncated client-side (500 rows by default, 5000 max); SQL is never rewritten to add `LIMIT`.
- No cancel button; the driver and server `statement_timeout` bound each statement (30 s default).
- Read-only connections reuse the pool. Writable connections discard the session after each statement so `USE` / `SET` / temporary-table state cannot leak into the next query (one extra connect per write).
- PostgreSQL's tree stays inside the connection's database; MySQL lists every database (system databases are marked in the UI).
- Row counts come from statistics (`TABLE_ROWS` / `reltuples`) and are approximate.
- No custom CA, client certificates or automatic SSH-tunnel setup. For a jump host, open a tunnel with `ssh_tunnel` and connect to `127.0.0.1:<local port>`.
- No virtual scrolling; very large result sets are already truncated to keep the browser responsive.

## Publish to GitHub

The repository ships with `.gitignore`, LICENSE, NOTICE and a GitHub Actions test workflow. Install Git, and preferably [GitHub CLI](https://cli.github.com/) with `gh auth login`, then run from this directory:

```powershell
.\publish-github.ps1 -RepoName dsh-db -Visibility public
```

You can also double-click `publish-github.cmd`, which invokes the same script with `-ExecutionPolicy Bypass`.

The script runs `git init`, commits, and uses `gh repo create --source . --push` to create and push the repository. Without `gh`, it asks you to create an empty repository at https://github.com/new and paste its URL, then pushes. Use `-Visibility private` for a private repository.

Run `git status` first to confirm `node_modules/`, `*.tgz` and `package-lock.json` are ignored.

## Credits

- Plugin structure, panel-slot usage and the loopback fence follow [`@linxin666/dsh-ssh`](https://www.npmjs.com/package/@linxin666/dsh-ssh) (Apache-2.0).
- DSH plugin/tool/client-module contracts: [DeepSeek Harness docs](https://deepseek-harness.github.io/).
