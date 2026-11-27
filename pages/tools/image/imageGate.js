/**
 * 图片工具箱门禁：看 1 条激励广告或花积分解锁「当前这次处理结果」的保存。
 * 重新处理 / 换图后解锁失效。
 */
import { showRewardedAd, isRewardedAdReady } from '~/utils/ad';
import { callFunction } from '~/utils/cloud';
import { resolveIsAdmin } from '~/utils/auth';
import {
  getCachedEntitlement,
  setCachedEntitlement,
  spendablePoints,
} from '~/utils/entitlement';
import {
  IMAGE_EXPORT_COST,
  getImageExportCost,
} from '~/utils/imageToolCosts';

export { IMAGE_EXPORT_COST, getImageExportCost };

/** 导出用广告条数 */
export const IMAGE_EXPORT_AD_COUNT = 1;

function emitEntitlementChange() {
  try {
    const app = getApp();
    if (app && app.eventBus) app.eventBus.emit('entitlementChange');
  } catch (e) {
    /* ignore */
  }
}

function showModalAsync({ title, content, confirmText, cancelText }) {
  return new Promise((resolve) => {
    wx.showModal({
      title: title || '提示',
      content: content || '',
      confirmText: confirmText || '确定',
      cancelText: cancelText || '取消',
      success: (r) => resolve(!!r.confirm),
      fail: () => resolve(false),
    });
  });
}

function showActionSheetAsync(itemList) {
  return new Promise((resolve) => {
    wx.showActionSheet({
      itemList,
      success: (res) => resolve(res.tapIndex),
      fail: () => resolve(-1),
    });
  });
}

function pickAdSlot() {
  if (isRewardedAdReady('save')) return 'save';
  if (isRewardedAdReady('reward')) return 'reward';
  return '';
}

async function spendImageFeature() {
  try {
    const res = await callFunction('userEntitlement', {
      action: 'spendFeature',
      feature: 'imageExport',
    });
    if (res && res.entitlement) {
      setCachedEntitlement(res.entitlement);
      emitEntitlementChange();
    }
    return res || { ok: true };
  } catch (err) {
    return {
      ok: false,
      message: (err && err.message) || '解锁失败',
      code: err && err.code,
    };
  }
}

async function watchAdsInRow(page, count) {
  const n = Math.max(1, Math.floor(Number(count) || 1));
  for (let i = 0; i < n; i++) {
    const slot = pickAdSlot();
    if (!slot) {
      wx.showToast({ title: '广告暂不可用，请稍后再试或用积分', icon: 'none' });
      return false;
    }
    if (n > 1) {
      const go = await showModalAsync({
        title: `看广告解锁（${i + 1}/${n}）`,
        content:
          i === 0
            ? `需连续看完 ${n} 条广告才能解锁保存。中途退出需重来。`
            : `已完成 ${i}/${n}，请继续观看下一条。`,
        confirmText: i === 0 ? '开始观看' : '继续',
        cancelText: '取消',
      });
      if (!go) return false;
    }
    const watched = await showRewardedAd({ page, slot });
    if (!watched) {
      wx.showToast({
        title: n > 1 ? `需连续看完 ${n} 条，已中断` : '需看完广告才能解锁',
        icon: 'none',
      });
      return false;
    }
  }
  return true;
}

async function payWithPoints(cost) {
  wx.showLoading({ title: '解锁中', mask: true });
  try {
    const res = await spendImageFeature();
    if (!res || !res.ok) {
      wx.showToast({
        title: (res && res.message) || '解锁失败',
        icon: 'none',
      });
      return { ok: false, via: 'points', message: (res && res.message) || '' };
    }
    const paid = Math.max(1, Number(res.cost) || cost);
    wx.showToast({ title: `已用 ${paid} 积分解锁`, icon: 'none' });
    return { ok: true, via: 'points' };
  } finally {
    wx.hideLoading();
  }
}

/**
 * @param {{ page?: any }} [opts]
 * @returns {Promise<{ ok: boolean, via?: 'admin'|'ad'|'points'|'cancel', message?: string }>}
 */
export async function unlockImageExport(opts = {}) {
  const cost = getImageExportCost();
  const adCount = IMAGE_EXPORT_AD_COUNT;

  if (resolveIsAdmin()) {
    return { ok: true, via: 'admin' };
  }

  const bal = spendablePoints();
  const adReady = !!pickAdSlot();
  const isVip = !!getCachedEntitlement().isVip;

  const items = [];
  const actions = [];
  if (adReady) {
    items.push(adCount > 1 ? `连续看 ${adCount} 条广告解锁` : '看广告解锁（约 30 秒）');
    actions.push('ad');
  }
  items.push(`用 ${cost} 积分解锁（剩 ${bal}）`);
  actions.push('points');

  const intro = await showModalAsync({
    title: '保存解锁',
    content:
      '解锁后，当前这次处理结果可保存到相册；换图或重新处理后需再解。' +
      (adReady
        ? `\n可看广告免费解锁，或直接花 ${cost} 积分。`
        : `\n可直接用 ${cost} 积分解锁。`) +
      (isVip ? '\n（当前为会员，积分优先扣本月额度）' : ''),
    confirmText: '继续',
    cancelText: '取消',
  });
  if (!intro) return { ok: false, via: 'cancel' };

  const idx = await showActionSheetAsync(items);
  if (idx < 0 || idx >= actions.length) return { ok: false, via: 'cancel' };
  const pick = actions[idx];

  if (pick === 'ad') {
    const ok = await watchAdsInRow(opts.page, adCount);
    if (!ok) return { ok: false, via: 'ad' };
    wx.showToast({ title: '已解锁', icon: 'success' });
    return { ok: true, via: 'ad' };
  }

  const balNow = spendablePoints();
  if (balNow < cost) {
    const go = await showModalAsync({
      title: '积分不足',
      content:
        `需要 ${cost} 积分，当前 ${balNow}。` +
        (adReady ? '可改选看广告解锁。' : '可到「我的」领积分或购买。'),
      confirmText: adReady ? '改看广告' : '去我的',
      cancelText: '取消',
    });
    if (!go) return { ok: false, via: 'cancel', message: 'cancel' };
    if (adReady) {
      const ok = await watchAdsInRow(opts.page, adCount);
      if (!ok) return { ok: false, via: 'ad' };
      wx.showToast({ title: '已解锁', icon: 'success' });
      return { ok: true, via: 'ad' };
    }
    return { ok: false, via: 'cancel', message: 'go_my' };
  }

  return payWithPoints(cost);
}
