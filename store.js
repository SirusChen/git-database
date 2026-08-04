/**
 * store.js — 书签文件库
 *  - data/bookmarks.jsonl : 每行一条规范化帖子（append-only，按 id 去重）
 *  - data/meta.json       : 计数 / 时间范围 / 最近同步
 * 内存维护一个按 bookmarked_at 倒序的数组 + id->post 索引，启动即从 jsonl 载入。
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, 'data');
const JSONL = path.join(DIR, 'bookmarks.jsonl');
const META = path.join(DIR, 'meta.json');

function ensure() {
  if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
  if (!fs.existsSync(JSONL)) fs.writeFileSync(JSONL, '');
  if (!fs.existsSync(META)) fs.writeFileSync(META, JSON.stringify({ count: 0 }, null, 2));
}

let cache = null;

function cmp(a, b) { return (b.bookmarked_at || '').localeCompare(a.bookmarked_at || ''); }

function load() {
  ensure();
  if (cache) return cache;
  const raw = fs.readFileSync(JSONL, 'utf8').split('\n').filter(l => l.trim());
  // 用 Map 去重（保留最后一次出现的记录），避免物理文件中重复 id 污染内存列表
  const map = new Map();
  for (const l of raw) {
    try { const p = JSON.parse(l); if (p && p.id) map.set(p.id, p); } catch (_) { /* 跳过损坏行 */ }
  }
  const items = [...map.values()].sort(cmp);
  cache = { items, byId: map };
  return cache;
}

function reload() { cache = null; return load(); }

function append(post) {
  const c = load();
  if (c.byId.has(post.id)) return false;        // 已存在则跳过（去重）
  c.byId.set(post.id, post);
  c.items.push(post);
  c.items.sort(cmp);
  fs.appendFileSync(JSONL, JSON.stringify(post) + '\n');
  writeMeta();
  return true;
}

function writeMeta() {
  const c = load();
  const times = c.items.map(p => p.bookmarked_at).filter(Boolean).sort();
  const meta = {
    count: c.items.length,
    minBookmarkedAt: times[0] || null,
    maxBookmarkedAt: times[times.length - 1] || null,
    lastSync: new Date().toISOString()
  };
  fs.writeFileSync(META, JSON.stringify(meta, null, 2));
  return meta;
}

function getMeta() {
  if (fs.existsSync(META)) {
    try { return JSON.parse(fs.readFileSync(META, 'utf8')); } catch (_) { /* fallthrough */ }
  }
  return writeMeta();
}

function page(cursor = 0, limit = 20) {
  const c = load();
  const n = Math.max(0, cursor | 0);
  const slice = c.items.slice(n, n + limit);
  const next = n + limit < c.items.length ? n + limit : null;
  return { items: slice, nextCursor: next, total: c.items.length };
}

/**
 * 时间跳转定位：在「按 bookmarked_at 倒序」的列表中，
 * 找到第一条约等于/早于 atISO 的帖子（即离选定日期最近的、不晚于该日的书签），
 * 返回其 offset，前端据此滚动并高亮。
 * 若所有帖子都晚于 atISO（选定日期很新），返回 offset=0（列表顶部）。
 */
function findByTime(atISO) {
  const c = load();
  for (let i = 0; i < c.items.length; i++) {
    if (c.items[i].bookmarked_at <= atISO) return { offset: i, post: c.items[i] };
  }
  return { offset: 0, post: c.items[0] || null };
}

// 重写 jsonl，去除重复 id（保留最后出现），并刷新 meta。用于修复历史重复数据。
function compact() {
  const c = load();
  const body = c.items.map(p => JSON.stringify(p)).join('\n') + (c.items.length ? '\n' : '');
  fs.writeFileSync(JSONL, body);
  writeMeta();
  return c.items.length;
}

module.exports = { ensure, load, reload, append, compact, getMeta, page, findByTime, JSONL, META };
