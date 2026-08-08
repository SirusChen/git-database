'use strict';

/**
 * image-cache.js — 远程图片下载到本地（发布前置）
 *
 * 小红书发布器要求「本地绝对路径」图片，而画廊图是远程 CDN（pbs.twimg.com）。
 * 发布前需先把图下载到本地临时目录。零第三方依赖（仅 Node 内置 http/https/fs/url）。
 *
 * 代理：读取环境变量 HTTPS_PROXY / HTTP_PROXY（Clash mixed 口常见 127.0.0.1:7890）。
 * 目标为 https 且配置了代理时，走 HTTP CONNECT 隧道；否则直连。
 */

const fs = require('fs');
const http = require('http');
const https = require('https');
const url = require('url');
const path = require('path');
const os = require('os');

const TMP = path.join(os.tmpdir(), 'xbook-publish');
if (!fs.existsSync(TMP)) fs.mkdirSync(TMP, { recursive: true });

function proxyUrl() {
  return process.env.HTTPS_PROXY || process.env.https_proxy ||
    process.env.HTTP_PROXY || process.env.http_proxy || '';
}

function downloadToTemp(imageUrl, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new url.URL(imageUrl); } catch (e) { return reject(new Error('非法图片 URL')); }

    const ext = path.extname(parsed.pathname).split('?')[0] || '.jpg';
    const out = path.join(TMP, `img_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`);

    const onResponse = (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadToTemp(res.headers.location, timeoutMs).then(resolve, reject);
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('下载失败 HTTP ' + res.statusCode)); }
      const ws = fs.createWriteStream(out);
      res.pipe(ws);
      ws.on('finish', () => resolve(out));
      ws.on('error', (e) => { fs.unlink(out, () => {}); reject(e); });
    };

    const px = proxyUrl();
    if (px && parsed.protocol === 'https:') {
      // https over http proxy：CONNECT 隧道
      let pu;
      try { pu = new url.URL(px); } catch (e) { return reject(new Error('非法代理 URL')); }
      const conn = http.request({
        host: pu.hostname,
        port: pu.port || 80,
        method: 'CONNECT',
        path: parsed.hostname + ':443',
        timeout: timeoutMs,
      });
      conn.on('connect', (r, socket) => {
        if (r.statusCode !== 200) { socket.destroy(); return reject(new Error('代理 CONNECT 失败 ' + r.statusCode)); }
        const req = https.get({
          host: parsed.hostname,
          path: parsed.pathname + parsed.search,
          socket,
          agent: false,
          headers: { Host: parsed.hostname, 'User-Agent': 'Mozilla/5.0' },
          timeout: timeoutMs,
        }, onResponse);
        req.on('error', (e) => { socket.destroy(); reject(e); });
        req.on('timeout', () => { req.destroy(); reject(new Error('下载超时')); });
      });
      conn.on('error', reject);
      conn.on('timeout', () => { conn.destroy(); reject(new Error('代理连接超时')); });
      conn.end();
    } else {
      const mod = parsed.protocol === 'https:' ? https : http;
      const req = mod.get({ ...parsed, timeout: timeoutMs, headers: { 'User-Agent': 'Mozilla/5.0' } }, onResponse);
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('下载超时')); });
    }
  });
}

module.exports = { downloadToTemp, TMP };
