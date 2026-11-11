/** 合集内容类型（表情 / 壁纸 / 头像 / 视频） */

export const CONTENT_TYPES = ['emoji', 'wallpaper', 'avatar', 'video'];

export const CONTENT_TYPE_ALL = 'all';

const LABELS = {
  emoji: '表情',
  wallpaper: '壁纸',
  avatar: '头像',
  video: '视频',
};

/**
 * 与 Kubai type-*.png 配色一致（generate-kubai-assets 的 palette）
 * color：文字 / 描边；bg：浅底
 */
const THEMES = {
  all: { color: '#07c160', bg: 'rgba(7, 193, 96, 0.14)' },
  emoji: { color: '#07c160', bg: 'rgba(7, 193, 96, 0.14)' },
  wallpaper: { color: '#8b5cf6', bg: 'rgba(139, 92, 246, 0.14)' },
  avatar: { color: '#3b82f6', bg: 'rgba(59, 130, 246, 0.14)' },
  video: { color: '#ec4899', bg: 'rgba(236, 72, 153, 0.14)' },
};

/** Kubai PNG（见 static/emoji/type-*.png，npm run icons:gen） */
const ICON_SRC = {
  all: '/static/emoji/type-all.png',
  emoji: '/static/emoji/type-emoji.png',
  wallpaper: '/static/emoji/type-wallpaper.png',
  avatar: '/static/emoji/type-avatar.png',
  video: '/static/emoji/type-video.png',
};

export const CONTENT_TYPE_CARET_SRC = '/static/emoji/type-caret.png';

const COUNT_UNITS = {
  emoji: '张',
  wallpaper: '张',
  avatar: '个',
  video: '个',
};

/** 可不选主题分类的类型 */
const CATEGORY_OPTIONAL = {
  wallpaper: true,
  avatar: true,
  video: true,
};

function resolveTypeKey(value) {
  const raw = String(value || '').trim();
  if (!raw || raw === CONTENT_TYPE_ALL) return 'all';
  return CONTENT_TYPES.includes(raw) ? raw : 'emoji';
}

export function normalizeContentType(value) {
  const t = String(value || '').trim();
  return CONTENT_TYPES.includes(t) ? t : 'emoji';
}

export function contentTypeLabel(value) {
  return LABELS[normalizeContentType(value)] || LABELS.emoji;
}

/** Kubai 图路径；value 可为 all */
export function contentTypeIconSrc(value) {
  return ICON_SRC[resolveTypeKey(value)] || ICON_SRC.emoji;
}

/** @deprecated 用 contentTypeIconSrc */
export function contentTypeIcon(value) {
  return contentTypeIconSrc(value);
}

/** @returns {{ color: string, bg: string }} */
export function contentTypeTheme(value) {
  return THEMES[resolveTypeKey(value)] || THEMES.emoji;
}

/** 内联样式：文字色 + 浅底（胶囊 / 标签 / 选中行） */
export function contentTypeChipStyle(value) {
  const t = contentTypeTheme(value);
  return `color:${t.color};background-color:${t.bg};`;
}

/** 仅文字色（详情 meta 等） */
export function contentTypeColorStyle(value) {
  const t = contentTypeTheme(value);
  return `color:${t.color};`;
}

export function isEmojiType(value) {
  return normalizeContentType(value) === 'emoji';
}

export function isVideoType(value) {
  return normalizeContentType(value) === 'video';
}

export function isCategoryOptional(value) {
  return !!CATEGORY_OPTIONAL[normalizeContentType(value)];
}

function decorateTypeOption(id) {
  const theme = THEMES[id] || THEMES.emoji;
  return {
    id,
    name: id === 'all' ? '不限' : LABELS[id],
    iconSrc: ICON_SRC[id],
    color: theme.color,
    bg: theme.bg,
    /** 未选中：仅文字色跟图标一致 */
    textStyle: `color:${theme.color};`,
    /** 选中：文字色 + 浅底 */
    chipStyle: contentTypeChipStyle(id),
  };
}

/** @returns {{ id: string, name: string, iconSrc: string, color: string, bg: string, chipStyle: string }[]} */
export function contentTypeOptions() {
  return CONTENT_TYPES.map((id) => decorateTypeOption(id));
}

/** 首页类型下拉：不限 + 四类 */
export function contentTypeFilterOptions() {
  return [decorateTypeOption('all'), ...contentTypeOptions()];
}

/**
 * 首页类型胶囊文案：未筛选时固定「类型」，筛了某类则显示该类名
 */
export function contentTypeFilterLabel(value) {
  const raw = String(value || '').trim();
  if (!raw || raw === CONTENT_TYPE_ALL) return '类型';
  return contentTypeLabel(raw);
}

export function formatItemCount(count, contentType) {
  const n = Math.max(0, Number(count) || 0);
  const type = normalizeContentType(contentType);
  const unit = COUNT_UNITS[type] || '张';
  if (type === 'avatar') return `${n} 个头像`;
  if (type === 'video') return `${n} 个视频`;
  return `${n} ${unit}`;
}

export function originalsLabel(contentType) {
  const type = normalizeContentType(contentType);
  if (type === 'emoji') return '静态原图';
  if (type === 'video') return '原视频';
  if (type === 'avatar') return '头像原图';
  return '原图';
}

export function originalsPickLabel(contentType) {
  const type = normalizeContentType(contentType);
  if (type === 'video') return '从相册选择视频';
  if (type === 'avatar') return '从相册选择头像原图';
  if (type === 'wallpaper') return '从相册选择壁纸原图';
  return '从相册选择静态原图';
}
