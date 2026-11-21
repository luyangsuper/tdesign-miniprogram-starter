/**
 * 拼豆工具积分单价（管理端「积分与活动」可改）。
 * 单价缓存放主包（登录/管理端要写）；门禁逻辑在 pages/tools/bead/beadGate.js。
 */

export const BEAD_EXPORT_COST = 4;
export const BEAD_ADVANCED_COST = 1;

const BEAD_COSTS_KEY = 'bead_feature_costs';

function clampBeadCost(n, fallback) {
  const v = Number(n);
  if (Number.isNaN(v)) return fallback;
  return Math.max(1, Math.min(999, Math.floor(v)));
}

function readBeadCosts() {
  let cached = null;
  try {
    cached = wx.getStorageSync(BEAD_COSTS_KEY);
  } catch (e) {
    cached = null;
  }
  return {
    export: BEAD_EXPORT_COST,
    advanced: BEAD_ADVANCED_COST,
    ...(cached && typeof cached === 'object' ? cached : {}),
  };
}

export function getBeadExportCost() {
  return clampBeadCost(readBeadCosts().export, BEAD_EXPORT_COST);
}

export function getBeadAdvancedCost() {
  return clampBeadCost(readBeadCosts().advanced, BEAD_ADVANCED_COST);
}

/** 登录 / 权益 / 管理端保存后写入云端拼豆单价 */
export function applyBeadCostsFromSettings(settings = {}) {
  if (!settings || typeof settings !== 'object') {
    return { export: getBeadExportCost(), advanced: getBeadAdvancedCost() };
  }
  const next = {
    export: clampBeadCost(
      settings.costBeadExport != null
        ? settings.costBeadExport
        : settings.beadExport,
      getBeadExportCost(),
    ),
    advanced: clampBeadCost(
      settings.costBeadAdvanced != null
        ? settings.costBeadAdvanced
        : settings.beadAdvanced,
      getBeadAdvancedCost(),
    ),
  };
  try {
    wx.setStorageSync(BEAD_COSTS_KEY, next);
  } catch (e) {
    /* ignore */
  }
  try {
    const app = getApp();
    if (app && app.globalData) app.globalData.beadFeatureCosts = next;
  } catch (e) {
    /* ignore */
  }
  return next;
}
