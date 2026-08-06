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
  return { type: 'socks', host: '127.0.0.1', port: 7890 };
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
function httpsGet(url, headers, proxy, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    let settled = false;
    const fail = (e) => {
      if (settled) return;
      settled = true;
      const msg = e && e.message || String(e);
      // 把底层网络错误翻译成可操作提示：绝大多数情况是本地代理(Clash)上游离线
      if (/ECONNRESET|socket disconnected|secure TLS|TLS handshake|ETIMEDOUT|ECONNREFUSED/.test(msg)) {
        reject(new Error('无法与 x.com 建立连接（' + msg + '）。多半是本地代理 ' + proxy.type + '://' + proxy.host + ':' + proxy.port + ' 的上游已离线——请确认 Clash/代理已启动且能访问外网，再试同步。'));
      } else {
        reject(e);
      }
    };

    (async () => {
      try {
        const tcp = proxy.type === 'socks'
          ? await socksConnect(proxy, u.hostname, 443)
          : await httpConnect(proxy, u.hostname, 443);
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
      } catch (e) { fail(e); }
    })();
  });
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

module.exports = { sync, parseTimeline, buildUrl, buildHeaders, buildCookieHeader };
