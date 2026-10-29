const { dayjs, toMs, formatDate } = require('./time');
const { recordPointsLog } = require('./pointsLog');

const TZ = 'Asia/Shanghai';
const MONTHLY_QUOTA = 36;
const COST = { static: 1, anim: 2 };

function periodKey(ms = Date.now()) {
  return dayjs(ms).tz(TZ).format('YYYY-MM');
}

function downloadCost(variant) {
  return variant === 'anim' ? COST.anim : COST.static;
}

/** 包月有效时：本月未发放则视为满额（展示用，真正发放走 syncVipMonthQuota） */
function effectiveVipMonthQuota(user = {}) {
  const now = Date.now();
  const isVip = toMs(user.vipExpireAt) > now;
  if (!isVip) return 0;
  const period = periodKey(now);
  if (String(user.vipQuotaPeriod || '') !== period) return MONTHLY_QUOTA;
  return Math.max(0, Number(user.vipMonthQuota) || 0);
}

function buildEntitlement(user = {}) {
  const now = Date.now();
  const vipExpireMs = toMs(user.vipExpireAt);
  const isVip = vipExpireMs > now;
  const points = Math.max(0, Number(user.points) || 0);
  const vipMonthQuota = effectiveVipMonthQuota(user);
  return {
    isVip,
    vipExpireAt: vipExpireMs || null,
    vipExpireText: isVip ? formatDate(vipExpireMs) : '',
    vipMonthQuota,
    vipQuotaPeriod: isVip ? periodKey(now) : '',
    monthlyQuota: MONTHLY_QUOTA,
    points,
    canDownload: vipMonthQuota + points > 0,
  };
}

/**
 * 包月按自然月（上海）重置额度；未用完不滚存。到期清零月额度。
 * 传入 db 时：发放 / 到期清零会写入积分流水。
 * @param {object} [db] cloud.database()，用于记流水；缺省则只改用户字段
 */
async function syncVipMonthQuota(ref, user, serverDate, db) {
  const now = Date.now();
  const isVip = toMs(user.vipExpireAt) > now;
  const period = periodKey(now);
  const lastPeriod = String(user.vipQuotaPeriod || '');
  let vipMonthQuota = Math.max(0, Number(user.vipMonthQuota) || 0);
  const points = Math.max(0, Number(user.points) || 0);
  const patch = {};
  let quotaLog = null;

  if (!isVip) {
    if (vipMonthQuota !== 0 || lastPeriod) {
      if (vipMonthQuota > 0) {
        quotaLog = {
          delta: -vipMonthQuota,
          reason: 'vip_expire',
          title: '包月到期清零',
          meta: { fromVip: vipMonthQuota, fromPoints: 0, period: lastPeriod },
        };
      }
      patch.vipMonthQuota = 0;
      patch.vipQuotaPeriod = '';
      vipMonthQuota = 0;
    }
  } else if (lastPeriod !== period) {
    quotaLog = {
      delta: MONTHLY_QUOTA,
      reason: 'vip_month',
      title: '包月本月额度',
      meta: {
        fromVip: MONTHLY_QUOTA,
        fromPoints: 0,
        period,
        prevPeriod: lastPeriod || '',
      },
    };
    patch.vipMonthQuota = MONTHLY_QUOTA;
    patch.vipQuotaPeriod = period;
    vipMonthQuota = MONTHLY_QUOTA;
  }

  if (Object.keys(patch).length) {
    patch.updatedAt = serverDate;
    await ref.update({ data: patch });
  }

  const nextVip = isVip ? vipMonthQuota : 0;
  if (quotaLog && db) {
    const openid = String(
      (user && (user._id || user.openid || user._openid)) ||
        (ref && ref.id) ||
        '',
    ).trim();
    if (openid) {
      await recordPointsLog(db, {
        openid,
        delta: quotaLog.delta,
        balance: points + nextVip,
        reason: quotaLog.reason,
        title: quotaLog.title,
        meta: quotaLog.meta,
      });
    }
  }

  return {
    ...user,
    vipMonthQuota: nextVip,
    vipQuotaPeriod: isVip ? period : '',
  };
}

/**
 * 先扣本月额度，再扣购买积分。
 */
async function consumeDownload(ref, user, variant, command, serverDate) {
  const cost = downloadCost(variant);
  let vipMonthQuota = Math.max(0, Number(user.vipMonthQuota) || 0);
  let points = Math.max(0, Number(user.points) || 0);

  if (vipMonthQuota + points < cost) {
    const kind = variant === 'anim' ? '动态' : '静态';
    return {
      ok: false,
      code: 'NO_GRANT',
      message:
        vipMonthQuota + points > 0
          ? `积分不足：${kind}需 ${cost} 积分，本月额度 ${vipMonthQuota}、积分 ${points}`
          : '暂无法下载，请兑换包月会员或积分',
      entitlement: buildEntitlement(user),
    };
  }

  let fromVip = 0;
  let fromPoints = 0;
  if (vipMonthQuota >= cost) {
    fromVip = cost;
  } else {
    fromVip = vipMonthQuota;
    fromPoints = cost - vipMonthQuota;
  }

  const data = { updatedAt: serverDate };
  if (fromVip) data.vipMonthQuota = command.inc(-fromVip);
  if (fromPoints) data.points = command.inc(-fromPoints);
  await ref.update({ data });

  const nextUser = {
    ...user,
    vipMonthQuota: vipMonthQuota - fromVip,
    points: points - fromPoints,
  };
  const grantType = fromVip && fromPoints ? 'mixed' : fromVip ? 'vip' : 'points';

  return {
    ok: true,
    grantType,
    cost,
    fromVip,
    fromPoints,
    entitlement: buildEntitlement(nextUser),
  };
}

/**
 * 保存失败时退回本次扣费（额度 / 购买积分原路返回）。
 */
async function refundDownload(ref, user, fromVip, fromPoints, command, serverDate) {
  const vip = Math.max(0, Math.floor(Number(fromVip) || 0));
  const pts = Math.max(0, Math.floor(Number(fromPoints) || 0));
  if (!vip && !pts) {
    return { ok: true, entitlement: buildEntitlement(user || {}) };
  }

  const data = { updatedAt: serverDate };
  if (vip) data.vipMonthQuota = command.inc(vip);
  if (pts) data.points = command.inc(pts);
  await ref.update({ data });

  const nextUser = {
    ...(user || {}),
    vipMonthQuota: Math.max(0, Number((user && user.vipMonthQuota) || 0)) + vip,
    points: Math.max(0, Number((user && user.points) || 0)) + pts,
  };
  return { ok: true, entitlement: buildEntitlement(nextUser) };
}

/**
 * 发放权益（兑换码 / 虚拟支付发货共用）
 * type: vip_days | points
 */
async function applyGrant(ref, user, type, value, command, serverDate, toMsFn) {
  const ms = typeof toMsFn === 'function' ? toMsFn : toMs;
  const now = Date.now();
  if (type === 'vip_days') {
    const days = Math.max(1, Number(value) || 1);
    const base = Math.max(now, ms(user.vipExpireAt));
    const next = dayjs(base).add(days, 'day').toDate();
    await ref.update({
      data: {
        vipExpireAt: next,
        updatedAt: serverDate,
      },
    });
    return { grantType: 'vip_days', days, vipExpireAt: next.getTime() };
  }
  if (type === 'points') {
    const add = Math.max(1, Number(value) || 1);
    await ref.update({
      data: {
        points: command.inc(add),
        updatedAt: serverDate,
      },
    });
    return { grantType: 'points', add };
  }
  throw new Error('不支持的发放类型');
}

module.exports = {
  MONTHLY_QUOTA,
  COST,
  periodKey,
  downloadCost,
  buildEntitlement,
  syncVipMonthQuota,
  consumeDownload,
  refundDownload,
  applyGrant,
};
