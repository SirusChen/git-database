/**
 * cdp-fetch.js — 传输层 B：经调试 Edge (CDP) 抓取 x.com Bookmarks GraphQL 响应。
 *
 * 为什么需要这一层（回应「纯 Node 被封」的根因）：
 *  x.com（Cloudflare）按 TLS ClientHello 指纹（JA3/JA4）封锁非浏览器客户端，
 *  纯 Node 的 https 请求被 RST。但真实浏览器（已登录的调试 Edge）走同一 Clash 代理可正常访问。
 *  本模块只「借用」浏览器的网络能力：用 agent-browser 原生二进制（shell-out，零 npm 依赖）
 *  驱动 9222 已登录 Edge 打开 Bookmarks 页，再用 CDP Network 监控捡回 GraphQL 响应体，
 *  之后全部交给现有 parseTimeline / normalize / store（逻辑零改动）。
 *
 * 依赖约定：agent-browser 是预装的独立 .exe（位于 managed node 的 node_modules 下），
 *  通过 child_process 调用，不进 package.json，保持「零第三方运行时依赖」。
 *
 * 关键实测结论（2026-08-06）：
 *  - agent-browser 支持 `network requests --filter/--type` 与 `network request <id>`。
 *  - HAR（`har start/stop`）默认不记录响应体，故本模块改用 `network request <id>` 取 body。
 *  - 成功响应的明细里，响应体在 `data.responseBody` 字段（非 content.text）。
 */
const { execFileSync } = require('child_process');

// agent-browser 原生二进制（shell-out，非 require 依赖）
const AB_EXE = process.env.AGENT_BROWSER_BIN
  || 'C:/Users/siruschen/.workbuddy/binaries/node/versions/22.22.2/node_modules/agent-browser/bin/agent-browser-win32-x64.exe';
const CDP_PORT = Number(process.env.CDP_PORT) || 9222;
const BOOKMARKS_URL = 'https://x.com/i/bookmarks';

/** 调用 agent-browser，统一加 --cdp 端口。失败时抛出带 stderr 的清晰错误。 */
function ab(args, opts = {}) {
  try {
    return execFileSync(AB_EXE, ['--cdp', String(CDP_PORT), ...args], {
      encoding: 'utf8',
      timeout: opts.timeout || 30000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    const msg = ((e.stderr || '') + (e.stdout || '')).trim() || e.message;
    throw new Error('agent-browser ' + args.join(' ') + ' 失败: ' + msg);
  }
}

/** 调用 agent-browser 并解析 --json 输出。 */
function abJSON(args, opts = {}) {
  const out = ab([...args, '--json'], opts);
  try { return JSON.parse(out); }
  catch (e) { throw new Error('agent-browser 输出非 JSON: ' + out.slice(0, 200)); }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * 读取当前请求日志里「最新一条成功的 Bookmarks GraphQL 响应」的 JSON 体。
 * 返回解析后的 GraphQL 对象；若没有（未加载/未登录/到底）返回 null。
 */
function readLatestBookmarks() {
  const list = abJSON(['network', 'requests', '--filter', 'Bookmarks', '--type', 'xhr,fetch']);
  const reqs = (list.data && list.data.requests) || [];
  // 只要 2xx 且 URL 含 /graphql/ 的 Bookmarks 请求
  const ok = reqs.filter(r => (r.status >= 200 && r.status < 300) && /graphql/.test(r.url || ''));
  if (!ok.length) return null;
  const newest = ok[ok.length - 1];
  const detail = abJSON(['network', 'request', newest.requestId]);
  const d = detail.data || {};
  // 实测：成功响应体在 data.responseBody（HAR 不抓 body，故走 request 明细）
  const body = d.responseBody
    || (d.response && d.response.content && d.response.content.text)
    || '';
  if (!body) return null;
  let json;
  try { json = JSON.parse(body); }
  catch (e) { throw new Error('Bookmarks 响应不是合法 JSON（前 200 字符）：' + body.slice(0, 200)); }
  return json;
}

/**
 * 全量抓取（传输层 B）：驱动 Edge 打开 Bookmarks 页，逐页滚动捕获 GraphQL 响应，
 * 累积所有「原始 GraphQL 节点」（API 返回顺序：首屏=最新收藏，滚动=更早）。
 * 不写盘、不处理 index —— 交给 fetcher.resync 统一反转/赋 index/落盘。
 *
 * 返回 { nodes: [原始 tr 节点...], pages, reachedEnd }。
 */
async function fetchAll({ maxPages = 200, firstPageMs = 12000, betweenPageMs = 5000, scrollPx = 8000 } = {}) {
  // 清空请求日志 → 打开页面（首屏自动发出 Bookmarks GraphQL）
  ab(['network', 'requests', '--clear']);
  try {
    ab(['open', BOOKMARKS_URL], { timeout: 30000 });
  } catch (e) {
    throw new Error('打开 Bookmarks 页失败（代理上游可能离线 / Edge 未登录 / 页面未加载）：' + e.message);
  }
  await sleep(firstPageMs);

  const firstJson = readLatestBookmarks();
  if (!firstJson) {
    throw new Error('首屏未捕获到 Bookmarks GraphQL 响应（多半是代理上游离线，或 Bookmarks 页需要重新登录）');
  }

  // 复用 fetcher.parseTimeline（懒加载，避免循环依赖）
  const { parseTimeline } = require('./fetcher');

  const all = [];
  let page = parseTimeline(firstJson);
  all.push(...page.nodes);
  let pages = 1;
  let bottom = page.bottom;
  console.error(`[cdp-fetch] page 1 ok, nodes=${page.nodes.length}`);

  while (bottom && pages < maxPages) {
    ab(['network', 'requests', '--clear']);
    ab(['scroll', 'down', String(scrollPx)]);
    await sleep(betweenPageMs);
    let json = readLatestBookmarks();
    // 未立即拿到：再等一轮（区分「加载慢」与「到底」）
    if (!json) {
      await sleep(betweenPageMs);
      json = readLatestBookmarks();
    }
    if (!json) break; // 确认没有新响应 → 已到底（或加载失败）
    page = parseTimeline(json);
    all.push(...page.nodes);
    pages++;
    bottom = page.bottom;
    console.error(`[cdp-fetch] page ${pages} ok, nodes so far=${all.length}`);
  }

  return { nodes: all, pages, reachedEnd: !bottom };
}

module.exports = { fetchAll, readLatestBookmarks, AB_EXE, CDP_PORT, BOOKMARKS_URL };
