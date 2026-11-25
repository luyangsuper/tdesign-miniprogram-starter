/** 素材库：源 / 分组 / 条目常量与展示辅助 */

export const LIB_SOURCE_ANIMATEMOJIS = 'animatemojis';
export const LIB_SOURCE_FLUENT = 'fluent-emoji';
export const LIB_SOURCE_COMMUNITY = 'animatemojis-community';

export const LIB_FORMATS = ['gif', 'webp', 'lottie'];

const DEFAULT_THUMBS = ['😀', '🥰', '🎉', '✨'];

/**
 * 面向用户的源展示配置（按 sourceId）。
 * 新增仓库时在此补一条即可；未配置则回退云端 title/desc + 默认表情预览。
 */
export const LIB_SOURCE_PRESENTATION = {
  [LIB_SOURCE_ANIMATEMOJIS]: {
    title: '经典动态表情',
    badge: '多格式',
    desc: '圆润笑脸与日常表情，动作轻快好用',
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
  };
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
  if (key === 'webp' || key === 'png' || key === 'jpg' || key === 'jpeg') {
    return '静图';
  }
  if (key === 'lottie') return '动画文件';
  if (key === 'svg') return '矢量图';
  return '文件';
}

/** 条目可用格式列表（有值才返回） */
export function itemAvailableFormats(item) {
  if (item && Array.isArray(item.formats) && item.formats.length) {
    return item.formats.map((f) => normalizeLibFormat(f)).filter(Boolean);
  }
  const files = (item && item.files) || {};
  return LIB_FORMATS.filter((f) => {
    const v = files[f];
    return !!(v && String(v).trim());
  });
}

export function defaultDownloadFormat(item) {
  const available = itemAvailableFormats(item);
  if (available.includes('gif')) return 'gif';
  if (available.includes('webp')) return 'webp';
  return available[0] || 'gif';
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
