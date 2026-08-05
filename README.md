# x-bookmarks — X 书签归档浏览器

把 x.com 的书签抓下来存成本地文件库，并提供网页浏览（无限滚动 + 按时间跳转）。
全部本地运行，不依赖任何外部数据库服务。

---

## 架构

```
x.com（GraphQL Bookmarks 接口）
        ▲  SOCKS5 代理隧道 + TLS（Node 直连，需本机代理出网）
        │
src/fetcher.js ──翻页抓取 + 规范化──► src/store.js ──写入──► data/bookmarks.jsonl
        │                                          ▲
        │  POST /api/sync 触发                       │ 读取
        ▼                                          │
src/server.js (HTTP :3000) ── GET /api/bookmarks ──┘
        │  同时静态托管
        ▼
public/index.html ──无限滚动 + 按时间跳转──► 浏览器
```

四个模块（源码均在 `src/`，另含一个数据契约模块）：
1. **抓取 + API**（`src/fetcher.js` + `src/server.js`）：**纯 Node 直接模拟 x.com 的 GraphQL 请求**（不依赖任何浏览器/调试 Edge），经本机 SOCKS5 代理出网，游标翻页入库；对外提供 HTTP API，`/api/sync` 按需实时刷新，日常浏览只读本地文件库。
2. **文件库 + 数据结构**（`src/store.js` + `src/normalize.js` + `data/`）：帖子以 JSONL 存储，按 `id` 去重、append-only；`meta.json` 记录计数与时间范围；`normalize.js` 统一定义库内 schema（原始节点→规范化），fetcher 与 seed 共用。
3. **README**（本文件）：项目设计。
4. **浏览入口**（`public/index.html` + `src/server.js`）：向下滚动渐进加载帖子；按日期筛选首条帖子并跳转高亮。

---

## 目录结构

```
项目根目录：`D:\Workspace\git-database`

├─ package.json         # pnpm 项目配置（scripts: start / dev / seed / sync）
├─ src/                 # 所有模块源码（按模块拆分）
│  ├─ store.js          # 模块2：文件库（jsonl + meta）、去重、分页、时间定位
│  ├─ normalize.js      # 模块2：数据结构（原始节点 → 统一 schema，fetcher 与 seed 共用）
│  ├─ fetcher.js        # 模块1：纯 Node + SOCKS5 代理抓取 → 规范化 → 翻页入库（不依赖浏览器）
│  ├─ server.js         # 模块1+4：HTTP API + 静态托管（浏览入口）
│  └─ seed.js           # 联调：无代理时填充测试数据（真实样本 + 合成）
├─ public/index.html    # 模块4：浏览前端（无限滚动 + 时间跳转）
├─ bookmarks_params.json / cookies.json  # 接口参数 / 会话密钥（见下）
├─ data/
│  ├─ bookmarks.jsonl   # 每行一条规范化帖子（当前 1059 条：1000 真实 + 59 合成）
│  └─ meta.json         # 计数 / 时间范围 / 最近同步
└─ README.md
```

> `fetcher.js` 默认读取**项目根目录**的 `bookmarks_params.json`（接口参数）
> 与 `cookies.json`（会话密钥，含 `ct0`）。这两个文件来自之前的接口分析，需自行准备（已随项目放在 `git-database/` 根目录）。

---

## 运行

### 0. 前置：本机 SOCKS5 代理（一次性，无需浏览器）
抓取是**纯 Node**，但 x.com 在大陆直连不可达，必须由本机 SOCKS5 代理出网（如 Clash，默认 `127.0.0.1:7890`）。
> **代理是硬性要求**：`/api/sync` 经 `127.0.0.1:7890`（可用环境变量 `SOCKS_PROXY` / `HTTPS_PROXY` 覆盖）与 x.com 建隧道。
> **请确认 Clash 的节点/TUN 在线且能访问外网**，否则同步会快速失败，报错形如
> `无法与 x.com 建立连接（…）。多半是本地代理 … 的上游已离线——请确认 Clash/代理已启动…`。
> 日常浏览（读本地库、前端渲染）**不需要**代理；仅 `/api/sync` 需要。

### 1. 安装依赖 & 启动服务（pnpm）
```bash
pnpm install      # 初始化项目（零运行时依赖，仅生成 pnpm-lock.yaml）
pnpm start        # node src/server.js → http://localhost:3000
# 开发热重载：pnpm dev   （node --watch，改文件自动重启）
```
> 本机可用命令：`pnpm start` / `pnpm dev` / `pnpm seed` / `pnpm sync`。
> 若 PowerShell 中 `pnpm` 不可用，可用 `corepack pnpm@9 <cmd>` 代替（pnpm 经 corepack 安装）。

### 2. 首次同步（抓取并入库）
浏览器打开 `http://localhost:3000` → 点「同步书签」（即 `POST /api/sync`），
或命令行：
```bash
pnpm sync                  # 等价于 node -e "require('./src/fetcher').sync()..."
# 或
curl -X POST http://localhost:3000/api/sync
```
同步会翻页抓取整页书签，按 `id` 去重写入 `data/bookmarks.jsonl`。可多次同步，只追加新的。

### 3. 浏览
- **无限滚动**：向下滚动自动加载下一页（`GET /api/bookmarks?cursor=...`）。
- **时间跳转**：选一个日期 → 「跳转」，定位到首个 `created_at`（帖子真实发布时间）不晚于该日的帖子并高亮。

---

## API 参考

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/bookmarks?cursor=0&limit=20` | 分页读取（按 `created_at` 倒序），返回 `{items, nextCursor, total}` |
| GET | `/api/bookmarks/find?at=YYYY-MM-DD&by=created_at` | 时间定位，返回 `{offset, post}`（offset 用于前端滚动）；`by` 默认 `created_at` |
| GET | `/api/meta` | 库统计 `{count, minCreatedAt, maxCreatedAt, lastSync}` |
| POST | `/api/sync` | 纯 Node 经 SOCKS5 代理实时抓 x.com 书签并入库，返回 `{ok, added, seen, pages, total}`（失败为 `200 + {ok:false, error}`） |

---

## 数据 Schema（每条帖子）

```json
{
  "id": "推文ID",
  "created_at": "发布时间 ISO（由 legacy.created_at 转换，时间跳转的真实基准）",
  "ingested_at": "入库时间 ISO（本次同步时 new Date() 写入，仅作审计/兜底排序）",
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
- 时间跳转基准：`created_at`（帖子真实发布时间，数据可靠且分散）。`ingested_at` 为入库时间，仅供参考。
  > 注：x.com 的 Bookmarks 接口**不返回每条的真实收藏时间**，故库内不存 `bookmarked_at`；排序与时间跳转统一以 `created_at` 为准。

---

## 验证状态（Verification）

| 模块 | 状态 | 方法 |
|------|------|------|
| store.js 文件库 | ✅ | `seed.js` 填充 1059 条（1000 真实 + 59 合成），append 去重、page 分页、findByTime 定位均通过 |
| server.js HTTP API | ✅ | curl 验证：`/api/meta`（1059条/日期范围）、`/api/bookmarks` 分页（cursor=0→2）、`/api/bookmarks/find?at=` 时间定位（offset 1031 精确）、未来日期返回 offset=0 |
| fetcher.js 抓取 | ⚠️ 代码正确，待代理恢复实跑 | 纯 Node + SOCKS5 代理隧道 + TLS 已验证可建立隧道（与 curl 表现一致）；请求构造、头部、时间线解析、翻页均已单测通过。当前 Clash 代理**上游离线**导致 `/api/sync` 返回 `200+{ok:false, error}`（明确提示代理离线，非 500）。代理恢复后 `POST /api/sync` 即可实时抓取。此前已成功抓取过 1000+ 条真实书签。 |
| public/index.html 前端 | ✅ | 浏览器驱动验证：初始加载 20 卡片（首条为真实推文 AyanoCanvas）、无限滚动加载至 40+、时间跳转 2026-07-25 → 定位到 offset 1031 并滚动高亮、实体链接（#话题/@提及/URL）蓝色渲染、stats 行完整 |

截图佐证：`frontend_view.png`（初始视图）、`frontend_jump.png`（跳转后视图）

---

## 已知限制

- **`/api/sync` 需要本机 SOCKS5 代理可达**：纯 Node 直连 x.com 被墙，必须经由本机 SOCKS5 代理（如 Clash，默认 `127.0.0.1:7890`，可用 `SOCKS_PROXY` 覆盖）出网；代理不通则同步返回 `200+{ok:false, error}`（提示代理离线）。**不再依赖任何浏览器/调试 Edge**。
- **可能需 `x-client-transaction-id`**：x.com 部分接口会校验该头（浏览器自动带，纯 Node 不自带）。若代理恢复后 `/api/sync` 返回 403/特定错误，需在 `fetcher.js` 补一个 transaction-id 生成逻辑（社区有成熟算法），届时可据返回的错误片段补上。
- **日常浏览不依赖代理**：读本地文件库（`/api/bookmarks`、`/api/bookmarks/find`）与前端渲染都不需要代理，仅图片/视频走 `pbs.twimg.com` CDN（该 CDN 直连可达，无需代理）。
- **queryId 轮换**：`bookmarks_params.json` 里的 `query_id` 会随 x.com 前端更新而轮换；若同步报 `errors`，需重新从 x.com JS bundle 抓取最新 `queryId`（或参考 x-reader 自动发现）。
- **不存真实收藏时间**：x.com 的 Bookmarks 接口不返回每条收藏时刻，库内以 `created_at`（发布时间）作为时间跳转与排序基准，`ingested_at` 仅记录入库时刻。
- **头像可能缺失**：部分书签节点的作者对象不含头像字段，此时卡片不显示头像。
- **媒体仅存 URL**：图片/视频以 `pbs.twimg.com` 链接形式保存，浏览时由浏览器直连 CDN 加载，未做本地缓存。
- **`cookies.json` 含会话密钥**：请妥善保管，不再使用时删除。
