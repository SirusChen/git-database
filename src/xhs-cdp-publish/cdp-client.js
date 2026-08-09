'use strict';

/**
 * cdp-client.js — 低层 Chrome DevTools Protocol 客户端（零第三方依赖）
 *
 * 仅使用 Node.js 内置能力（global WebSocket / fetch / fs），通过浏览器级
 * WebSocket 创建独立 tab、attach 后复用同一条 socket 以 sessionId 区分页面命令。
 *
 * 设计要点（来自多次实战踩坑总结）：
 *  - 文件上传用 Page.setInterceptFileChooserDialog + DOM.setFileInputFiles
 *    （与 agent-browser 的 upload 同机制，可信事件）
 *  - 点击统一走 Input.dispatchMouseEvent 坐标点击 => 产生「可信事件」，
 *    能触发小红书自定义下拉组件（如 AI 声明）；JS el.click() 是合成事件不生效
 *  - 正文换行用 execCommand('insertText', 'a\nb')（\n=段落，\n\n=空行）
 *  - 话题标签用真实按键 Input.dispatchKeyEvent 逐字符输入 + Enter 确认
 *    （ProseMirror 话题插件只响应真实按键链，execCommand 不触发自动完成）
 */

const fs = require('fs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CDPClient {
  constructor({ host = '127.0.0.1', port = 9222 } = {}) {
    this.host = host;
    this.port = port;
    this._id = 0;
    this._pending = new Map(); // id -> {resolve, reject}
    this._listeners = new Map(); // method -> Set<cb>  (on)
    this._once = new Map(); // method -> Set<cb>  (once)
    this.sessionId = null;
    this.targetId = null;
    this.browserWs = null;
    this.pageWs = null;
  }

  get baseUrl() {
    return `http://${this.host}:${this.port}`;
  }

  // ---------- 底层 WebSocket ----------
  _open(wsUrl) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      ws.onopen = () => resolve(ws);
      ws.onerror = (err) => reject(err instanceof Error ? err : new Error('ws error'));
      ws.onmessage = (ev) => this._onMessage(ev.data);
      ws.onclose = () => {};
    });
  }

  _onMessage(data) {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    if (process.env.XHS_CDP_DEBUG) {
      if (msg.id) console.error('RECV', msg.id, msg.error ? 'ERR ' + msg.error.message : 'ok');
      else if (msg.method) console.error('EVENT', msg.method);
    }
    if (msg.id && this._pending.has(msg.id)) {
      const { resolve, reject } = this._pending.get(msg.id);
      this._pending.delete(msg.id);
      if (msg.error) {
        const m = this._pending.get(msg.id);
        if (!m) {
          // 未知 id 的错误响应（通常是该命令已被解析后又返回错误，或 param 校验失败）
          console.error('[CDP] unmatched error response:', JSON.stringify(msg));
          return;
        }
        reject(new Error(`[${m.method}] ${msg.error.message || JSON.stringify(msg.error)}`));
      }
      else resolve(msg.result);
      return;
    }
    if (msg.method) {
      this._emit(msg.method, msg.params || {}, msg.sessionId);
    }
  }

  _emit(method, params, sessionId) {
    const set = this._listeners.get(method);
    if (set) for (const cb of set) cb(params, sessionId);
    const once = this._once.get(method);
    if (once) {
      this._once.delete(method);
      for (const cb of once) cb(params, sessionId);
    }
  }

  on(method, cb) {
    if (!this._listeners.has(method)) this._listeners.set(method, new Set());
    this._listeners.get(method).add(cb);
    return () => this._listeners.get(method) && this._listeners.get(method).delete(cb);
  }

  once(method, cb) {
    if (!this._once.has(method)) this._once.set(method, new Set());
    this._once.get(method).add(cb);
  }

  _sendRaw(ws, method, params = {}, sessionId) {
    const id = ++this._id;
    const msg = { id, method, params };
    if (sessionId) msg.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this._pending.set(id, { resolve, reject, method });
      if (process.env.XHS_CDP_DEBUG) console.error('SEND', id, method, JSON.stringify(params).slice(0, 70));
      ws.send(JSON.stringify(msg));
    });
  }

  /** 向页面 session 发送命令 */
  send(method, params = {}) {
    if (!this.pageWs) return Promise.reject(new Error('CDP 未连接到页面，请先 connect()'));
    return this._sendRaw(this.pageWs, method, params, this.sessionId);
  }

  /** 向浏览器级端点发送命令（Target / Browser 域） */
  sendBrowser(method, params = {}) {
    if (!this.browserWs) return Promise.reject(new Error('浏览器级 WebSocket 未连接'));
    return this._sendRaw(this.browserWs, method, params);
  }

  // ---------- 连接 / 初始化 ----------
  /**
   * 连接调试浏览器，创建一个专用 tab 并 attach。
   * @param {object} [opts]
   * @param {string} [opts.createTargetUrl='about:blank'] 新建 tab 直接打开的 URL
   */
  async connect({ createTargetUrl = 'about:blank' } = {}) {
    const ver = await fetch(`${this.baseUrl}/json/version`).then((r) => r.json());
    this.browserWs = await this._open(ver.webSocketDebuggerUrl);
    const { targetId } = await this.sendBrowser('Target.createTarget', { url: createTargetUrl });
    const { sessionId } = await this.sendBrowser('Target.attachToTarget', {
      targetId,
      flatten: true,
    });
    this.targetId = targetId;
    this.sessionId = sessionId;
    // flatten:true 后页面事件/响应都经 browserWs 并带 sessionId，无需第二条 socket
    this.pageWs = this.browserWs;
    await this.enable();
    return { targetId, sessionId };
  }

  async enable() {
    await this.send('Page.enable');
    await this.send('Runtime.enable');
    await this.send('DOM.enable');
    // 注意：部分 Chromium/Edge 构建没有 Input.enable，且 Input.* 命令无需 enable 即可用
    await this.send('Page.setInterceptFileChooserDialog', { enabled: false });
  }

  // ---------- 页面交互基础 ----------
  async navigate(url) {
    await this.send('Page.navigate', { url });
  }

  async getUrl() {
    return this.evaluate('location.href');
  }

  /**
   * 执行一段 JS 表达式，返回 JSON 值。
   * @param {string} expression
   */
  async evaluate(expression) {
    const { result, exceptionDetails } = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (exceptionDetails) {
      throw new Error('Runtime.evaluate 错误: ' + JSON.stringify(exceptionDetails));
    }
    return result ? result.value : undefined;
  }

  /** 传入函数 + 参数，自动序列化为可调用表达式 */
  evaluateFn(fn, ...args) {
    const expr = `(${fn.toString()})(${args.map((a) => JSON.stringify(a)).join(',')})`;
    return this.evaluate(expr);
  }

  async screenshot(filePath) {
    const { data } = await this.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
    });
    await fs.promises.writeFile(filePath, Buffer.from(data, 'base64'));
    return filePath;
  }

  // ---------- 鼠标（可信事件，坐标点击） ----------
  async _mouseClick(x, y) {
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await this.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x,
      y,
      button: 'left',
      clickCount: 1,
    });
    await this.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x,
      y,
      button: 'left',
      clickCount: 1,
    });
  }

  /**
   * 按可见文本点击（默认取 DOM 中最后一个匹配，避开导航栏同名项）。
   * 通过 scrollIntoView + getBoundingClientRect 取中心点，再派发可信鼠标事件。
   * 匹配逻辑：可见、文本精确/包含匹配（空白折叠 normalize）、且为最内层
   * （无子元素也匹配该文本）；若最内层元素处于 disabled 状态则视为未就绪，
   * 触发重试，直到按钮可点击。
   */
  async clickByText(text, { exact = true, last = true, maxRetries = 3 } = {}) {
    // 浏览器侧使用的 normalize：折叠所有空白为单个空格并 trim（避免换行/多空格导致匹配失败）。
    // 不使用正则，避免字符串字面量转义问题。
    const normSrc =
      "function norm(s){s=String(s==null?'':s);var out='';for(var i=0;i<s.length;i++){var c=s.charCodeAt(i);out+=(c===9||c===10||c===13||c===32)?' ':s.charAt(i);}while(out.indexOf('  ')>0){out=out.split('  ').join(' ');}return out.trim();}";
    const findExpr = (withRect) =>
      normSrc +
      "(function(){var nt=norm(" + JSON.stringify(text) + ");" +
      "var els=[].slice.call(document.querySelectorAll('*')).filter(function(e){" +
      "if(!e.getClientRects().length)return false;" +
      "var t=norm(e.textContent);" +
      "if(" + (exact ? "t!==nt" : "t.indexOf(nt)<0") + ")return false;" +
      "if([].slice.call(e.children).some(function(c){var ct=norm(c.textContent);return " + (exact ? "ct===nt" : "ct.indexOf(nt)>=0") + ";}))return false;" +
      "return true;});" +
      "var el=" + (last ? "els[els.length-1]" : "els[0]") + ";" +
      (withRect
        ? "if(!el)return null;if(el.disabled||(el.closest&&el.closest('[disabled]')))return null;var r=el.getBoundingClientRect();if(r.width===0||r.height===0)return null;return {x:r.left+r.width/2,y:r.top+r.height/2};"
        : "if(el)el.scrollIntoView({block:'center'});return !!el;") +
      "})()";

    // 先把目标滚到可视区域中部
    await this.send('Runtime.evaluate', { expression: findExpr(false), awaitPromise: false, returnByValue: true });
    await sleep(250);

    let lastErr = null;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const { result, exceptionDetails } = await this.send('Runtime.evaluate', {
        expression: findExpr(true),
        awaitPromise: false,
        returnByValue: true,
      });
      if (exceptionDetails) lastErr = new Error('Runtime.evaluate 错误: ' + JSON.stringify(exceptionDetails));
      const pt = result ? result.value : null;
      if (!pt) {
        if (attempt === maxRetries - 1) {
          throw new Error(`clickByText 未找到元素: ${text}` + (lastErr ? ` (${lastErr.message})` : ''));
        }
        await sleep(400);
        continue;
      }
      await this._mouseClick(pt.x, pt.y);
      return pt;
    }
  }

  /** 按 CSS 选择器点击（可信鼠标事件） */
  async clickBySelector(selector, { maxRetries = 3 } = {}) {
    await this.evaluateFn((sel) => {
      const el = document.querySelector(sel);
      if (el) el.scrollIntoView({ block: 'center' });
    }, selector);
    await sleep(250);

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const pt = await this.evaluateFn((sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return null;
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }, selector);

      if (!pt) {
        if (attempt === maxRetries - 1) throw new Error(`clickBySelector 未找到元素: ${selector}`);
        await sleep(300);
        continue;
      }
      await this._mouseClick(pt.x, pt.y);
      return pt;
    }
  }

  /**
   * 点击小红书发布页的「发布」按钮。
   * 该按钮被封装在 closed Shadow DOM 的自定义元素 <xhs-publish-btn> 中，
   * clickByText / querySelector 都无法定位，只能通过 elementFromPoint 命中其可视区域。
   */
  async clickPublishBtn({ maxRetries = 5 } = {}) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const pt = await this.evaluateFn(() => {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        // 底部红色按钮常见位置：视口水平中心、底部偏上 35~75px 区域
        const pts = [
          [Math.round(vw / 2), Math.round(vh - 35)],
          [Math.round(vw / 2), Math.round(vh - 55)],
          [Math.round(vw / 2), Math.round(vh - 75)],
          [Math.round(vw / 2) - 50, Math.round(vh - 35)],
          [Math.round(vw / 2) + 50, Math.round(vh - 35)],
        ];
        for (const [x, y] of pts) {
          const el = document.elementFromPoint(x, y);
          if (el && (el.tagName === 'XHS-PUBLISH-BTN' || el.closest('xhs-publish-btn'))) {
            return { x, y };
          }
        }
        return null;
      });
      if (pt) {
        await this._mouseClick(pt.x, pt.y);
        return pt;
      }
      await sleep(400);
    }
    throw new Error('未找到小红书发布按钮 (xhs-publish-btn)，请确保页面已滚动到底部且红色「发布」按钮可见');
  }

  // ---------- 键盘 ----------
  /** 逐字符派发真实按键事件（可触发 ProseMirror 等输入插件） */
  async typeText(text) {
    for (const ch of String(text)) {
      await this.send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: ch,
        text: ch,
        unmodifiedText: ch,
      });
      await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch, text: ch });
    }
  }

  async pressKey(key, { code, vk, modifiers = 0 } = {}) {
    await this.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key,
      code,
      windowsVirtualKeyCode: vk,
      modifiers,
    });
    await this.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key,
      code,
      windowsVirtualKeyCode: vk,
      modifiers,
    });
  }

  pressEnter() {
    return this.pressKey('Enter', { code: 'Enter', vk: 13 });
  }

  pressSpace() {
    return this.pressKey(' ', { code: 'Space', vk: 32 });
  }

  /** 聚焦输入框后用真实按键输入 */
  async typeInto(selector, text) {
    await this.evaluateFn((sel) => {
      const el = document.querySelector(sel);
      if (!el) return;
      el.focus();
      try {
        el.click();
      } catch {}
    }, selector);
    await sleep(150);
    await this.typeText(text);
  }

  // ---------- 小红书专用 ----------
  /**
   * 用 execCommand 填充 ProseMirror 正文；\n 为段落分隔，\n\n 为空行。
   * 不要用 innerHTML 直接改（会与 React 状态冲突）。
   */
  async fillContent(text) {
    return this.evaluateFn((t) => {
      const ed = document.querySelector('.tiptap.ProseMirror');
      if (!ed) return 'NO_EDITOR';
      ed.focus();
      document.execCommand('selectAll', false, null);
      document.execCommand('delete', false, null);
      document.execCommand('insertText', false, t);
      return 'DONE p=' + ed.querySelectorAll('p').length;
    }, text);
  }

  /**
   * 添加一个话题标签：光标移到末尾 -> 新段落 -> 输入 "#tag" 触发自动完成 ->
   * 等待弹窗 -> Enter 确认（转为 .tiptap-topic 组件，零残留）-> 空格分隔。
   * 注意：tag 必须是小红书已存在的话题，否则不会转为组件。
   */
  async addTag(tag, { suggestionWait = 2200 } = {}) {
    const clean = String(tag).replace(/^#/, '');
    if (!clean) return null;
    await this.evaluateFn(() => {
      const ed = document.querySelector('.tiptap.ProseMirror');
      if (!ed) return;
      ed.focus();
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(ed);
      range.collapse(false); // 移到末尾
      sel.removeAllRanges();
      sel.addRange(range);
    });
    await this.pressEnter(); // 新段落
    await this.typeText('#' + clean); // 真实按键触发自动完成
    await sleep(suggestionWait);
    await this.pressEnter(); // 确认建议
    await this.pressSpace(); // 与下一个标签分隔
    return clean;
  }

  /**
   * 上传文件到 <input type=file>：开启文件选择拦截 -> 触发 input.click() ->
   * 等待 Page.fileChooserOpened -> DOM.setFileInputFiles。
   * filePath 可以是单路径字符串或路径数组（多图上传）。
   */
  async uploadFile(selector, filePath) {
    const paths = Array.isArray(filePath) ? filePath : [filePath];
    if (!paths.length) throw new Error('uploadFile 需要至少一个文件路径');
    await this.send('Page.setInterceptFileChooserDialog', { enabled: true });
    const chooserPromise = new Promise((resolve) => {
      this.once('Page.fileChooserOpened', (params) => resolve(params));
    });

    await this.evaluateFn((sel) => {
      const input = document.querySelector(sel);
      if (!input) throw new Error('未找到文件输入: ' + sel);
      input.click();
    }, selector);

    const params = await Promise.race([chooserPromise, sleep(5000).then(() => null)]);
    if (!params) {
      await this.send('Page.setInterceptFileChooserDialog', { enabled: false });
      throw new Error(`文件选择框未弹出: ${selector}`);
    }
    const { backendNodeId, frameId } = params;
    await this.send('DOM.setFileInputFiles', { files: paths, backendNodeId, frameId });
    await this.send('Page.setInterceptFileChooserDialog', { enabled: false });
    return true;
  }

  /**
   * 设置小红书定时发布。
   * @param {string} dateTimeStr 格式 'YYYY-MM-DD HH:mm'（如 2026-08-10 09:00）
   */
  async setTimedPublish(dateTimeStr) {
    // 确保「更多设置」展开（定时发布开关在折叠面板内）
    const isExpanded = await this.evaluateFn(() => {
      const el = document.querySelector('.publish-page-content-settings');
      return !!(el && el.clientHeight > 0);
    });
    if (!isExpanded) {
      await this.clickByText('更多设置', { exact: false, maxRetries: 3 });
      await sleep(400);
    }
    // 打开定时发布开关
    await this.clickBySelector('.post-time-wrapper .d-switch.d-clickable', { maxRetries: 5 });
    await sleep(800);
    // 输入日期时间
    const sel = '.post-time-wrapper .d-datepicker-input-filter input.d-text';
    await this.evaluateFn((s) => {
      const el = document.querySelector(s);
      if (el) { el.focus(); el.select(); }
    }, sel);
    await sleep(200);
    await this.typeText(dateTimeStr);
    await sleep(300);
    await this.pressEnter();
    await sleep(400);
    // 失焦让组件接受值
    await this.evaluateFn(() => {
      const ed = document.querySelector('.tiptap.ProseMirror') || document.body;
      if (ed) ed.focus();
    });
    await sleep(300);
  }

  // ---------- 收尾 ----------
  async close() {
    try {
      if (this.targetId) await this.sendBrowser('Target.closeTarget', { targetId: this.targetId });
    } catch {}
    try {
      if (this.pageWs) this.pageWs.close();
    } catch {}
    try {
      if (this.browserWs && this.browserWs !== this.pageWs) this.browserWs.close();
    } catch {}
  }
}

module.exports = { CDPClient, sleep };
