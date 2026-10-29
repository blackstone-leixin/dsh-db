## Add blackstone-leixin/dsh-db

**Plugin:** https://github.com/blackstone-leixin/dsh-db  
**Entry:** `data/plugins/blackstone-leixin__dsh-db.yml`  
**Category:** Tools & Capabilities (`tools`)

DSH database plugin for MySQL/MariaDB and PostgreSQL:

- connection manager stored in `~/.dsh/dsh-db.json` (mode 0600), passwords never returned to the browser or agent
- schema tree: databases/schemas → tables/views → columns, with type, nullability, default, primary key and comments
- table-name search scoped to the current database/schema or across all databases
- SQL console with keyword/table/column completion, result grid, configurable row cap and statement timeout
- database-enforced read-only mode by default (MySQL `START TRANSACTION READ ONLY`, PostgreSQL `BEGIN TRANSACTION READ ONLY`)
- four agent tools: `db_list`, `db_search`, `db_schema`, `db_query`
- all `/api/dsh-db/*` routes are loopback-only

`package.json` declares `dsh.bundle` with `cordis.patch.yml`, and the repository ships prebuilt `lib/` JavaScript, so the plugin installs from source without a separate build step. The `dsh-plugin` topic and the required topics are added to the repository.

### Checklist

- [x] One entry file, no README edits
- [x] `dsh.bundle` manifest and `cordis.patch.yml` at the repository root
- [x] Real, working code (not a placeholder or meta-package)
- [x] `dsh-plugin` topic on the repository
- [ ] Repository is at least 1 day old (the PR is opened after that)
- [ ] Submission gate / CI
