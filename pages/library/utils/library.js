/** 素材库：源 / 分组 / 条目常量与展示辅助 */

export const LIB_SOURCE_ANIMATEMOJIS = 'animatemojis';
export const LIB_SOURCE_FLUENT = 'fluent-emoji';
export const LIB_SOURCE_COMMUNITY = 'animatemojis-community';
export const LIB_SOURCE_MEME_API = 'meme-api';

export const LIB_FORMATS = ['gif', 'webp', 'lottie', 'png', 'jpg', 'jpeg', 'svg'];

/** AstrBot 等语义分类 → 短标签（勿用长描述当分类名） */
const LIB_GROUP_SHORT = {
  work: '工作',
  angry: '生气',
  confused: '疑惑',
  happy: '开心',
  sad: '难过',
  shy: '害羞',
  surprised: '惊讶',
  sleep: '睡觉',
  like: '喜欢',
  food: '吃喝',
  money: '金钱',
  greeting: '打招呼',
  entertainment: '娱乐',
  comfort: '安慰',
  mischief: '调皮',
  apology: '道歉',
  approval: '认可',
  attack: '吐槽',
  interaction: '互动',
  question: '疑问',
  reply: '回复',
  sigh: '无奈',
  see: '偷瞄',
  morning: '早安',
  meow: '卖萌',
  action: '动作',
  teasing: '调侃',
  busy: '忙碌',
  wait: '等待',
  praise: '夸奖',
  thanks: '感谢',
  other: '其他',
  affection: '亲昵',
  eating: '吃东西',
  refusal: '拒绝',
  surrender: '认输',
  thinking: '思考',
  celebrate: '庆祝',
  celebrate2: '庆祝',
};

/**
 * 分类标签短名：过滤「用于…」长描述，优先 externalKey 映射。
 * @param {{ title?: string, externalKey?: string, key?: string }} g
 */
export function shortLibraryGroupTitle(g = {}) {
  const key = String(g.externalKey || g.key || '')
    .trim()
    .toLowerCase();
  if (key && LIB_GROUP_SHORT[key]) return LIB_GROUP_SHORT[key];
  const title = String(g.title || '').trim();
  if (!title) return key || '未分类';
  if (/^用于/.test(title) || title.length > 10) {
    if (key && /^[a-z][a-z0-9_-]{0,16}$/i.test(key)) return key;
    return title.slice(0, 6);
  }
  return title;
}

const DEFAULT_THUMBS = ['😀', '🥰', '🎉', '✨'];

/**
 * 面向用户的源展示配置（按 sourceId）。
 * 新增仓库时在此补一条即可；未配置则回退云端 title/desc + 默认表情预览。
 */
export const LIB_SOURCE_PRESENTATION = {
  [LIB_SOURCE_ANIMATEMOJIS]: {
    title: '经典动态表情',
    badge: '多格式',
    desc: '圆润笑脸与日常表情，含平面动图与 3D 静态图',
    thumbs: ['😀', '😂', '🥰', '😎'],
  },
  [LIB_SOURCE_FLUENT]: {
    title: '立体动态表情',
    badge: '立体',
    desc: '偏写实立体风格，人物动作更生动',
    thumbs: ['🙂', '👋', '🚀', '🐱'],
  },
  [LIB_SOURCE_COMMUNITY]: {
    title: '趣味反应表情',
    badge: '梗图',
    desc: '派对、Blob 等聊天反应，发梗更有气氛',
    thumbs: ['🥳', '🔥', '👻', '✨'],
  },
  [LIB_SOURCE_MEME_API]: {
    title: '萌芽表情包',
    badge: '梗图',
    desc: '经典网络梗图表情 · 素材来自 meme-api · CC BY-NC-SA 4.0',
    thumbs: ['😂', '🐼', '🐱', '🍵'],
  },
  'sticker-ext': {
    title: '精选聊天表情',
    badge: '聊天',
    desc: '带描述的聊天表情，点开即可浏览下载',
    thumbs: ['💬', '😄', '🔥', '✨'],
  },
  particlefx: {
    title: '粒子特效素材',
    badge: '特效',
    desc: '氛围粒子动图，点开可选颜色再保存',
    thumbs: ['✨', '🌀', '💫', '🎆'],
  },
};

/** 把云端源记录整理成卡片展示字段（兼容未知新源） */
export function presentLibrarySource(source = {}) {
  const id = String(source.id || source._id || '').trim();
  const preset = LIB_SOURCE_PRESENTATION[id] || {};
  const formats = Array.isArray(source.formatsDefault) ? source.formatsDefault : [];
  const formatsText = formats.map((f) => formatLabel(f)).filter(Boolean).join(' · ') || '多格式';
  const count = Number(source.itemCount) || 0;
  const thumbs =
    Array.isArray(preset.thumbs) && preset.thumbs.length
      ? preset.thumbs.slice(0, 4)
      : DEFAULT_THUMBS;
  const costs =
    source.costs && typeof source.costs === 'object'
      ? {
          anim: Number(source.costs.anim),
          static: Number(source.costs.static),
        }
      : null;
  // 源上显式配了 0 单价才算免费（未配则走全局素材单价）
  const isFree =
    !!costs &&
    Number.isFinite(costs.anim) &&
    Number.isFinite(costs.static) &&
    costs.anim <= 0 &&
    costs.static <= 0;
  // 优先用云端对齐好的 previewSlots（url + fileId），裂图可换签
  let previewSlots = [];
  if (Array.isArray(source.previewSlots) && source.previewSlots.length) {
    previewSlots = source.previewSlots
      .map((s) => ({
        url: String((s && s.url) || '').trim(),
        fileId: String((s && s.fileId) || '').trim(),
      }))
      .filter((s) => s.url)
      .slice(0, 4);
  } else {
    const urls = Array.isArray(source.previewUrls)
      ? source.previewUrls.map((u) => String(u || '').trim()).filter(Boolean)
      : [];
    const ids = Array.isArray(source.previewFileIDs)
      ? source.previewFileIDs.map((id) => String(id || '').trim())
      : [];
    previewSlots = urls.slice(0, 4).map((url, i) => ({
      url,
      fileId: ids[i] || '',
    }));
  }
  const previewUrls = previewSlots.map((s) => s.url);
  // 与首页合集一致：最后一格叠 +剩余（总数 − 已完整露出的张数）
  const shown = previewUrls.length || (count > 0 ? 4 : 0);
  const moreCount =
    count > shown && shown > 0 ? count - (shown - 1) : 0;
  return {
    id,
    title: preset.title || String(source.title || '表情合集').trim() || '表情合集',
    badge: preset.badge || '',
    isFree,
    desc:
      preset.desc ||
      String(source.desc || '').trim() ||
      '精选动态表情，点开即可浏览下载',
    formatsText,
    countText: count > 0 ? `${count} 个表情` : '即将上新',
    previewSlots,
    previewUrls,
    thumbs,
    itemCount: count,
    moreCount,
    sort: Number(source.sort) || 0,
    costs,
  };
}

/**
 * 按源覆盖单价（lib_sources.costs）；无覆盖则回退全局 libraryUnitCost。
 * @param {string} format
 * @param {{anim?: number, static?: number}|null} [sourceCosts]
 * @param {(fmt: string) => number} [fallback]
 */
export function resolveSourceLibraryUnitCost(format, sourceCosts, fallback) {
  const f = String(format || '')
    .trim()
    .toLowerCase();
  const isAnim = f === 'gif' || f === 'lottie' || f === 'json';
  if (sourceCosts && typeof sourceCosts === 'object') {
    const raw = Number(isAnim ? sourceCosts.anim : sourceCosts.static);
    if (Number.isFinite(raw) && raw >= 0) return Math.floor(raw);
  }
  if (typeof fallback === 'function') return Math.max(0, Number(fallback(format)) || 0);
  return 0;
}

/** AnimateMojis 官方分类（与站点对齐） */
export const ANIMATEMOJIS_GROUPS = [
  { key: 'smileys', title: '笑脸与情绪', emoji: '😊' },
  { key: 'people', title: '人物', emoji: '👋' },
  { key: 'animals', title: '动物与自然', emoji: '🐾' },
  { key: 'food', title: '饮食', emoji: '🍕' },
  { key: 'travel', title: '旅行与地点', emoji: '🚀' },
  { key: 'activities', title: '活动与事件', emoji: '🎉' },
  { key: 'objects', title: '物品', emoji: '💡' },
  { key: 'symbols', title: '符号', emoji: '✅' },
  { key: 'flags', title: '旗帜', emoji: '🏁' },
  { key: 'social', title: '社交', emoji: '💬' },
];

export const ALBUM_FORMATS = new Set(['gif', 'webp', 'png', 'jpg', 'jpeg']);

/** 可转成单帧 GIF 再存相册的静图源格式（全源通用，后续新源也走这里） */
export const CONVERTIBLE_STATIC_FORMATS = ['webp', 'png', 'jpg', 'jpeg'];

/** 静图转 GIF 保存单价（原格式仍可按源 costs，默认免费） */
export const CONVERT_TO_GIF_COST = 1;

export function normalizeLibFormat(value) {
  const t = String(value || '')
    .trim()
    .toLowerCase();
  if (t === 'json' || t === 'lottie.json') return 'lottie';
  return t;
}

/**
 * 面向用户的格式名：直接显示具体格式。
 * 「动图 / 静图」只描述素材本身是否动态，不要因为转成 GIF 就叫动图。
 */
export function formatLabel(fmt) {
  const key = normalizeLibFormat(fmt);
  if (key === 'gif') return 'GIF';
  if (key === 'webp') return 'WebP';
  if (key === 'jpg' || key === 'jpeg') return 'JPEG';
  if (key === 'png') return 'PNG';
  if (key === 'lottie') return 'Lottie';
  if (key === 'svg') return 'SVG';
  return key ? key.toUpperCase() : '文件';
}

/** 条目云端真实有的格式（以 files 为准，避免空壳 formats） */
export function itemAvailableFormats(item) {
  const files = (item && item.files) || {};
  const fromFiles = LIB_FORMATS.filter((f) => {
    const v = files[f];
    return !!(v && String(v).trim());
  });
  if (fromFiles.length) return fromFiles;
  if (item && Array.isArray(item.formats) && item.formats.length) {
    return item.formats.map((f) => normalizeLibFormat(f)).filter(Boolean);
  }
  return [];
}

export function itemHasNativeGif(item) {
  return itemAvailableFormats(item).includes('gif');
}

/** 用于转 GIF 的静图源格式（优先 webp） */
export function pickConvertibleStaticFormat(item) {
  const available = itemAvailableFormats(item);
  for (const f of CONVERTIBLE_STATIC_FORMATS) {
    if (available.includes(f)) return f;
  }
  return '';
}

/**
 * 下载弹层选项（全素材源统一）：
 * - 有原生 gif → 默认 GIF
 * - 仅有静图 → 默认仍给 GIF（保存时转码，导入微信更清晰），原格式可选
 * 标签一律用具体格式名，不用「动图/静图」指代扩展名
 */
export function itemDownloadFormatOptions(item) {
  const available = itemAvailableFormats(item);
  const hasGif = available.includes('gif');
  const staticSrc = pickConvertibleStaticFormat(item);
  const opts = [];

  if (hasGif) {
    opts.push({
      value: 'gif',
      label: formatLabel('gif'),
      convertToGif: false,
      billFormat: 'gif',
    });
  } else if (staticSrc) {
    opts.push({
      value: 'gif',
      label: formatLabel('gif'),
      convertToGif: true,
      billFormat: staticSrc,
    });
  }

  available.forEach((f) => {
    if (f === 'gif') return;
    opts.push({
      value: f,
      label: formatLabel(f),
      convertToGif: false,
      billFormat: f,
    });
  });

  return opts;
}

/** 默认下载格式：优先 GIF（含静图转 GIF） */
export function defaultDownloadFormat(item) {
  const opts = itemDownloadFormatOptions(item);
  const gif = opts.find((o) => o.value === 'gif');
  if (gif) return 'gif';
  return (opts[0] && opts[0].value) || 'gif';
}

/** 实际向云函数拉取 / 扣费用的格式 */
export function resolveLibraryBillFormat(item, uiFormat) {
  const want = normalizeLibFormat(uiFormat || 'gif');
  const opts = itemDownloadFormatOptions(item);
  const hit = opts.find((o) => o.value === want);
  if (hit && hit.billFormat) return hit.billFormat;
  if (want === 'gif' && !itemHasNativeGif(item)) {
    return pickConvertibleStaticFormat(item) || want;
  }
  return want;
}

export function shouldConvertDownloadToGif(item, uiFormat) {
  const want = normalizeLibFormat(uiFormat || 'gif');
  if (want !== 'gif') return false;
  if (itemHasNativeGif(item)) return false;
  return !!pickConvertibleStaticFormat(item);
}

export function canSaveFormatToAlbum(fmt) {
  return ALBUM_FORMATS.has(normalizeLibFormat(fmt));
}

export function resolveItemPreview(item) {
  if (!item) return '';
  if (item.previewUrl) return String(item.previewUrl);
  if (item.previewFileID) return '';
  const files = item.files || {};
  return String(files.webp || files.gif || files.png || '').trim();
}
