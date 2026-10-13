const cloud = require('wx-server-sdk');
const { dayjs, toMs } = require('./time');
const { MONTHLY_QUOTA, buildEntitlement, syncVipMonthQuota } = require('./membership');
const { getPointsSettings } = require('./pointsSettings');

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
 * - get | redeem | ackPointGift | ackPointGifts | claimOaBonus
 * redeem: { code }
 * ackPointGift: { giftId }  关闭单笔
 * ackPointGifts: { giftIds: string[] }  合并弹窗一次确认多笔
 * claimOaBonus: { oaId }  公众号动态入口礼，每用户每 oaId 一次
 */

/** 公众号动态入口 id：字母数字 _ -，1～64 */
function normalizeOaId(raw) {
  const id = String(raw || '').trim();
  if (!id || id.length > 64) return '';
  if (!/^[A-Za-z0-9_-]+$/.test(id)) return '';
  return id;
}

async function ensureCollection(name) {
  try {
    await db.createCollection(name);
  } catch (e) {
    /* 已存在则忽略 */
  }
}

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
  if (type === 'points') {
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
      const pendingPointGifts = Array.isArray(synced.pendingPointGifts)
        ? synced.pendingPointGifts.slice(0, 50)
        : [];
      const now = Date.now();
      const pendingLotteryInvites = (
        Array.isArray(synced.pendingLotteryInvites)
          ? synced.pendingLotteryInvites
          : []
      )
        .filter((g) => {
          if (!g || !g.lotteryId) return false;
          const drawAt = Number(g.drawAt) || 0;
          return !(drawAt > 0 && drawAt <= now);
        })
        .slice(0, 20);
      return {
        ok: true,
        openid: OPENID,
        entitlement: buildEntitlement(synced),
        pendingPointGifts,
        pendingLotteryInvites,
        // 开奖结果只走 userLottery.pending（校验已参与）
      };
    }

    if (action === 'ackPointGift') {
      const giftId = String(event.giftId || '').trim();
      if (!giftId) {
        return { ok: false, code: 'BAD_PARAM', message: '缺少礼物 ID' };
      }
      const { ref } = await ensureUser(OPENID);
      try {
        await ref.update({
          data: {
            pendingPointGifts: _.pull({ id: giftId }),
            updatedAt: db.serverDate(),
          },
        });
      } catch (e) {
        /* 没有该字段时忽略 */
      }
      return { ok: true };
    }

    if (action === 'ackPointGifts') {
      const ids = [
        ...new Set(
          (Array.isArray(event.giftIds) ? event.giftIds : [])
            .map((id) => String(id || '').trim())
            .filter(Boolean),
        ),
      ];
      if (!ids.length) {
        return { ok: false, code: 'BAD_PARAM', message: '缺少礼物 ID' };
      }
      const { ref } = await ensureUser(OPENID);
      // 逐条 _.pull，避免整数组覆盖导致并发发放的新礼被抹掉
      // eslint-disable-next-line no-restricted-syntax
      for (const giftId of ids) {
        try {
          // eslint-disable-next-line no-await-in-loop
          await ref.update({
            data: {
              pendingPointGifts: _.pull({ id: giftId }),
              updatedAt: db.serverDate(),
            },
          });
        } catch (e) {
          /* 无该字段或已不存在：忽略 */
        }
      }
      return { ok: true };
    }

    if (action === 'claimOaBonus') {
      const oaId = normalizeOaId(event.oaId);
      if (!oaId) {
        return { ok: false, code: 'BAD_PARAM', message: '无效的动态标识' };
      }

      const settings = await getPointsSettings(db);
      const points = Math.max(0, Number(settings.oaBonusPoints) || 0);
      if (points <= 0) {
        return {
          ok: true,
          skipped: true,
          reason: 'DISABLED',
          message: '公众号入口礼已关闭',
          pendingPointGifts: [],
        };
      }

      await ensureUser(OPENID);
      const userRef = db.collection('users').doc(OPENID);
      const giftId = `oa_${oaId}_${OPENID}`;
      // 独立领取记录 + 用户标志双写幂等（兼容无 create/事务 API 的旧 SDK）
      await ensureCollection('oa_article_claims');
      const claimRef = db.collection('oa_article_claims').doc(`${OPENID}_${oaId}`);

      const respondSkip = async (reason) => {
        const freshSkip = (await userRef.get()).data || {};
        const syncedSkip = await syncVipMonthQuota(
          userRef,
          freshSkip,
          db.serverDate(),
        );
        return {
          ok: true,
          skipped: true,
          reason,
          message: reason === 'ALREADY' ? '该动态奖励已领取' : '领取失败',
          entitlement: buildEntitlement(syncedSkip),
          pendingPointGifts: Array.isArray(syncedSkip.pendingPointGifts)
            ? syncedSkip.pendingPointGifts.slice(0, 50)
            : [],
        };
      };

      let userData = null;
      try {
        userData = (await userRef.get()).data || null;
      } catch (e) {
        userData = null;
      }
      if (!userData) {
        return respondSkip('NO_USER');
      }
      if (userData.oaArticleCredits && userData.oaArticleCredits[oaId]) {
        return respondSkip('ALREADY');
      }

      let claimExists = false;
      try {
        const claimSnap = await claimRef.get();
        claimExists = !!(claimSnap && claimSnap.data);
      } catch (e) {
        claimExists = false;
      }
      if (claimExists) {
        try {
          await userRef.update({
            data: {
              [`oaArticleCredits.${oaId}`]: true,
              updatedAt: db.serverDate(),
            },
          });
        } catch (e2) {
          /* ignore */
        }
        return respondSkip('ALREADY');
      }

      await claimRef.set({
        data: {
          openid: OPENID,
          oaId,
          points,
          giftId,
          createdAt: db.serverDate(),
        },
      });

      try {
        await userRef.update({
          data: {
            points: _.inc(points),
            pendingPointGifts: _.push({
              id: giftId,
              title: '公众号动态礼',
              points,
              source: 'oa',
              oaId,
              at: Date.now(),
            }),
            [`oaArticleCredits.${oaId}`]: true,
            updatedAt: db.serverDate(),
          },
        });
      } catch (e) {
        try {
          await claimRef.remove();
        } catch (e2) {
          /* ignore */
        }
        throw e;
      }

      const fresh = (await userRef.get()).data || {};
      const synced = await syncVipMonthQuota(userRef, fresh, db.serverDate());
      const pendingPointGifts = Array.isArray(synced.pendingPointGifts)
        ? synced.pendingPointGifts.slice(0, 50)
        : [];
      return {
        ok: true,
        claimed: true,
        points,
        giftId,
        oaId,
        entitlement: buildEntitlement(synced),
        pendingPointGifts,
        message: `已到账 ${points} 积分`,
      };
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
