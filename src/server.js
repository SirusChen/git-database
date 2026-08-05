/**
 * server.js — 模块 1 + 4：HTTP 服务 / 浏览入口
 *   GET  /api/bookmarks            ?cursor=0&limit=20   读文件库，分页（按 bookmarked_at 倒序）
 *   GET  /api/bookmarks/find       ?at=YYYY-MM-DD       定位首个 bookmarked_at<=该日末尾的帖子 offset
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
      const by = u.searchParams.get('by') || 'created_at';   // created_at | bookmarked_at
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
