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

/** 云存储临时链批量转换（单次最多 50） */
async function fillTempUrlMap(fileIds, urlMap) {
  const ids = (fileIds || []).filter(Boolean);
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    // eslint-disable-next-line no-await-in-loop
    const temp = await cloud.getTempFileURL({ fileList: chunk });
    (temp.fileList || []).forEach((item) => {
      if (item && item.fileID) urlMap[item.fileID] = item.tempFileURL || '';
    });
  }
}

/**
 * 详情：封面 + 预览图 + 静/动原图临时链（供保存区展示；扣费仍走 getEmojiDownload）
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

    const emojiFileIDs = pack.emojiFileIDs || [];
    const emojiCount = emojiFileIDs.length;
    const previewFileIDs = pack.previewFileIDs || [];
    const emojiAnimFileIDs = pack.emojiAnimFileIDs || [];
    const pairKeys = Array.isArray(pack.pairKeys) ? pack.pairKeys : [];

    const urlMap = {};
    await fillTempUrlMap(
      [pack.coverFileID, ...previewFileIDs, ...emojiFileIDs, ...emojiAnimFileIDs],
      urlMap,
    );

    const previewUrls = previewFileIDs.map((id) => urlMap[id] || '');
    const slots = Array.from({ length: emojiCount }, (_, i) => {
      const staticId = emojiFileIDs[i] || '';
      const animId = emojiAnimFileIDs[i] || '';
      const hasAnim = !!(animId && String(animId).trim());
      return {
        index: i,
        pairKey: pairKeys[i] || '',
        previewUrl: previewUrls[i] || '',
        staticUrl: (staticId && urlMap[staticId]) || '',
        animUrl: hasAnim ? urlMap[animId] || '' : '',
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
