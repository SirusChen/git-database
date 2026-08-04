# x-bookmarks — X 书签归档浏览器

把 x.com 的书签抓下来存成本地文件库，并提供网页浏览（无限滚动 + 按时间跳转）。
全部本地运行，不依赖任何外部数据库服务。

---

## 架构

```
x.com（已登录的调试 Edge）
        │  CDP 页面内 fetch（Node 只做本地 CDP，请求由浏览器发出）
        ▼
fetcher.js ──翻页抓取 + 规范化──► store.js ──写入──► data/bookmarks.jsonl
        │                                          ▲
        │  POST /api/sync 触发                       │ 读取
        ▼                                          │
server.js (HTTP :3000) ── GET /api/bookmarks ──────┘
        │  同时静态托管
        ▼
public/index.html ──无限滚动 + 按时间跳转──► 浏览器
```

四个模块：
1. **抓取 + API**（`fetcher.js` + `server.js`）：经 CDP 抓书签（游标翻页），对外提供 HTTP API；`/api/sync` 按需实时刷新，日常浏览只读本地文件库。
2. **文件库**（`store.js` + `data/`）：帖子以 JSONL 存储，按 `id` 去重、append-only；`meta.json` 记录计数与时间范围。
3. **README**（本文件）：项目设计。
4. **浏览入口**（`public/index.html` + `server.js`）：向下滚动渐进加载帖子；按日期筛选首条帖子并跳转高亮。

---

## 目录结构

```
项目根目录：`D:\Workspace\git-database`

├─ package.json         # pnpm 项目配置（scripts: start / dev / seed / sync）
├─ server.js            # HTTP：API + 静态托管
├─ fetcher.js           # CDP 抓取 → 规范化 → 入库
├─ store.js             # 文件库读写（jsonl + meta）、去重、分页、时间定位
├─ seed.js              # 开发用：无代理时填充测试数据以联调（真实样本 + 合成）
├─ public/index.html    # 浏览前端（无限滚动 + 时间跳转）
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

### 0. 前置：调试 Edge + 代理（一次性）
抓取依赖一个**已登录 x.com 的调试 Edge**（用 `edge-debug-browser` skill 启动，开启 CDP 9222）：
```powershell
# 必须带 -Proxy，浏览器才能通过本机 SOCKS5 代理访问 x.com（直连被墙）
pwsh -File "$env:USERPROFILE\.workbuddy\skills\edge-debug-browser\scripts\launch-edge-debug.ps1" `
  -StartUrl https://x.com -Proxy "socks5://127.0.0.1:7890"
```
> **代理是硬性要求**：x.com 在大陆直连不可达，`/api/sync` 必须经由本机 SOCKS5 代理
> （如 Clash，默认 `127.0.0.1:7890`）。启动脚本已加 `-Proxy` 参数，并自动对 `localhost`
> 加 `<-loopback>` 绕过，因此前端（`localhost:3000`）不走代理、始终可加载。
> **请确认 Clash 的节点/TUN 在线且能访问外网**，否则同步会快速失败（fetch 超时 20s），
> 报错形如 `NETERR: fetch 超时(20s) | 无法连接 x.com…`。

确认 `http://127.0.0.1:9222/json` 上有 `https://x.com/...` 标签页且已登录。

### 1. 安装依赖 & 启动服务（pnpm）
```bash
pnpm install      # 初始化项目（零运行时依赖，仅生成 pnpm-lock.yaml）
pnpm start        # node server.js → http://localhost:3000
# 开发热重载：pnpm dev   （node --watch，改文件自动重启）
```
> 本机可用命令：`pnpm start` / `pnpm dev` / `pnpm seed` / `pnpm sync`。
> 若 PowerShell 中 `pnpm` 不可用，可用 `corepack pnpm@9 <cmd>` 代替（pnpm 经 corepack 安装）。

### 2. 首次同步（抓取并入库）
浏览器打开 `http://localhost:3000` → 点「同步书签」（即 `POST /api/sync`），
或命令行：
```bash
pnpm sync                  # 等价于 node -e "require('./fetcher').sync()..."
# 或
curl -X POST http://localhost:3000/api/sync
```
同步会翻页抓取整页书签，按 `id` 去重写入 `data/bookmarks.jsonl`。可多次同步，只追加新的。

### 3. 浏览
- **无限滚动**：向下滚动自动加载下一页（`GET /api/bookmarks?cursor=...`）。
- **时间跳转**：选一个日期 → 「跳转」，定位到首个 `bookmarked_at` 不晚于该日的帖子并高亮。

---

## API 参考

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/bookmarks?cursor=0&limit=20` | 分页读取（按 `bookmarked_at` 倒序），返回 `{items, nextCursor, total}` |
| GET | `/api/bookmarks/find?at=YYYY-MM-DD` | 时间定位，返回 `{offset, post}`（offset 用于前端滚动） |
| GET | `/api/meta` | 库统计 `{count, minBookmarkedAt, maxBookmarkedAt, lastSync}` |
| POST | `/api/sync` | 经 CDP 实时抓 x.com 书签并入库，返回 `{added, seen, pages, total}` |

---

## 数据 Schema（每条帖子）

```json
{
  "id": "推文ID",
  "created_at": "发布时间 ISO（由 legacy.created_at 转换）",
  "bookmarked_at": "入库时间 ISO（首次同步时写入，按抓取顺序倒序）",
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
- 时间跳转基准：`bookmarked_at`（x.com 接口**不返回**收藏时间，本程序在首次入库时写入；因 API 按书签时间倒序返回，故按抓取顺序递减 1s 写入以保留新旧顺序）

---

## 验证状态（Verification）

| 模块 | 状态 | 方法 |
|------|------|------|
| store.js 文件库 | ✅ | `seed.js` 填充 60 条（1 真 + 59 合成），append 去重、page 分页、findByTime 定位均通过 |
| server.js HTTP API | ✅ | curl 验证：`/api/meta`（60条/日期范围）、`/api/bookmarks` 分页（cursor=0→3→6）、`/api/bookmarks/find?at=` 时间定位（offset精确）、未来日期返回 offset=0 |
| fetcher.js 抓取 | ⚠️ 代码正确，环境阻塞 | CDP 页面内 fetch + AbortSignal.timeout(20s) 快速失败；当前 Clash 代理节点离线导致 `/api/sync` 返回 NETERR（预期行为）。代理恢复后 `POST /api/sync` 即可实时抓取。此前已成功抓取过 40 条真实书签（pages 1–2）。 |
| public/index.html 前端 | ✅ | 浏览器驱动验证：初始加载 20 卡片（首条为真实推文 AyanoCanvas）、无限滚动加载至 40+、时间跳转 2026-07-25 → 定位到 offset 33 并滚动高亮、实体链接（#话题/@提及/URL）蓝色渲染、stats 行完整 |

截图佐证：`frontend_view.png`（初始视图）、`frontend_jump.png`（跳转后视图）

---

## 已知限制

- **依赖调试 Edge 在线 + 代理可达**：`/api/sync` 需要 CDP 9222 上有已登录的 x.com 标签页，**且本机 SOCKS5 代理（如 Clash）节点在线能访问外网**。直连 x.com 被墙，代理不通则同步快速失败（见前置说明）。
- **日常浏览不依赖代理**：读本地文件库（`/api/bookmarks`、`/api/bookmarks/find`）与前端渲染都不需要代理，仅图片/视频走 `pbs.twimg.com` CDN（该 CDN 直连可达，无需代理）。
- **queryId 轮换**：`bookmarks_params.json` 里的 `query_id` 会随 x.com 前端更新而轮换；若同步报 `errors`，需重新从 x.com JS bundle 抓取最新 `queryId`（或参考 x-reader 自动发现）。
- **`bookmarked_at` 为归档时间**：并非 x.com 真实的收藏时刻，是本次同步时记录的顺序时间。
- **头像可能缺失**：部分书签节点的作者对象不含头像字段，此时卡片不显示头像。
- **媒体仅存 URL**：图片/视频以 `pbs.twimg.com` 链接形式保存，浏览时由浏览器直连 CDN 加载，未做本地缓存。
- **`cookies.json` 含会话密钥**：请妥善保管，不再使用时删除。
