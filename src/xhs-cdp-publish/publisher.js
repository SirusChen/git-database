'use strict';

/**
 * publisher.js — 小红书图文发布高层封装
 *
 * 封装完整 CDP 发帖流程（基于 cdp-client 的低层原语），对外暴露可调用方法。
 * 流程严格遵循实战验证过的稳定路径（见 cdp-client.js 顶部说明）：
 *   打开创作中心 -> 点「上传图文」-> 上传图片 -> 填标题 -> 填正文(\n换行)
 *   -> 逐条加话题标签(真实按键) -> 可选 AI 声明 -> 截图预览 -> 发布
 */

const path = require('path');
const os = require('os');
const { CDPClient, sleep } = require('./cdp-client');

const DEFAULT_WAITS = {
  afterOpen: 3500, // 打开发布页后等待首屏
  afterClickUpload: 4000, // 点「上传图文」后等编辑表单展开
  afterUpload: 5000, // 上传图片后等待预览
  afterTitle: 1000, // 填标题后
  afterContent: 1500, // 填正文后
  afterTag: 900, // 每条标签后
  afterDeclaration: 1500, // 点开 AI 声明下拉后
  afterPublish: 8000, // 点发布后等待跳转
};

const PUBLISH_URL = 'https://creator.xiaohongshu.com/publish/publish?source=official';

class XiaohongshuPublisher {
  /**
   * @param {object} [opts]
   * @param {string} [opts.host='127.0.0.1']
   * @param {number} [opts.port=9222]
   * @param {import('./cdp-client').CDPClient} [opts.cdp] 可注入已有 CDPClient
   * @param {object} [opts.waits] 覆盖默认等待毫秒
   */
  constructor({ host = '127.0.0.1', port = 9222, cdp, waits } = {}) {
    this.client = cdp || new CDPClient({ host, port });
    this.waits = { ...DEFAULT_WAITS, ...(waits || {}) };
    this.lastPreview = null;
  }

  /**
   * 发布一篇图文帖子（支持单图/多图）。
   * @param {object} params
   * @param {string} params.title 标题（≤20 单位：汉字/全角=1，英文数字每 2 个=1）
   * @param {string} params.content 正文，用 \n 分隔段落
   * @param {string} [params.imagePath] 单图本地绝对路径（与 imagePaths 二选一）
   * @param {string[]} [params.imagePaths] 多图本地绝对路径数组（与 imagePath 二选一）
   * @param {string[]} [params.tags=[]] 话题标签，必须是小红书已存在的话题
   * @param {boolean} [params.aiDeclaration=false] 是否勾选「笔记含AI合成内容」
   * @param {string} [params.scheduledAt] 定时发布时间，格式 'YYYY-MM-DD HH:mm'
   * @param {boolean} [params.dryRun=false] true 时填完所有内容但不点发布（用于验证）
   * @param {string} [params.screenshotDir] 若提供则保存预览截图到此目录
   * @returns {Promise<{published:boolean, url?:string, preview?:string, dryRun?:boolean}>}
   */
  async publish({
    title,
    content,
    imagePath,
    imagePaths,
    tags = [],
    aiDeclaration = false,
    scheduledAt,
    dryRun = false,
    screenshotDir,
  } = {}) {
    const paths = imagePaths || (imagePath ? [imagePath] : []);
    if (!paths.length) throw new Error('publish() 需要 imagePath / imagePaths（本地图片绝对路径）');

    const w = this.waits;
    const client = this.client;

    // 1) 打开创作中心发布页（独立 tab）
    await client.connect({ createTargetUrl: PUBLISH_URL });
    await sleep(w.afterOpen);

    // 2) 进入图文编辑（内容区的「上传图文」，取最后一个匹配避开导航栏）
    await client.clickByText('上传图文', { last: true });
    await sleep(w.afterClickUpload);

    // 3) 上传图片（支持多图）
    await client.uploadFile('input.upload-input[type=file]', paths);
    await sleep(w.afterUpload);

    // 处理可能的位置权限弹窗
    await client.evaluateFn(() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('阻止'));
      if (b) b.click();
    });
    await sleep(400);

    // 4) 标题
    if (title) {
      await client.typeInto('[placeholder*=标题]', title);
      await sleep(w.afterTitle);
    }

    // 5) 正文（\n 换行）
    if (content) {
      await client.fillContent(content);
      await sleep(w.afterContent);
    }

    // 6) 话题标签（真实按键，稳定）
    if (Array.isArray(tags)) {
      for (const tag of tags) {
        if (!tag) continue;
        await client.addTag(tag);
        await sleep(w.afterTag);
      }
    }

    // 7) 官方 AI 声明（可选）
    if (aiDeclaration) {
      await client.clickByText('添加内容类型声明');
      await sleep(w.afterDeclaration);
      await client.clickByText('笔记含AI合成内容');
      await sleep(800);
    }

    // 8) 定时发布（可选）：填完内容后设时间，截图时能看到
    if (scheduledAt) {
      await client.setTimedPublish(scheduledAt);
      await sleep(1000);
    }

    // 9) 预览截图
    if (screenshotDir) {
      try {
        const p = path.join(screenshotDir, 'xhs_publish_preview.png');
        await client.screenshot(p);
        this.lastPreview = p;
      } catch (e) {
        // 截图失败不阻断发布
        this.lastPreview = null;
      }
    }

    if (dryRun) {
      await client.close();
      return { published: false, dryRun: true, preview: this.lastPreview };
    }

    // 10) 发布（小红书把按钮封装在 closed Shadow DOM 的 <xhs-publish-btn> 里，必须用 elementFromPoint 点击）
    await sleep(600);
    await client.clickPublishBtn();

    // 轮询等待发布结果。成功信号通常是：页面离开编辑态 / 出现「发布成功」文案 / 跳转到笔记管理页。
    let url = '';
    let published = false;
    let failShot = null;
    let lastState = null;
    const pollStart = Date.now();
    const maxMs = 30000;
    while (Date.now() - pollStart < maxMs) {
      await sleep(500);
      url = await client.getUrl();
      const pageState = await client.evaluateFn(() => {
        const txt = document.body ? document.body.innerText : '';
        const dlg = document.querySelector('[role="dialog"]');
        const dlgText = dlg ? dlg.innerText.replace(/\s+/g, ' ').trim() : '';
        const host = document.querySelector('xhs-publish-btn');
        return {
          onEditor: location.href.includes('/publish/publish'),
          onManager: location.href.includes('/new/note-manager'),
          hasSuccess: txt.includes('发布成功') || txt.includes('发布完成') || txt.includes('笔记发布成功') || dlgText.includes('发布成功'),
          hasConfirm: dlgText.includes('确认发布') || dlgText.includes('确定要发布') || txt.includes('确认发布'),
          hasFail: txt.includes('发布失败') || txt.includes('无法发布') || txt.includes('请修改') || txt.includes('审核未通过'),
          dlgText: dlgText.slice(0, 120),
          submitLoading: host ? host.getAttribute('submit-loading') === 'true' : false,
          hostExists: !!host,
        };
      });
      lastState = pageState;

      // 如果弹出「确认发布」二次确认框，点掉它（用户反馈正常流程没有，但保留兜底）
      if (pageState.hasConfirm) {
        for (const label of ['确认', '确定', '发布']) {
          try { await client.clickByText(label, { exact: false, maxRetries: 2 }); break; } catch (e) {}
        }
        await sleep(500);
        continue;
      }

      if (pageState.hasFail) {
        throw new Error('小红书提示发布失败或被拦截：' + (pageState.dlgText || '页面含失败/审核提示'));
      }

      if (!pageState.onEditor || pageState.onManager || pageState.hasSuccess ||
          (!pageState.hostExists && pageState.submitLoading)) {
        published = true;
        break;
      }
    }

    url = await client.getUrl();
    if (!published) {
      try { failShot = await client.screenshot(path.join(os.tmpdir(), 'xhs_publish_fail_' + Date.now() + '.png')); } catch (e) {}
    }
    await client.close();
    if (!published) {
      throw new Error('发布后未检测到成功页（当前URL: ' + url + '，最后状态: ' + JSON.stringify(lastState) + '）' + (failShot ? '，已截图: ' + failShot : ''));
    }
    return { published, url, preview: this.lastPreview };
  }
}

module.exports = { XiaohongshuPublisher, DEFAULT_WAITS, PUBLISH_URL };
