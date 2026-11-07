const cloud = require('wx-server-sdk');
const { dayjs, TZ, toMs } = require('./time');
const { MONTHLY_QUOTA, buildEntitlement, syncVipMonthQuota } = require('./membership');
const { getPointsSettings } = require('./pointsSettings');
const { applyUserPoints } = require('./pointsLog');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

/**
 * 用户权益：
 * - users.points          购买积分（不过期）
 * - users.vipExpireAt     包月到期
 * - users.vipMonthQuota   本月剩余额度
 * - users.vipQuotaPeriod  额度所属月份 YYYY-MM
 * - users.adRewardDayKey / adRewardDayCount          长广告当日计数
 * - users.saveAdRewardDayKey / saveAdRewardDayCount  短广告（保存不够）当日计数
 * - users.checkinAdRewardDayKey / checkinAdRewardDayCount  签到后再领，每日最多 1 次
 *
 * action:
 * - get | redeem | ackPointGift | ackPointGifts | claimOaBonus
 * - adRewardStatus | claimAdReward
 * redeem: { code }
 * ackPointGift: { giftId }  关闭单笔
 * ackPointGifts: { giftIds: string[] }  合并弹窗一次确认多笔
 * claimOaBonus: { oaId }  公众号动态入口礼，每用户每 oaId 一次
 * claimAdReward: { slot?: 'reward'|'save'|'checkin' } 看完激励视频后领取（客户端信任 + 日上限）
 * adRewardStatus: { slot?: 'reward'|'save'|'checkin' } 不传 slot 时返回 { reward, save, checkin }
 * resetAdRewardDay: 管理员清空自己今日激励计数（方便自测）
 */

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

function todayKeyShanghai() {
  return dayjs().tz(TZ).format('YYYY-MM-DD');
}

function normalizeAdSlot(raw) {
  const s = String(raw || '').trim();
  if (s === 'save') return 'save';
  if (s === 'checkin') return 'checkin';
  return 'reward';
}

/**
 * @param {'reward'|'save'|'checkin'} slot
 */
function buildAdRewardStatus(settings, user = {}, slot = 'reward') {
  const dayKey = todayKeyShanghai();
  let points = 0;
  let dailyMax = 0;
  let keyField = 'adRewardDayKey';
  let countField = 'adRewardDayCount';

  if (slot === 'checkin') {
    // 与短广告同积分；签到入口每日硬限 1 次，防刷短广告日上限
    points = Math.max(0, Number(settings.saveAdRewardPoints) || 0);
    dailyMax = points > 0 ? 1 : 0;
    keyField = 'checkinAdRewardDayKey';
    countField = 'checkinAdRewardDayCount';
  } else if (slot === 'save') {
    points = Math.max(0, Number(settings.saveAdRewardPoints) || 0);
    dailyMax = Math.max(0, Number(settings.saveAdRewardDailyMax) || 0);
    keyField = 'saveAdRewardDayKey';
    countField = 'saveAdRewardDayCount';
  } else {
    points = Math.max(0, Number(settings.adRewardPoints) || 0);
    dailyMax = Math.max(0, Number(settings.adRewardDailyMax) || 0);
    keyField = 'adRewardDayKey';
    countField = 'adRewardDayCount';
  }

  const usedToday =
    String(user[keyField] || '') === dayKey
      ? Math.max(0, Number(user[countField]) || 0)
      : 0;
  const leftToday = dailyMax > 0 ? Math.max(0, dailyMax - usedToday) : 0;
  const enabled = points > 0 && dailyMax > 0;
  return {
    slot,
    enabled,
    points,
    dailyMax,
    usedToday,
    leftToday: enabled ? leftToday : 0,
    dayKey,
  };
}

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
    // 不抢建 users：首页 get 常与 login 并发，set(points:0) 会抢走/覆盖见面礼。
    // 无档案时返回空壳；真正建档与见面礼由 login 负责。
    return {
      ref,
      data: {
        openid,
        points: 0,
        vipMonthQuota: 0,
        vipQuotaPeriod: '',
        vipExpireAt: null,
      },
    };
  }
}

async function applyGrant(ref, user, type, value, logCtx = {}) {
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
    const openid = String((user && (user._id || user.openid)) || '');
    const applied = await applyUserPoints(db, _, {
      openid: String(logCtx.openid || openid || ''),
      delta: add,
      currentPoints: user && user.points,
      reason: 'redeem',
      title: '兑换码',
      meta: logCtx.meta,
    });
    return { grantType: 'points', add: applied.delta || add };
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
      const synced = await syncVipMonthQuota(ref, data, db.serverDate(), db);
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
      const settings = await getPointsSettings(db);
      return {
        ok: true,
        openid: OPENID,
        entitlement: buildEntitlement(synced),
        pendingPointGifts,
        pendingLotteryInvites,
        adReward: buildAdRewardStatus(settings, synced, 'reward'),
        saveAdReward: buildAdRewardStatus(settings, synced, 'save'),
        /** 首页信息流广告间隔（合集数）；0=关闭 */
        homeFeedAdEvery: settings.homeFeedAdEvery,
        /** 保存单价（管理端可改） */
        downloadCosts: {
          static: settings.costStatic,
          anim: settings.costAnim,
          wallpaper: settings.costWallpaper,
          avatar: settings.costAvatar,
          video: settings.costVideo,
        },
        costStatic: settings.costStatic,
        costAnim: settings.costAnim,
        costWallpaper: settings.costWallpaper,
        costAvatar: settings.costAvatar,
        costVideo: settings.costVideo,
        // 开奖结果只走 userLottery.pending（校验已参与）
      };
    }

    if (action === 'adRewardStatus') {
      const { data } = await ensureUser(OPENID);
      const settings = await getPointsSettings(db);
      const slotRaw = String(event.slot || '').trim();
      if (!slotRaw) {
        return {
          ok: true,
          data: {
            reward: buildAdRewardStatus(settings, data, 'reward'),
            save: buildAdRewardStatus(settings, data, 'save'),
            checkin: buildAdRewardStatus(settings, data, 'checkin'),
          },
        };
      }
      const slot = normalizeAdSlot(slotRaw);
      return {
        ok: true,
        data: buildAdRewardStatus(settings, data, slot),
      };
    }

    if (action === 'resetAdRewardDay') {
      if (!assertAdmin(OPENID)) {
        return { ok: false, code: 'FORBIDDEN', message: '仅管理员可重置' };
      }
      const { ref } = await ensureUser(OPENID);
      await ref.update({
        data: {
          adRewardDayCount: 0,
          saveAdRewardDayCount: 0,
          checkinAdRewardDayCount: 0,
          updatedAt: db.serverDate(),
        },
      });
      const settings = await getPointsSettings(db);
      const fresh = (await ref.get()).data || {};
      return {
        ok: true,
        message: '已重置今日激励次数',
        data: {
          reward: buildAdRewardStatus(settings, fresh, 'reward'),
          save: buildAdRewardStatus(settings, fresh, 'save'),
          checkin: buildAdRewardStatus(settings, fresh, 'checkin'),
        },
      };
    }

    if (action === 'claimAdReward') {
      const slot = normalizeAdSlot(event.slot);
      const settings = await getPointsSettings(db);
      const probe = buildAdRewardStatus(settings, {}, slot);
      if (!probe.enabled) {
        return {
          ok: false,
          code: 'DISABLED',
          message: '看广告领积分暂未开放',
        };
      }

      const { ref, data: user } = await ensureUser(OPENID);
      let userData = user;
      try {
        const snap = await ref.get();
        userData = { ...(snap.data || {}), _id: OPENID, openid: OPENID };
      } catch (e) {
        return {
          ok: false,
          code: 'NO_USER',
          message: '请先登录后再领取',
        };
      }

      const current = buildAdRewardStatus(settings, userData, slot);
      if (current.leftToday <= 0) {
        return {
          ok: false,
          code: 'DAY_LIMIT',
          message:
            slot === 'checkin'
              ? '今日签到广告奖励已领取'
              : `今日已达上限（${current.dailyMax} 次）`,
          data: current,
          entitlement: buildEntitlement(userData),
        };
      }

      const add = current.points;
      const dayKey = current.dayKey;
      const keyField =
        slot === 'checkin'
          ? 'checkinAdRewardDayKey'
          : slot === 'save'
            ? 'saveAdRewardDayKey'
            : 'adRewardDayKey';
      const countField =
        slot === 'checkin'
          ? 'checkinAdRewardDayCount'
          : slot === 'save'
            ? 'saveAdRewardDayCount'
            : 'adRewardDayCount';
      const sameDay = String(userData[keyField] || '') === dayKey;
      const nextCount = (sameDay ? current.usedToday : 0) + 1;
      const title =
        slot === 'checkin'
          ? '签到看广告再领'
          : slot === 'save'
            ? '看广告补积分'
            : '看广告领积分';

      await applyUserPoints(db, _, {
        openid: OPENID,
        delta: add,
        currentPoints: userData.points,
        currentVipMonthQuota: userData.vipMonthQuota,
        reason: 'ad_reward',
        title,
        meta: {
          slot,
          dayKey,
          count: nextCount,
          dailyMax: current.dailyMax,
        },
        userPatch: {
          [keyField]: dayKey,
          [countField]: sameDay ? _.inc(1) : 1,
        },
      });

      const fresh = (await ref.get()).data || {};
      const synced = await syncVipMonthQuota(ref, fresh, db.serverDate(), db);
      const nextStatus = buildAdRewardStatus(settings, synced, slot);
      return {
        ok: true,
        claimed: true,
        slot,
        points: add,
        leftToday: nextStatus.leftToday,
        message: `已到账 ${add} 积分`,
        data: nextStatus,
        entitlement: buildEntitlement(synced),
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
          db,
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
        await applyUserPoints(db, _, {
          openid: OPENID,
          delta: points,
          currentPoints: userData.points,
          reason: 'oa',
          title: '公众号动态礼',
          meta: { oaId, giftId },
          userPatch: {
            pendingPointGifts: _.push({
              id: giftId,
              title: '公众号动态礼',
              points,
              source: 'oa',
              oaId,
              at: Date.now(),
            }),
            [`oaArticleCredits.${oaId}`]: true,
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
      const synced = await syncVipMonthQuota(userRef, fresh, db.serverDate(), db);
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
      const grant = await applyGrant(ref, user, row.type, row.value, {
        openid: OPENID,
        meta: { code: String(row.code || code).slice(0, 32) },
      });

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
      const synced = await syncVipMonthQuota(ref, fresh, db.serverDate(), db);
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
