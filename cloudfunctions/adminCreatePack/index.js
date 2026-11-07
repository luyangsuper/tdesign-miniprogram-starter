const cloud = require('wx-server-sdk');
const { ensureAndListCategories } = require('./categories');
const { invalidateListCaches } = require('./invalidateCaches');
const {
  normalizeContentType,
  isEmojiType,
  isCategoryOptional,
  contentTypeLabel,
} = require('./contentType');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

const FALLBACK_ADMINS = ['oOtg0xqcOEHgBAL7u3M7g9S8ln2c'];

function getAdminList() {
  const fromEnv = process.env.ADMIN_OPENIDS || '';
  if (fromEnv.trim()) {
    return fromEnv.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return FALLBACK_ADMINS;
}

function assertAdmin(openid) {
  const admins = getAdminList();
  return admins.includes(openid);
}

function originalsRequiredMessage(contentType) {
  const type = normalizeContentType(contentType);
  if (type === 'video') return '请至少上传一段原视频';
  if (type === 'avatar') return '请至少上传一张头像原图';
  if (type === 'wallpaper') return '请至少上传一张壁纸原图';
  return '请至少上传一张静态原图';
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) {
    return { ok: false, code: 'NO_OPENID', message: '请先登录' };
  }
  if (!assertAdmin(OPENID)) {
    return { ok: false, code: 'FORBIDDEN', message: '无管理权限' };
  }

  const contentType = normalizeContentType(event.contentType);
  const title = (event.title || '').trim();
  const coverFileID = event.coverFileID;
  const previewFileIDs = Array.isArray(event.previewFileIDs) ? event.previewFileIDs.filter(Boolean) : [];
  const previewVideoFileID = String(event.previewVideoFileID || '').trim();
  const emojiFileIDs = Array.isArray(event.emojiFileIDs) ? event.emojiFileIDs.filter(Boolean) : [];
  const rawAnim = Array.isArray(event.emojiAnimFileIDs) ? event.emojiAnimFileIDs : [];
  const emojiAnimFileIDs = isEmojiType(contentType)
    ? emojiFileIDs.map((_, i) => {
        const id = rawAnim[i];
        return id ? String(id) : '';
      })
    : emojiFileIDs.map(() => '');
  const status = event.status === 'draft' ? 'draft' : 'published';
  const categoryId = String(event.categoryId || '').trim();

  if (!title) {
    return { ok: false, code: 'BAD_PARAM', message: '请填写标题' };
  }
  // 视频封面可选（客户端可用预览图 / 视频缩略图顶上）
  if (!coverFileID && contentType !== 'video') {
    return { ok: false, code: 'BAD_PARAM', message: '请上传封面' };
  }
  if (!emojiFileIDs.length) {
    return { ok: false, code: 'BAD_PARAM', message: originalsRequiredMessage(contentType) };
  }
  if (!isCategoryOptional(contentType) && !categoryId) {
    return { ok: false, code: 'BAD_PARAM', message: '请选择分类' };
  }

  try {
    let cat = null;
    if (categoryId) {
      const categories = await ensureAndListCategories(db);
      cat = categories.find((c) => c.id === categoryId) || null;
      if (!cat) {
        return { ok: false, code: 'BAD_PARAM', message: '分类不存在' };
      }
    }

    const pairKeys = Array.isArray(event.pairKeys) ? event.pairKeys.filter(Boolean) : [];
    const staticDriveUrl = String(event.staticDriveUrl || '').trim().slice(0, 500);
    const animDriveUrl = isEmojiType(contentType)
      ? String(event.animDriveUrl || '').trim().slice(0, 500)
      : '';

    const addRes = await db.collection('packs').add({
      data: {
        title,
        description: String(event.description || '').replace(/\r\n/g, '\n').trim().slice(0, 800),
        contentType,
        staticDriveUrl,
        animDriveUrl,
        coverFileID: coverFileID || '',
        coverWidth: coverFileID ? Math.max(0, Number(event.coverWidth) || 0) : 0,
        coverHeight: coverFileID ? Math.max(0, Number(event.coverHeight) || 0) : 0,
        previewFileIDs,
        previewVideoFileID,
        emojiFileIDs,
        emojiAnimFileIDs,
        pairKeys,
        previewCount: previewFileIDs.length + (previewVideoFileID ? 1 : 0),
        emojiCount: emojiFileIDs.length,
        downloadCount: 0,
        categoryId: cat ? cat.id : '',
        categoryName: cat ? cat.name : '',
        status,
        createdBy: OPENID,
        createdAt: db.serverDate(),
        updatedAt: db.serverDate(),
      },
    });

    await invalidateListCaches(db);
    return {
      ok: true,
      data: {
        _id: addRes._id,
        title,
        contentType,
        contentTypeName: contentTypeLabel(contentType),
        categoryName: cat ? cat.name : '',
        emojiCount: emojiFileIDs.length,
      },
    };
  } catch (e) {
    console.error(e);
    return { ok: false, code: 'CREATE_FAIL', message: e.message || '创建失败' };
  }
};
