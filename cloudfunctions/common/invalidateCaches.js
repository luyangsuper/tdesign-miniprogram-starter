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
  // 分类计数按 contentType 分文档缓存（all + 四类）
  await invalidateAppConfigDocs(db, [
    'category_counts',
    // listCategories「全部」实际写的是 novideo（排除视频），必须一并清
    'category_counts_novideo',
    'category_counts_emoji',
    'category_counts_wallpaper',
    'category_counts_avatar',
    'category_counts_video',
    'dashboard_cache',
  ]);
}

module.exports = {
  invalidateAppConfigDocs,
  invalidateListCaches,
};
