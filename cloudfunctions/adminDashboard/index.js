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
      if (cached) {
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

    const now = dayjs().tz(TZ);
    const todayStart = now.startOf('day').toDate();
    const todayStartMs = todayStart.getTime();
    const weekStart = now.subtract(6, 'day').startOf('day').toDate();
    const weekStartMs = weekStart.getTime();

    const [
      usersTotal,
      packsPublished,
      packsDraft,
      downloadsTodayRows,
      downloadsWeekRows,
      ordersDelivered,
      ordersPending,
      topPacksRaw,
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
      fetchAll('orders', { status: 'delivered' }, 'createdAt', MAX),
      safeCount('orders', { status: 'pending' }),
      fetchAll('packs', { status: 'published' }, 'downloadCount', 8),
    ]);

    const downloadsToday = downloadsTodayRows.length;
    const downloadsWeek = downloadsWeekRows.length;

    const activeToday = new Set(
      downloadsTodayRows.map((r) => r.openid).filter(Boolean),
    ).size;

    const todayOrders = ordersDelivered.filter(
      (o) => (toMs(o.deliveredAt) || toMs(o.createdAt) || 0) >= todayStartMs,
    );
    const weekOrders = ordersDelivered.filter(
      (o) => (toMs(o.deliveredAt) || toMs(o.createdAt) || 0) >= weekStartMs,
    );

    const sumFen = (list) =>
      list.reduce((s, o) => s + Math.max(0, Number(o.priceFen) || 0), 0);

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

    let newUsersToday = 0;
    try {
      const nu = await db
        .collection('users')
        .where({ createdAt: _.gte(todayStart) })
        .count();
      newUsersToday = nu.total || 0;
    } catch (e) {
      /* ignore */
    }

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
        revenueTodayYuan: (revenueTodayFen / 100).toFixed(2),
        revenueWeekYuan: (revenueWeekFen / 100).toFixed(2),
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
