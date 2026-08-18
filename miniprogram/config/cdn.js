// config/cdn.js —— 本地分包模式
//
// 本小程序音频全部打包进本地分包 miniprogram/subpackages/audioN，
// 通过 wx.loadSubPackage 按需加载（见 utils/audio.js），
// 无需任何服务器 / 域名 / ICP 备案 / 白名单，提审零额外成本。
//
// 分享封面图：本地分包方案暂未生成封面，resolveShareImg 返回空，
// 分享卡片走微信默认样式。

// 是否启用远程 sounds.json 热更新（本地分包方案下关闭）
const REMOTE_SOUNDS_ENABLED = false;

module.exports = {
  REMOTE_SOUNDS_ENABLED,

  // 本地路径（以 / 开头）直接返回；完整 URL / cloud:// 也原样返回
  resolveUrl(path) {
    return path || "";
  },

  // 分享封面图：本地方案暂无封面
  resolveShareImg() {
    return "";
  },
};
