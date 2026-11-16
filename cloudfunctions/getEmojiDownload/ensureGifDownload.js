/**
 * 静态表情 PNG 下载时按需转 GIF，并缓存到云存储。
 * 已是 GIF / 非 PNG / 转换失败时回退原图链接。
 */

const crypto = require('crypto');
const { convertPngBufferToGif, isPngBuffer } = require('./pngToGif');
const { resolveTempUrls } = require('./tempUrlCache');

const CACHE_COLLECTION = 'emoji_gif_cache';
const PNG_EXT_RE = /\.png(?:$|\?)/i;
const GIF_EXT_RE = /\.gif(?:$|\?)/i;
const SKIP_EXT_RE = /\.(jpe?g|webp|bmp|mp4|mov|webm)(?:$|\?)/i;

/** @type {Map<string, { gifFileID: string, expireAt: number }>} */
const memCache = new Map();
const MEM_TTL_MS = 50 * 60 * 1000;

function sourceLooksLikePng(fileID = '') {
  const id = String(fileID || '');
  if (!id) return false;
  if (GIF_EXT_RE.test(id) || SKIP_EXT_RE.test(id)) return false;
  return PNG_EXT_RE.test(id);
}

function cacheDocId(sourceFileID) {
  return crypto.createHash('sha1').update(String(sourceFileID)).digest('hex');
}

function gifCacheCloudPath(sourceFileID) {
  return `packs/gif-cache/${cacheDocId(sourceFileID)}.gif`;
}

async function readCacheDoc(db, sourceFileID) {
  const id = cacheDocId(sourceFileID);
  const hit = memCache.get(id);
  if (hit && hit.gifFileID && hit.expireAt > Date.now()) {
    return hit.gifFileID;
  }
  try {
    const snap = await db.collection(CACHE_COLLECTION).doc(id).get();
    const gifFileID = snap && snap.data && snap.data.gifFileID;
    if (gifFileID) {
      memCache.set(id, { gifFileID, expireAt: Date.now() + MEM_TTL_MS });
      return gifFileID;
    }
  } catch (e) {
    // 文档不存在
  }
  return '';
}

async function writeCacheDoc(db, sourceFileID, gifFileID) {
  const id = cacheDocId(sourceFileID);
  memCache.set(id, { gifFileID, expireAt: Date.now() + MEM_TTL_MS });
  try {
    await db
      .collection(CACHE_COLLECTION)
      .doc(id)
      .set({
        sourceFileID,
        gifFileID,
        updatedAt: db.serverDate(),
      });
  } catch (e) {
    console.warn('[ensureGifDownload] cache write', e.message || e);
  }
}

/**
 * @param {object} cloud
 * @param {object} db
 * @param {string} sourceFileID
 * @param {string} sourceTempUrl 已解析的原图临时链（可空，失败时再拉）
 * @returns {Promise<{ url: string, converted: boolean, fileID: string }>}
 */
async function ensureStaticEmojiGifUrl(cloud, db, sourceFileID, sourceTempUrl = '') {
  const fileID = String(sourceFileID || '').trim();
  if (!fileID) {
    return { url: '', converted: false, fileID: '' };
  }

  // 已是 GIF：直接下发
  if (GIF_EXT_RE.test(fileID)) {
    const urlMap = await resolveTempUrls(cloud, [fileID]);
    return {
      url: urlMap[fileID] || sourceTempUrl || '',
      converted: false,
      fileID,
    };
  }

  // 扩展名不像 PNG：不转
  if (!sourceLooksLikePng(fileID)) {
    const urlMap = sourceTempUrl
      ? { [fileID]: sourceTempUrl }
      : await resolveTempUrls(cloud, [fileID]);
    return {
      url: urlMap[fileID] || sourceTempUrl || '',
      converted: false,
      fileID,
    };
  }

  // 命中缓存
  const cachedGifId = await readCacheDoc(db, fileID);
  if (cachedGifId) {
    const urlMap = await resolveTempUrls(cloud, [cachedGifId]);
    const url = urlMap[cachedGifId] || '';
    if (url) {
      return { url, converted: true, fileID: cachedGifId };
    }
  }

  // 下载原图 → 转 GIF → 上传缓存
  let pngBuffer;
  try {
    const dl = await cloud.downloadFile({ fileID });
    pngBuffer = dl && dl.fileContent;
  } catch (e) {
    console.warn('[ensureGifDownload] download', e.message || e);
    return {
      url: sourceTempUrl || '',
      converted: false,
      fileID,
    };
  }

  if (!isPngBuffer(pngBuffer)) {
    const urlMap = sourceTempUrl
      ? { [fileID]: sourceTempUrl }
      : await resolveTempUrls(cloud, [fileID]);
    return {
      url: urlMap[fileID] || sourceTempUrl || '',
      converted: false,
      fileID,
    };
  }

  let gifBuffer;
  try {
    gifBuffer = convertPngBufferToGif(pngBuffer);
  } catch (e) {
    console.warn('[ensureGifDownload] convert', e.message || e);
    const urlMap = sourceTempUrl
      ? { [fileID]: sourceTempUrl }
      : await resolveTempUrls(cloud, [fileID]);
    return {
      url: urlMap[fileID] || sourceTempUrl || '',
      converted: false,
      fileID,
    };
  }

  try {
    const uploaded = await cloud.uploadFile({
      cloudPath: gifCacheCloudPath(fileID),
      fileContent: gifBuffer,
    });
    const gifFileID = uploaded && uploaded.fileID;
    if (!gifFileID) {
      throw new Error('uploadFile 未返回 fileID');
    }
    await writeCacheDoc(db, fileID, gifFileID);
    const urlMap = await resolveTempUrls(cloud, [gifFileID]);
    const url = urlMap[gifFileID] || '';
    if (!url) {
      throw new Error('获取 GIF 临时链失败');
    }
    return { url, converted: true, fileID: gifFileID };
  } catch (e) {
    console.warn('[ensureGifDownload] upload', e.message || e);
    const urlMap = sourceTempUrl
      ? { [fileID]: sourceTempUrl }
      : await resolveTempUrls(cloud, [fileID]);
    return {
      url: urlMap[fileID] || sourceTempUrl || '',
      converted: false,
      fileID,
    };
  }
}

module.exports = {
  ensureStaticEmojiGifUrl,
  sourceLooksLikePng,
};
