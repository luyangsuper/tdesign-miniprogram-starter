import { callFunction } from '~/utils/cloud';
import { setCachedEntitlement } from '~/utils/entitlement';
import { getAppBaseInfoSafe, getDeviceInfoSafe } from '~/utils/systemInfo';

function compareVersion(v1, v2) {
  const a = String(v1 || '')
    .split('.')
    .map((n) => parseInt(n, 10) || 0);
  const b = String(v2 || '')
    .split('.')
    .map((n) => parseInt(n, 10) || 0);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

function canUseVirtualPay() {
  try {
    const info = getAppBaseInfoSafe();
    if (compareVersion(info.SDKVersion, '2.19.2') >= 0) return true;
  } catch (e) {
    /* ignore */
  }
  return typeof wx.canIUse === 'function' && wx.canIUse('requestVirtualPayment');
}

function checkIosWechatVersion() {
  try {
    const device = getDeviceInfoSafe();
    const info = getAppBaseInfoSafe();
    if (device.platform !== 'ios') return true;
    const cur = String(info.version || '')
      .split('.')
      .map((n) => parseInt(n, 10) || 0);
    const minVer = [8, 0, 68];
    for (let i = 0; i < 3; i += 1) {
      if ((cur[i] || 0) > minVer[i]) return true;
      if ((cur[i] || 0) < minVer[i]) {
        wx.showModal({
          title: '提示',
          content: '请将微信更新至 8.0.68 及以上后再支付',
          showCancel: false,
        });
        return false;
      }
    }
    return true;
  } catch (e) {
    return true;
  }
}

function wxLoginCode() {
  return new Promise((resolve, reject) => {
    wx.login({
      success: (res) => {
        if (res.code) resolve(res.code);
        else reject(new Error('wx.login 无 code'));
      },
      fail: (err) => reject(err || new Error('wx.login 失败')),
    });
  });
}

function requestVirtualPayment(pay) {
  return new Promise((resolve, reject) => {
    if (!canUseVirtualPay()) {
      reject(new Error('当前微信版本不支持虚拟支付，请升级微信'));
      return;
    }
    wx.requestVirtualPayment({
      mode: pay.mode || 'short_series_goods',
      signData: pay.signData,
      paySig: pay.paySig,
      signature: pay.signature,
      success: (res) => resolve(res),
      fail: (err) => {
        const msg = (err && (err.errMsg || err.message)) || '支付失败';
        const code = err && err.errCode;
        const e = new Error(msg);
        e.errCode = code;
        if (code === -2 || /cancel/i.test(msg)) e.code = 'CANCEL';
        reject(e);
      },
    });
  });
}

async function fetchDeliveredStatus(outTradeNo) {
  const st = await callFunction('createVirtualOrder', { action: 'status', outTradeNo });
  if (st.order && st.order.status === 'delivered') {
    if (st.entitlement) setCachedEntitlement(st.entitlement);
    return {
      ok: true,
      delivered: true,
      already: true,
      message: st.message || '已到账',
      entitlement: st.entitlement,
      grant: st.grant,
    };
  }
  return null;
}

async function pollDelivered(outTradeNo, { forceAfterClientSuccess = false, tries = 12 } = {}) {
  let lastErr = null;
  for (let i = 0; i < tries; i += 1) {
    try {
      const res = await callFunction('createVirtualOrder', {
        action: 'confirm',
        outTradeNo,
        forceAfterClientSuccess: forceAfterClientSuccess && i === 0,
      });
      if (res.entitlement) setCachedEntitlement(res.entitlement);
      if (res.delivered || res.already) return res;
    } catch (err) {
      lastErr = err;
      try {
        const done = await fetchDeliveredStatus(outTradeNo);
        if (done) return done;
      } catch (e2) {
        /* ignore */
      }
      if (i < tries - 1) {
        await new Promise((r) => setTimeout(r, 700 + i * 350));
        continue;
      }
    }
  }
  try {
    const done = await fetchDeliveredStatus(outTradeNo);
    if (done) return done;
  } catch (e) {
    /* ignore */
  }
  if (lastErr) throw lastErr;
  const err = new Error('支付成功，权益到账稍慢，请稍后下拉刷新「我的」');
  err.code = 'DELIVER_PENDING';
  throw err;
}

/**
 * 购买套餐：下单 → 拉起虚拟支付 → 确认发货
 */
export async function buyPlan(plan) {
  if (!checkIosWechatVersion()) {
    const err = new Error('微信版本过低');
    err.code = 'IOS_VERSION';
    throw err;
  }
  const code = await wxLoginCode();
  const created = await callFunction('createVirtualOrder', {
    action: 'create',
    slotId: plan.slotId || '',
    planKey: plan.planKey || plan.key,
    productId: plan.productId,
    code,
  });
  const { pay, order } = created;
  try {
    await requestVirtualPayment(pay);
  } catch (err) {
    if (err && err.code === 'CANCEL') throw err;
    throw err;
  }
  return pollDelivered(order.outTradeNo, { forceAfterClientSuccess: true });
}

/**
 * 手动补发当前用户未完结订单（「我的」页「补发权益」）
 */
export async function recoverMyPendingOrders() {
  const res = await callFunction('createVirtualOrder', { action: 'recoverMine' });
  const results = (res && res.results) || [];
  const deliveredRows = results.filter((r) => r && r.ok && r.delivered);
  const failedRows = results.filter((r) => r && r.ok === false);
  let entitlement = null;
  let message = '';
  deliveredRows.forEach((r) => {
    if (r.entitlement) entitlement = r.entitlement;
    if (r.grant && !message) {
      if (r.grant.grantType === 'points') message = `已补发 ${r.grant.add} 积分`;
      else if (r.grant.grantType === 'vip_days') message = `已补发包月 ${r.grant.days} 天`;
    }
  });
  if (entitlement) setCachedEntitlement(entitlement);
  const failMsg = failedRows.length
    ? String(failedRows[0].message || '补发失败').slice(0, 40)
    : '';
  const scanned = (res && res.scanned) || 0;
  return {
    delivered: deliveredRows.length,
    failed: failedRows.length,
    scanned,
    entitlement,
    message:
      message ||
      (deliveredRows.length
        ? '权益已补发到账'
        : scanned
          ? res.message || `已检查 ${scanned} 笔`
          : res.message || '未找到待补发订单'),
    errorMessage: failMsg,
    results,
  };
}

export { canUseVirtualPay };
