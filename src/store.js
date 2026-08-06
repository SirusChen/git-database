/**
 * store.js — 模块 2：书签文件数据库
 *  - data/bookmarks.jsonl : 每行一条规范化帖子（append-only，按 id 去重）
 *  - data/meta.json       : 计数 / 时间范围 / 最近同步
 * 内存维护一个按 created_at 倒序的数组 + id->post 索引，启动即从 jsonl 载入。
 * 对外提供：分页(page)、时间定位(findByTime)、统计(getMeta)、修复(compact)。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIR = path.join(ROOT, 'data');
const JSONL = path.join(DIR, 'bookmarks.jsonl');
const META = path.join(DIR, 'meta.json');

function ensure() {
  if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
  if (!fs.existsSync(JSONL)) fs.writeFileSync(JSONL, '');
  if (!fs.existsSync(META)) fs.writeFileSync(META, JSON.stringify({ count: 0 }, null, 2));
}

let cache = null;

// 排序：以帖子真实发布时间 created_at 倒序为主（honest，数据分散）；
// 同时间回退 id，保证稳定且不依赖不可靠的「收藏时间」。
function cmp(a, b) {
  const r = (b.created_at || '').localeCompare(a.created_at || '');
  if (r !== 0) return r;
  return (b.id || '').localeCompare(a.id || '');
}

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

// 仅判断是否存在（不触发写入），供 fetcher 在分配 index 前判断新帖
function has(id) {
  const c = load();
  return c.byId.has(id);
}

function writeMeta() {
  const c = load();
  const times = c.items.map(p => p.created_at).filter(Boolean).sort();
  const meta = {
    count: c.items.length,
    minCreatedAt: times[0] || null,
    maxCreatedAt: times[times.length - 1] || null,
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
 * 时间跳转定位：在列表中找到「时间字段 field 不晚于 atISO」且最接近该时刻的帖子
 * （即 field 最大且 <= atISO 的那条），返回其 offset，前端据此滚动并高亮。
 *  - field 默认 'created_at'（帖子真实发布时间，数据可靠、分散，是跳转的主要依据）；'index' 作为稳定序号/兜底排序键。
 *  - 若没有任何帖子 <= atISO（选定日期早于全部帖子），返回 offset=0（列表顶部）。
 */
function findByTime(atISO, field = 'created_at') {
  const c = load();
  let best = null, bestOffset = -1;
  for (let i = 0; i < c.items.length; i++) {
    const v = c.items[i][field];
    if (v && v <= atISO) {
      if (best === null || v > best) { best = v; bestOffset = i; }
    }
  }
  if (bestOffset >= 0) return { offset: bestOffset, post: c.items[bestOffset] };
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

/**
 * 给「缺少 index 字段」的帖子批量补一个自增序号（单次批量重写，低频 I/O）。
 * 需要传入 global 模块的 nextId 以统一计数；返回补了多少条。
 * 与 compact 同理，仅在批量操作完成后调用一次。
 */
function backfillIndex(global) {
  if (!global || typeof global.nextId !== 'function') throw new Error('backfillIndex 需要 global 模块（提供 nextId）');
  const c = load();
  let n = 0;
  for (const p of c.items) {
    if (p && p.id != null && p.index == null) {
      p.index = global.nextId();
      n++;
    }
  }
  if (n > 0) {
    const body = c.items.map(p => JSON.stringify(p)).join('\n') + (c.items.length ? '\n' : '');
    fs.writeFileSync(JSONL, body);
    writeMeta();
  }
  return n;
}

module.exports = { ensure, load, reload, append, has, compact, backfillIndex, getMeta, page, findByTime, JSONL, META };
