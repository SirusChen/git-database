// scripts/build_local_subpackages.js
// 将下载好的 mp3（miniprogram/_audio_tmp）拆分进本地分包，并改写 sounds.js：
//   - 每包体积均衡（≤1.9MB，绕开「单包 2MB」上限）
//   - 为每个分包生成最小占位页 pages/holder/holder（保证分包合法性，跨开发者工具版本稳妥）
//   - sounds.js 的 url 改为本地绝对路径 /subpackages/<pkg>/<category>/<file>.mp3，并加 pkg 字段
// 用法: node scripts/build_local_subpackages.js
// 注意：音频分包用「按需 wx.loadSubPackage 加载」策略，绕开 preloadRule 的 2MB 聚合预下载限额。

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const TMP = path.join(ROOT, "miniprogram", "_audio_tmp");
const OUT_ROOT = path.join(ROOT, "miniprogram", "subpackages");
const CONFIG = path.join(ROOT, "miniprogram", "config", "sounds.js");

// 每个声音归属哪个音频分包（按体积均衡，nature 的大文件 ocean 已拆散）
const PKG = {
  ocean: "audio1",
  thunder: "audio1",
  wind: "audio2",
  rain: "audio2",
  drum: "audio2",
  "drum-roll": "audio2",
  "evil-laugh": "audio2",
  piano: "audio2",
  "air-horn": "audio2",
};
const PKG_NAMES = ["audio1", "audio2", "audio3"];

function moveFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (fs.existsSync(dest)) fs.unlinkSync(dest);
  fs.copyFileSync(src, dest);
}

// 1) 移动音频文件到对应分包
const data = require(CONFIG);
for (const s of data.sounds) {
  const pkg = PKG[s.id] || "audio3";
  const rel = s.url; // 形如 animals/cat-meow.mp3
  const src = path.join(TMP, rel);
  const dest = path.join(OUT_ROOT, pkg, rel);
  if (!fs.existsSync(src)) {
    console.error(`缺失源文件: ${src}`);
    continue;
  }
  moveFile(src, dest);
  s.pkg = pkg;
  s.url = `/subpackages/${pkg}/${rel}`;
}

// 2) 为每个分包生成最小占位页（保证分包合法性）
for (const name of PKG_NAMES) {
  const base = path.join(OUT_ROOT, name, "pages", "holder");
  fs.mkdirSync(base, { recursive: true });
  fs.writeFileSync(path.join(base, "holder.js"), "Page({});\n");
  fs.writeFileSync(
    path.join(base, "holder.json"),
    JSON.stringify({ navigationBarTitleText: "声音资源" }, null, 2) + "\n"
  );
  fs.writeFileSync(path.join(base, "holder.wxml"), "<view></view>\n");
  fs.writeFileSync(path.join(base, "holder.wxss"), "");
}

// 3) 写回 sounds.js
data.source = "本地分包 (miniprogram/subpackages/audioN)";
const out =
  "// 本地声音配置（由 scripts/build_local_subpackages.js 生成，请勿手改）\n" +
  "module.exports = " +
  JSON.stringify(data, null, 2) +
  ";\n";
fs.writeFileSync(CONFIG, out);

// 4) 打印各分包体积，便于核对 ≤2MB
function dirSize(p) {
  let t = 0;
  if (!fs.existsSync(p)) return t;
  for (const f of fs.readdirSync(p, { withFileTypes: true })) {
    const fp = path.join(p, f.name);
    t += f.isDirectory() ? dirSize(fp) : fs.statSync(fp).size;
  }
  return t;
}
console.log("已生成本地分包：");
for (const name of PKG_NAMES) {
  const sz = dirSize(path.join(OUT_ROOT, name));
  console.log(
    `  ${name}: ${(sz / 1024).toFixed(1)} KB  ${sz > 2 * 1024 * 1024 ? "⚠️ 超 2MB!" : "✓"}`
  );
}
console.log("sounds.js 已更新（含 pkg 字段 + 本地绝对路径 url）");
