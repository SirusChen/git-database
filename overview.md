# 声音按钮小程序 · 可播放版本（jsDelivr CDN）

## 状态：已输出可播放版本 ✅

用微信开发者工具打开 `D:\Workspace\sound-master`，勾选「不校验合法域名」即可播放 **50 个真实音效**（源自 GitHub `sound-assets` 经 jsDelivr CDN）。

## 技术方案：git 做 CDN（jsDelivr）

| 项 | 内容 |
|----|------|
| 音源仓库 | GitHub `SirusChen/git-database` 的 `sound-assets` 分支 |
| CDN | jsDelivr `https://cdn.jsdelivr.net/gh/SirusChen/git-database@sound-assets/{cat}/{id}.mp3` |
| 优势 | 无需自建服务器/付费，推到 GitHub 即生效 |
| 已验证 | jsDelivr 已索引全部 50 个 mp3，实际 URL 返回有效 MP3 |

## 交付清单

| 文件 | 作用 |
|------|------|
| `miniprogram/config/cdn.js` | `CDN_BASE` 指向 jsDelivr，`resolveUrl()` 拼路径，`IS_DEV=false` |
| `miniprogram/config/sounds.json` | 50 个声音（emoji + 中文标签 + 7 色），由脚本生成 |
| `scripts/gen_sounds_config.py` | 整理音源 → 生成 sounds.json |
| `miniprogram/utils/audio.js` | 单例音频引擎（防 iOS 叠加 + 错误降级） |
| `miniprogram/pages/index/` | 首页网格、分类切换、播放态、分享骨架 |

## 关键指标

- **主包 41KB**（音频全走 CDN，包体极小）
- **50 个真实音效**，7 大分类：动物9 / 搞怪12 / 游戏5 / 欢快7 / 乐器5 / 自然5 / 奇怪7
- JS 语法全过，url 零格式错误

## 上线前必做

1. 小程序后台「服务器域名」→ downloadFile 合法域名加 `cdn.jsdelivr.net`
2. 国内访问不稳时改用镜像：`fastly.jsdelivr.net` / `gcore.jsdelivr.net` / `testingcf.jsdelivr.net`
3. 启用热更新：把 `sounds.json` 传到 `sound-assets` 根目录，改 `REMOTE_SOUNDS_ENABLED=true`
4. 分享封面图（Day 2 待做）

## 音源调研补充

- **有趣日常音源**：SoundDino 提供免费免版税（无需注册署名）的相机快门、键盘等；爱给网、站长素材有剃须刀音效（需确认授权）
- **sound-assets 缺口**：暂缺「电子产品日常」类（剃须刀/相机/键盘），建议后续补充到仓库即可用 jsDelivr 引用

## 下一步（Day 2）

- 分享封面图生成与上传
- 分享回流自动播放真机验证
- 域名白名单配置
