// scripts/download_audio.js
// 从 jsDelivr (GitHub SirusChen/git-database@sound-assets) 下载 50 个 mp3 到本地，
// 用于「本地分包」方案（音频不再走 CDN，免域名/免备案/免白名单）。
// 用法: node scripts/download_audio.js

const fs = require("fs");
const path = require("path");
const https = require("https");

const SRC_BASE =
  "https://cdn.jsdelivr.net/gh/SirusChen/git-database@sound-assets";
const OUT_DIR = path.resolve(__dirname, "..", "miniprogram", "_audio_tmp");

const sounds = require("../miniprogram/config/sounds.js").sounds;

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const file = fs.createWriteStream(dest);
      res.pipe(file);
      file.on("finish", () => file.close(() => resolve(dest)));
    });
    req.on("error", reject);
    req.setTimeout(30000, () => req.destroy(new Error("timeout")));
  });
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  let total = 0;
  let ok = 0;
  const sizes = {};
  for (const s of sounds) {
    const url = `${SRC_BASE}/${s.url}`;
    const dest = path.join(OUT_DIR, s.url);
    try {
      await download(url, dest);
      const sz = fs.statSync(dest).size;
      sizes[s.id] = sz;
      total += sz;
      ok++;
      console.log(`OK   ${s.url}  ${(sz / 1024).toFixed(1)}KB`);
    } catch (e) {
      console.error(`FAIL ${s.url}: ${e.message}`);
    }
  }
  console.log(
    `\nDONE: ${ok}/${sounds.length} 文件, 总体积 ${(total / 1024 / 1024).toFixed(2)} MB`
  );
  fs.writeFileSync(
    path.join(OUT_DIR, "_sizes.json"),
    JSON.stringify(sizes, null, 2)
  );
})();
