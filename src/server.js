/**
 * server.js — 模块 1 + 4：HTTP 服务 / 浏览入口
 *   GET  /api/bookmarks            ?cursor=0&limit=20   读文件库，分页（按 created_at 倒序）
 *   GET  /api/bookmarks/find       ?at=YYYY-MM-DD       定位首个 created_at<=该日末尾的帖子 offset
 *   GET  /api/meta                                   库统计
 *   POST /api/sync                                  经 CDP 实时抓 x.com 书签并入库（需调试 Edge 在线）
 *   静态 /  -> public/index.html
 *
 * 同时承担两个模块：
 *   - 模块 1 的「对外 API」：浏览端通过 /api/bookmarks 取数据，/api/sync 触发抓取；
 *   - 模块 4 的「浏览 server 入口」：托管前端 public/index.html（无限滚动 + 时间跳转）。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const store = require('./store');
const fetcher = require('./fetcher');
const imageStates = require('./image-states');
const templates = require('./templates');
const imageCache = require('./image-cache');
const { XiaohongshuPublisher } = require('./xhs-cdp-publish');

const ROOT = path.resolve(__dirname, '..');
const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(ROOT, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' };

function send(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}
function sendFile(res, fp) {
  const ext = path.extname(fp);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  fs.createReadStream(fp).pipe(res);
}

/** 读取请求体（JSON 用），返回字符串 */
function readBody(req, limit = 1e6) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > limit) { req.destroy(); reject(new Error('请求体过大')); }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  try {
    if (u.pathname === '/api/bookmarks') {
      const cursor = parseInt(u.searchParams.get('cursor') || '0', 10) || 0;
      const limit = Math.min(parseInt(u.searchParams.get('limit') || '20', 10) || 20, 50);
      return send(res, 200, store.page(cursor, limit));
    }
    if (u.pathname === '/api/bookmarks/find') {
      const at = u.searchParams.get('at');           // YYYY-MM-DD
      if (!at) return send(res, 400, { error: 'missing at=YYYY-MM-DD' });
      const by = u.searchParams.get('by') || 'created_at';   // created_at | index（bookmarked_at 已弃用，无数据）
      const endOfDay = at + 'T23:59:59.999Z';
      return send(res, 200, store.findByTime(endOfDay, by));
    }
    if (u.pathname === '/api/meta') {
      return send(res, 200, store.getMeta());
    }
    if (u.pathname === '/api/sync' && req.method === 'POST') {
      try {
        const r = await fetcher.sync();
        return send(res, 200, { ok: true, ...r });
      } catch (e) {
        // 同步失败（如调试 Edge 未运行 / Cookie 过期）属可预期情况，返回 ok:false + 清晰错误，避免裸 500
        return send(res, 200, { ok: false, error: String(e && e.message || e) });
      }
    }
    if (u.pathname === '/api/image-states') {
      return send(res, 200, imageStates.readAll());
    }
    if (u.pathname === '/api/image-state' && req.method === 'POST') {
      try {
        const body = await readBody(req);
        const { base, action } = JSON.parse(body || '{}');
        if (!base) return send(res, 400, { ok: false, error: 'missing base' });
        let r;
        if (action === 'favorite') r = imageStates.setFavorite(base, true);
        else if (action === 'unfavorite') r = imageStates.setFavorite(base, false);
        else r = imageStates.toggleFavorite(base); // 默认 toggle
        return send(res, 200, { ok: true, ...r });
      } catch (e) {
        return send(res, 400, { ok: false, error: String(e && e.message || e) });
      }
    }
    if (u.pathname === '/api/favorite-posts') {
      // 反查：所有「含至少一张被收藏图片」的帖子（不依赖 resync，状态在 image-states.json）
      const bases = new Set(imageStates.getFavoritedBases());
      const c = store.load();
      const items = c.items.filter((p) => (p.media || []).some((m) => {
        const base = (m.url || m.thumb || '').replace(/:\w+$/, '');
        return bases.has(base);
      }));
      return send(res, 200, { items, total: items.length });
    }
    if (u.pathname === '/api/templates') {
      if (req.method === 'GET') return send(res, 200, { items: templates.list() });
      if (req.method === 'POST') {
        try {
          const body = JSON.parse(await readBody(req) || '{}');
          if (body.action === 'delete') {
            templates.remove(body.id);
            return send(res, 200, { ok: true });
          }
          const tpl = templates.save(body);
          return send(res, 200, { ok: true, template: tpl });
        } catch (e) {
          return send(res, 400, { ok: false, error: String(e && e.message || e) });
        }
      }
    }
    if (u.pathname === '/api/publish' && req.method === 'POST') {
      try {
        const body = JSON.parse(await readBody(req) || '{}');
        const { imageUrl, imageUrls, title, content, tags, aiDeclaration, scheduledAt } = body;
        const urls = imageUrls || (imageUrl ? [imageUrl] : []);
        if (!urls.length) return send(res, 400, { ok: false, error: 'missing imageUrl(s)' });
        const bases = urls.map((u) => (String(u).replace(/:\w+$/, '')).split('?')[0]);
        const localPaths = await Promise.all(urls.map((u) => imageCache.downloadToTemp(u)));
        const publisher = new XiaohongshuPublisher({ port: Number(process.env.XHS_CDP_PORT || 9222) });
        const r = await publisher.publish({
          imagePaths: localPaths,
          title: title || '',
          content: content || '',
          tags: Array.isArray(tags) ? tags : [],
          aiDeclaration: !!aiDeclaration,
          scheduledAt: scheduledAt || undefined,
          dryRun: !!body.dryRun,
        });
        let published = false;
        if (r.published && r.url) {
          imageStates.markPublished(bases, { title: title || '', content: content || '', tags: Array.isArray(tags) ? tags : [], url: r.url });
          published = true;
        }
        return send(res, 200, { ok: r.published, published, publishedBases: bases, ...r });
      } catch (e) {
        // 把 AggregateError（如多地址连接重试全部失败）等底层错误展开为可读信息
        let msg = (e && Array.isArray(e.errors) && e.errors.length)
          ? e.errors.map((x) => (x && x.message) || String(x)).filter(Boolean).join('；')
          : ((e && e.cause && e.cause.message) || (e && e.message) || String(e));
        if (!msg) msg = '未知错误（无错误信息，请查看服务器控制台）';
        return send(res, 200, { ok: false, error: msg });
      }
    }
    // 静态托管
    let fp = path.join(PUBLIC, u.pathname === '/' ? 'index.html' : u.pathname);
    if (!fp.startsWith(PUBLIC)) return send(res, 403, { error: 'forbidden' });
    if (fs.existsSync(fp) && fs.statSync(fp).isFile()) return sendFile(res, fp);
    // SPA 回退
    const idx = path.join(PUBLIC, 'index.html');
    if (fs.existsSync(idx)) return sendFile(res, idx);
    res.writeHead(404); res.end('not found');
  } catch (e) {
    send(res, 500, { ok: false, error: String(e && e.message || e) });
  }
});

server.listen(PORT, () => {
  console.log('x-bookmarks server  →  http://localhost:' + PORT);
  console.log('  GET  /api/bookmarks?cursor=&limit=  浏览分页');
  console.log('  GET  /api/bookmarks/find?at=YYYY-MM-DD  时间跳转定位');
  console.log('  POST /api/sync                     从 x.com 抓取并入库');
});
