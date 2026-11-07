/**
 * 客户端临时 https 链 TTL 缓存（内存 + 本地持久化）。
 * 有服务端新链时一律用新链并更新缓存；仅无网络结果时才读缓存占位。
 * 微信临时链约 2 小时；服务端缓存约 50 分钟。客户端 TTL 取 45 分钟，
 * 且同一 URL 不续期，避免「服务端旧签 + 客户端再续」叠出 CDN 已拒的裂图。
 */

const TTL_MS = 45 * 60 * 1000;
const MAX_ENTRIES = 1200;
/** bump key 丢掉旧版可能已失效的持久化链 */
const STORAGE_KEY = 'temp_url_cache_v4';
const FLUSH_DELAY_MS = 600;

/** @type {Record<string, { url: string, expireAt: number }>} */
const mem = Object.create(null);
let hydrated = false;
let flushTimer = null;
let dirty = false;

function hydrateFromStorage() {
  if (hydrated) return;
  hydrated = true;
  try {
    // 清掉旧版可能已叠寿的坏缓存
    try {
      wx.removeStorageSync('temp_url_cache_v1');
      wx.removeStorageSync('temp_url_cache_v2');
      wx.removeStorageSync('temp_url_cache_v3');
    } catch (e) {
      /* ignore */
    }
    const raw = wx.getStorageSync(STORAGE_KEY);
    if (!raw || typeof raw !== 'object') return;
    const now = Date.now();
    Object.keys(raw).forEach((k) => {
      const hit = raw[k];
      if (hit && hit.url && Number(hit.expireAt) > now) {
        mem[k] = { url: String(hit.url), expireAt: Number(hit.expireAt) };
      }
    });
  } catch (e) {
    /* ignore */
  }
}

function pruneIfNeeded() {
  const keys = Object.keys(mem);
  if (keys.length <= MAX_ENTRIES) return;
  const now = Date.now();
  keys.forEach((k) => {
    const hit = mem[k];
    if (!hit || hit.expireAt <= now) delete mem[k];
  });
  const left = Object.keys(mem);
  if (left.length <= MAX_ENTRIES) return;
  const overflow = left.length - MAX_ENTRIES;
  for (let i = 0; i < overflow; i += 1) {
    delete mem[left[i]];
  }
}

function flushToStorage() {
  flushTimer = null;
  if (!dirty) return;
  dirty = false;
  try {
    const now = Date.now();
    const out = Object.create(null);
    let n = 0;
    Object.keys(mem).forEach((k) => {
      if (n >= MAX_ENTRIES) return;
      const hit = mem[k];
      if (hit && hit.url && hit.expireAt > now) {
        out[k] = hit;
        n += 1;
      }
    });
    wx.setStorageSync(STORAGE_KEY, out);
  } catch (e) {
    /* quota */
  }
}

function scheduleFlush() {
  dirty = true;
  if (flushTimer) return;
  flushTimer = setTimeout(flushToStorage, FLUSH_DELAY_MS);
}

/** 窥探：未过期则返回缓存 url */
export function peekTempUrl(key) {
  hydrateFromStorage();
  const k = String(key || '').trim();
  if (!k) return '';
  const hit = mem[k];
  if (!hit || !hit.url) return '';
  if (hit.expireAt && hit.expireAt <= Date.now()) {
    delete mem[k];
    scheduleFlush();
    return '';
  }
  return hit.url;
}

/** 写入缓存并返回 url；同一 url 不续期，避免把服务端旧签再撑过 CDN 有效期 */
export function rememberTempUrl(key, url) {
  hydrateFromStorage();
  const k = String(key || '').trim();
  const u = String(url || '').trim();
  if (!k || !u) return u;
  const now = Date.now();
  const prev = mem[k];
  if (prev && prev.url === u && Number(prev.expireAt) > now) {
    return u;
  }
  mem[k] = { url: u, expireAt: now + TTL_MS };
  pruneIfNeeded();
  scheduleFlush();
  return u;
}

/**
 * 有新链 → 用新链并刷新缓存（避免沿用 CDN 已失效的旧签）。
 * 无新链 → 才读本地缓存做占位。
 */
export function reuseTempUrl(key, url) {
  const k = String(key || '').trim();
  const u = String(url || '').trim();
  if (!k) return u;
  if (u) return rememberTempUrl(k, u);
  return peekTempUrl(k);
}

/** 合集封面缓存 key */
export function packCoverCacheKey(packId) {
  return `packCover:${String(packId || '').trim()}`;
}

/** 合集槽位原图缓存 key */
export function packSlotCacheKey(packId, index, variant) {
  const v = variant === 'anim' ? 'anim' : 'static';
  return `packSlot:${String(packId || '').trim()}:${Number(index)}:${v}`;
}

/** 合集 hero 预览图缓存 key */
export function packPreviewCacheKey(packId, index) {
  return `packPreview:${String(packId || '').trim()}:${Number(index)}`;
}

/**
 * 批量 fileID → url。
 * 有 fetcher 时始终向云端换新签（换签本身几乎不占存储流量），失败再用本地缓存兜底。
 */
export async function resolveTempFileURLs(fileList, fetcher) {
  hydrateFromStorage();
  const list = (fileList || []).map((id) => String(id || '').trim());
  const out = list.map((id) => (id ? peekTempUrl(id) : ''));
  const fetch = typeof fetcher === 'function' ? fetcher : null;
  if (!fetch) return out;

  const unique = Array.from(new Set(list.filter(Boolean)));
  if (!unique.length) return out;

  try {
    const fresh = await fetch(unique);
    const map = Object.create(null);
    unique.forEach((id, j) => {
      const url = String((fresh && fresh[j]) || '').trim();
      if (id && url) map[id] = rememberTempUrl(id, url);
    });
    return list.map((id) => (id ? map[id] || peekTempUrl(id) || '' : ''));
  } catch (e) {
    return out;
  }
}

/** 删除单条 key */
export function forgetTempUrl(key) {
  hydrateFromStorage();
  const k = String(key || '').trim();
  if (!k || !mem[k]) return;
  delete mem[k];
  scheduleFlush();
}

/** 清掉某个合集相关的封面/槽位/预览链（管理端改图后可调） */
export function invalidatePackTempUrls(packId) {
  hydrateFromStorage();
  const prefix = String(packId || '').trim();
  if (!prefix) return;
  const needles = [
    `packCover:${prefix}`,
    `packSlot:${prefix}:`,
    `packPreview:${prefix}:`,
  ];
  Object.keys(mem).forEach((k) => {
    if (needles.some((n) => k === n || k.startsWith(n))) delete mem[k];
  });
  scheduleFlush();
}

/** 清空全部临时链缓存（排障用） */
export function clearAllTempUrlCache() {
  hydrateFromStorage();
  Object.keys(mem).forEach((k) => delete mem[k]);
  try {
    wx.removeStorageSync(STORAGE_KEY);
    wx.removeStorageSync('temp_url_cache_v1');
    wx.removeStorageSync('temp_url_cache_v2');
    wx.removeStorageSync('temp_url_cache_v3');
  } catch (e) {
    /* ignore */
  }
  dirty = false;
}

export { TTL_MS };
