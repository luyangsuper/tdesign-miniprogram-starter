const cloud = require('wx-server-sdk');
const { ensureAndListCategories } = require('./categories');
const { CONTENT_TYPES } = require('./contentType');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const COUNT_TTL_MS = 2 * 60 * 1000;

function cacheDocId(contentTypeKey) {
  const key = String(contentTypeKey || 'all').trim() || 'all';
  return key === 'all' ? 'category_counts' : `category_counts_${key}`;
}

/** all | emoji|wallpaper|avatar|video */
function resolveTypeKey(raw) {
  const t = String(raw || 'all').trim() || 'all';
  if (t === 'all') return 'all';
  return CONTENT_TYPES.includes(t) ? t : 'all';
}

function buildTypeCond(typeKey) {
  if (!typeKey || typeKey === 'all') return null;
  if (typeKey === 'emoji') {
    return _.or([
      { contentType: 'emoji' },
      { contentType: _.exists(false) },
      { contentType: null },
      { contentType: '' },
    ]);
  }
  return { contentType: typeKey };
}

function withType(base, typeCond) {
  if (!typeCond) return base;
  return _.and([base, typeCond]);
}

async function countWhere(where) {
  try {
    const res = await db.collection('packs').where(where).count();
    return res.total || 0;
  } catch (e) {
    console.warn('count fail', e.message);
    return 0;
  }
}

async function readCountCache(typeKey) {
  try {
    const snap = await db.collection('app_config').doc(cacheDocId(typeKey)).get();
    const row = snap.data || {};
    const at = Number(row.at) || 0;
    if (!at || !row.payload) return null;
    if (Date.now() - at > COUNT_TTL_MS) return null;
    // 必须带类型标记，避免旧缓存（无 contentTypeKey）被误用
    if (row.contentTypeKey !== typeKey) return null;
    return row.payload;
  } catch (e) {
    return null;
  }
}

async function writeCountCache(typeKey, payload) {
  const docId = cacheDocId(typeKey);
  const data = {
    at: Date.now(),
    contentTypeKey: typeKey,
    payload,
    updatedAt: db.serverDate(),
  };
  try {
    await db.collection('app_config').doc(docId).set({ data });
  } catch (e) {
    try {
      await db.createCollection('app_config');
      await db.collection('app_config').doc(docId).set({ data });
    } catch (err) {
      console.warn('[categories] cache write', err.message || err);
    }
  }
}

async function buildFilters(categories, typeKey) {
  const typeCond = buildTypeCond(typeKey);
  const published = { status: 'published' };

  const [allCount, uncategorizedCount, ...catCounts] = await Promise.all([
    countWhere(withType(published, typeCond)),
    countWhere(
      withType(
        _.and([
          published,
          _.or([
            { categoryId: _.exists(false) },
            { categoryId: null },
            { categoryId: '' },
          ]),
        ]),
        typeCond,
      ),
    ),
    ...categories.map((c) =>
      countWhere(withType({ status: 'published', categoryId: c.id }, typeCond)),
    ),
  ]);

  const withCounts = categories
    .map((c, i) => {
      const count = catCounts[i] || 0;
      return {
        ...c,
        count,
        label: c.name,
      };
    })
    .sort((a, b) => (b.count || 0) - (a.count || 0) || (a.sort || 0) - (b.sort || 0));

  const others = [
    ...withCounts,
    {
      id: 'uncategorized',
      name: '未分类',
      count: uncategorizedCount,
      label: '未分类',
    },
  ].sort((a, b) => (b.count || 0) - (a.count || 0));

  const filters = [
    { id: 'all', name: '全部', count: allCount, label: '全部' },
    ...others,
  ];

  return { categories: withCounts, filters, contentType: typeKey };
}

exports.main = async (event = {}) => {
  try {
    const force = !!(event && event.force);
    const typeKey = resolveTypeKey(event && event.contentType);
    const categories = await ensureAndListCategories(db);

    if (!force) {
      const cached = await readCountCache(typeKey);
      if (cached && Array.isArray(cached.filters)) {
        return {
          ok: true,
          data: {
            categories: cached.categories || [],
            filters: cached.filters,
            contentType: typeKey,
            cached: true,
          },
        };
      }
    }

    const payload = await buildFilters(categories, typeKey);
    await writeCountCache(typeKey, payload);

    return {
      ok: true,
      data: {
        ...payload,
        cached: false,
      },
    };
  } catch (e) {
    console.error(e);
    return { ok: false, code: 'LIST_FAIL', message: e.message || '加载分类失败' };
  }
};
