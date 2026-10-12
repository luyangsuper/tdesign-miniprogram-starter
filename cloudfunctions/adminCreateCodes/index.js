const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

const FALLBACK_ADMINS = ['oOtg0xqcOEHgBAL7u3M7g9S8ln2c'];

function getAdminList() {
  const fromEnv = process.env.ADMIN_OPENIDS || '';
  if (fromEnv.trim()) {
    return fromEnv.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return FALLBACK_ADMINS;
}

function assertAdmin(openid) {
  const admins = getAdminList();
  if (!admins.length) return true;
  return admins.includes(openid);
}

function randomCode(len = 8) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < len; i += 1) {
    s += chars[Math.floor(Math.random() * chars.length)];
  }
  // XXXX-XXXX
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

/**
 * event:
 * - type: vip_days | points
 * - value: 天数或积分数
 * - count: 生成数量 1~50
 * - note: 备注
 */
exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) {
    return { ok: false, code: 'NO_OPENID', message: '请先登录' };
  }
  if (!assertAdmin(OPENID)) {
    return { ok: false, code: 'FORBIDDEN', message: '无管理员权限' };
  }

  const type = String(event.type || '').trim();
  const value = Number(event.value);
  const count = Math.min(50, Math.max(1, Number(event.count) || 1));
  const note = String(event.note || '').trim().slice(0, 80);

  if (type !== 'vip_days' && type !== 'points') {
    return { ok: false, code: 'BAD_PARAM', message: 'type 须为 vip_days 或 points' };
  }
  const maxValue = type === 'points' ? 99999 : 3650;
  if (!value || value < 1 || value > maxValue) {
    return { ok: false, code: 'BAD_PARAM', message: 'value 无效' };
  }

  const codes = [];
  for (let i = 0; i < count; i += 1) {
    let code = randomCode();
    // 简单避撞：再试一次
    // eslint-disable-next-line no-await-in-loop
    const exists = await db.collection('redeem_codes').where({ code }).limit(1).get();
    if ((exists.data || []).length) code = randomCode(10).replace(/(.{4})(.{4}).*/, '$1-$2');

    const doc = {
      code,
      type,
      value,
      status: 'unused',
      maxUses: 1,
      useCount: 0,
      usedBy: '',
      usedAt: null,
      note,
      createdBy: OPENID,
      createdAt: db.serverDate(),
    };
    // eslint-disable-next-line no-await-in-loop
    await db.collection('redeem_codes').add({ data: doc });
    codes.push(code);
  }

  return {
    ok: true,
    data: {
      type,
      value,
      count: codes.length,
      codes,
      label: type === 'vip_days' ? `包月会员 ${value} 天` : `积分 ${value}`,
    },
  };
};
