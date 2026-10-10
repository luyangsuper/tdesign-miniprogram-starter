const crypto = require('crypto');
const https = require('https');
const { getProduct } = require('./products');
const { buildEntitlement, syncVipMonthQuota } = require('./membership');
const { toMs, dayjs } = require('./time');

const APPID = process.env.WX_APPID || 'wxc53da678dce0b8d1';
/** 沙箱 OfferId；现网一般相同，可用 VIRTUAL_PAY_OFFER_ID 覆盖 */
const OFFER_ID = String(process.env.VIRTUAL_PAY_OFFER_ID || '1450673547');
/** 0 现网 / 1 沙箱；默认现网 */
const PAY_ENV = Number(process.env.VIRTUAL_PAY_ENV != null ? process.env.VIRTUAL_PAY_ENV : 0);

function getAppKey() {
  const sandbox =
    process.env.VIRTUAL_PAY_APPKEY_SANDBOX || 'SiNAFgrJGD027zQ34tGikX58CEVI9i8B';
  const prod = process.env.VIRTUAL_PAY_APPKEY || 'IzKEvNsBSs8aicwCILZbmScWMAkL2QGn';
  if (PAY_ENV === 1) return sandbox;
  return prod;
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
  if (type === 'points' || type === 'quota') {
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
 * 幂等发货：事务认领订单，同一 outTradeNo 只发一次；多笔订单各自叠加权益
 */
async function deliverOrder(db, cloud, order, meta = {}) {
  const _ = db.command;
  const orderId = order._id;
  if (!orderId) throw new Error('订单缺少 _id');

  // 确保用户文档存在（事务外创建）
  const openidHint = order.openid;
  if (openidHint) await ensureUser(db, openidHint);

  const txResult = await db.runTransaction(async (transaction) => {
    const orderRef = db.collection('orders').doc(orderId);
    const orderSnap = await transaction.get(orderRef);
    const fresh = orderSnap.data;
    if (!fresh) throw new Error('订单不存在');
    if (fresh.status === 'delivered') {
      return { already: true, openid: fresh.openid, productId: fresh.productId };
    }

    const product = getProduct(fresh.productId);
    if (!product) throw new Error(`未知道具 ${fresh.productId}`);

    const openid = fresh.openid;
    const userRef = db.collection('users').doc(openid);
    const userSnap = await transaction.get(userRef);
    const user = userSnap.data || { openid, points: 0 };

    const computed = computeGrantPatch(user, product.type, product.value);
    const userData = {
      updatedAt: db.serverDate(),
      ...(computed.userPatch || {}),
    };
    if (computed.pointsInc) {
      userData.points = _.inc(computed.pointsInc);
    }
    transaction.update(userRef, { data: userData });

    transaction.update(orderRef, {
      data: {
        status: 'delivered',
        deliveredAt: db.serverDate(),
        wxOrderId: meta.wxOrderId || fresh.wxOrderId || '',
        grant: computed.grant,
        updatedAt: db.serverDate(),
      },
    });

    return {
      already: false,
      openid,
      grant: computed.grant,
      productId: product.productId,
    };
  });

  const userRef = db.collection('users').doc(txResult.openid);
  const after = (await userRef.get()).data || {};
  const synced = await syncVipMonthQuota(userRef, after, db.serverDate());
  return {
    ok: true,
    already: !!txResult.already,
    grant: txResult.grant || null,
    entitlement: buildEntitlement(synced),
  };
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
  queryOrderPaid,
  isOrderPaid,
  getProduct,
  grantMessage,
};
