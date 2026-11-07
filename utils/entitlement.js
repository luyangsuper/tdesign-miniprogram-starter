import { formatDate } from '~/utils/time';
import { downloadCost, resolveDownloadCostKey } from '~/utils/pricing';

function affordHint(totalPoints) {
  const n = Math.max(0, Number(totalPoints) || 0);
  const staticCost = downloadCost('static');
  const animCost = downloadCost('anim');
  const wallpaperCost = downloadCost('wallpaper');
  const videoCost = downloadCost('video');
  const staticN = staticCost > 0 ? Math.floor(n / staticCost) : 0;
  const animN = animCost > 0 ? Math.floor(n / animCost) : 0;
  const wallN = wallpaperCost > 0 ? Math.floor(n / wallpaperCost) : 0;
  const videoN = videoCost > 0 ? Math.floor(n / videoCost) : 0;
  return `约 ${staticN} 静 / ${animN} 动 / ${wallN} 壁纸 / ${videoN} 视频`;
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
    // 优先用毫秒本地格式化；云函数默认 UTC，其 vipExpireText 可能偏 8 小时
    vipExpireText: formatVipText(vipExpireAt) || (entitlement && entitlement.vipExpireText) || '',
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
 * @param {string} [costKeyOrVariant] static|anim|wallpaper|avatar|video
 */
export function canAttemptDownload(entitlement, costKeyOrVariant = 'static') {
  const e = entitlement || getCachedEntitlement();
  return spendablePoints(e) >= downloadCost(costKeyOrVariant);
}

/**
 * 批量下载预估：单张消耗、余额够几张、是否够全部。
 * @param {object} [entitlement]
 * @param {string} [costKeyOrVariant]
 * @param {number} count
 */
export function estimateBatchAffordable(entitlement, costKeyOrVariant = 'static', count = 0) {
  const e = entitlement || getCachedEntitlement();
  const cost = downloadCost(costKeyOrVariant);
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

/** @param {string} contentType @param {'static'|'anim'} [variant] @param {number} count */
export function estimateBatchAffordableForPack(entitlement, contentType, variant, count) {
  return estimateBatchAffordable(
    entitlement,
    resolveDownloadCostKey(contentType, variant),
    count,
  );
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

  // 到期只留日期，省高度
  const expireDate = String(e.vipExpireText || '').split(' ')[0] || '有效期内';
  const affordLine = empty ? '' : affordHint(total);
  /* VIP：包月状态；非 VIP：约能下几张。固定两行，去掉单价脚注与额度条 */
  let subLine = affordLine;
  if (isVip) {
    const parts = [`包月至 ${expireDate}`, '免广告', '全节日'];
    if (points > 0) parts.push(`已购 ${points}`);
    else if (monthTotal > 0) parts.push(`本月 ${monthLeft}/${monthTotal}`);
    subLine = parts.join(' · ');
  }

  return {
    empty,
    emptyText: '暂无下载权益，可兑换包月或购买积分',
    isVip,
    /** VIP 应用内免广告（信息流/详情/我的等原生广告；不含启动封面广告） */
    adFreeActive: isVip,
    adFreeLabel: isVip ? '生效中' : '',
    /** VIP 全节日氛围（普通用户仅春节/圣诞） */
    festivalAllActive: isVip,
    festivalAllLabel: isVip ? '生效中' : '',
    total,
    totalValueText: String(total),
    affordLine,
    subLine,
    showMonth: false,
    monthLeft,
    monthTotal,
    monthPercent,
    monthBarColor,
    monthLeftText: String(monthLeft),
    monthTotalText: String(monthTotal),
    points,
    showBoughtPoints: false,
    pointsText: String(points),
    footLine: '',
  };
}

/**
 * 单行摘要（合集详情等窄位）
 */
export function formatEntitlementHint(entitlement) {
  const card = formatBenefitCard(entitlement);
  if (card.empty) return card.emptyText;
  const parts = [`可用 ${card.total} 积分`];
  if (card.adFreeActive) parts.push('应用内免广告');
  if (card.festivalAllActive) parts.push('全节日氛围');
  if (card.affordLine) parts.push(card.affordLine);
  return parts.join(' · ');
}
