const cloud = require('wx-server-sdk');
const { buildEntitlement, syncVipMonthQuota } = require('./membership');
const { code2Session, saveSessionKey } = require('./session');
const { getPointsSettings } = require('./pointsSettings');
const { getPricingDoc, listLiveProducts } = require('./pricingSettings');
const { recordPointsLog } = require('./pointsLog');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

/** 管理员 openid，与小程序 config.js 保持一致；也可用云开发环境变量 ADMIN_OPENIDS（逗号分隔）覆盖 */
const FALLBACK_ADMINS = ['oOtg0xqcOEHgBAL7u3M7g9S8ln2c'];

function getAdminList() {
  const fromEnv = process.env.ADMIN_OPENIDS || '';
  if (fromEnv.trim()) {
    return fromEnv.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return FALLBACK_ADMINS;
}

async function resolveAvatarUrl(fileID) {
  if (!fileID) return '';
  try {
    const res = await cloud.getTempFileURL({ fileList: [fileID] });
    const item = (res.fileList || [])[0];
    return (item && item.tempFileURL) || '';
  } catch (e) {
    console.warn('getTempFileURL fail', e.message);
    return '';
  }
}

/**
 * 见面礼只发一次（welcomeGiftAt 幂等）。
 * 其他云函数若抢先建档（points:0 且无 welcomeGiftAt），此处补发，避免新用户拿不到积分。
 * @returns {{ user: object, welcomeGift: null|{ points: number } }}
 */
async function getOrCreateUser(openid, isAdmin) {
  const ref = db.collection('users').doc(openid);
  const _ = db.command;
  const settings = await getPointsSettings(db);
  const giftPoints = Math.max(0, Number(settings.welcomeGiftPoints) || 0);

  let data = null;
  try {
    data = (await ref.get()).data || {};
  } catch (e) {
    data = null;
  }

  if (!data) {
    const blank = {
      openid,
      isAdmin,
      nickName: '',
      avatarFileID: '',
      points: giftPoints,
      vipMonthQuota: 0,
      vipQuotaPeriod: '',
      vipExpireAt: null,
      lastLoginAt: db.serverDate(),
      createdAt: db.serverDate(),
    };
    if (giftPoints > 0) {
      blank.welcomeGiftAt = db.serverDate();
      blank.welcomeGiftPoints = giftPoints;
    }
    try {
      await ref.set({ data: blank });
      const synced = await syncVipMonthQuota(ref, blank, db.serverDate());
      if (giftPoints > 0) {
        await recordPointsLog(db, {
          openid,
          delta: giftPoints,
          balance: giftPoints,
          reason: 'welcome',
          title: '新用户见面礼',
        });
      }
      return {
        user: synced,
        welcomeGift: giftPoints > 0 ? { points: giftPoints } : null,
      };
    } catch (err) {
      console.warn('users create skip', err.message);
      // 并发建档：重读后走补发逻辑
      try {
        data = (await ref.get()).data || {};
      } catch (err2) {
        return { user: blank, welcomeGift: null };
      }
    }
  }

  const patch = {
    isAdmin,
    lastLoginAt: db.serverDate(),
  };
  let welcomeGift = null;
  const alreadyGifted = !!data.welcomeGiftAt;
  if (!alreadyGifted && giftPoints > 0) {
    // 补发：占位建档常把 points 写成 0，用 inc 叠加上去更安全
    if (typeof data.points !== 'number') {
      patch.points = giftPoints;
    } else {
      patch.points = _.inc(giftPoints);
    }
    patch.welcomeGiftAt = db.serverDate();
    patch.welcomeGiftPoints = giftPoints;
    welcomeGift = { points: giftPoints };
  } else if (typeof data.points !== 'number') {
    patch.points = 0;
  }

  await ref.update({ data: patch });
  let fresh = { ...data };
  try {
    fresh = (await ref.get()).data || fresh;
  } catch (e) {
    if (welcomeGift) {
      fresh.points = Math.max(0, Number(data.points) || 0) + giftPoints;
      fresh.welcomeGiftAt = patch.welcomeGiftAt;
      fresh.welcomeGiftPoints = giftPoints;
    }
  }
  if (welcomeGift && giftPoints > 0) {
    await recordPointsLog(db, {
      openid,
      delta: giftPoints,
      balance: Math.max(0, Number(fresh.points) || 0),
      reason: 'welcome',
      title: '新用户见面礼',
    });
  }
  const synced = await syncVipMonthQuota(ref, fresh, db.serverDate());
  return { user: synced, welcomeGift };
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) {
    return { ok: false, code: 'NO_OPENID', message: '无法获取用户身份' };
  }

  const admins = getAdminList();
  const isAdmin = admins.length ? admins.includes(OPENID) : true;

  // 更新昵称 / 头像（微信不允许静默拉取，须用户点选后写入）
  if (event.action === 'updateProfile') {
    const patch = {
      updatedAt: db.serverDate(),
      lastLoginAt: db.serverDate(),
      isAdmin,
    };
    if (typeof event.nickName === 'string') {
      patch.nickName = event.nickName.trim().slice(0, 32);
    }
    if (typeof event.avatarFileID === 'string' && event.avatarFileID) {
      patch.avatarFileID = event.avatarFileID;
    }

    const ref = db.collection('users').doc(OPENID);
    try {
      await ref.update({ data: patch });
    } catch (e) {
      await ref.set({
        data: {
          openid: OPENID,
          nickName: '',
          avatarFileID: '',
          createdAt: db.serverDate(),
          ...patch,
        },
      });
    }

    let user = {};
    try {
      user = (await ref.get()).data || {};
      user = await syncVipMonthQuota(ref, user, db.serverDate());
    } catch (err) {
      user = patch;
    }
    const avatarUrl = await resolveAvatarUrl(user.avatarFileID || '');
    let pricingProducts = null;
    try {
      pricingProducts = listLiveProducts(await getPricingDoc(db));
    } catch (err) {
      /* ignore */
    }
    return {
      ok: true,
      openid: OPENID,
      isAdmin,
      nickName: user.nickName || '',
      avatarFileID: user.avatarFileID || '',
      avatarUrl,
      entitlement: buildEntitlement(user),
      pricingProducts,
    };
  }

  // 静默登录：拿 openid + 已存资料 + 权益
  let user = {};
  let welcomeGift = null;
  try {
    const created = await getOrCreateUser(OPENID, isAdmin);
    user = created.user || {};
    welcomeGift = created.welcomeGift || null;
  } catch (e) {
    console.warn('users upsert skip', e.message);
  }

  // 可选：前端传入 wx.login code，缓存 session_key 供虚拟支付签名
  if (event.code) {
    try {
      const { sessionKey } = await code2Session(String(event.code), cloud);
      await saveSessionKey(db, OPENID, sessionKey);
    } catch (e) {
      console.warn('login session cache', e.message || e);
    }
  }

  const avatarUrl = await resolveAvatarUrl(user.avatarFileID || '');
  const pendingPointGifts = Array.isArray(user.pendingPointGifts)
    ? user.pendingPointGifts.slice(0, 50)
    : [];
  const now = Date.now();
  // 已过开奖点的邀请不再下发（未参与者开奖后不应再弹）
  const pendingLotteryInvites = (
    Array.isArray(user.pendingLotteryInvites) ? user.pendingLotteryInvites : []
  )
    .filter((g) => {
      if (!g || !g.lotteryId) return false;
      const drawAt = Number(g.drawAt) || 0;
      return !(drawAt > 0 && drawAt <= now);
    })
    .slice(0, 20);
  let pricingProducts = null;
  try {
    pricingProducts = listLiveProducts(await getPricingDoc(db));
  } catch (err) {
    /* ignore */
  }
  return {
    ok: true,
    openid: OPENID,
    isAdmin,
    nickName: user.nickName || '',
    avatarFileID: user.avatarFileID || '',
    avatarUrl,
    entitlement: buildEntitlement(user),
    welcomeGift,
    pendingPointGifts,
    pendingLotteryInvites,
    pricingProducts,
    // 开奖结果不在此返回：只走 userLottery.pending（校验已参与）
  };
};
