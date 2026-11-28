/**
 * 合集预览行：每行展示几个表情缩略图（首页 / 收藏 pack-row）
 * 兼容旧「瀑布流列数」偏好：auto/1/2/3 → 3~5
 */
import { getWindowInfoSafe } from '~/utils/systemInfo';
import { getFontScaleLabel } from '~/utils/fontScale';

const STORAGE_KEY = 'preview_row_count';
const LEGACY_KEY = 'waterfall_columns';

/** @typedef {3 | 4 | 5 | 6} PreviewRowCount */

export const PREVIEW_ROW_OPTIONS = [
  { id: 3, label: '3 个', hint: '更大更清晰' },
  { id: 4, label: '4 个', hint: '默认密度' },
  { id: 5, label: '5 个', hint: '一屏更多' },
  { id: 6, label: '6 个', hint: '最紧凑' },
];

/** 云端 / 本地最多取几张预览图 */
export const PREVIEW_ROW_MAX = 6;

function migrateLegacy(raw) {
  if (raw === 'auto' || raw === '' || raw == null) return 4;
  if (raw === 1 || raw === '1') return 3;
  if (raw === 2 || raw === '2') return 4;
  if (raw === 3 || raw === '3') return 5;
  return null;
}

function normalize(raw) {
  const n = Number(raw);
  if (n === 3 || n === 4 || n === 5 || n === 6) return /** @type {PreviewRowCount} */ (n);
  const migrated = migrateLegacy(raw);
  if (migrated) return migrated;
  return 4;
}

/**
 * @returns {PreviewRowCount}
 */
export function getPreviewRowCountPref() {
  try {
    const raw = wx.getStorageSync(STORAGE_KEY);
    if (raw !== '' && raw != null) return normalize(raw);
    const legacy = wx.getStorageSync(LEGACY_KEY);
    if (legacy !== '' && legacy != null) {
      const n = normalize(legacy);
      try {
        wx.setStorageSync(STORAGE_KEY, n);
      } catch (e) {
        /* ignore */
      }
      return n;
    }
  } catch (e) {
    /* ignore */
  }
  return 4;
}

/**
 * @returns {PreviewRowCount}
 */
export function resolvePreviewRowCount() {
  return getPreviewRowCountPref();
}

export function getPreviewRowCountOptions() {
  return PREVIEW_ROW_OPTIONS.slice();
}

export function getPreviewRowCountLabel(pref = getPreviewRowCountPref()) {
  const id = normalize(pref);
  const hit = PREVIEW_ROW_OPTIONS.find((o) => o.id === id);
  return (hit && hit.label) || `${id} 个`;
}

export function getDisplaySettingsNote(pref = getPreviewRowCountPref()) {
  return `每行 ${normalize(pref)} 个 · ${getFontScaleLabel()}`;
}

/**
 * 显示设置弹层：假合集预览行
 * @param {PreviewRowCount | string | number} pref
 */
export function buildPreviewRowPreview(pref) {
  const n = normalize(pref);
  const cells = Array.from({ length: n }, (_, i) => ({
    key: `c-${n}-${i}`,
    tone: i % 3,
    more: i === n - 1,
  }));
  return {
    cells,
    count: n,
    hint:
      (PREVIEW_ROW_OPTIONS.find((o) => o.id === n) || {}).hint ||
      `每行 ${n} 个预览`,
  };
}

/**
 * @param {PreviewRowCount | string | number} pref
 */
export function setPreviewRowCountPref(pref) {
  const id = normalize(pref);
  try {
    wx.setStorageSync(STORAGE_KEY, id);
  } catch (e) {
    /* ignore */
  }
  try {
    const app = getApp();
    if (app && app.eventBus) {
      app.eventBus.emit('previewRowCountChange', { pref: id, count: id });
      // 兼容旧监听（壁纸列数已固定 2，仅用于刷新布局）
      app.eventBus.emit('waterfallColumnsChange', { pref: id, columns: 2 });
    }
  } catch (e) {
    /* ignore */
  }
  return id;
}

/** @deprecated 壁纸区固定两列；保留导出避免旧引用报错 */
export function resolveWaterfallColumns(windowWidth) {
  const w =
    windowWidth != null
      ? windowWidth
      : (() => {
          try {
            return getWindowInfoSafe().windowWidth;
          } catch (e) {
            return 375;
          }
        })();
  if (w >= 840) return 4;
  if (w >= 560) return 3;
  return 2;
}

export function getWaterfallColumnsPref() {
  return getPreviewRowCountPref();
}

export function setWaterfallColumnsPref(pref) {
  return setPreviewRowCountPref(pref);
}

export function getWaterfallColumnOptions() {
  return getPreviewRowCountOptions();
}

export function buildWaterfallPreviewColumns(pref) {
  const preview = buildPreviewRowPreview(pref);
  return {
    columns: [preview.cells],
    columnCount: preview.count,
    isAuto: false,
    previewCells: preview.cells,
    hint: preview.hint,
  };
}
