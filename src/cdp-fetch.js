/**
 * cdp-fetch.js — 传输层 B：经已登录调试 Edge (CDP) 直接重放 x.com Bookmarks GraphQL 分页接口。
 *
 * 为什么不直接「滚动页面」：
 *  通过 agent-browser 驱动调试 Edge「无限滚动」时，触发不到后续分页——无论 scroll / 键盘 / 触底等待，
 *  Bookmarks GraphQL 请求只出现 1 次，第 2 页及以后永远加载不出来。
 *  但「直接重放 GraphQL 请求」可行：浏览器发出的首屏请求自带 x-client-transaction-id 等反爬头，
 *  在页面上下文里用 fetch 重放（带上这些头、只换 cursor）能稳定拿到后续每一页（2026-08-07 探针验证：第 2 页 200 + 22 节点）。
 *
 * 实现：
 *  - 直连本地 CDP（默认 127.0.0.1:9222，零第三方依赖：仅用 Node 内置 WebSocket 全局对象 + http）。
 *  - 抓首屏 Bookmarks 请求的 URL / 头（含 x-client-transaction-id）/ body + 响应体里的 bottom 游标。
 *  - 之后每页用同一套头（复用首屏的 x-client-transaction-id）在页面上下文 fetch 重放，只换 cursor。
 *  - 累积所有「原始 GraphQL 节点」（= tweet_results.result），交给 fetcher.persistRawNodes 统一反转/赋 index/落盘。
 *
 * 关键实测结论（2026-08-07）：
 *  - agent-browser 的 `network request` 不回请求头，故本模块改用原生 CDP Network 域抓头。
 *  - 复用同一 x-client-transaction-id 对多页重放有效（x.com 校验宽松）。若某页重放非 200，则停止（视为到底/被限流）。
 */
const WebSocket = globalThis.WebSocket;
const http = require('http');
const { parseTimeline } = require('./fetcher');
const { normalize } = require('./normalize');
const store = require('./store');

const CDP_PORT = Number(process.env.CDP_PORT) || 9222;
const BOOKMARKS_URL = 'https://x.com/i/bookmarks';

function getJSON(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => { let s = ''; res.on('data', d => s += d); res.on('end', () => { try { resolve(JSON.parse(s)); } catch (e) { reject(e); } }); }).on('error', reject);
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** 极简 CDP 会话封装（基于 Node 内置 WebSocket 全局对象） */
class Cdp {
  constructor(wsUrl) { this.ws = new WebSocket(wsUrl); this.id = 0; this.pending = new Map(); this.handlers = {}; this._open = false; }
  open() {
    return new Promise((resolve, reject) => {
      this.ws.onopen = () => { this._open = true; resolve(); };
      this.ws.onmessage = e => this._msg(e.data);
      this.ws.onerror = e => { if (!this._open) reject(e.error || e.message || e); };
    });
  }
  _msg(data) {
    let m; try { m = JSON.parse(data); } catch (_) { return; }
    if (m.id && this.pending.has(m.id)) { this.pending.get(m.id)(m); this.pending.delete(m.id); return; }
    if (m.method && this.handlers[m.method]) this.handlers[m.method](m.params);
  }
  on(method, cb) { this.handlers[method] = cb; }
  send(method, params = {}) { return new Promise(res => { const id = ++this.id; this.pending.set(id, res); this.ws.send(JSON.stringify({ id, method, params })); }); }
  close() { try { this.ws.close(); } catch (_) {} }
}

async function getBrowserWs() {
  try {
    const v = await getJSON(`http://127.0.0.1:${CDP_PORT}/json/version`);
    if (!v.webSocketDebuggerUrl) throw new Error('webSocketDebuggerUrl 缺失');
    return v.webSocketDebuggerUrl;
  } catch (e) {
    throw new Error(`无法连接本地 CDP（127.0.0.1:${CDP_PORT}）。请确认调试 Edge 已以 --remote-debugging-port=${CDP_PORT} 启动且已登录 x.com。(${e.message})`);
  }
}

/** 打开/复用 Bookmarks 标签页，返回 {browser, page, targetId, created} 并已在 page 上启用 Network/Runtime/Page */
async function openBookmarksTab() {
  const bws = await getBrowserWs();
  const browser = new Cdp(bws);
  await browser.open();
  // 复用已存在的 bookmarks 页；没有则新建（created=true）
  let targetId, pageWs, created = false;
  const targets = await getJSON(`http://127.0.0.1:${CDP_PORT}/json`);
  const existing = targets.find(t => t.type === 'page' && /bookmarks/i.test(t.url || ''));
  if (existing && existing.webSocketDebuggerUrl) {
    targetId = existing.id; pageWs = existing.webSocketDebuggerUrl;
  } else {
    const r = await browser.send('Target.createTarget', { url: 'about:blank' });
    targetId = r.result.targetId;
    pageWs = `ws://127.0.0.1:${CDP_PORT}/devtools/page/${targetId}`;
    created = true;
  }
  const page = new Cdp(pageWs);
  await page.open();
  await page.send('Network.enable');
  await page.send('Runtime.enable');
  await page.send('Page.enable');
  return { browser, page, targetId, created };
}

/**
 * 全量抓取（传输层 B）：直接重放 Bookmarks GraphQL 分页。
 * 返回 { nodes: [原始 tr 节点...], pages, reachedEnd }。
 */
async function fetchAll({ maxPages = 500, betweenPageMs = 1500, firstPageMs = 25000, stopIfSeen = false } = {}) {
  const { browser, page, targetId, created } = await openBookmarksTab();

  // —— 捕获首屏 Bookmarks 请求 + 响应 ——
  let cap = null;          // { requestId, req, body, cursor, nodes }
  let resolve1, reject1;
  const page1Done = new Promise((res, rej) => { resolve1 = res; reject1 = rej; });

  page.on('Network.requestWillBeSent', params => {
    const req = params.request;
    if (/graphql\/[^/]+\/Bookmarks/.test(req.url || '') && !cap) {
      cap = { requestId: params.requestId, req };
    }
  });
  page.on('Network.loadingFinished', async params => {
    if (!cap || params.requestId !== cap.requestId) return;
    try {
      const r = await page.send('Network.getResponseBody', { requestId: params.requestId });
      const body = r.result && r.result.body;
      if (!body) return;
      const j = JSON.parse(body);
      const parsed = parseTimeline(j);
      cap.body = body; cap.cursor = parsed.bottom; cap.nodes = parsed.nodes;
      resolve1(cap);
    } catch (e) { reject1(e); }
  });

  // 导航触发首屏
  await page.send('Page.navigate', { url: BOOKMARKS_URL });

  let capture;
  try {
    capture = await Promise.race([
      page1Done,
      sleep(firstPageMs).then(() => { throw new Error(`等待首屏 Bookmarks 响应超时（${firstPageMs / 1000}s）。代理上游可能离线 / 未登录 / Cookie 过期`); })
    ]);
  } catch (e) {
    if (created) { try { browser.send('Target.closeTarget', { targetId }); } catch (_) {} }
    try { page.close(); } catch (_) {}
    throw e;
  }

  // 复用信息：只保留 x.com 需要的头（浏览器会自动补 cookie/host/UA）
  const baseHeaders = capture.req.headers;
  const keep = ['authorization', 'x-csrf-token', 'x-client-transaction-id', 'x-twitter-auth-type', 'content-type', 'x-twitter-client-language', 'x-twitter-active-user'];
  const replayHeaders = {};
  for (const k of keep) if (baseHeaders[k]) replayHeaders[k] = baseHeaders[k];
  const txid = replayHeaders['x-client-transaction-id'] || '(无)';

  const baseUrl = capture.req.url;
  let baseVars = {}; try { const u = new URL(baseUrl); baseVars = JSON.parse(decodeURIComponent(u.searchParams.get('variables') || '{}')); } catch (_) {}
  let baseBody = {}; try { baseBody = JSON.parse(capture.req.postData || '{}'); } catch (_) {}
  if (!baseBody.variables) baseBody.variables = {};

  const allNodes = [];
  let page1New = 0;
  if (stopIfSeen) {
    // 增量模式：page 1 只收「本地 store 没有」的新节点；其余视为已同步边界
    for (const n of capture.nodes) {
      const id = normalize(n).id;
      if (id && !store.has(id)) { allNodes.push(n); page1New++; }
    }
  } else {
    allNodes.push(...capture.nodes);
  }
  let pages = 1;
  let cursor = capture.cursor;
  // 去重 / 防循环终止：记录已见 id，并跟踪上一页 bottom 游标是否真的推进
  const seen = new Set();
  for (const n of capture.nodes) { const id = normalize(n).id; if (id) seen.add(id); }
  const cursorSeen = new Set([cursor]);   // 收集所有出现过的 bottom 游标，任一重复即判定循环
  let reachedEnd = !cursor;
  console.error(`[cdp-fetch] page 1 ok, nodes=${capture.nodes.length}, new=${stopIfSeen ? page1New : capture.nodes.length}, unique=${seen.size}, txid=${txid.slice(0, 24)}…`);
  if (stopIfSeen && page1New === 0) {
    console.error(`[cdp-fetch] page 1 全部已存在（0 新增），无新收藏，停止`);
    cursor = null; reachedEnd = true;   // 阻止进入翻页循环
  }

  // 每页最多重试 10 次；x.com 对高频 GraphQL 重放会返回 429（限流），需用「长且递增」的冷却，
  // 而不是 2/4/6/8s 的短退避（那样会在限流期反复撞墙后放弃整轮同步）。
  const MAX_ATTEMPTS = 20;
  let consecutive429 = 0;   // 连续被限流的页数，用于触发「全局长冷却」
  let lastStatus = null;    // 最近一次重放的状态码
  while (cursor && pages < maxPages) {
    if (pages >= 2000) { console.error(`[cdp-fetch] 已达 2000 页硬上限（约 40000 条），疑似游标异常，停止以防失控`); break; }
    await sleep(betweenPageMs);
    const u = new URL(baseUrl);
    const v = Object.assign({}, baseVars); v.cursor = cursor;
    u.searchParams.set('variables', JSON.stringify(v));
    const newUrl = u.toString();
    const bodyObj = JSON.parse(JSON.stringify(baseBody));
    bodyObj.variables = Object.assign({}, baseBody.variables); bodyObj.variables.cursor = cursor;
    const newBody = JSON.stringify(bodyObj);
    const expr = `(async()=>{try{const r=await fetch(${JSON.stringify(newUrl)},{method:'POST',headers:${JSON.stringify(replayHeaders)},body:${JSON.stringify(newBody)}});const t=await r.text();return JSON.stringify({status:r.status,body:t});}catch(e){return JSON.stringify({error:String(e)});}})()`;

    let parsed = null, ok = false;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const res = await page.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      const val = res && res.result && res.result.result && res.result.result.value ? JSON.parse(res.result.result.value) : null;
      lastStatus = val && val.status;
      if (val && !val.error && val.status === 200) {
        try { parsed = parseTimeline(JSON.parse(val.body)); ok = true; break; }
        catch (e) { console.error(`[cdp-fetch] page ${pages + 1} 解析异常（重试 ${attempt}）：${e.message.slice(0, 100)}`); }
      } else {
        const is429 = val && val.status === 429;
        // 429=限流：必须长冷却（15s 起、递增到 120s 封顶），给 x.com 时间解除节流；
        // 其它错误用短退避。无论哪种都继续重试，直到 MAX_ATTEMPTS。
        const back = is429 ? Math.min(120000, 15000 * attempt) : 2000 * attempt;
        console.error(`[cdp-fetch] page ${pages + 1} 重放未成功（status=${val && val.status}${val && val.error ? ' err=' + val.error.slice(0, 60) : ''}），第 ${attempt}/${MAX_ATTEMPTS} 次重试，冷却 ${back}ms…`);
        await sleep(back);
        if (is429 && attempt >= 3) break;   // 限流靠「全局长冷却」解决，不必在本页反复短退避
      }
    }
    if (!ok) {
      // 判断是否因限流(429)失败：若是，做一次性「全局长冷却」（期间零请求）让 x.com 解除节流，然后重试同一页；
      // 否则视为真实故障（代理上游断 / Cookie 过期），退出本轮同步。
      if (lastStatus === 429) {
        consecutive429++;
        console.error(`[cdp-fetch] page ${pages + 1} 连续第 ${consecutive429} 次被限流，全局冷却 5 分钟后再试（已抓 ${seen.size} 条唯一）…`);
        await sleep(300000);
        continue;   // 重试同一页（cursor 不变）
      }
      console.error(`[cdp-fetch] page ${pages + 1} 重试 ${MAX_ATTEMPTS} 次仍失败（非限流），停止同步（已累积 ${allNodes.length} 节点）。多半是代理上游瞬断或 Cookie 过期。`);
      break;
    }
    consecutive429 = 0;
    // 统计本页新增的唯一 id；增量模式(stopIfSeen)下「已存在=本轮已见 或 本地 store 已有」，只收集新节点
    let newCount = 0;
    const pageNewNodes = [];
    for (const n of parsed.nodes) {
      const id = normalize(n).id;
      if (!id) continue;
      if (seen.has(id) || (stopIfSeen && store.has(id))) continue;  // 已见过 / 已入库 → 跳过
      seen.add(id);
      newCount++;
      if (stopIfSeen) pageNewNodes.push(n);   // 增量只把新节点带回去
    }
    if (!parsed.nodes.length) { console.error(`[cdp-fetch] page ${pages + 1} 为空，判定到底`); reachedEnd = true; break; }
    if (newCount === 0) { console.error(`[cdp-fetch] page ${pages + 1} 未产生新收藏（已抵达已同步边界或游标循环），停止`); reachedEnd = true; break; }
    if (cursorSeen.has(parsed.bottom)) { console.error(`[cdp-fetch] page ${pages + 1} 的 bottom 游标重复（循环），停止`); reachedEnd = true; break; }
    cursorSeen.add(parsed.bottom);
    if (stopIfSeen) allNodes.push(...pageNewNodes);
    else allNodes.push(...parsed.nodes);
    pages++;
    cursor = parsed.bottom;
    console.error(`[cdp-fetch] page ${pages} ok, new=${newCount}, unique=${seen.size}`);
  }

  if (created) { try { browser.send('Target.closeTarget', { targetId }); } catch (_) {} }
  try { page.close(); } catch (_) {}   // 只断开本进程的 CDP 调试 WS，绝不关闭整个调试 Edge
  return { nodes: allNodes, pages, reachedEnd };
}

module.exports = { fetchAll, openBookmarksTab, getBrowserWs, CDP_PORT, BOOKMARKS_URL };
