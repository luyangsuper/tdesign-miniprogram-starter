/**
 * 积分流水：记录购买积分与包月月额度变动。
 * balance 约定为变动后可用总额（points + vipMonthQuota）。
 *
 * 写入约定（后续新途径必须遵守）：
 * 1. 普通发放 / 扣减 / 设为：用 applyUserPoints（改余额 + 记流水，一条路径）。
 * 2. 事务内改积分：事务成功后再 recordPointsLog（checkin / lottery / campaign）。
 * 3. 消耗含包月额度时：delta 记总扣减，meta 标 fromVip / fromPoints。
 * 4. 包月发放 / 到期清零：由 syncVipMonthQuota 写入（vip_month / vip_expire）。
 * 5. reason 可任意新字符串；未登记的会用 title，再退回 reason 原文。列表不按 reason 过滤。
 *
 * 当前写入点：
 * welcome login / checkin+makeup userCheckin / oa+redeem userEntitlement /
 * purchase(+refund) virtualPay / lottery lotteryDraw+userLottery /
 * campaign adminManagePoints / admin+admin_repair adminManageUser /
 * download(+refund) getEmojiDownload / grid gridLottery /
 * vip_month+vip_expire syncVipMonthQuota
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
  lottery_entry: '抽奖投入',
  lottery_refund: '抽奖退回',
  grid_cost: '九宫格抽奖',
  grid_prize: '九宫格奖励',
  campaign: '活动发放',
  admin: '管理员调整',
  admin_repair: '权益补发',
  vip_month: '包月本月额度',
  vip_expire: '包月到期清零',
};

/** 可用总额：购买积分 + 本月包月额度（调用方宜先 sync） */
function walletBalanceOf(user = {}) {
  const points = Math.max(0, Number(user.points) || 0);
  const vip = Math.max(0, Number(user.vipMonthQuota) || 0);
  return points + vip;
}

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
      balance = walletBalanceOf(snap.data || {});
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

/**
 * 改 users.points 并记流水。新的发放/扣减途径优先走这里。
 * @param {object} db
 * @param {object} command db.command
 * @param {{
 *   openid: string,
 *   delta?: number,
 *   setTo?: number,
 *   reason: string,
 *   title?: string,
 *   meta?: object,
 *   userPatch?: object,
 *   currentPoints?: number,
 *   maxPoints?: number,
 * }} opts
 */
async function applyUserPoints(db, command, opts = {}) {
  const openid = String(opts.openid || '').trim();
  if (!openid) {
    return { prev: 0, next: 0, delta: 0, skipped: true };
  }

  let prev = opts.currentPoints;
  let vipMonthQuota = opts.currentVipMonthQuota;
  if (
    prev == null ||
    Number.isNaN(Number(prev)) ||
    vipMonthQuota == null ||
    Number.isNaN(Number(vipMonthQuota))
  ) {
    try {
      const snap = await db.collection('users').doc(openid).get();
      const row = snap.data || {};
      if (prev == null || Number.isNaN(Number(prev))) {
        prev = Math.max(0, Number(row.points) || 0);
      }
      if (vipMonthQuota == null || Number.isNaN(Number(vipMonthQuota))) {
        vipMonthQuota = Math.max(0, Number(row.vipMonthQuota) || 0);
      }
    } catch (e) {
      if (prev == null || Number.isNaN(Number(prev))) prev = 0;
      if (vipMonthQuota == null || Number.isNaN(Number(vipMonthQuota))) {
        vipMonthQuota = 0;
      }
    }
  }
  prev = Math.max(0, Number(prev) || 0);
  vipMonthQuota = Math.max(0, Number(vipMonthQuota) || 0);

  const cap =
    opts.maxPoints == null || Number.isNaN(Number(opts.maxPoints))
      ? null
      : Math.max(0, Number(opts.maxPoints));

  let next;
  let delta;
  const hasSet = opts.setTo !== undefined && opts.setTo !== null && opts.setTo !== '';
  if (hasSet) {
    next = Math.max(0, Number(opts.setTo));
    if (Number.isNaN(next)) {
      return { prev, next: prev, delta: 0, skipped: true };
    }
    if (cap != null) next = Math.min(cap, next);
    delta = next - prev;
  } else {
    delta = Math.trunc(Number(opts.delta) || 0);
    next = Math.max(0, prev + delta);
    if (cap != null) next = Math.min(cap, next);
    delta = next - prev;
  }

  const userPatch =
    opts.userPatch && typeof opts.userPatch === 'object' && !Array.isArray(opts.userPatch)
      ? { ...opts.userPatch }
      : {};
  delete userPatch.points;

  const data = {
    ...userPatch,
    updatedAt: db.serverDate(),
  };
  if (delta) {
    data.points = hasSet || !command ? next : command.inc(delta);
  } else if (!Object.keys(userPatch).length) {
    return { prev, next, delta: 0, skipped: true };
  }

  await db.collection('users').doc(openid).update({ data });
  if (delta) {
    await recordPointsLog(db, {
      openid,
      delta,
      balance: next + vipMonthQuota,
      reason: opts.reason || 'other',
      title: opts.title,
      meta: opts.meta,
    });
  }
  return { prev, next, delta, skipped: false };
}

function formatPointsLogRow(row, toMs, formatDate) {
  const at = typeof toMs === 'function' ? toMs(row.createdAt) || 0 : 0;
  const delta = Math.trunc(Number(row.delta) || 0);
  return {
    id: row._id,
    delta,
    balance: row.balance != null ? Number(row.balance) : null,
    reason: row.reason || '',
    title: row.title || reasonTitle(row.reason) || '积分变动',
    meta: row.meta || {},
    createdAt: at || null,
    createdText: at && typeof formatDate === 'function' ? formatDate(at) : '',
    deltaText: delta > 0 ? `+${delta}` : `${delta}`,
    tone: delta > 0 ? 'plus' : 'minus',
  };
}

/**
 * 按用户拉取流水。不按 reason 过滤，未知途径也能展示。
 */
async function queryPointsLogs(db, opts = {}) {
  const openid = String(opts.openid || '').trim();
  const page = Math.max(1, Number(opts.page) || 1);
  const pageSize = Math.min(50, Math.max(1, Number(opts.pageSize) || 20));
  const skip = (page - 1) * pageSize;
  const toMs = opts.toMs;
  const formatDate = opts.formatDate;
  const includeBalance = !!opts.includeBalance;
  const empty = {
    list: [],
    total: 0,
    page,
    pageSize,
    hasMore: false,
    ...(includeBalance ? { balance: 0 } : {}),
  };

  if (!openid) {
    return { ok: true, data: empty, message: '缺少 openid' };
  }

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
      const all = (listRes.data || []).sort((a, b) => {
        const ta = typeof toMs === 'function' ? toMs(b.createdAt) : 0;
        const tb = typeof toMs === 'function' ? toMs(a.createdAt) : 0;
        return (ta || 0) - (tb || 0);
      });
      total = all.length;
      rows = all.slice(skip, skip + pageSize);
    } catch (err) {
      return {
        ok: true,
        data: empty,
        message: '暂无流水或集合未建',
      };
    }
  }

  let balance = 0;
  if (includeBalance) {
    try {
      const userSnap = await db.collection('users').doc(openid).get();
      balance = walletBalanceOf(userSnap.data || {});
    } catch (e) {
      /* ignore */
    }
  }

  return {
    ok: true,
    data: {
      list: rows.map((row) => formatPointsLogRow(row, toMs, formatDate)),
      total,
      page,
      pageSize,
      hasMore: skip + rows.length < total,
      ...(includeBalance ? { balance } : {}),
    },
  };
}

module.exports = {
  REASON_TITLE,
  reasonTitle,
  walletBalanceOf,
  ensurePointsLogsCollection,
  recordPointsLog,
  applyUserPoints,
  formatPointsLogRow,
  queryPointsLogs,
};
