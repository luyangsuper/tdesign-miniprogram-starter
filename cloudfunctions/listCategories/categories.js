const BUILTIN_CATEGORIES = [
  { id: 'spongebob', name: '海绵宝宝', builtin: true, sort: 1 },
  { id: 'doraemon', name: '哆啦A梦', builtin: true, sort: 2 },
  { id: 'kuromi', name: '库洛米', builtin: true, sort: 3 },
  { id: 'shinchan', name: '蜡笔小新', builtin: true, sort: 4 },
];

async function ensureAndListCategories(db) {
  const col = db.collection('categories');
  let list = [];
  try {
    const res = await col.orderBy('sort', 'asc').limit(100).get();
    list = res.data || [];
  } catch (e) {
    try {
      const res = await col.limit(100).get();
      list = res.data || [];
    } catch (err) {
      return BUILTIN_CATEGORIES.map((c) => ({ ...c, status: 'active' }));
    }
  }

  const existingIds = new Set(list.map((c) => c.id || c._id));
  for (let i = 0; i < BUILTIN_CATEGORIES.length; i += 1) {
    const item = BUILTIN_CATEGORIES[i];
    if (existingIds.has(item.id)) continue;
    try {
      // eslint-disable-next-line no-await-in-loop
      await col.add({
        data: {
          id: item.id,
          name: item.name,
          builtin: true,
          sort: item.sort,
          status: 'active',
          createdAt: db.serverDate(),
          updatedAt: db.serverDate(),
        },
      });
      list.push({ ...item, status: 'active' });
    } catch (err) {
      console.warn('seed category', item.id, err.message);
    }
  }

  return list
    .filter((c) => c.status !== 'disabled')
    .map((c) => ({
      id: c.id || c._id,
      name: c.name,
      builtin: !!c.builtin,
      sort: c.sort || 0,
    }))
    .sort((a, b) => (a.sort || 0) - (b.sort || 0));
}

module.exports = { BUILTIN_CATEGORIES, ensureAndListCategories };
