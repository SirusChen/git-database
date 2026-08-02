---
name: edge-debug-browser
description: "Launch a debuggable Microsoft Edge (CDP remote debugging, isolated profile) via the built-in PowerShell script, then drive it entirely through agent-browser --cdp for all browser work: opening links, reading the console, evaluating JS, inspecting the DOM, network, screenshots. Trigger phrases: 启动调试 Edge, 可调试浏览器, edge debug, CDP, agent-browser, 浏览器调试, 阅读控制台, 调试网页, console 日志, 网页代码调试."
metadata: {"openclaw":{"requires":{"bins":["agent-browser","pwsh"]},"source":"user-requested"}}
---

# Edge Debug Browser（可调试 Edge + agent-browser）

用一个**独立 profile** 启动可调试的 Microsoft Edge（开启 CDP 远程调试端口），然后**所有**浏览器相关工作——打开链接、阅读控制台、执行 JS、检查 DOM、抓网络、截图——全部在这台调试浏览器上通过 `agent-browser --cdp <port>` 完成。你的日常 Edge 完全不受影响。

---

## 核心规则（必须遵守）

> 一旦进入调试会话，**任何**需要打开网页 / 阅读控制台 / 执行页面 JS / 检查 DOM 的操作，都必须走 `agent-browser --cdp <port>`，**不得**改用普通浏览器、普通浏览器工具或其它 Chrome 实例。调试浏览器就是本次会话唯一的"网页操作面"。

---

## 前置条件

- Windows + 已安装 Microsoft Edge（默认路径 `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`；脚本会自动回退到 x64 路径）。
- `agent-browser` 可用（本机已装，经 WorkBuddy 托管的 Node 运行时；PowerShell 下 `agent-browser` 命令已可用）。
  - 若 `agent-browser` 找不到：直接用原生二进制
    `C:\Users\siruschen\.workbuddy\binaries\node\versions\22.22.2\node_modules\agent-browser\bin\agent-browser-win32-x64.exe`，
    或 `npm install -g agent-browser`。
- 用 **PowerShell** 运行本技能里的命令（脚本与 `agent-browser` 的 `.cmd` 垫片在 PowerShell 下最稳）。

---

## 流程

### 第 0 步（可选但推荐）：先看是否已有调试 Edge 在跑

避免重复启动占用端口。在 PowerShell 里：

```powershell
try { (Invoke-RestMethod -Uri "http://127.0.0.1:9222/json/version" -TimeoutSec 2).Browser } catch { "NO_EDGE_DEBUG" }
```

- 返回浏览器版本字符串 → 已在跑，直接跳到第 3 步（端口 9222）。
- 返回 `NO_EDGE_DEBUG` → 继续第 1 步。

### 第 1 步：启动调试 Edge（内置脚本）

```powershell
pwsh -File "{SKILL_DIR}/scripts/launch-edge-debug.ps1"
# 自定义端口： ...\launch-edge-debug.ps1 -Port 9333
# 启动时直接打开某网址： ...\launch-edge-debug.ps1 -StartUrl https://example.com
```

脚本会输出类似：

```
[3/3] CDP READY
CDP_PORT=9222
      Browser : Microsoft Edge/...
      Endpoint: http://127.0.0.1:9222/json/version
      WS      : ws://127.0.0.1:9222/...
Next: agent-browser --cdp 9222 open <URL>
```

> 注意：如果请求的端口被占用，Edge 会自己换一个端口，脚本从 `DevToolsActivePort` 读出真实端口并输出 `CDP_PORT=<port>`。**始终解析 `CDP_PORT=` 这一行**，不要假设就是 `-Port` 的值。

### 第 2 步：记下端口

把 `CDP_PORT` 的值记下来（默认 9222），下文所有命令里的 `<port>` 都换成它。

### 第 3 步：连接并验证

```powershell
agent-browser --cdp <port> open "https://example.com"
agent-browser --cdp <port> snapshot -i      # 交互元素的可访问性树（拿元素引用 @e1 等）
```

能拿到 snapshot 即连接成功。

---

## 调试操作速查（全部带 `--cdp <port>`）

下面 `<port>` 默认 9222。

### 打开 / 导航链接
```powershell
agent-browser --cdp <port> open "https://target.site/path"
agent-browser --cdp <port> tab new "https://another.site"   # 新标签页打开
agent-browser --cdp <port> reload
agent-browser --cdp <port> back
agent-browser --cdp <port> forward
```

### 阅读控制台（重点）
```powershell
agent-browser --cdp <port> console            # 查看控制台日志
agent-browser --cdp <port> console --clear     # 先清空再查看（隔离噪音）
agent-browser --cdp <port> errors              # 未捕获的页面错误 / 异常
```

### 执行 / 检查页面 JS
```powershell
# 简单表达式
agent-browser --cdp <port> eval "document.title"
# 含引号 / 反引号 / $ 的复杂 JS：用 base64 包裹（避免 shell 转义）
agent-browser --cdp <port> eval -b "$(echo -n "document.querySelectorAll('a').length" | base64)"
# 或 heredoc 经 --stdin
@'
const links = [...document.querySelectorAll('a')];
links.length + ' links';
'@ | agent-browser --cdp <port> eval --stdin
```

### 检查 / 操作 DOM
```powershell
agent-browser --cdp <port> snapshot -i        # 仅交互元素，带 @eN 引用
agent-browser --cdp <port> snapshot            # 完整可访问性树
agent-browser --cdp <port> click "@e2"         # 点击（用 snapshot 里的引用）
agent-browser --cdp <port> type  "@e3" "text"  # 输入文本
agent-browser --cdp <port> fill  "@e3" "text"  # 清空后填入
agent-browser --cdp <port> get text "@e1"      # 取某元素文本
agent-browser --cdp <port> get url             # 当前 URL
```

### 网络请求
```powershell
agent-browser --cdp <port> network requests               # 列出请求
agent-browser --cdp <port> network requests --filter "api" # 按关键字过滤
agent-browser --cdp <port> network requests --clear
agent-browser --cdp <port> har start "trace.har"           # 抓 HAR
agent-browser --cdp <port> har stop
```

### 截图 / PDF
```powershell
agent-browser --cdp <port> screenshot "page.png"          # 视口截图
agent-browser --cdp <port> screenshot --full "full.png"    # 整页
agent-browser --cdp <port> pdf "page.pdf"
```

### 其它有用命令
```powershell
agent-browser --cdp <port> tab list                        # 列出所有标签
agent-browser --cdp <port> wait 3000                        # 等 3 秒让页面稳定
agent-browser --cdp <port> cookies get                     # 看 cookie（调试登录态）
agent-browser --cdp <port> inspect                         # 打开 DevTools 面板
```

---

## 停止 / 清理

- 关掉调试 Edge 窗口即可；或：
  ```powershell
  agent-browser --cdp <port> close --all      # 关闭所有调试会话
  # 仍残留则手动结束进程：
  taskkill /F /IM msedge.exe
  ```
- 调试用的 `D:\download\edge-user-data` 是独立 profile，可随时删除（不影响日常 Edge）。

---

## 排错

| 现象 | 处理 |
|------|------|
| 脚本报 "CDP not ready within 30s" | 端口被占：换 `-Port`，或先 `taskkill /F /IM msedge.exe` 清掉旧的调试实例 |
| `agent-browser` 命令找不到 | 用原生二进制绝对路径（见前置条件），或 `npm install -g agent-browser` |
| 页面跳到登录页 | `snapshot -i` 找登录框，用 `fill` / `click` 登录；或用日常已登录 profile（高级：把 `UserDataDir` 指向真实 Edge profile） |
| `console` / `errors` 无输出 | 日志在页面加载后才产生；先 `open` 目标页，必要时 `console --clear` 后复现操作再看 |
| 端口被 Edge 自动改了 | 解析脚本输出的 `CDP_PORT=` 行，而不是用 `-Port` 原值 |

---

## 与本机其它浏览器的关系

- 本技能用的是 **Edge + 独立 profile**，与已装的 `browser-cdp`（Chrome）技能互不干扰，可同时并存。
- 调试期间请始终用本技能的 `agent-browser --cdp <port>`，不要再开新的普通浏览器窗口做同样的事。
