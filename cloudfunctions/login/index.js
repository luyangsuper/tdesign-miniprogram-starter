const cloud = require('wx-server-sdk');
const { buildEntitlement, syncVipMonthQuota } = require('./membership');

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

async function getOrCreateUser(openid, isAdmin) {
  const ref = db.collection('users').doc(openid);
  try {
    const snap = await ref.get();
    const data = snap.data || {};
    const patch = {
      isAdmin,
      lastLoginAt: db.serverDate(),
    };
    if (typeof data.points !== 'number') patch.points = 0;
    await ref.update({ data: patch });
    return syncVipMonthQuota(ref, { ...data, ...patch }, db.serverDate());
  } catch (e) {
    const blank = {
      openid,
      isAdmin,
      nickName: '',
      avatarFileID: '',
      points: 0,
      vipMonthQuota: 0,
      vipQuotaPeriod: '',
      vipExpireAt: null,
      lastLoginAt: db.serverDate(),
      createdAt: db.serverDate(),
    };
    try {
      await ref.set({ data: blank });
    } catch (err) {
      console.warn('users create skip', err.message);
    }
    return blank;
  }
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
    return {
      ok: true,
      openid: OPENID,
      isAdmin,
      nickName: user.nickName || '',
      avatarFileID: user.avatarFileID || '',
      avatarUrl,
      entitlement: buildEntitlement(user),
    };
  }

  // 静默登录：拿 openid + 已存资料 + 权益
  let user = {};
  try {
    user = await getOrCreateUser(OPENID, isAdmin);
  } catch (e) {
    console.warn('users upsert skip', e.message);
  }

  const avatarUrl = await resolveAvatarUrl(user.avatarFileID || '');

  return {
    ok: true,
    openid: OPENID,
    isAdmin,
    nickName: user.nickName || '',
    avatarFileID: user.avatarFileID || '',
    avatarUrl,
    entitlement: buildEntitlement(user),
  };
};
