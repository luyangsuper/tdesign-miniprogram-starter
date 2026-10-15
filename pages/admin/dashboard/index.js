import { callFunction } from '~/utils/cloud';
import { applyThemeToPage, getThemeStyle } from '~/utils/theme';

const EMPTY_SUMMARY = {
  usersTotal: 0,
  newUsersToday: 0,
  packsPublished: 0,
  packsDraft: 0,
  downloadsToday: 0,
  downloadsWeek: 0,
  activeToday: 0,
  ordersToday: 0,
  ordersWeek: 0,
  ordersPending: 0,
  revenueTodayYuan: '0.00',
  revenueWeekYuan: '0.00',
};

Page({
  data: {
    themeStyle: '',
    loading: true,
    updatedText: '',
    summary: EMPTY_SUMMARY,
    trend: [],
    todayHotPacks: [],
    allTimeHot: [],
  },

  onLoad() {
    this.setData({ themeStyle: getThemeStyle() });
  },

  onShow() {
    applyThemeToPage(this);
    this.load();
  },

  onPullDownRefresh() {
    this.load({ force: true }).finally(() => wx.stopPullDownRefresh());
  },

  onRefresh() {
    this.load({ force: true });
  },

  async load(options = {}) {
    this.setData({ loading: true });
    try {
      const res = await callFunction('adminDashboard', {
        force: !!(options && options.force),
      });
      const data = res.data || {};
      const tip = data.cached
        ? `${data.updatedText || ''} · 缓存`
        : data.updatedText || '';
      this.setData({
        loading: false,
        updatedText: tip,
        summary: { ...EMPTY_SUMMARY, ...(data.summary || {}) },
        trend: data.trend || [],
        todayHotPacks: data.todayHotPacks || [],
        allTimeHot: data.allTimeHot || [],
      });
    } catch (e) {
      this.setData({ loading: false });
      wx.showToast({
        title: (e.message || '加载失败').slice(0, 40),
        icon: 'none',
      });
    }
  },

  onOpenPack(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: `/pages/pack/detail/index?id=${id}` });
  },
});
