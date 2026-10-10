const cloud = require('wx-server-sdk');
const { dayjs, toMs } = require('./time');
const { MONTHLY_QUOTA, buildEntitlement, syncVipMonthQuota } = require('./membership');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

/**
 * 用户权益：
 * - users.points          购买积分（不过期）
 * - users.vipExpireAt     包月到期
 * - users.vipMonthQuota   本月剩余额度
 * - users.vipQuotaPeriod  额度所属月份 YYYY-MM
 *
 * action:
 * - get | redeem
 * redeem: { code }
 */

async function ensureUser(openid) {
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
      console.warn('ensureUser set', err.message);
    }
    return { ref, data };
  }
}

async function applyGrant(ref, user, type, value) {
  const now = Date.now();
  if (type === 'vip_days') {
    const days = Math.max(1, Number(value) || 1);
    const base = Math.max(now, toMs(user.vipExpireAt));
    const next = dayjs(base).add(days, 'day').toDate();
    await ref.update({
      data: {
        vipExpireAt: next,
        updatedAt: db.serverDate(),
      },
    });
    return { grantType: 'vip_days', days, vipExpireAt: next.getTime() };
  }
  if (type === 'points' || type === 'quota') {
    const add = Math.max(1, Number(value) || 1);
    await ref.update({
      data: {
        points: _.inc(add),
        updatedAt: db.serverDate(),
      },
    });
    return { grantType: 'points', add };
  }
  throw new Error('不支持的兑换类型');
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) {
    return { ok: false, code: 'NO_OPENID', message: '请先登录' };
  }

  const action = event.action || 'get';

  try {
    if (action === 'get') {
      const { ref, data } = await ensureUser(OPENID);
      const synced = await syncVipMonthQuota(ref, data, db.serverDate());
      return { ok: true, openid: OPENID, entitlement: buildEntitlement(synced) };
    }

    if (action === 'redeem') {
      const code = String(event.code || '')
        .trim()
        .toUpperCase()
        .replace(/\s+/g, '');
      if (!code || code.length < 4) {
        return { ok: false, code: 'BAD_PARAM', message: '请输入有效兑换码' };
      }

      const codeRes = await db
        .collection('redeem_codes')
        .where({ code })
        .limit(1)
        .get();
      const row = (codeRes.data || [])[0];
      if (!row) {
        return { ok: false, code: 'NOT_FOUND', message: '兑换码不存在' };
      }
      if (row.status === 'disabled') {
        return { ok: false, code: 'DISABLED', message: '兑换码已作废' };
      }
      if (row.status === 'used' || (row.useCount || 0) >= (row.maxUses || 1)) {
        return { ok: false, code: 'USED', message: '兑换码已使用' };
      }
      if (row.expireAt && toMs(row.expireAt) < Date.now()) {
        return { ok: false, code: 'EXPIRED', message: '兑换码已过期' };
      }

      const { ref, data: user } = await ensureUser(OPENID);
      const grant = await applyGrant(ref, user, row.type, row.value);

      const nextUses = (row.useCount || 0) + 1;
      const maxUses = row.maxUses || 1;
      await db
        .collection('redeem_codes')
        .doc(row._id)
        .update({
          data: {
            status: nextUses >= maxUses ? 'used' : row.status || 'unused',
            useCount: _.inc(1),
            usedBy: OPENID,
            usedAt: db.serverDate(),
          },
        });

      const fresh = (await ref.get()).data || {};
      const synced = await syncVipMonthQuota(ref, fresh, db.serverDate());
      return {
        ok: true,
        message:
          row.type === 'vip_days'
            ? `已开通包月 ${grant.days} 天（每月 ${MONTHLY_QUOTA} 积分）`
            : `已到账 ${grant.add} 积分`,
        grant,
        entitlement: buildEntitlement(synced),
      };
    }

    return { ok: false, code: 'BAD_ACTION', message: '未知操作' };
  } catch (e) {
    console.error(e);
    return { ok: false, code: 'FAIL', message: e.message || '操作失败' };
  }
};
