const cloud = require('wx-server-sdk');
const { sendLotteryInviteNotices } = require('./notify');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const FALLBACK_ADMINS = ['oOtg0xqcOEHgBAL7u3M7g9S8ln2c'];
const PAGE_SIZE = 20;

function getAdminList() {
  const fromEnv = process.env.ADMIN_OPENIDS || '';
  if (fromEnv.trim()) {
    return fromEnv.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return FALLBACK_ADMINS;
}

function assertAdmin(openid) {
  return !!openid && getAdminList().includes(openid);
}

function toMs(v) {
  if (!v) return 0;
  if (typeof v === 'number') return v;
  if (v instanceof Date) return v.getTime();
  if (v && typeof v.toDate === 'function') return v.toDate().getTime();
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? 0 : t;
}

async function ensureCollection(name) {
  try {
    await db.createCollection(name);
  } catch (e) {
    /* ignore */
  }
}

async function countUsers() {
  try {
    const res = await db.collection('users').count();
    return Number(res.total) || 0;
  } catch (e) {
    return 0;
  }
}

/** 给已有用户推邀请，不预建账号 */
async function pushInvites({ lotteryId, title, drawAtMs, poolPoints, winnerCount }) {
  let lastId = '';
  let notified = 0;
  let failed = 0;
  const inviteBase = {
    lotteryId,
    title,
    drawAt: drawAtMs,
    poolPoints,
    winnerCount,
    at: Date.now(),
  };

  while (true) {
    let query = db.collection('users').orderBy('_id', 'asc').limit(PAGE_SIZE);
    if (lastId) {
      query = db
        .collection('users')
        .where({ _id: _.gt(lastId) })
        .orderBy('_id', 'asc')
        .limit(PAGE_SIZE);
    }
    // eslint-disable-next-line no-await-in-loop
    const res = await query.get();
    const list = (res && res.data) || [];
    if (!list.length) break;

    // eslint-disable-next-line no-await-in-loop
    await Promise.all(
      list.map(async (row) => {
        const id = row._id || row.openid;
        if (!id) {
          failed += 1;
          return;
        }
        try {
          await db
            .collection('users')
            .doc(id)
            .update({
              data: {
                pendingLotteryInvites: _.push({
                  id: `invite_${lotteryId}_${id}`,
                  ...inviteBase,
                }),
                updatedAt: db.serverDate(),
              },
            });
          notified += 1;
        } catch (e) {
          failed += 1;
        }
      }),
    );

    lastId = String(list[list.length - 1]._id || '');
    if (!lastId || list.length < PAGE_SIZE) break;
  }

  return { notified, failed };
}

function mapLottery(row) {
  return {
    id: row._id,
    title: row.title || '',
    poolPoints: Number(row.poolPoints) || 0,
    winnerCount: Number(row.winnerCount) || 0,
    drawAt: toMs(row.drawAt),
    status: row.status || 'open',
    participantCount: Number(row.participantCount) || 0,
    winners: Array.isArray(row.winners) ? row.winners : [],
    createdAt: toMs(row.createdAt),
    drawnAt: toMs(row.drawnAt),
  };
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) {
    return { ok: false, code: 'NO_OPENID', message: '请先登录' };
  }
  if (!assertAdmin(OPENID)) {
    return { ok: false, code: 'FORBIDDEN', message: '无管理权限' };
  }

  const action = event.action || 'list';

  try {
    await ensureCollection('lotteries');
    await ensureCollection('lottery_entries');

    if (action === 'list') {
      const userCount = await countUsers();
      let rows = [];
      try {
        const res = await db
          .collection('lotteries')
          .orderBy('createdAt', 'desc')
          .limit(30)
          .get();
        rows = res.data || [];
      } catch (e) {
        rows = [];
      }
      return {
        ok: true,
        data: {
          userCount,
          list: rows.map(mapLottery),
        },
      };
    }

    if (action === 'create') {
      const title = String(event.title || '')
        .trim()
        .slice(0, 40);
      const poolPoints = Math.max(
        1,
        Math.min(999999, Math.floor(Number(event.poolPoints) || 0)),
      );
      const winnerCount = Math.max(
        1,
        Math.min(1000, Math.floor(Number(event.winnerCount) || 0)),
      );
      const drawAtMs = toMs(event.drawAt);
      if (!title) {
        return { ok: false, code: 'BAD_PARAM', message: '请填写活动标题' };
      }
      if (!drawAtMs || drawAtMs <= Date.now() + 60 * 1000) {
        return {
          ok: false,
          code: 'BAD_PARAM',
          message: '开奖时间须至少晚于当前 1 分钟',
        };
      }
      if (poolPoints < winnerCount) {
        return {
          ok: false,
          code: 'BAD_PARAM',
          message: '总奖池积分不能小于中奖人数（每人至少 1 积分）',
        };
      }

      const addRes = await db.collection('lotteries').add({
        data: {
          title,
          poolPoints,
          winnerCount,
          drawAt: new Date(drawAtMs),
          status: 'open',
          participantCount: 0,
          winners: [],
          createdBy: OPENID,
          createdAt: db.serverDate(),
          updatedAt: db.serverDate(),
        },
      });
      const lotteryId = addRes._id;

      const { notified, failed } = await pushInvites({
        lotteryId,
        title,
        drawAtMs,
        poolPoints,
        winnerCount,
      });

      let subscribeSent = 0;
      try {
        const sub = await sendLotteryInviteNotices(cloud, db, { lotteryId, title });
        subscribeSent = (sub && sub.sent) || 0;
      } catch (e) {
        console.warn('[create] subscribe invite', e.message || e);
      }

      await db
        .collection('lotteries')
        .doc(lotteryId)
        .update({
          data: {
            inviteNotified: notified,
            inviteFailed: failed,
            subscribeSent,
            updatedAt: db.serverDate(),
          },
        });

      return {
        ok: true,
        message: `已创建，站内邀请 ${notified} 人${
          subscribeSent ? `，订阅消息 ${subscribeSent} 人` : ''
        }`,
        data: {
          lotteryId,
          notified,
          failed,
          subscribeSent,
          title,
          poolPoints,
          winnerCount,
          drawAt: drawAtMs,
        },
      };
    }

    if (action === 'cancel') {
      const lotteryId = String(event.lotteryId || '').trim();
      if (!lotteryId) {
        return { ok: false, code: 'BAD_PARAM', message: '缺少活动 ID' };
      }
      let lot;
      try {
        lot = (await db.collection('lotteries').doc(lotteryId).get()).data;
      } catch (e) {
        return { ok: false, code: 'NOT_FOUND', message: '活动不存在' };
      }
      if (!lot || lot.status !== 'open') {
        return { ok: false, code: 'BAD_STATUS', message: '仅未开奖活动可取消' };
      }
      await db
        .collection('lotteries')
        .doc(lotteryId)
        .update({
          data: {
            status: 'cancelled',
            updatedAt: db.serverDate(),
          },
        });
      return { ok: true, message: '已取消' };
    }

    return { ok: false, code: 'BAD_ACTION', message: '未知操作' };
  } catch (e) {
    console.error(e);
    return {
      ok: false,
      code: 'FAIL',
      message: (e && e.message) || '操作失败',
    };
  }
};
