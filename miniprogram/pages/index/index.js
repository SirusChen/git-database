// pages/index/index.js
const audio = require("../../utils/audio.js");
const cdn = require("../../config/cdn.js");
const localSounds = require("../../config/sounds.js");

Page({
  data: {
    sounds: [],
    filtered: [],
    categories: [],
    activeCategory: "all",
    currentId: null,
    loading: true,
  },

  onLoad(options) {
    // 分享回流：带 soundId 自动播放
    this._shareSoundId = options.soundId || "";

    // 注册音频状态回调，同步播放态高亮
    audio.onStateChange((playing, soundId) => {
      this.setData({ currentId: playing ? soundId : null });
    });

    // 本地分包方案：直接使用打包配置立即渲染
    this._applySounds(localSounds);
    this._tryAutoPlay();
  },

  onUnload() {
    audio.stop();
  },

  onHide() {
    audio.stop();
  },

  _applySounds(data) {
    const categories = [{ id: "all", name: "全部", emoji: "✨" }].concat(
      data.categories || []
    );
    this.setData({
      sounds: data.sounds || [],
      filtered: data.sounds || [],
      categories,
      loading: false,
    });
  },

  _tryAutoPlay() {
    if (!this._shareSoundId) return;
    const target = this.data.sounds.find((s) => s.id === this._shareSoundId);
    if (target) {
      setTimeout(() => this.onTapSound(target), 300);
    }
  },

  onTapSound(e) {
    let sound;
    if (e && e.id) {
      sound = e; // 直接传对象
    } else if (e && e.currentTarget) {
      const id = e.currentTarget.dataset.id;
      sound = this.data.sounds.find((s) => s.id === id);
    }
    if (!sound) return;

    const { playing } = audio.play(sound);
    this.setData({ currentId: playing ? sound.id : null });

    // 轻震动反馈（增强点击感）
    if (playing) wx.vibrateShort({ type: "light" });
  },

  onSwitchCategory(e) {
    const id = e.currentTarget.dataset.id;
    const filtered =
      id === "all"
        ? this.data.sounds
        : this.data.sounds.filter((s) => s.category === id);
    this.setData({ activeCategory: id, filtered });
  },

  // 分享给朋友
  onShareAppMessage() {
    const s = this.data.sounds.find((x) => x.id === this.data.currentId);
    return {
      title: `来听这个「${s ? s.label : "来一声"}」${s ? s.emoji : "✨"}`,
      path: `/pages/index/index?soundId=${s ? s.id : ""}`,
      imageUrl: s ? cdn.resolveShareImg(s.id) : "",
    };
  },

  // 分享到朋友圈
  onShareTimeline() {
    const s = this.data.sounds.find((x) => x.id === this.data.currentId);
    return {
      title: `来听这个「${s ? s.label : "来一声"}」${s ? s.emoji : "✨"}`,
      query: `soundId=${s ? s.id : ""}`,
      imageUrl: s ? cdn.resolveShareImg(s.id) : "",
    };
  },
});
