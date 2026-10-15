const cloud = require('wx-server-sdk');
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
  if (!packId) return { ok: false, code: 'BAD_PARAM', message: '缺少 packId' };

  try {
    const doc = await db.collection('packs').doc(packId).get();
    const pack = doc.data;
    if (!pack) return { ok: false, code: 'NOT_FOUND', message: '合集不存在' };

    const fileList = [
      pack.coverFileID,
      ...(pack.previewFileIDs || []),
      ...(pack.emojiFileIDs || []),
    ].filter(Boolean);

    await db.collection('packs').doc(packId).remove();

    if (fileList.length) {
      try {
        await cloud.deleteFile({ fileList });
      } catch (e) {
        console.warn('deleteFile skip', e.message);
      }
    }

    await invalidateListCaches(db);
    return { ok: true, data: { packId } };
  } catch (e) {
    console.error(e);
    return { ok: false, code: 'DELETE_FAIL', message: e.message || '删除失败' };
  }
};
