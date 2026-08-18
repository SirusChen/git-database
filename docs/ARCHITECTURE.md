# 声音按钮小程序 · 架构设计方案

> 目标：用户点击 emoji 按钮即可播放对应声音，音频走 CDN，主包轻量，快速上线 + 社交裂变获客。

## 一、需求拆解与关键决策

| 需求 | 技术决策 | 原因 |
|------|---------|------|
| 点击按钮播放声音 | `wx.createInnerAudioContext` 单例复用 | 避免频繁创建上下文，支持即时切换、打断前一个 |
| 声音源存 CDN | 音频 mp3 放 CDN，`sounds.json` 配置也放 CDN | 主包不打包音频，避免超 2MB 限制；可热更新声音库无需发版 |
| emoji 按钮 | WXML 直接渲染 emoji 字符 | 0 字节图片资源，跨平台显示一致，可爱风格天然成立 |
| 快速上线 | 单页面 + 云开发 + 静态 CDN | 无登录、无支付、无复杂业务，1-2 天可提审 |
| 获客 | 每个声音独立分享卡片 + 群红包玩法 | 微信社交裂变核心通路 |

## 二、整体架构（三层）

```
┌─────────────────────────────────────────────────┐
│  ① 小程序前端（主包 < 1.5MB）                    │
│  ┌──────────┬──────────┬──────────┬──────────┐  │
│  │ 首页 emoji│ 音频引擎  │ 声音清单 │ 分享卡片 │  │
│  │ 网格页面 │ utils/   │ CDN 拉取 │ onShare* │  │
│  │          │ audio.js │          │          │  │
│  └──────────┴──────────┴──────────┴──────────┘  │
└─────────────────────────────────────────────────┘
           │ wx.request            │ InnerAudioContext.src
           ▼                       ▼
┌─────────────────────────────────────────────────┐
│  ② CDN 静态资源层（不占包体）                    │
│  ┌──────────────┬──────────────┬──────────────┐ │
│  │ sounds.json  │ *.mp3 音频库 │ share/*.png  │ │
│  │ 配置清单      │ 8-30KB/条   │ 分享封面图    │ │
│  └──────────────┴──────────────┴──────────────┘ │
└─────────────────────────────────────────────────┘
           │ 上报播放                ▼ 分享回流带 query
┌─────────────────────────────────────────────────┐
│  ③ 云开发后端（留存与获客）                      │
│  ┌──────────────┬──────────────┬──────────────┐ │
│  │ play_log 集合│ favorites 集合│ 热门榜单云函数│ │
│  │ openid/sound │ 用户收藏夹    │ 聚合 play_log │ │
│  └──────────────┴──────────────┴──────────────┘ │
└─────────────────────────────────────────────────┘
```

## 三、目录结构（基于现有项目改造）

```
sound-master/
├── miniprogram/
│   ├── app.js                    # 全局：初始化云开发、全局音频上下文
│   ├── app.json                  # 页面注册、窗口配置
│   ├── app.wxss                  # 全局样式（按钮基础样式）
│   ├── config/
│   │   └── cdn.js                # CDN 域名、版本号配置
│   ├── pages/
│   │   └── index/
│   │       ├── index.js          # 首页逻辑：拉清单、点击播放、分享
│   │       ├── index.json
│   │       ├── index.wxml        # emoji 网格布局
│   │       └── index.wxss        # 按钮可爱风格样式
│   ├── utils/
│   │   ├── audio.js              # 音频引擎封装（核心）
│   │   ├── cdn.js                # CDN 配置拉取与缓存
│   │   └── share.js              # 分享卡片生成
│   └── components/
│       └── sound-button/         # 可复用的声音按钮组件
│           ├── index.js
│           ├── index.json
│           ├── index.wxml
│           └── index.wxss
├── cloudfunctions/
│   ├── reportPlay/               # 上报播放记录
│   └── getHotList/               # 热门榜单聚合
└── project.config.json
```

## 四、核心代码模板

### 4.1 音频引擎封装 `utils/audio.js`

单例 `InnerAudioContext`，切换 src 时自动停止前一个，避免 iOS 多音频叠加问题。

```javascript
// miniprogram/utils/audio.js
let _ctx = null
let _currentId = null

function getCtx() {
  if (!_ctx) {
    _ctx = wx.createInnerAudioContext()
    _ctx.onError((err) => {
      console.error('[audio] play error', err)
      wx.showToast({ title: '播放失败', icon: 'none', duration: 800 })
    })
  }
  return _ctx
}

function play(sound) {
  const ctx = getCtx()
  // 同一个声音再次点击：停止
  if (_currentId === sound.id) {
    ctx.stop()
    _currentId = null
    return { playing: false }
  }
  ctx.stop()
  ctx.src = sound.url
  ctx.play()
  _currentId = sound.id
  return { playing: true }
}

function stop() {
  if (_ctx) {
    _ctx.stop()
    _currentId = null
  }
}

module.exports = { play, stop, getCtx }
```

### 4.2 声音配置清单 `sounds.json`（CDN 托管）

```json
{
  "version": "1.0.0",
  "categories": [
    { "id": "animal", "name": "动物", "emoji": "🐾" },
    { "id": "funny",  "name": "搞怪", "emoji": "🎭" },
    { "id": "daily",  "name": "日常", "emoji": "☕" }
  ],
  "sounds": [
    {
      "id": "dog",
      "emoji": "🐶",
      "label": "汪汪",
      "category": "animal",
      "url": "https://cdn.example.com/sounds/v1/dog.mp3",
      "color": "pink",
      "duration": 1.2
    },
    {
      "id": "cat",
      "emoji": "🐱",
      "label": "喵呜",
      "category": "animal",
      "url": "https://cdn.example.com/sounds/v1/cat.mp3",
      "color": "teal",
      "duration": 0.9
    }
  ]
}
```

### 4.3 首页逻辑 `pages/index/index.js`

```javascript
const audio = require('../../utils/audio.js')
const { CDN_BASE, SOUNDS_JSON } = require('../../config/cdn.js')

Page({
  data: {
    sounds: [],
    filtered: [],
    categories: [],
    activeCategory: 'all',
    currentId: null
  },

  onLoad(options) {
    // 分享回流：带 soundId 自动播放
    this._shareSoundId = options.soundId || ''
    this.loadSounds()
  },

  async loadSounds() {
    // 优先用缓存，避免每次冷启动都拉
    const cached = wx.getStorageSync('sounds_json')
    if (cached) this.applySounds(cached)

    try {
      const [err, res] = await new Promise(r =>
        wx.request({ url: SOUNDS_JSON, success: (res) => r([null, res]), fail: (err) => r([err, null]) })
      )
      if (!err && res.data) {
        this.applySounds(res.data)
        wx.setStorageSync('sounds_json', res.data)
        // 缓存 6 小时
        wx.setStorageSync('sounds_json_expire', Date.now() + 6 * 3600 * 1000)
      }
    } catch (e) {
      console.warn('[index] load sounds failed', e)
    }

    // 分享回流自动播放
    if (this._shareSoundId) {
      const target = this.data.sounds.find(s => s.id === this._shareSoundId)
      if (target) setTimeout(() => this.onTapSound(target), 300)
    }
  },

  applySounds(data) {
    this.setData({
      sounds: data.sounds,
      filtered: data.sounds,
      categories: data.categories
    })
  },

  onTapSound(e) {
    const sound = typeof e === 'object' && e.id ? e : this.data.sounds.find(s => s.id === e.currentTarget.dataset.id)
    const { playing } = audio.play(sound)
    this.setData({ currentId: playing ? sound.id : null })

    // 上报播放（云开发）
    wx.cloud.callFunction({ name: 'reportPlay', data: { soundId: sound.id } })
  },

  onSwitchCategory(e) {
    const id = e.currentTarget.dataset.id
    this.setData({
      activeCategory: id,
      filtered: id === 'all' ? this.data.sounds : this.data.sounds.filter(s => s.category === id)
    })
  },

  onShareAppMessage() {
    const s = this.data.sounds.find(x => x.id === this.data.currentId)
    return {
      title: `来听这个「${s ? s.label : '来一声'}」${s ? s.emoji : '✨'}`,
      path: `/pages/index/index?soundId=${s ? s.id : ''}`,
      imageUrl: s ? `${CDN_BASE}/share/${s.id}.png` : ''
    }
  },

  onShareTimeline() {
    const s = this.data.sounds.find(x => x.id === this.data.currentId)
    return {
      title: `来听这个「${s ? s.label : '来一声'}」${s ? s.emoji : '✨'}`,
      query: `soundId=${s ? s.id : ''}`
    }
  }
})
```

### 4.4 首页 WXML `pages/index/index.wxml`

```xml
<view class="page">
  <view class="header">
    <text class="title">来一声 ✨</text>
  </view>

  <scroll-view scroll-x class="tabs" enhanced show-scrollbar="{{false}}">
    <view class="tab {{activeCategory === 'all' ? 'tab--active' : ''}}"
          data-id="all" bindtap="onSwitchCategory">全部</view>
    <view wx:for="{{categories}}" wx:key="id"
          class="tab {{activeCategory === item.id ? 'tab--active' : ''}}"
          data-id="{{item.id}}" bindtap="onSwitchCategory">
      {{item.emoji}} {{item.name}}
    </view>
  </scroll-view>

  <view class="grid">
    <view wx:for="{{filtered}}" wx:key="id"
          class="btn btn--{{item.color}} {{currentId === item.id ? 'btn--playing' : ''}}"
          data-id="{{item.id}}" bindtap="onTapSound"
          bindlongpress="onLongPressSound">
      <text class="btn__emoji">{{item.emoji}}</text>
      <text class="btn__label">{{item.label}}</text>
    </view>
  </view>
</view>
```

### 4.5 全局样式 `app.wxss`（可爱风格核心）

```css
page {
  background: linear-gradient(180deg, #FBEAF0 0%, #F6F6F6 30%);
  min-height: 100vh;
}

.grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16rpx;
  padding: 24rpx;
}

.btn {
  aspect-ratio: 1 / 1;
  border-radius: 32rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8rpx;
  border: 2rpx solid transparent;
  transition: transform 0.1s;
}
.btn:active { transform: scale(0.92); }

.btn--pink   { background: #FBEAF0; border-color: #F4C0D1; }
.btn--teal   { background: #E1F5EE; border-color: #9FE1CB; }
.btn--amber  { background: #FAEEDA; border-color: #FAC775; }
.btn--purple { background: #EEEDFE; border-color: #CECBF6; }
.btn--blue   { background: #E6F1FB; border-color: #B5D4F4; }
.btn--green  { background: #EAF3DE; border-color: #C0DD97; }

.btn--playing {
  transform: scale(0.95);
  box-shadow: 0 0 0 4rpx rgba(212, 83, 126, 0.25) inset;
}

.btn__emoji { font-size: 64rpx; line-height: 1; }
.btn__label { font-size: 22rpx; color: #5F5E5A; }
```

## 五、CDN 配置规范

### 5.1 域名白名单（微信后台必填）

在小程序后台 → 开发管理 → 服务器域名 中配置：

| 类型 | 域名 |
|------|------|
| request 合法域名 | `https://cdn.example.com` |
| downloadFile 合法域名 | `https://cdn.example.com` |

> 注意：`InnerAudioContext` 走的是 downloadFile 通道，必须配置 downloadFile 域名，且必须 HTTPS。

### 5.2 音频文件规范

- **格式**：MP3（兼容性最好，iOS/Android 均支持）
- **码率**：64kbps 即可（短音效不需要高保真）
- **时长**：单条 0.5-3 秒
- **大小**：单条 8-30KB
- **目录结构**：
  ```
  https://cdn.example.com/
  ├── sounds.json              # 配置清单
  ├── sounds/v1/dog.mp3        # 音频文件，带版本目录
  ├── sounds/v1/cat.mp3
  └── share/dog.png            # 分享封面 500×400
  ```

### 5.3 CDN 缓存策略

- `sounds.json`：`Cache-Control: max-age=21600`（6 小时，保证热更新）
- `*.mp3`：`Cache-Control: max-age=31536000`（一年，永久缓存）
- 版本切换通过 URL 路径（`/v1/` → `/v2/`）实现强制更新

## 六、分享获客策略

### 6.1 三层分享通路

| 通路 | 触发 | 路径 | 转化关键 |
|------|------|------|---------|
| 单声音分享 | 长按按钮 / 播放后点分享 | `/pages/index/index?soundId=dog` | 落地即播，体验闭环 |
| 朋友圈分享 | 右上菜单 | `query=soundId=dog` | 标题带 emoji 吸引点击 |
| 群红包玩法 | 播放 N 次解锁 | 引导分享到群 | 二期再做 |

### 6.2 分享卡片设计

- **标题模板**：`来听这个「汪汪」🐶` —— 带 emoji + 拟声词，朋友圈识别度高
- **封面图**：500×400 PNG，用大字号 emoji 居中 + 粉色背景，无文字也能识别
- **落地页**：自动播放对应声音，首屏即听到，转化率最高

## 七、性能与审核要点

### 7.1 性能

| 指标 | 目标 | 手段 |
|------|------|------|
| 启动时间 | < 1.5s | 主包仅代码，无音频/大图 |
| 主包大小 | < 1.5MB | 音频全走 CDN，emoji 字符 0 字节 |
| 点击响应 | < 100ms | 单例 audio context，无创建开销 |
| 二次启动 | 即时 | sounds.json 本地缓存 6 小时 |

### 7.2 审核（首次过审关键）

- **类目**：工具类 → 实用工具
- **隐私协议**：仅用 `wx.cloud`（自动鉴权 openid），无需用户授权，可不申请隐私接口
- **内容合规**：声音内容避免涉政、涉黄、侵权；用户不可上传内容，无 UGC 风险
- **分享标题**：避免诱导分享词汇（"必看""震惊"等）
- **测试**：真机测试 iOS + Android，弱网下播放体验

## 八、上线节奏（建议 3 天）

### Day 1：基础搭建
- [ ] 改造 app.json / app.wxss，清理 quickstart 模板页面
- [ ] 实现 `utils/audio.js` 音频引擎
- [ ] 准备 9-12 条声音素材（3 个分类 × 3-4 条）
- [ ] 上传音频到 CDN，生成 sounds.json

### Day 2：前端实现
- [ ] 首页 emoji 网格 + 分类切换
- [ ] 接入 CDN 配置拉取 + 本地缓存
- [ ] 实现分享（onShareAppMessage + onShareTimeline）
- [ ] 分享回流自动播放

### Day 3：提审上线
- [ ] 真机测试（iOS + Android + 弱网）
- [ ] 配置域名白名单
- [ ] 提交审核（预计 1-2 天过审）
- [ ] 过审后分享到种子群启动裂变

## 九、二期扩展方向（先不做）

- **云开发留存**：play_log + favorites + 热门榜单
- **用户上传**：UGC 声音（需 imgSecCheck/msgSecCheck 审核）
- **声音合集**：用户自建歌单，可分享合集卡片
- **广告变现**：激励视频解锁稀有声音
- **声音征集**：用户投票决定下期上线哪些声音
