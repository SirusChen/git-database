'use strict';

/**
 * image-states.js — 图片维度用户状态库（模块 2/4 的数据底座）
 *
 * 与书签库（bookmarks.jsonl）完全解耦：收藏/已发布状态按「图片 base URL」索引，
 * 单独存 data/image-states.json。这样全量 resync（store.replaceAll 重写 jsonl）
 * 不会清掉用户的收藏/发布标记。
 *
 * 为何不引入全局自增 id：
 *  - 图片已由 URL 唯一标识，URL 即天然主键，无需再生成 id；
 *  - 引入自增 id 需在 globals.json 增 seq 并维护 id↔url 映射，纯增复杂度无收益；
 *  - 按 URL 读写幂等，resync 安全。如需按收藏时间排序，用 favoritedAt 时间戳即可。
 *
 * 对外：readAll / getState / toggleFavorite / setFavorite / markPublished /
 *       getFavoritedBases / FILE
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIR = path.join(ROOT, 'data');
const FILE = path.join(DIR, 'image-states.json');

let cache = null; // { [baseUrl]: { favorited?, favoritedAt?, published? } }

function ensure() {
  if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
  if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, '{}');
}

function load() {
  if (cache) return cache;
  ensure();
  try {
    cache = JSON.parse(fs.readFileSync(FILE, 'utf8') || '{}');
  } catch (_) {
    cache = {};
  }
  return cache;
}

// 低频 I/O：仅在状态变更时一次性落盘（与 store.js 的 replaceAll 思路一致）
function save() {
  ensure();
  fs.writeFileSync(FILE, JSON.stringify(load(), null, 2));
}

function readAll() {
  return load();
}

function getState(base) {
  const c = load();
  return c[base] || null;
}

function _ensureEntry(base) {
  const c = load();
  if (!c[base]) c[base] = {};
  return c[base];
}

/** 翻转收藏，返回 { base, favorited } */
function toggleFavorite(base) {
  if (!base) throw new Error('toggleFavorite 需要 base');
  const e = _ensureEntry(base);
  e.favorited = !e.favorited;
  if (e.favorited) e.favoritedAt = new Date().toISOString();
  else delete e.favoritedAt;
  save();
  return { base, favorited: !!e.favorited };
}

/** 显式设置收藏（action=favorite|unfavorite 用） */
function setFavorite(base, val) {
  if (!base) throw new Error('setFavorite 需要 base');
  const e = _ensureEntry(base);
  e.favorited = !!val;
  if (e.favorited) e.favoritedAt = new Date().toISOString();
  else delete e.favoritedAt;
  save();
  return { base, favorited: !!e.favorited };
}

/**
 * 标记已发布到小红书。
 * @param {string|string[]} base 图片 base URL（或多图 base URL 数组）
 * @param {object} info { title, content, tags, url }
 */
function markPublished(base, info = {}) {
  const bases = Array.isArray(base) ? base : [base];
  if (!bases.length || bases.some((b) => !b)) throw new Error('markPublished 需要 base');
  const published = {
    title: info.title || '',
    content: info.content || '',
    tags: Array.isArray(info.tags) ? info.tags : [],
    url: info.url || '',
    at: new Date().toISOString(),
  };
  for (const b of bases) {
    const e = _ensureEntry(b);
    e.published = published;
  }
  save();
  return published;
}

/** 返回所有被收藏图片的 base URL 列表（供 /api/favorite-posts 反查帖子） */
function getFavoritedBases() {
  const c = load();
  return Object.keys(c).filter((k) => c[k] && c[k].favorited);
}

module.exports = {
  readAll,
  getState,
  toggleFavorite,
  setFavorite,
  markPublished,
  getFavoritedBases,
  FILE,
};
