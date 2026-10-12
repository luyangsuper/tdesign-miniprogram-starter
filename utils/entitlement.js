import { formatDate } from '~/utils/time';
import { downloadCost } from '~/utils/pricing';

function affordHint(totalPoints) {
  const n = Math.max(0, Number(totalPoints) || 0);
  const staticCost = downloadCost('static');
  const animCost = downloadCost('anim');
  const staticN = staticCost > 0 ? Math.floor(n / staticCost) : 0;
  const animN = animCost > 0 ? Math.floor(n / animCost) : 0;
  return `约 ${staticN} 张静态 / ${animN} 张动态`;
}

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

/**
 * 「我的」权益卡片：合计可用 + 分项 + 大约能下几张（按积分，不是按次）
 */
export function formatBenefitCard(entitlement) {
  const e = entitlement || getCachedEntitlement();
  const points = Math.max(0, Number(e.points) || 0);
  const monthLeft = Math.max(0, Number(e.vipMonthQuota) || 0);
  const monthTotal = Math.max(1, Number(e.monthlyQuota) || 36);
  const total = monthLeft + points;
  const isVip = !!e.isVip;
  const empty = !isVip && total <= 0;
  const monthPercent = isVip
    ? Math.min(100, Math.max(0, Math.round((monthLeft / monthTotal) * 100)))
    : 0;
  let monthBarColor = '#07c160';
  if (isVip) {
    if (monthLeft <= 0) monthBarColor = '#d54941';
    else if (monthPercent <= 25) monthBarColor = '#e37318';
  }

  const staticCost = downloadCost('static');
  const animCost = downloadCost('anim');

  // 到期只留日期，省高度
  const expireDate = String(e.vipExpireText || '').split(' ')[0] || '有效期内';

  return {
    empty,
    emptyText: '暂无下载权益，可兑换包月或购买积分',
    isVip,
    total,
    totalValueText: String(total),
    affordLine: empty ? '' : affordHint(total),
    showMonth: isVip,
    monthLeft,
    monthTotal,
    monthPercent,
    monthBarColor,
    monthLeftText: String(monthLeft),
    monthTotalText: String(monthTotal),
    points,
    showBoughtPoints: points > 0,
    pointsText: String(points),
    footLine: isVip
      ? `包月至 ${expireDate} · 静${staticCost}/动${animCost} · 先扣本月额度`
      : `静${staticCost}/动${animCost} 积分/张 · 已购积分可累计`,
  };
}

/**
 * 单行摘要（合集详情等窄位）
 */
export function formatEntitlementHint(entitlement) {
  const card = formatBenefitCard(entitlement);
  if (card.empty) return card.emptyText;
  const parts = [`可用 ${card.total} 积分`];
  if (card.affordLine) parts.push(card.affordLine);
  return parts.join(' · ');
}
