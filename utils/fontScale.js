/**
 * 全局字号缩放。
 * 生效路径：
 * 1) buildFontScaleStyle 写入 --ui-fs-*，并入 getThemeStyle()
 * 2) 各页 page-meta page-style + 根节点 style="{{themeStyle}}"
 * 3) 文案优先走 variable.less 的 .ui-*() / var(--ui-fs-*)
 * 个别装饰字号（加载动画、抽奖大数字等）故意不随缩放。
 */
const STORAGE_KEY = 'app_font_scale';

/** 基准字号（rpx），与 variable.less 对齐 */
const BASE_FS = {
  display: 44,
  title: 32,
  strong: 28,
  body: 26,
  caption: 22,
};

export const FONT_SCALE_OPTIONS = [
  { id: 'small', label: '较小', hint: '更紧凑', scale: 0.9 },
  { id: 'standard', label: '标准', hint: '默认大小', scale: 1 },
  { id: 'large', label: '较大', hint: '更容易读', scale: 1.12 },
  { id: 'xlarge', label: '更大', hint: '更清晰', scale: 1.24 },
];

function normalizeId(raw) {
  const id = String(raw || '').trim();
  if (FONT_SCALE_OPTIONS.some((o) => o.id === id)) return id;
  return 'standard';
}

export function getFontScaleOptions() {
  return FONT_SCALE_OPTIONS.slice();
}

export function getFontScaleId() {
  try {
    return normalizeId(wx.getStorageSync(STORAGE_KEY));
  } catch (e) {
    return 'standard';
  }
}

export function getFontScaleOption(id = getFontScaleId()) {
  const nid = normalizeId(id);
  return FONT_SCALE_OPTIONS.find((o) => o.id === nid) || FONT_SCALE_OPTIONS[1];
}

export function getFontScaleLabel(id = getFontScaleId()) {
  return getFontScaleOption(id).label;
}

/**
 * 覆盖 page / .page 上的 --ui-fs-*，与主题 style 一并挂到根节点
 * @param {string} [id]
 */
export function buildFontScaleStyle(id = getFontScaleId()) {
  const { scale } = getFontScaleOption(id);
  const round = (n) => Math.max(16, Math.round(n * scale));
  return [
    `--ui-fs-display:${round(BASE_FS.display)}rpx`,
    `--ui-fs-title:${round(BASE_FS.title)}rpx`,
    `--ui-fs-strong:${round(BASE_FS.strong)}rpx`,
    `--ui-fs-body:${round(BASE_FS.body)}rpx`,
    `--ui-fs-caption:${round(BASE_FS.caption)}rpx`,
  ].join(';');
}

/**
 * @param {string} id
 */
export function setFontScaleId(id) {
  const next = normalizeId(id);
  try {
    wx.setStorageSync(STORAGE_KEY, next);
  } catch (e) {
    /* ignore */
  }
  try {
    const app = getApp();
    if (app && app.globalData) {
      // 清空缓存 style，下次 getThemeStyle 会带上新字号
      app.globalData.themeStyle = '';
    }
    if (app && app.eventBus) {
      app.eventBus.emit('fontScaleChange', next);
      // 多数页面听 themeChange 刷新 themeStyle（已含字号变量）
      app.eventBus.emit('themeChange');
    }
  } catch (e) {
    /* ignore */
  }
  return next;
}
