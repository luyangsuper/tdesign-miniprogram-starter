const { dayjs, toMs } = require('./time');

const TZ = 'Asia/Shanghai';
const MONTHLY_QUOTA = 36;

function periodKey(ms = Date.now()) {
  return dayjs(ms).tz(TZ).format('YYYY-MM');
}

function formatDate(ms) {
  if (!ms) return '';
  const d = dayjs(ms);
  if (!d.isValid()) return '';
  return d.format('YYYY-MM-DD HH:mm');
}

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

module.exports = {
  buildEntitlement,
};
