/**
 * 虚拟支付道具目录硬编码回退（与 MP「道具管理」一致；价格单位：分）
 * 运行时优先 app_config/pricing（见 pricingSettings.js）
 */
const PRODUCTS = {
  vip_month: {
    productId: 'vip_month',
    planKey: 'month',
    title: '趣图铺子包月',
    type: 'vip_days',
    value: 30,
    priceFen: 900,
  },
  vip_quarter: {
    productId: 'vip_quarter',
    planKey: 'quarter',
    title: '趣图铺子季卡',
    type: 'vip_days',
    value: 90,
    priceFen: 2400,
  },
  vip_year: {
    productId: 'vip_year',
    planKey: 'year',
    title: '趣图铺子年卡',
    type: 'vip_days',
    value: 365,
    priceFen: 7000,
  },
  points_4: {
    productId: 'points_4',
    planKey: 'p4',
    title: '积分4',
    type: 'points',
    value: 4,
    priceFen: 100,
  },
  points_8: {
    productId: 'points_8',
    planKey: 'p8',
    title: '积分8',
    type: 'points',
    value: 8,
    priceFen: 200,
  },
  points_20: {
    productId: 'points_20',
    planKey: 'p0',
    title: '积分18',
    type: 'points',
    value: 18,
    priceFen: 500,
  },
  points_66: {
    productId: 'points_66',
    planKey: 'p1',
    title: '积分66',
    type: 'points',
    value: 66,
    priceFen: 1600,
  },
  points_170: {
    productId: 'points_170',
    planKey: 'p2',
    title: '积分170',
    type: 'points',
    value: 170,
    priceFen: 3200,
  },
};

function getProduct(productId) {
  return PRODUCTS[productId] || null;
}

function productIdByPlanKey(planKey) {
  const hit = Object.values(PRODUCTS).find((p) => p.planKey === planKey);
  return hit ? hit.productId : '';
}

module.exports = {
  PRODUCTS,
  getProduct,
  productIdByPlanKey,
};
