const cloud = require('wx-server-sdk');
const { dayjs, TZ, toMs, formatDate } = require('./time');
const { resolveTempUrls } = require('./tempUrlCache');
const { resolveNickName } = require('./randomNick');

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
  if (!admins.length) return false;
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

function periodBlock(users, downloads, orders, extra = {}) {
  return {
    summary: {
      users,
      downloads,
      orders: orders.length,
      revenueYuan: yuanStr(sumFen(orders)),
      libraryDownloads: Math.max(0, Number(extra.libraryDownloads) || 0),
      workshopUses: Math.max(0, Number(extra.workshopUses) || 0),
    },
  };
}

const WORKSHOP_REASONS = ['bead_export', 'bead_advanced', 'image_export'];
const WORKSHOP_LABEL = {
  bead_export: '拼豆图纸导出',
  bead_advanced: '拼豆高级功能',
  image_export: '图片工具箱导出',
};

function scopeSinceMs(scope, now) {
  if (scope === 'week') return now.subtract(6, 'day').startOf('day').valueOf();
  if (scope === 'month') return now.startOf('month').valueOf();
  if (scope === 'all') return 0;
  return now.startOf('day').valueOf();
}

function scopeLabel(scope) {
  if (scope === 'week') return '近七日';
  if (scope === 'month') return '当月';
  if (scope === 'all') return '全部';
  return '今日';
}

async function loadUsersBrief(openids) {
  const map = {};
  const ids = Array.from(new Set((openids || []).filter(Boolean))).slice(0, 80);
  await Promise.all(
    ids.map(async (id) => {
      try {
        const snap = await db.collection('users').doc(id).get();
        const u = snap.data || {};
        map[id] = {
          openid: id,
          nickName: resolveNickName(u, id),
          points: Math.max(0, Number(u.points) || 0),
          vipMonthQuota: Math.max(0, Number(u.vipMonthQuota) || 0),
          isVip: !!(u.vipExpireAt && toMs(u.vipExpireAt) > Date.now()),
          vipExpireText: u.vipExpireAt ? formatDate(toMs(u.vipExpireAt)) : '',
        };
      } catch (e) {
        map[id] = {
          openid: id,
          nickName: resolveNickName('', id),
          points: 0,
          vipMonthQuota: 0,
          isVip: false,
          vipExpireText: '',
        };
      }
    }),
  );
  return map;
}

async function handleDrill(event = {}) {
  const kind = String(event.kind || '').trim();
  const scope = ['today', 'week', 'month', 'all'].includes(event.scope)
    ? event.scope
    : 'today';
  const now = dayjs().tz(TZ);
  const sinceMs = scopeSinceMs(scope, now);
  const sinceDate = sinceMs ? new Date(sinceMs) : null;
  const titleScope = scopeLabel(scope);

  if (kind === 'downloadPacks') {
    const where = sinceDate ? { createdAt: _.gte(sinceDate) } : null;
    const logs = await fetchAllPaged('download_logs', where, 'createdAt', 3000);
    const packCount = {};
    const packUsers = {};
    const packTitleHint = {};
    logs.forEach((row) => {
      const id = String(row.packId || '').trim();
      if (!id) return;
      packCount[id] = (packCount[id] || 0) + 1;
      if (!packUsers[id]) packUsers[id] = new Set();
      if (row.openid) packUsers[id].add(row.openid);
      if (!packTitleHint[id] && row.packTitle) {
        packTitleHint[id] = String(row.packTitle).trim();
      }
    });
    const ids = Object.keys(packCount)
      .sort((a, b) => packCount[b] - packCount[a])
      .slice(0, 40);
    const packMap = {};
    await Promise.all(
      ids.map(async (id) => {
        try {
          const snap = await db.collection('packs').doc(id).get();
          if (snap.data) packMap[id] = snap.data;
        } catch (e) {
          /* ignore */
        }
      }),
    );
    const list = ids.map((id) => {
      const p = packMap[id] || {};
      return {
        id,
        title: String(
          p.title || p.name || packTitleHint[id] || id,
        ).trim(),
        count: packCount[id],
        users: (packUsers[id] && packUsers[id].size) || 0,
        kind: 'pack',
      };
    });
    return {
      ok: true,
      data: {
        title: `${titleScope} · 下载合集`,
        kind: 'downloadPacks',
        scope,
        list,
        emptyText: '该时段暂无合集下载',
      },
    };
  }

  if (kind === 'downloadUsers') {
    const packId = String(event.packId || '').trim();
    if (!packId) {
      return { ok: false, code: 'BAD_PARAM', message: '缺少合集' };
    }
    const where = sinceDate
      ? { packId, createdAt: _.gte(sinceDate) }
      : { packId };
    const logs = await fetchAllPaged('download_logs', where, 'createdAt', 2000);
    const byUser = {};
    logs.forEach((row) => {
      const oid = String(row.openid || '').trim();
      if (!oid) return;
      if (!byUser[oid]) {
        byUser[oid] = { openid: oid, count: 0, lastAt: 0 };
      }
      byUser[oid].count += 1;
      const at = toMs(row.createdAt) || 0;
      if (at > byUser[oid].lastAt) byUser[oid].lastAt = at;
    });
    const openids = Object.keys(byUser)
      .sort((a, b) => byUser[b].count - byUser[a].count)
      .slice(0, 60);
    const userMap = await loadUsersBrief(openids);
    let packTitle = packId;
    try {
      const snap = await db.collection('packs').doc(packId).get();
      packTitle = String((snap.data && (snap.data.title || snap.data.name)) || packId).trim();
    } catch (e) {
      /* ignore */
    }
    const list = openids.map((oid) => {
      const u = userMap[oid] || {};
      const row = byUser[oid];
      return {
        id: oid,
        openid: oid,
        title: u.nickName || resolveNickName('', oid),
        sub: `${row.count} 次 · ${u.isVip ? '包月中' : `积分 ${u.points}`}${
          u.vipMonthQuota ? ` · 月额 ${u.vipMonthQuota}` : ''
        }`,
        count: row.count,
        lastText: row.lastAt ? formatDate(row.lastAt) : '',
        points: u.points || 0,
        vipMonthQuota: u.vipMonthQuota || 0,
        isVip: !!u.isVip,
        vipExpireText: u.vipExpireText || '',
        kind: 'user',
      };
    });
    return {
      ok: true,
      data: {
        title: `${packTitle} · 下载用户`,
        kind: 'downloadUsers',
        scope,
        packId,
        list,
        emptyText: '该合集暂无下载用户',
      },
    };
  }

  if (kind === 'orders') {
    const orders = await fetchAllPaged('orders', { status: 'delivered' }, 'createdAt', 2000);
    const filtered = sinceMs
      ? filterSince(orders, sinceMs, orderTimeMs)
      : orders;
    const sorted = filtered
      .slice()
      .sort((a, b) => orderTimeMs(b) - orderTimeMs(a))
      .slice(0, 80);
    const userMap = await loadUsersBrief(sorted.map((o) => o.openid));
    const list = sorted.map((o) => {
      const oid = String(o.openid || '').trim();
      const u = userMap[oid] || {};
      const fen = Math.max(0, Number(o.priceFen) || 0);
      const at = orderTimeMs(o);
      return {
        id: o._id || o.outTradeNo || `${oid}-${at}`,
        openid: oid,
        title: String(o.title || o.productTitle || o.slotId || '订单').trim(),
        sub: `${u.nickName || resolveNickName('', oid)} · ${
          u.isVip ? '包月中' : `积分 ${u.points || 0}`
        }`,
        yuan: yuanStr(fen),
        timeText: at ? formatDate(at) : '',
        points: u.points || 0,
        vipMonthQuota: u.vipMonthQuota || 0,
        isVip: !!u.isVip,
        vipExpireText: u.vipExpireText || '',
        kind: 'order',
      };
    });
    return {
      ok: true,
      data: {
        title: `${titleScope} · 成交明细`,
        kind: 'orders',
        scope,
        list,
        emptyText: '该时段暂无成交',
      },
    };
  }

  if (kind === 'librarySources') {
    const where = sinceDate ? { createdAt: _.gte(sinceDate) } : null;
    const logs = await fetchAllPaged('library_logs', where, 'createdAt', 3000);
    const bySource = {};
    logs.forEach((row) => {
      const sid = String(row.sourceId || '').trim() || '_unknown';
      if (!bySource[sid]) {
        bySource[sid] = { id: sid, count: 0, users: new Set() };
      }
      bySource[sid].count += 1;
      if (row.openid) bySource[sid].users.add(row.openid);
    });
    const sourceIds = Object.keys(bySource)
      .filter((id) => id !== '_unknown')
      .sort((a, b) => bySource[b].count - bySource[a].count)
      .slice(0, 40);
    const titleMap = {};
    await Promise.all(
      sourceIds.map(async (id) => {
        try {
          const snap = await db.collection('lib_sources').doc(id).get();
          titleMap[id] = String((snap.data && (snap.data.title || snap.data.name)) || id).trim();
        } catch (e) {
          titleMap[id] = id;
        }
      }),
    );
    const list = sourceIds.map((id) => ({
      id,
      title: titleMap[id] || id,
      count: bySource[id].count,
      users: bySource[id].users.size,
      kind: 'librarySource',
    }));
    if (bySource._unknown) {
      list.push({
        id: '_unknown',
        title: '未归类源',
        count: bySource._unknown.count,
        users: bySource._unknown.users.size,
        kind: 'librarySource',
      });
    }
    return {
      ok: true,
      data: {
        title: `${titleScope} · 素材库下载`,
        kind: 'librarySources',
        scope,
        list,
        emptyText: '该时段暂无素材下载（部署 library_logs 后开始统计）',
      },
    };
  }

  if (kind === 'libraryUsers') {
    const sourceId = String(event.sourceId || '').trim();
    const where = { ...(sinceDate ? { createdAt: _.gte(sinceDate) } : {}) };
    if (sourceId && sourceId !== '_unknown') where.sourceId = sourceId;
    const logs = await fetchAllPaged('library_logs', where, 'createdAt', 2000);
    const filtered =
      sourceId === '_unknown'
        ? logs.filter((r) => !String(r.sourceId || '').trim())
        : logs;
    const byUser = {};
    filtered.forEach((row) => {
      const oid = String(row.openid || '').trim();
      if (!oid) return;
      if (!byUser[oid]) byUser[oid] = { openid: oid, count: 0, lastAt: 0 };
      byUser[oid].count += 1;
      const at = toMs(row.createdAt) || 0;
      if (at > byUser[oid].lastAt) byUser[oid].lastAt = at;
    });
    const openids = Object.keys(byUser)
      .sort((a, b) => byUser[b].count - byUser[a].count)
      .slice(0, 60);
    const userMap = await loadUsersBrief(openids);
    const list = openids.map((oid) => {
      const u = userMap[oid] || {};
      const row = byUser[oid];
      return {
        id: oid,
        openid: oid,
        title: u.nickName || resolveNickName('', oid),
        sub: `${row.count} 次 · ${u.isVip ? '包月中' : `积分 ${u.points}`}`,
        count: row.count,
        lastText: row.lastAt ? formatDate(row.lastAt) : '',
        points: u.points || 0,
        vipMonthQuota: u.vipMonthQuota || 0,
        isVip: !!u.isVip,
        vipExpireText: u.vipExpireText || '',
        kind: 'user',
      };
    });
    return {
      ok: true,
      data: {
        title: '素材下载用户',
        kind: 'libraryUsers',
        scope,
        sourceId,
        list,
        emptyText: '暂无用户',
      },
    };
  }

  if (kind === 'workshop') {
    const where = {
      reason: _.in(WORKSHOP_REASONS),
      ...(sinceDate ? { createdAt: _.gte(sinceDate) } : {}),
    };
    const logs = await fetchAllPaged('points_logs', where, 'createdAt', 3000);
    const byReason = {};
    WORKSHOP_REASONS.forEach((r) => {
      byReason[r] = { id: r, count: 0, users: new Set() };
    });
    logs.forEach((row) => {
      const reason = String(row.reason || '').trim();
      if (!byReason[reason]) return;
      byReason[reason].count += 1;
      if (row.openid) byReason[reason].users.add(row.openid);
    });
    const list = WORKSHOP_REASONS.map((r) => ({
      id: r,
      title: WORKSHOP_LABEL[r] || r,
      count: byReason[r].count,
      users: byReason[r].users.size,
      kind: 'workshopFeature',
    }));
    return {
      ok: true,
      data: {
        title: `${titleScope} · 趣味工坊`,
        kind: 'workshop',
        scope,
        list,
        emptyText: '该时段暂无工坊付费使用',
      },
    };
  }

  if (kind === 'workshopUsers') {
    const reason = String(event.feature || event.reason || '').trim();
    if (!WORKSHOP_REASONS.includes(reason)) {
      return { ok: false, code: 'BAD_PARAM', message: '未知功能' };
    }
    const where = {
      reason,
      ...(sinceDate ? { createdAt: _.gte(sinceDate) } : {}),
    };
    const logs = await fetchAllPaged('points_logs', where, 'createdAt', 2000);
    const byUser = {};
    logs.forEach((row) => {
      const oid = String(row.openid || '').trim();
      if (!oid) return;
      if (!byUser[oid]) byUser[oid] = { openid: oid, count: 0, lastAt: 0 };
      byUser[oid].count += 1;
      const at = toMs(row.createdAt) || 0;
      if (at > byUser[oid].lastAt) byUser[oid].lastAt = at;
    });
    const openids = Object.keys(byUser)
      .sort((a, b) => byUser[b].count - byUser[a].count)
      .slice(0, 60);
    const userMap = await loadUsersBrief(openids);
    const list = openids.map((oid) => {
      const u = userMap[oid] || {};
      const row = byUser[oid];
      return {
        id: oid,
        openid: oid,
        title: u.nickName || resolveNickName('', oid),
        sub: `${row.count} 次 · ${u.isVip ? '包月中' : `积分 ${u.points}`}`,
        count: row.count,
        lastText: row.lastAt ? formatDate(row.lastAt) : '',
        points: u.points || 0,
        vipMonthQuota: u.vipMonthQuota || 0,
        isVip: !!u.isVip,
        vipExpireText: u.vipExpireText || '',
        kind: 'user',
      };
    });
    return {
      ok: true,
      data: {
        title: `${WORKSHOP_LABEL[reason] || reason} · 用户`,
        kind: 'workshopUsers',
        scope,
        reason,
        list,
        emptyText: '暂无用户',
      },
    };
  }

  return { ok: false, code: 'BAD_PARAM', message: '未知下钻类型' };
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

  const action = String((event && event.action) || 'summary').trim();
  if (action === 'drill') {
    try {
      return await handleDrill(event);
    } catch (e) {
      console.error(e);
      return {
        ok: false,
        code: 'DRILL_FAIL',
        message: e.message || '下钻失败',
      };
    }
  }

  const force = !!(event && event.force);

  try {
    if (!force) {
      const cached = await readDashboardCache();
      if (cached && cached.periods && cached.summary && cached.summary.librarySources != null) {
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
      librarySources,
      libraryItems,
      libraryLogsToday,
      libraryLogsWeek,
      libraryLogsMonth,
      libraryDownloadsAll,
      workshopTodayRows,
      workshopWeekRows,
      workshopMonthRows,
      workshopAllRows,
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
      safeCount('lib_sources'),
      safeCount('lib_items', { status: 'published' }),
      fetchAll('library_logs', { createdAt: _.gte(todayStart) }, 'createdAt', MAX),
      fetchAll('library_logs', { createdAt: _.gte(weekStart) }, 'createdAt', MAX),
      fetchAll('library_logs', { createdAt: _.gte(monthStart) }, 'createdAt', MAX),
      safeCount('library_logs'),
      fetchAll(
        'points_logs',
        { reason: _.in(WORKSHOP_REASONS), createdAt: _.gte(todayStart) },
        'createdAt',
        MAX,
      ),
      fetchAll(
        'points_logs',
        { reason: _.in(WORKSHOP_REASONS), createdAt: _.gte(weekStart) },
        'createdAt',
        MAX,
      ),
      fetchAll(
        'points_logs',
        { reason: _.in(WORKSHOP_REASONS), createdAt: _.gte(monthStart) },
        'createdAt',
        MAX,
      ),
      fetchAll('points_logs', { reason: _.in(WORKSHOP_REASONS) }, 'createdAt', MAX),
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

    let libraryDownloadsAllSafe = libraryDownloadsAll;
    // library_logs 上线前的历史量：回退到各源上的 downloadCount 合计
    if (!libraryDownloadsAllSafe) {
      try {
        const sources = await fetchAll('lib_sources', null, 'updatedAt', MAX);
        libraryDownloadsAllSafe = sources.reduce(
          (s, row) => s + Math.max(0, Number(row.downloadCount) || 0),
          0,
        );
      } catch (e) {
        libraryDownloadsAllSafe = 0;
      }
    }
    const libraryToday = (libraryLogsToday || []).length;
    const libraryWeek = (libraryLogsWeek || []).length;
    const libraryMonth = (libraryLogsMonth || []).length;
    const libraryActiveToday = new Set(
      (libraryLogsToday || []).map((r) => r.openid).filter(Boolean),
    ).size;
    const workshopToday = (workshopTodayRows || []).length;
    const workshopWeek = (workshopWeekRows || []).length;
    const workshopMonth = (workshopMonthRows || []).length;
    const workshopAll = (workshopAllRows || []).length;
    const workshopByReasonToday = {};
    WORKSHOP_REASONS.forEach((r) => {
      workshopByReasonToday[r] = 0;
    });
    (workshopTodayRows || []).forEach((row) => {
      const reason = String(row.reason || '').trim();
      if (workshopByReasonToday[reason] != null) workshopByReasonToday[reason] += 1;
    });

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
        librarySources,
        libraryItems,
        libraryDownloadsToday: libraryToday,
        libraryActiveToday,
        libraryDownloadsAll: libraryDownloadsAllSafe,
        workshopUsesToday: workshopToday,
        workshopBeadToday:
          (workshopByReasonToday.bead_export || 0) +
          (workshopByReasonToday.bead_advanced || 0),
        workshopImageToday: workshopByReasonToday.image_export || 0,
      },
      periods: {
        week: {
          ...periodBlock(newUsersWeek, downloadsWeek, weekOrders, {
            libraryDownloads: libraryWeek,
            workshopUses: workshopWeek,
          }),
          revenueTrend: weekTrend,
        },
        month: {
          ...periodBlock(newUsersMonth, downloadsMonth, monthOrders, {
            libraryDownloads: libraryMonth,
            workshopUses: workshopMonth,
          }),
          revenueTrend: monthTrend,
        },
        all: {
          ...periodBlock(usersTotal, downloadsAll, ordersDelivered, {
            libraryDownloads: libraryDownloadsAllSafe,
            workshopUses: workshopAll,
          }),
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
