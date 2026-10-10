const cloud = require('wx-server-sdk');

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

function isAdminOpenid(openid) {
  return !!openid && getAdminList().includes(openid);
}

/**
 * 详情：返回封面 + 预览图，以及原图数量/占位（不返回原图 fileID）
 * 网盘链接仅管理员可见
 */
exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const packId = event.packId || event.id;
  if (!packId) {
    return { ok: false, code: 'BAD_PARAM', message: '缺少 packId' };
  }

  try {
    const doc = await db.collection('packs').doc(packId).get();
    const pack = doc.data;
    if (!pack || pack.status !== 'published') {
      return { ok: false, code: 'NOT_FOUND', message: '合集不存在' };
    }

    const emojiCount = (pack.emojiFileIDs || []).length;
    const previewFileIDs = pack.previewFileIDs || [];
    const emojiAnimFileIDs = pack.emojiAnimFileIDs || [];
    const pairKeys = Array.isArray(pack.pairKeys) ? pack.pairKeys : [];
    const fileIds = [pack.coverFileID, ...previewFileIDs].filter(Boolean);

    let urlMap = {};
    if (fileIds.length) {
      const temp = await cloud.getTempFileURL({ fileList: fileIds });
      (temp.fileList || []).forEach((item) => {
        urlMap[item.fileID] = item.tempFileURL;
      });
    }

    const previewUrls = previewFileIDs.map((id) => urlMap[id] || '');
    const slots = Array.from({ length: emojiCount }, (_, i) => {
      const hasAnim = !!(emojiAnimFileIDs[i] && String(emojiAnimFileIDs[i]).trim());
      return {
        index: i,
        pairKey: pairKeys[i] || '',
        previewUrl: previewUrls[i] || '',
        hasAnim,
        label: pairKeys[i] ? `#${pairKeys[i]}` : `原图 ${i + 1}`,
      };
    });
    const hasAnimAny = slots.some((s) => s.hasAnim);
    const admin = isAdminOpenid(OPENID);

    const data = {
      _id: pack._id,
      title: pack.title,
      description: pack.description || '',
      categoryId: pack.categoryId || '',
      categoryName: pack.categoryName || '',
      coverUrl: urlMap[pack.coverFileID] || '',
      previewUrls,
      pairKeys,
      slots,
      hasAnimAny,
      emojiCount,
      downloadCount: pack.downloadCount || 0,
    };

    if (admin) {
      data.staticDriveUrl = pack.staticDriveUrl || '';
      data.animDriveUrl = pack.animDriveUrl || '';
    }

    return { ok: true, data };
  } catch (e) {
    console.error(e);
    return { ok: false, code: 'DETAIL_FAIL', message: e.message || '加载失败' };
  }
};
