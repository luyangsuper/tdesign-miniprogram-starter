const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

/**
 * 表情包列表：支持 keyword / categoryId 筛选
 * categoryId: all | uncategorized | 具体 id
 */
exports.main = async (event) => {
  const page = Math.max(1, Number(event.page) || 1);
  const pageSize = Math.min(20, Math.max(1, Number(event.pageSize) || 10));
  const skip = (page - 1) * pageSize;
  const keyword = String(event.keyword || '')
    .trim()
    .slice(0, 40);
  const categoryId = String(event.categoryId || 'all').trim() || 'all';

  try {
    const conds = [{ status: 'published' }];

    if (keyword) {
      const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      conds.push({
        title: db.RegExp({ regexp: escaped, options: 'i' }),
      });
    }

    if (categoryId === 'uncategorized') {
      conds.push(
        _.or([
          { categoryId: _.exists(false) },
          { categoryId: null },
          { categoryId: '' },
        ]),
      );
    } else if (categoryId && categoryId !== 'all') {
      conds.push({ categoryId });
    }

    const where = conds.length === 1 ? conds[0] : _.and(conds);

    const countRes = await db.collection('packs').where(where).count();
    const listRes = await db
      .collection('packs')
      .where(where)
      .orderBy('createdAt', 'desc')
      .skip(skip)
      .limit(pageSize)
      .field({
        title: true,
        description: true,
        coverFileID: true,
        previewCount: true,
        emojiCount: true,
        downloadCount: true,
        categoryId: true,
        categoryName: true,
        coverWidth: true,
        coverHeight: true,
        createdAt: true,
      })
      .get();

    // 首页只展示封面，不拉预览图
    const packs = listRes.data || [];
    const fileIds = packs.map((p) => p.coverFileID).filter(Boolean);

    const urlMap = {};
    if (fileIds.length) {
      for (let i = 0; i < fileIds.length; i += 50) {
        const chunk = fileIds.slice(i, i + 50);
        // eslint-disable-next-line no-await-in-loop
        const temp = await cloud.getTempFileURL({ fileList: chunk });
        (temp.fileList || []).forEach((item) => {
          urlMap[item.fileID] = item.tempFileURL;
        });
      }
    }

    const list = packs.map((p) => {
      const coverUrl = urlMap[p.coverFileID] || '';
      const cw = Number(p.coverWidth) || 0;
      const ch = Number(p.coverHeight) || 0;
      const coverRatio = cw > 0 && ch > 0 ? ch / cw : 0;
      return {
        _id: p._id,
        title: p.title,
        description: p.description || '',
        coverUrl,
        coverRatio,
        previewUrls: [],
        slides: coverUrl ? [coverUrl] : [],
        previewCount: p.previewCount || 0,
        emojiCount: p.emojiCount || 0,
        downloadCount: p.downloadCount || 0,
        categoryId: p.categoryId || '',
        categoryName: p.categoryName || '',
      };
    });

    return {
      ok: true,
      data: {
        list,
        page,
        pageSize,
        total: countRes.total || 0,
        hasMore: skip + packs.length < (countRes.total || 0),
      },
    };
  } catch (e) {
    console.error(e);
    return { ok: false, code: 'LIST_FAIL', message: e.message || '加载失败' };
  }
};
