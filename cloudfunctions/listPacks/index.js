const cloud = require('wx-server-sdk');
const { resolveTempUrls } = require('./tempUrlCache');
const { normalizeContentType, CONTENT_TYPES } = require('./contentType');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

function buildContentTypeCond(contentType) {
  const raw = String(contentType || 'all').trim() || 'all';
  if (!raw || raw === 'all') return null;
  if (!CONTENT_TYPES.includes(raw)) return null;
  if (raw === 'emoji') {
    return _.or([
      { contentType: 'emoji' },
      { contentType: _.exists(false) },
      { contentType: null },
      { contentType: '' },
    ]);
  }
  return { contentType: raw };
}

function buildKeywordCond(keyword) {
  if (!keyword) return null;
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = db.RegExp({ regexp: escaped, options: 'i' });
  return _.or([
    { title: re },
    { description: re },
    { categoryName: re },
  ]);
}

function buildCategoryConds(categoryId) {
  if (categoryId === 'uncategorized') {
    return _.or([
      { categoryId: _.exists(false) },
      { categoryId: null },
      { categoryId: '' },
    ]);
  }
  if (categoryId && categoryId !== 'all') {
    return { categoryId };
  }
  return null;
}

const PACK_FIELDS = {
  title: true,
  description: true,
  contentType: true,
  coverFileID: true,
  previewFileIDs: true,
  previewCount: true,
  emojiCount: true,
  downloadCount: true,
  categoryId: true,
  categoryName: true,
  coverWidth: true,
  coverHeight: true,
  createdAt: true,
};

function resolveCoverFileID(pack) {
  if (pack && pack.coverFileID) return pack.coverFileID;
  // 视频可不传封面：列表用首张预览图顶上
  if (pack && normalizeContentType(pack.contentType) === 'video') {
    const first = Array.isArray(pack.previewFileIDs) ? pack.previewFileIDs.find(Boolean) : '';
    return first || '';
  }
  return '';
}

async function mapPacksWithCovers(packs, { forceRefresh = false } = {}) {
  const fileIds = packs.map((p) => resolveCoverFileID(p)).filter(Boolean);
  const urlMap = await resolveTempUrls(cloud, fileIds, { forceRefresh });
  return packs.map((p) => {
    const coverId = resolveCoverFileID(p);
    const coverUrl = (coverId && urlMap[coverId]) || '';
    const cw = Number(p.coverWidth) || 0;
    const ch = Number(p.coverHeight) || 0;
    const coverRatio = cw > 0 && ch > 0 ? ch / cw : 0;
    return {
      _id: p._id,
      title: p.title,
      description: p.description || '',
      contentType: normalizeContentType(p.contentType),
      coverFileID: coverId || '',
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
}

/**
 * 合集列表：keyword / categoryId / contentType；按 createdAt 倒序
 */
exports.main = async (event = {}) => {
  const page = Math.max(1, Number(event.page) || 1);
  const pageSize = Math.min(20, Math.max(1, Number(event.pageSize) || 10));
  const skip = (page - 1) * pageSize;
  const keyword = String(event.keyword || '')
    .trim()
    .slice(0, 40);
  const categoryId = String(event.categoryId || 'all').trim() || 'all';
  const contentType = String(event.contentType || 'all').trim() || 'all';
  const forceRefresh = !!(event.forceRefresh || event.refreshCovers);

  try {
    const conds = [{ status: 'published' }];
    const kw = buildKeywordCond(keyword);
    if (kw) conds.push(kw);
    const cat = buildCategoryConds(categoryId);
    if (cat) conds.push(cat);
    const typeCond = buildContentTypeCond(contentType);
    if (typeCond) conds.push(typeCond);
    const where = conds.length === 1 ? conds[0] : _.and(conds);

    const countRes = await db.collection('packs').where(where).count();
    const listRes = await db
      .collection('packs')
      .where(where)
      .orderBy('createdAt', 'desc')
      .skip(skip)
      .limit(pageSize)
      .field(PACK_FIELDS)
      .get();

    const packs = listRes.data || [];
    const list = await mapPacksWithCovers(packs, { forceRefresh });

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
