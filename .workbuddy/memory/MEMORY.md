# sound-master 项目长期记忆

## 项目定位
声音按钮微信小程序：用户点击 emoji 按钮播放对应声音，音频走 CDN，主打快速上线 + 社交裂变获客。

## 技术栈
- 微信小程序原生开发（WXML/WXSS/JS）
- 微信云开发（云函数 + 数据库，二期启用）
- CDN 托管音频与 sounds.json 配置

## 关键架构决策
- **音频引擎**：单例 `wx.createInnerAudioContext`，切换 src 自动 stop 前一个，避免 iOS 多音频叠加
- **配置清单**：本地兜底配置用 `config/sounds.js`（`module.exports`）——小程序 `require` **不支持直接 require `.json`**，否则报 `module 'config/xxx.json.js' is not defined`；`sounds.json` 仅作为 CDN 热更新清单（远程 wx.request 拉取）。`scripts/gen_sounds_config.py` 一次性生成这两个文件。
- **emoji 按钮**：字符直接渲染，0 字节图片，跨平台一致
- **分享获客**：每个声音独立分享卡片，落地带 soundId 自动播放
- **主包控制**：< 1.5MB，音频全走 CDN 不打包

## 域名白名单 / CDN 备案硬约束（关键！）
- 微信**所有**服务器域名（request / downloadFile / uploadFile / socket）正式发布前**必须完成 ICP 备案**，否则无法加入白名单、提审/上线会卡住。
- 当前 `cdn.jsdelivr.net` 是**境外域名、无国内备案** → 只能用于「开发版/体验版 + 不校验合法域名」调试，**不能用于正式发布**。
- 推荐用于正式发布的免费 CDN（已备案或免备案）：
  1. **微信云开发静态托管 / 云存储**：首推。cloud:// 协议与微信同源，**免白名单配置**；项目已 `wx.cloud.init` 且有 cloudfunctions/，改造成本最低；免费 1GB 存储 + 5GB 流量/月。
  2. **七牛云 Kodo**：免费 10GB 存储 + 10GB CDN 回源流量/月，默认 `*.clouddn.com` 已备案，国内 CDN 快。需把域名加入 downloadFile 白名单。
  3. **腾讯云 COS / 阿里云 OSS**：新用户有免费存储额度，默认 `*.myqcloud.com` 等已备案。
- 仅适合开发/体验版（境外无备案）：jsDelivr(含 fastly/gcore/testingcf 镜像)、Cloudflare Pages/R2、Vercel、Netlify、GitHub Pages。
- 候选待核实：Gitee Pages（gitee.io 已备案、国内快，但有单文件/仓库大小限制、二进制托管不友好）、又拍云（历史免费额度）、多吉云。

## 上线路径
3 天：基础搭建 → 前端实现 → 提审。类目选「工具-实用工具」，无 UGC 无需复杂隐私授权。
**注意**：正式发布前必须把音频 CDN 从 jsDelivr 切到「已备案/免备案」方案（优先云开发静态托管）。
