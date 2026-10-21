const cloud = require('wx-server-sdk');
const { dayjs, TZ, toMs } = require('./time');
const { recordPointsLog } = require('./pointsLog');
const { MONTHLY_QUOTA, periodKey, buildEntitlement } = require('./membership');
const {
  DEFAULT_COST,
  DEFAULT_DAILY_LIMIT,
  defaultConfig,
  normalizePrizes,
  expectedValue,
  pickPrize,
  publicPrizes,
} = require('./prizes');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const CONFIG_ID = 'main';
const FALLBACK_ADMINS = ['oOtg0xqcOEHgBAL7u3M7g9S8ln2c'];

function getAdminList() {
  const fromEnv = process.env.ADMIN_OPENIDS || '';
  if (fromEnv.trim()) {
    return fromEnv.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return FALLBACK_ADMINS;
}

function todayKey() {
  return dayjs().tz(TZ).format('YYYY-MM-DD');
}

async function ensureCollections() {
  try {
    await db.createCollection('grid_lottery');
  } catch (e) {
    /* exists */
  }
}

function sanitizeConfig(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const costPoints = Math.max(
    1,
    Math.min(99, Math.floor(Number(src.costPoints != null ? src.costPoints : DEFAULT_COST) || DEFAULT_COST)),
  );
  const dailyLimit = Math.max(
    1,
    Math.min(99, Math.floor(Number(src.dailyLimit != null ? src.dailyLimit : DEFAULT_DAILY_LIMIT) || DEFAULT_DAILY_LIMIT)),
  );
  const prizes = normalizePrizes(src.prizes);
  return {
    enabled: src.enabled !== false,
    costPoints,
    dailyLimit,
    prizes,
  };
}

async function loadConfig() {
  try {
    const snap = await db.collection('grid_lottery').doc(CONFIG_ID).get();
    if (snap && snap.data) return sanitizeConfig(snap.data);
  } catch (e) {
    /* missing */
  }
  const cfg = defaultConfig();
  try {
    await db.collection('grid_lottery').doc(CONFIG_ID).set({
      data: {
        ...cfg,
        createdAt: db.serverDate(),
        updatedAt: db.serverDate(),
      },
    });
  } catch (e) {
    /* ignore */
  }
  return cfg;
}

function userTodayCount(user, today) {
  if (!user) return 0;
  if (String(user.gridLotteryDate || '') !== today) return 0;
  return Math.max(0, Math.floor(Number(user.gridLotteryCount) || 0));
}

function publicPayload(cfg, user) {
  const today = todayKey();
  const todayCount = userTodayCount(user, today);
  const ent = buildEntitlement(user || {});
  const wallet = ent.vipMonthQuota + ent.points;
  return {
    enabled: !!cfg.enabled,
    costPoints: cfg.costPoints,
    dailyLimit: cfg.dailyLimit,
    todayCount,
    remainCount: Math.max(0, cfg.dailyLimit - todayCount),
    points: ent.points,
    vipMonthQuota: ent.vipMonthQuota,
    wallet,
    prizes: publicPrizes(cfg.prizes),
  };
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) {
    return { ok: false, code: 'NO_OPENID', message: '请先登录' };
  }

  const action = event.action || 'get';

  try {
    await ensureCollections();

    if (action === 'get') {
      const cfg = await loadConfig();
      let user = {};
      try {
        user = (await db.collection('users').doc(OPENID).get()).data || {};
      } catch (e) {
        user = {};
      }
      return { ok: true, data: publicPayload(cfg, user) };
    }

    if (action === 'draw') {
      await loadConfig();
      const today = todayKey();
      let drawRes;
      try {
        drawRes = await db.runTransaction(async (transaction) => {
          const cfgSnap = await transaction.collection('grid_lottery').doc(CONFIG_ID).get();
          const cfg = sanitizeConfig((cfgSnap && cfgSnap.data) || defaultConfig());
          if (!cfg.enabled) return { closed: true };

          const userSnap = await transaction.collection('users').doc(OPENID).get();
          const user = (userSnap && userSnap.data) || null;
          if (!user) return { noUser: true };

          const used = userTodayCount(user, today);
          if (used >= cfg.dailyLimit) {
            return { limited: true, dailyLimit: cfg.dailyLimit, todayCount: used };
          }

          const now = Date.now();
          const isVip = toMs(user.vipExpireAt) > now;
          const period = periodKey(now);
          let vipMonthQuota = Math.max(0, Number(user.vipMonthQuota) || 0);
          if (!isVip) vipMonthQuota = 0;
          else if (String(user.vipQuotaPeriod || '') !== period) vipMonthQuota = MONTHLY_QUOTA;

          const prev = Math.max(0, Number(user.points) || 0);
          const cost = cfg.costPoints;
          if (vipMonthQuota + prev < cost) {
            return { noPoints: true, cost, points: prev, vipMonthQuota };
          }

          const picked = pickPrize(cfg.prizes);
          const prize = picked.prize;
          if (!prize) return { fail: true };

          const fromVip = Math.min(vipMonthQuota, cost);
          const fromPoints = cost - fromVip;
          const gain = Math.max(0, Math.floor(Number(prize.points) || 0));
          const next = prev - fromPoints + gain;
          const nextVip = vipMonthQuota - fromVip;
          await transaction.collection('users').doc(OPENID).update({
            data: {
              points: next,
              vipMonthQuota: isVip ? nextVip : 0,
              vipQuotaPeriod: isVip ? period : '',
              gridLotteryDate: today,
              gridLotteryCount: used + 1,
              updatedAt: db.serverDate(),
            },
          });
          return {
            index: picked.index,
            prize: {
              id: prize.id,
              name: prize.name,
              points: gain,
            },
            cost,
            fromVip,
            fromPoints,
            prev,
            next,
            vipMonthQuota: nextVip,
            wallet: next + nextVip,
            todayCount: used + 1,
            dailyLimit: cfg.dailyLimit,
          };
        });
      } catch (e) {
        return { ok: false, code: 'FAIL', message: (e && e.message) || '抽奖失败' };
      }

      if (!drawRes) return { ok: false, code: 'FAIL', message: '抽奖失败' };
      if (drawRes.closed) {
        return { ok: false, code: 'CLOSED', message: '九宫格暂未开放' };
      }
      if (drawRes.noUser) {
        return { ok: false, code: 'NO_USER', message: '请先登录' };
      }
      if (drawRes.limited) {
        return {
          ok: false,
          code: 'LIMIT',
          message: `今日已抽 ${drawRes.dailyLimit} 次`,
        };
      }
      if (drawRes.noPoints) {
        const vip = Math.max(0, Number(drawRes.vipMonthQuota) || 0);
        const pts = Math.max(0, Number(drawRes.points) || 0);
        return {
          ok: false,
          code: 'NO_POINTS',
          message: `可用积分不足，需 ${drawRes.cost} 积分（购买积分 ${pts}、包月额度 ${vip}）`,
        };
      }
      if (drawRes.fail || drawRes.index == null) {
        return { ok: false, code: 'FAIL', message: '抽奖失败' };
      }

      const prizeName = String((drawRes.prize && drawRes.prize.name) || '九宫格').slice(0, 20);
      const cost = Number(drawRes.cost) || 0;
      const gain = Number(drawRes.prize && drawRes.prize.points) || 0;
      try {
        const fromPoints = Math.max(0, Number(drawRes.fromPoints) || 0);
        if (fromPoints > 0) {
          await recordPointsLog(db, {
            openid: OPENID,
            delta: -fromPoints,
            balance: drawRes.prev - fromPoints,
            reason: 'grid_cost',
            title: '九宫格抽奖',
            meta: {
              prizeId: drawRes.prize && drawRes.prize.id,
              fromVip: drawRes.fromVip,
              fromPoints,
            },
          });
        }
        if (gain > 0) {
          await recordPointsLog(db, {
            openid: OPENID,
            delta: gain,
            balance: drawRes.next,
            reason: 'grid_prize',
            title: `九宫格「${prizeName}」`,
            meta: { prizeId: drawRes.prize && drawRes.prize.id, index: drawRes.index },
          });
        }
      } catch (e) {
        /* ignore */
      }

      return {
        ok: true,
        message: gain > 0 ? `抽中 ${prizeName}` : '谢谢参与',
        data: {
          index: drawRes.index,
          prize: drawRes.prize,
          cost,
          points: drawRes.next,
          vipMonthQuota: Math.max(0, Number(drawRes.vipMonthQuota) || 0),
          wallet: Math.max(0, Number(drawRes.wallet) || 0),
          todayCount: drawRes.todayCount,
          dailyLimit: drawRes.dailyLimit,
          remainCount: Math.max(0, drawRes.dailyLimit - drawRes.todayCount),
        },
      };
    }

    if (action === 'adminGet' || action === 'adminSave' || action === 'adminResetToday') {
      if (!getAdminList().includes(OPENID)) {
        return { ok: false, code: 'FORBIDDEN', message: '无管理权限' };
      }
    }

    if (action === 'adminResetToday') {
      const today = todayKey();
      await db.collection('users').doc(OPENID).update({
        data: {
          gridLotteryDate: today,
          gridLotteryCount: 0,
          updatedAt: db.serverDate(),
        },
      });
      const cfg = await loadConfig();
      let user = {};
      try {
        user = (await db.collection('users').doc(OPENID).get()).data || {};
      } catch (e) {
        user = {};
      }
      return { ok: true, message: '今日次数已重置', data: publicPayload(cfg, user) };
    }

    if (action === 'adminGet') {
      const cfg = await loadConfig();
      const ev = expectedValue(cfg.prizes);
      return {
        ok: true,
        data: {
          ...cfg,
          expectedValue: Math.round(ev * 100) / 100,
          rtp: cfg.costPoints ? Math.round((ev / cfg.costPoints) * 1000) / 10 : 0,
        },
      };
    }

    if (action === 'adminSave') {
      const next = sanitizeConfig(event);
      const ev = expectedValue(next.prizes);
      const weightSum = next.prizes.reduce((s, p) => s + (Number(p.weight) || 0), 0);
      if (weightSum <= 0) {
        return { ok: false, code: 'BAD_PARAM', message: '请至少给一格设置权重' };
      }
      if (ev >= next.costPoints) {
        return {
          ok: false,
          code: 'BAD_PARAM',
          message: `期望奖金 ${ev.toFixed(2)} ≥ 消耗 ${next.costPoints}，请降低奖品或权重`,
        };
      }
      await db.collection('grid_lottery').doc(CONFIG_ID).set({
        data: {
          ...next,
          updatedAt: db.serverDate(),
          updatedBy: OPENID,
        },
      });
      return {
        ok: true,
        message: '已保存',
        data: {
          ...next,
          expectedValue: Math.round(ev * 100) / 100,
          rtp: Math.round((ev / next.costPoints) * 1000) / 10,
        },
      };
    }

    return { ok: false, code: 'BAD_ACTION', message: '未知操作' };
  } catch (e) {
    console.error(e);
    return { ok: false, code: 'FAIL', message: (e && e.message) || '操作失败' };
  }
};
