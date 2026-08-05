/**
 * normalize.js — 模块 2：数据结构（数据契约）
 * 把 x.com GraphQL 返回的「原始推文节点」映射为本项目的统一 schema。
 *
 * 这是数据入库前的唯一形状定义处：
 *   - fetcher.js（实时抓取）与 seed.js（测试数据）都复用本函数，
 *     保证无论数据来源，落库的 JSONL 字段完全一致。
 *
 * 输出 schema（每条帖子）：
 *   { id, created_at, ingested_at, author{id,screen_name,name,avatar},
 *     text, lang, source, sensitive, conversation_id, is_quote,
 *     media[{type,url,width,height,thumb}], entities{hashtags,mentions,urls},
 *     stats{likes,retweets,replies,quotes,bookmarks,views} }
 *
 * 字段来源说明（基于真实样本）：
 *   - id / created_at : legacy.id_str / legacy.created_at
 *   - author          : core.user_results.result.core（新 schema；legacy 仅兜底）
 *   - media           : legacy.extended_entities.media（含 original_info 宽高，用以锁定卡片比例）
 *   - stats.views     : 顶层 views.count（字符串 → 转数字）
 *   - entities        : legacy.entities（话题/@提及/链接，供前端高亮可点击）
 */
function normalize(tr) {
  const t = tr.tweet || tr;
  const leg = t.legacy || {};
  const ur = t.core && t.core.user_results && t.core.user_results.result;
  const uc = ur ? (ur.core || ur.legacy) : null;
  const avatar = (uc && uc.avatar_image_url)
    || (ur && ur.legacy && ur.legacy.profile_image_url_https)
    || null;

  const mediaRaw = (leg.extended_entities && leg.extended_entities.media) || leg.entities.media || [];
  const media = mediaRaw
    .filter(m => ['photo', 'video', 'gif'].includes(m.type))
    .map(m => {
      const oi = m.original_info || {};
      const large = m.sizes && m.sizes.large;
      return {
        type: m.type,
        url: m.media_url_https,
        width: oi.width || (large && large.w) || null,
        height: oi.height || (large && large.h) || null,
        // :large 保持原始宽高比（:thumb 是 150x150 裁剪图，会破坏比例），供前端按 width/height 渲染
        thumb: m.type === 'photo' ? m.media_url_https + ':large' : (m.media_url_https || null)
      };
    });

  const ent = leg.entities || {};
  const entities = {
    hashtags: (ent.hashtags || []).map(h => h.text),
    mentions: (ent.user_mentions || []).map(u => u.screen_name),
    urls: (ent.urls || []).map(u => ({ expanded: u.expanded_url, display: u.display_url }))
  };

  const views = (t.views && t.views.count != null) ? Number(t.views.count) : null;

  return {
    id: t.rest_id || leg.id_str,
    created_at: leg.created_at ? new Date(leg.created_at).toISOString() : null,
    author: {
      id: leg.user_id_str || null,
      screen_name: uc ? (uc.screen_name || (uc.legacy && uc.legacy.screen_name)) : null,
      name: uc ? (uc.name || (uc.legacy && uc.legacy.name)) : null,
      avatar: avatar
    },
    text: leg.full_text || '',
    lang: leg.lang || null,
    source: tr.source || t.source || null,
    sensitive: !!leg.possibly_sensitive,
    conversation_id: leg.conversation_id_str || null,
    is_quote: !!leg.is_quote_status,
    media: media,
    entities: entities,
    stats: {
      likes: Number(leg.favorite_count) || 0,
      retweets: Number(leg.retweet_count) || 0,
      replies: Number(leg.reply_count) || 0,
      quotes: Number(leg.quote_count) || 0,
      bookmarks: Number(leg.bookmark_count) || 0,
      views: views
    }
  };
}

module.exports = { normalize };
