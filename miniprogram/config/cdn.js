// config/cdn.js
// CDN 配置中心
//
// 当前方案：用 git 仓库做 CDN
// GitHub 仓库 SirusChen/git-database 的 sound-assets 分支，经 jsDelivr 提供
// 静态音频文件服务，无需自建服务器、无需付费。
//
// jsDelivr URL 格式：https://cdn.jsdelivr.net/gh/USER/REPO@BRANCH/path
// 例：https://cdn.jsdelivr.net/gh/SirusChen/git-database@sound-assets/animals/dog-bark.mp3
//
// 微信小程序注意：后台「开发管理 - 服务器域名」需把 cdn.jsdelivr.net
// 加入 downloadFile 合法域名（InnerAudioContext 走此通道）。
// 开发者工具可临时勾选「不校验合法域名」。
//
// 国内访问不稳定时改用镜像域名之一：
//   fastly.jsdelivr.net / gcore.jsdelivr.net / testingcf.jsdelivr.net

const CDN_BASE = "https://cdn.jsdelivr.net/gh/SirusChen/git-database@sound-assets";

// 是否开发模式（占位 CDN 时 true，跳过远程请求）
// 现在 CDN 真实可用，IS_DEV 自动为 false
const IS_DEV = CDN_BASE.includes("example.com");

// 是否启用远程 sounds.json 热更新（需把 config/sounds.json 传到 sound-assets 根目录）
// 当前远程尚未部署 sounds.json，故为 false，首页使用本地打包配置
const REMOTE_SOUNDS_ENABLED = false;

module.exports = {
  CDN_BASE: CDN_BASE,

  IS_DEV: IS_DEV,
  REMOTE_SOUNDS_ENABLED: REMOTE_SOUNDS_ENABLED,

  // 远程声音配置清单（部署到 sound-assets 根目录后启用热更新）
  SOUNDS_JSON: `${CDN_BASE}/sounds.json`,

  // 音频文件根目录
  SOUND_DIR: `${CDN_BASE}`,

  // 分享封面图目录
  SHARE_DIR: `${CDN_BASE}/share`,

  // 本地缓存过期时间（毫秒）—— 6 小时
  CACHE_TTL: 6 * 60 * 60 * 1000,

  // 拼接音频地址：
  // - 完整 URL / cloud:// fileID 直接返回
  // - / 开头为本地包内路径（如 /audio/dog.wav），直接返回
  // - 其余相对路径拼 CDN_BASE
  resolveUrl(path) {
    if (!path) return "";
    if (/^https?:\/\//.test(path) || /^cloud:\/\//.test(path)) {
      return path;
    }
    if (path.charAt(0) === "/") {
      return path;
    }
    return `${CDN_BASE}/${path}`;
  },

  // 分享封面图地址
  resolveShareImg(soundId) {
    return `${CDN_BASE}/share/${soundId}.png`;
  },
};
