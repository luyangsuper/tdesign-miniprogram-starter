const BUILTIN_CATEGORIES = [
  { id: 'spongebob', name: '海绵宝宝', builtin: true, sort: 1 },
  { id: 'doraemon', name: '哆啦A梦', builtin: true, sort: 2 },
  { id: 'kuromi', name: '库洛米', builtin: true, sort: 3 },
  { id: 'shinchan', name: '蜡笔小新', builtin: true, sort: 4 },
];

const CATEGORY_MAX_LEN = 32;

function normalizeCategoryName(raw) {
  const name = String(raw || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!name || name.length > CATEGORY_MAX_LEN) return null;
  return name;
}

function isBuiltinId(id) {
  return BUILTIN_CATEGORIES.some((c) => c.id === id);
}

function createCustomCategoryId() {
  const rand = Math.random().toString(36).slice(2, 12);
  return `c_${Date.now().toString(36)}_${rand}`;
}

/** 与 config.js / login 兜底一致；环境变量 ADMIN_OPENIDS 可覆盖 */
const FALLBACK_ADMINS = ['oOtg0xqcOEHgBAL7u3M7g9S8ln2c'];

function getAdminList() {
  const fromEnv = process.env.ADMIN_OPENIDS || '';
  if (fromEnv.trim()) {
    return fromEnv.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return FALLBACK_ADMINS;
}

function assertAdmin(openid) {
  return getAdminList().includes(openid);
}

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

async function resolveCategory(db, categoryId) {
  if (!categoryId) return null;
  try {
    const res = await db.collection('categories').where({ id: categoryId }).limit(1).get();
    const doc = (res.data || [])[0];
    if (doc) return { id: doc.id || doc._id, name: doc.name };
  } catch (e) {
    console.warn(e.message);
  }
  const hit = BUILTIN_CATEGORIES.find((c) => c.id === categoryId);
  if (hit) return { id: hit.id, name: hit.name };
  return null;
}

module.exports = {
  BUILTIN_CATEGORIES,
  normalizeCategoryName,
  isBuiltinId,
  createCustomCategoryId,
  ensureAndListCategories,
  resolveCategory,
  assertAdmin,
};
