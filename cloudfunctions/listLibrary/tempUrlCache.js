/**
 * 云存储临时链短缓存（热实例内存）。
 */

const TTL_MS = 50 * 60 * 1000;
const MAX_ENTRIES = 2000;

/** @type {Map<string, { url: string, expireAt: number }>} */
const mem = new Map();

function pruneIfNeeded() {
  if (mem.size <= MAX_ENTRIES) return;
  const now = Date.now();
  mem.forEach((v, k) => {
    if (!v || v.expireAt <= now) mem.delete(k);
  });
  if (mem.size <= MAX_ENTRIES) return;
  const overflow = mem.size - MAX_ENTRIES;
  let i = 0;
  mem.forEach((_, k) => {
    if (i < overflow) {
      mem.delete(k);
      i += 1;
    }
  });
}

async function resolveTempUrls(cloud, fileIds = []) {
  const ids = Array.from(
    new Set((fileIds || []).map((id) => String(id || '').trim()).filter(Boolean)),
  );
  const urlMap = {};
  if (!ids.length) return urlMap;

  const now = Date.now();
  const miss = [];
  ids.forEach((id) => {
    if (/^https?:\/\//i.test(id)) {
      urlMap[id] = id;
      return;
    }
    const hit = mem.get(id);
    if (hit && hit.url && hit.expireAt > now) {
      urlMap[id] = hit.url;
    } else {
      miss.push(id);
    }
  });

  if (!miss.length) return urlMap;

  const expireAt = now + TTL_MS;
  for (let i = 0; i < miss.length; i += 50) {
    const chunk = miss.slice(i, i + 50);
    try {
      // eslint-disable-next-line no-await-in-loop
      const temp = await cloud.getTempFileURL({ fileList: chunk });
      (temp.fileList || []).forEach((item) => {
        const fid = item.fileID || item.fileId;
        const url = item.tempFileURL || item.tempFileUrl || '';
        if (fid && url) {
          urlMap[fid] = url;
          mem.set(fid, { url, expireAt });
        }
      });
    } catch (e) {
      console.warn('[listLibrary] getTempFileURL', e.message || e);
    }
  }
  pruneIfNeeded();
  return urlMap;
}

module.exports = { resolveTempUrls };
