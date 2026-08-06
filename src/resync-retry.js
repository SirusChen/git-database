/**
 * resync-retry.js — 代理不通时自动重试，连通后执行全量重同步。
 *
 * 用法:
 *   node src/resync-retry.js [pageDelayMs]
 * 环境变量:
 *   RETRY_INTERVAL_MS  每次探测失败后的重试间隔（默认 1000 = 1s）
 *   RETRY_MAX          最大探测次数（默认 3600 ≈ 21h，超过则放弃并退出码 1）
 *   SOCKS_PROXY        可覆盖代理地址（同 fetcher.proxyConfig）
 *
 * 行为:
 *   1. 每 RETRY_INTERVAL_MS 调用一次 fetcher.probeConnection()（只读首屏，绝不碰本地数据）。
 *   2. 一旦探测成功（代理+Cookie 均可用），立即调用 fetcher.resync() 全量抓取：
 *      - 抓取阶段全程内存累积，每页间隔 pageDelayMs（默认 60000 = 1 分钟）。
 *      - 抓完整体反转使最旧收藏排首位，index 从 1 自增，最后 store.replaceAll 单次低频落盘。
 *   3. resync 完成即退出（退出码 0）；探测始终失败直至超过 RETRY_MAX 则退出（退出码 1）。
 */
const fetcher = require('./fetcher');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const RETRY_INTERVAL_MS = Number(process.env.RETRY_INTERVAL_MS) || 1000;
const RETRY_MAX = Number(process.env.RETRY_MAX) || 3600;
const pageDelayMs = Number(process.argv[2]) || 60000;

function ts() { return new Date().toISOString(); }

(async () => {
  console.error(`[resync-retry] 启动 @ ${ts()}`);
  console.error(`[resync-retry] 重试间隔=${RETRY_INTERVAL_MS}ms, 最大重试=${RETRY_MAX}, resync 每页间隔=${pageDelayMs}ms`);
  console.error(`[resync-retry] 代理=${JSON.stringify(fetcher.proxyConfig ? fetcher.proxyConfig() : 'n/a')}`);

  let attempt = 0;
  while (attempt < RETRY_MAX) {
    attempt++;
    try {
      const r = await fetcher.probeConnection();
      console.error(`[resync-retry] 探测成功 (第${attempt}次): nodeCount=${r.nodeCount}, hasBottom=${r.hasBottom} @ ${ts()}`);
      console.error(`[resync-retry] >>> 开始全量重同步 resync...`);
      const result = await fetcher.resync({ pageDelayMs });
      console.error(`[resync-retry] <<< resync 完成:`, JSON.stringify(result));
      process.exit(0);
    } catch (e) {
      const msg = String(e && e.message || e).split('\n')[0];
      console.error(`[resync-retry] 探测失败 (第${attempt}/${RETRY_MAX}次): ${msg} — ${RETRY_INTERVAL_MS}ms 后重试 @ ${ts()}`);
      await sleep(RETRY_INTERVAL_MS);
    }
  }
  console.error(`[resync-retry] 已达最大重试次数 ${RETRY_MAX}，放弃 @ ${ts()}`);
  process.exit(1);
})();
