const cloud = require('wx-server-sdk');
const { ensureAndListCategories } = require('./categories');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const COUNT_CACHE_DOC = 'category_counts';
const COUNT_TTL_MS = 2 * 60 * 1000;

async function countWhere(where) {
  try {
    const res = await db.collection('packs').where(where).count();
    return res.total || 0;
  } catch (e) {
    console.warn('count fail', e.message);
    return 0;
  }
}

async function readCountCache() {
  try {
    const snap = await db.collection('app_config').doc(COUNT_CACHE_DOC).get();
    const row = snap.data || {};
    const at = Number(row.at) || 0;
    if (!at || !row.payload) return null;
    if (Date.now() - at > COUNT_TTL_MS) return null;
    return row.payload;
  } catch (e) {
    return null;
  }
}

async function writeCountCache(payload) {
  try {
    await db.collection('app_config').doc(COUNT_CACHE_DOC).set({
      data: {
        at: Date.now(),
        payload,
        updatedAt: db.serverDate(),
      },
    });
  } catch (e) {
    try {
      await db.createCollection('app_config');
      await db.collection('app_config').doc(COUNT_CACHE_DOC).set({
        data: {
          at: Date.now(),
          payload,
          updatedAt: db.serverDate(),
        },
      });
    } catch (err) {
      console.warn('[categories] cache write', err.message || err);
    }
  }
}

async function buildFilters(categories) {
  const [allCount, uncategorizedCount, ...catCounts] = await Promise.all([
    countWhere({ status: 'published' }),
    countWhere(
      _.and([
        { status: 'published' },
        _.or([{ categoryId: _.exists(false) }, { categoryId: null }, { categoryId: '' }]),
      ]),
    ),
    ...categories.map((c) => countWhere({ status: 'published', categoryId: c.id })),
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

  return { categories: withCounts, filters };
}

exports.main = async (event = {}) => {
  try {
    const force = !!(event && event.force);
    const categories = await ensureAndListCategories(db);

    if (!force) {
      const cached = await readCountCache();
      if (cached && Array.isArray(cached.filters)) {
        return {
          ok: true,
          data: {
            categories: cached.categories || [],
            filters: cached.filters,
            cached: true,
          },
        };
      }
    }

    const payload = await buildFilters(categories);
    await writeCountCache(payload);

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
