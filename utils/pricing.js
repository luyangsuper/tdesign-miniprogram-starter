import config from '~/config';

/** @param {'static'|'anim'} variant */
export function downloadCost(variant) {
  const costs = config.downloadCosts || { static: 1, anim: 2 };
  return variant === 'anim' ? costs.anim || 2 : costs.static || 1;
}

export function formatCostHint(variant) {
  const n = downloadCost(variant);
  return `${n} 积分`;
}

function formatYuan(n) {
  const v = Number(n);
  if (Number.isNaN(v)) return String(n);
  return Number.isInteger(v) ? String(v) : v.toFixed(1).replace(/\.0$/, '');
}

/**
 * 给「我的」/ 弹层 / 兑换码页展示的定价方案（来自 config.membershipPricing）
 * 每档含 type/value/productId，供购买与管理员生成兑换码
 */
export function getPricingPlans() {
  const monthly = Math.max(1, Number(config.monthlyQuota) || 36);
  const staticCost = downloadCost('static');
  const animCost = downloadCost('anim');
  const pricing = config.membershipPricing || {};
  const packs = Array.isArray(pricing.pointPacks) ? pricing.pointPacks : [];
  const payOn = !!(config.virtualPay && config.virtualPay.enabled);

  // 插图：IconPark two-tone，本地 static/pricing/（npm run icons:gen）
  const vipPlans = [
    {
      key: 'month',
      productId: 'vip_month',
      tone: 'month',
      iconSrc: '/static/pricing/month.png',
      title: '包月',
      price: `¥${formatYuan(pricing.monthYuan ?? 10)}`,
      priceFen: Math.round((pricing.monthYuan ?? 10) * 100),
      period: '30 天',
      desc: `每月 ${monthly} 积分 · 约 ${Math.floor(monthly / animCost)} 张动态`,
      type: 'vip_days',
      value: 30,
      note: `包月¥${formatYuan(pricing.monthYuan ?? 10)}`,
    },
    {
      key: 'quarter',
      productId: 'vip_quarter',
      tone: 'quarter',
      iconSrc: '/static/pricing/quarter.png',
      title: '季卡',
      price: `¥${formatYuan(pricing.quarterYuan ?? 25)}`,
      priceFen: Math.round((pricing.quarterYuan ?? 25) * 100),
      period: '90 天',
      desc: `每月仍 ${monthly} 积分 · 约合 ¥${formatYuan((pricing.quarterYuan ?? 25) / 3)}/月`,
      type: 'vip_days',
      value: 90,
      note: `季卡¥${formatYuan(pricing.quarterYuan ?? 25)}`,
    },
    {
      key: 'year',
      productId: 'vip_year',
      tone: 'year',
      iconSrc: '/static/pricing/year.png',
      title: '年卡',
      price: `¥${formatYuan(pricing.yearYuan ?? 68)}`,
      priceFen: Math.round((pricing.yearYuan ?? 68) * 100),
      period: '365 天',
      desc: `每月仍 ${monthly} 积分 · 约合 ¥${formatYuan((pricing.yearYuan ?? 68) / 12)}/月`,
      type: 'vip_days',
      value: 365,
      note: `年卡¥${formatYuan(pricing.yearYuan ?? 68)}`,
    },
  ];

  const pointMeta = [
    { tone: 'points', iconSrc: '/static/pricing/points.png', productId: 'points_20' },
    { tone: 'points2', iconSrc: '/static/pricing/points2.png', productId: 'points_66' },
    { tone: 'points3', iconSrc: '/static/pricing/points3.png', productId: 'points_170' },
  ];
  const pointPlans = packs.map((p, i) => {
    const base = Math.max(0, Number(p.points) || 0);
    const bonus = Math.max(0, Number(p.bonus) || 0);
    const total = base + bonus;
    const meta = pointMeta[i] || pointMeta[0];
    return {
      key: `p${i}`,
      productId: meta.productId,
      tone: meta.tone,
      iconSrc: meta.iconSrc,
      title: bonus ? `${base}+${bonus} 积分` : `${base} 积分`,
      price: `¥${formatYuan(p.priceYuan)}`,
      priceFen: Math.round(Number(p.priceYuan) * 100),
      period: `共 ${total} 积分`,
      desc: `约 ${Math.floor(total / animCost)} 张动态 / ${Math.floor(total / staticCost)} 张静态`,
      type: 'points',
      value: total,
      note: `积分包¥${formatYuan(p.priceYuan)}·${total}积分`,
    };
  });

  return {
    staticCost,
    animCost,
    monthlyQuota: monthly,
    serviceWechat: config.serviceWechat || 'Shine_Luyang',
    costLine: `保存原图：静态 ${staticCost} 积分 · 动态 ${animCost} 积分`,
    ruleLine: `包月额度自然月重置，未用完不滚存；先扣本月额度，再扣购买积分。`,
    buyTip: payOn
      ? '点「购买」可在小程序内支付到账；也可复制微信号联系客服，或使用兑换码。'
      : '暂不支持在线支付。复制微信号联系客服，付款后发兑换码；也可在上方自行兑换。',
    virtualPayEnabled: payOn,
    vipPlans,
    pointPlans,
    allPlans: vipPlans.concat(pointPlans),
    pointsStrip: pointPlans[0]
      ? {
          tone: 'points',
          title: '积分包',
          price: `起 ${pointPlans[0].price}`,
        }
      : null,
  };
}
