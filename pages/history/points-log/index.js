import { callFunction } from '~/utils/cloud';
import { applyThemeToPage, getThemeStyle } from '~/utils/theme';
import { shareAppMessage, shareTimeline } from '~/utils/share';

Page({
  data: {
    themeStyle: '',
    loading: true,
    loadingMore: false,
    list: [],
    page: 1,
    hasMore: true,
    balance: 0,
  },

  onLoad() {
    this.setData({ themeStyle: getThemeStyle() });
  },

  onShow() {
    applyThemeToPage(this);
    this.loadList(true);
  },

  onShareAppMessage() {
    return shareAppMessage();
  },

  onShareTimeline() {
    return shareTimeline();
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
      const res = await callFunction('userHistory', {
        action: 'listPointsLogs',
        page,
        pageSize: 30,
      });
      const {
        list = [],
        hasMore = false,
        balance = 0,
      } = res.data || {};
      this.setData({
        list: reset ? list : this.data.list.concat(list),
        page: page + 1,
        hasMore,
        balance,
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
});
