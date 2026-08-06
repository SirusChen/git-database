/**
 * virtual-scroll.js — 通用虚拟列表面（前端独立模块）
 *
 * 设计要点：
 * 1. 接管滚动事件：监听 viewport 的 scroll，按当前 scrollTop 计算可见窗口。
 * 2. 模拟滚动条：用一个与「全量数据」等高(总高度)的 layer 撑开原生滚动条，
 *    因此滚动条反映的是 1000+ 条帖子的完整范围，而真实挂载的 DOM 只有窗口内一小撮。
 * 3. 虚拟窗口：只渲染「视口内 + 上下各 overscan 条(默认 10)」的帖子，
 *    窗口外的节点不挂载，超出回收(按 key 复用)。
 * 4. 可变高度：帖子卡片高度不一(正文/图片)，挂载后用 offsetHeight 实测并更新
 *    位置；图片异步加载导致高度变化由 ResizeObserver 兜底重测，并对视口上方
 *    的位移做补偿，避免滚动跳动。
 * 5. 提供能力(实例方法)：setItems / getItem / scrollToIndex / scrollToTop /
 *    getTotal / getScrollInfo / refresh / destroy。
 *
 * 用法：
 *   const vl = new VirtualList({
 *     viewport,                 // 滚动容器(需固定高度 + overflow:auto)
 *     renderItem: (item, i) => HTMLElement,  // 返回一条帖子的 DOM(模块会加绝对定位)
 *     getKey:    (item, i) => string|number, // DOM 复用 key(默认 item.id)
 *     overscan:  10,            // 视口上下各保留的缓冲条数
 *     estimateHeight: 360,      // 未实测前的估算高度
 *     onRangeChange: (start,end,total) => {} // 可选：可见区间变化回调
 *   });
 *   vl.setItems(items);
 *   vl.scrollToIndex(123, 'center');
 */
(function (global) {
  'use strict';

  function defaultGetKey(item, i) {
    return (item && (item.id != null ? item.id : item.key)) != null ? (item.id != null ? item.id : item.key) : i;
  }

  class VirtualList {
    constructor(opts) {
      if (!opts || !opts.viewport) throw new Error('VirtualList: 必须提供 viewport');
      if (typeof opts.renderItem !== 'function') throw new Error('VirtualList: 必须提供 renderItem');

      this.viewport = opts.viewport;
      this.renderItem = opts.renderItem;
      this.getKey = opts.getKey || defaultGetKey;
      this.overscan = opts.overscan != null ? opts.overscan : 10;
      this.estimateHeight = opts.estimateHeight != null ? opts.estimateHeight : 360;
      this.onRangeChange = opts.onRangeChange || null;

      // 数据 & 布局缓存
      this.items = [];
      this.heights = [];
      this.positions = [];      // positions[i] = 第 i 条的 top
      this.totalHeight = 0;

      // 已挂载的节点：key -> { node, index }
      this.rendered = new Map();

      // 内容层(撑出总高度，子节点绝对定位)
      this.layer = document.createElement('div');
      this.layer.className = 'vl-layer';
      this.layer.style.position = 'relative';
      this.layer.style.width = '100%';
      this.viewport.appendChild(this.layer);

      // 滚动节流(用 rAF)
      this._raf = 0;
      this._onScroll = this._onScroll.bind(this);
      this.viewport.addEventListener('scroll', this._onScroll, { passive: true });

      // 图片异步加载 / 字体加载导致高度变化 -> 重测
      this._ro = ('ResizeObserver' in global)
        ? new ResizeObserver(() => this._measureRendered())
        : null;

      // viewport 尺寸变化(如窗口 resize) -> 重算窗口
      this._roViewport = ('ResizeObserver' in global)
        ? new ResizeObserver(() => this._render())
        : null;
      if (this._roViewport) this._roViewport.observe(this.viewport);

      this._startIndex = -1;
      this._endIndex = -1;
    }

    /* ---------- 数据 ---------- */
    setItems(items) {
      this.items = Array.isArray(items) ? items : [];
      const n = this.items.length;
      this.heights = new Array(n);
      for (let i = 0; i < n; i++) this.heights[i] = this.estimateHeight;
      // 清空旧挂载
      for (const [, rec] of this.rendered) {
        if (this._ro) this._ro.unobserve(rec.node);
        this.layer.removeChild(rec.node);
      }
      this.rendered.clear();
      this._recompute();
      this._startIndex = this._endIndex = -1;
      this._render();
    }

    getItem(index) {
      return this.items[index];
    }

    getTotal() {
      return this.items.length;
    }

    /* ---------- 内部：位置计算 ---------- */
    _recompute() {
      const n = this.items.length;
      if (!this.positions || this.positions.length !== n) this.positions = new Array(n);
      let acc = 0;
      for (let i = 0; i < n; i++) {
        this.positions[i] = acc;
        acc += this.heights[i];
      }
      this.totalHeight = acc;
      this.layer.style.height = this.totalHeight + 'px';
    }

    // 找到最大的 i 满足 positions[i] <= y
    _firstIndexForY(y) {
      const pos = this.positions, n = this.items.length;
      if (n === 0) return 0;
      let lo = 0, hi = n - 1, ans = 0;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (pos[mid] <= y) { ans = mid; lo = mid + 1; }
        else hi = mid - 1;
      }
      return ans;
    }

    /* ---------- 内部：渲染窗口 ---------- */
    _render() {
      const n = this.items.length;
      if (n === 0) {
        if (this._ro) for (const [, rec] of this.rendered) this._ro.unobserve(rec.node);
        this.layer.innerHTML = '';
        this.rendered.clear();
        this._startIndex = this._endIndex = -1;
        return;
      }
      const st = this.viewport.scrollTop;
      const vh = this.viewport.clientHeight || 1;
      const topIdx = this._firstIndexForY(st);
      const botIdx = this._firstIndexForY(st + vh);
      const start = Math.max(0, topIdx - this.overscan);
      const end = Math.min(n - 1, botIdx + this.overscan);

      // 回收窗口外节点
      const need = new Set();
      for (let i = start; i <= end; i++) need.add(this._key(i));
      for (const [key, rec] of this.rendered) {
        if (!need.has(key)) {
          if (this._ro) this._ro.unobserve(rec.node);
          this.layer.removeChild(rec.node);
          this.rendered.delete(key);
        }
      }

      // 挂载窗口内缺失节点
      for (let i = start; i <= end; i++) {
        const key = this._key(i);
        if (!this.rendered.has(key)) {
          const node = this.renderItem(this.items[i], i);
          node.classList.add('vrow');
          node.style.position = 'absolute';
          node.style.left = '0';
          node.style.right = '0';
          node.style.top = this.positions[i] + 'px';
          node._vindex = i;
          node._vkey = key;
          this.layer.appendChild(node);
          this.rendered.set(key, { node, index: i });
          if (this._ro) this._ro.observe(node);
        } else {
          this.rendered.get(key).index = i;
        }
      }

      this._measureRendered();

      // 区间变化回调
      if (this._startIndex !== start || this._endIndex !== end) {
        this._startIndex = start;
        this._endIndex = end;
        if (this.onRangeChange) {
          try { this.onRangeChange(start, end, n); } catch (e) { /* 忽略回调异常 */ }
        }
      }
    }

    // 实测已挂载节点高度并修正位置(含视口上方位移补偿，防止跳动)
    _measureRendered() {
      if (this.rendered.size === 0) return;
      const st = this.viewport.scrollTop;
      const topIdx = this._firstIndexForY(st);
      let dirtyFrom = Infinity, aboveDelta = 0, changed = false;
      for (const [, rec] of this.rendered) {
        const idx = rec.index;
        const h = rec.node.offsetHeight;
        const d = h - this.heights[idx];
        if (Math.abs(d) > 0.5) {
          this.heights[idx] = h;
          changed = true;
          if (idx < dirtyFrom) dirtyFrom = idx;
          if (idx < topIdx) aboveDelta += d; // 视口上方变更 -> 补偿 scrollTop
        }
      }
      if (changed) {
        this._recompute();
        for (const [, rec] of this.rendered) rec.node.style.top = this.positions[rec.index] + 'px';
        if (Math.abs(aboveDelta) > 0.5) this.viewport.scrollTop += aboveDelta;
      }
    }

    _key(i) {
      return this.getKey(this.items[i], i);
    }

    /* ---------- 滚动事件 ---------- */
    _onScroll() {
      if (this._raf) return;
      this._raf = global.requestAnimationFrame(() => {
        this._raf = 0;
        this._render();
      });
    }

    /* ---------- 对外能力 ---------- */
    scrollToIndex(index, align = 'start', smooth = false) {
      const n = this.items.length;
      if (n === 0) return;
      index = Math.max(0, Math.min(n - 1, index | 0));
      const vh = this.viewport.clientHeight || 1;
      const top = this.positions[index];
      const h = this.heights[index];
      let target;
      if (align === 'center') target = top - (vh - h) / 2;
      else if (align === 'end') target = top - vh + h;
      else target = top;
      target = Math.max(0, Math.min(this.totalHeight - vh, target));
      this.viewport.scrollTo({ top: target, behavior: smooth ? 'smooth' : 'auto' });
      // scroll 事件会触发 _render；这里立即渲染一次，保证高亮等同步可见
      this._render();
    }

    scrollToTop() {
      this.viewport.scrollTo({ top: 0, behavior: 'auto' });
      this._render();
    }

    getScrollInfo() {
      return {
        scrollTop: this.viewport.scrollTop,
        viewportH: this.viewport.clientHeight,
        totalHeight: this.totalHeight,
        startIndex: this._startIndex,
        endIndex: this._endIndex,
        total: this.items.length
      };
    }

    // 高度可能整体变化(如切换主题/字体)时调用，重置估算并整页重测
    refresh() {
      for (let i = 0; i < this.items.length; i++) this.heights[i] = this.estimateHeight;
      this._recompute();
      this._render();
    }

    destroy() {
      this.viewport.removeEventListener('scroll', this._onScroll);
      if (this._ro) this._ro.disconnect();
      if (this._roViewport) this._roViewport.disconnect();
      this.layer.remove();
      this.rendered.clear();
    }
  }

  // 导出(UMD)
  if (typeof module !== 'undefined' && module.exports) module.exports = VirtualList;
  global.VirtualList = VirtualList;
})(typeof window !== 'undefined' ? window : globalThis);
