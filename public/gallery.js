/**
 * gallery.js — 画廊公共渲染/交互（UMD，index / favorites 共用，避免重复实现）
 *
 * 导出的能力：
 *  - cardHTML(p)         单条帖子卡片 HTML（与 index.html 原实现一致；图片锚点加 data-post-id / data-media-idx）
 *  - buildFlatList(items) 把全部帖子的 media 展开成 flat 图片序列 [{postId,mediaIdx,base,full}]
 *  - setup(opts)         初始化一个画廊页面：虚拟滚动 + 滚动持久化 + 跳转 + 点图开灯箱
 *
 * setup 不关心「数据从哪个接口来」「用哪个滚动 key」「是否显示同步」——由 opts 决定，
 * 因此 index.html（全量书签）与 favorites.html（仅收藏帖）可同构复用。
 */
(function (global) {
  'use strict';

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const escAttr = esc;
  const fmtNum = (n) => (n == null ? '—' : Number(n).toLocaleString('en-US'));
  const fmtDate = (iso) => { if (!iso) return ''; const d = new Date(iso); return isNaN(d) ? iso : d.toLocaleString(); };

  function linkify(text) {
    let html = esc(text);
    html = html.replace(/https?:\/\/t\.co\/\w+/g, (m) =>
      `<a class="lnk" href="${escAttr(m)}" target="_blank" rel="noopener">${esc(m)}</a>`);
    html = html.replace(/(^|[\s(])#(\w+)/g, (m, p, h) =>
      `${p}<a class="lnk" href="https://x.com/hashtag/${escAttr(h)}" target="_blank" rel="noopener">#${esc(h)}</a>`);
    html = html.replace(/(^|[\s(])@(\w+)/g, (m, p, u) =>
      `${p}<a class="lnk" href="https://x.com/${escAttr(u)}" target="_blank" rel="noopener">@${esc(u)}</a>`);
    return html.replace(/\n/g, '<br>');
  }

  function cardHTML(p) {
    const a = p.author || {};
    const avatar = a.avatar
      ? `<img class="av" src="${esc(a.avatar)}" alt="" onerror="this.style.visibility='hidden'">`
      : `<div class="av" style="background:#22303c"></div>`;
    const permalink = (a.screen_name && p.id) ? `https://x.com/${esc(a.screen_name)}/status/${esc(p.id)}` : null;
    let imgs = '';
    if (p.media && p.media.length) {
      const n = Math.min(p.media.length, 4);
      imgs = `<div class="imgs imgs-${n}">` + p.media.slice(0, 4).map((m, mi) => {
        const base = (m.url || m.thumb || '').replace(/:\w+$/, '');
        const feedSrc = base ? base + ':small' : (m.url || m.thumb || '');
        const fullSrc = base ? base + ':large' : (m.url || m.thumb || '');
        const ar = (m.width && m.height) ? `style="aspect-ratio:${m.width}/${m.height}"` : '';
        return `<a class="imglink" href="#" data-full="${esc(fullSrc)}" data-post-id="${esc(p.id)}" data-media-idx="${mi}"><img loading="lazy" src="${esc(feedSrc)}" alt="media" ${ar} onerror="this.style.opacity=.25"></a>`;
      }).join('') + `</div>`;
    }
    const link = permalink ? `<a class="plink" href="${permalink}" target="_blank" rel="noopener">在 X 上查看 ↗</a>` : '';
    return `<article class="card" data-id="${esc(p.id)}">
      <div class="head">${avatar}<div class="who">
        <div class="name">${esc(a.name || '')}${a.screen_name ? `<span class="handle">${esc(a.screen_name)}</span>` : ''}</div>
        <div class="meta-line">发布 ${fmtDate(p.created_at)}</div>
      </div></div>
      <div class="text">${linkify(p.text || '')}</div>
      ${imgs}
      <div class="stats">👍 ${fmtNum(p.stats && p.stats.likes)} &nbsp; 🔁 ${fmtNum(p.stats && p.stats.retweets)} &nbsp; 💬 ${fmtNum(p.stats && p.stats.replies)} &nbsp; 🔖 ${fmtNum(p.stats && p.stats.bookmarks)} &nbsp; 👁 ${fmtNum(p.stats && p.stats.views)} ${link}</div>
    </article>`;
  }

  // 把全部帖子的 media 展开成 flat 序列，顺序天然满足「两者结合」翻页：
  // 同帖多图在序列中相邻（先翻同帖），帖边界自然接下一条帖。
  function buildFlatList(items) {
    const flat = [];
    for (const p of (items || [])) {
      if (p.media && p.media.length) {
        p.media.forEach((m, mi) => {
          const base = (m.url || m.thumb || '').replace(/:\w+$/, '');
          const full = base ? base + ':large' : (m.url || m.thumb || '');
          flat.push({ postId: p.id, mediaIdx: mi, base, full });
        });
      }
    }
    return flat;
  }

  /**
   * 初始化一个画廊页面。
   * @param {object} opts
   * @param {HTMLElement} opts.viewport 虚拟滚动容器
   * @param {HTMLElement} opts.statusEl 状态条
   * @param {HTMLElement} [opts.totalEl] 总数显示
   * @param {string} opts.scrollKey localStorage 滚动位置 key（各页独立，互不影响）
   * @param {string} opts.endpoint 取帖接口（如 /api/bookmarks 或 /api/favorite-posts）
   * @param {number} [opts.pageSize=100]
   * @param {object} [opts.lightbox] Lightbox.create 的实例（点图开大图）
   */
  function setup(opts) {
    const { viewport, statusEl, totalEl, scrollKey, endpoint, pageSize = 100, lightbox } = opts;

    let allItems = [];
    let flatList = [];
    let flashId = null;

    const vlist = new VirtualList({
      viewport,
      overscan: 10,
      estimateHeight: 360,
      getKey: (p) => p.id,
      renderItem: (p) => {
        const wrap = document.createElement('div');
        wrap.innerHTML = cardHTML(p);
        const el = wrap.firstElementChild;
        if (flashId && p.id === flashId) el.classList.add('flash');
        return el;
      },
      onRangeChange: (start, end, total) => {
        statusEl.dataset.range = start + '-' + end + '/' + total;
      },
    });

    // ---- 滚动位置持久化（按 key 隔离）----
    function saveScrollPos() {
      const a = vlist.getScrollAnchor();
      if (!a || a.index < 0) return;
      const post = vlist.getItem(a.index);
      if (!post) return;
      const state = { id: post.id, index: a.index, offset: Math.round(a.offset) };
      try { localStorage.setItem(scrollKey, JSON.stringify(state)); } catch (e) {}
    }
    function restoreScrollPos() {
      let raw;
      try { raw = localStorage.getItem(scrollKey); } catch (e) { return; }
      if (!raw) return;
      let saved;
      try { saved = JSON.parse(raw); } catch (e) { return; }
      let idx = (saved.id != null) ? allItems.findIndex((p) => p.id === saved.id) : -1;
      if (idx < 0 && saved.index != null && saved.index >= 0 && saved.index < allItems.length) idx = saved.index;
      if (idx >= 0) vlist.scrollToAnchor({ index: idx, offset: saved.offset || 0 });
    }
    let _saveTimer = 0;
    viewport.addEventListener('scroll', () => {
      if (_saveTimer) return;
      _saveTimer = setTimeout(() => { _saveTimer = 0; saveScrollPos(); }, 400);
    }, { passive: true });
    window.addEventListener('pagehide', saveScrollPos);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveScrollPos(); });

    // ---- 一次性加载全部 ----
    async function loadAll() {
      allItems = [];
      let cursor = 0, pages = 0;
      statusEl.textContent = '加载中…';
      try {
        while (true) {
          const r = await fetch(`${endpoint}?cursor=${cursor}&limit=${pageSize}`);
          const d = await r.json();
          const items = d.items || [];
          for (const it of items) allItems.push(it);
          if (totalEl) totalEl.textContent = `共 ${d.total} 条`;
          if (d.nextCursor == null) break;
          cursor = d.nextCursor;
          if (++pages > 500) break;
        }
        flatList = buildFlatList(allItems);
        vlist.setItems(allItems);
        restoreScrollPos();
        statusEl.textContent = '';
      } catch (e) {
        statusEl.textContent = '加载失败: ' + e.message;
      }
    }

    // ---- 时间跳转（客户端在已加载集合内按 created_at 定位，两页通用）----
    function jump(at) {
      if (!at) { statusEl.textContent = '请选择日期'; return; }
      const endOfDay = at + 'T23:59:59.999Z';
      let best = null, bestOffset = -1;
      for (let i = 0; i < allItems.length; i++) {
        const v = allItems[i].created_at;
        if (v && v <= endOfDay) {
          if (best === null || v > best) { best = v; bestOffset = i; }
        }
      }
      if (bestOffset < 0) { statusEl.textContent = '无匹配'; return; }
      const target = allItems[bestOffset];
      flashId = target ? target.id : null;
      vlist.scrollToIndex(bestOffset, 'center');
      if (flashId) {
        const node = viewport.querySelector(`.card[data-id="${CSS.escape(flashId)}"]`);
        if (node) node.classList.add('flash');
        setTimeout(() => {
          flashId = null;
          viewport.querySelectorAll('.card.flash').forEach((n) => n.classList.remove('flash'));
        }, 1700);
      }
      statusEl.textContent = `已跳转到第 ${bestOffset + 1} 条（发布于 ${fmtDate(target && target.created_at)}）`;
    }

    // ---- 点图开灯箱 ----
    viewport.addEventListener('click', (e) => {
      const a = e.target.closest('.imglink');
      if (a) {
        e.preventDefault();
        const idx = flatList.findIndex(
          (x) => x.postId === a.dataset.postId && x.mediaIdx === Number(a.dataset.mediaIdx)
        );
        if (idx >= 0 && lightbox) lightbox.open(flatList, idx);
      }
    });

    return {
      vlist,
      loadAll,
      jump,
      getFlatList: () => flatList,
      getItems: () => allItems,
      saveScrollPos,
      restoreScrollPos,
      setFlash: (id) => { flashId = id; },
    };
  }

  global.Gallery = { cardHTML, buildFlatList, setup };
})(window);
