const cloud = require('wx-server-sdk');
const { resolveTempUrls } = require('./tempUrlCache');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

const FALLBACK_ADMINS = ['oOtg0xqcOEHgBAL7u3M7g9S8ln2c'];

const VIDEO_EXT_RE = /\.(mp4|mov|m4v|avi|mkv|3gp|webm)$/i;

function isVideoFileID(fileID = '') {
  return VIDEO_EXT_RE.test(String(fileID || '').split('?')[0]);
}

function splitPreviewFileIDs(pack = {}) {
  const raw = pack.previewFileIDs || [];
  const images = raw.filter((id) => id && !isVideoFileID(id));
  const fromList = raw.find((id) => id && isVideoFileID(id)) || '';
  const previewVideoFileID = String(pack.previewVideoFileID || fromList || '').trim();
  return { previewFileIDs: images, previewVideoFileID };
}

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
 * 轻量详情：封面 + 预览临时链；原图 URL 走 resolveSlotUrls 按需加载
 */
async function getDetail(packId, OPENID) {
  const doc = await db.collection('packs').doc(packId).get();
  const pack = doc.data;
  if (!pack || pack.status !== 'published') {
    return { ok: false, code: 'NOT_FOUND', message: '合集不存在' };
  }

  const emojiFileIDs = pack.emojiFileIDs || [];
  const emojiCount = emojiFileIDs.length;
  const { previewFileIDs, previewVideoFileID } = splitPreviewFileIDs(pack);
  const emojiAnimFileIDs = pack.emojiAnimFileIDs || [];
  const pairKeys = Array.isArray(pack.pairKeys) ? pack.pairKeys : [];

  const urlMap = await resolveTempUrls(cloud, [
    pack.coverFileID,
    previewVideoFileID,
    ...previewFileIDs,
  ]);

  const previewUrls = previewFileIDs.map((id) => urlMap[id] || '');
  const previewVideoUrl = (previewVideoFileID && urlMap[previewVideoFileID]) || '';
  const hasAnimAny = emojiAnimFileIDs.some((id) => String(id || '').trim());
  const slots = Array.from({ length: emojiCount }, (_, i) => {
    const animId = String(emojiAnimFileIDs[i] || '').trim();
    return {
      index: i,
      pairKey: pairKeys[i] || '',
      previewUrl: previewUrls[i] || '',
      staticUrl: '',
      animUrl: '',
      hasAnim: !!animId,
      label: pairKeys[i] ? `#${pairKeys[i]}` : `原图 ${i + 1}`,
      urlsReady: false,
    };
  });

  const admin = isAdminOpenid(OPENID);
  const data = {
    _id: pack._id,
    title: pack.title,
    description: pack.description || '',
    categoryId: pack.categoryId || '',
    categoryName: pack.categoryName || '',
    coverUrl: urlMap[pack.coverFileID] || '',
    previewUrls,
    previewVideoUrl,
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
}

/**
 * 按需解析若干槽位的静/动原图临时链
 * event.indexes: number[]，最多 40
 */
async function resolveSlotUrls(packId, indexes) {
  const doc = await db.collection('packs').doc(packId).get();
  const pack = doc.data;
  if (!pack || pack.status !== 'published') {
    return { ok: false, code: 'NOT_FOUND', message: '合集不存在' };
  }

  const emojiFileIDs = pack.emojiFileIDs || [];
  const emojiAnimFileIDs = pack.emojiAnimFileIDs || [];
  const emojiCount = emojiFileIDs.length;

  const raw = Array.isArray(indexes) ? indexes : [];
  const idxList = Array.from(
    new Set(
      raw
        .map((n) => Math.floor(Number(n)))
        .filter((n) => !Number.isNaN(n) && n >= 0 && n < emojiCount),
    ),
  ).slice(0, 40);

  if (!idxList.length) {
    return { ok: true, data: { slots: [] } };
  }

  const fileIds = [];
  idxList.forEach((i) => {
    const staticId = String(emojiFileIDs[i] || '').trim();
    const animId = String(emojiAnimFileIDs[i] || '').trim();
    if (staticId) fileIds.push(staticId);
    if (animId) fileIds.push(animId);
  });

  const urlMap = await resolveTempUrls(cloud, fileIds);
  const slots = idxList.map((i) => {
    const staticId = String(emojiFileIDs[i] || '').trim();
    const animId = String(emojiAnimFileIDs[i] || '').trim();
    return {
      index: i,
      staticUrl: (staticId && urlMap[staticId]) || '',
      animUrl: (animId && urlMap[animId]) || '',
      hasAnim: !!animId,
      urlsReady: true,
    };
  });

  return { ok: true, data: { slots } };
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext();
  const packId = event.packId || event.id;
  if (!packId) {
    return { ok: false, code: 'BAD_PARAM', message: '缺少 packId' };
  }

  try {
    if (event.action === 'resolveSlotUrls') {
      return await resolveSlotUrls(packId, event.indexes);
    }
    return await getDetail(packId, OPENID);
  } catch (e) {
    console.error(e);
    return { ok: false, code: 'DETAIL_FAIL', message: e.message || '加载失败' };
  }
};
