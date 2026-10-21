import { callFunction } from '~/utils/cloud';
import { queueFavorite } from '~/utils/favoriteQueue';
import { getWindowInfoSafe } from '~/utils/systemInfo';
import { applyThemeToPage, getThemeStyle } from '~/utils/theme';
import { shareAppMessage, shareTimeline } from '~/utils/share';

const LAYOUT_KEY = 'favorites_layout';

function readLayout() {
  try {
    const v = wx.getStorageSync(LAYOUT_KEY);
    if (v === 'waterfall' || v === 'list') return v;
  } catch (e) {
    /* ignore */
  }
  return 'list';
}

function writeLayout(layout) {
  try {
    wx.setStorageSync(LAYOUT_KEY, layout);
  } catch (e) {
    /* ignore */
  }
}

function buildColumns(list, columnCount) {
  const n = Math.max(1, Number(columnCount) || 2);
  const cols = Array.from({ length: n }, () => []);
  const heights = Array.from({ length: n }, () => 0);
  (list || []).forEach((item) => {
    let minI = 0;
    for (let i = 1; i < n; i += 1) {
      if (heights[i] < heights[minI]) minI = i;
    }
    cols[minI].push(item);
    const ratio = Number(item.coverRatio) > 0 ? Number(item.coverRatio) : 1;
    heights[minI] += ratio + 0.55;
  });
  return cols;
}

function withCoverRatio(item) {
  let ratio = Number(item.coverRatio) || 0;
  if (!(ratio > 0.2 && ratio < 4) && item.packId) {
    try {
      ratio = Number(wx.getStorageSync(`coverRatio_${item.packId}`)) || 0;
    } catch (e) {
      ratio = 0;
    }
  }
  if (!(ratio > 0.2 && ratio < 4)) ratio = 1;
  return { ...item, coverRatio: ratio };
}

Page({
  data: {
    themeStyle: '',
    loading: true,
    loadingMore: false,
    list: [],
    columns: [[], []],
    page: 1,
    hasMore: true,
    busyId: '',
    layout: 'list',
    columnCount: 2,
    cardWidth: 0,
    listGap: 6,
    rowGap: 6,
  },

  onLoad() {
    this.setData({
      themeStyle: getThemeStyle(),
      layout: readLayout(),
    });
    this.updateLayout();
    this._onFavoriteChange = (payload) => this.applyFavoriteChange(payload);
    try {
      const app = getApp();
      if (app && app.eventBus) {
        app.eventBus.on('favoriteChange', this._onFavoriteChange);
      }
    } catch (e) {
      /* ignore */
    }
    this.loadList(true);
  },

  onUnload() {
    try {
      const app = getApp();
      if (app && app.eventBus && this._onFavoriteChange) {
        app.eventBus.off('favoriteChange', this._onFavoriteChange);
      }
    } catch (e) {
      /* ignore */
    }
  },

  onShow() {
    applyThemeToPage(this);
  },

  onShareAppMessage() {
    return shareAppMessage();
  },

  onShareTimeline() {
    return shareTimeline();
  },

  updateLayout() {
    const { windowWidth } = getWindowInfoSafe();
    let columnCount = 2;
    if (windowWidth >= 560) columnCount = 3;
    if (windowWidth >= 840) columnCount = 4;
    const gap = 6;
    const rowGap = 6;
    const cardWidth = Math.floor(
      (windowWidth - gap * 2 - gap * (columnCount - 1)) / columnCount,
    );
    const patch = { columnCount, cardWidth, listGap: gap, rowGap };
    if (this.data.layout === 'waterfall' && this.data.list && this.data.list.length) {
      patch.columns = buildColumns(this.data.list, columnCount);
    }
    this.setData(patch);
  },

  applyList(list, extra = {}) {
    const patch = { list, ...extra };
    if (this.data.layout === 'waterfall') {
      patch.columns = buildColumns(list, this.data.columnCount || 2);
    }
    this.setData(patch);
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
      this.applyList(list);
      return;
    }
    if (payload.favorited === true && this._stash[packId]) {
      if ((this.data.list || []).some((item) => item.packId === packId)) return;
      this.applyList([this._stash[packId]].concat(this.data.list || []));
    }
  },

  onToggleLayout() {
    const layout = this.data.layout === 'waterfall' ? 'list' : 'waterfall';
    writeLayout(layout);
    const patch = { layout };
    if (layout === 'waterfall') {
      patch.columns = buildColumns(this.data.list, this.data.columnCount || 2);
    }
    this.setData(patch);
  },

  onCoverRatioChange(e) {
    const detail = (e && e.detail) || {};
    const packId = detail.packId;
    const ratio = Number(detail.coverRatio) || 0;
    if (!packId || !(ratio > 0.2 && ratio < 4)) return;
    const patchItem = (item) =>
      item && item.packId === packId ? { ...item, coverRatio: ratio } : item;
    const list = (this.data.list || []).map(patchItem);
    const columns = (this.data.columns || []).map((col) => (col || []).map(patchItem));
    this.setData({ list, columns });
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
      const incoming = (res.data.list || []).map(withCoverRatio);
      const { hasMore = false } = res.data || {};
      const list = reset ? incoming : this.data.list.concat(incoming);
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
    this.applyList(list);
    queueFavorite(packId, false);
  },
});
