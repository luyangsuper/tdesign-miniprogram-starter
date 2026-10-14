const cloud = require('wx-server-sdk');
const {
  deliverOrder,
  reclaimOrderGrant,
  findDeliveredByWxOrderId,
} = require('./virtualPay');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database({ throwOnNotFound: false });

/**
 * 云开发「消息推送」接收虚拟支付回调
 * 订阅：xpay_goods_deliver_notify、xpay_refund_notify
 *
 * 对齐个人指引：
 * - 以 wx_order_id（MchOrderNo）幂等
 * - 本地订单未就绪时返回失败让平台重试，禁止盲建单（防双发）
 * - 发货按 Quantity 倍增（deliverOrder meta.quantity）
 */
exports.main = async (event = {}) => {
  console.log('virtualPayNotify', JSON.stringify(event).slice(0, 2000));

  try {
    const Event = event.Event || event.event;
    if (Event === 'xpay_goods_deliver_notify') {
      const openid = event.OpenId || event.openid;
      const outTradeNo = event.OutTradeNo || event.outTradeNo;
      const goods = event.GoodsInfo || event.goodsInfo || {};
      const productId = goods.ProductId || goods.productId || event.productId;
      const quantity = Math.max(
        1,
        Math.floor(Number(goods.Quantity != null ? goods.Quantity : goods.quantity) || 1),
      );
      const payInfo = event.WeChatPayInfo || event.weChatPayInfo || {};
      const wxOrderId = String(
        payInfo.MchOrderNo ||
          payInfo.mchOrderNo ||
          event.WxOrderId ||
          event.wxOrderId ||
          '',
      ).trim();

      if (!outTradeNo && !wxOrderId) {
        return { ErrCode: 0, ErrMsg: 'success' };
      }

      // 平台单号已发货 → 直接成功（幂等）
      if (wxOrderId) {
        const dup = await findDeliveredByWxOrderId(db, wxOrderId);
        if (dup) {
          return { ErrCode: 0, ErrMsg: 'success' };
        }
      }

      let order = null;
      if (outTradeNo) {
        const res = await db.collection('orders').where({ outTradeNo }).limit(1).get();
        order = (res.data || [])[0];
      }
      if (!order && wxOrderId) {
        const res = await db.collection('orders').where({ wxOrderId }).limit(1).get();
        order = (res.data || [])[0];
      }

      if (!order) {
        // 不盲建单：下单可能尚未落库，返回失败让微信重试（最多 15 次）
        console.warn('notify order missing, retry later', {
          outTradeNo,
          wxOrderId,
          openid,
          productId,
        });
        return { ErrCode: -1, ErrMsg: 'order not ready' };
      }

      if (order.status === 'refunded') {
        return { ErrCode: 0, ErrMsg: 'success' };
      }

      await db.collection('orders').doc(order._id).update({
        data: {
          status: order.status === 'delivered' ? 'delivered' : 'paid',
          wxOrderId: wxOrderId || order.wxOrderId || '',
          buyQuantity: quantity,
          notifyEvent: Event,
          updatedAt: db.serverDate(),
        },
      });

      const fresh = (await db.collection('orders').doc(order._id).get()).data;
      await deliverOrder(db, cloud, { ...fresh, _id: order._id }, { wxOrderId, quantity });
      return { ErrCode: 0, ErrMsg: 'success' };
    }

    if (Event === 'xpay_refund_notify') {
      const outTradeNo = event.OutTradeNo || event.outTradeNo;
      const payInfo = event.WeChatPayInfo || event.weChatPayInfo || {};
      const wxOrderId = String(
        payInfo.MchOrderNo || payInfo.mchOrderNo || event.WxOrderId || event.wxOrderId || '',
      ).trim();

      let order = null;
      if (outTradeNo) {
        const res = await db.collection('orders').where({ outTradeNo }).limit(1).get();
        order = (res.data || [])[0];
      }
      if (!order && wxOrderId) {
        const res = await db.collection('orders').where({ wxOrderId }).limit(1).get();
        order = (res.data || [])[0];
      }
      if (!order) {
        console.warn('refund notify order missing', outTradeNo, wxOrderId);
        // 无单可回收，仍返回成功避免无限重试
        return { ErrCode: 0, ErrMsg: 'success' };
      }
      try {
        await reclaimOrderGrant(db, order);
      } catch (e) {
        console.error('reclaimOrderGrant', e);
        return { ErrCode: -1, ErrMsg: e.message || 'reclaim fail' };
      }
      return { ErrCode: 0, ErrMsg: 'success' };
    }

    return { ErrCode: 0, ErrMsg: 'success' };
  } catch (error) {
    console.error('virtualPayNotify fail', error);
    return { ErrCode: -1, ErrMsg: error.message || 'fail' };
  }
};
