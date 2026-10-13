const cloud = require('wx-server-sdk');
const { ensureAndListCategories } = require('./categories');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

async function countWhere(where) {
  try {
    const res = await db.collection('packs').where(where).count();
    return res.total || 0;
  } catch (e) {
    console.warn('count fail', e.message);
    return 0;
  }
}

exports.main = async () => {
  try {
    const categories = await ensureAndListCategories(db);

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

    return {
      ok: true,
      data: {
        categories: withCounts,
        filters,
      },
    };
  } catch (e) {
    console.error(e);
    return { ok: false, code: 'LIST_FAIL', message: e.message || '加载分类失败' };
  }
};
