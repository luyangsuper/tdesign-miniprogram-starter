import config from '~/config';

/**
 * @param {'reward'|'save'|'checkin'|'puzzleHintLight'|'puzzleHintStrong'} [slot]
 * - reward/save/checkin/puzzleHintStrong → 全站 30s 激励位
 * - puzzleHintLight → 拼图轻提示专用位
 */
export function getRewardedAdUnitId(slot = 'reward') {
  const key = String(slot || 'reward').trim();
  if (key === 'puzzleHintLight') {
    return String(config.puzzleHintLightAdUnitId || '').trim() || '';
  }
  return String(config.rewardedAdUnitId || '').trim() || '';
}

/** 是否已配置对应激励广告位 */
export function isRewardedAdReady(slot = 'reward') {
  return !!getRewardedAdUnitId(slot);
}

/** 页面级：按广告位 ID 缓存实例 */
const pageAdMap = new WeakMap();

function getPageAd(page, unitId) {
  if (!page || !unitId || !wx.createRewardedVideoAd) return null;

  let byUnit = pageAdMap.get(page);
  if (!byUnit) {
    byUnit = new Map();
    pageAdMap.set(page, byUnit);
  }
  if (byUnit.has(unitId)) return byUnit.get(unitId);

  const ad = wx.createRewardedVideoAd({ adUnitId: unitId });
  byUnit.set(unitId, ad);
  return ad;
}

/**
 * 播放激励视频广告。
 * @param {{ page?: any, slot?: 'reward'|'save'|'checkin'|'puzzleHintLight'|'puzzleHintStrong', unitId?: string }} [opts]
 * @returns {Promise<boolean>} 是否完整观看
 */
export function showRewardedAd(opts = {}) {
  const raw = String(opts.slot || '').trim();
  const slot =
    raw === 'save' ||
    raw === 'checkin' ||
    raw === 'puzzleHintLight' ||
    raw === 'puzzleHintStrong'
      ? raw
      : 'reward';
  const unitId = String(
    opts.unitId ||
      getRewardedAdUnitId(slot === 'puzzleHintStrong' ? 'reward' : slot),
  ).trim();
  if (!unitId) {
    wx.showToast({ title: '暂未配置广告，请先兑换', icon: 'none' });
    return Promise.resolve(false);
  }
  if (!wx.createRewardedVideoAd) {
    wx.showToast({ title: '当前基础库不支持激励广告', icon: 'none' });
    return Promise.resolve(false);
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      resolve(!!ok);
    };

    const page =
      opts.page ||
      (typeof getCurrentPages === 'function'
        ? getCurrentPages().slice(-1)[0]
        : null);
    const ad =
      getPageAd(page, unitId) || wx.createRewardedVideoAd({ adUnitId: unitId });

    const onClose = (res) => {
      ad.offClose(onClose);
      ad.offError(onError);
      finish(!!(res && res.isEnded));
    };

    const onError = (err) => {
      console.error('[ad]', slot, err);
      ad.offClose(onClose);
      ad.offError(onError);
      wx.showToast({ title: '广告加载失败，请稍后重试', icon: 'none' });
      finish(false);
    };

    ad.onClose(onClose);
    ad.onError(onError);

    ad
      .show()
      .catch(() =>
        ad
          .load()
          .then(() => ad.show())
          .catch(onError),
      );
  });
}

/** @deprecated 使用 isRewardedAdReady */
export function isDownloadReady() {
  return isRewardedAdReady('save');
}

/** 插屏广告位 */
export function getInterstitialAdUnitId(slot = 'puzzleStart') {
  const key = String(slot || 'puzzleStart').trim();
  if (key === 'puzzleStart') {
    return String(config.puzzleInterstitialAdUnitId || '').trim() || '';
  }
  return String(config.puzzleInterstitialAdUnitId || '').trim() || '';
}

export function isInterstitialAdReady(slot = 'puzzleStart') {
  return !!getInterstitialAdUnitId(slot);
}

/** 页面级插屏实例缓存 */
const pageInterstitialMap = new WeakMap();

function getPageInterstitialAd(page, unitId) {
  if (!page || !unitId || !wx.createInterstitialAd) return null;
  let byUnit = pageInterstitialMap.get(page);
  if (!byUnit) {
    byUnit = new Map();
    pageInterstitialMap.set(page, byUnit);
  }
  if (byUnit.has(unitId)) return byUnit.get(unitId);
  const ad = wx.createInterstitialAd({ adUnitId: unitId });
  byUnit.set(unitId, ad);
  return ad;
}

/**
 * 展示插屏广告。失败/关闭都不阻断业务（resolve 恒为是否成功弹出）。
 * @param {{ page?: any, slot?: 'puzzleStart', unitId?: string }} [opts]
 * @returns {Promise<boolean>}
 */
export function showInterstitialAd(opts = {}) {
  const slot = String(opts.slot || 'puzzleStart').trim() || 'puzzleStart';
  const unitId = String(opts.unitId || getInterstitialAdUnitId(slot)).trim();
  if (!unitId || !wx.createInterstitialAd) {
    return Promise.resolve(false);
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      resolve(!!ok);
    };

    const page =
      opts.page ||
      (typeof getCurrentPages === 'function'
        ? getCurrentPages().slice(-1)[0]
        : null);
    const ad =
      getPageInterstitialAd(page, unitId) ||
      wx.createInterstitialAd({ adUnitId: unitId });

    const onClose = () => {
      ad.offClose(onClose);
      ad.offError(onError);
      finish(true);
    };
    const onError = (err) => {
      console.warn('[interstitial]', slot, err);
      ad.offClose(onClose);
      ad.offError(onError);
      finish(false);
    };

    ad.onClose(onClose);
    ad.onError(onError);

    ad
      .show()
      .catch(() =>
        ad
          .load()
          .then(() => ad.show())
          .catch(onError),
      );
  });
}
