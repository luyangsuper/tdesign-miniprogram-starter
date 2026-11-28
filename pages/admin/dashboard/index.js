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
  librarySources: 0,
  libraryItems: 0,
  libraryDownloadsToday: 0,
  libraryActiveToday: 0,
  libraryDownloadsAll: 0,
  workshopUsesToday: 0,
  workshopBeadToday: 0,
  workshopImageToday: 0,
};

const EMPTY_PERIOD = {
  users: 0,
  downloads: 0,
  orders: 0,
  revenueYuan: '0.00',
  libraryDownloads: 0,
  workshopUses: 0,
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
    drillVisible: false,
    drillLoading: false,
    drillTitle: '',
    drillEmpty: '',
    drillList: [],
    drillStack: [],
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

  /** 打开下钻：data-kind + 可选 data-scope（默认 today / 当前累计 period） */
  onDrillOpen(e) {
    const kind = e.currentTarget.dataset.kind;
    if (!kind) return;
    const scopeRaw = e.currentTarget.dataset.scope;
    const scope =
      scopeRaw === 'period'
        ? this.data.period || 'week'
        : scopeRaw || 'today';
    this.setData({ drillStack: [], drillList: [], drillTitle: '' });
    this.openDrill({ kind, scope });
  },

  async openDrill(params, options = {}) {
    const kind = params.kind;
    const scope = params.scope || 'today';
    const replaceStack = options.replaceStack;
    this.setData({
      drillVisible: true,
      drillLoading: true,
      drillEmpty: '',
    });
    try {
      const res = await callFunction('adminDashboard', {
        action: 'drill',
        ...params,
        kind,
        scope,
      });
      const data = (res && res.data) || {};
      const frame = {
        kind: data.kind || kind,
        scope,
        packId: params.packId || '',
        sourceId: params.sourceId || '',
        feature: params.feature || params.reason || '',
        title: data.title || '明细',
      };
      const stack = Array.isArray(replaceStack)
        ? replaceStack
        : [...(this.data.drillStack || []), frame];
      this.setData({
        drillLoading: false,
        drillTitle: data.title || '明细',
        drillEmpty: data.emptyText || '暂无数据',
        drillList: data.list || [],
        drillStack: stack,
      });
    } catch (err) {
      this.setData({ drillLoading: false });
      wx.showToast({
        title: (err.message || '加载失败').slice(0, 40),
        icon: 'none',
      });
    }
  },

  closeDrill() {
    this.setData({
      drillVisible: false,
      drillLoading: false,
      drillList: [],
      drillStack: [],
      drillTitle: '',
    });
  },

  onDrillClose(e) {
    if (e && e.detail && e.detail.visible) return;
    this.closeDrill();
  },

  onDrillBack() {
    const stack = this.data.drillStack || [];
    if (stack.length <= 1) {
      this.closeDrill();
      return;
    }
    const nextStack = stack.slice(0, -1);
    const prev = nextStack[nextStack.length - 1];
    this.openDrill(
      {
        kind: prev.kind,
        scope: prev.scope,
        packId: prev.packId,
        sourceId: prev.sourceId,
        feature: prev.feature,
      },
      { replaceStack: nextStack },
    );
  },

  onDrillItem(e) {
    const idx = Number(e.currentTarget.dataset.index);
    const item = (this.data.drillList || [])[idx];
    if (!item) return;
    const top = (this.data.drillStack || [])[
      (this.data.drillStack || []).length - 1
    ];
    const scope = (top && top.scope) || 'today';

    if (item.kind === 'pack') {
      this.openDrill({ kind: 'downloadUsers', scope, packId: item.id });
      return;
    }
    if (item.kind === 'librarySource') {
      this.openDrill({ kind: 'libraryUsers', scope, sourceId: item.id });
      return;
    }
    if (item.kind === 'workshopFeature') {
      this.openDrill({ kind: 'workshopUsers', scope, feature: item.id });
      return;
    }
    if (item.kind === 'user' || item.kind === 'order') {
      const openid = item.openid || item.id;
      if (!openid) return;
      this.setData({ drillVisible: false });
      wx.navigateTo({
        url: `/pages/admin/users/index?openid=${encodeURIComponent(openid)}`,
      });
    }
  },
});
