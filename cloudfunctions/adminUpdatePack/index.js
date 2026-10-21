const cloud = require('wx-server-sdk');
const { resolveCategory } = require('./categories');
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
  return getAdminList().includes(openid);
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { ok: false, code: 'NO_OPENID', message: '请先登录' };
  if (!assertAdmin(OPENID)) return { ok: false, code: 'FORBIDDEN', message: '无管理权限' };

  const packId = event.packId || event.id;
  const title = (event.title || '').trim();
  const categoryId = String(event.categoryId || '').trim();
  const coverFileID = event.coverFileID;
  const previewFileIDs = Array.isArray(event.previewFileIDs) ? event.previewFileIDs.filter(Boolean) : [];
  const previewVideoFileID = String(event.previewVideoFileID || '').trim();
  const emojiFileIDs = Array.isArray(event.emojiFileIDs) ? event.emojiFileIDs.filter(Boolean) : [];
  const rawAnim = Array.isArray(event.emojiAnimFileIDs) ? event.emojiAnimFileIDs : [];
  const emojiAnimFileIDs = emojiFileIDs.map((_, i) => {
    const id = rawAnim[i];
    return id ? String(id) : '';
  });

  if (!packId) return { ok: false, code: 'BAD_PARAM', message: '缺少 packId' };
  if (!title) return { ok: false, code: 'BAD_PARAM', message: '请填写标题' };
  if (!categoryId) return { ok: false, code: 'BAD_PARAM', message: '请选择分类' };
  if (!coverFileID) return { ok: false, code: 'BAD_PARAM', message: '请上传封面' };
  if (!emojiFileIDs.length) return { ok: false, code: 'BAD_PARAM', message: '请至少上传一张静态原图' };

  try {
    const doc = await db.collection('packs').doc(packId).get();
    if (!doc.data) return { ok: false, code: 'NOT_FOUND', message: '合集不存在' };

    const cat = await resolveCategory(db, categoryId);
    if (!cat) return { ok: false, code: 'BAD_PARAM', message: '分类不存在' };

    const old = doc.data;
    const oldFiles = [
      old.coverFileID,
      old.previewVideoFileID,
      ...(old.previewFileIDs || []),
      ...(old.emojiFileIDs || []),
      ...(old.emojiAnimFileIDs || []),
    ].filter(Boolean);
    const newFiles = [
      coverFileID,
      previewVideoFileID,
      ...previewFileIDs,
      ...emojiFileIDs,
      ...emojiAnimFileIDs.filter(Boolean),
    ].filter(Boolean);
    const removed = oldFiles.filter((id) => !newFiles.includes(id));

    const pairKeys = Array.isArray(event.pairKeys) ? event.pairKeys.filter(Boolean) : [];

    await db.collection('packs').doc(packId).update({
      data: {
        title,
        description: String(event.description || '').replace(/\r\n/g, '\n').trim().slice(0, 800),
        staticDriveUrl: String(event.staticDriveUrl || '').trim().slice(0, 500),
        animDriveUrl: String(event.animDriveUrl || '').trim().slice(0, 500),
        categoryId: cat.id,
        categoryName: cat.name,
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
        updatedAt: db.serverDate(),
      },
    });

    if (removed.length) {
      try {
        await cloud.deleteFile({ fileList: removed });
      } catch (e) {
        console.warn('delete unused files', e.message);
      }
    }

    await invalidateListCaches(db);
    return { ok: true, data: { _id: packId } };
  } catch (e) {
    console.error(e);
    return { ok: false, code: 'UPDATE_FAIL', message: e.message || '更新失败' };
  }
};
