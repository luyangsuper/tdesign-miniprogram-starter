async function resolveCategory(db, categoryId) {
  if (!categoryId) return null;
  try {
    const res = await db.collection('categories').where({ id: categoryId }).limit(1).get();
    const doc = (res.data || [])[0];
    if (doc) return { id: doc.id || doc._id, name: doc.name };
  } catch (e) {
    console.warn(e.message);
  }
  const builtins = {
    spongebob: '海绵宝宝',
    doraemon: '哆啦A梦',
    kuromi: '库洛米',
    shinchan: '蜡笔小新',
  };
  if (builtins[categoryId]) return { id: categoryId, name: builtins[categoryId] };
  return null;
}

module.exports = { resolveCategory };
