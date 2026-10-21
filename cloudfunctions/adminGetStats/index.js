const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const MAX = 100;

const FALLBACK_ADMINS = [];

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

function toMs(v) {
  if (!v) return 0;
  if (typeof v === 'number') return v;
  if (v instanceof Date) return v.getTime();
  if (v && typeof v.toDate === 'function') return v.toDate().getTime();
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function dayKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function buildDayBuckets(days) {
  const list = [];
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    list.push({
      date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      count: 0,
    });
  }
  return list;
}

async function safeCount(col, where) {
  try {
    const q = where ? col.where(where) : col;
    const res = await q.count();
    return res.total || 0;
  } catch (e) {
    return 0;
  }
}

/** 分页拉取近 N 日日志（最多 scanLimit 条） */
async function fetchRecentLogs(sinceMs, scanLimit) {
  const rows = [];
  let skip = 0;
  while (rows.length < scanLimit) {
    const limit = Math.min(MAX, scanLimit - rows.length);
    // eslint-disable-next-line no-await-in-loop
    let res;
    try {
      res = await db
        .collection('download_logs')
        .where({ createdAt: _.gte(new Date(sinceMs)) })
        .orderBy('createdAt', 'desc')
        .skip(skip)
        .limit(limit)
        .get();
    } catch (e) {
      try {
        // eslint-disable-next-line no-await-in-loop
        res = await db
          .collection('download_logs')
          .orderBy('createdAt', 'desc')
          .skip(skip)
          .limit(limit)
          .get();
      } catch (err) {
        break;
      }
    }
    const batch = res.data || [];
    if (!batch.length) break;
    batch.forEach((row) => {
      const ms = toMs(row.createdAt);
      if (ms >= sinceMs) rows.push(row);
    });
    skip += batch.length;
    if (batch.length < limit) break;
  }
  return rows;
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) {
    return { ok: false, code: 'NO_OPENID', message: '请先登录' };
  }
  if (!assertAdmin(OPENID)) {
    return { ok: false, code: 'FORBIDDEN', message: '无管理员权限' };
  }

  const days = Number(event.days) === 30 ? 30 : 7;
  const now = Date.now();
  const sinceMs = now - days * 24 * 60 * 60 * 1000;

  try {
    const usersCol = db.collection('users');
    const packsCol = db.collection('packs');
    const codesCol = db.collection('redeem_codes');

    const [
      userTotal,
      packTotal,
      codeUnused,
      codeUsed,
      codeDisabled,
      vipActive,
      withQuota,
      logs,
      topPacksRes,
    ] = await Promise.all([
      safeCount(usersCol),
      safeCount(packsCol, { status: 'published' }),
      safeCount(codesCol, { status: 'unused' }),
      safeCount(codesCol, { status: 'used' }),
      safeCount(codesCol, { status: 'disabled' }),
      safeCount(usersCol, { vipExpireAt: _.gt(new Date()) }),
      safeCount(usersCol, { downloadQuota: _.gt(0) }),
      fetchRecentLogs(sinceMs, 2000),
      packsCol
        .where({ status: 'published' })
        .orderBy('downloadCount', 'desc')
        .limit(8)
        .field({ title: true, downloadCount: true })
        .get()
        .catch(() => ({ data: [] })),
    ]);

    const buckets = buildDayBuckets(days);
    const bucketMap = {};
    buckets.forEach((b) => {
      bucketMap[b.date] = b;
    });

    const grants = { vip: 0, quota: 0, ad: 0, unknown: 0 };
    logs.forEach((row) => {
      const key = dayKey(toMs(row.createdAt));
      if (bucketMap[key]) bucketMap[key].count += 1;
      const g = row.grantType;
      if (g === 'vip' || g === 'quota' || g === 'ad') grants[g] += 1;
      else grants.unknown += 1;
    });

    const downloadsOverTime = buckets.map((b) => ({ ...b }));
    const maxDay = Math.max(1, ...downloadsOverTime.map((b) => b.count));
    downloadsOverTime.forEach((b) => {
      b.percent = Math.round((b.count / maxDay) * 100);
    });

    const grantTotal = grants.vip + grants.quota + grants.ad + grants.unknown || 0;
    const grantDenom = grantTotal || 1;
    const grantBars = [
      { key: 'vip', label: 'VIP', count: grants.vip, color: 'warning' },
      { key: 'quota', label: '次数', count: grants.quota, color: 'primary' },
      { key: 'ad', label: '广告', count: grants.ad, color: 'success' },
      { key: 'unknown', label: '未知', count: grants.unknown, color: 'default' },
    ].map((item) => ({
      ...item,
      percent: Math.round((item.count / grantDenom) * 100),
    }));

    const topPacks = (topPacksRes.data || []).map((p) => ({
      packId: p._id,
      title: p.title || '未命名',
      downloadCount: p.downloadCount || 0,
    }));
    const maxPack = Math.max(1, ...topPacks.map((p) => p.downloadCount), 1);
    topPacks.forEach((p) => {
      p.percent = Math.round((p.downloadCount / maxPack) * 100);
    });

    return {
      ok: true,
      data: {
        days,
        summary: {
          userTotal,
          vipActive,
          withQuota,
          packTotal,
          downloadRecent: logs.length,
          truncated: logs.length >= 2000,
        },
        downloadsOverTime,
        grants,
        grantBars,
        topPacks,
        codes: {
          unused: codeUnused,
          used: codeUsed,
          disabled: codeDisabled,
        },
      },
    };
  } catch (e) {
    console.error(e);
    return { ok: false, code: 'FAIL', message: e.message || '统计失败' };
  }
};
