/**
 * global.js — 全局状态模块
 * 把「跨会话需要持久化的全局变量」集中到一个文件（data/globals.json）维护，
 * 对外提供 getter / setter / 自增 id / 低频落盘 等 API。
 *
 * 设计要点（回应「禁止频繁读写文件」约束）：
 *  - 内存缓存：首次访问惰性 load 一次，之后全在内存操作；
 *  - 写入零碎化：nextId()/set() 只改内存并打 dirty 标记，绝不直接写盘；
 *  - 低频落盘：只有显式 flush()（在批量读写操作完成后调用）才写文件，且仅 dirty 时写；
 *  - 进程退出兜底：process 'exit' 时若 dirty 再落一次盘，防止异常退出丢自增计数。
 *
 * 注意：本文件只存「真正的全局变量」（当前仅自增 id seq）。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIR = path.join(ROOT, 'data');
const FILE = path.join(DIR, 'globals.json');

const DEFAULTS = { seq: 0 };

let state = null;   // 内存缓存，null 表示尚未 load
let dirty = false;  // 是否有改动未落盘

function ensureDir() {
  if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
}

// 惰性加载：只从文件读一次，之后走内存
function load() {
  if (state) return state;
  ensureDir();
  let data = {};
  if (fs.existsSync(FILE)) {
    try { data = JSON.parse(fs.readFileSync(FILE, 'utf8')) || {}; }
    catch (_) { data = {}; }   // 损坏则回退默认，不阻塞
  }
  state = Object.assign({}, DEFAULTS, data);
  dirty = false;
  return state;
}

function get(key) {
  return load()[key];
}

function set(key, value) {
  const s = load();
  s[key] = value;
  dirty = true;
  return value;
}

/** 自增 id：内存 +1 并标记 dirty，不写盘。返回新值。 */
function nextId() {
  const s = load();
  s.seq = (typeof s.seq === 'number' && isFinite(s.seq) ? s.seq : 0) + 1;
  dirty = true;
  return s.seq;
}

/** 低频落盘：仅在批量操作完成后调用。dirty 才写。返回是否真正写入。 */
function flush() {
  if (!state || !dirty) return false;
  ensureDir();
  fs.writeFileSync(FILE, JSON.stringify(state, null, 2));
  dirty = false;
  return true;
}

/** 只读快照（不暴露内部引用） */
function getState() {
  return Object.assign({}, load());
}

// 进程退出兜底：仅在本次有改动（dirty）时落一次盘，仍属低频
process.on('exit', () => { try { flush(); } catch (_) {} });

module.exports = { get, set, nextId, flush, getState, FILE, DIR };
