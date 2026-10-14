import config from '~/config';
import { callFunction } from '~/utils/cloud';

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

/** 展示用划线原价：约 1.6 倍，营造「已是特惠价」 */
function dealOriginYuan(yuan) {
  const y = Number(yuan) || 0;
  if (y <= 0) return 0;
  return Math.max(Math.ceil(y * 1.6), Math.ceil(y) + 2);
}

function withDealFields(plan, yuan) {
  const origin = dealOriginYuan(yuan);
  return {
    ...plan,
    price: `¥${formatYuan(yuan)}`,
    originPrice: origin > yuan ? `¥${formatYuan(origin)}` : '',
    dealTag: origin > yuan ? '特惠' : '',
  };
}

const VIP_META = {
  vip_month: { key: 'month', tone: 'month', iconSrc: '/static/pricing/month.png', shortTitle: '包月' },
  vip_quarter: { key: 'quarter', tone: 'quarter', iconSrc: '/static/pricing/quarter.png', shortTitle: '季卡' },
  vip_year: { key: 'year', tone: 'year', iconSrc: '/static/pricing/year.png', shortTitle: '年卡' },
};

const POINTS_META = {
  points_20: { key: 'p0', tone: 'points', iconSrc: '/static/pricing/points.png' },
  points_66: { key: 'p1', tone: 'points2', iconSrc: '/static/pricing/points2.png' },
  points_170: { key: 'p2', tone: 'points3', iconSrc: '/static/pricing/points3.png' },
};

function fenToYuan(fen) {
  return Number(fen || 0) / 100;
}

/**
 * 用云端 live 商品列表组装展示方案；缺省回退 config.membershipPricing
 * 槽位 slotId 稳定；微信 productId 可随改价轮换
 * @param {Array<{slotId?,productId,planKey,title,type,value,priceFen}>|null} products
 */
export function buildPricingPlansFromProducts(products) {
  const monthly = Math.max(1, Number(config.monthlyQuota) || 36);
  const staticCost = downloadCost('static');
  const animCost = downloadCost('anim');
  const payOn = !!(config.virtualPay && config.virtualPay.enabled);
  const list = Array.isArray(products) ? products : [];

  if (!list.length) {
    return getPricingPlansFromConfig();
  }

  const bySlot = {};
  const byPlan = {};
  list.forEach((p) => {
    if (!p) return;
    const slot = p.slotId || (VIP_META[p.productId] || POINTS_META[p.productId] ? p.productId : '');
    if (slot) bySlot[slot] = p;
    if (p.planKey) byPlan[p.planKey] = p;
  });

  const vipPlans = ['vip_month', 'vip_quarter', 'vip_year']
    .map((slot) => {
      const meta = VIP_META[slot];
      const p = bySlot[slot] || (meta && byPlan[meta.key]);
      if (!p || !meta) return null;
      const yuan = fenToYuan(p.priceFen);
      const days = Math.max(1, Number(p.value) || 30);
      const periodLabel = `${days} 天`;
      let desc = `每月 ${monthly} 积分`;
      if (meta.key === 'month') {
        desc = `每月 ${monthly} 积分 · 约 ${Math.floor(monthly / animCost)} 张动态`;
      } else if (meta.key === 'quarter') {
        desc = `每月仍 ${monthly} 积分 · 约合 ¥${formatYuan(yuan / 3)}/月`;
      } else {
        desc = `每月仍 ${monthly} 积分 · 约合 ¥${formatYuan(yuan / 12)}/月`;
      }
      return withDealFields(
        {
          key: meta.key,
          planKey: meta.key,
          productId: p.productId || slot,
          slotId: slot,
          tone: meta.tone,
          iconSrc: meta.iconSrc,
          title: meta.shortTitle,
          priceFen: Math.round(Number(p.priceFen) || 0),
          period: periodLabel,
          desc,
          type: 'vip_days',
          value: days,
          note: `${meta.shortTitle}¥${formatYuan(yuan)}`,
        },
        yuan,
      );
    })
    .filter(Boolean);

  const pointPlans = ['points_20', 'points_66', 'points_170']
    .map((slot) => {
      const meta = POINTS_META[slot];
      const p = bySlot[slot] || (meta && byPlan[meta.key]);
      if (!p || !meta) return null;
      const total = Math.max(0, Number(p.value) || 0);
      const yuan = fenToYuan(p.priceFen);
      return withDealFields(
        {
          key: meta.key,
          planKey: meta.key,
          productId: p.productId || slot,
          slotId: slot,
          tone: meta.tone,
          iconSrc: meta.iconSrc,
          title: `${total} 积分`,
          priceFen: Math.round(Number(p.priceFen) || 0),
          period: `共 ${total} 积分`,
          desc: `约 ${Math.floor(total / animCost)} 张动态 / ${Math.floor(total / staticCost)} 张静态`,
          type: 'points',
          value: total,
          note: `积分包¥${formatYuan(yuan)}·${total}积分`,
        },
        yuan,
      );
    })
    .filter(Boolean);

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
          iconSrc: pointPlans[0].iconSrc,
          title: '积分包',
          price: `起 ${pointPlans[0].price}`,
          originPrice: pointPlans[0].originPrice || '',
          dealTag: pointPlans[0].dealTag || '',
        }
      : null,
  };
}

/** 离线默认（config.js） */
function getPricingPlansFromConfig() {
  const monthly = Math.max(1, Number(config.monthlyQuota) || 36);
  const staticCost = downloadCost('static');
  const animCost = downloadCost('anim');
  const pricing = config.membershipPricing || {};
  const packs = Array.isArray(pricing.pointPacks) ? pricing.pointPacks : [];
  const payOn = !!(config.virtualPay && config.virtualPay.enabled);

  const vipPlans = [
    withDealFields(
      {
        key: 'month',
        planKey: 'month',
        slotId: 'vip_month',
        productId: 'vip_month',
        tone: 'month',
        iconSrc: '/static/pricing/month.png',
        title: '包月',
        priceFen: Math.round((pricing.monthYuan ?? 10) * 100),
        period: '30 天',
        desc: `每月 ${monthly} 积分 · 约 ${Math.floor(monthly / animCost)} 张动态`,
        type: 'vip_days',
        value: 30,
        note: `包月¥${formatYuan(pricing.monthYuan ?? 10)}`,
      },
      pricing.monthYuan ?? 10,
    ),
    withDealFields(
      {
        key: 'quarter',
        planKey: 'quarter',
        slotId: 'vip_quarter',
        productId: 'vip_quarter',
        tone: 'quarter',
        iconSrc: '/static/pricing/quarter.png',
        title: '季卡',
        priceFen: Math.round((pricing.quarterYuan ?? 25) * 100),
        period: '90 天',
        desc: `每月仍 ${monthly} 积分 · 约合 ¥${formatYuan((pricing.quarterYuan ?? 25) / 3)}/月`,
        type: 'vip_days',
        value: 90,
        note: `季卡¥${formatYuan(pricing.quarterYuan ?? 25)}`,
      },
      pricing.quarterYuan ?? 25,
    ),
    withDealFields(
      {
        key: 'year',
        planKey: 'year',
        slotId: 'vip_year',
        productId: 'vip_year',
        tone: 'year',
        iconSrc: '/static/pricing/year.png',
        title: '年卡',
        priceFen: Math.round((pricing.yearYuan ?? 68) * 100),
        period: '365 天',
        desc: `每月仍 ${monthly} 积分 · 约合 ¥${formatYuan((pricing.yearYuan ?? 68) / 12)}/月`,
        type: 'vip_days',
        value: 365,
        note: `年卡¥${formatYuan(pricing.yearYuan ?? 68)}`,
      },
      pricing.yearYuan ?? 68,
    ),
  ];

  const pointMeta = [
    { tone: 'points', iconSrc: '/static/pricing/points.png', productId: 'points_20', planKey: 'p0' },
    { tone: 'points2', iconSrc: '/static/pricing/points2.png', productId: 'points_66', planKey: 'p1' },
    { tone: 'points3', iconSrc: '/static/pricing/points3.png', productId: 'points_170', planKey: 'p2' },
  ];
  const pointPlans = packs.map((p, i) => {
    const base = Math.max(0, Number(p.points) || 0);
    const bonus = Math.max(0, Number(p.bonus) || 0);
    const total = base + bonus;
    const meta = pointMeta[i] || pointMeta[0];
    const yuan = Number(p.priceYuan) || 0;
    return withDealFields(
      {
        key: meta.planKey || `p${i}`,
        planKey: meta.planKey || `p${i}`,
        slotId: meta.productId,
        productId: meta.productId,
        tone: meta.tone,
        iconSrc: meta.iconSrc,
        title: bonus ? `${base}+${bonus} 积分` : `${base} 积分`,
        priceFen: Math.round(yuan * 100),
        period: `共 ${total} 积分`,
        desc: `约 ${Math.floor(total / animCost)} 张动态 / ${Math.floor(total / staticCost)} 张静态`,
        type: 'points',
        value: total,
        note: `积分包¥${formatYuan(yuan)}·${total}积分`,
      },
      yuan,
    );
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
          iconSrc: pointPlans[0].iconSrc,
          title: '积分包',
          price: `起 ${pointPlans[0].price}`,
          originPrice: pointPlans[0].originPrice || '',
          dealTag: pointPlans[0].dealTag || '',
        }
      : null,
  };
}

/** 云端 live 定价缓存，避免先闪 config 价再跳云端价 */
let _cachedPricing = null;

export function cachePricingPlans(pricing) {
  if (pricing && Array.isArray(pricing.vipPlans) && pricing.vipPlans.length) {
    _cachedPricing = pricing;
  }
  return pricing;
}

/**
 * 给「我的」/ 弹层 / 兑换码页展示的定价方案（同步：优先云端缓存，否则 config）
 */
export function getPricingPlans() {
  return _cachedPricing || getPricingPlansFromConfig();
}

/**
 * 从云函数拉取 live 定价（adminManagePricing.public）
 */
export async function loadPricingPlans() {
  try {
    const res = await callFunction('adminManagePricing', { action: 'public' });
    const products = (res && res.products) || [];
    if (products.length) {
      return cachePricingPlans(buildPricingPlansFromProducts(products));
    }
  } catch (e) {
    console.warn('loadPricingPlans', e && e.message);
  }
  return getPricingPlans();
}

/** 用 login 返回的 pricingProducts 组装 */
export function pricingFromLoginPayload(loginRes) {
  const products = loginRes && loginRes.pricingProducts;
  if (Array.isArray(products) && products.length) {
    return cachePricingPlans(buildPricingPlansFromProducts(products));
  }
  return null;
}
