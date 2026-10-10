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

function assertAdmin(openid) {
  return getAdminList().includes(openid);
}

function toMs(value) {
  if (!value) return 0;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

async function toUrlMap(fileIds) {
  const urlMap = {};
  const list = (fileIds || []).filter(Boolean);
  for (let i = 0; i < list.length; i += 50) {
    const chunk = list.slice(i, i + 50);
    // eslint-disable-next-line no-await-in-loop
    const temp = await cloud.getTempFileURL({ fileList: chunk });
    (temp.fileList || []).forEach((item) => {
      urlMap[item.fileID] = item.tempFileURL;
    });
  }
  return urlMap;
}

/** 管理员拉取合集详情（含原图，仅管理端编辑用） */
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

    const allIds = [
      pack.coverFileID,
      ...(pack.previewFileIDs || []),
      ...(pack.emojiFileIDs || []),
      ...(pack.emojiAnimFileIDs || []),
    ];
    const urlMap = await toUrlMap(allIds);

    const mapFiles = (ids) =>
      (ids || []).filter(Boolean).map((fileID, index) => ({
        url: urlMap[fileID] || '',
        name: `file_${index}`,
        type: 'image',
        fileID,
      }));

    // 动态保留原槽位序号，便于编辑页与静态对齐（空槽不返回）
    const emojiAnimFiles = (pack.emojiAnimFileIDs || [])
      .map((fileID, index) => {
        if (!fileID) return null;
        return {
          url: urlMap[fileID] || '',
          name: `anim_${index + 1}`,
          type: 'image',
          fileID,
          manualSeq: String(index + 1),
          seqLabel: String(index + 1),
        };
      })
      .filter(Boolean);

    return {
      ok: true,
      data: {
        _id: pack._id,
        title: pack.title || '',
        description: pack.description || '',
        staticDriveUrl: pack.staticDriveUrl || '',
        animDriveUrl: pack.animDriveUrl || '',
        categoryId: pack.categoryId || '',
        categoryName: pack.categoryName || '',
        status: pack.status,
        coverWidth: pack.coverWidth || 0,
        coverHeight: pack.coverHeight || 0,
        coverFiles: pack.coverFileID
          ? mapFiles([pack.coverFileID])
          : [],
        previewFiles: mapFiles(pack.previewFileIDs),
        emojiFiles: mapFiles(pack.emojiFileIDs),
        emojiAnimFiles,
        notifiedAt: toMs(pack.notifiedAt),
      },
    };
  } catch (e) {
    console.error(e);
    return { ok: false, code: 'GET_FAIL', message: e.message || '加载失败' };
  }
};
