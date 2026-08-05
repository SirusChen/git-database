/**
 * seed.js — 开发联调用：用「真实抓取到的样本 + 结构化合成数据」填充 data/bookmarks.jsonl，
 * 以便在没有外网代理时也能端到端验证 store / API / 前端（分页 + 时间跳转 + 无限滚动）。
 *
 * 说明：本文件仅用于验证流水线。真实数据请通过 POST /api/sync 从 x.com 抓取
 * （需 Clash 代理/TUN 在线）。seed 帖子 id 以 "seed_" 前缀，不会与真实数字 id 冲突。
 * 真实样本同样复用 normalize.js，保证与实时抓取落库的形状完全一致。
 */
const fs = require('fs');
const path = require('path');
const store = require('./store');
const { normalize } = require('./normalize');

const ROOT = path.resolve(__dirname, '..');
const REAL = path.join(ROOT, '_raw_tweet.json');

function realRecord() {
  try {
    const tr = JSON.parse(fs.readFileSync(REAL, 'utf8'));
    return normalize(tr);   // 复用数据契约，与 fetcher 保持一致
  } catch (e) { console.error('realRecord failed:', e.message); return null; }
}

// 确定性伪随机，保证可复现
let s = 987654321;
const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
const pick = a => a[Math.floor(rnd() * a.length)];
const ri = n => Math.floor(rnd() * n);

const AUTHORS = [
  { screen_name: 'oekaki_bibbi', name: 'びっび', avatar: 'https://pbs.twimg.com/profile_images/1/qq.jpg' },
  { screen_name: 'sye_rii', name: 'しぇりい', avatar: 'https://pbs.twimg.com/profile_images/2/rr.jpg' },
  { screen_name: 'TemPainting', name: 'Tem', avatar: 'https://pbs.twimg.com/profile_images/3/tt.jpg' },
  { screen_name: 'lion_sey', name: '獅子', avatar: null },
  { screen_name: 'neon_void', name: 'Neon', avatar: 'https://pbs.twimg.com/profile_images/4/nn.jpg' },
  { screen_name: 'pixel_chef', name: '像素厨师', avatar: 'https://pbs.twimg.com/profile_images/5/pc.jpg' },
  { screen_name: 'ai_daily', name: 'AI Daily', avatar: 'https://pbs.twimg.com/profile_images/6/ad.jpg' },
  { screen_name: 'mech_art', name: '機械美少女', avatar: 'https://pbs.twimg.com/profile_images/7/ma.jpg' },
  { screen_name: 'code_notes', name: '代码笔记', avatar: null },
  { screen_name: 'travel_jp', name: '日本旅日', avatar: 'https://pbs.twimg.com/profile_images/8/tj.jpg' },
  { screen_name: 'game_clips', name: 'Game Clips', avatar: 'https://pbs.twimg.com/profile_images/9/gc.jpg' },
  { screen_name: 'cat_world', name: '猫の世界', avatar: 'https://pbs.twimg.com/profile_images/10/cw.jpg' }
];

const TEXTS = [
  '今天的日落真的太美了 #sunset #photography',
  '刚做完一个新的机械设定，花了一整周 @mech_art 你们觉得如何？',
  '分享一个超好用的工具：https://example.com/tool 效率直接翻倍',
  'Remielle Dan 的同人图完成！感谢大家一直以来的支持 #fanart',
  '深夜 coding 事故现场，debug 到怀疑人生 @code_notes',
  '新料理实验：和风咖喱饭，附步骤图四张',
  'AI 这周的进展汇总 thread 🧵 1/3 模型推理成本又降了',
  '旅行第3天，京都的寺庙安静得让人想哭 #kyoto #travel',
  '录制了一段 30 秒的战斗演示，画质拉满',
  '猫主子今天又在键盘上睡觉，工作效率 -100% @cat_world',
  '关于 @x 的新 API 变化，整理了几点注意事项，详见长图',
  '周末画了张治愈系的，希望看到的人都能放松一下 #healing',
  '这条是引用推文，原帖真的很有意思',
  '凌晨四点的城市，霓虹与雨 #cyberpunk #neon',
  '教程更新：如何用 10 行代码实现无限滚动 https://example.com/scroll'
];

const HASHTAG_POOL = ['art', 'daily', 'dev', 'game', 'cat', 'travel', 'ai', 'music', 'food', 'code'];
const MENTION_POOL = ['oekaki_bibbi', 'mech_art', 'code_notes', 'cat_world', 'ai_daily'];

function genMedia(kind) {
  if (kind === 0) return [];
  if (kind === 'video') {
    const w = 1280, h = 720;
    return [{ type: 'video', url: 'https://pbs.twimg.com/ext_tw_video_thumb/1.jpg', width: w, height: h, thumb: 'https://pbs.twimg.com/ext_tw_video_thumb/1.jpg:thumb' }];
  }
  if (kind === 'gif') {
    return [{ type: 'gif', url: 'https://pbs.twimg.com/tweet_video/1.gif', width: 498, height: 280, thumb: 'https://pbs.twimg.com/tweet_video/1.gif:thumb' }];
  }
  const n = kind; // 1,2,4
  const out = [];
  for (let i = 0; i < n; i++) {
    const w = pick([1200, 1664, 1080, 1500]); const h = pick([1800, 2432, 1350, 2000]);
    out.push({ type: 'photo', url: `https://pbs.twimg.com/media/seed${ri(99999)}.jpg?name=large`, width: w, height: h, thumb: `https://pbs.twimg.com/media/seed${ri(99999)}.jpg:thumb` });
  }
  return out;
}

function synth(i) {
  const a = pick(AUTHORS);
  const created = new Date(Date.UTC(2026, 6, 10) + ri(24 * 3600 * 1000 * 22)); // 7/10-8/1
  const kinds = [0, 1, 1, 2, 2, 4, 4, 'video', 'gif'];
  const mk = pick(kinds);
  const media = genMedia(mk);
  const ents = { hashtags: [], mentions: [], urls: [] };
  if (rnd() < 0.6) ents.hashtags = [pick(HASHTAG_POOL), pick(HASHTAG_POOL)].filter((v, k, arr) => arr.indexOf(v) === k);
  if (rnd() < 0.4) ents.mentions = [pick(MENTION_POOL)];
  if (rnd() < 0.3) ents.urls = [{ expanded: 'https://example.com/' + ri(9999), display: 'example.com/' + ri(9999) }];
  let text = pick(TEXTS);
  return {
    id: 'seed_' + String(i).padStart(4, '0'),
    created_at: created.toISOString(),
    author: { id: 'u_' + ri(99999), screen_name: a.screen_name, name: a.name, avatar: a.avatar },
    text,
    lang: pick(['ja', 'en', 'zh', 'ja', 'en']),
    source: pick(['Twitter for iPhone', 'Twitter Web App', 'Twitter for Android']),
    sensitive: rnd() < 0.1,
    conversation_id: 'seed_' + String(i).padStart(4, '0'),
    is_quote: mk === 'quote',
    media,
    entities: ents,
    stats: {
      likes: ri(5000), retweets: ri(800), replies: ri(300),
      quotes: ri(120), bookmarks: ri(900), views: ri(2000000)
    }
  };
}

// 组装：真实样本(若有) + 59 条合成，bookmarked_at 按 i 倒序
const posts = [];
const real = realRecord();
if (real) posts.push(real);
for (let i = 1; i <= 59; i++) posts.push(synth(i));

const base = Date.parse('2026-08-04T22:00:00Z');
posts.forEach((p, idx) => { p.bookmarked_at = new Date(base - idx * 7.5 * 3600 * 1000).toISOString(); });

// 写入（去重幂等）
let added = 0;
for (const p of posts) if (store.append(p)) added++;
const meta = store.getMeta();
console.log(`[seed] 生成 ${posts.length} 条，新增 ${added} 条；库总计 ${meta.count} 条`);
console.log(`[seed] bookmarked_at 范围: ${meta.minBookmarkedAt} → ${meta.maxBookmarkedAt}`);
