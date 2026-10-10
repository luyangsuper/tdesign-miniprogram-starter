const { dayjs, toMs, formatDate } = require('./time');

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
 */
async function syncVipMonthQuota(ref, user, serverDate) {
  const now = Date.now();
  const isVip = toMs(user.vipExpireAt) > now;
  const period = periodKey(now);
  const lastPeriod = String(user.vipQuotaPeriod || '');
  let vipMonthQuota = Math.max(0, Number(user.vipMonthQuota) || 0);
  const patch = {};

  if (!isVip) {
    if (vipMonthQuota !== 0 || lastPeriod) {
      patch.vipMonthQuota = 0;
      patch.vipQuotaPeriod = '';
      vipMonthQuota = 0;
    }
  } else if (lastPeriod !== period) {
    patch.vipMonthQuota = MONTHLY_QUOTA;
    patch.vipQuotaPeriod = period;
    vipMonthQuota = MONTHLY_QUOTA;
  }

  if (Object.keys(patch).length) {
    patch.updatedAt = serverDate;
    await ref.update({ data: patch });
  }

  return {
    ...user,
    vipMonthQuota: isVip ? vipMonthQuota : 0,
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

module.exports = {
  MONTHLY_QUOTA,
  COST,
  periodKey,
  downloadCost,
  buildEntitlement,
  syncVipMonthQuota,
  consumeDownload,
};
