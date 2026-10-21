const cloud = require('wx-server-sdk');
const { toMs, formatDate } = require('./time');
const { queryPointsLogs } = require('./pointsLog');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

async function listPointsLogs(openid, event = {}) {
  return queryPointsLogs(db, {
    openid,
    page: event.page,
    pageSize: event.pageSize || 30,
    toMs,
    formatDate,
    includeBalance: true,
  });
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
