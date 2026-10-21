const cloud = require('wx-server-sdk');
const { dayjs, TZ, toMs, formatDate } = require('./time');
const { resolveTempUrls } = require('./tempUrlCache');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const MAX = 1000;
/** 看板结果缓存（秒），force=true 可跳过 */
const DASHBOARD_TTL_MS = 3 * 60 * 1000;
const DASHBOARD_DOC = 'dashboard_cache';

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

async function fetchAll(collection, where, orderField, limit = MAX) {
  const col = where
    ? db.collection(collection).where(where)
    : db.collection(collection);
  try {
    const res = await col.orderBy(orderField, 'desc').limit(limit).get();
    return res.data || [];
  } catch (e) {
    try {
      const res = await (where
        ? db.collection(collection).where(where)
        : db.collection(collection)
      )
        .limit(limit)
        .get();
      return res.data || [];
    } catch (err) {
      return [];
    }
  }
}

async function fetchAllPaged(collection, where, orderField, cap = 2000) {
  const rows = [];
  let skip = 0;
  while (rows.length < cap) {
    const batchSize = Math.min(MAX, cap - rows.length);
    const col = where
      ? db.collection(collection).where(where)
      : db.collection(collection);
    let res;
    try {
      // eslint-disable-next-line no-await-in-loop
      res = await col.orderBy(orderField, 'desc').skip(skip).limit(batchSize).get();
    } catch (e) {
      try {
        // eslint-disable-next-line no-await-in-loop
        res = await col.skip(skip).limit(batchSize).get();
      } catch (err) {
        break;
      }
    }
    const batch = res.data || [];
    if (!batch.length) break;
    rows.push(...batch);
    skip += batch.length;
    if (batch.length < batchSize) break;
  }
  return rows;
}

function yuanStr(fen) {
  return (Math.max(0, Number(fen) || 0) / 100).toFixed(2);
}

function orderTimeMs(row) {
  return toMs(row.deliveredAt) || toMs(row.createdAt) || 0;
}

function sumFen(list) {
  return list.reduce((s, o) => s + Math.max(0, Number(o.priceFen) || 0), 0);
}

function filterSince(list, sinceMs, timeFn) {
  return list.filter((row) => timeFn(row) >= sinceMs);
}

function dailyKeys(from, to) {
  const keys = [];
  let d = from.startOf('day');
  const end = to.startOf('day');
  let guard = 0;
  while (d.valueOf() <= end.valueOf() && guard < 62) {
    keys.push(d.format('YYYY-MM-DD'));
    d = d.add(1, 'day');
    guard += 1;
  }
  return keys;
}

function monthKeys(from, to, cap = 12) {
  const keys = [];
  let d = from.startOf('month');
  const end = to.startOf('month');
  let guard = 0;
  while (d.valueOf() <= end.valueOf() && guard < 36) {
    keys.push(d.format('YYYY-MM'));
    d = d.add(1, 'month');
    guard += 1;
  }
  return keys.slice(-cap);
}

function buildRevenueSeries(keys, orders, keyFn, labelFn) {
  const fenMap = {};
  keys.forEach((k) => {
    fenMap[k] = 0;
  });
  orders.forEach((row) => {
    const ms = orderTimeMs(row);
    if (!ms) return;
    const key = keyFn(ms);
    if (fenMap[key] != null) fenMap[key] += Math.max(0, Number(row.priceFen) || 0);
  });
  return keys.map((key) => ({
    key,
    label: labelFn(key),
    yuan: Number((fenMap[key] / 100).toFixed(2)),
  }));
}

function buildAllRevenueTrend(now, orders) {
  let minMs = Infinity;
  orders.forEach((row) => {
    const ms = orderTimeMs(row);
    if (ms && ms < minMs) minMs = ms;
  });
  if (!Number.isFinite(minMs)) {
    return buildRevenueSeries(
      dailyKeys(now.subtract(6, 'day'), now),
      orders,
      (ms) => dayjs(ms).tz(TZ).format('YYYY-MM-DD'),
      (key) => key.slice(5),
    );
  }
  const first = dayjs(minMs).tz(TZ);
  const spanDays = now.startOf('day').diff(first.startOf('day'), 'day');
  if (spanDays <= 31) {
    return buildRevenueSeries(
      dailyKeys(first, now),
      orders,
      (ms) => dayjs(ms).tz(TZ).format('YYYY-MM-DD'),
      (key) => key.slice(5),
    );
  }
  return buildRevenueSeries(
    monthKeys(first, now, 12),
    orders,
    (ms) => dayjs(ms).tz(TZ).format('YYYY-MM'),
    (key) => `${Number(key.slice(5))}月`,
  );
}

function periodBlock(users, downloads, orders) {
  return {
    summary: {
      users,
      downloads,
      orders: orders.length,
      revenueYuan: yuanStr(sumFen(orders)),
    },
  };
}

async function safeCount(collection, where) {
  try {
    const col = where
      ? db.collection(collection).where(where)
      : db.collection(collection);
    const res = await col.count();
    return res.total || 0;
  } catch (e) {
    return 0;
  }
}

/** 超过 24h 仍未支付的下单单关掉，避免看板把弃单当成待发货 */
async function closeStaleUnpaidPending() {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  try {
    const res = await db.collection('orders').where({ status: 'pending' }).limit(100).get();
    const rows = res.data || [];
    await Promise.all(
      rows.map(async (o) => {
        const t = toMs(o.createdAt);
        if (t && t > cutoff) return;
        if (!o._id) return;
        await db.collection('orders').doc(o._id).update({
          data: {
            status: 'closed',
            closeReason: 'unpaid_timeout',
            updatedAt: db.serverDate(),
          },
        });
      }),
    );
  } catch (e) {
    console.warn('[dashboard] close stale pending', e.message || e);
  }
}

async function readDashboardCache() {
  try {
    const snap = await db.collection('app_config').doc(DASHBOARD_DOC).get();
    const row = snap.data || {};
    const at = Number(row.at) || 0;
    if (!at || !row.payload) return null;
    if (Date.now() - at > DASHBOARD_TTL_MS) return null;
    return row.payload;
  } catch (e) {
    return null;
  }
}

async function writeDashboardCache(payload) {
  try {
    await db.collection('app_config').doc(DASHBOARD_DOC).set({
      data: {
        at: Date.now(),
        payload,
        updatedAt: db.serverDate(),
      },
    });
  } catch (e) {
    try {
      await db.createCollection('app_config');
      await db.collection('app_config').doc(DASHBOARD_DOC).set({
        data: {
          at: Date.now(),
          payload,
          updatedAt: db.serverDate(),
        },
      });
    } catch (err) {
      console.warn('[dashboard] cache write', err.message || err);
    }
  }
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) {
    return { ok: false, code: 'NO_OPENID', message: '请先登录' };
  }
  if (!assertAdmin(OPENID)) {
    return { ok: false, code: 'FORBIDDEN', message: '无管理员权限' };
  }

  const force = !!(event && event.force);

  try {
    if (!force) {
      const cached = await readDashboardCache();
      if (cached && cached.periods) {
        return {
          ok: true,
          data: {
            ...cached,
            cached: true,
            updatedText: cached.updatedText || formatDate(Date.now()),
          },
        };
      }
    }

    await closeStaleUnpaidPending();

    const now = dayjs().tz(TZ);
    const todayStart = now.startOf('day').toDate();
    const todayStartMs = todayStart.getTime();
    const weekStartDj = now.subtract(6, 'day').startOf('day');
    const weekStart = weekStartDj.toDate();
    const weekStartMs = weekStart.getTime();
    const monthStartDj = now.startOf('month');
    const monthStart = monthStartDj.toDate();
    const monthStartMs = monthStart.getTime();

    const [
      usersTotal,
      packsPublished,
      packsDraft,
      downloadsTodayRows,
      downloadsWeekRows,
      ordersDelivered,
      ordersPending,
      topPacksRaw,
      newUsersToday,
      newUsersWeek,
      newUsersMonth,
      downloadsToday,
      downloadsWeek,
      downloadsMonth,
      downloadsAll,
    ] = await Promise.all([
      safeCount('users'),
      safeCount('packs', { status: 'published' }),
      safeCount('packs', { status: 'draft' }),
      fetchAll(
        'download_logs',
        { createdAt: _.gte(todayStart) },
        'createdAt',
        MAX,
      ),
      fetchAll(
        'download_logs',
        { createdAt: _.gte(weekStart) },
        'createdAt',
        MAX,
      ),
      fetchAllPaged('orders', { status: 'delivered' }, 'createdAt', 2000),
      safeCount('orders', { status: 'paid' }),
      fetchAll('packs', { status: 'published' }, 'downloadCount', 8),
      safeCount('users', { createdAt: _.gte(todayStart) }),
      safeCount('users', { createdAt: _.gte(weekStart) }),
      safeCount('users', { createdAt: _.gte(monthStart) }),
      safeCount('download_logs', { createdAt: _.gte(todayStart) }),
      safeCount('download_logs', { createdAt: _.gte(weekStart) }),
      safeCount('download_logs', { createdAt: _.gte(monthStart) }),
      safeCount('download_logs'),
    ]);

    const activeToday = new Set(
      downloadsTodayRows.map((r) => r.openid).filter(Boolean),
    ).size;

    const todayOrders = filterSince(ordersDelivered, todayStartMs, orderTimeMs);
    const weekOrders = filterSince(ordersDelivered, weekStartMs, orderTimeMs);
    const monthOrders = filterSince(ordersDelivered, monthStartMs, orderTimeMs);

    const revenueTodayFen = sumFen(todayOrders);
    const revenueWeekFen = sumFen(weekOrders);
    const ordersToday = todayOrders.length;
    const ordersWeek = weekOrders.length;

    // 近 7 日下载趋势（上海日历日）
    const dayKeys = [];
    for (let i = 6; i >= 0; i -= 1) {
      dayKeys.push(now.subtract(i, 'day').format('YYYY-MM-DD'));
    }
    const dayCountMap = {};
    dayKeys.forEach((k) => {
      dayCountMap[k] = 0;
    });
    downloadsWeekRows.forEach((row) => {
      const ms = toMs(row.createdAt);
      if (!ms) return;
      const key = dayjs(ms).tz(TZ).format('YYYY-MM-DD');
      if (dayCountMap[key] != null) dayCountMap[key] += 1;
    });
    const maxDay = Math.max(1, ...dayKeys.map((k) => dayCountMap[k]));
    const trend = dayKeys.map((key) => ({
      key,
      label: key.slice(5),
      count: dayCountMap[key],
      percent: Math.round((dayCountMap[key] / maxDay) * 100),
    }));

    // 今日热门合集（按今日下载次数）
    const todayPackCount = {};
    downloadsTodayRows.forEach((row) => {
      const id = String(row.packId || '').trim();
      if (!id) return;
      todayPackCount[id] = (todayPackCount[id] || 0) + 1;
    });
    const todayTopIds = Object.keys(todayPackCount)
      .sort((a, b) => todayPackCount[b] - todayPackCount[a])
      .slice(0, 5);

    const packSnaps = {};
    await Promise.all(
      todayTopIds.map(async (id) => {
        try {
          const snap = await db.collection('packs').doc(id).get();
          if (snap.data) packSnaps[id] = snap.data;
        } catch (e) {
          /* ignore */
        }
      }),
    );

    const coverIds = [];
    todayTopIds.forEach((id) => {
      const p = packSnaps[id];
      if (p && p.coverFileID) coverIds.push(p.coverFileID);
    });
    (topPacksRaw || []).forEach((p) => {
      if (p.coverFileID) coverIds.push(p.coverFileID);
    });
    const urlMap = await resolveTempUrls(cloud, coverIds);

    const todayHotPacks = todayTopIds
      .map((id) => {
        const p = packSnaps[id];
        if (!p || p.status !== 'published') return null;
        return {
          packId: id,
          title: String(p.title || '').trim() || id,
          count: todayPackCount[id],
          coverUrl: (p.coverFileID && urlMap[p.coverFileID]) || '',
        };
      })
      .filter(Boolean);

    const allTimeHot = (topPacksRaw || []).map((p) => ({
      packId: p._id,
      title: String(p.title || '').trim() || p._id,
      count: Math.max(0, Number(p.downloadCount) || 0),
      coverUrl: (p.coverFileID && urlMap[p.coverFileID]) || '',
    }));

    const weekTrend = buildRevenueSeries(
      dailyKeys(weekStartDj, now),
      weekOrders,
      (ms) => dayjs(ms).tz(TZ).format('YYYY-MM-DD'),
      (key) => key.slice(5),
    );
    const monthTrend = buildRevenueSeries(
      dailyKeys(monthStartDj, now),
      monthOrders,
      (ms) => dayjs(ms).tz(TZ).format('YYYY-MM-DD'),
      (key) => key.slice(8),
    );
    const allTrend = buildAllRevenueTrend(now, ordersDelivered);

    const payload = {
      updatedText: formatDate(Date.now()),
      summary: {
        usersTotal,
        newUsersToday,
        packsPublished,
        packsDraft,
        downloadsToday,
        downloadsWeek,
        activeToday,
        ordersToday,
        ordersWeek,
        ordersPending,
        revenueTodayYuan: yuanStr(revenueTodayFen),
        revenueWeekYuan: yuanStr(revenueWeekFen),
      },
      periods: {
        week: {
          ...periodBlock(newUsersWeek, downloadsWeek, weekOrders),
          revenueTrend: weekTrend,
        },
        month: {
          ...periodBlock(newUsersMonth, downloadsMonth, monthOrders),
          revenueTrend: monthTrend,
        },
        all: {
          ...periodBlock(usersTotal, downloadsAll, ordersDelivered),
          revenueTrend: allTrend,
        },
      },
      trend,
      todayHotPacks,
      allTimeHot,
    };
    await writeDashboardCache(payload);
    return {
      ok: true,
      data: {
        ...payload,
        cached: false,
      },
    };
  } catch (e) {
    console.error(e);
    return {
      ok: false,
      code: 'DASHBOARD_FAIL',
      message: e.message || '加载失败',
    };
  }
};
