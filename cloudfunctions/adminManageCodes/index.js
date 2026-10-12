const cloud = require('wx-server-sdk');
const { toMs, formatDate } = require('./time');

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

function labelOf(type, value) {
  if (type === 'vip_days') return `包月会员 ${value} 天`;
  if (type === 'points') return `积分 ${value}`;
  return `${type} ${value}`;
}

function mapRow(row) {
  return {
    id: row._id,
    code: row.code,
    type: row.type,
    value: row.value,
    label: labelOf(row.type, row.value),
    status: row.status || 'unused',
    maxUses: row.maxUses || 1,
    useCount: row.useCount || 0,
    usedBy: row.usedBy || '',
    usedAtText: formatDate(toMs(row.usedAt)),
    note: row.note || '',
    createdAtText: formatDate(toMs(row.createdAt)),
    canDisable: row.status !== 'used' && row.status !== 'disabled',
  };
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) {
    return { ok: false, code: 'NO_OPENID', message: '请先登录' };
  }
  if (!assertAdmin(OPENID)) {
    return { ok: false, code: 'FORBIDDEN', message: '无管理员权限' };
  }

  const action = event.action || 'list';

  try {
    if (action === 'list') {
      const page = Math.max(1, Number(event.page) || 1);
      const pageSize = Math.min(50, Math.max(1, Number(event.pageSize) || 20));
      const skip = (page - 1) * pageSize;
      const status = String(event.status || '').trim();
      const type = String(event.type || '').trim();

      const where = {};
      if (status && status !== 'all') where.status = status;
      if (type && type !== 'all') where.type = type;

      const col = Object.keys(where).length
        ? db.collection('redeem_codes').where(where)
        : db.collection('redeem_codes');

      const countRes = await col.count();
      let listRes;
      try {
        listRes = await col.orderBy('createdAt', 'desc').skip(skip).limit(pageSize).get();
      } catch (e) {
        // 无索引时降级
        listRes = await col.skip(skip).limit(pageSize).get();
      }

      const list = (listRes.data || []).map(mapRow);
      return {
        ok: true,
        data: {
          list,
          page,
          pageSize,
          total: countRes.total || 0,
          hasMore: skip + list.length < (countRes.total || 0),
        },
      };
    }

    if (action === 'disable') {
      const id = String(event.id || '').trim();
      if (!id) {
        return { ok: false, code: 'BAD_PARAM', message: '缺少兑换码 id' };
      }
      const snap = await db.collection('redeem_codes').doc(id).get();
      const row = snap.data;
      if (!row) {
        return { ok: false, code: 'NOT_FOUND', message: '兑换码不存在' };
      }
      if (row.status === 'used') {
        return {
          ok: false,
          code: 'ALREADY_USED',
          message: '已使用，请到「用户权益」取消对方会员 / 积分',
        };
      }
      if (row.status === 'disabled') {
        return { ok: true, message: '已是作废状态', data: mapRow({ ...row, _id: id }) };
      }
      await db.collection('redeem_codes').doc(id).update({
        data: {
          status: 'disabled',
          disabledAt: db.serverDate(),
          disabledBy: OPENID,
        },
      });
      const fresh = (await db.collection('redeem_codes').doc(id).get()).data;
      return {
        ok: true,
        message: '已作废',
        data: mapRow({ ...fresh, _id: id }),
      };
    }

    // 一键删除已作废 / 已使用（不影响未使用码）
    if (action === 'purgeInactive') {
      const scope = String(event.scope || 'inactive').trim();
      const statuses =
        scope === 'disabled'
          ? ['disabled']
          : scope === 'used'
            ? ['used']
            : ['disabled', 'used'];
      let removed = 0;
      const PAGE = 100;
      // eslint-disable-next-line no-restricted-syntax
      for (const status of statuses) {
        let guard = 0;
        while (guard < 50) {
          guard += 1;
          // eslint-disable-next-line no-await-in-loop
          const res = await db
            .collection('redeem_codes')
            .where({ status })
            .limit(PAGE)
            .get();
          const rows = (res && res.data) || [];
          if (!rows.length) break;
          // eslint-disable-next-line no-await-in-loop
          await Promise.all(
            rows.map((row) =>
              db
                .collection('redeem_codes')
                .doc(row._id)
                .remove()
                .then(() => {
                  removed += 1;
                })
                .catch(() => {}),
            ),
          );
          if (rows.length < PAGE) break;
        }
      }
      return {
        ok: true,
        message: `已删除 ${removed} 条`,
        data: { removed, scope },
      };
    }

    return { ok: false, code: 'BAD_ACTION', message: '未知操作' };
  } catch (e) {
    console.error(e);
    return { ok: false, code: 'FAIL', message: e.message || '操作失败' };
  }
};
