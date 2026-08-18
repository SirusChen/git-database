// utils/audio.js
// 音频引擎封装：单例 InnerAudioContext，切换 src 自动停止前一个
// 避免 iOS 多音频叠加问题；支持「本地分包按需加载」。
//
// 设计要点（修复「音频加载失败」toast）：
// 1. 优先直接播放（DevTools 下分包文件本就在本地，可立即播放，无需 loadSubPackage）。
// 2. 若播放报错（真机首播时分包尚未下载），再按需 wx.loadSubPackage 并自动重试一次。
// 3. 这样既绕开了 DevTools 中 loadSubPackage 的误报失败，又兼容真机懒加载。

const cdn = require("../config/cdn.js");

let _ctx = null;
let _currentId = null;
let _currentSound = null;       // 当前正在播放的声音对象（供 onError 重试使用）
let _onStateChange = null;      // 外部状态回调 (playing, soundId)
const _loadedPkgs = {};         // 已加载完成的音频分包 name -> true
const _loadingPkgs = {};        // 正在加载中的 Promise（防重复触发）
const _retried = {};            // soundId -> 是否已触发过「加载分包后重试」

function _ensureCtx() {
  if (_ctx) return _ctx;
  _ctx = wx.createInnerAudioContext();
  _ctx.onError((err) => {
    console.error("[audio] play error", _currentId, err);
    const s = _currentSound;
    const id = _currentId;
    _currentId = null;
    _currentSound = null;
    _notify(false, null);

    // 分包尚未下载（多为真机首播）：加载分包后自动重试一次
    if (s && s.pkg && !_loadedPkgs[s.pkg]) {
      if (_retried[id]) {
        wx.showToast({ title: "音频加载失败", icon: "none" });
        return;
      }
      _retried[id] = true;
      wx.showToast({ title: "加载中…", icon: "none", duration: 800 });
      ensurePkg(s.pkg)
        .then(() => {
          const c = _ensureCtx();
          c.stop();
          c.src = cdn.resolveUrl(s.url);
          c.play();
          _currentId = s.id;
          _currentSound = s;
          _notify(true, s.id);
        })
        .catch((e) => {
          console.error("[audio] 分包加载失败", s.pkg, e);
          delete _retried[id];
          wx.showToast({ title: "音频加载失败", icon: "none" });
        });
      return;
    }

    // 其它播放错误（解码失败等）
    wx.vibrateShort({ type: "light" });
    wx.showToast({ title: "音频加载失败", icon: "none" });
  });
  _ctx.onEnded(() => { _currentId = null; _currentSound = null; _notify(false, null); });
  _ctx.onStop(() => { _currentId = null; _currentSound = null; _notify(false, null); });
  return _ctx;
}

function _notify(playing, soundId) {
  if (typeof _onStateChange === "function") _onStateChange(playing, soundId);
}

// 确保某个音频分包已下载（按需 wx.loadSubPackage）
// 说明：wx.loadSubPackage 已废弃但仍可用，是加载「纯资源分包」的标准做法；
// 它一次只加载一个分包（≤2MB），从而绕开 preloadRule 的 2MB 聚合预下载限额。
// 注意：此函数不阻塞播放，调用方应直接先尝试播放。
function ensurePkg(pkg) {
  if (!pkg) return Promise.resolve();
  if (_loadedPkgs[pkg]) return Promise.resolve();
  if (_loadingPkgs[pkg]) return _loadingPkgs[pkg];
  const p = new Promise((resolve, reject) => {
    wx.loadSubPackage({
      name: pkg,
      success: () => { _loadedPkgs[pkg] = true; console.log("[audio] 分包就绪", pkg); resolve(); },
      fail: (err) => {
        console.error("[audio] 分包加载失败", pkg, err);
        reject(err);
      },
    });
  });
  _loadingPkgs[pkg] = p;
  return p;
}

// 播放或停止
// sound: { id, url, pkg, ... }
// 返回 { playing: boolean }
function play(sound) {
  if (!sound || !sound.url) return { playing: false };

  const ctx = _ensureCtx();

  // 同一个声音再次点击：停止
  if (_currentId === sound.id) {
    ctx.stop();
    _currentId = null;
    _currentSound = null;
    return { playing: false };
  }

  const fullUrl = cdn.resolveUrl(sound.url);

  // 后台静默预加载分包（不阻塞）。DevTools 下文件本就本地存在，直接播放即可；
  // 真机首播时若分包未就绪，onError 会触发上面的「加载分包后重试」逻辑。
  if (sound.pkg && !_loadedPkgs[sound.pkg]) {
    ensurePkg(sound.pkg).catch((e) => {
      console.error("[audio] 分包后台预加载失败（不影响 DevTools 直接播放）", sound.pkg, e);
    });
  }

  // 直接播放：本地分包资源用「全绝对路径」引用（/subpackages/xxx/...）
  _currentSound = sound;
  ctx.stop();
  ctx.src = fullUrl;
  ctx.play();
  _currentId = sound.id;
  _notify(true, sound.id);
  return { playing: true };
}

function stop() {
  if (_ctx) _ctx.stop();
  _currentId = null;
  _currentSound = null;
}

function onStateChange(cb) { _onStateChange = cb; }
function getCurrentId() { return _currentId; }

module.exports = { play, stop, onStateChange, getCurrentId };
