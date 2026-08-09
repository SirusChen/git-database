'use strict';

/**
 * index.js — 模块入口 + 命令行调用
 *
 * 作为模块引入：
 *   const { XiaohongshuPublisher } = require('./xhs-cdp-publish');
 *   const r = await new XiaohongshuPublisher({ port: 9222 })
 *     .publish({ title, content, imagePath, tags, aiDeclaration });
 *
 * 作为命令行运行：
 *   node src/xhs-cdp-publish/index.js \
 *     --images D:/a.jpg,D:/b.jpg \   # 多图（逗号分隔；也可用 --image 单图）
 *     --title "标题" \
 *     --content "第一行\n第二行" \
 *     --tags "AI生成,二次元ai绘画" \
 *     --schedule "2026-08-11 10:00" \ # 定时发布（YYYY-MM-DD HH:mm）
 *     --ai \
 *     --screenshot-dir D:/out
 *   # 仅验证不发布：追加 --dry-run
 */

const path = require('path');
const { XiaohongshuPublisher } = require('./publisher');

function parseArgs(argv) {
  const out = { tags: [], images: [], schedule: undefined, ai: false, dryRun: false, host: '127.0.0.1', port: 9222 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--title':
        out.title = argv[++i];
        break;
      case '--content':
        out.content = argv[++i];
        break;
      case '--image':
        out.image = argv[++i];
        break;
      case '--images':
        out.images = argv[++i].split(',').map((t) => t.trim()).filter(Boolean);
        break;
      case '--schedule':
        out.schedule = argv[++i];
        break;
      case '--tags':
        out.tags = argv[++i]
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean);
        break;
      case '--ai':
        out.ai = true;
        break;
      case '--dry-run':
        out.dryRun = true;
        break;
      case '--host':
        out.host = argv[++i];
        break;
      case '--port':
        out.port = Number(argv[++i]) || 9222;
        break;
      case '--screenshot-dir':
        out.screenshotDir = argv[++i];
        break;
      case '--help':
      case '-h':
        out.help = true;
        break;
      default:
        break;
    }
  }
  return out;
}

function printHelp() {
  console.log(`
小红书 CDP 图文发布工具（零依赖，Node 内置 WebSocket 驱动）

前置条件：
  - 调试 Edge 已启动并开启 CDP（默认 127.0.0.1:9222），小红书已登录
  - 图片须为本地绝对路径

用法：
  node src/xhs-cdp-publish/index.js --images <a.jpg,b.jpg> [选项]

选项：
  --image <path>        本地图片绝对路径（单图；与 --images 二选一）
  --images <a,b,c>     本地图片绝对路径，逗号分隔（多图）
  --title <text>       标题（≤20 单位）
  --content <text>     正文，用 \\n 分隔段落
  --tags <a,b,c>       话题标签，逗号分隔（须为已存在话题）
  --schedule <dt>      定时发布时间，格式 'YYYY-MM-DD HH:mm'
  --ai                 勾选「笔记含AI合成内容」官方声明
  --dry-run            填完内容但【不点发布】（用于验证流程）
  --screenshot-dir <d> 保存预览截图到此目录
  --host <ip>          CDP 主机（默认 127.0.0.1）
  --port <n>           CDP 端口（默认 9222）
  -h, --help           显示本帮助
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  const imagePaths = args.images.length
    ? args.images.map((p) => path.resolve(p))
    : (args.image ? [path.resolve(args.image)] : []);
  if (!imagePaths.length) {
    console.error('缺少必填参数 --image 或 --images <本地图片路径>');
    printHelp();
    process.exit(2);
  }

  const publisher = new XiaohongshuPublisher({ host: args.host, port: args.port });
  const result = await publisher.publish({
    title: args.title,
    content: args.content,
    imagePaths,
    tags: args.tags,
    aiDeclaration: args.ai,
    scheduledAt: args.schedule,
    dryRun: args.dryRun,
    screenshotDir: args.screenshotDir ? path.resolve(args.screenshotDir) : undefined,
  });
  console.log(JSON.stringify(result, null, 2));
  if (result.published) console.log('✅ 发布成功');
  else if (result.dryRun) console.log('🟡 dry-run 完成（未发布）');
  else console.log('⚠️ 未能确认发布成功，请检查 URL');
}

// 仅在直接运行时执行 CLI；被 require 时不触发
if (require.main === module) {
  main().catch((e) => {
    console.error('ERROR:', e.message);
    process.exit(1);
  });
}

module.exports = { XiaohongshuPublisher, parseArgs, printHelp };
