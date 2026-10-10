const cloud = require('wx-server-sdk');
const { dayjs, toMs, formatDate } = require('./time');
const { buildEntitlement, syncVipMonthQuota } = require('./membership');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

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

async function resolveAvatarMap(fileIDs = []) {
  const ids = Array.from(new Set((fileIDs || []).filter(Boolean)));
  const map = {};
  if (!ids.length) return map;
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    try {
      // eslint-disable-next-line no-await-in-loop
      const res = await cloud.getTempFileURL({ fileList: chunk });
      (res.fileList || []).forEach((item) => {
        if (item.fileID && item.tempFileURL) map[item.fileID] = item.tempFileURL;
      });
    } catch (e) {
      /* ignore */
    }
  }
  return map;
}

const { defaultAvatarUrl } = require('./avatar');

function formatUser(doc, avatarMap = {}) {
  const data = doc || {};
  const openid = data._id || data.openid || '';
  const lastLoginMs = toMs(data.lastLoginAt);
  const entitlement = buildEntitlement(data);
  const cloudAvatar =
    (data.avatarFileID && avatarMap[data.avatarFileID]) || '';
  return {
    openid,
    nickName: data.nickName || '',
    avatarUrl: cloudAvatar || defaultAvatarUrl(openid),
    isAdmin: !!data.isAdmin,
    entitlement,
    lastLoginAt: lastLoginMs || null,
    lastLoginText: lastLoginMs ? formatDate(lastLoginMs) : '',
    createdAt: toMs(data.createdAt) || null,
    shortId: openid ? `${openid.slice(0, 6)}…${openid.slice(-4)}` : '',
    statusText: entitlement.isVip
      ? `包月 · 本月 ${entitlement.vipMonthQuota}`
      : entitlement.points > 0
        ? `积分 ${entitlement.points}`
        : '普通用户',
  };
}

async function formatUserAsync(doc) {
  const map = await resolveAvatarMap([doc && doc.avatarFileID]);
  return formatUser(doc, map);
}

async function getUserByOpenid(openid) {
  try {
    const snap = await db.collection('users').doc(openid).get();
    if (!snap.data) return null;
    return { _id: openid, ...snap.data };
  } catch (e) {
    return null;
  }
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) {
    return { ok: false, code: 'NO_OPENID', message: '请先登录' };
  }
  if (!assertAdmin(OPENID)) {
    return { ok: false, code: 'FORBIDDEN', message: '无管理员权限' };
  }

  const action = event.action || 'get';
  const targetOpenid = String(event.openid || '')
    .trim()
    .replace(/\s+/g, '');

  try {
    if (action === 'list') {
      const page = Math.max(1, Number(event.page) || 1);
      const pageSize = Math.min(50, Math.max(1, Number(event.pageSize) || 20));
      const skip = (page - 1) * pageSize;
      const filter = String(event.filter || 'all').trim(); // all | vip | points
      const keyword = String(event.keyword || '')
        .trim()
        .toLowerCase()
        .slice(0, 40);

      let where = {};
      if (filter === 'vip') {
        where = { vipExpireAt: _.gt(new Date()) };
      } else if (filter === 'points' || filter === 'quota') {
        where = { points: _.gt(0) };
      }

      const col = Object.keys(where).length
        ? db.collection('users').where(where)
        : db.collection('users');

      const countRes = await col.count();
      let listRes;
      try {
        listRes = await col.orderBy('lastLoginAt', 'desc').skip(skip).limit(pageSize).get();
      } catch (e) {
        try {
          listRes = await col.orderBy('createdAt', 'desc').skip(skip).limit(pageSize).get();
        } catch (err) {
          listRes = await col.skip(skip).limit(pageSize).get();
        }
      }

      let rows = (listRes.data || []).map((u) => ({ _id: u._id, ...u }));
      if (keyword) {
        rows = rows.filter((u) => {
          const id = String(u._id || u.openid || '').toLowerCase();
          const name = String(u.nickName || '').toLowerCase();
          return id.includes(keyword) || name.includes(keyword);
        });
      }

      const avatarMap = await resolveAvatarMap(rows.map((u) => u.avatarFileID));
      const list = rows.map((u) => formatUser(u, avatarMap));

      return {
        ok: true,
        data: {
          list,
          page,
          pageSize,
          total: countRes.total || 0,
          hasMore: skip + (listRes.data || []).length < (countRes.total || 0),
        },
      };
    }

    if (action === 'search' || action === 'get') {
      if (!targetOpenid || targetOpenid.length < 4) {
        return { ok: false, code: 'BAD_PARAM', message: '请输入 openid（至少 4 位）' };
      }

      let user = await getUserByOpenid(targetOpenid);
      if (!user && targetOpenid.length < 28) {
        // 片段模糊：扫最近登录用户（上限 100）再过滤
        const listRes = await db
          .collection('users')
          .orderBy('lastLoginAt', 'desc')
          .limit(100)
          .get();
        const hit = (listRes.data || []).find((u) => {
          const id = u._id || u.openid || '';
          return id.includes(targetOpenid);
        });
        if (hit) user = { _id: hit._id, ...hit };
      }

      if (!user) {
        return { ok: false, code: 'NOT_FOUND', message: '未找到该用户' };
      }
      const uid = user._id || user.openid;
      if (uid) {
        user = await syncVipMonthQuota(
          db.collection('users').doc(uid),
          user,
          db.serverDate(),
        );
      }
      return { ok: true, data: await formatUserAsync(user) };
    }

    if (!targetOpenid) {
      return { ok: false, code: 'BAD_PARAM', message: '缺少 openid' };
    }

    let user = await getUserByOpenid(targetOpenid);
    if (!user) {
      // 允许给从未登录的 openid 建档再改权益
      await db.collection('users').doc(targetOpenid).set({
        data: {
          openid: targetOpenid,
          points: 0,
          vipMonthQuota: 0,
          vipQuotaPeriod: '',
          vipExpireAt: null,
          createdAt: db.serverDate(),
          updatedAt: db.serverDate(),
        },
      });
      user = await getUserByOpenid(targetOpenid);
    }

    const ref = db.collection('users').doc(targetOpenid);

    if (action === 'cancelVip') {
      await ref.update({
        data: {
          vipExpireAt: null,
          vipMonthQuota: 0,
          vipQuotaPeriod: '',
          updatedAt: db.serverDate(),
        },
      });
      const fresh = await getUserByOpenid(targetOpenid);
      return { ok: true, message: '已取消 VIP', data: await formatUserAsync(fresh) };
    }

    if (action === 'setVipDays') {
      const days = Math.max(1, Math.min(3650, Number(event.days) || 0));
      if (!days) {
        return { ok: false, code: 'BAD_PARAM', message: '天数无效' };
      }
      const now = Date.now();
      const base = Math.max(now, toMs(user.vipExpireAt));
      const next = dayjs(base).add(days, 'day').toDate();
      await ref.update({
        data: {
          vipExpireAt: next,
          updatedAt: db.serverDate(),
        },
      });
      let fresh = await getUserByOpenid(targetOpenid);
      fresh = await syncVipMonthQuota(ref, fresh, db.serverDate());
      return {
        ok: true,
        message: `已设置包月 ${days} 天`,
        data: await formatUserAsync(fresh),
      };
    }

    if (action === 'setPoints' || action === 'setQuota') {
      const rawPoints =
        event.points !== undefined && event.points !== null
          ? event.points
          : event.downloadQuota;
      const points = Math.max(0, Math.min(99999, Number(rawPoints)));
      if (Number.isNaN(points)) {
        return { ok: false, code: 'BAD_PARAM', message: '积分无效' };
      }
      await ref.update({
        data: {
          points,
          updatedAt: db.serverDate(),
        },
      });
      const fresh = await getUserByOpenid(targetOpenid);
      return {
        ok: true,
        message: `积分已设为 ${points}`,
        data: await formatUserAsync(fresh),
      };
    }

    if (action === 'adjustPoints' || action === 'adjustQuota') {
      const delta = Number(event.delta);
      if (!delta || Number.isNaN(delta)) {
        return { ok: false, code: 'BAD_PARAM', message: '增减量无效' };
      }
      const current = Math.max(0, Number(user.points) || 0);
      const next = Math.max(0, Math.min(99999, current + delta));
      await ref.update({
        data: {
          points: next,
          updatedAt: db.serverDate(),
        },
      });
      const fresh = await getUserByOpenid(targetOpenid);
      return {
        ok: true,
        message: `积分已调整为 ${next}`,
        data: await formatUserAsync(fresh),
      };
    }

    return { ok: false, code: 'BAD_ACTION', message: '未知操作' };
  } catch (e) {
    console.error(e);
    return { ok: false, code: 'FAIL', message: e.message || '操作失败' };
  }
};
