import config from '~/config';
import { callFunction } from '~/utils/cloud';
import { normalizeContentType, isEmojiType } from '~/utils/contentType';

const DEFAULT_COSTS = {
  static: 1,
  anim: 2,
  wallpaper: 4,
  avatar: 4,
  video: 8,
};

const DOWNLOAD_COSTS_KEY = 'download_costs';

function costTable() {
  let cached = null;
  try {
    cached = wx.getStorageSync(DOWNLOAD_COSTS_KEY);
  } catch (e) {
    cached = null;
  }
  return {
    ...DEFAULT_COSTS,
    ...(config.downloadCosts || {}),
    ...(cached && typeof cached === 'object' ? cached : {}),
  };
}

/** 登录 / 权益拉取后写入云端单价，详情与列表即时生效 */
export function setDownloadCosts(costs = {}) {
  const next = {
    static: Math.max(1, Number(costs.static) || DEFAULT_COSTS.static),
    anim: Math.max(1, Number(costs.anim) || DEFAULT_COSTS.anim),
    wallpaper: Math.max(1, Number(costs.wallpaper) || DEFAULT_COSTS.wallpaper),
    avatar: Math.max(1, Number(costs.avatar) || DEFAULT_COSTS.avatar),
    video: Math.max(1, Number(costs.video) || DEFAULT_COSTS.video),
  };
  try {
    wx.setStorageSync(DOWNLOAD_COSTS_KEY, next);
  } catch (e) {
    /* ignore */
  }
  try {
    const app = getApp();
    if (app && app.globalData) app.globalData.downloadCosts = next;
  } catch (e) {
    /* ignore */
  }
  return next;
}

export function applyDownloadCostsFromSettings(settings = {}) {
  if (!settings || typeof settings !== 'object') return costTable();
  if (settings.downloadCosts && typeof settings.downloadCosts === 'object') {
    return setDownloadCosts(settings.downloadCosts);
  }
  if (
    settings.costStatic != null ||
    settings.costAnim != null ||
    settings.costWallpaper != null ||
    settings.costAvatar != null ||
    settings.costVideo != null
  ) {
    return setDownloadCosts({
      static: settings.costStatic,
      anim: settings.costAnim,
      wallpaper: settings.costWallpaper,
      avatar: settings.costAvatar,
      video: settings.costVideo,
    });
  }
  return costTable();
}

/**
 * 积分单价。
 * @param {string} costKey static|anim|wallpaper|avatar|video
 */
export function downloadCost(costKey) {
  const costs = costTable();
  const key = String(costKey || 'static');
  const n = Number(costs[key]);
  return n > 0 ? n : costs.static || 1;
}

/**
 * 按合集类型 + 表情动静解析扣费 key
 * @param {string} contentType
 * @param {'static'|'anim'} [variant]
 */
export function resolveDownloadCostKey(contentType, variant = 'static') {
  const type = normalizeContentType(contentType);
  if (isEmojiType(type)) {
    return variant === 'anim' ? 'anim' : 'static';
  }
  return type;
}

export function downloadCostForPack(contentType, variant = 'static') {
  return downloadCost(resolveDownloadCostKey(contentType, variant));
}

export function formatCostHint(costKeyOrVariant) {
  const n = downloadCost(costKeyOrVariant);
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
  points_4: { key: 'p4', tone: 'points4', iconSrc: '/static/pricing/points4.png' },
  points_8: { key: 'p8', tone: 'points5', iconSrc: '/static/pricing/points5.png' },
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
  const monthly = Math.max(1, Number(config.monthlyQuota) || 48);
  const staticCost = downloadCost('static');
  const animCost = downloadCost('anim');
  const wallpaperCost = downloadCost('wallpaper');
  const avatarCost = downloadCost('avatar');
  const videoCost = downloadCost('video');
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
      let desc = `每月 ${monthly} 积分 · 应用内免广告 · 全节日氛围`;
      if (meta.key === 'month') {
        desc = `每月 ${monthly} 积分 · 应用内免广告 · 全节日氛围`;
      } else if (meta.key === 'quarter') {
        desc = `每月仍 ${monthly} 积分 · 应用内免广告 · 全节日 · 约合 ¥${formatYuan(yuan / 3)}/月`;
      } else {
        desc = `每月仍 ${monthly} 积分 · 应用内免广告 · 全节日 · 约合 ¥${formatYuan(yuan / 12)}/月`;
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

  const pointPlans = ['points_4', 'points_8', 'points_20', 'points_66', 'points_170']
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
    wallpaperCost,
    avatarCost,
    videoCost,
    monthlyQuota: monthly,
    costLine: `保存：表情静态 ${staticCost} / 动态 ${animCost} · 壁纸 ${wallpaperCost} · 头像 ${avatarCost} · 视频 ${videoCost} 积分`,
    ruleLine: `包月含每月额度、应用内免广告（信息流/详情等原生广告，不含启动封面广告）与全节日氛围（普通用户仅春节/圣诞）；额度自然月重置，未用完不滚存；先扣本月额度，再扣购买积分。`,
    vipPerkLine: '会员权益：每月额度 · 应用内免广告 · 全节日氛围 · 有效期内一直生效',
    buyTip: payOn
      ? '点「购买」可在小程序内支付到账；也可使用兑换码。'
      : '暂不支持在线支付。请使用兑换码兑换，或通过「我的 → 意见反馈」联系我们。',
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
  const monthly = Math.max(1, Number(config.monthlyQuota) || 48);
  const staticCost = downloadCost('static');
  const animCost = downloadCost('anim');
  const wallpaperCost = downloadCost('wallpaper');
  const avatarCost = downloadCost('avatar');
  const videoCost = downloadCost('video');
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
        priceFen: Math.round((pricing.monthYuan ?? 9) * 100),
        period: '30 天',
        desc: `每月 ${monthly} 积分 · 应用内免广告 · 全节日氛围`,
        type: 'vip_days',
        value: 30,
        note: `包月¥${formatYuan(pricing.monthYuan ?? 9)}`,
      },
      pricing.monthYuan ?? 9,
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
        priceFen: Math.round((pricing.quarterYuan ?? 24) * 100),
        period: '90 天',
        desc: `每月仍 ${monthly} 积分 · 应用内免广告 · 全节日 · 约合 ¥${formatYuan((pricing.quarterYuan ?? 24) / 3)}/月`,
        type: 'vip_days',
        value: 90,
        note: `季卡¥${formatYuan(pricing.quarterYuan ?? 24)}`,
      },
      pricing.quarterYuan ?? 24,
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
        priceFen: Math.round((pricing.yearYuan ?? 70) * 100),
        period: '365 天',
        desc: `每月仍 ${monthly} 积分 · 应用内免广告 · 全节日 · 约合 ¥${formatYuan((pricing.yearYuan ?? 70) / 12)}/月`,
        type: 'vip_days',
        value: 365,
        note: `年卡¥${formatYuan(pricing.yearYuan ?? 70)}`,
      },
      pricing.yearYuan ?? 70,
    ),
  ];

  const pointMeta = [
    { tone: 'points4', iconSrc: '/static/pricing/points4.png', productId: 'points_4', planKey: 'p4' },
    { tone: 'points5', iconSrc: '/static/pricing/points5.png', productId: 'points_8', planKey: 'p8' },
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
    wallpaperCost,
    avatarCost,
    videoCost,
    monthlyQuota: monthly,
    costLine: `保存：表情静态 ${staticCost} / 动态 ${animCost} · 壁纸 ${wallpaperCost} · 头像 ${avatarCost} · 视频 ${videoCost} 积分`,
    ruleLine: `包月含每月额度、应用内免广告（信息流/详情等原生广告，不含启动封面广告）与全节日氛围（普通用户仅春节/圣诞）；额度自然月重置，未用完不滚存；先扣本月额度，再扣购买积分。`,
    vipPerkLine: '会员权益：每月额度 · 应用内免广告 · 全节日氛围 · 有效期内一直生效',
    buyTip: payOn
      ? '点「购买」可在小程序内支付到账；也可使用兑换码。'
      : '暂不支持在线支付。请使用兑换码兑换，或通过「我的 → 意见反馈」联系我们。',
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
