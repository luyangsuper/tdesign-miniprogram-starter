/**
 * 内容变更后清短缓存（分类计数 / 看板），下次请求重建。
 */
async function invalidateAppConfigDocs(db, docIds = []) {
  const ids = (docIds || []).filter(Boolean);
  await Promise.all(
    ids.map(async (id) => {
      try {
        await db.collection('app_config').doc(id).remove();
      } catch (e) {
        try {
          await db.collection('app_config').doc(id).set({
            data: { at: 0, payload: null, updatedAt: db.serverDate() },
          });
        } catch (err) {
          /* ignore */
        }
      }
    }),
  );
}

async function invalidateListCaches(db) {
  await invalidateAppConfigDocs(db, ['category_counts', 'dashboard_cache']);
}

module.exports = {
  invalidateAppConfigDocs,
  invalidateListCaches,
};
