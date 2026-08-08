/**
 * lightbox.js — 公共大图灯箱（UMD，三页面共用）
 *
 * 能力（对应需求 F1/F2/F4 的大图态）：
 *  - 大图查看（:large 原比例）
 *  - 左右按钮 + ←/→ 键切换上一张/下一张（基于外部传入的 flat 图片序列，天然实现「两者结合」翻页）
 *  - 【收藏图片】按钮：toggle 收藏，文案随状态切换（收藏图片 ⇄ 取消收藏）
 *  - 已发小红书状态：若图片已发布，显示「✅ 已发小红书」徽标 + 小红书链接
 *
 * 自带样式（一次性注入，避免三页重复写 CSS）。
 *
 * 用法：
 *   const lb = Lightbox.create({ getState: (base)=>stateMap[base]||null, onToggleFavorite: async(base)=>bool });
 *   lb.open(flatList, index);   // flatList: [{ postId, mediaIdx, base, full }]
 */
(function (global) {
  'use strict';

  const CSS = `
.lb-overlay { position:fixed; inset:0; z-index:100; display:none; align-items:center; justify-content:center; background:rgba(0,0,0,.94); padding:24px; }
.lb-overlay.open { display:flex; }
.lb-stage { max-width:100%; max-height:100%; display:flex; align-items:center; justify-content:center; }
.lb-overlay img.lb-img { max-width:100%; max-height:82vh; object-fit:contain; border-radius:6px; box-shadow:0 8px 40px rgba(0,0,0,.6); transition:opacity .2s; }
.lb-loading { position:absolute; color:#8b98a5; font-size:13px; }
.lb-close { position:absolute; top:14px; right:16px; background:rgba(255,255,255,.12); color:#fff; border:none; border-radius:50%; width:40px; height:40px; font-size:18px; cursor:pointer; z-index:2; }
.lb-close:hover { background:rgba(255,255,255,.24); }
.lb-nav { position:absolute; top:50%; transform:translateY(-50%); background:rgba(255,255,255,.12); color:#fff; border:none; border-radius:50%; width:48px; height:48px; font-size:26px; cursor:pointer; z-index:2; }
.lb-nav:hover { background:rgba(255,255,255,.24); }
.lb-nav:disabled { opacity:.25; cursor:default; }
.lb-prev { left:16px; }
.lb-next { right:16px; }
.lb-bar { position:absolute; bottom:18px; left:0; right:0; display:flex; gap:12px; align-items:center; justify-content:center; flex-wrap:wrap; padding:0 16px; }
.lb-fav { background:#1d9bf0; color:#fff; border:none; border-radius:8px; padding:9px 18px; font-size:14px; cursor:pointer; }
.lb-fav.active { background:#f91880; }
.lb-pub { color:#ffd400; font-size:13px; background:rgba(0,0,0,.4); padding:6px 10px; border-radius:8px; }
.lb-pub a { color:#ffd400; }
.lb-hint { position:absolute; bottom:2px; left:0; right:0; text-align:center; color:#8b98a5; font-size:12px; }
`;

  function injectStyle() {
    if (document.getElementById('lb-style')) return;
    const st = document.createElement('style');
    st.id = 'lb-style';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  function escAttr(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function create(opts) {
    opts = opts || {};
    const getState = opts.getState || (() => null);
    const onToggleFavorite = opts.onToggleFavorite || (async () => false);

    injectStyle();

    const overlay = document.createElement('div');
    overlay.className = 'lb-overlay';
    overlay.innerHTML = `
      <button class="lb-close" title="关闭">✕</button>
      <button class="lb-nav lb-prev" title="上一张">‹</button>
      <button class="lb-nav lb-next" title="下一张">›</button>
      <div class="lb-stage"><img class="lb-img" alt="media"><div class="lb-loading">加载中…</div></div>
      <div class="lb-bar">
        <button class="lb-fav">收藏图片</button>
        <span class="lb-pub"></span>
      </div>
      <div class="lb-hint">← → 切换 · Esc 关闭 · 点击空白处关闭</div>`;
    document.body.appendChild(overlay);

    const img = overlay.querySelector('.lb-img');
    const loading = overlay.querySelector('.lb-loading');
    const favBtn = overlay.querySelector('.lb-fav');
    const pubSpan = overlay.querySelector('.lb-pub');
    const prevBtn = overlay.querySelector('.lb-prev');
    const nextBtn = overlay.querySelector('.lb-next');

    let list = null;
    let idx = -1;

    function render() {
      if (idx < 0 || !list || !list[idx]) return;
      const item = list[idx];
      img.style.opacity = 0;
      loading.style.display = 'block';
      img.onload = () => { loading.style.display = 'none'; img.style.opacity = 1; };
      img.src = item.full;
      const st = getState(item.base) || {};
      favBtn.textContent = st.favorited ? '取消收藏' : '收藏图片';
      favBtn.classList.toggle('active', !!st.favorited);
      if (st.published && st.published.url) {
        pubSpan.innerHTML = '✅ 已发小红书 <a href="' + escAttr(st.published.url) + '" target="_blank" rel="noopener">查看↗</a>';
      } else {
        pubSpan.innerHTML = '';
      }
      prevBtn.disabled = idx <= 0;
      nextBtn.disabled = idx >= list.length - 1;
    }

    function open(flatList, i) {
      list = flatList;
      idx = i;
      overlay.classList.add('open');
      document.body.style.overflow = 'hidden';
      render();
    }
    function close() {
      overlay.classList.remove('open');
      document.body.style.overflow = '';
      img.src = '';
    }
    function go(d) {
      const ni = idx + d;
      if (ni < 0 || ni >= list.length) return;
      idx = ni;
      render();
    }

    favBtn.addEventListener('click', async () => {
      if (idx < 0 || !list[idx]) return;
      const item = list[idx];
      const fav = await onToggleFavorite(item.base);
      favBtn.textContent = fav ? '取消收藏' : '收藏图片';
      favBtn.classList.toggle('active', !!fav);
    });
    prevBtn.addEventListener('click', () => go(-1));
    nextBtn.addEventListener('click', () => go(1));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target.classList.contains('lb-stage')) close();
    });
    overlay.querySelector('.lb-close').addEventListener('click', close);
    document.addEventListener('keydown', (e) => {
      if (!overlay.classList.contains('open')) return;
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'ArrowRight') go(1);
    });

    return { open, close, go };
  }

  global.Lightbox = { create };
})(window);
