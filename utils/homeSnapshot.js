/**
 * 首页列表本地快照：二次打开先出壳，再静默刷新。
 */

const STORAGE_KEY = 'home_list_snapshot_v1';
/** 快照可用时长 */
export const HOME_SNAPSHOT_TTL = 5 * 60 * 1000;
/** 最多持久化条数，控制 storage 体积 */
const MAX_LIST = 30;

export function readHomeSnapshot() {
  try {
    const raw = wx.getStorageSync(STORAGE_KEY);
    if (!raw || typeof raw !== 'object') return null;
    const at = Number(raw.at) || 0;
    if (!at || Date.now() - at > HOME_SNAPSHOT_TTL) return null;
    if (!Array.isArray(raw.list) || !raw.list.length) return null;
    return raw;
  } catch (e) {
    return null;
  }
}

export function writeHomeSnapshot(payload = {}) {
  try {
    const list = (payload.list || []).slice(0, MAX_LIST).map((item) => ({
      _id: item._id,
      title: item.title,
      description: item.description || '',
      coverUrl: item.coverUrl || '',
      coverRatio: item.coverRatio || 0,
      previewCount: item.previewCount || 0,
      emojiCount: item.emojiCount || 0,
      downloadCount: item.downloadCount || 0,
      categoryId: item.categoryId || '',
      categoryName: item.categoryName || '',
      previewUrls: [],
      slides: item.coverUrl ? [item.coverUrl] : [],
    }));
    if (!list.length) return;
    wx.setStorageSync(STORAGE_KEY, {
      at: Date.now(),
      categoryId: payload.categoryId || 'all',
      keyword: String(payload.keyword || '').trim(),
      list,
      page: Number(payload.page) || 2,
      hasMore: !!payload.hasMore,
      total: Number(payload.total) || list.length,
      filters: Array.isArray(payload.filters) ? payload.filters : null,
    });
  } catch (e) {
    /* storage full / quota */
  }
}

export function clearHomeSnapshot() {
  try {
    wx.removeStorageSync(STORAGE_KEY);
  } catch (e) {
    /* ignore */
  }
}
