const cloud = require('wx-server-sdk');
const { deliverOrder } = require('./virtualPay');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

/**
 * 云开发「消息推送」接收虚拟支付回调
 * 需在云开发控制台订阅：xpay_goods_deliver_notify 等
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
      const payInfo = event.WeChatPayInfo || event.weChatPayInfo || {};
      const wxOrderId =
        payInfo.MchOrderNo ||
        payInfo.mchOrderNo ||
        event.WxOrderId ||
        event.wxOrderId ||
        '';

      if (!outTradeNo && !wxOrderId) {
        return { ErrCode: 0, ErrMsg: 'success' };
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
        // 推送先到、本地单未写：按推送建单再发货
        if (openid && productId) {
          const add = await db.collection('orders').add({
            data: {
              openid,
              outTradeNo: outTradeNo || `N${Date.now()}`,
              productId,
              status: 'paid',
              wxOrderId,
              source: 'notify',
              createdAt: db.serverDate(),
              updatedAt: db.serverDate(),
            },
          });
          order = { _id: add._id, openid, outTradeNo, productId, status: 'paid', wxOrderId };
        } else {
          console.warn('notify order missing', outTradeNo, wxOrderId);
          return { ErrCode: 0, ErrMsg: 'success' };
        }
      }

      await db.collection('orders').doc(order._id).update({
        data: {
          status: order.status === 'delivered' ? 'delivered' : 'paid',
          wxOrderId: wxOrderId || order.wxOrderId || '',
          notifyEvent: Event,
          updatedAt: db.serverDate(),
        },
      });

      const fresh = (await db.collection('orders').doc(order._id).get()).data;
      await deliverOrder(db, cloud, { ...fresh, _id: order._id }, { wxOrderId });
      return { ErrCode: 0, ErrMsg: 'success' };
    }

    if (Event === 'xpay_refund_notify') {
      // 退款：暂记日志，权益回收可后续加
      console.warn('refund notify', event.OutTradeNo || event.outTradeNo);
      return { ErrCode: 0, ErrMsg: 'success' };
    }

    return { ErrCode: 0, ErrMsg: 'success' };
  } catch (error) {
    console.error('virtualPayNotify fail', error);
    return { ErrCode: -1, ErrMsg: error.message || 'fail' };
  }
};
