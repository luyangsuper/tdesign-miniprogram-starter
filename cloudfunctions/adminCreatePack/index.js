const cloud = require('wx-server-sdk');
const { ensureAndListCategories } = require('./categories');
const { invalidateListCaches } = require('./invalidateCaches');

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

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) {
    return { ok: false, code: 'NO_OPENID', message: '请先登录' };
  }
  if (!assertAdmin(OPENID)) {
    return { ok: false, code: 'FORBIDDEN', message: '无管理权限' };
  }

  const title = (event.title || '').trim();
  const coverFileID = event.coverFileID;
  const previewFileIDs = Array.isArray(event.previewFileIDs) ? event.previewFileIDs.filter(Boolean) : [];
  const previewVideoFileID = String(event.previewVideoFileID || '').trim();
  const emojiFileIDs = Array.isArray(event.emojiFileIDs) ? event.emojiFileIDs.filter(Boolean) : [];
  // 与静态同序；空串表示该槽无动态
  const rawAnim = Array.isArray(event.emojiAnimFileIDs) ? event.emojiAnimFileIDs : [];
  const emojiAnimFileIDs = emojiFileIDs.map((_, i) => {
    const id = rawAnim[i];
    return id ? String(id) : '';
  });
  const status = event.status === 'draft' ? 'draft' : 'published';
  const categoryId = String(event.categoryId || '').trim();

  if (!title) {
    return { ok: false, code: 'BAD_PARAM', message: '请填写标题' };
  }
  if (!coverFileID) {
    return { ok: false, code: 'BAD_PARAM', message: '请上传封面' };
  }
  if (!emojiFileIDs.length) {
    return { ok: false, code: 'BAD_PARAM', message: '请至少上传一张静态原图' };
  }
  if (!categoryId) {
    return { ok: false, code: 'BAD_PARAM', message: '请选择分类' };
  }

  try {
    const categories = await ensureAndListCategories(db);
    const cat = categories.find((c) => c.id === categoryId);
    if (!cat) {
      return { ok: false, code: 'BAD_PARAM', message: '分类不存在' };
    }

    const pairKeys = Array.isArray(event.pairKeys) ? event.pairKeys.filter(Boolean) : [];

    const addRes = await db.collection('packs').add({
      data: {
        title,
        description: String(event.description || '').replace(/\r\n/g, '\n').trim().slice(0, 800),
        staticDriveUrl: String(event.staticDriveUrl || '').trim().slice(0, 500),
        animDriveUrl: String(event.animDriveUrl || '').trim().slice(0, 500),
        coverFileID,
        coverWidth: Math.max(0, Number(event.coverWidth) || 0),
        coverHeight: Math.max(0, Number(event.coverHeight) || 0),
        previewFileIDs,
        previewVideoFileID,
        emojiFileIDs,
        emojiAnimFileIDs,
        pairKeys,
        previewCount: previewFileIDs.length + (previewVideoFileID ? 1 : 0),
        emojiCount: emojiFileIDs.length,
        downloadCount: 0,
        categoryId: cat.id,
        categoryName: cat.name,
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
        categoryName: cat.name,
        emojiCount: emojiFileIDs.length,
      },
    };
  } catch (e) {
    console.error(e);
    return { ok: false, code: 'CREATE_FAIL', message: e.message || '创建失败' };
  }
};
