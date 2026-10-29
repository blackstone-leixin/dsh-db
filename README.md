# dsh-db · DeepSeek Harness 数据库连接插件（MySQL / PostgreSQL）

[English](README.en.md) | 中文

为 DeepSeek Harness（DSH）Web GUI 与桌面端提供的数据库运维插件：**连接管理 + 库表字段树 + 表名搜索 + SQL 控制台 + 4 个 Agent 工具**。参考同目录风格的 `@linxin666/dsh-ssh` 插件实现，全部通过官方 NPM SDK 挂载，零修改 DSH 源码。

## 能力

| 能力 | 说明 |
| --- | --- |
| 连接管理 | 新建 / 编辑 / 删除 / 测试，支持 MySQL / MariaDB 与 PostgreSQL；密码只保存在本机 `~/.dsh/dsh-db.json`（0600），不会回传给浏览器或模型 |
| 树形浏览 | 连接 → 库（MySQL）/ 模式（PostgreSQL）→ 表 / 视图 → 字段；字段显示类型、可空、默认值、主键、注释，表显示近似行数与注释 |
| 表名搜索 | 树顶部输入表名，默认只搜当前打开的库/schema；点右侧「当前库/全部库」切换范围。最多 200 个结果，点结果自动定位并 `SELECT … LIMIT 100` 预览 |
| 断开连接 | 连接行悬停 → 电源按钮，关闭该连接的所有池化连接；下次查询自动重连 |
| 右键菜单 | 表/视图（含搜索结果）：查看表结构（字段详情弹窗）、预览、复制表名/全限定名、复制给 Agent、刷新字段；连接：编辑/断开/删除；字段：插入/复制 |
| 表结构搜索 | 表结构弹窗可按字段名、类型或注释即时过滤字段 |
| 快速取数 | 双击表自动生成并执行 `SELECT * FROM <表> LIMIT 100`；单击字段把带引号的字段名插入编辑器光标处 |
| SQL 控制台 | 多行编辑器、`Ctrl+Enter` 执行、粘性表头结果网格、执行耗时 / 行数 / 截断提示、错误原样展示 |
| SQL 补全 | 输入时提示关键字 / 表 / 字段，`Ctrl+Space` 手动打开；支持 `库.`、`表.` 和 `FROM users u` 别名；字符串/注释内不打扰 |
| 只读保护 | 连接默认只读：SQL 先经过语句白名单，再在数据库强制的只读事务中执行；写操作会被拒绝。只有用户能在 GUI 中关闭只读 |
| 池化连接 | 每个（连接, 库）复用连接池，空闲 30 分钟回收；修改/删除连接立即丢弃旧池，避免复用旧凭据 |
| Agent 工具 | `db_list` / `db_search` / `db_schema` / `db_query`，与 GUI 共享同一份连接配置与只读策略 |
| 双语界面 | 跟随浏览器语言自动切换中文 / English |

## 安装

前置：DSH ≥ 0.2.1-rc.2，Node ≥ 22.19。插件目录需要先安装自己的依赖（`mysql2` / `pg` / `@deepseek-ai/schemastery`）。

### Windows 桌面端（DSH Desktop）

桌面端**不会**把 `dsh` 写进系统 PATH——普通 PowerShell 里执行 `dsh` 会提示“无法识别”。请从**托盘菜单 → 打开 DSH 终端**（右下角托盘图标，找不到就点 `^` 展开隐藏图标）打开应用自带的终端：该终端已经把私有的 `dsh`、`pnpm`、`node` shim 放到 PATH，并默认作用于当前激活的 `desktop` profile。

推荐用 **tarball 安装**：让 profile 的 pnpm 自动解析并安装本插件的依赖，不用先处理 linked checkout 的 `node_modules`。

```powershell
cd "<path-to-dsh-db>"

# 1) 打包成本地 tarball
pnpm pack

# 2) 安装 tarball（会自动安装 mysql2 / pg / schemastery）
dsh plugin add ".\dsh-db-0.4.1.tgz"

# 3) 从托盘退出并重启 DSH Desktop
```

也可以继续用 linked checkout 方式（需要先 `pnpm install`）：

```powershell
cd "<path-to-dsh-db>"
pnpm install
dsh plugin add "<path-to-dsh-db>"
```

如果确实要在普通 PowerShell 里执行，可用应用自带的 Node/pnpm/dsh 绝对路径：

```powershell
$node = "D:\Program Files\DeepSeek Harness\resources\runtime\primary-runtime\dependencies\node\bin\node.exe"
$pnpm = "D:\Program Files\DeepSeek Harness\resources\runtime\primary-runtime\dependencies\pnpm\bin\pnpm.cjs"
$dsh  = "D:\Program Files\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd"
cd "<path-to-dsh-db>"
& $node $pnpm install
& $dsh plugin --profile desktop add "$PWD"
```

### 从终端安装（普通 dsh web）

```sh
cd <本目录>
npm install        # 或 pnpm install / yarn
dsh plugin --profile desktop add "<本目录的绝对路径>"
```

安装后侧边栏出现「数据库」入口；`dsh plugin --profile desktop remove dsh-db` 可卸载。

> `dsh plugin add` 会把本包链接进 profile，并读取 `package.json` 的 `dsh.bundle.patch` 自动插入插件行（`cordis.patch.yml`）。如果手动复制到 `~/.dsh/profiles/<name>/node_modules/dsh-db`，还需要把 `cordis.patch.yml` 里的 `insert` 条目手动追加到 profile 的 `cordis.patch.yml`，并重启。
>
> 没有网络时，至少需要让 `mysql2` 与 `pg` 能从本插件目录解析到；缺驱动不会导致 DSH 启动失败，GUI 与工具会给出「驱动未安装」的可操作错误。

## 使用

1. 点击侧边栏「数据库」→「新建连接」。
2. 填写名称、类型、主机、端口、用户名、密码；MySQL 可填默认库，PostgreSQL 留空时使用与用户名同名的库。
3. 点「测试连接」可在保存前验证；「保存」后连接出现在左侧列表。
4. 展开连接 → 库/模式 → 表；双击表预览前 100 行，单击字段把字段名插入 SQL。
5. 在编辑器里写 SQL，`Ctrl+Enter`（macOS 为 `⌘+Enter`）执行；有选中文本时只执行选中部分。结果表格支持横向滚动与悬停查看长文本。
6. 树顶部有表名搜索框：输入时默认只搜当前打开的库/模式；点右侧「当前库/全部库」可切换范围。最多 200 个结果，点结果会自动定位到该表并预览前 100 行；`Esc` 清空搜索。
7. 鼠标移到连接行上，点电源图标可断开该连接的所有池化连接；下次查询/展开树时会自动重连。
8. 右键表/视图（包括搜索结果的表）：查看表结构（字段、类型、可空、默认值、主键、额外、注释）、预览前 100 行、复制名称、复制给 Agent、刷新字段；结构弹窗顶部可以按字段名/类型/注释过滤；右键字段可插入编辑器或复制；右键连接可编辑/断开/删除。

### SQL 自动补全

编辑器会在输入时自动弹出补全，也可以在光标处按 `Ctrl+Space`（macOS `⌘+Space`）或点工具栏「提示」手动打开：

- 关键字（`SELECT` / `FROM` / `JOIN` / `WHERE` / `GROUP BY` …）；
- 当前库/模式下已知的表和视图；
- 字段名、类型与主键标记；
- `库名.` 列出该库的表；`表名.` 或 `别名.` 列出该表的字段（支持 `FROM users u` 这种别名）；
- `FROM` / `JOIN` 之后优先提示表，`SELECT` / `WHERE` / `ON` 之后优先提示字段。

操作：`↑` / `↓` 选择，`Enter` 或 `Tab` 接受，`Esc` 关闭。补全数据来自一次性的库/schema catalog 请求（打开连接或点库/模式时预取），也兼容已经展开的树节点；在字符串或注释里不会弹出。

### 只读模式

新建连接默认勾选「只读连接」。只读模式下：

- 只允许 `SELECT` / `SHOW` / `DESCRIBE` / `EXPLAIN` / `WITH … SELECT` / `VALUES` / `TABLE`，并且一次只能执行一条语句；
- 语句还会在数据库强制的只读事务里执行（PostgreSQL `BEGIN TRANSACTION READ ONLY`，MySQL `START TRANSACTION READ ONLY`），即使白名单被绕过，数据库仍会拒绝写入；
- Agent 的 `db_query` 与 GUI 遵循同一开关。

需要写入（`INSERT` / `UPDATE` / `DDL` / 存储过程等）时，编辑连接并取消「只读连接」。请只对确实需要写入的库关闭，并优先使用数据库侧的只读账号做日常浏览。

## Agent 工具

| 工具 | 作用 |
| --- | --- |
| `db_list` | 列出已配置连接（名称、类型、地址、默认库、只读/可写） |
| `db_search` | 按表名子串跨库/模式搜索表与视图（最多 200 个），用于只知道部分表名的场景 |
| `db_schema` | 逐层查看结构：不传库/模式 → 列出库或模式；传 `database`（MySQL）/ `schema`（PostgreSQL）→ 列出表/视图；再传 `table` → 列出字段 |
| `db_query` | 执行单条 SQL，返回 Markdown 表格；默认最多 500 行、30 秒超时，可用参数覆盖（上限 5000 行 / 120 秒） |

### 在会话里使用

四个工具已经注册到每个会话，Agent 可以直接调用。GUI 默认不向模型宣告插件（`announceToAgent` 关闭，保持提示词干净），所以有两种用法：

- **直接点名**：`用 db_query 在连接 local-mysql 的 app 库查 users 的前 10 行`；结构不确定时先说 `用 db_schema 看 local-mysql 的 app.users 有哪些字段`。
- **复制给 Agent**：在编辑器工具栏点「复制给 Agent」。它会生成一段指令，包含连接名、数据库/模式、当前 SQL；如果编辑器为空、但刚点过某张表，会自动生成 `SELECT * FROM <表> LIMIT 100`。把复制的内容粘贴到会话发送即可。

想让模型自动知道插件存在，可在该插件的设置里打开 `announceToAgent`。Agent 不能创建/修改连接，也不能绕过连接的只读开关。

Agent **不能**创建、修改或删除连接，也不能读取密码。默认不向 Agent 宣告插件；需要时在设置中打开 `announceToAgent`。

## 配置

设置面板（该插件行的配置）提供：

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 总开关（路由、工具、提示词段落） |
| `announceToAgent` | `false` | 是否把插件能力写进系统提示词 |
| `maxRows` | `500` | 默认结果行数上限 |
| `queryTimeoutMs` | `30000` | 默认语句超时 |

## 数据与安全

- 连接配置：`$DSH_HOME/dsh-db.json`（默认 `~/.dsh/dsh-db.json`），版本化 JSON，原子写入，文件权限 0600。
- 密码以明文保存在该用户私有文件中（与 `dsh-ssh` 的主机密码同一信任模型）；插件不会把密码返回给浏览器，`db_list` 也只报告是否已设置密码。
- 所有 `/api/dsh-db/*` 路由只接受 loopback 请求（并校验 Host / Origin / `Sec-Fetch-Site`）；数据库凭据与 SQL 执行不会暴露给局域网。
- TLS 三档：关闭、加密但不校验证书（常见云数据库）、加密并校验证书（系统 CA）。暂不支持自定义 CA 文件。
- SQL 结果原样返回，可能包含敏感数据；`db_query` 的输出会进入会话记录。
- 只读白名单是 UX 与纵深防御，不是数据库权限模型；真正的边界应由数据库账号的 `SELECT` 授权保证。

## 开发说明（无构建步骤）

本插件**直接以 `lib/*.js` 作为发布产物**，没有 TypeScript / 打包步骤，因此 `lib/` 就是可读源码：

```
dsh-db/
├── package.json          # dsh.bundle.patch / dsh.client / exports
├── cordis.patch.yml      # 插入 id=db 的插件行
├── icon.svg
├── lib/
│   ├── index.js          # Host 入口：Config / 路由 / 工具 / 提示词
│   ├── store.js          # ~/.dsh/dsh-db.json 读写与校验
│   ├── engine.js         # 连接池、树查询、SQL 执行、只读策略
│   ├── routes.js         # /api/dsh-db 路由族（loopback fence）
│   ├── tools.js          # db_list / db_search / db_schema / db_query
│   ├── values.js         # 单元格归一化、标识符引用、只读白名单
│   ├── http.js           # 有界 JSON body / JSON 响应
│   ├── loopback.js       # loopback 信任围栏（改编自 dsh-ssh，Apache-2.0）
│   ├── dsh-home.js       # $DSH_HOME 解析
│   ├── drivers/
│   │   ├── mysql.js      # mysql2/promise 适配
│   │   └── postgres.js   # pg 适配
│   └── client.js         # 浏览器半区（DSH module loader 格式，React.createElement）
├── README.md
└── README.en.md
```

- Host 半区是普通 ESM，依赖 `mysql2`、`pg`、`@deepseek-ai/schemastery`、`@deepseek-ai/dsh-tools`，由 DSH 的 profile 解析规则加载。
- 浏览器半区导出的 `lib/client.js` 使用 DSH 的懒加载 CJS bundle 格式：

  ```js
  window.__ModuleLoader__.load({ id: 'dsh-db', factory: (require) => { /* ... */ } })
  ```

  只 `require('react')`（平台基线模块），因此无需声明 `dsh.client.external`，也不需要 tsdown/JSX。
- 面板通过 `ctx.slots.inject('sidebar.panellist')` 注册侧边栏行，通过 `ctx.slots.inject('main')` 注册中心页，与 `dsh-ssh` 使用同一组 public slot。
- 样式在 `apply` 时注入一个 `<style>`，全部挂在 `.dshdb-root` 下，配色使用 DSH 的 `--dsw-*` 主题变量（含浅色/深色回退）。

## 长时间空闲后一直“加载中”？

0.2.1 起已处理这个问题：连接池里的 MySQL 连接被服务端 `wait_timeout` 关掉后，元数据查询现在有 15 秒超时；检测到 `ECONNRESET` / `PROTOCOL_SEQUENCE_TIMEOUT` 等失效连接时会丢弃旧池、换新连接重试一次。浏览器端另有 20 秒（控制面）/ 40 秒（元数据）兜底，超时会显示错误和「重试」，不会再无限转圈。升级后记得重启桌面端。

## 搜索表名报 404？

这是前后端版本不一致：浏览器已经加载了新的搜索框，但 Host 进程里还是旧路由表，没有 `/api/dsh-db/search`。从托盘**彻底退出** DSH Desktop 再启动即可。0.3.2 起，如果 Host 仍没有 `/search`，前端会自动退回到 `/tree` 的当前库过滤，不会再直接报 404。

## 已知限制

- 只支持 MySQL/MariaDB 与 PostgreSQL；SQLite / SQL Server / Oracle 暂不支持。
- 一次只执行一条 SQL（驱动的 `multipleStatements` 关闭；只读模式还会主动拒绝多条语句）。
- 结果集在客户端截断（默认 500 行，最多 5000 行），不会自动改写 SQL 加 `LIMIT`；大表请自行加 `LIMIT`。
- 没有查询取消按钮；超时由驱动与服务端 `statement_timeout` 控制，默认 30 秒。
- 只读连接复用连接池；可写连接为避免 `USE` / `SET` / 临时表等会话状态串到下一次查询，每条语句执行后会丢弃该连接（写入场景下多一次建连开销）。
- PostgreSQL 树按当前连接的数据库展开，不跨库枚举；MySQL 会列出所有库（含系统库，界面标记为 `系统`）。
- 表行数来自统计信息（MySQL `TABLE_ROWS` / PostgreSQL `reltuples`），是近似值。
- 不支持自定义 CA、客户端证书、SSH 隧道内自动建连；需要跳板机时先用 `ssh_tunnel` 在本机开隧道，再连接 `127.0.0.1:<本地端口>`。
- 界面没有虚拟滚动；极大结果集只显示截断后的行，避免浏览器卡死。

## 发布到 GitHub

仓库已带 `.gitignore`、LICENSE、NOTICE 和 GitHub Actions 测试。安装 Git；推荐再安装 [GitHub CLI](https://cli.github.com/) 并执行 `gh auth login`，然后在本目录运行：

```powershell
.\publish-github.ps1 -RepoName dsh-db -Visibility public
```

也可以直接双击 `publish-github.cmd`（内部用 `-ExecutionPolicy Bypass` 调用上面的脚本）。

脚本会 `git init`、提交、用 `gh repo create --source . --push` 创建并推送仓库。没有 `gh` 时，脚本会提示你先在 https://github.com/new 创建空仓库，再粘贴 URL 完成推送。私有仓库把 `-Visibility` 改成 `private`。

发布前可以 `git status` 确认 `node_modules/`、`*.tgz`、`package-lock.json` 等已被忽略。

## 致谢

- 插件结构、panel slot 用法与 loopback 围栏参考了 [`@linxin666/dsh-ssh`](https://www.npmjs.com/package/@linxin666/dsh-ssh)（Apache-2.0）。
- DSH 插件/工具/客户端模块协议见 [DeepSeek Harness 文档](https://deepseek-harness.github.io/)。
