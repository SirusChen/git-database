/**
 * fetcher.js — 模块 1：抓取 x.com 书签（+ 翻页）
 *
 * 设计原则（重要，回应「同步不该依赖调试浏览器」的反馈）：
 *  - 纯 Node 直接模拟 x.com 的 GraphQL Bookmarks 请求，不经过任何浏览器/Edge。
 *  - x.com 在本机不可直连，必须经本地代理（默认 SOCKS5 127.0.0.1:7890，Clash）。
 *    用 SOCKS5 CONNECT 在代理上建立到 x.com:443 的隧道，再在其上做 TLS + HTTPS GET，
 *    从而规避 Node 直连时的 DNS/TLS 限制（域名由代理解析，socks5h 语义）。
 *  - 认证：静态 Bearer + 浏览器导出的 cookies（含 auth_token / ct0）+ x-csrf-token(=ct0)。
 *  - 翻页：bottomCursor → 下一页。每条原始推文经 normalize.js 映射后由 store.append 去重入库。
 */
const https = require('https');
const http = require('http');
const tls = require('tls');
const net = require('net');
const fs = require('fs');
const path = require('path');
const store = require('./store');
const { normalize } = require('./normalize');
const global = require('./global');

const ROOT = path.resolve(__dirname, '..');
const BEARER = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs=1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';
const PARAMS_PATH = path.join(ROOT, 'bookmarks_params.json');
const COOKIES_PATH = path.join(ROOT, 'cookies.json');

// ---- 代理配置：默认 SOCKS5 127.0.0.1:7890；可用环境变量覆盖 ----
function proxyConfig() {
  const env = process.env.SOCKS_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
  if (env) {
    try {
      const u = new URL(env);
      const type = u.protocol.startsWith('socks') ? 'socks' : 'http';
      return { type, host: u.hostname, port: Number(u.port) || 7890 };
    } catch (_) { /* fallthrough to default */ }
  }
  // 默认 http（而非 socks）：7890 是 Clash mixed 口，HTTP CONNECT 与 SOCKS5 都能建隧道，
  // 但实测 SOCKS5 路径经 Clash 极不稳定（Node 单次连接几乎必败），而浏览器走 HTTP CONNECT 可正常上 x.com。
  // 故默认用 http，与浏览器一致的路径最稳。
  return { type: 'http', host: '127.0.0.1', port: 7890 };
}

// ---- SOCKS5 CONNECT（无认证） → 返回已连通目标 host:port 的 TCP socket ----
function socksConnect(proxy, host, port) {
  return new Promise((resolve, reject) => {
    const s = net.connect(proxy.port, proxy.host);
    s.on('error', reject);
    s.on('connect', () => s.write(Buffer.from([0x05, 0x01, 0x00]))); // greeting
    let step = 0, buf = Buffer.alloc(0);
    s.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      if (step === 0) {
        if (buf.length < 2) return;
        if (buf[0] !== 0x05 || buf[1] === 0xff) return reject(new Error('SOCKS5 方法协商失败'));
        buf = Buffer.alloc(0); step = 1;
        const hb = Buffer.from(host, 'utf8');
        const pb = Buffer.alloc(2); pb.writeUInt16BE(port, 0);
        s.write(Buffer.concat([Buffer.from([0x05, 0x01, 0x00, 0x03, hb.length]), hb, pb]));
      } else {
        if (buf.length < 4) return;
        if (buf[1] !== 0x00) return reject(new Error('SOCKS5 CONNECT 失败, code=' + buf[1]));
        let off = 4; // ver,rep,rsv,atyp
        if (buf[3] === 0x01) off += 4;
        else if (buf[3] === 0x03) off += 1 + buf[4];
        else if (buf[3] === 0x04) off += 16;
        else return reject(new Error('SOCKS5 未知地址类型 ' + buf[3]));
        off += 2; // 端口
        if (buf.length < off) return;
        s.removeAllListeners('data');
        resolve(s);
      }
    });
  });
}

// ---- HTTP 代理 CONNECT → 返回已连通的 TCP socket ----
function httpConnect(proxy, host, port) {
  return new Promise((resolve, reject) => {
    const s = net.connect(proxy.port, proxy.host);
    s.on('error', reject);
    s.on('connect', () => s.write(`CONNECT ${host}:${port} HTTP/1.1\r\nHost: ${host}:${port}\r\n\r\n`));
    let buf = Buffer.alloc(0);
    s.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      const end = buf.indexOf('\r\n\r\n');
      if (end < 0) return;
      const statusLine = buf.slice(0, buf.indexOf('\r\n')).toString();
      const code = Number((statusLine.split(' ')[1]) || 0);
      if (code !== 200) return reject(new Error('HTTP 代理 CONNECT 失败: ' + statusLine));
      s.removeAllListeners('data');
      resolve(s);
    });
  });
}

// ---- 经代理做 HTTPS GET（隧道 + TLS），返回 {status, body} ----
// 单次尝试（供重试包装器调用）。仅网络层错误会以 NETERR: 前缀 reject，业务错误（如 403）正常 resolve 由调用方判断。
function httpsGetOnce(url, headers, proxy, timeoutMs) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    let settled = false;
    const fail = (e) => {
      if (settled) return;
      settled = true;
      const msg = (e && e.message) || String(e);
      if (/ECONNRESET|socket (hang up|disconnected)|secure TLS|TLS handshake|ETIMEDOUT|ECONNREFUSED|disconnected before secure/i.test(msg)) {
        reject(new Error('NETERR: ' + msg));
      } else {
        reject(e);
      }
    };

    const tcpP = proxy.type === 'socks'
      ? socksConnect(proxy, u.hostname, 443)
      : httpConnect(proxy, u.hostname, 443);
    tcpP.then((tcp) => {
      const sock = tls.connect({ socket: tcp, servername: u.hostname }, () => {});
      const timer = setTimeout(() => { try { sock.destroy(); } catch (_) {} fail(new Error('请求超时（' + timeoutMs / 1000 + 's）')); }, timeoutMs);
      sock.on('error', fail);
      sock.on('secureConnect', () => {
        // 隧道上已完成 TLS，这里用 http（而非 https）在已加密的 socket 上发明文 HTTP
        const req = http.request({
          host: u.hostname, port: 443,
          path: u.pathname + u.search, method: 'GET',
          headers, agent: false, createConnection: () => sock
        }, (res) => {
          let body = '';
          res.on('data', (d) => body += d);
          res.on('end', () => { clearTimeout(timer); if (!settled) { settled = true; resolve({ status: res.statusCode, body }); } });
        });
        req.on('error', fail);
        req.end();
      });
    }).catch(fail);
  });
}

// 重试包装：x.com 对机房/VPN 出口 IP 风控极严，节点常间歇性重置/超时。
// 单次失败就抛会让整轮 resync 从头重抓；这里对网络错误自动重试（退避），模拟浏览器的内部重试韧性。
async function httpsGet(url, headers, proxy, timeoutMs = 20000) {
  const maxAttempts = Number(process.env.HTTP_RETRY) || 3;
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await httpsGetOnce(url, headers, proxy, timeoutMs);
    } catch (e) {
      lastErr = e;
      const msg = String((e && e.message) || e);
      const retryable = /NETERR:|ECONNRESET|socket (hang up|disconnected)|secure TLS|TLS handshake|ETIMEDOUT|ECONNREFUSED|disconnected before secure/i.test(msg);
      if (!retryable || attempt === maxAttempts) break;
      await new Promise((r) => setTimeout(r, 1500 * attempt)); // 退避：1.5s, 3s, ...
    }
  }
  const msg = String((lastErr && lastErr.message) || lastErr);
  if (/NETERR:|ECONNRESET|socket (hang up|disconnected)|secure TLS|TLS handshake|ETIMEDOUT|ECONNREFUSED|disconnected before secure/i.test(msg)) {
    throw new Error('无法与 x.com 建立连接（' + msg.replace(/^NETERR: /, '') + '）。多半是本地代理 ' + proxy.type + '://' + proxy.host + ':' + proxy.port + ' 的上游节点不稳定/被 x.com 重置——浏览器有内部重试能凑巧成功，故请确认 Clash 节点可用（或换稳定节点）后再同步。');
  }
  throw lastErr;
}

function buildHeaders(ct0, cookieHeader) {
  return {
    'Authorization': 'Bearer ' + BEARER,
    'x-csrf-token': ct0,
    'x-twitter-auth-type': 'OAuth2Session',
    'x-twitter-active-user': 'yes',
    'content-type': 'application/json',
    'x-twitter-client-language': 'en',
    'Cookie': cookieHeader,
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': '*/*',
    'Referer': 'https://x.com/',
    'Origin': 'https://x.com'
  };
}

function buildCookieHeader(cookies) {
  return cookies.map(c => `${c.name}=${encodeURIComponent(c.value)}`).join('; ');
}

function buildUrl(params, cursor) {
  const vars = Object.assign({}, params.variables);
  if (cursor) vars.cursor = cursor;
  return params.base_url
    + '?variables=' + encodeURIComponent(JSON.stringify(vars))
    + '&features=' + encodeURIComponent(JSON.stringify(params.features));
}

function parseTimeline(j) {
  const out = []; let bottom = null;
  const tl = j.data && j.data.bookmark_timeline_v2 && j.data.bookmark_timeline_v2.timeline;
  if (!tl) throw new Error('响应结构异常（可能未登录或 Cookie 过期）：' + JSON.stringify(j).slice(0, 200));
  for (const instr of (tl.instructions || [])) {
    for (const e of (instr.entries || [])) {
      const c = e.content || {};
      if (c.cursorType === 'Bottom') { bottom = c.value; continue; }
      const it = c.itemContent || {};
      const tr = it.tweet_results && it.tweet_results.result;
      if (!tr) continue;
      out.push(tr);
    }
  }
  return { nodes: out, bottom };
}

async function fetchPage(params, ct0, cookieHeader, proxy, cursor) {
  const url = buildUrl(params, cursor);
  const { status, body } = await httpsGet(url, buildHeaders(ct0, cookieHeader), proxy);
  if (status !== 200) throw new Error('HTTP ' + status + ' 抓取书签失败（可能 Cookie 过期，或需 x-client-transaction-id 校验）。响应片段：' + body.slice(0, 300));
  let j;
  try { j = JSON.parse(body); } catch (_) { throw new Error('响应不是合法 JSON（HTTP ' + status + '），前 200 字符：' + body.slice(0, 200)); }
  if (j.errors) throw new Error('GraphQL 报错：' + JSON.stringify(j.errors));
  return parseTimeline(j);
}

/**
 * 抓取并入库（纯 Node，无需浏览器）。
 *  - 二次 sync 只会追加新书签（按 id 去重）。
 */
async function sync(opts = {}) {
  const maxPages = opts.maxPages || 50;
  let params, cookies;
  try { params = JSON.parse(fs.readFileSync(PARAMS_PATH, 'utf8')); }
  catch (e) { throw new Error('读取 bookmarks_params.json 失败（' + e.message + '）：请先准备好抓取参数文件'); }
  try { cookies = JSON.parse(fs.readFileSync(COOKIES_PATH, 'utf8')); }
  catch (e) { throw new Error('读取 cookies.json 失败（' + e.message + '）：请先放置有效的 x.com Cookie（可用 edge-debug-browser 导出）'); }

  const ct0c = cookies.find(c => c.name === 'ct0');
  if (!ct0c) throw new Error('cookies.json 缺少 ct0 字段（Cookie 可能已过期或格式不对）');
  const cookieHeader = buildCookieHeader(cookies);
  const proxy = proxyConfig();

  // 预检：代理可达性给出友好提示
  const net0 = net.connect(proxy.port, proxy.host);
  await new Promise((res) => { net0.on('error', () => res(false)); net0.on('connect', () => { net0.destroy(); res(true); }); setTimeout(() => { net0.destroy(); res(false); }, 1500); });

  let cursor = null, seen = 0, added = 0, pages = 0;
  do {
    const { nodes, bottom } = await fetchPage(params, ct0c.value, cookieHeader, proxy, cursor);
    for (const tr of nodes) {
      const post = normalize(tr);
      if (!post || !post.id) continue;
      seen++;
      if (!store.has(post.id)) {
        post.index = global.nextId();                 // 自增序号，仅落在 bookmarks.jsonl
        store.append(post);
        added++;
      }
    }
    pages++;
    cursor = bottom;
  } while (cursor && pages < maxPages);

  global.flush();   // 批量抓取完成后低频落盘一次（更新自增计数）
  const meta = store.getMeta();
  return { added, seen, pages, total: meta.count, seq: global.get('seq') };
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * 连通性探测 + 首屏读取：只取第一页（cursor=null），不写盘、不清数据。
 * 返回 { nodeCount, hasBottom }，用于判断代理/上游是否在线、Cookie 是否有效。
 * 抛错带友好信息，且绝不触碰本地数据。
 */
async function probeConnection() {
  let params, cookies;
  try { params = JSON.parse(fs.readFileSync(PARAMS_PATH, 'utf8')); }
  catch (e) { throw new Error('读取 bookmarks_params.json 失败（' + e.message + '）'); }
  try { cookies = JSON.parse(fs.readFileSync(COOKIES_PATH, 'utf8')); }
  catch (e) { throw new Error('读取 cookies.json 失败（' + e.message + '）'); }
  const ct0c = cookies.find(c => c.name === 'ct0');
  if (!ct0c) throw new Error('cookies.json 缺少 ct0 字段（Cookie 可能已过期或格式不对）');
  const cookieHeader = buildCookieHeader(cookies);
  const proxy = proxyConfig();
  const { nodes, bottom } = await fetchPage(params, ct0c.value, cookieHeader, proxy, null);
  return { nodeCount: nodes.length, hasBottom: !!bottom };
}

/**
 * 全量重同步（清空本地 → 从头抓到尾 → 按「书签列表顺序」分配 index）。
 *  - opts.pageDelayMs：每两页 fetch 之间的间隔（默认 60000 = 1 分钟），用于限速/礼貌抓取。
 *  - opts.maxPages：安全上限（默认 100000，实际由 Bottom 游标耗尽自然停止）。
 *  - 顺序：先取首屏验证连通性；**只有连通成功才清空本地数据与全局自增计数**，避免清空后无法回填。
 *  - 全程在内存累积所有帖子（API 返回顺序：首屏=最新收藏，Bottom 游标向后=更早收藏）；
 *    全部抓完后整体反转（使最旧收藏排到首位），从链尾（页数最大、最旧收藏）起 index=1 自增，
 *    最后调用 store.replaceAll 一次性低频落盘。**index 严格跟随书签列表顺序，与 created_at 无关。**
 */
async function resync(opts = {}) {
  const pageDelayMs = opts.pageDelayMs != null ? opts.pageDelayMs : 60000;
  const maxPages = opts.maxPages || 100000;

  let params, cookies;
  try { params = JSON.parse(fs.readFileSync(PARAMS_PATH, 'utf8')); }
  catch (e) { throw new Error('读取 bookmarks_params.json 失败（' + e.message + '）：请先准备好抓取参数文件'); }
  try { cookies = JSON.parse(fs.readFileSync(COOKIES_PATH, 'utf8')); }
  catch (e) { throw new Error('读取 cookies.json 失败（' + e.message + '）：请先放置有效的 x.com Cookie（可用 edge-debug-browser 导出）'); }
  const ct0c = cookies.find(c => c.name === 'ct0');
  if (!ct0c) throw new Error('cookies.json 缺少 ct0 字段（Cookie 可能已过期或格式不对）');
  const cookieHeader = buildCookieHeader(cookies);
  const proxy = proxyConfig();

  // 步骤2/探测：先取首屏（同时验证代理可达 + Cookie 有效）。失败直接抛出，绝不破坏现有数据。
  let first;
  try {
    first = await fetchPage(params, ct0c.value, cookieHeader, proxy, null);
  } catch (e) {
    throw new Error('无法开始全量同步（首屏抓取失败，代理/上游可能离线或 Cookie 过期）：' + e.message + ' —— 本地 bookmarks.jsonl 与 .bak 均未被改动。');
  }

  // 连通正常 → 清空本地书签数据（jsonl + meta）并重置全局自增计数
  store.clearAll();
  global.set('seq', 0);
  global.flush();
  // 同时按用户要求删除所有 .bak 备份（仅在此刻、确认可回填后才删）
  for (const f of fs.readdirSync(path.join(ROOT, 'data'))) {
    if (f === 'bookmarks.jsonl.bak' || f.endsWith('.bak')) {
      try { fs.unlinkSync(path.join(ROOT, 'data', f)); } catch (_) { /* ignore */ }
    }
  }

  // 内存累积所有规范化帖子（按 API 返回顺序，不做任何写盘）
  const all = [];
  const pushNodes = (nodes) => {
    for (const n of nodes) {
      const p = normalize(n);
      if (p && p.id) all.push(p);
    }
  };
  pushNodes(first.nodes);
  let pages = 1, total = first.nodes.length, bottom = first.bottom;
  console.error(`[resync] page 1 ok, posts=${total}`);

  // 后续页：每页间隔 pageDelayMs，仅累积到内存
  while (bottom && pages < maxPages) {
    await sleep(pageDelayMs);
    const page = await fetchPage(params, ct0c.value, cookieHeader, proxy, bottom);
    pushNodes(page.nodes);
    pages++;
    total += page.nodes.length;
    bottom = page.bottom;
    console.error(`[resync] page ${pages} ok, posts so far=${total}`);
  }

  // 步骤3：index 严格按「书签列表顺序」分配（与 created_at 无关）。
  // API 顺序为「最新收藏在前、最旧收藏在后」；用户要求最旧的（页数最大、链尾）为 index=1，
  // 故整体反转使链尾排到首位，自增从 1 开始（旧→新：index 1..N）。
  all.reverse();
  for (const p of all) p.index = global.nextId();
  const written = store.replaceAll(all);   // 单次低频落盘
  global.flush();

  const meta = store.getMeta();
  return { mode: 'resync', cleared: true, pages, total, written, seq: global.get('seq') };
}

module.exports = { sync, resync, probeConnection, parseTimeline, buildUrl, buildHeaders, buildCookieHeader };
