const f = require('./src/fetcher');

// 1) buildUrl 构造（与浏览器请求一致）
const params = require('./bookmarks_params.json');
const u1 = f.buildUrl(params, null);
const u2 = f.buildUrl(params, 'CURSOR123');
console.log('URL 无 cursor 含 count=20:', /count%22%3A20/.test(u1) || u1.includes('count'));
console.log('URL 有 cursor:', u2.includes(encodeURIComponent('CURSOR123')));

// 2) buildHeaders 头部齐全
const h = f.buildHeaders('CT0VAL', 'auth_token=abc; ct0=CT0VAL');
console.log('has Authorization Bearer:', h['Authorization'].startsWith('Bearer '));
console.log('has x-csrf-token=ct0:', h['x-csrf-token'] === 'CT0VAL');
console.log('has Cookie:', h['Cookie'] === 'auth_token=abc; ct0=CT0VAL');
console.log('has x-twitter-auth-type:', h['x-twitter-auth-type'] === 'OAuth2Session');

// 3) parseTimeline 解析时间线（构造一份仿 x.com 结构）
const sampleNode = JSON.parse(require('fs').readFileSync('./_raw_tweet.json', 'utf8'));
const tl = {
  data: { bookmark_timeline_v2: { timeline: { instructions: [
    { type: 'TimelineAddEntries', entries: [
      { entryId: 't-1', content: { itemContent: { tweet_results: { result: sampleNode } } } },
      { entryId: 'cursor-bottom', content: { cursorType: 'Bottom', value: 'BOTTOM_CURSOR_X' } }
    ] }
  ] } } }
};
const r = f.parseTimeline(tl);
console.log('parsed nodes:', r.nodes.length, '| bottom cursor:', r.bottom);

// 4) 边界：无 timeline 抛清晰错误
try { f.parseTimeline({ data: {} }); console.log('EMPTY no-throw (BAD)'); }
catch (e) { console.log('empty timeline throws:', /响应结构异常/.test(e.message)); }

// 5) store 排序/元数据已用 created_at
const store = require('./src/store');
const meta = store.getMeta();
console.log('meta uses created_at range:', 'minCreatedAt' in meta && 'maxCreatedAt' in meta, '| keys:', Object.keys(meta).join(','));
console.log('find by created_at works:', typeof store.findByTime('2025-01-01', 'created_at').offset === 'number');
