const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

/** 与 config.js / 其它云函数保持一致 */
const FALLBACK_ADMINS = ['oOtg0xqcOEHgBAL7u3M7g9S8ln2c'];

function getAdminList() {
  const fromEnv = process.env.ADMIN_OPENIDS || '';
  if (fromEnv.trim()) {
    return fromEnv.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return FALLBACK_ADMINS;
}

function isAdmin(openid) {
  return getAdminList().includes(openid);
}

/**
 * type → 用户文档字段
 * newPack | feedback | lotteryInvite | lotteryWin
 */
function creditFields(type) {
  if (type === 'feedback') {
    return {
      creditsKey: 'feedbackNotifyCredits',
      atKey: 'feedbackNotifyAt',
    };
  }
  if (type === 'lotteryInvite') {
    return {
      creditsKey: 'lotteryInviteNotifyCredits',
      atKey: 'lotteryInviteNotifyAt',
    };
  }
  if (type === 'lotteryWin') {
    return {
      creditsKey: 'lotteryWinNotifyCredits',
      atKey: 'lotteryWinNotifyAt',
    };
  }
  return {
    creditsKey: 'newPackNotifyCredits',
    atKey: 'newPackNotifyAt',
  };
}

function normalizeType(raw) {
  const t = String(raw || 'newPack');
  if (t === 'feedback' || t === 'lotteryInvite' || t === 'lotteryWin') return t;
  return 'newPack';
}

/**
 * 一次性模板每同意一次 +1 次发送额度
 * action: record | status
 * type: newPack | feedback | lotteryInvite | lotteryWin
 */
exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) {
    return { ok: false, code: 'NO_OPENID', message: '请先登录' };
  }

  const action = event.action || 'status';
  const type = normalizeType(event.type);
  const { creditsKey, atKey } = creditFields(type);
  const ref = db.collection('users').doc(OPENID);

  if (type === 'feedback' && !isAdmin(OPENID)) {
    return { ok: false, code: 'FORBIDDEN', message: '仅管理员可订阅反馈通知' };
  }

  try {
    if (action === 'record') {
      const accepted = !!event.accepted;
      if (!accepted) {
        return { ok: true, data: { credits: 0, skipped: true, type } };
      }
      let credits = 0;
      try {
        const snap = await ref.get();
        credits = Math.max(0, Number((snap.data || {})[creditsKey]) || 0);
      } catch (e) {
        await ref.set({
          data: {
            openid: OPENID,
            [creditsKey]: 1,
            updatedAt: db.serverDate(),
          },
        });
        return { ok: true, data: { credits: 1, type } };
      }
      credits += 1;
      await ref.update({
        data: {
          [creditsKey]: credits,
          [atKey]: db.serverDate(),
          updatedAt: db.serverDate(),
        },
      });
      return { ok: true, data: { credits, type } };
    }

    // status
    try {
      const snap = await ref.get();
      const credits = Math.max(0, Number((snap.data || {})[creditsKey]) || 0);
      return { ok: true, data: { credits, type } };
    } catch (e) {
      return { ok: true, data: { credits: 0, type } };
    }
  } catch (e) {
    console.error(e);
    return { ok: false, code: 'SUBSCRIBE_FAIL', message: e.message || '订阅失败' };
  }
};
