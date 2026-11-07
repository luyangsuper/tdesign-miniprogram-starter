import config from '~/config';
import { callFunction } from '~/utils/cloud';
import {
  getCachedEntitlement,
  setCachedEntitlement,
  spendablePoints,
} from '~/utils/entitlement';
import { isRewardedAdReady, showRewardedAd } from '~/utils/ad';
import { showPointsReward } from '~/utils/pointsReward';

export function defaultAdRewardPoints() {
  return Math.max(0, Number(config.adRewardPoints) || 2);
}

export function defaultAdRewardDailyMax() {
  return Math.max(0, Number(config.adRewardDailyMax) || 5);
}

export function defaultSaveAdRewardPoints() {
  return Math.max(0, Number(config.saveAdRewardPoints) || 1);
}

export function defaultSaveAdRewardDailyMax() {
  return Math.max(0, Number(config.saveAdRewardDailyMax) || 8);
}

function normalizeSlot(slot) {
  const s = String(slot || '').trim();
  if (s === 'save') return 'save';
  if (s === 'checkin') return 'checkin';
  return 'reward';
}

/** 「我的」主动看广告 */
export function isAdRewardEnabled() {
  return (
    isRewardedAdReady('reward') &&
    defaultAdRewardPoints() > 0 &&
    defaultAdRewardDailyMax() > 0
  );
}

/** 保存不够时的激励广告（约 30s） */
export function isSaveAdRewardEnabled() {
  return (
    isRewardedAdReady('save') &&
    defaultSaveAdRewardPoints() > 0 &&
    defaultSaveAdRewardDailyMax() > 0
  );
}

/** 签到后再领：与救急同积分规则、同 30s 广告单元，每日仅 1 次（云端强制） */
export function isCheckinAdRewardEnabled() {
  return isRewardedAdReady('checkin') && defaultSaveAdRewardPoints() > 0;
}

function emitEntitlementChange() {
  try {
    const app = getApp();
    if (app && app.eventBus) app.eventBus.emit('entitlementChange');
  } catch (e) {
    /* ignore */
  }
}

function fallbackStatus(slot) {
  if (slot === 'checkin') {
    const points = defaultSaveAdRewardPoints();
    const dailyMax = points > 0 ? 1 : 0;
    const enabled = isCheckinAdRewardEnabled();
    return {
      slot,
      enabled,
      points,
      dailyMax,
      usedToday: 0,
      leftToday: enabled ? dailyMax : 0,
    };
  }
  const isSave = slot === 'save';
  const points = isSave ? defaultSaveAdRewardPoints() : defaultAdRewardPoints();
  const dailyMax = isSave
    ? defaultSaveAdRewardDailyMax()
    : defaultAdRewardDailyMax();
  const enabled = isSave ? isSaveAdRewardEnabled() : isAdRewardEnabled();
  return {
    slot,
    enabled,
    points,
    dailyMax,
    usedToday: 0,
    leftToday: enabled ? dailyMax : 0,
  };
}

/**
 * @param {'reward'|'save'|'checkin'} [slot]
 */
export async function fetchAdRewardStatus(slot = 'reward') {
  const normalized = normalizeSlot(slot);
  const fallback = fallbackStatus(normalized);
  if (normalized === 'reward' && !isRewardedAdReady('reward')) {
    return { ...fallback, enabled: false, leftToday: 0 };
  }
  if (
    (normalized === 'save' || normalized === 'checkin') &&
    !isRewardedAdReady(normalized)
  ) {
    return { ...fallback, enabled: false, leftToday: 0 };
  }
  try {
    const res = await callFunction('userEntitlement', {
      action: 'adRewardStatus',
      slot: normalized,
    });
    if (res && res.ok && res.data && res.data.points != null) {
      return {
        slot: normalized,
        enabled: !!res.data.enabled,
        points: Math.max(0, Number(res.data.points) || 0),
        dailyMax: Math.max(0, Number(res.data.dailyMax) || 0),
        usedToday: Math.max(0, Number(res.data.usedToday) || 0),
        leftToday: Math.max(0, Number(res.data.leftToday) || 0),
      };
    }
  } catch (e) {
    /* ignore */
  }
  return fallback;
}

/**
 * 积分不足看广告：算清余额 / 需求 / 还差 / 看完能补多少，避免以为一次能存完全部。
 * @param {{
 *   spendable?: number,
 *   need?: number,
 *   rewardPoints?: number,
 *   leftToday?: number,
 *   count?: number,
 *   unitCost?: number,
 *   actionLabel?: string,
 * }} [opts]
 */
export function buildSaveAdPrompt(opts = {}) {
  const spendable = Math.max(
    0,
    Number(opts.spendable != null ? opts.spendable : spendablePoints()) || 0,
  );
  const need = Math.max(0, Number(opts.need) || 0);
  const reward = Math.max(0, Number(opts.rewardPoints) || 0);
  const leftToday = Math.max(0, Number(opts.leftToday) || 0);
  const count = Math.max(0, Number(opts.count) || 0);
  const unitCost = Math.max(0, Number(opts.unitCost) || 0);
  const actionLabel = String(opts.actionLabel || '本次操作').trim() || '本次操作';

  const shortfall = Math.max(0, need - spendable);
  const afterOne = spendable + reward;
  const stillShortAfterOne = Math.max(0, need - afterOne);
  const canCoverAfterOne = need > 0 ? afterOne >= need : reward > 0;
  const adsNeeded =
    reward > 0 && shortfall > 0 ? Math.ceil(shortfall / reward) : 0;
  const canSaveAfterOne =
    unitCost > 0 ? Math.floor(afterOne / unitCost) : afterOne > 0 ? 1 : 0;

  const lines = [];
  if (need > 0) {
    lines.push(
      `当前可用 ${spendable} 积分，${actionLabel}需 ${need} 积分，还差 ${shortfall}。`,
    );
  } else {
    lines.push(`当前可用 ${spendable} 积分。`);
  }
  lines.push(
    `看完本次广告可领 ${reward} 积分${
      leftToday > 0 ? `（今日还可 ${leftToday} 次）` : ''
    }。`,
  );

  if (!reward) {
    lines.push('当前暂未开放看广告领积分。');
  } else if (canCoverAfterOne) {
    lines.push('看完后预计够完成本次。');
  } else if (count > 1 && unitCost > 0) {
    lines.push(
      `看完后约可存 ${canSaveAfterOne}/${count} 张，不能一次存完全部；可减少勾选，或再看广告补积分。`,
    );
  } else if (adsNeeded > 1) {
    lines.push(
      `看完后仍差约 ${stillShortAfterOne} 积分，大约还需再看 ${
        adsNeeded - 1
      } 次，不会一次补齐。`,
    );
  } else {
    lines.push(`看完后仍差约 ${stillShortAfterOne} 积分。`);
  }

  return {
    spendable,
    need,
    shortfall,
    reward,
    leftToday,
    afterOne,
    stillShortAfterOne,
    canCoverAfterOne,
    adsNeeded,
    canSaveAfterOne,
    count,
    unitCost,
    actionLabel,
    title: shortfall > 0 ? '积分不够啦' : '看广告领积分',
    content: lines.join('\n'),
  };
}

/**
 * 领取后的轻提示：写清到账与是否还差。
 */
export function formatAdClaimToast({ gained, spendable, need }) {
  const add = Math.max(0, Number(gained) || 0);
  const bal = Math.max(0, Number(spendable) || 0);
  const req = Math.max(0, Number(need) || 0);
  if (req > 0 && bal >= req) {
    return add ? `已到账 +${add}，可以继续了` : '积分已够，可以继续了';
  }
  if (req > 0) {
    const short = Math.max(0, req - bal);
    return add
      ? `已到账 +${add}，还差 ${short} 积分`
      : `还差 ${short} 积分`;
  }
  return add ? `已到账 +${add} 积分` : '领取成功';
}

/**
 * 完整观看激励视频后向云函数领取积分。
 * @param {{ page?: any, slot?: 'reward'|'save'|'checkin' }} [opts]
 */
export async function watchAdAndClaimPoints(opts = {}) {
  const slot = normalizeSlot(opts.slot);
  const ready =
    slot === 'checkin'
      ? isCheckinAdRewardEnabled()
      : slot === 'save'
        ? isSaveAdRewardEnabled()
        : isAdRewardEnabled();
  if (!ready) {
    wx.showToast({ title: '暂未开放看广告领积分', icon: 'none' });
    return { ok: false, reason: 'DISABLED', message: '暂未开放看广告领积分' };
  }

  const watched = await showRewardedAd({ page: opts.page, slot });
  if (!watched) {
    return { ok: false, reason: 'SKIPPED', message: '需看完广告才能领积分' };
  }

  wx.showLoading({ title: '领取中', mask: true });
  try {
    const res = await callFunction('userEntitlement', {
      action: 'claimAdReward',
      slot,
    });
    if (res && res.entitlement) {
      setCachedEntitlement(res.entitlement);
      emitEntitlementChange();
    }
    return res || { ok: false, reason: 'FAIL', message: '领取失败' };
  } finally {
    wx.hideLoading();
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

/**
 * 积分不足时引导看救急广告；取消则引导去「我的」。
 * @param {{
 *   page?: any,
 *   message?: string,
 *   need?: number,
 *   spendable?: number,
 *   count?: number,
 *   unitCost?: number,
 *   actionLabel?: string,
 *   maxRounds?: number,
 * }} [opts]
 * @returns {Promise<{ ok: boolean, action: 'claimed'|'go_my'|'cancel'|'unavailable', entitlement?: object }>}
 */
export async function promptSaveAdForPoints(opts = {}) {
  const need = Math.max(0, Number(opts.need) || 0);
  const count = Math.max(0, Number(opts.count) || 0);
  const unitCost = Math.max(0, Number(opts.unitCost) || 0);
  const actionLabel = String(opts.actionLabel || '').trim();
  const maxRounds = Math.max(1, Math.min(3, Number(opts.maxRounds) || 2));
  const baseMsg = String(opts.message || '').trim();

  // VIP 免广告：不引导看广告，直接去「我的」处理额度/积分
  if (getCachedEntitlement().isVip) {
    const go = await showModalAsync({
      title: '积分不足',
      content: `${
        baseMsg || '本月额度或积分不足'
      }。会员已享应用内免广告，可到「我的」查看额度或购买积分。`,
      confirmText: '去我的',
      cancelText: '取消',
    });
    return { ok: false, action: go ? 'go_my' : 'cancel' };
  }

  if (!isSaveAdRewardEnabled()) {
    const go = await showModalAsync({
      title: '积分不足',
      content: `${
        baseMsg || '积分不足'
      }。可到「我的」签到、看广告或购买积分。`,
      confirmText: '去我的',
      cancelText: '取消',
    });
    return { ok: false, action: go ? 'go_my' : 'cancel' };
  }

  let rounds = 0;
  while (rounds < maxRounds) {
    rounds += 1;
    const status = await fetchAdRewardStatus('save');
    const bal = spendablePoints();
    if (need > 0 && bal >= need) {
      return { ok: true, action: 'claimed' };
    }

    if (!status.enabled || status.leftToday <= 0) {
      const shortfall = Math.max(0, need - bal);
      const go = await showModalAsync({
        title: '积分不足',
        content:
          (need > 0
            ? `当前 ${bal} 积分，还差 ${shortfall}。`
            : `${baseMsg || '积分不足'}。`) +
          '今日看广告次数已用完，可到「我的」领积分或购买。',
        confirmText: '去我的',
        cancelText: '取消',
      });
      return { ok: false, action: go ? 'go_my' : 'cancel' };
    }

    const prompt = buildSaveAdPrompt({
      spendable: bal,
      need,
      rewardPoints: status.points,
      leftToday: status.leftToday,
      count,
      unitCost,
      actionLabel: actionLabel || (count > 1 ? `保存 ${count} 张` : '本次操作'),
    });

    const confirm = await showModalAsync({
      title: prompt.title,
      content: prompt.content,
      confirmText: '看广告',
      cancelText: '去我的',
    });
    if (!confirm) {
      return { ok: false, action: 'go_my' };
    }

    const res = await watchAdAndClaimPoints({ page: opts.page, slot: 'save' });
    if (!res || !res.ok) {
      if (res && res.reason === 'SKIPPED') {
        return { ok: false, action: 'cancel' };
      }
      wx.showToast({
        title: (res && res.message) || '领取失败',
        icon: 'none',
      });
      return { ok: false, action: 'cancel', entitlement: res && res.entitlement };
    }

    const nextBal = spendablePoints(res.entitlement);
    const gained = Math.max(0, Number(res.points) || 0);
    const tip = formatAdClaimToast({
      gained,
      spendable: nextBal,
      need,
    });
    showPointsReward({
      host: opts.page,
      points: gained,
      title: '看广告领积分',
      tip:
        need > 0 && nextBal >= need
          ? `${tip} · 可以继续啦`
          : tip,
    });

    if (need <= 0 || nextBal >= need) {
      return {
        ok: true,
        action: 'claimed',
        entitlement: res.entitlement,
        points: gained,
      };
    }

    if (rounds >= maxRounds) {
      break;
    }
  }

  const bal = spendablePoints();
  const shortfall = Math.max(0, need - bal);
  const again = await showModalAsync({
    title: '积分仍不足',
    content:
      (need > 0
        ? `当前 ${bal} 积分，还差 ${shortfall}。`
        : '') + '可再看广告，或到「我的」领积分 / 购买。',
    confirmText: '去我的',
    cancelText: '取消',
  });
  return { ok: false, action: again ? 'go_my' : 'cancel' };
}
