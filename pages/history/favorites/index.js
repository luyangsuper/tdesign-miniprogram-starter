import { callFunction } from '~/utils/cloud';
import { resolveIsAdmin } from '~/utils/auth';
import { queueFavorite } from '~/utils/favoriteQueue';
import {
  getNativeFavoritesAdUnitId,
  shouldShowNativeAds,
} from '~/utils/nativeAd';
import { categoryTagStyle } from '~/utils/categories';
import {
  contentTypeLabel,
  formatItemCount,
  normalizeContentType,
} from '~/utils/contentType';
import { resolvePreviewRowCount } from '~/utils/previewRowCount';
import { applyThemeToPage, getThemeStyle } from '~/utils/theme';
import { shareAppMessage, shareTimeline } from '~/utils/share';

function enrichFavoriteItem(item, rowCount = 4) {
  const slotsWanted = Math.max(3, Math.min(6, Number(rowCount) || 4));
  const contentType = normalizeContentType(item.contentType);
  const rawUrls = Array.isArray(item.previewUrls)
    ? item.previewUrls.map((u) => String(u || '').trim()).filter(Boolean)
    : [];
  const previewUrls = rawUrls.slice(0, slotsWanted);
  const emojiCount = Math.max(0, Number(item.emojiCount) || 0);
  const slotShown = previewUrls.length;
  const moreCount =
    slotShown > 0 && emojiCount > slotShown
      ? Math.max(0, emojiCount - (slotShown - 1))
      : Number(item.moreCount) || 0;
  const categoryId = String(item.categoryId || '').trim();
  const categoryName = String(item.categoryName || '').trim();
  return {
    ...item,
    contentType,
    contentTypeName: contentTypeLabel(contentType),
    itemCountText: formatItemCount(emojiCount, contentType),
    categoryId,
    categoryName,
    categoryTagStyle: categoryName
      ? categoryTagStyle(categoryId, categoryName)
      : '',
    previewSlots: previewUrls.map((url, i) => {
      const ids = Array.isArray(item.previewFileIDs) ? item.previewFileIDs : [];
      const fileID = String(ids[i] || '').trim();
      return {
        url,
        fileID,
        cacheKey: item.packId ? `packPreview:${item.packId}:${i}` : '',
        key: `${item.packId}-p${i}`,
        showMore: moreCount > 0 && i === previewUrls.length - 1,
      };
    }),
    moreCount,
  };
}

Page({
  data: {
    themeStyle: '',
    loading: true,
    loadingMore: false,
    list: [],
    page: 1,
    hasMore: true,
    rowGap: 10,
    previewRowCount: 4,
    isAdmin: false,
    nativeAdUnitId: getNativeFavoritesAdUnitId(),
    showNativeAd: false,
  },

  onLoad() {
    this.setData({
      themeStyle: getThemeStyle(),
      previewRowCount: resolvePreviewRowCount(),
      isAdmin: resolveIsAdmin(),
    });
    this.refreshNativeAd();
    this._onFavoriteChange = (payload) => this.applyFavoriteChange(payload);
    this._onAdminViewChange = () => {
      this.setData({ isAdmin: resolveIsAdmin() });
      this.refreshNativeAd();
    };
    this._onEntitlementChange = () => this.refreshNativeAd();
    this._onPreviewRowCountChange = () => this.applyPreviewRowCount();
    try {
      const app = getApp();
      if (app && app.eventBus) {
        app.eventBus.on('favoriteChange', this._onFavoriteChange);
        app.eventBus.on('adminViewChange', this._onAdminViewChange);
        app.eventBus.on('entitlementChange', this._onEntitlementChange);
        app.eventBus.on('previewRowCountChange', this._onPreviewRowCountChange);
        app.eventBus.on('waterfallColumnsChange', this._onPreviewRowCountChange);
      }
    } catch (e) {
      /* ignore */
    }
    this.loadList(true);
  },

  onUnload() {
    try {
      const app = getApp();
      if (app && app.eventBus) {
        if (this._onFavoriteChange) {
          app.eventBus.off('favoriteChange', this._onFavoriteChange);
        }
        if (this._onAdminViewChange) {
          app.eventBus.off('adminViewChange', this._onAdminViewChange);
        }
        if (this._onEntitlementChange) {
          app.eventBus.off('entitlementChange', this._onEntitlementChange);
        }
        if (this._onPreviewRowCountChange) {
          app.eventBus.off('previewRowCountChange', this._onPreviewRowCountChange);
          app.eventBus.off('waterfallColumnsChange', this._onPreviewRowCountChange);
        }
      }
    } catch (e) {
      /* ignore */
    }
  },

  onShow() {
    applyThemeToPage(this);
    this.setData({
      isAdmin: resolveIsAdmin(),
      previewRowCount: resolvePreviewRowCount(),
    });
    this.refreshNativeAd();
  },

  applyPreviewRowCount() {
    const n = resolvePreviewRowCount();
    const list = (this.data.list || []).map((item) => enrichFavoriteItem(item, n));
    this.setData({ previewRowCount: n, list });
  },

  refreshNativeAd() {
    const unitId = getNativeFavoritesAdUnitId();
    this.setData({
      nativeAdUnitId: unitId,
      showNativeAd: !!unitId && shouldShowNativeAds(),
    });
  },

  onNativeAdError() {
    this.setData({ showNativeAd: false });
  },

  onShareAppMessage() {
    return shareAppMessage();
  },

  onShareTimeline() {
    return shareTimeline();
  },

  applyList(list, extra = {}) {
    const n = this.data.previewRowCount || resolvePreviewRowCount();
    this.setData({
      list: (list || []).map((item) => enrichFavoriteItem(item, n)),
      ...extra,
    });
  },

  applyFavoriteChange(payload) {
    const packId = payload && payload.packId;
    if (!packId) return;
    this._stash = this._stash || {};
    if (payload.favorited === false) {
      const hit = (this.data.list || []).find((item) => item.packId === packId);
      if (hit) this._stash[packId] = hit;
      const list = (this.data.list || []).filter((item) => item.packId !== packId);
      if (list.length === (this.data.list || []).length) return;
      this.setData({ list });
      return;
    }
    if (payload.favorited === true && this._stash[packId]) {
      if ((this.data.list || []).some((item) => item.packId === packId)) return;
      const n = this.data.previewRowCount || resolvePreviewRowCount();
      this.setData({
        list: [enrichFavoriteItem(this._stash[packId], n)].concat(this.data.list || []),
      });
    }
  },

  onReachBottom() {
    this.loadList(false);
  },

  onPullDownRefresh() {
    this.loadList(true).finally(() => {
      wx.stopPullDownRefresh();
    });
  },

  async loadList(reset = false) {
    if (reset) {
      this.setData({ loading: true, page: 1, hasMore: true });
    } else {
      if (!this.data.hasMore || this.data.loadingMore) return;
      this.setData({ loadingMore: true });
    }

    const page = reset ? 1 : this.data.page;
    try {
      const res = await callFunction('userFavorite', {
        action: 'list',
        page,
        pageSize: 20,
      });
      const incoming = res.data.list || [];
      const { hasMore = false } = res.data || {};
      const list = reset ? incoming : (this.data.list || []).concat(incoming);
      this.applyList(list, {
        page: page + 1,
        hasMore,
        loading: false,
        loadingMore: false,
      });
    } catch (e) {
      this.setData({ loading: false, loadingMore: false });
      wx.showToast({
        title: (e.message || '加载失败').slice(0, 40),
        icon: 'none',
      });
    }
  },

  goHome() {
    wx.switchTab({ url: '/pages/home/index' });
  },

  onOpenPack(e) {
    const packId = e.currentTarget.dataset.id;
    if (!packId) return;
    wx.navigateTo({ url: `/pages/pack/detail/index?id=${packId}` });
  },

  playHeartBurst(e, mode) {
    const burst = this.selectComponent('#heartBurst');
    if (!burst || typeof burst.burstFromEvent !== 'function') return;
    burst.burstFromEvent(e, { mode });
  },

  onUnfavorite(e) {
    const packId = e.currentTarget.dataset.id;
    if (!packId) return;
    this._stash = this._stash || {};
    const hit = (this.data.list || []).find((item) => item.packId === packId);
    if (hit) this._stash[packId] = hit;
    this.playHeartBurst(e, 'out');
    const list = (this.data.list || []).filter((item) => item.packId !== packId);
    this.setData({ list });
    queueFavorite(packId, false);
  },
});
