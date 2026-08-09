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
  // 显式设置（含空字符串=强制直连）优先；未设置时默认走 Clash（127.0.0.1:7890）。
  // 原因：pbs.twimg.com 等被墙 CDN 在本机被 DNS/hosts 指向 localhost，Node 直连必 ECONNREFUSED，
  // 必须经代理才能解析到真实 IP。
  for (const k of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy']) {
    if (process.env[k] !== undefined) return process.env[k];
  }
  return 'http://127.0.0.1:7890';
}

// 从图片 URL 提取合法的文件扩展名。
// 关键：X/Twitter 的 media URL 常带 :large / :orig / :small 格式后缀（如 .../XXX.jpg:large），
// 若直接 path.extname 会把 ':large' 一起带进文件名 —— Windows 下文件名含冒号会创建成
// 「备用数据流(ADS)」而非普通文件，导致上传到小红书时拿到坏文件、报「上传格式不支持」。
// 故先剥离 :\w+ 后缀，再取扩展名；无扩展名则看 ?format= 参数，再无则默认 .jpg。
function pickExt(imageUrl) {
  let parsed;
  try { parsed = new url.URL(imageUrl); } catch (e) { return '.jpg'; }
  const pathname = parsed.pathname.replace(/:\w+$/, '');
  let ext = path.extname(pathname);
  if (!ext) {
    const fmt = new URLSearchParams(parsed.search).get('format');
    ext = fmt ? '.' + String(fmt).replace(/[^\w]/g, '') : '.jpg';
  }
  // 清洗任何文件系统中非法的字符（冒号/斜杠等）
  ext = ext.replace(/[^.\w]/g, '');
  return ext || '.jpg';
}

// 校验文件内容是否为常见图片格式（防代理/网络返回 HTML 错误页被误当图片上传）
function isImageBuffer(buf) {
  if (!buf || buf.length < 4) return false;
  if (buf[0] === 0xFF && buf[1] === 0xD8) return true; // JPEG
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return true; // PNG
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return true; // GIF
  if (buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') return true; // WebP
  return false;
}

function downloadToTemp(imageUrl, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new url.URL(imageUrl); } catch (e) { return reject(new Error('非法图片 URL')); }

    const ext = pickExt(imageUrl);
    const out = path.join(TMP, `img_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`);

    const onResponse = (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadToTemp(res.headers.location, timeoutMs).then(resolve, reject);
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('下载失败 HTTP ' + res.statusCode)); }
      const ws = fs.createWriteStream(out);
      res.pipe(ws);
      ws.on('finish', () => {
        let buf;
        try { buf = fs.readFileSync(out); } catch (e) { fs.unlink(out, () => {}); return reject(new Error('读取下载文件失败')); }
        if (!isImageBuffer(buf)) {
          fs.unlink(out, () => {});
          return reject(new Error('下载内容不是有效图片（可能代理返回了错误页或非图片数据）'));
        }
        resolve(out);
      });
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

module.exports = { downloadToTemp, TMP, pickExt, isImageBuffer };
