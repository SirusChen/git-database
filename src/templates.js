'use strict';

/**
 * templates.js — 发帖模板库（模块 4 的数据底座）
 *
 * 模板结构：{ id, name, title, content, tags[], aiDeclaration }
 *  - title/content 支持占位符：{{text}}(原帖文字) / {{desc}}(发布时手填) / {{author}}(原作者)
 *  - 存 data/templates.json（前端可增删改）
 *
 * 对外：list / save（新增或按 id 更新）/ remove
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIR = path.join(ROOT, 'data');
const FILE = path.join(DIR, 'templates.json');

function ensure() {
  if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
  if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, '[]');
}

function list() {
  ensure();
  try {
    const arr = JSON.parse(fs.readFileSync(FILE, 'utf8') || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch (_) {
    return [];
  }
}

function saveAll(arr) {
  ensure();
  fs.writeFileSync(FILE, JSON.stringify(arr, null, 2));
}

function save(tpl) {
  if (!tpl || typeof tpl !== 'object') throw new Error('save 需要模板对象');
  const arr = list();
  const clean = {
    name: String(tpl.name || '').trim() || '未命名模板',
    title: String(tpl.title || ''),
    content: String(tpl.content || ''),
    tags: Array.isArray(tpl.tags) ? tpl.tags.map(String) : [],
    aiDeclaration: !!tpl.aiDeclaration,
  };
  if (tpl.id) {
    const i = arr.findIndex((t) => t.id === tpl.id);
    if (i >= 0) { arr[i] = { ...arr[i], ...clean }; }
    else { arr.push({ id: String(tpl.id), ...clean }); }
    saveAll(arr);
    return arr.find((t) => t.id === (tpl.id));
  }
  const id = 't' + Date.now().toString(36);
  arr.push({ id, ...clean });
  saveAll(arr);
  return arr[arr.length - 1];
}

function remove(id) {
  if (!id) throw new Error('remove 需要 id');
  const arr = list().filter((t) => t.id !== id);
  saveAll(arr);
  return true;
}

module.exports = { list, save, remove, FILE };
