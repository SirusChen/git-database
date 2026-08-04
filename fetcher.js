/**
 * fetcher.js — 抓取 x.com 书签并规范化入库
 *  - 复用已验证的「CDP 页面内 fetch」：Node 只做本地 CDP 通信，真实请求由已登录的
 *    调试 Edge（x.com 标签页）发出，规避 Node 直连 SOCKS5/TLS 的问题。
 *  - 翻页：bottomCursor → 下一页。
 *  - 规范化：把原始推文节点映射为 store 的 schema；bookmarked_at 按抓取顺序倒序写入。
 */
const WebSocket = globalThis.WebSocket;
const http = require('http');
const fs = require('fs');
const store = require('./store');
const path = require('path');

const CDP = 'http://127.0.0.1:9222';
const BEARER = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs=1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';
const PARAMS_PATH = path.join(__dirname, 'bookmarks_params.json');
const COOKIES_PATH = path.join(__dirname, 'cookies.json');

function cdpGet(url) {
  return new Promise((res, rej) => {
    const r = http.get(url, x => { let d = ''; x.on('data', c => d += c); x.on('end', () => res(d)); });
    r.on('error', rej);
  });
}
function cdpSend(ws, method, params) {
  return new Promise((res, rej) => {
    const id = Math.floor(Math.random() * 1e6);
    const on = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.id === id) { ws.removeEventListener('message', on); res(m); }
    };
    ws.addEventListener('message', on);
    ws.send(JSON.stringify({ id, method, params: params || {} }));
    setTimeout(() => { ws.removeEventListener('message', on); rej(new Error('cdpSend timeout: ' + method)); }, 30000);
  });
}
async function connect() {
  const list = JSON.parse(await cdpGet(CDP + '/json'));
  const target = list.find(t => /x\.com/.test(t.url)) || list.find(t => t.type === 'page');
  if (!target) throw new Error('CDP 上找不到 x.com 标签页，请先启动调试 Edge 并打开 x.com');
  const ws = await new Promise((res, rej) => {
    const w = new WebSocket(target.webSocketDebuggerUrl);
    w.onopen = () => res(w);
    w.onerror = (e) => rej(e.error || new Error('ws connect error'));
  });
  await cdpSend(ws, 'Runtime.enable');
  return { ws, target };
}
async function evaluate(ws, js) {
  const r = await cdpSend(ws, 'Runtime.evaluate', { expression: js, awaitPromise: true, returnByValue: true });
  if (r.result && r.result.exceptionDetails) throw new Error('page eval: ' + JSON.stringify(r.result.exceptionDetails));
  return r.result.result.value;
}

function buildUrl(params, cursor) {
  const vars = Object.assign({}, params.variables);
  if (cursor) vars.cursor = cursor;
  return params.base_url
    + '?variables=' + encodeURIComponent(JSON.stringify(vars))
    + '&features=' + encodeURIComponent(JSON.stringify(params.features));
}

async function fetchRaw(ws, params, ct0, cursor) {
  const url = buildUrl(params, cursor);
  const js = `(async () => {
    const ct0 = ${JSON.stringify(ct0)};
    const url = ${JSON.stringify(url)};
    let r;
    try {
      r = await fetch(url, {
        method: 'GET', credentials: 'include',
        signal: AbortSignal.timeout(20000),
        headers: {
          'Authorization': 'Bearer ${BEARER}',
          'x-csrf-token': ct0,
          'x-twitter-auth-type': 'OAuth2Session',
          'x-twitter-active-user': 'yes',
          'content-type': 'application/json',
          'x-twitter-client-language': 'en'
        }
      });
    } catch (e) {
      const why = (e && e.name === 'TimeoutError') ? 'fetch 超时(20s)' : String(e && e.message || e);
      return 'NETERR:' + why + ' | 无法连接 x.com，请确认 Clash 代理/TUN 已在线且能访问外网';
    }
    if (!r.ok) return 'HTTPERR:' + r.status + ' ' + r.statusText;
    const j = await r.json();
    if (j.errors) return 'ERRORS:' + JSON.stringify(j.errors);
    const out = []; let bottom = null;
    const tl = j.data.bookmark_timeline_v2.timeline;
    for (const instr of tl.instructions) {
      for (const e of (instr.entries || [])) {
        const c = e.content || {};
        if (c.cursorType === 'Bottom') { bottom = c.value; continue; }
        const it = c.itemContent || {};
        const tr = it.tweet_results && it.tweet_results.result;
        if (!tr) continue;
        out.push(tr);
      }
    }
    return JSON.stringify({ nodes: out, bottom });
  })()`;
  const val = await evaluate(ws, js);
  if (typeof val === 'string') {
    if (val.startsWith('NETERR:') || val.startsWith('HTTPERR:') || val.startsWith('ERRORS:')) throw new Error(val);
  }
  return JSON.parse(val);
}

function normalize(tr) {
  const t = tr.tweet || tr;
  const leg = t.legacy || {};
  const ur = t.core && t.core.user_results && t.core.user_results.result;
  const uc = ur ? (ur.core || ur.legacy) : null;
  const avatar = (uc && uc.avatar_image_url)
    || (ur && ur.legacy && ur.legacy.profile_image_url_https)
    || null;

  const mediaRaw = (leg.extended_entities && leg.extended_entities.media) || leg.entities.media || [];
  const media = mediaRaw
    .filter(m => ['photo', 'video', 'gif'].includes(m.type))
    .map(m => {
      const oi = m.original_info || {};
      const large = m.sizes && m.sizes.large;
      return {
        type: m.type,
        url: m.media_url_https,
        width: oi.width || (large && large.w) || null,
        height: oi.height || (large && large.h) || null,
        thumb: m.type === 'photo' ? m.media_url_https + ':thumb' : (m.media_url_https || null)
      };
    });

  const ent = leg.entities || {};
  const entities = {
    hashtags: (ent.hashtags || []).map(h => h.text),
    mentions: (ent.user_mentions || []).map(u => u.screen_name),
    urls: (ent.urls || []).map(u => ({ expanded: u.expanded_url, display: u.display_url }))
  };

  const views = (t.views && t.views.count != null) ? Number(t.views.count) : null;

  return {
    id: t.rest_id || leg.id_str,
    created_at: leg.created_at ? new Date(leg.created_at).toISOString() : null,
    author: {
      id: leg.user_id_str || null,
      screen_name: uc ? (uc.screen_name || (uc.legacy && uc.legacy.screen_name)) : null,
      name: uc ? (uc.name || (uc.legacy && uc.legacy.name)) : null,
      avatar: avatar
    },
    text: leg.full_text || '',
    lang: leg.lang || null,
    source: tr.source || t.source || null,
    sensitive: !!leg.possibly_sensitive,
    conversation_id: leg.conversation_id_str || null,
    is_quote: !!leg.is_quote_status,
    media: media,
    entities: entities,
    stats: {
      likes: Number(leg.favorite_count) || 0,
      retweets: Number(leg.retweet_count) || 0,
      replies: Number(leg.reply_count) || 0,
      quotes: Number(leg.quote_count) || 0,
      bookmarks: Number(leg.bookmark_count) || 0,
      views: views
    }
  };
}

/**
 * 抓取并入库。
 *  - bookmarked_at 按「抓取顺序倒序」写入：先抓到的（书签更新）时间戳更大，
 *    从而保持书签的新旧顺序（API 本身按书签时间倒序返回）。
 *  - 二次 sync 只会追加新书签（按 id 去重）。
 */
async function sync(opts = {}) {
  const maxPages = opts.maxPages || 50;
  const params = JSON.parse(fs.readFileSync(PARAMS_PATH, 'utf8'));
  const cookies = JSON.parse(fs.readFileSync(COOKIES_PATH, 'utf8'));
  const ct0 = cookies.find(c => c.name === 'ct0').value;

  const { ws } = await connect();
  let cursor = null, seen = 0, added = 0, pages = 0;
  const base = Date.now();
  let seq = 0;
  try {
    do {
      const { nodes, bottom } = await fetchRaw(ws, params, ct0, cursor);
      for (const tr of nodes) {
        const post = normalize(tr);
        if (!post || !post.id) continue;
        post.bookmarked_at = new Date(base - seq * 1000).toISOString();
        seq++;
        seen++;
        if (store.append(post)) added++;
      }
      pages++;
      cursor = bottom;
    } while (cursor && pages < maxPages);
  } finally {
    ws.close();
  }
  const meta = store.getMeta();
  return {
    added, seen, pages, total: meta.count,
    maxBookmarkedAt: meta.maxBookmarkedAt,
    minBookmarkedAt: meta.minBookmarkedAt
  };
}

module.exports = { sync, normalize };
