/** 素材库：源 / 分组 / 条目常量与展示辅助 */

export const LIB_SOURCE_ANIMATEMOJIS = 'animatemojis';
export const LIB_SOURCE_FLUENT = 'fluent-emoji';
export const LIB_SOURCE_COMMUNITY = 'animatemojis-community';
export const LIB_SOURCE_MEME_API = 'meme-api';

export const LIB_FORMATS = ['gif', 'webp', 'lottie', 'png', 'svg'];

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
  return {
    id,
    title: preset.title || String(source.title || '表情合集').trim() || '表情合集',
    badge: preset.badge || '',
    desc:
      preset.desc ||
      String(source.desc || '').trim() ||
      '精选动态表情，点开即可浏览下载',
    formatsText,
    countText: count > 0 ? `${count} 个表情` : '即将上新',
    previewUrls: Array.isArray(source.previewUrls) ? source.previewUrls.slice(0, 4) : [],
    thumbs,
    itemCount: count,
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

export function normalizeLibFormat(value) {
  const t = String(value || '')
    .trim()
    .toLowerCase();
  if (t === 'json' || t === 'lottie.json') return 'lottie';
  return t;
}

/** 面向用户的格式名（下载弹层 / 卡片），不展示 GIF、WebP 等术语 */
export function formatLabel(fmt) {
  const key = normalizeLibFormat(fmt);
  if (key === 'gif') return '动图';
  if (key === 'webp' || key === 'jpg' || key === 'jpeg') return '静图';
  /** 官方 Noto 3D 静态图（128.png） */
  if (key === 'png') return '3D静态图';
  if (key === 'lottie') return '动画文件';
  if (key === 'svg') return '矢量图';
  return '文件';
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
 * - 有原生 gif → 默认动图
 * - 仅有静图 → 补「动图」选项（保存时转成 GIF，导入微信更清晰），原静图仍可选
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

/** 默认下载格式：一律优先动图（含静图转 GIF） */
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
