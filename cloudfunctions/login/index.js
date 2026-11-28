const cloud = require('wx-server-sdk');
const { buildEntitlement, syncVipMonthQuota } = require('./membership');
const { code2Session, saveSessionKey } = require('./session');
const { getPointsSettings } = require('./pointsSettings');
const { getPricingDoc, listLiveProducts } = require('./pricingSettings');
const { recordPointsLog } = require('./pointsLog');
const { randomNickFromSeed, resolveNickName } = require('./randomNick');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

/** 管理员 openid，与小程序 config.js 保持一致；也可用云开发环境变量 ADMIN_OPENIDS（逗号分隔）覆盖 */
const FALLBACK_ADMINS = ['oOtg0xqcOEHgBAL7u3M7g9S8ln2c'];

function getAdminList() {
  const fromEnv = process.env.ADMIN_OPENIDS || '';
  if (fromEnv.trim()) {
    const list = fromEnv.split(',').map((s) => s.trim()).filter(Boolean);
    // 环境变量写了但解析为空（如只有逗号）时回退名单，避免误判
    if (list.length) return list;
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
    const autoNick = randomNickFromSeed(openid);
    const blank = {
      openid,
      isAdmin,
      nickName: autoNick,
      nickAuto: true,
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
      const synced = await syncVipMonthQuota(ref, blank, db.serverDate(), db);
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
  // 老用户未设昵称：登录时补一个稳定随机名（同 openid 不变）
  if (!String(data.nickName || '').trim()) {
    patch.nickName = randomNickFromSeed(openid);
    patch.nickAuto = true;
  }
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
  const synced = await syncVipMonthQuota(ref, fresh, db.serverDate(), db);
  return { user: synced, welcomeGift };
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) {
    return { ok: false, code: 'NO_OPENID', message: '无法获取用户身份' };
  }

  const admins = getAdminList();
  // 名单为空 → 无人是管理员（勿默认 true，否则全员看到管理台）
  const isAdmin = !!OPENID && admins.includes(OPENID);

  // 更新昵称 / 头像（微信不允许静默拉取，须用户点选后写入）
  if (event.action === 'updateProfile') {
    const patch = {
      updatedAt: db.serverDate(),
      lastLoginAt: db.serverDate(),
      isAdmin,
    };
    if (typeof event.nickName === 'string') {
      const nextNick = event.nickName.trim().slice(0, 32);
      if (nextNick) {
        patch.nickName = nextNick;
        patch.nickAuto = false;
      } else {
        patch.nickName = randomNickFromSeed(OPENID);
        patch.nickAuto = true;
      }
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
          nickName: randomNickFromSeed(OPENID),
          nickAuto: true,
          avatarFileID: '',
          createdAt: db.serverDate(),
          ...patch,
        },
      });
    }

    let user = {};
    try {
      user = (await ref.get()).data || {};
      user = await syncVipMonthQuota(ref, user, db.serverDate(), db);
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
    let downloadCosts = null;
    let costBeadExport = null;
    let costBeadAdvanced = null;
    let costImageExport = null;
    try {
      const settings = await getPointsSettings(db);
      downloadCosts = {
        static: settings.costStatic,
        anim: settings.costAnim,
        wallpaper: settings.costWallpaper,
        avatar: settings.costAvatar,
        video: settings.costVideo,
        libraryAnim: settings.costLibraryAnim || 4,
        libraryStatic: settings.costLibraryStatic || 2,
      };
      costBeadExport = settings.costBeadExport;
      costBeadAdvanced = settings.costBeadAdvanced;
      costImageExport = settings.costImageExport;
    } catch (e) {
      /* ignore */
    }
    return {
      ok: true,
      openid: OPENID,
      isAdmin,
      nickName: resolveNickName(user, OPENID),
      avatarFileID: user.avatarFileID || '',
      avatarUrl,
      entitlement: buildEntitlement(user),
      pricingProducts,
      downloadCosts,
      costBeadExport,
      costBeadAdvanced,
      costImageExport,
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
  let downloadCosts = null;
  let costBeadExport = null;
  let costBeadAdvanced = null;
  let costImageExport = null;
  try {
    const settings = await getPointsSettings(db);
    downloadCosts = {
      static: settings.costStatic,
      anim: settings.costAnim,
      wallpaper: settings.costWallpaper,
      avatar: settings.costAvatar,
      video: settings.costVideo,
      libraryAnim: settings.costLibraryAnim || 4,
      libraryStatic: settings.costLibraryStatic || 2,
    };
    costBeadExport = settings.costBeadExport;
    costBeadAdvanced = settings.costBeadAdvanced;
    costImageExport = settings.costImageExport;
  } catch (e) {
    /* ignore */
  }
  // 登录时同步卸下已失效的会员框（付费/成就框不动）
  let avatarFrameId = String(user.avatarFrameId || '').trim();
  const entitlement = buildEntitlement(user);
  if (avatarFrameId && !entitlement.isVip) {
    try {
      const fs = await db.collection('avatar_frames').doc(avatarFrameId).get();
      let f = (fs && fs.data) || {};
      if (f.data && typeof f.data === 'object' && f.data.fileID) f = f.data;
      if (String(f.access || '') === 'vip') {
        await db.collection('users').doc(OPENID).update({
          data: { avatarFrameId: '', updatedAt: db.serverDate() },
        });
        avatarFrameId = '';
        user = { ...user, avatarFrameId: '' };
      }
    } catch (e) {
      console.warn('[login] clear vip frame', e.message || e);
    }
  }

  // 懒同步成就（不阻塞登录返回；sync 内也会再清一次无效佩戴）
  cloud
    .callFunction({
      name: 'userAchievement',
      data: { action: 'sync', targetOpenid: OPENID },
    })
    .catch((e) => console.warn('[achievement] sync', e.message || e));

  return {
    ok: true,
    openid: OPENID,
    isAdmin,
    nickName: resolveNickName(user, OPENID),
    avatarFileID: user.avatarFileID || '',
    avatarUrl,
    avatarFrameId,
    entitlement,
    welcomeGift,
    pendingPointGifts,
    pendingLotteryInvites,
    pricingProducts,
    downloadCosts,
    costBeadExport,
    costBeadAdvanced,
    costImageExport,
    // 开奖结果不在此返回：只走 userLottery.pending（校验已参与）
  };
};
