/**
 * 积分流水：只记录 users.points 变动（不含包月月额度）。
 * 失败不抛错，避免影响主流程。
 */

const REASON_TITLE = {
  download: '保存原图',
  download_refund: '保存失败退回',
  checkin: '每日签到',
  makeup: '补签',
  welcome: '新用户见面礼',
  redeem: '兑换码',
  purchase: '购买积分',
  purchase_refund: '订单退款回收',
  oa: '公众号动态礼',
  lottery: '抽奖奖励',
  campaign: '活动发放',
  admin: '管理员调整',
  admin_repair: '权益补发',
};

function reasonTitle(reason, fallback) {
  const key = String(reason || '').trim();
  if (fallback) return String(fallback).slice(0, 40);
  return REASON_TITLE[key] || key || '积分变动';
}

async function ensurePointsLogsCollection(db) {
  try {
    await db.createCollection('points_logs');
  } catch (e) {
    /* exists */
  }
}

/**
 * @param {object} db cloud.database()
 * @param {{ openid: string, delta: number, balance?: number, reason: string, title?: string, meta?: object }} opts
 */
async function recordPointsLog(db, opts = {}) {
  const openid = String(opts.openid || '').trim();
  const delta = Math.trunc(Number(opts.delta) || 0);
  if (!openid || !delta) return;

  let balance = opts.balance;
  if (balance == null || Number.isNaN(Number(balance))) {
    try {
      const snap = await db.collection('users').doc(openid).get();
      balance = Math.max(0, Number((snap.data && snap.data.points) || 0));
    } catch (e) {
      balance = null;
    }
  } else {
    balance = Math.max(0, Number(balance));
  }

  const reason = String(opts.reason || 'other').trim().slice(0, 32);
  const title = reasonTitle(reason, opts.title);
  const meta =
    opts.meta && typeof opts.meta === 'object' && !Array.isArray(opts.meta)
      ? opts.meta
      : {};

  try {
    await db.collection('points_logs').add({
      data: {
        openid,
        delta,
        balance,
        reason,
        title,
        meta,
        createdAt: db.serverDate(),
      },
    });
  } catch (e) {
    const msg = String((e && (e.message || e.errMsg)) || e || '');
    if (/COLLECTION_NOT_EXIST|not exist/i.test(msg)) {
      try {
        await ensurePointsLogsCollection(db);
        await db.collection('points_logs').add({
          data: {
            openid,
            delta,
            balance,
            reason,
            title,
            meta,
            createdAt: db.serverDate(),
          },
        });
        return;
      } catch (e2) {
        console.warn('[pointsLog] retry fail', e2.message || e2);
        return;
      }
    }
    console.warn('[pointsLog] skip', msg);
  }
}

module.exports = {
  REASON_TITLE,
  reasonTitle,
  ensurePointsLogsCollection,
  recordPointsLog,
};
