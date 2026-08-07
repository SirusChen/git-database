# x-bookmarks — X 书签归档浏览器

把 x.com 的书签抓下来存成本地文件库，并提供网页浏览（虚拟滚动 + 按时间跳转）。
全部本地运行，不依赖任何外部数据库服务。

---

## 架构

```
x.com（GraphQL Bookmarks 接口，经 Clash 代理可达）
        ▲  CDP 重放（经已登录调试 Edge :9222，复用浏览器会话；零第三方依赖）
        │  或  纯 Node（备用传输，被 x.com TLS 指纹封锁，本环境不可用）
src/fetcher.js ──翻页抓取 + 规范化──► src/store.js ──写入──► data/bookmarks.jsonl
        │                                          ▲
        │  POST /api/sync 触发（默认 cdp）            │ 读取
        ▼                                          │
src/server.js (HTTP :3000) ── GET /api/bookmarks ──┘
        │  同时静态托管
        ▼
public/index.html ──虚拟滚动 + 按时间跳转──► 浏览器
```

四个模块（源码均在 `src/`，另含一个数据契约模块）：
1. **抓取 + API**（`src/fetcher.js` + `src/server.js`）：默认**经已登录调试 Edge (CDP) 直接重放 Bookmarks GraphQL 请求**（复用浏览器已登录会话，无需 cookies.json）；另保留纯 Node 代理传输作为备用（被 x.com TLS 指纹封锁，本环境不可用）。对外提供 HTTP API，`/api/sync` 按需实时刷新，日常浏览只读本地文件库。
2. **文件库 + 数据结构**（`src/store.js` + `src/normalize.js` + `data/`）：帖子以 JSONL 存储，按 `id` 去重、append-only；`meta.json` 记录计数与时间范围；`normalize.js` 统一定义库内 schema（原始节点→规范化），fetcher 复用。
3. **README**（本文件）：项目设计。
4. **浏览入口**（`public/index.html` + `src/server.js` + `public/virtual-scroll.js`）：虚拟滚动浏览全量书签（`loadAll()` 一次性拉全量，由 `VirtualList` 接管滚动）；按发布时间跳转高亮；视口顶部帖子持久化到 localStorage（见「全量加载」一节）。

---

## 目录结构

```
项目根目录：`D:\Workspace\git-database`

├─ package.json         # pnpm 项目配置（scripts: start / dev / sync）
├─ src/                 # 所有模块源码（按模块拆分）
│  ├─ store.js          # 模块2：文件库（jsonl + meta）、去重、分页、时间定位
│  ├─ normalize.js      # 模块2：数据结构（原始节点 → 统一 schema，fetcher 复用）
│  ├─ fetcher.js        # 模块1：抓取（CDP 默认 / 纯 Node 备用）双传输 → 规范化 → 翻页入库
│  ├─ cdp-fetch.js      # 传输层 B：经调试 Edge (CDP) 重放 GraphQL 分页接口
│  └─ server.js         # 模块1+4：HTTP API + 静态托管（浏览入口）
├─ public/index.html    # 模块4：浏览前端（虚拟滚动 + 时间跳转）
├─ bookmarks_params.json / cookies.json  # 仅供「纯 Node 备用传输」使用的接口参数 / 会话密钥（见下）
├─ data/
│  ├─ bookmarks.jsonl   # 每行一条规范化帖子（当前 3604 条真实书签，2026-08-07 全量重同步落盘）
│  └─ meta.json         # 计数 / 时间范围 / 最近同步
└─ README.md
```

> **cookies.json / bookmarks_params.json 仅「纯 Node 备用传输」需要**：CDP（默认）传输复用调试 Edge 里已登录的 x.com 会话，不读取这两个文件。纯 Node 模式才需要它们（且当前被 x.com TLS 指纹封锁，实际不可用）。

---

## 运行

### 0. 前置：调试 Edge + Clash 代理

`/api/sync` 默认走 CDP 传输，**需要调试 Edge 在线且已登录 x.com**：
- 启动调试 Edge（默认 `127.0.0.1:9222`，独立 profile），例如用 `edge-debug-browser` 技能的
  `launch-edge-debug.ps1` 并带上 `-Proxy 127.0.0.1:7890`（让 Edge 经 Clash 访问 x.com）。
- **Clash 代理需在线**：Edge 通过它访问 x.com；代理离线则同步返回 `200+{ok:false, error}`（提示代理离线）。
- 日常浏览（读本地库、前端渲染）**不需要**代理或 Edge；仅 `/api/sync` 需要。

### 1. 安装依赖 & 启动服务（pnpm）
```bash
pnpm install      # 初始化项目（零运行时依赖，仅生成 pnpm-lock.yaml）
pnpm start        # node src/server.js → http://localhost:3000
# 开发热重载：pnpm dev   （node --watch，改文件自动重启）
```
> 本机可用命令：`pnpm start` / `pnpm dev` / `pnpm sync`。
> 若 PowerShell 中 `pnpm` 不可用，可用 `corepack pnpm@9 <cmd>` 代替（pnpm 经 corepack 安装）。

### 2. 同步（抓取并入库）
浏览器打开 `http://localhost:3000` → 点「同步书签」（即 `POST /api/sync`，默认 CDP 增量），
或命令行：
```bash
pnpm sync                  # 等价于 node -e "require('./src/fetcher').sync({transport:'cdp'})"
# 或
curl -X POST http://localhost:3000/api/sync
```
- **增量同步**（默认，`fetcher.sync`）：从最新收藏页往前翻，碰到「本地已同步边界」即停，只把新收藏 `append` 进 `jsonl`（index 续接当前 seq，最新=最大）。日常新增收藏用这个，秒级。
- **全量重同步**（`fetcher.resync` / `resync-retry.js --cdp`）：清空重抓整个集合，`replaceAll` 一次性整体落盘（最旧收藏=index 1）。仅在数据损坏 / 隔很久没同步 / 想重排 index 时用。
- 在 x.com 上**取消收藏**不会从 `jsonl` 删除旧条目（增量是 append-only），需全量 `resync` 才能剔除。

### 3. 浏览
- **虚拟滚动（全量加载）**：`loadAll()` 一次性拉取全部书签（分页 `limit=100` 累加到内存数组 `allItems`），交由 `public/virtual-scroll.js` 的 `VirtualList` 接管滚动、仅渲染可视区（上下各 10 条 overscan）。详见下方「全量加载」一节。
- **时间跳转**：选一个日期 → 「跳转」，定位到首个 `created_at`（帖子真实发布时间）不晚于该日的帖子并高亮。
- **视口恢复**：滚动/离开页面时把视口顶部帖子缓存到 `localStorage`（key `xbook:topPost`），再次打开时从该帖开始加载。

---

## API 参考

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/bookmarks?cursor=0&limit=20` | 分页读取（按 `created_at` 倒序），返回 `{items, nextCursor, total}` |
| GET | `/api/bookmarks/find?at=YYYY-MM-DD&by=created_at` | 时间定位，返回 `{offset, post}`（offset 用于前端滚动）；`by` 默认 `created_at`，亦可 `index`（`bookmarked_at` 已弃用，无数据） |
| GET | `/api/meta` | 库统计 `{count, minCreatedAt, maxCreatedAt, lastSync}` |
| POST | `/api/sync` | 默认经 CDP（调试 Edge 在线）实时重放抓取并增量入库，返回 `{ok, added, seen, pages, total, seq, reachedExisting}`（失败为 `200 + {ok:false, error}`） |

---

## 数据 Schema（每条帖子）

```json
{
  "id": "推文ID",
  "index": "自增 id（入库时由 global.nextId() 赋值，全局唯一且单调递增，仅持久化于本文件 bookmarks.jsonl）",
  "created_at": "发布时间 ISO（由 legacy.created_at 转换，时间跳转的真实基准）",
  "author": { "id": "作者ID", "screen_name": "@名", "name": "昵称", "avatar": "头像URL（可能缺失）" },
  "text": "正文全文",
  "lang": "ja",
  "source": "Twitter for iPhone",
  "sensitive": false,
  "conversation_id": "线程ID",
  "is_quote": false,
  "media": [ { "type": "photo|video|gif", "url": "原图", "width": 1664, "height": 2432, "thumb": "缩略图" } ],
  "entities": { "hashtags": ["ZenlessZoneZero"], "mentions": ["someone"], "urls": [{"expanded":"...", "display":"..."}] },
  "stats": { "likes": 0, "retweets": 0, "replies": 0, "quotes": 0, "bookmarks": 0, "views": 0 }
}
```

字段来源（基于 x.com GraphQL `Bookmarks` 接口真实响应）：
- 核心：书签列表 `timeline.instructions[].entries[]` → `content.itemContent.tweet_results.result`
- 翻页游标：`content.cursorType:"Bottom"` 的 `content.value`
- 媒体尺寸：`extended_entities.media[].original_info.{width,height}`（用于锁定卡片宽高比，避免加载时跳动）
- 时间跳转基准：`created_at`（帖子真实发布时间，数据可靠且分散）。
  > 注：x.com 的 Bookmarks 接口**不返回每条的真实收藏时间**，故库内不存 `bookmarked_at`；排序与时间跳转统一以 `created_at` 为准，`index` 作为「书签列表顺序」的稳定序号/兜底排序键（**与 created_at 无关**）。
- 自增 id（`index`）：由 `src/global.js` 维护的全局计数器（`data/globals.json` 仅存 `{seq}`，低频落盘），`global.nextId()` 单调递增赋值。**index 严格跟随书签列表顺序**——API 返回顺序为「最新收藏在前、最旧收藏在后」：
  - **全量重同步 `fetcher.resync()`**：在内存中按抓取顺序累积全部帖子（首屏=最新收藏，Bottom 游标向后=更早收藏），全部抓完后整体反转使最旧收藏排到首位，自调用 `global.nextId()` 从 1 自增，最后 `store.replaceAll` 一次性低频落盘（最旧收藏 = index 1）。
  - **增量同步 `fetcher.sync()`**：新抓到的书签依次 `global.nextId()` 取号（最新收藏永远拿到最大 index）。
  - 因此 `index` 即用户书签列表中的位置序号，与 `created_at`（发布时间）解耦。

---

## 验证状态（Verification）

| 模块 | 状态 | 方法 |
|------|------|------|
| store.js 文件库 | ✅ 已落盘 | `data/bookmarks.jsonl` 现 3604 条真实书签（2026-08-07 全量重同步）；append 去重、page 分页、findByTime 定位逻辑均验证通过。 |
| server.js HTTP API | ✅ 验证 | curl 验证 `/api/bookmarks` 分页、`/api/bookmarks/find?at=` 时间定位（offset 精确）、未来日期返回 offset=0；`/api/meta` 返回 `count:3604`。 |
| fetcher.js 抓取（CDP） | ✅ 实跑通过 | 调试 Edge 经 Clash 代理访问 x.com；direct GraphQL replay 实测翻到 3604 条互不相同书签、在干净 `200 / 空页` 处自然结束（全程零 429）。增量 `sync` 实测 `pages:1` 早停（已同步边界）、`added=0`、磁盘零改动。 |
| public/index.html 前端 | ✅ 验证 | 虚拟滚动接管、时间跳转（按 `created_at`）高亮、灯箱、实体链接渲染、视口 localStorage 恢复均验证；3604 条全量加载顺畅。 |

截图佐证：`frontend_view.png`（初始视图）、`frontend_jump.png`（跳转后视图）

---

## 已知限制

- **`/api/sync` 需要调试 Edge (9222) 在线且已登录 x.com**：默认 CDP 传输复用浏览器会话；Edge 经 Clash 代理（默认 `127.0.0.1:7890`）访问 x.com。代理离线或 Edge 未运行则同步返回 `200+{ok:false, error}`（明确提示，非 500）。纯 Node 传输被 x.com TLS 指纹封锁，本环境不可用。
- **`x-client-transaction-id` 由浏览器自动带**：CDP 模式重放时复用首屏请求的 `x-client-transaction-id`，无需 Node 端生成。仅当回到纯 Node 传输时才需补 transaction-id 生成逻辑（社区有成熟算法）。
- **日常浏览不依赖代理/Edge**：读本地文件库（`/api/bookmarks`、`/api/bookmarks/find`）与前端渲染都不需要，仅图片/视频走 `pbs.twimg.com` CDN（该 CDN 直连可达，无需代理）。
- **queryId 轮换（仅纯 Node 模式相关）**：`bookmarks_params.json` 里的 `query_id` 会随 x.com 前端更新而轮换；CDP 模式直接复用浏览器真实请求，不受此影响。
- **不存真实收藏时间**：x.com 的 Bookmarks 接口不返回每条收藏时刻，库内不存 `bookmarked_at`，统一以 `created_at`（发布时间）作为时间跳转与排序基准；`index` 作为稳定序号。
- **头像可能缺失**：部分书签节点的作者对象不含头像字段，此时卡片不显示头像。
- **媒体仅存 URL**：图片/视频以 `pbs.twimg.com` 链接形式保存，浏览时由浏览器直连 CDN 加载，未做本地缓存。
- **`cookies.json` 含会话密钥**：仅供纯 Node 模式，请妥善保管，不再使用时删除。

---

## 全量加载（loadAll）说明与分析

> 实现位置：`public/index.html` 的 `loadAll()`（`fetch('/api/bookmarks?cursor&limit=100')` 分页拉全部 → `vlist.setItems(allItems)`），并在 `loadAll()` 上方有对应代码注释。

### 为什么必须全量加载
虚拟滚动（`VirtualList`）依赖**全量数据**才能用内部 `layer` 撑出完整滚动条、为每条帖子计算滚动偏移。`loadAll()` 通过 `limit=100` 分页把全部帖拉进内存数组 `allItems`，再一次性交给虚拟列表。这是虚拟滚动的固有前提，并非性能取舍——**只要用固定滚动条 + 绝对定位复用 DOM 的虚拟滚动方案，就无法回避全量数据**。

### 当前量级（3604 条）是否合理
**合理，推荐保持。** 依据：
- 文本量小：3604 条规范化帖约数 MB JSON，单次 fetch + 解析在毫秒级；内存中仅渲染可视区约 ~30 条 DOM，其余按 `id` 复用，占用极低。
- 体验更稳：所有 offset 在服务端已知，时间跳转（`/api/bookmarks/find` 算 offset → `scrollToIndex`）与「恢复上次视口顶部」都不依赖滚动中异步补数据，无游标漂移、无滚动中段白屏。
- 带宽可控：卡片图片走 `pbs.twimg.com` CDN 且 `loading="lazy"`，不会一次性请求上千张图。

### 何时不再合理（书签 > ~10k 条）
- 全量 JSON 文本达 10–30 MB，首屏等待变长、解析与内存成本上升。
- **届时改造方向**（非当前必需）：
  1. 服务端按 offset 范围分页（`/api/bookmarks?cursor&limit` 已支持）；
  2. 前端虚拟列表改为**按需拉取区间**（命中已拉区间则跳过，带前端缓存）；
  3. 用 **IndexedDB** 缓存已拉数据，跨会话复用，避免每次全量重拉；
  4. 跳转仍走 `/api/bookmarks/find` 先在服务端算 offset，再只拉该区间。

---

## 待修复 / TODO

| # | 项目 | 状态 | 说明 / 触发条件 |
|---|------|------|----------------|
| 1 | 全量重同步恢复书签库 | ✅ 已完成 | 2026-08-07 经 CDP 全量重同步，`data/bookmarks.jsonl` 落盘 3604 条真实书签，`meta.json` 的 `count` 同步回升。 |
| 2 | CDP 抓取实跑验证 | ✅ 已完成 | 调试 Edge + Clash 代理通道打通，direct GraphQL replay 翻到 3604 条且自然结束（零 429）。 |
| 3 | `x-client-transaction-id` | 🟢 已由 CDP 解决 | CDP 复用浏览器首屏请求的 transaction-id，纯 Node 才需补生成逻辑（当前纯 Node 被封、走不到）。 |
| 4 | `queryId` 轮换 | 🟢 CDP 不受影响 | CDP 直接复用浏览器真实请求；仅纯 Node 备用模式需从 JS bundle 重抓 queryId。 |
| 5 | `cookies.json` 会话密钥 | 🟡 安全 | 含 `ct0` 等密钥，不再使用时删除（已 gitignore）；CDP 模式不读取。 |
| 6 | 旧 temp 目录 / 诊断脚本 | ✅ 已清理 | 早期临时副本与 `_diag_*`/`_probe_*`/`_obsolete_diag` 诊断产物已删除。 |
| 7 | 大数据量优化（IndexedDB + 区间分页） | ⚪ 未来 | 仅当书签 > ~10k 时再做（见「全量加载」一节），当前 3604 量级无需。 |

> 说明：以上 1–4 依赖「调试 Edge 在线 + Clash 代理可达」这一前置条件；5–7 与代理无关。
