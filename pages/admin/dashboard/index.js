import { callFunction } from '~/utils/cloud';
import { guardAdminPage } from '~/utils/auth';
import { applyThemeToPage, getThemeBrand, getThemeStyle } from '~/utils/theme';

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

const EMPTY_PERIOD = {
  users: 0,
  downloads: 0,
  orders: 0,
  revenueYuan: '0.00',
};

const PERIOD_OPTIONS = [
  { id: 'week', label: '近七日' },
  { id: 'month', label: '当月' },
  { id: 'all', label: '全部' },
];

function periodView(period, periods) {
  const id = PERIOD_OPTIONS.some((p) => p.id === period) ? period : 'week';
  const block = (periods && periods[id]) || {};
  return {
    period: id,
    periodSummary: { ...EMPTY_PERIOD, ...(block.summary || {}) },
    revenueTrend: block.revenueTrend || [],
    usersLabel: id === 'all' ? '注册用户' : '新增用户',
  };
}

Page({
  data: {
    themeStyle: '',
    themeBrand: '',
    loading: true,
    updatedText: '',
    summary: EMPTY_SUMMARY,
    trend: [],
    todayHotPacks: [],
    allTimeHot: [],
    periodOptions: PERIOD_OPTIONS,
    period: 'week',
    periods: {},
    periodSummary: EMPTY_PERIOD,
    revenueTrend: [],
    usersLabel: '新增用户',
  },

  onLoad() {
    this.setData({
      themeStyle: getThemeStyle(),
      themeBrand: getThemeBrand(),
    });
  },

  onShow() {
    if (!guardAdminPage()) return;
    applyThemeToPage(this);
    this.load();
  },

  onPullDownRefresh() {
    this.load({ force: true }).finally(() => wx.stopPullDownRefresh());
  },

  onRefresh() {
    this.load({ force: true });
  },

  onPeriodChange(e) {
    const period = e.currentTarget.dataset.period;
    if (!period) return;
    this.setData(periodView(period, this.data.periods));
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
      const periods = data.periods || {};
      this.setData({
        loading: false,
        updatedText: tip,
        summary: { ...EMPTY_SUMMARY, ...(data.summary || {}) },
        trend: data.trend || [],
        todayHotPacks: data.todayHotPacks || [],
        allTimeHot: data.allTimeHot || [],
        periods,
        ...periodView(this.data.period, periods),
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
