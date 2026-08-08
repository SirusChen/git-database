# 技术方案：X 书签画廊 × 小红书发布增强

> 状态：方案文档（尚未实现）。最后更新 2026-08-08。
> 源码位置：`D:\Workspace\git-database`（x-bookmarks 项目根）。

## 1. 需求决策汇总

| # | 决策点 | 结论 |
|---|--------|------|
| F1 | 大图左右翻页范围 | **两者结合**（同帖多图先翻，到边界跳相邻帖） |
| F2/F4 | 收藏/已发布状态存储 | 独立 `data/image-states.json`（按图片 base URL 索引，resync 不丢） |
| F3 | 仅看收藏入口 | 独立 `/favorites.html`（独立滚动位置，不影响 `xbook:scrollPos`） |
| F4 | 每篇小红书笔记图数 | **每张笔记 1 张图**（选 N 张发 N 篇，发布器不改） |
| F4 | 发帖入口 | 独立 `/publish.html` |
| F4 | 选图来源 | 全部画廊图 + 可切「仅收藏」 |
| F4 | 模板内容 | 标题+正文(占位符)+标签+AI声明，存 `data/templates.json`，前端可增删改 |
| F4 | 发布前置 | 自动下载远程图 + `/api/publish`→CDP 发布器（需调试 Edge 在线+小红书登录） |
| 交互 | favorites 交互默认与 index 一致 | 复用卡片渲染/虚拟滚动/灯箱(左右翻+收藏+已发)/滚动持久化(独立 key) |
| 数据 | image-states 是否新增全局增量 id | **否**：以图片 base URL 为主键，稳定且 resync 不丢 |

## 2. 目标与范围

四个功能：
1. 大图模式左右切换上一张/下一张（两者结合）。
2. 大图模式【收藏图片】toggle，状态落 `image-states.json`，大图可显示是否已收藏。
3. 新增「仅看收藏帖子」入口（`/favorites.html`），筛选含收藏图的帖子，不影响主列表滚动位置，交互与 index 一致。
4. 定制发帖模板 + 选图 + 一键发布；记录已发布图片状态与帖子内容到 data；大图展示「已发小红书」状态。

## 3. 模块分类与代码规范（重点）

### 3.1 目录与模块划分

```
git-database/
├─ src/
│  ├─ server.js              # 仅做 HTTP 路由分发，业务逻辑下沉到模块
│  ├─ store.js               # 书签库（已有，基本不动；新增 getByIds）
│  ├─ image-states.js        # 【新增】收藏/发布状态读写（独立 json）
│  ├─ templates.js           # 【新增】发帖模板读写
│  ├─ image-cache.js         # 【新增】远程 CDN 图下载到本地临时目录
│  ├─ xhs-cdp-publish/       # 已有发布器（publish.html 经 /api/publish 调用）
│  └─ global.js / normalize.js / fetcher.js / cdp-fetch.js / resync-retry.js  # 已有，不动
├─ public/
│  ├─ index.html             # 主画廊（改造：卡片带 data 属性 + 接 lightbox 模块）
│  ├─ favorites.html         # 【新增】收藏页（index 同构视图）
│  ├─ publish.html           # 【新增】发布页（模板管理+选图+发布）
│  ├─ virtual-scroll.js      # 已有 UMD 虚拟滚动
│  ├─ lightbox.js            # 【新增】UMD 公共灯箱（左右翻+收藏+已发状态）
│  └─ app-gallery.js / app-favorites.js / app-publish.js  # 【新增】各页编排脚本（可选拆分）
├─ data/
│  ├─ bookmarks.jsonl        # 已有，不动（resync 会 replaceAll）
│  ├─ meta.json / globals.json # 已有，不动
│  ├─ image-states.json      # 【新增】收藏/发布状态，按图片 base URL 索引
│  └─ templates.json         # 【新增】发帖模板
```

### 3.2 前端模块职责
- `virtual-scroll.js`（UMD，已有）：通用虚拟列表，三页面共用。
- `lightbox.js`（UMD，新增）：从 `index.html` 抽出灯箱逻辑，暴露 `openLightbox({ flatIndex, flatList, getState, onToggleFavorite })`；内部处理大图加载、‹/› 翻页（flat 序列 ±1）、Esc 关闭、收藏按钮、已发徽标+链接。**三页面共用，避免重复实现**。
- `index.html` / `favorites.html` / `publish.html`：只做**编排**（数据加载、卡片渲染调用、绑定按钮），业务逻辑放模块。
- 页面脚本若变长，拆为 `app-gallery.js` / `app-favorites.js` / `app-publish.js`，保持「单页一个编排文件」。

### 3.3 后端模块职责
- `store.js`：书签库，提供 `page/findByTime/getMeta/...`，**新增** `getByIds(ids)` 供收藏页取帖；不碰 image-states。
- `image-states.js`：封装 `readAll() / toggleFavorite(base) / markPublished(base, info) / getState(base)`，json 文件低频读写 + 内存缓存。
- `templates.js`：封装 `list() / save(tpl) / remove(id)`。
- `image-cache.js`：封装 `downloadToTemp(url)` → 本地临时路径（复用 https/fetch，pbs.twimg.com 走代理）。
- `server.js`：只注册路由、调用上述模块、统一错误返回 `{ok, error}`。

### 3.4 代码规范约定
- **零第三方依赖**：沿用项目约定，仅 Node 内置模块；前端 UMD，无打包器。
- **命名/风格**：文件 `kebab-case`；模块单一职责；中文注释风格与现有源码一致（顶部块注释说明职责）。
- **错误处理**：业务逻辑错误返回 `{ok:false, error}` 而非裸 500；发布类错误明确提示「调试 Edge 未在线 / 未登录小红书」。
- **低频 I/O**：状态文件内存缓存 + 必要时单次落盘（参照 store.js 的 `replaceAll` 思路）。
- **URL 规范化**：图片 key 统一用 `base = (m.url || m.thumb).replace(/:\w+$/, '')`，与 `cardHTML` 一致，避免 `:large`/`:small` 后缀导致 key 分裂。

## 4. 数据模型与存储

### 4.1 `globals.json`（保持现状）
仅存书签自增 `seq`，**不为 image-states 新增全局 id**。

### 4.2 `data/image-states.json`（新增，不以自增 id）
```json
{
  "<图片baseURL>": {
    "favorited": true,
    "published": {
      "title": "...", "content": "...", "tags": ["..."],
      "url": "https://www.xiaohongshu.com/...", "at": "2026-08-08T..."
    }
  }
}
```
**为何不引入全局增量 id**：
1. 图片已由 URL 唯一标识，URL 即天然主键，无需再生成 id。
2. 引入自增 id 需在 `globals.json` 增 seq，并在「帖子 media ↔ state」间维护 `id↔url` 映射，纯增复杂度、无收益。
3. 收藏/发布是「图片维度」标注，按 URL 直接读写幂等、resync 安全（bookmarks 重排不影响）。
4. 若需按收藏时间排序/批量操作，在 state 内加 `favoritedAt` 时间戳字段即可，不必全局 id。

### 4.3 `data/templates.json`（新增）
```json
[
  {
    "id": "t1", "name": "默认-AI插画",
    "title": "{{author}} 的AI插画",
    "content": "来源：{{text}}\n描述：{{desc}}",
    "tags": ["AI生成"], "aiDeclaration": true
  }
]
```
占位符：`{{text}}`(原帖文字) / `{{desc}}`(发布时手填) / `{{author}}`(原作者)。发布页可选模板或临时手填。

## 5. F1 大图左右翻页（两者结合）
- 前端构建 **flat 图片序列**：遍历 `allItems`，把每条 `media[]` 按顺序展开为 `{ postId, mediaIdx, full, base }`。
- 该序列天然满足「两者结合」：同帖多图在序列中相邻（先翻同帖），帖边界自然接下一条帖——无需额外分支逻辑。
- 卡片图加 `data-post-id` / `data-media-idx`；点击定位 `flatIndex`；灯箱 ‹/› = `flatIndex ± 1`（首/尾禁用按钮，不循环），支持 ←/→ 键。
- `base` 同时作为收藏/发布 key。

## 6. F2 收藏图片（toggle）
- 灯箱【收藏图片】按钮，初始态由 `image-states.json` 决定（前端一次性拉全量缓存，文件小）。
- 点击 → `POST /api/image-state { base, action:'toggle' }` → `image-states.js` 翻转 `favorited`，返回新状态。
- 按钮文案「收藏图片」⇄「取消收藏」；大图始终显示当前是否已收藏。
- 存独立文件 → 全量 resync（replaceAll）不丢。

## 7. F3 仅看收藏帖子（/favorites.html，交互同 index）
- `/favorites.html` 是 `index.html` 的**同构视图**：复用 `cardHTML` 渲染、虚拟滚动、`lightbox.js`（左右翻+收藏+已发）、滚动位置持久化（**独立 key** `xbook:scrollPos:favorites`）。
- **共享的交互**：点图开灯箱（功能完全一致）、跳转日期（按 `created_at`，帖子带时间）、回到顶部。
- **差异**：数据来自 `GET /api/favorite-posts`；无「同步书签」按钮（收藏页不触发抓取）；用独立滚动 key → 完全不触动主列表 `xbook:scrollPos`。
- `index.html` 顶部加「收藏」入口按钮链接到该页。

## 8. F4 模板 + 选图 + 一键发布
- **模板管理**：`/publish.html` 经 `GET/POST /api/templates` 增删改；也支持临时手填一套。
- **选图**：网格缩略展示全部画廊图，可切「仅收藏」视图，多选。
- **一键发布**：对每张选中图依次 `POST /api/publish { imageUrl, title, content, tags, aiDeclaration }`：
  1. `image-cache.js` 下载 `imageUrl` 到本地临时目录；
  2. 调 `XiaohongshuPublisher.publish({ imagePath, title, content, tags, aiDeclaration })`；
  3. 成功 → `image-states.js.markPublished(base, {...})`；
  4. 逐张串行 + 小间隔（防风控），前端显示进度。
- **大图状态**：灯箱读 `image-states`，`published` 存在则显示「✅ 已发小红书」徽标 + 小红书帖子链接。

## 9. 后端 API 汇总
| 方法 | 路径 | 作用 |
|------|------|------|
| GET | `/api/image-states` | 全量 `{base:state}`，前端缓存 |
| POST | `/api/image-state` | `{base, action}` 翻转收藏 |
| GET | `/api/favorite-posts` | 含收藏图的帖子列表 |
| GET/POST | `/api/templates` | 模板读写 |
| POST | `/api/publish` | 下载+发布+记录（需调试 Edge 在线） |
| 静态 | `/favorites.html` `/publish.html` `/lightbox.js` | 新页面/模块 |

## 10. 实施顺序
1. `src/image-states.js` + `/api/image-states`、`/api/image-state`
2. 抽 `public/lightbox.js`，`index.html` 接入（含 F1 左右翻 + F2 收藏 + 已发状态占位）
3. `src/store.js` 加 `getByIds`；`/api/favorite-posts` + `favorites.html`（F3，交互同 index）
4. `src/templates.js` + `/api/templates`；`src/image-cache.js` + `/api/publish`；`publish.html`（F4）
5. 联调（需调试 Edge 在线 + 小红书登录）

## 11. 风险与注意
- 发布强依赖调试 Edge + 小红书登录态；环境不可用明确报错，不静默。
- 批量发布串行 + 间隔，防风控；发布前二次确认。
- `image-states.json` 并发写：发布串行即可，收藏 toggle 加轻量写锁。
- 远程图下载失败兜底（CDN 偶发不可达，pbs.twimg.com 走代理）。

## 12. 默认假设（可推翻）
- 收藏与已发布状态合并存同一份 `image-states.json`。
- `/favorites.html` 复用同一套灯箱（支持左右翻 + 收藏/已发状态）。
- 大图「已发小红书」展示徽标 + 小红书链接。
- 模板占位符默认 `{{text}}` / `{{desc}}` / `{{author}}`。
