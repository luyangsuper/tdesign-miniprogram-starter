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

/** 详情推荐横滑（横版）；未配置时回退详情横版位，不回退首页竖版卡 */
export function getNativePackRecommendAdUnitId() {
  return (
    String(config.nativePackRecommendAdUnitId || '').trim() ||
    getNativePackDetailAdUnitId() ||
    ''
  );
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

/** 拼图页难度下方；未单独配置时回退「我的」坑位 */
export function getNativePuzzleAdUnitId() {
  return (
    String(config.nativePuzzleAdUnitId || '').trim() ||
    getNativeMyPageAdUnitId()
  );
}

/** 趣味工坊 / 拼豆 / 图片工具常显；未单独配置时回退合集详情横版位 */
export function getNativeWorkshopAdUnitId() {
  return (
    String(config.nativeWorkshopAdUnitId || '').trim() ||
    getNativePackDetailAdUnitId() ||
    getNativeMyPageAdUnitId()
  );
}

/** 素材库入口；未单独配置时回退「我的」坑位 */
export function getNativeLibraryAdUnitId() {
  return (
    String(config.nativeLibraryAdUnitId || '').trim() ||
    getNativeMyPageAdUnitId() ||
    getNativeWorkshopAdUnitId()
  );
}

/**
 * 素材源列表混排广告位（占两格宽的横版广告）
 * 空则回退入口位；建议用横版原生模板（无正方形模板时两格合并）
 */
export function getNativeLibraryGridAdUnitId() {
  return (
    String(config.nativeLibraryGridAdUnitId || '').trim() ||
    getNativeLibraryAdUnitId()
  );
}

const LIBRARY_GRID_EVERY_KEY = 'library_grid_ad_every';

export function clampLibraryGridAdEvery(raw, fallback = 12) {
  const n = Number(raw);
  if (!Number.isFinite(n) || Number.isNaN(n)) {
    return Math.max(0, Math.min(40, Math.floor(Number(fallback) || 12)));
  }
  if (n === 0) return 0;
  return Math.max(4, Math.min(40, Math.floor(n)));
}

export function defaultLibraryGridAdEvery() {
  return clampLibraryGridAdEvery(config.libraryGridAdEvery, 12);
}

export function getLibraryGridAdEvery() {
  try {
    const cached = wx.getStorageSync(LIBRARY_GRID_EVERY_KEY);
    if (cached !== '' && cached != null && !Number.isNaN(Number(cached))) {
      return clampLibraryGridAdEvery(cached, defaultLibraryGridAdEvery());
    }
  } catch (e) {
    /* ignore */
  }
  return defaultLibraryGridAdEvery();
}

export function setLibraryGridAdEvery(n) {
  const v = clampLibraryGridAdEvery(n, defaultLibraryGridAdEvery());
  try {
    wx.setStorageSync(LIBRARY_GRID_EVERY_KEY, v);
  } catch (e) {
    /* ignore */
  }
  try {
    const app = getApp();
    if (app && app.globalData) app.globalData.libraryGridAdEvery = v;
    if (app && app.eventBus) {
      app.eventBus.emit('libraryGridAdEveryChange', { every: v });
    }
  } catch (e) {
    /* ignore */
  }
  return v;
}

export function applyLibraryGridAdEveryFromSettings(settings) {
  if (!settings || settings.libraryGridAdEvery == null) {
    return getLibraryGridAdEvery();
  }
  return setLibraryGridAdEvery(settings.libraryGridAdEvery);
}

export function shouldShowLibraryGridAds() {
  if (!getNativeLibraryGridAdUnitId()) return false;
  if (getLibraryGridAdEvery() <= 0) return false;
  return shouldShowNativeAds();
}

/**
 * 四列素材网格：每隔 every 条插入一条占两格的广告
 * @param {Array} items
 * @param {number} every
 * @param {boolean} showAds
 */
export function injectLibraryGridAds(items, every, showAds) {
  const list = Array.isArray(items) ? items : [];
  const n = Math.max(0, Number(every) || 0);
  if (!showAds || n <= 0 || !list.length) {
    return list.map((item) => ({
      ...item,
      isAd: false,
      hidden: false,
    }));
  }
  const out = [];
  let adSeq = 0;
  list.forEach((item, i) => {
    out.push({
      ...item,
      isAd: false,
      hidden: false,
    });
    if ((i + 1) % n === 0 && i + 1 < list.length) {
      out.push({
        _id: `lib-grid-ad-${adSeq}`,
        key: `lib-grid-ad-${adSeq}`,
        isAd: true,
        hidden: false,
        name: '',
      });
      adSeq += 1;
    }
  });
  return out;
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
