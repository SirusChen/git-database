// utils/audio.js
// 音频引擎封装：单例 InnerAudioContext，切换 src 自动停止前一个
// 避免 iOS 多音频叠加问题，提供错误降级（震动反馈）

const cdn = require("../config/cdn.js");

let _ctx = null;
let _currentId = null;
let _onStateChange = null; // 外部状态回调 (playing, soundId)

function _ensureCtx() {
  if (_ctx) return _ctx;
  _ctx = wx.createInnerAudioContext();
  _ctx.onError((err) => {
    console.error("[audio] play error", _currentId, err);
    // 降级：震动反馈，提示音频未就绪
    wx.vibrateShort({ type: "light" });
    wx.showToast({
      title: "音频加载中…",
      icon: "none",
      duration: 1000,
    });
    _currentId = null;
    _notify(false, null);
  });
  _ctx.onEnded(() => {
    _currentId = null;
    _notify(false, null);
  });
  _ctx.onStop(() => {
    _currentId = null;
    _notify(false, null);
  });
  return _ctx;
}

function _notify(playing, soundId) {
  if (typeof _onStateChange === "function") {
    _onStateChange(playing, soundId);
  }
}

// 播放或停止
// sound: { id, url, ... } —— url 支持相对路径（自动拼 CDN_BASE）
// 返回 { playing: boolean }
function play(sound) {
  if (!sound || !sound.url) return { playing: false };

  const ctx = _ensureCtx();
  const fullUrl = cdn.resolveUrl(sound.url);

  // 同一个声音再次点击：停止
  if (_currentId === sound.id) {
    ctx.stop();
    _currentId = null;
    return { playing: false };
  }

  // 切换：先停前一个
  ctx.stop();
  ctx.src = fullUrl;
  ctx.play();
  _currentId = sound.id;
  _notify(true, sound.id);
  return { playing: true };
}

function stop() {
  if (_ctx) {
    _ctx.stop();
  }
  _currentId = null;
}

// 注册状态变化回调
function onStateChange(cb) {
  _onStateChange = cb;
}

function getCurrentId() {
  return _currentId;
}

module.exports = {
  play,
  stop,
  onStateChange,
  getCurrentId,
};
