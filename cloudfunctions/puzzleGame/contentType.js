/** 合集内容类型（表情 / 壁纸 / 头像 / 视频） */

const CONTENT_TYPES = ['emoji', 'wallpaper', 'avatar', 'video'];

const LABELS = {
  emoji: '表情',
  wallpaper: '壁纸',
  avatar: '头像',
  video: '视频',
};

const CATEGORY_OPTIONAL = {
  wallpaper: true,
  avatar: true,
  video: true,
};

/** 与客户端 config.downloadCosts / utils/pricing 保持一致 */
/** 离线默认；运行时 getEmojiDownload 以 app_config/points 为准 */
const DOWNLOAD_COSTS = {
  static: 1,
  anim: 2,
  wallpaper: 4,
  avatar: 4,
  video: 8,
};

function normalizeContentType(value) {
  const t = String(value || '').trim();
  return CONTENT_TYPES.includes(t) ? t : 'emoji';
}

function contentTypeLabel(value) {
  return LABELS[normalizeContentType(value)] || LABELS.emoji;
}

function isEmojiType(value) {
  return normalizeContentType(value) === 'emoji';
}

function isCategoryOptional(value) {
  return !!CATEGORY_OPTIONAL[normalizeContentType(value)];
}

/**
 * 扣费 key：表情用 static/anim；其它类型用 contentType 本身
 * @param {string} contentType
 * @param {string} [variant]
 */
function resolveCostKey(contentType, variant) {
  const type = normalizeContentType(contentType);
  if (type === 'emoji') {
    return variant === 'anim' ? 'anim' : 'static';
  }
  return type;
}

function downloadCostFor(contentType, variant) {
  const key = resolveCostKey(contentType, variant);
  const n = Number(DOWNLOAD_COSTS[key]);
  return n > 0 ? n : DOWNLOAD_COSTS.static;
}

function costKindLabel(contentType, variant) {
  const type = normalizeContentType(contentType);
  if (type === 'emoji') {
    return variant === 'anim' ? '动态' : '静态';
  }
  return contentTypeLabel(type);
}

module.exports = {
  CONTENT_TYPES,
  LABELS,
  DOWNLOAD_COSTS,
  normalizeContentType,
  contentTypeLabel,
  isEmojiType,
  isCategoryOptional,
  resolveCostKey,
  downloadCostFor,
  costKindLabel,
};
