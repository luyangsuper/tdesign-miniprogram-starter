import { getWindowInfoSafe } from '~/utils/systemInfo';
import { getFontScaleLabel } from '~/utils/fontScale';

const STORAGE_KEY = 'waterfall_columns';

/** @typedef {'auto' | 1 | 2 | 3} WaterfallColumnsPref */

export const WATERFALL_COLUMN_OPTIONS = [
  {
    id: 'auto',
    label: '跟随设备',
    hint: '按屏幕宽度自动',
  },
  {
    id: 1,
    label: '宽松',
    hint: '1 列 · 更大更清晰',
  },
  {
    id: 2,
    label: '标准',
    hint: '2 列 · 浏览更均衡',
  },
  {
    id: 3,
    label: '紧凑',
    hint: '3 列 · 一屏更多',
  },
];

/** 预览假合集：封面比例 + 标题宽度感 */
const PREVIEW_PACKS = [
  { key: 'a', ratio: 1.12, titleW: 72, metaW: 44, tone: 0 },
  { key: 'b', ratio: 0.86, titleW: 58, metaW: 36, tone: 1 },
  { key: 'c', ratio: 1.05, titleW: 80, metaW: 40, tone: 2 },
  { key: 'd', ratio: 0.94, titleW: 64, metaW: 48, tone: 0 },
  { key: 'e', ratio: 1.2, titleW: 70, metaW: 38, tone: 1 },
  { key: 'f', ratio: 0.9, titleW: 76, metaW: 42, tone: 2 },
];

function normalizePref(raw) {
  if (raw === 'auto') return 'auto';
  if (raw === 1 || raw === '1') return 1;
  if (raw === 2 || raw === '2') return 2;
  if (raw === 3 || raw === '3') return 3;
  return 'auto';
}

/** 按屏宽解析自适应列数（与旧版首页逻辑一致） */
export function resolveAutoWaterfallColumns(windowWidth) {
  const w = Number(windowWidth) || 375;
  if (w >= 840) return 4;
  if (w >= 560) return 3;
  return 2;
}

/**
 * 用户偏好：auto | 1 | 2 | 3（默认 auto）
 * @returns {WaterfallColumnsPref}
 */
export function getWaterfallColumnsPref() {
  try {
    const raw = wx.getStorageSync(STORAGE_KEY);
    if (raw === '' || raw == null) return 'auto';
    return normalizePref(raw);
  } catch (e) {
    return 'auto';
  }
}

/**
 * 实际用于布局的列数
 * @param {number} [windowWidth]
 */
export function resolveWaterfallColumns(windowWidth) {
  const pref = getWaterfallColumnsPref();
  if (pref === 'auto') {
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
    return resolveAutoWaterfallColumns(w);
  }
  return pref;
}

/** @deprecated 兼容旧调用，等同 resolveWaterfallColumns */
export function getWaterfallColumns(windowWidth) {
  return resolveWaterfallColumns(windowWidth);
}

export function getWaterfallColumnsLabel(pref = getWaterfallColumnsPref()) {
  const id = normalizePref(pref);
  const hit = WATERFALL_COLUMN_OPTIONS.find((o) => o.id === id);
  if (id === 'auto') {
    const n = resolveWaterfallColumns();
    return `跟随设备（现 ${n} 列）`;
  }
  return (hit && hit.label) || String(id);
}

export function getDisplaySettingsNote(pref = getWaterfallColumnsPref()) {
  let density;
  const id = normalizePref(pref);
  if (id === 'auto') {
    density = `跟随 · ${resolveWaterfallColumns()} 列`;
  } else {
    const hit = WATERFALL_COLUMN_OPTIONS.find((o) => o.id === id);
    density = (hit && `${hit.label}`) || `${id} 列`;
  }
  return `${density} · ${getFontScaleLabel()}`;
}

/**
 * 生成手机框内瀑布流预览列
 * @param {WaterfallColumnsPref} pref
 * @param {{ windowWidth?: number, baseWidth?: number }} [opts]
 */
export function buildWaterfallPreviewColumns(pref, opts = {}) {
  const id = normalizePref(pref);
  const n =
    id === 'auto'
      ? resolveAutoWaterfallColumns(opts.windowWidth || getWindowInfoSafe().windowWidth)
      : id;
  /* 固定卡片数量与比例高度（padding-bottom%），外层定高裁切，切换列数不撑高弹层 */
  const cardCount = Math.min(PREVIEW_PACKS.length, Math.max(n * 2, 4));
  const cols = Array.from({ length: n }, () => []);
  for (let i = 0; i < cardCount; i += 1) {
    const pack = PREVIEW_PACKS[i % PREVIEW_PACKS.length];
    cols[i % n].push({
      key: `${n}-${pack.key}-${i}`,
      coverPct: Math.round(pack.ratio * 100),
      titleW: pack.titleW,
      metaW: pack.metaW,
      tone: pack.tone,
    });
  }
  return {
    columns: cols,
    columnCount: n,
    isAuto: id === 'auto',
  };
}

export function getWaterfallColumnOptions() {
  return WATERFALL_COLUMN_OPTIONS.slice();
}

/**
 * @param {WaterfallColumnsPref | string | number} pref
 */
export function setWaterfallColumnsPref(pref) {
  const id = normalizePref(pref);
  try {
    wx.setStorageSync(STORAGE_KEY, id);
  } catch (e) {
    /* ignore */
  }
  const resolved = resolveWaterfallColumns();
  try {
    const app = getApp();
    if (app && app.eventBus) {
      app.eventBus.emit('waterfallColumnsChange', { pref: id, columns: resolved });
    }
  } catch (e) {
    /* ignore */
  }
  return id;
}

/** @deprecated 使用 setWaterfallColumnsPref */
export function setWaterfallColumns(pref) {
  return setWaterfallColumnsPref(pref);
}
