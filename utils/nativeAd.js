import config from '~/config';
import { resolveIsAdmin } from '~/utils/auth';
import { getCachedEntitlement } from '~/utils/entitlement';

const FEED_EVERY_KEY = 'home_feed_ad_every';

export function clampHomeFeedAdEvery(n, fallback = 6) {
  const v = Number(n);
  if (Number.isNaN(v)) return Math.max(0, Math.min(20, Math.floor(Number(fallback) || 6)));
  return Math.max(0, Math.min(20, Math.floor(v)));
}

export function defaultHomeFeedAdEvery() {
  return clampHomeFeedAdEvery(config.homeFeedAdEvery, 6);
}

export function getHomeFeedAdEvery() {
  try {
    const cached = wx.getStorageSync(FEED_EVERY_KEY);
    if (cached !== '' && cached != null && !Number.isNaN(Number(cached))) {
      return clampHomeFeedAdEvery(cached, defaultHomeFeedAdEvery());
    }
  } catch (e) {
    /* ignore */
  }
  return defaultHomeFeedAdEvery();
}

/**
 * 按瀑布流列数换算实际插广告间隔。
 * 管理端 homeFeedAdEvery 按「约 2 列」配置；1 列加密、3/4 列放疏，
 * 让大约隔相近行数出现一条，避免单列刷很久才见广告。
 * @param {number} columnCount
 */
export function resolveHomeFeedAdEvery(columnCount) {
  const base = getHomeFeedAdEvery();
  if (base <= 0) return 0;
  const cols = Math.max(1, Math.min(4, Math.floor(Number(columnCount) || 2)));
  const scaled = Math.round((base * cols) / 2);
  return clampHomeFeedAdEvery(Math.max(2, scaled), base);
}

export function setHomeFeedAdEvery(n) {
  const v = clampHomeFeedAdEvery(n, defaultHomeFeedAdEvery());
  try {
    wx.setStorageSync(FEED_EVERY_KEY, v);
  } catch (e) {
    /* ignore */
  }
  try {
    const app = getApp();
    if (app && app.globalData) app.globalData.homeFeedAdEvery = v;
  } catch (e) {
    /* ignore */
  }
  return v;
}

/** 从云端积分配置写入本地间隔（userEntitlement.get / 管理端保存后） */
export function applyHomeFeedAdEveryFromSettings(settings) {
  if (!settings || settings.homeFeedAdEvery == null) return getHomeFeedAdEvery();
  return setHomeFeedAdEvery(settings.homeFeedAdEvery);
}

export function getNativeHomeFeedAdUnitId() {
  return (
    String(config.nativeHomeFeedAdUnitId || config.nativeAdUnitId || '').trim() ||
    ''
  );
}

export function getNativePackDetailAdUnitId() {
  return String(config.nativePackDetailAdUnitId || '').trim() || '';
}

export function getNativeMyPageAdUnitId() {
  return String(config.nativeMyPageAdUnitId || '').trim() || '';
}

/** 收藏页；未单独配置时回退首页信息流位 */
export function getNativeFavoritesAdUnitId() {
  return (
    String(config.nativeFavoritesAdUnitId || '').trim() ||
    getNativeHomeFeedAdUnitId()
  );
}

/**
 * 被动原生广告展示门控：
 * - VIP 应用内免广告（原生信息流/详情/我的等；不含启动封面广告）
 * - 管理员视图（非「预览普通用户」）不展示，避免审稿/排版被广告打断
 */
export function shouldShowNativeAds() {
  try {
    if (resolveIsAdmin()) return false;
    if (getCachedEntitlement().isVip) return false;
    return true;
  } catch (e) {
    return true;
  }
}

export function shouldShowHomeFeedAds() {
  if (!getNativeHomeFeedAdUnitId()) return false;
  if (getHomeFeedAdEvery() <= 0) return false;
  return shouldShowNativeAds();
}
