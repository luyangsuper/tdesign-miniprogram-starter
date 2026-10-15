const cloud = require('wx-server-sdk');
const { toMs, formatDate } = require('./time');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

async function listPointsLogs(openid, event = {}) {
  const page = Math.max(1, Number(event.page) || 1);
  const pageSize = Math.min(50, Math.max(10, Number(event.pageSize) || 30));
  const skip = (page - 1) * pageSize;

  let total = 0;
  let rows = [];
  try {
    const col = db.collection('points_logs').where({ openid });
    const countRes = await col.count();
    total = countRes.total || 0;
    const listRes = await col
      .orderBy('createdAt', 'desc')
      .skip(skip)
      .limit(pageSize)
      .get();
    rows = listRes.data || [];
  } catch (e) {
    try {
      const listRes = await db
        .collection('points_logs')
        .where({ openid })
        .limit(pageSize + skip)
        .get();
      const all = (listRes.data || []).sort(
        (a, b) => (toMs(b.createdAt) || 0) - (toMs(a.createdAt) || 0),
      );
      total = all.length;
      rows = all.slice(skip, skip + pageSize);
    } catch (err) {
      return {
        ok: true,
        data: { list: [], total: 0, page, pageSize, hasMore: false, balance: 0 },
        message: '暂无流水或集合未建',
      };
    }
  }

  let balance = 0;
  try {
    const userSnap = await db.collection('users').doc(openid).get();
    balance = Math.max(0, Number((userSnap.data && userSnap.data.points) || 0));
  } catch (e) {
    /* ignore */
  }

  const list = rows.map((row) => {
    const at = toMs(row.createdAt) || 0;
    const delta = Math.trunc(Number(row.delta) || 0);
    return {
      id: row._id,
      delta,
      balance: row.balance != null ? Number(row.balance) : null,
      reason: row.reason || '',
      title: row.title || '积分变动',
      meta: row.meta || {},
      createdAt: at || null,
      createdText: at ? formatDate(at) : '',
      deltaText: delta > 0 ? `+${delta}` : `${delta}`,
      tone: delta > 0 ? 'plus' : 'minus',
    };
  });

  return {
    ok: true,
    data: {
      list,
      total,
      page,
      pageSize,
      hasMore: skip + rows.length < total,
      balance,
    },
  };
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) {
    return { ok: false, code: 'NO_OPENID', message: '请先登录' };
  }

  const action = String(event.action || '').trim();
  try {
    if (action === 'listPointsLogs') {
      return await listPointsLogs(OPENID, event);
    }
    return { ok: false, code: 'BAD_ACTION', message: '未知操作' };
  } catch (e) {
    console.error(e);
    return {
      ok: false,
      code: 'HISTORY_FAIL',
      message: e.message || '加载失败',
    };
  }
};
