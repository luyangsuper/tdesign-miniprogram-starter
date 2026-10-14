/**
 * 虚拟支付道具目录硬编码回退（与 MP「道具管理」一致；价格单位：分）
 * 运行时优先 app_config/pricing（见 pricingSettings.js）
 */
const PRODUCTS = {
  vip_month: {
    productId: 'vip_month',
    planKey: 'month',
    title: '趣集包月',
    type: 'vip_days',
    value: 30,
    priceFen: 1000,
  },
  vip_quarter: {
    productId: 'vip_quarter',
    planKey: 'quarter',
    title: '趣集季卡',
    type: 'vip_days',
    value: 90,
    priceFen: 2500,
  },
  vip_year: {
    productId: 'vip_year',
    planKey: 'year',
    title: '趣集年卡',
    type: 'vip_days',
    value: 365,
    priceFen: 6800,
  },
  points_20: {
    productId: 'points_20',
    planKey: 'p0',
    title: '积分20',
    type: 'points',
    value: 20,
    priceFen: 600,
  },
  points_66: {
    productId: 'points_66',
    planKey: 'p1',
    title: '积分66',
    type: 'points',
    value: 66,
    priceFen: 1500,
  },
  points_170: {
    productId: 'points_170',
    planKey: 'p2',
    title: '积分170',
    type: 'points',
    value: 170,
    priceFen: 3000,
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
