# DevTools Console+ 扩展

## 核心功能

### 1. Chrome DevTools 自定义面板
- 在 Chrome DevTools 中新增一个自定义 tab（面板）
- 面板名称：`Console+`
- 面板功能：展示页面代码中的日志信息，类似原生 Console 面板

### 2. 全局 Logger 对象
- 提供全局 `logger` 对象作为日志入口（不代理原生 `console`）
- 支持的方法：
  - `logger.log()` - 普通日志
  - `logger.info()` - 信息日志
  - `logger.warn()` - 警告日志
  - `logger.error()` - 错误日志
  - `logger.debug()` - 调试日志
- 参数格式：参考原生 `console.*` 方法，支持多参数传递

### 3. 实时日志展示
- 日志在面板中实时显示
- 显示内容：
  - 时间戳（精确到毫秒）
  - 日志级别（log/info/warn/error/debug）
  - 日志内容（支持多参数格式化）
- 自动滚动到最新日志

### 4. 日志隔离与连接管理
- 按 tabId 隔离日志（每个标签页的日志独立显示）
- 使用长连接机制（`chrome.runtime.connect`）
- 支持连接断开后自动重连（指数退避策略）

### 5. CSP 兼容性
- 绕过页面的 Content Security Policy（CSP）限制
- 使用 `chrome.scripting.executeScript` API 注入脚本
- 支持所有类型的网页（包括严格 CSP 的页面）

## 脚手架搭建

### 构建方案

#### 1. 构建流程
- **开发模式**：`pnpm run dev` - 启动 Vite 开发服务器，监听文件变化
- **生产构建**：`pnpm run build` - 构建到 `dist` 目录
- **插件入口**：`dist` 目录作为 Chrome 扩展的加载目录

#### 3. 热更新机制
- **开发模式**：
  - Vite 监听 `src/` 和 `panel.html` 的变化
  - 自动重新构建到 `dist/` 目录
  - 在 Chrome 扩展管理页面点击"重新加载"即可看到更新
- **文件监听**：
  - 监听 `public/` 目录变化（通过 Vite 插件或构建脚本）
  - 监听 `src/` 目录变化（Vite 自动处理）
  - 自动同步到 `dist/` 目录

#### 4. 开发工作流
1. 启动开发服务器：`pnpm run dev`
2. 在 Chrome 中加载 `dist` 目录作为扩展
3. 修改代码后，Vite 自动构建到 `dist`
4. 在 Chrome 扩展管理页面点击"重新加载"扩展
5. 刷新测试页面查看效果

### 技术栈
- **构建工具**：Vite 5.x
- **扩展规范**：Manifest V3
- **包管理器**：pnpm