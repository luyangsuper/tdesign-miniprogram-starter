/**
 * 图片工具箱导出解锁单价（管理端「积分与活动」可改）。
 * 单价缓存放主包；门禁逻辑在 pages/tools/image/imageGate.js。
 */

export const IMAGE_EXPORT_COST = 2;

const IMAGE_COSTS_KEY = 'image_tool_feature_costs';

function clampCost(n, fallback) {
  const v = Number(n);
  if (Number.isNaN(v)) return fallback;
  return Math.max(1, Math.min(999, Math.floor(v)));
}

function readCosts() {
  let cached = null;
  try {
    cached = wx.getStorageSync(IMAGE_COSTS_KEY);
  } catch (e) {
    cached = null;
  }
  return {
    export: IMAGE_EXPORT_COST,
    ...(cached && typeof cached === 'object' ? cached : {}),
  };
}

export function getImageExportCost() {
  return clampCost(readCosts().export, IMAGE_EXPORT_COST);
}

/** 登录 / 权益 / 管理端保存后写入云端单价 */
export function applyImageToolCostsFromSettings(settings = {}) {
  if (!settings || typeof settings !== 'object') {
    return { export: getImageExportCost() };
  }
  const next = {
    export: clampCost(
      settings.costImageExport != null
        ? settings.costImageExport
        : settings.imageExport,
      getImageExportCost(),
    ),
  };
  try {
    wx.setStorageSync(IMAGE_COSTS_KEY, next);
  } catch (e) {
    /* ignore */
  }
  try {
    const app = getApp();
    if (app && app.globalData) app.globalData.imageToolFeatureCosts = next;
  } catch (e) {
    /* ignore */
  }
  return next;
}
