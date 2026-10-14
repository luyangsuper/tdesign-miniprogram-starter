const crypto = require('crypto');
const https = require('https');
const { getProduct } = require('./products');
const { resolveLiveProduct } = require('./pricingSettings');
const { buildEntitlement, syncVipMonthQuota } = require('./membership');
const { toMs, dayjs } = require('./time');

const APPID = process.env.WX_APPID || 'wxc53da678dce0b8d1';
/** 沙箱 OfferId；现网一般相同，可用 VIRTUAL_PAY_OFFER_ID 覆盖 */
const OFFER_ID = String(process.env.VIRTUAL_PAY_OFFER_ID || '1450673547');
/** 0 现网 / 1 沙箱；默认现网 */
const PAY_ENV = Number(process.env.VIRTUAL_PAY_ENV != null ? process.env.VIRTUAL_PAY_ENV : 0);

/** AppKey 只读环境变量，禁止写死在源码（个人指引：正式 AppKey） */
function getAppKey() {
  const key =
    PAY_ENV === 1
      ? String(process.env.VIRTUAL_PAY_APPKEY_SANDBOX || '').trim()
      : String(process.env.VIRTUAL_PAY_APPKEY || '').trim();
  if (!key) {
    throw new Error(
      PAY_ENV === 1
        ? '未配置环境变量 VIRTUAL_PAY_APPKEY_SANDBOX'
        : '未配置环境变量 VIRTUAL_PAY_APPKEY',
    );
  }
  return key;
}

function hmacSha256Hex(key, message) {
  return crypto.createHmac('sha256', key).update(message, 'utf8').digest('hex');
}

/** 字典序序列化，保证与米大师验签一致 */
function stableStringify(obj) {
  const keys = Object.keys(obj).sort();
  const parts = keys.map((k) => `${JSON.stringify(k)}:${JSON.stringify(obj[k])}`);
  return `{${parts.join(',')}}`;
}

function calcPaySig(uri, postBody, appKey) {
  return hmacSha256Hex(appKey, `${uri}&${postBody}`);
}

function calcUserSig(signData, sessionKey) {
  return hmacSha256Hex(sessionKey, signData);
}

function makeOutTradeNo() {
  const rand = Math.random().toString(36).slice(2, 8);
  const no = `T${Date.now()}${rand}`;
  return no.slice(0, 32);
}

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let raw = '';
        res.on('data', (c) => {
          raw += c;
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(raw));
          } catch (e) {
            reject(new Error(`解析失败: ${raw.slice(0, 200)}`));
          }
        });
      })
      .on('error', reject);
  });
}

function httpsPostJson(url, bodyObj) {
  const body = typeof bodyObj === 'string' ? bodyObj : JSON.stringify(bodyObj);
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => {
          raw += c;
        });
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, data: JSON.parse(raw), raw });
          } catch (e) {
            reject(new Error(`解析失败: ${raw.slice(0, 200)}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function code2Session(jsCode, cloud) {
  if (!jsCode) throw new Error('缺少登录 code');

  try {
    if (cloud && cloud.openapi && cloud.openapi.auth && cloud.openapi.auth.code2Session) {
      const r = await cloud.openapi.auth.code2Session({ jsCode });
      const sessionKey = r.sessionKey || r.session_key;
      if (sessionKey) return { sessionKey, openid: r.openid || r.openId };
    }
  } catch (e) {
    console.warn('openapi code2Session', e.message || e);
  }

  const secret = process.env.WX_APP_SECRET || '';
  if (!secret) {
    throw new Error('无法获取 session_key：请配置云函数环境变量 WX_APP_SECRET，或开通 openapi auth.code2Session');
  }
  const url =
    `https://api.weixin.qq.com/sns/jscode2session?appid=${encodeURIComponent(APPID)}` +
    `&secret=${encodeURIComponent(secret)}&js_code=${encodeURIComponent(jsCode)}&grant_type=authorization_code`;
  const data = await httpsGet(url);
  if (data.errcode) {
    throw new Error(data.errmsg || `code2Session 失败 ${data.errcode}`);
  }
  if (!data.session_key) throw new Error('code2Session 未返回 session_key');
  return { sessionKey: data.session_key, openid: data.openid };
}

async function getAccessToken(cloud) {
  try {
    if (cloud && cloud.openapi && typeof cloud.openapi.getAccessToken === 'function') {
      const r = await cloud.openapi.getAccessToken({});
      const token = r.accessToken || r.access_token;
      if (token) return token;
    }
  } catch (e) {
    console.warn('openapi getAccessToken', e.message || e);
  }

  const ctx = cloud.getWXContext ? cloud.getWXContext() : {};
  if (ctx.ACCESS_TOKEN) return ctx.ACCESS_TOKEN;

  const secret = process.env.WX_APP_SECRET || '';
  if (!secret) throw new Error('缺少 access_token：请配置 WX_APP_SECRET');
  const url =
    `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential` +
    `&appid=${encodeURIComponent(APPID)}&secret=${encodeURIComponent(secret)}`;
  const data = await httpsGet(url);
  if (data.errcode) throw new Error(data.errmsg || `token 失败 ${data.errcode}`);
  return data.access_token;
}

async function ensureUser(db, openid) {
  const ref = db.collection('users').doc(openid);
  try {
    const snap = await ref.get();
    return { ref, data: snap.data || {} };
  } catch (e) {
    const data = {
      openid,
      points: 0,
      vipMonthQuota: 0,
      vipQuotaPeriod: '',
      vipExpireAt: null,
      createdAt: db.serverDate(),
      lastLoginAt: db.serverDate(),
    };
    try {
      await ref.set({ data });
    } catch (err) {
      console.warn('ensureUser', err.message);
    }
    return { ref, data };
  }
}

/**
 * 在事务内发放权益（重复购买叠加）：
 * - vip_days：从 max(现在, 当前到期) 起续期
 * - points：积分累加
 */
function computeGrantPatch(user, type, value) {
  const now = Date.now();
  if (type === 'vip_days') {
    const days = Math.max(1, Number(value) || 1);
    const prevExpire = toMs(user.vipExpireAt);
    const base = Math.max(now, prevExpire);
    const stacked = prevExpire > now;
    const next = dayjs(base).add(days, 'day').toDate();
    return {
      grant: {
        grantType: 'vip_days',
        days,
        vipExpireAt: next.getTime(),
        stacked,
        prevVipExpireAt: prevExpire || null,
      },
      userPatch: { vipExpireAt: next },
    };
  }
  if (type === 'points') {
    const add = Math.max(1, Number(value) || 1);
    return {
      grant: { grantType: 'points', add, stacked: true },
      userPatch: null,
      pointsInc: add,
    };
  }
  throw new Error('不支持的发放类型');
}

/**
 * 幂等发货：事务认领订单；优先按 wx_order_id 全局去重（官方指引）
 */
async function resolveGrantFromOrder(db, orderLike) {
  let grantType = orderLike && orderLike.grantType;
  let grantValue = orderLike && orderLike.grantValue;
  if (grantType && grantValue != null && grantValue !== '') {
    return { grantType, grantValue };
  }
  const live = await resolveLiveProduct(db, {
    productId: orderLike && orderLike.productId,
    planKey: orderLike && orderLike.planKey,
    slotId: orderLike && orderLike.slotId,
  });
  if (live) return { grantType: live.type, grantValue: live.value };
  const productId = orderLike && orderLike.productId;
  const catalog = getProduct(productId);
  if (!catalog) throw new Error(`未知道具 ${productId}`);
  return { grantType: catalog.type, grantValue: catalog.value };
}

async function findDeliveredByWxOrderId(db, wxOrderId) {
  const id = String(wxOrderId || '').trim();
  if (!id) return null;
  try {
    const res = await db
      .collection('orders')
      .where({ wxOrderId: id, status: 'delivered' })
      .limit(1)
      .get();
    return (res.data && res.data[0]) || null;
  } catch (e) {
    return null;
  }
}

async function deliverOrderDirect(db, order, meta = {}, presetGrant = null) {
  const _ = db.command;
  const orderId = order._id || order.id;
  if (!orderId) throw new Error('订单缺少 _id');

  const snap = await db.collection('orders').doc(orderId).get();
  const fresh = (snap && snap.data) || null;
  if (!fresh) throw new Error('订单不存在');
  if (fresh.status === 'delivered') {
    const uref = db.collection('users').doc(fresh.openid);
    const u = (await uref.get()).data || {};
    const synced = await syncVipMonthQuota(uref, u, db.serverDate());
    return {
      ok: true,
      already: true,
      grant: fresh.grant || null,
      entitlement: buildEntitlement(synced),
    };
  }
  if (fresh.status === 'refunded') {
    throw new Error('订单已退款，不可发货');
  }

  let grantType = fresh.grantType || (presetGrant && presetGrant.grantType);
  let grantValue =
    fresh.grantValue != null && fresh.grantValue !== ''
      ? fresh.grantValue
      : presetGrant && presetGrant.grantValue;
  if (!grantType || grantValue == null || grantValue === '') {
    const resolved = await resolveGrantFromOrder(db, { ...fresh, _id: orderId });
    grantType = resolved.grantType;
    grantValue = resolved.grantValue;
  }
  const qty = Math.max(1, Math.floor(Number(meta.quantity || fresh.buyQuantity || order.buyQuantity || 1)));
  grantValue = Number(grantValue) * qty;

  const openid = fresh.openid;
  if (!openid) throw new Error('订单无 openid');
  await ensureUser(db, openid);

  const userRef = db.collection('users').doc(openid);
  const userSnap = await userRef.get();
  const user = (userSnap && userSnap.data) || { openid, points: 0 };
  const computed = computeGrantPatch(user, grantType, grantValue);
  const userData = {
    updatedAt: db.serverDate(),
    ...(computed.userPatch || {}),
  };
  if (computed.pointsInc) {
    userData.points = _.inc(computed.pointsInc);
  }
  await userRef.update({ data: userData });

  const wxOrderId = String(meta.wxOrderId || fresh.wxOrderId || order.wxOrderId || '').trim();
  await db.collection('orders').doc(orderId).update({
    data: {
      status: 'delivered',
      deliveredAt: db.serverDate(),
      wxOrderId: wxOrderId || fresh.wxOrderId || '',
      buyQuantity: qty,
      grant: computed.grant,
      deliverNote: 'direct',
      deliverError: '',
      updatedAt: db.serverDate(),
    },
  });

  const after = (await userRef.get()).data || {};
  const synced = await syncVipMonthQuota(userRef, after, db.serverDate());
  return {
    ok: true,
    already: false,
    grant: computed.grant || null,
    entitlement: buildEntitlement(synced),
  };
}

async function deliverOrder(db, cloud, order, meta = {}) {
  const orderId = order._id || order.id;
  if (!orderId) throw new Error('订单缺少 _id');

  const wxOrderId = String(meta.wxOrderId || order.wxOrderId || '').trim();
  if (wxOrderId) {
    const dup = await findDeliveredByWxOrderId(db, wxOrderId);
    if (dup && String(dup._id) !== String(orderId)) {
      try {
        await db.collection('orders').doc(orderId).update({
          data: {
            status: 'delivered',
            deliveredAt: db.serverDate(),
            wxOrderId,
            grant: dup.grant || null,
            deliverNote: 'dedup_by_wx_order_id',
            updatedAt: db.serverDate(),
          },
        });
      } catch (e) {
        console.warn('dedup mark', e.message || e);
      }
      const uref = db.collection('users').doc(dup.openid || order.openid);
      const u = (await uref.get()).data || {};
      const synced = await syncVipMonthQuota(uref, u, db.serverDate());
      return {
        ok: true,
        already: true,
        grant: dup.grant || null,
        entitlement: buildEntitlement(synced),
      };
    }
  }

  const openidHint = order.openid;
  if (openidHint) await ensureUser(db, openidHint);

  let presetGrant = null;
  try {
    presetGrant = await resolveGrantFromOrder(db, { ...order, _id: orderId });
  } catch (e) {
    console.warn('resolveGrantFromOrder', e.message || e);
  }

  // paid / 补发场景优先走非事务，避免云库事务兼容问题
  try {
    return await deliverOrderDirect(db, { ...order, _id: orderId }, meta, presetGrant);
  } catch (e) {
    console.error('deliverOrderDirect', e.message || e);
    try {
      await db.collection('orders').doc(orderId).update({
        data: {
          deliverError: String(e.message || e).slice(0, 500),
          updatedAt: db.serverDate(),
        },
      });
    } catch (err) {
      /* ignore */
    }
    throw e;
  }
}

/** 退款后回收权益（尽力而为；续费叠加场景按天数回退） */
async function reclaimOrderGrant(db, order) {
  if (!order || !order._id) throw new Error('订单无效');
  if (order.status === 'refunded') {
    return { ok: true, already: true };
  }
  const openid = order.openid;
  if (!openid) throw new Error('订单无 openid');
  await ensureUser(db, openid);
  const grant = order.grant;
  const userRef = db.collection('users').doc(openid);

  if (grant && order.status === 'delivered') {
    const snap = await userRef.get();
    const user = snap.data || {};
    if (grant.grantType === 'points') {
      const add = Math.max(0, Number(grant.add) || 0);
      const nextPts = Math.max(0, Number(user.points || 0) - add);
      await userRef.update({
        data: { points: nextPts, updatedAt: db.serverDate() },
      });
    } else if (grant.grantType === 'vip_days') {
      const days = Math.max(1, Number(grant.days) || 1);
      const cur = toMs(user.vipExpireAt);
      let nextMs = cur;
      if (grant.prevVipExpireAt != null && Number(grant.vipExpireAt) === cur) {
        nextMs = Number(grant.prevVipExpireAt) || 0;
      } else if (cur) {
        nextMs = dayjs(cur).subtract(days, 'day').valueOf();
      }
      const now = Date.now();
      await userRef.update({
        data: {
          vipExpireAt: nextMs > now ? new Date(nextMs) : null,
          updatedAt: db.serverDate(),
        },
      });
    }
  }

  await db.collection('orders').doc(order._id).update({
    data: {
      status: 'refunded',
      refundedAt: db.serverDate(),
      updatedAt: db.serverDate(),
    },
  });
  return { ok: true, already: false };
}

/**
 * 定时/手动：查单补发最近未完结订单
 * @param {{ limit?: number, openid?: string }} opts
 */
async function pollPendingOrders(db, cloud, { limit = 20, openid = '' } = {}) {
  const _ = db.command;
  const since = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  const uid = String(openid || '').trim();
  let list = [];
  const baseWhere = {
    status: _.in(['pending', 'paid']),
    createdAt: _.gte(since),
  };
  if (uid) baseWhere.openid = uid;

  try {
    const res = await db
      .collection('orders')
      .where(baseWhere)
      .orderBy('createdAt', 'asc')
      .limit(Math.min(50, Math.max(1, limit)))
      .get();
    list = res.data || [];
  } catch (e) {
    // 无索引时降级：只按状态（+ openid）
    const fallbackWhere = { status: _.in(['pending', 'paid']) };
    if (uid) fallbackWhere.openid = uid;
    const res = await db
      .collection('orders')
      .where(fallbackWhere)
      .limit(Math.min(50, Math.max(1, limit)))
      .get();
    list = (res.data || []).filter((o) => {
      const t = o.createdAt && (o.createdAt.getTime ? o.createdAt.getTime() : +new Date(o.createdAt));
      return !t || t >= since.getTime();
    });
  }

  const results = [];
  for (const order of list) {
    const orderId = order._id || order.id;
    try {
      if (!order.openid || !order.outTradeNo || !orderId) {
        results.push({ outTradeNo: order.outTradeNo, ok: false, message: '缺字段' });
        continue;
      }

      const alreadyPaidLocal = order.status === 'paid';
      let queryRes = null;
      let paid = alreadyPaidLocal;

      // 本地已是 paid：不再依赖微信查单，直接发货
      if (!alreadyPaidLocal) {
        try {
          queryRes = await queryOrderPaid(cloud, {
            openid: order.openid,
            outTradeNo: order.outTradeNo,
          });
          if (isOrderPaid(queryRes)) paid = true;
        } catch (e) {
          results.push({
            outTradeNo: order.outTradeNo,
            ok: false,
            message: e.message || '查单失败',
          });
          continue;
        }
        if (!paid) {
          results.push({ outTradeNo: order.outTradeNo, ok: true, paid: false });
          continue;
        }
        const wxOrderId =
          (queryRes && (queryRes.wx_order_id || queryRes.wxOrderId)) || order.wxOrderId || '';
        await db.collection('orders').doc(orderId).update({
          data: {
            status: 'paid',
            wxOrderId: wxOrderId || order.wxOrderId || '',
            querySnapshot: queryRes || null,
            updatedAt: db.serverDate(),
          },
        });
      }

      const wxOrderId =
        (queryRes && (queryRes.wx_order_id || queryRes.wxOrderId)) || order.wxOrderId || '';
      const delivered = await deliverOrder(
        db,
        cloud,
        { ...order, _id: orderId },
        { wxOrderId },
      );
      results.push({
        outTradeNo: order.outTradeNo,
        ok: true,
        paid: true,
        delivered: true,
        already: !!delivered.already,
        grant: delivered.grant || null,
        entitlement: delivered.entitlement || null,
        message: delivered.already ? '已到账' : '补发成功',
      });
    } catch (e) {
      console.error('pollPending deliver', order.outTradeNo, e.message || e);
      results.push({
        outTradeNo: order.outTradeNo,
        ok: false,
        message: e.message || '补发失败',
      });
    }
  }
  return { ok: true, scanned: list.length, results };
}

async function queryOrderPaid(cloud, { openid, outTradeNo }) {
  const appKey = getAppKey();
  if (!appKey) throw new Error('未配置 VIRTUAL_PAY_APPKEY / VIRTUAL_PAY_APPKEY_SANDBOX');

  const bodyObj = {
    openid,
    env: PAY_ENV,
    order_id: outTradeNo,
  };
  const postBody = stableStringify(bodyObj);
  const paySig = calcPaySig('/xpay/query_order', postBody, appKey);
  const token = await getAccessToken(cloud);
  const url =
    `https://api.weixin.qq.com/xpay/query_order?access_token=${encodeURIComponent(token)}` +
    `&pay_sig=${encodeURIComponent(paySig)}`;
  const { data } = await httpsPostJson(url, postBody);
  return data;
}

function isOrderPaid(queryRes) {
  if (!queryRes) return false;
  // 兼容多种返回：errcode=0 且状态为已支付
  if (queryRes.errcode && queryRes.errcode !== 0) return false;
  const status =
    queryRes.order_state ??
    queryRes.orderState ??
    (queryRes.order && (queryRes.order.status || queryRes.order.order_state));
  // 文档常见：0 初始 1 订单中 2 订单失败 3 订单支付成功待发货/已发货 等；宽松判断
  if (status === 3 || status === 4 || status === 'PAY_SUCCESS' || status === 'paid') return true;
  if (queryRes.paid === true || queryRes.is_paid === true) return true;
  const payState = queryRes.pay_state ?? queryRes.payState;
  if (payState === 1 || payState === 'SUCCESS') return true;
  // 部分返回在 WeChatPayInfo / left
  const left = queryRes.left || 0;
  if (queryRes.errcode === 0 && queryRes.wx_order_id && left === undefined) {
    // 有平台单号且无错误时，交由调用方结合业务判断；此处不默认已支付
  }
  if (queryRes.errcode === 0 && (queryRes.wx_order_id || queryRes.order_id)) {
    const s = Number(status);
    if (!Number.isNaN(s) && s >= 3) return true;
  }
  return false;
}

function grantMessage(grant) {
  if (!grant) return '已到账';
  if (grant.grantType === 'vip_days') {
    return grant.stacked
      ? `已续期 ${grant.days} 天（在原到期日上叠加）`
      : `已开通包月 ${grant.days} 天`;
  }
  if (grant.grantType === 'points') {
    return `已到账 ${grant.add} 积分`;
  }
  return '权益已到账';
}

module.exports = {
  APPID,
  OFFER_ID,
  PAY_ENV,
  getAppKey,
  stableStringify,
  calcPaySig,
  calcUserSig,
  makeOutTradeNo,
  code2Session,
  getAccessToken,
  ensureUser,
  deliverOrder,
  reclaimOrderGrant,
  pollPendingOrders,
  findDeliveredByWxOrderId,
  queryOrderPaid,
  isOrderPaid,
  getProduct,
  grantMessage,
};
