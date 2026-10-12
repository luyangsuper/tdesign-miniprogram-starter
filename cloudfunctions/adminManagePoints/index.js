const cloud = require('wx-server-sdk');
const {
  getPointsSettings,
  savePointsSettings,
  DEFAULTS,
} = require('./pointsSettings');

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

/**
 * 只给已有 users 文档发积分，绝不 set 新建用户。
 * 按 _id 游标翻页（避免 skip+原地改写导致漏发/重发）；campaignCredits 幂等防重入。
 */
async function grantToExistingUsers({ campaignId, title, points }) {
  let lastId = '';
  let granted = 0;
  let failed = 0;
  let skipped = 0;
  const giftBase = {
    campaignId,
    title,
    points,
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
        const giftId = `${campaignId}_${id}`;
        const userRef = db.collection('users').doc(id);
        try {
          const tx = await db.runTransaction(async (transaction) => {
            const snap = await transaction.get(userRef);
            const data = (snap && snap.data) || null;
            if (!data) return { skip: true, missing: true };
            const credited =
              data.campaignCredits && data.campaignCredits[campaignId];
            if (credited) return { skip: true };
            transaction.update(userRef, {
              data: {
                points: _.inc(points),
                pendingPointGifts: _.push({
                  id: giftId,
                  ...giftBase,
                }),
                [`campaignCredits.${campaignId}`]: true,
                updatedAt: db.serverDate(),
              },
            });
            return { skip: false };
          });
          if (tx && tx.skip) {
            if (!tx.missing) skipped += 1;
            else failed += 1;
          } else {
            granted += 1;
          }
        } catch (e) {
          failed += 1;
          console.warn('[grant] user fail', id, e.message || e);
        }
      }),
    );

    lastId = String(list[list.length - 1]._id || '');
    if (!lastId || list.length < PAGE_SIZE) break;
  }

  return { granted, failed, skipped };
}

async function listCampaigns(limit = 20) {
  try {
    const res = await db
      .collection('point_campaigns')
      .orderBy('createdAt', 'desc')
      .limit(Math.min(50, Math.max(1, limit)))
      .get();
    return (res.data || []).map((row) => ({
      id: row._id,
      title: row.title || '',
      points: Number(row.points) || 0,
      granted: Number(row.granted) || 0,
      failed: Number(row.failed) || 0,
      createdAt: row.createdAt || null,
    }));
  } catch (e) {
    return [];
  }
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) {
    return { ok: false, code: 'NO_OPENID', message: '请先登录' };
  }
  if (!assertAdmin(OPENID)) {
    return { ok: false, code: 'FORBIDDEN', message: '无管理权限' };
  }

  const action = event.action || 'get';

  try {
    if (action === 'get') {
      const settings = await getPointsSettings(db);
      const userCount = await countUsers();
      const campaigns = await listCampaigns(15);
      return {
        ok: true,
        data: { ...settings, defaults: DEFAULTS, userCount, campaigns },
      };
    }

    if (action === 'set') {
      const settings = await savePointsSettings(
        db,
        {
          welcomeGiftPoints: event.welcomeGiftPoints,
          checkinPoints: event.checkinPoints,
        },
        { openid: OPENID },
      );
      return {
        ok: true,
        message: '积分规则已保存',
        data: settings,
      };
    }

    if (action === 'previewGrant') {
      const userCount = await countUsers();
      return {
        ok: true,
        data: {
          userCount,
          tip: `将发给当前已注册的 ${userCount} 名用户（从未登录的用户不会收到）`,
        },
      };
    }

    if (action === 'grantCampaign') {
      const title = String(event.title || '')
        .trim()
        .slice(0, 40);
      const points = Math.max(0, Math.min(9999, Math.floor(Number(event.points) || 0)));
      if (!title) {
        return { ok: false, code: 'BAD_PARAM', message: '请填写活动标题' };
      }
      if (!points) {
        return { ok: false, code: 'BAD_PARAM', message: '请填写有效积分（至少 1）' };
      }

      await ensureCollection('point_campaigns');
      await ensureCollection('app_config');
      const userCount = await countUsers();
      if (!userCount) {
        return { ok: false, code: 'EMPTY', message: '暂无已注册用户可发放' };
      }

      // 单飞锁：避免双开管理端并发打出两场全量发放
      const lockRef = db.collection('app_config').doc('grant_lock');
      try {
        const lockSnap = await lockRef.get();
        const lock = (lockSnap && lockSnap.data) || {};
        const lockedAt = Number(lock.lockedAt) || 0;
        if (lock.busy && Date.now() - lockedAt < 10 * 60 * 1000) {
          return {
            ok: false,
            code: 'BUSY',
            message: '已有发放任务进行中，请稍后再试',
          };
        }
      } catch (e) {
        /* 无锁文档则继续 */
      }
      try {
        await lockRef.set({
          data: {
            busy: true,
            lockedAt: Date.now(),
            by: OPENID,
            updatedAt: db.serverDate(),
          },
        });
      } catch (e) {
        /* ignore */
      }

      const addRes = await db.collection('point_campaigns').add({
        data: {
          title,
          points,
          status: 'granting',
          granted: 0,
          failed: 0,
          skipped: 0,
          targetCount: userCount,
          createdBy: OPENID,
          createdAt: db.serverDate(),
        },
      });
      const campaignId = addRes._id;

      let granted = 0;
      let failed = 0;
      let skipped = 0;
      try {
        const result = await grantToExistingUsers({
          campaignId,
          title,
          points,
        });
        granted = result.granted;
        failed = result.failed;
        skipped = result.skipped || 0;
      } finally {
        try {
          await lockRef.set({
            data: {
              busy: false,
              lockedAt: 0,
              by: '',
              updatedAt: db.serverDate(),
            },
          });
        } catch (e) {
          /* ignore */
        }
      }

      await db
        .collection('point_campaigns')
        .doc(campaignId)
        .update({
          data: {
            status: 'done',
            granted,
            failed,
            skipped,
            finishedAt: db.serverDate(),
          },
        });

      return {
        ok: true,
        message: `已发放：成功 ${granted} 人，失败 ${failed} 人${
          skipped ? `，跳过 ${skipped} 人` : ''
        }`,
        data: {
          campaignId,
          title,
          points,
          granted,
          failed,
          skipped,
          userCount,
        },
      };
    }

    if (action === 'listCampaigns') {
      const campaigns = await listCampaigns(Number(event.limit) || 20);
      return { ok: true, data: { campaigns } };
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
