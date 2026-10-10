import { formatDate } from '~/utils/time';
import { downloadCost } from '~/utils/pricing';

const ENTITLEMENT_KEY = 'user_entitlement';

export function getCachedEntitlement() {
  return (
    wx.getStorageSync(ENTITLEMENT_KEY) || {
      isVip: false,
      vipExpireAt: null,
      vipExpireText: '',
      vipMonthQuota: 0,
      monthlyQuota: 36,
      points: 0,
      canDownload: false,
    }
  );
}

function formatVipText(ms) {
  return formatDate(ms, 'YYYY-MM-DD HH:mm');
}

export function spendablePoints(entitlement) {
  const e = entitlement || getCachedEntitlement();
  return Math.max(0, Number(e.vipMonthQuota) || 0) + Math.max(0, Number(e.points) || 0);
}

export function setCachedEntitlement(entitlement) {
  const vipExpireAt = (entitlement && entitlement.vipExpireAt) || null;
  const points = Math.max(0, Number((entitlement && entitlement.points) || 0));
  const vipMonthQuota = Math.max(0, Number((entitlement && entitlement.vipMonthQuota) || 0));
  const next = {
    isVip: !!(entitlement && entitlement.isVip),
    vipExpireAt,
    vipExpireText: (entitlement && entitlement.vipExpireText) || formatVipText(vipExpireAt),
    vipMonthQuota,
    monthlyQuota: Math.max(0, Number((entitlement && entitlement.monthlyQuota) || 36)),
    points,
    canDownload: false,
  };
  next.canDownload = vipMonthQuota + points > 0;
  wx.setStorageSync(ENTITLEMENT_KEY, next);
  try {
    const app = getApp();
    if (app) app.globalData.entitlement = next;
  } catch (e) {
    /* ignore */
  }
  return next;
}

/**
 * 本月额度 + 购买积分足够当前类型 → 可下载。
 * @param {object} [entitlement]
 * @param {'static'|'anim'} [variant]
 */
export function canAttemptDownload(entitlement, variant = 'static') {
  const e = entitlement || getCachedEntitlement();
  return spendablePoints(e) >= downloadCost(variant);
}

/**
 * 批量下载预估：单张消耗、余额够几张、是否够全部。
 * @param {object} [entitlement]
 * @param {'static'|'anim'} [variant]
 * @param {number} count
 */
export function estimateBatchAffordable(entitlement, variant = 'static', count = 0) {
  const e = entitlement || getCachedEntitlement();
  const cost = downloadCost(variant);
  const spendable = spendablePoints(e);
  const n = Math.max(0, Number(count) || 0);
  const maxCount = cost > 0 ? Math.floor(spendable / cost) : 0;
  return {
    cost,
    spendable,
    count: n,
    totalCost: cost * n,
    maxCount,
    canAll: n > 0 && maxCount >= n,
    canAny: maxCount > 0,
  };
}

export function formatEntitlementHint(entitlement) {
  const e = entitlement || getCachedEntitlement();
  const parts = [];
  if (e.isVip) {
    parts.push(`包月至 ${e.vipExpireText || '有效期内'}`);
    parts.push(`本月剩余 ${e.vipMonthQuota || 0}`);
  }
  if (e.points > 0) parts.push(`积分 ${e.points}`);
  if (parts.length) return `${parts.join(' · ')}（静态 1 积分 / 动态 2 积分）`;
  return '暂无下载权益，可兑换包月会员或积分';
}
