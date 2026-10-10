const cloud = require('wx-server-sdk');
const {
  OFFER_ID,
  PAY_ENV,
  getAppKey,
  stableStringify,
  calcPaySig,
  calcUserSig,
  makeOutTradeNo,
  deliverOrder,
  queryOrderPaid,
  isOrderPaid,
  getProduct,
  grantMessage,
} = require('./virtualPay');
const { resolveSessionKey } = require('./session');
const { productIdByPlanKey } = require('./products');
const { buildEntitlement, syncVipMonthQuota } = require('./membership');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

/**
 * 虚拟支付下单 / 支付后确认发货
 * action:
 *  - create（默认）{ planKey | productId, code }  code 来自 wx.login
 *  - confirm { outTradeNo }  查单并幂等发货（推送未配时的兜底）
 *  - status { outTradeNo }   查本地订单
 */
exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) {
    return { ok: false, code: 'NO_OPENID', message: '请先登录' };
  }

  const action = event.action || 'create';

  try {
    if (action === 'status') {
      const outTradeNo = String(event.outTradeNo || '');
      if (!outTradeNo) return { ok: false, code: 'BAD_PARAM', message: '缺少订单号' };
      const res = await db.collection('orders').where({ outTradeNo, openid: OPENID }).limit(1).get();
      const order = (res.data || [])[0];
      if (!order) return { ok: false, code: 'NOT_FOUND', message: '订单不存在' };
      let entitlement = null;
      if (order.status === 'delivered') {
        const uref = db.collection('users').doc(OPENID);
        const u = (await uref.get()).data || {};
        const synced = await syncVipMonthQuota(uref, u, db.serverDate());
        entitlement = buildEntitlement(synced);
      }
      return {
        ok: true,
        order: {
          outTradeNo: order.outTradeNo,
          productId: order.productId,
          status: order.status,
          priceFen: order.priceFen,
        },
        grant: order.grant || null,
        message: order.status === 'delivered' ? grantMessage(order.grant) : '',
        entitlement,
      };
    }

    if (action === 'confirm') {
      const outTradeNo = String(event.outTradeNo || '');
      if (!outTradeNo) return { ok: false, code: 'BAD_PARAM', message: '缺少订单号' };
      const res = await db.collection('orders').where({ outTradeNo, openid: OPENID }).limit(1).get();
      const order = (res.data || [])[0];
      if (!order) return { ok: false, code: 'NOT_FOUND', message: '订单不存在' };
      if (order.status === 'delivered') {
        const uref = db.collection('users').doc(OPENID);
        const u = (await uref.get()).data || {};
        const synced = await syncVipMonthQuota(uref, u, db.serverDate());
        return {
          ok: true,
          delivered: true,
          already: true,
          message: grantMessage(order.grant) || '已到账',
          grant: order.grant || null,
          entitlement: buildEntitlement(synced),
        };
      }

      let queryRes = null;
      try {
        queryRes = await queryOrderPaid(cloud, { openid: OPENID, outTradeNo });
      } catch (e) {
        console.warn('query_order', e.message || e);
      }

      const paid = isOrderPaid(queryRes);
      // 仅沙箱：推送/查单未就绪时，允许在客户端支付 success 后确认发货（现网禁止）
      const force = PAY_ENV === 1 && !!event.forceAfterClientSuccess;
      if (!paid && !force) {
        return {
          ok: false,
          code: 'NOT_PAID',
          message: '尚未查到支付成功，请稍后再试',
          query: queryRes,
        };
      }

      const wxOrderId =
        (queryRes && (queryRes.wx_order_id || queryRes.wxOrderId)) ||
        event.wxOrderId ||
        '';
      if (wxOrderId || paid || force) {
        await db.collection('orders').doc(order._id).update({
          data: {
            status: paid || force ? 'paid' : order.status,
            wxOrderId: wxOrderId || order.wxOrderId || '',
            querySnapshot: queryRes || null,
            updatedAt: db.serverDate(),
          },
        });
      }

      const order2 = (await db.collection('orders').doc(order._id).get()).data;
      const delivered = await deliverOrder(db, cloud, { ...order2, _id: order._id }, { wxOrderId });
      const msg = delivered.already
        ? grantMessage(delivered.grant || order2.grant) || '已到账'
        : grantMessage(delivered.grant) || '支付成功，权益已到账';
      return {
        ok: true,
        delivered: true,
        already: !!delivered.already,
        message: msg,
        entitlement: delivered.entitlement,
        grant: delivered.grant,
      };
    }

    // create
    const appKey = getAppKey();
    if (!appKey) {
      return {
        ok: false,
        code: 'NO_APPKEY',
        message: '未配置虚拟支付 AppKey（云函数环境变量 VIRTUAL_PAY_APPKEY_SANDBOX）',
      };
    }

    let productId = String(event.productId || '').trim();
    if (!productId && event.planKey) {
      productId = productIdByPlanKey(String(event.planKey));
    }
    const product = getProduct(productId);
    if (!product) {
      return { ok: false, code: 'BAD_PRODUCT', message: '未知商品' };
    }

    const jsCode = String(event.code || '').trim();
    const sessionKey = await resolveSessionKey(db, cloud, OPENID, jsCode);

    const outTradeNo = makeOutTradeNo();
    const attachObj = {
      openid: OPENID,
      productId: product.productId,
      planKey: product.planKey,
    };
    const signObj = {
      offerId: OFFER_ID,
      buyQuantity: 1,
      env: PAY_ENV,
      currencyType: 'CNY',
      productId: product.productId,
      goodsPrice: product.priceFen,
      outTradeNo,
      attach: JSON.stringify(attachObj),
    };
    const signData = stableStringify(signObj);
    const paySig = calcPaySig('requestVirtualPayment', signData, appKey);
    const signature = calcUserSig(signData, sessionKey);

    await db.collection('orders').add({
      data: {
        openid: OPENID,
        outTradeNo,
        productId: product.productId,
        planKey: product.planKey,
        grantType: product.type,
        grantValue: product.value,
        priceFen: product.priceFen,
        title: product.title,
        env: PAY_ENV,
        status: 'pending',
        wxOrderId: '',
        createdAt: db.serverDate(),
        updatedAt: db.serverDate(),
      },
    });

    return {
      ok: true,
      pay: {
        mode: 'short_series_goods',
        signData,
        paySig,
        signature,
      },
      order: {
        outTradeNo,
        productId: product.productId,
        priceFen: product.priceFen,
        title: product.title,
        env: PAY_ENV,
      },
    };
  } catch (e) {
    console.error(e);
    return { ok: false, code: 'FAIL', message: e.message || '下单失败' };
  }
};
