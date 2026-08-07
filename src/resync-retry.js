/**
 * resync-retry.js — 代理不通时自动重试，连通后执行全量重同步。
 *
 * 用法:
 *   node src/resync-retry.js [pageDelayMs] [--cdp]
 * 参数:
 *   pageDelayMs   每页之间的间隔毫秒（默认 60000 = 1 分钟；CDP 模式下作为页面间 fetch 重放间隔）
 *   --cdp         使用 CDP 传输层：经已登录调试 Edge (9222) 抓包，绕过 Node TLS 指纹封锁
 * 环境变量:
 *   RETRY_INTERVAL_MS  每次失败后的重试间隔（默认 1000 = 1s）
 *   RETRY_MAX          最大重试次数（默认 3600 ≈ 21h，超过则放弃并退出码 1）
 *   CDP_PORT           CDP 调试端口（默认 9222）
 *   SOCKS_PROXY        可覆盖代理地址（仅 node 传输用到）
 *
 * 行为:
 *   node 模式:
 *   1. 每 RETRY_INTERVAL_MS 调用 fetcher.probeConnection()（只读首屏，绝不碰本地数据）。
 *   2. 探测成功 → fetcher.resync() 全量抓取（纯 Node 传输）。
 *   cdp 模式:
 *   1. 每 RETRY_INTERVAL_MS 直接尝试 fetcher.resync({transport:'cdp'})；
 *      resync 内部会先抓首屏，抓不到（代理离线/未登录）即抛错 → 等待重试。
 *   2. 一旦成功即全量抓取并落盘。
 *   两种模式均：抓完整体反转使最旧收藏排首位，index 从 1 自增，最后 store.replaceAll 单次低频落盘。
 *   完成退出码 0；始终失败超过 RETRY_MAX 退出码 1。
 */
const fetcher = require('./fetcher');

const args = process.argv.slice(2);
const useCdp = args.includes('--cdp');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const RETRY_INTERVAL_MS = Number(process.env.RETRY_INTERVAL_MS) || 1000;
const RETRY_MAX = Number(process.env.RETRY_MAX) || 3600;
const pageDelayMs = Number(process.argv[2]) || 60000;

function ts() { return new Date().toISOString(); }

(async () => {
  console.error(`[resync-retry] 启动 @ ${ts()}`);
  console.error(`[resync-retry] 传输=${useCdp ? 'cdp (调试 Edge ' + (process.env.CDP_PORT || 9222) + ')' : 'node (纯 Node)'}, 重试间隔=${RETRY_INTERVAL_MS}ms, 最大重试=${RETRY_MAX}, 每页间隔=${pageDelayMs}ms`);
  if (!useCdp) console.error(`[resync-retry] 代理=${JSON.stringify(fetcher.proxyConfig ? fetcher.proxyConfig() : 'n/a')}`);

  let attempt = 0;
  while (attempt < RETRY_MAX) {
    attempt++;
    try {
      if (useCdp) {
        // CDP 传输：resync 内部自行探测（首屏抓不到即视为离线），无需单独的 probeConnection
        console.error(`[resync-retry] 尝试 CDP 全量同步 (第${attempt}/${RETRY_MAX}次) @ ${ts()}`);
        const result = await fetcher.resync({ transport: 'cdp', pageDelayMs, betweenPageMs: pageDelayMs || 1500, firstPageMs: Number(process.env.FIRST_PAGE_MS) || 30000 });
        console.error(`[resync-retry] <<< resync(cdp) 完成:`, JSON.stringify(result));
        process.exit(0);
      } else {
        const r = await fetcher.probeConnection();
        console.error(`[resync-retry] 探测成功 (第${attempt}次): nodeCount=${r.nodeCount}, hasBottom=${r.hasBottom} @ ${ts()}`);
        console.error(`[resync-retry] >>> 开始全量重同步 resync...`);
        const result = await fetcher.resync({ pageDelayMs });
        console.error(`[resync-retry] <<< resync 完成:`, JSON.stringify(result));
        process.exit(0);
      }
    } catch (e) {
      const msg = String(e && e.message || e).split('\n')[0];
      console.error(`[resync-retry] 失败 (第${attempt}/${RETRY_MAX}次): ${msg} — ${RETRY_INTERVAL_MS}ms 后重试 @ ${ts()}`);
      await sleep(RETRY_INTERVAL_MS);
    }
  }
  console.error(`[resync-retry] 已达最大重试次数 ${RETRY_MAX}，放弃 @ ${ts()}`);
  process.exit(1);
})();
