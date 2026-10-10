import { callFunction } from '~/utils/cloud';
import { resolveIsAdmin } from '~/utils/auth';
import { CATEGORY_FILTER_ALL } from '~/utils/categories';
import {
  requestNewPackSubscribe,
  shouldShowNewPackGuide,
} from '~/utils/subscribe';
import { applyThemeToPage, applyThemeToTabBar, getThemeStyle } from '~/utils/theme';

/** Skyline 无 column-count，用最短列堆积模拟瀑布流 */
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

const LIST_CACHE_TTL = 90 * 1000;

function listCacheKey(categoryId, keyword) {
  return `${categoryId || 'all'}::${String(keyword || '').trim()}`;
}

Page({
  data: {
    enable: false,
    loading: true,
    list: [],
    columns: [[], []],
    page: 1,
    hasMore: true,
    loadingMore: false,
    columnCount: 2,
    cardWidth: 0,
    listGap: 6,
    rowGap: 6,
    keyword: '',
    searchExpanded: false,
    searchFocus: false,
    categoryId: CATEGORY_FILTER_ALL,
    filters: [{ id: 'all', name: '全部', count: 0 }],
    /** 当前筛选下的合集数，展示在分类下方，不写进标签 */
    listTotal: 0,
    isAdmin: false,
    deleteDialogVisible: false,
    deletePackId: '',
    deleteTitle: '',
    navHeight: 64,
    /** 仅固定搜索栏高度；导航栏由 t-navbar 占位，勿再叠加 */
    fixedOffset: 80,
    subscribeGuideVisible: false,
    themeStyle: '',
  },

  _listSeq: 0,
  _listCache: null,

  onShow() {
    applyThemeToPage(this);
    applyThemeToTabBar();
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      const bar = this.getTabBar();
      bar.setData({ value: 'home' });
      if (typeof bar.syncTheme === 'function') bar.syncTheme();
    }
    this.refreshAdmin();
    this.maybeShowSubscribeGuide();
    try {
      const app = getApp();
      if (app.globalData && app.globalData.homeNeedRefresh) {
        app.globalData.homeNeedRefresh = false;
        this.clearListCache();
        this.loadCategories();
        this.loadList(true, { force: true });
      }
    } catch (e) {
      /* ignore */
    }
  },

  onLoad() {
    this._listCache = Object.create(null);
    this._listSeq = 0;
    this.setData({ themeStyle: getThemeStyle() });
    this._onThemeChange = () => applyThemeToPage(this);
    try {
      const app = getApp();
      if (app && app.eventBus) app.eventBus.on('themeChange', this._onThemeChange);
    } catch (e) {
      /* ignore */
    }
    this.updateNavHeight();
    this.updateLayout();
    this.refreshAdmin();
    this.loadCategories();
    this.loadList(true);
    // 等固定栏渲染后量高度，给列表留出顶距
    setTimeout(() => this.measureFixedBar(), 50);
    // 预加载详情分包，减少首次点进详情的等待
    try {
      if (typeof wx.loadSubpackage === 'function') {
        const task = wx.loadSubpackage({ name: 'pack' });
        if (task && typeof task.catch === 'function') task.catch(() => {});
      }
    } catch (e) {
      /* ignore */
    }
  },

  onUnload() {
    try {
      const app = getApp();
      if (app && app.eventBus && this._onThemeChange) {
        app.eventBus.off('themeChange', this._onThemeChange);
      }
    } catch (e) {
      /* ignore */
    }
  },

  async maybeShowSubscribeGuide() {
    // 本会话点过「以后再说」则暂不弹；有额度也不弹；额度用尽再进首页会弹
    if (this._subscribeGuideDismissedSession) return;
    try {
      const show = await shouldShowNewPackGuide();
      if (!show) {
        if (this.data.subscribeGuideVisible) {
          this.setData({ subscribeGuideVisible: false });
        }
        return;
      }
      if (this.data.subscribeGuideVisible) return;
      setTimeout(() => {
        if (this._subscribeGuideDismissedSession) return;
        this.setData({ subscribeGuideVisible: true });
      }, 600);
    } catch (e) {
      /* ignore */
    }
  },

  onSubscribeGuideVisibleChange(e) {
    const visible = !!(e.detail && e.detail.visible);
    this.setData({ subscribeGuideVisible: visible });
    if (!visible) {
      this._subscribeGuideDismissedSession = true;
    }
  },

  onSubscribeGuideLater() {
    this._subscribeGuideDismissedSession = true;
    this.setData({ subscribeGuideVisible: false });
  },

  async onSubscribeGuideConfirm() {
    try {
      const res = await requestNewPackSubscribe();
      this.setData({ subscribeGuideVisible: false });
      if (res.accepted) {
        // 有额度后本会话不再弹
        this._subscribeGuideDismissedSession = false;
        wx.showToast({ title: '已开启提醒', icon: 'success' });
      } else {
        this._subscribeGuideDismissedSession = true;
        wx.showToast({ title: '未开启提醒', icon: 'none' });
      }
    } catch (e) {
      const msg = (e && (e.errMsg || e.message)) || '订阅失败';
      wx.showToast({ title: msg.slice(0, 40), icon: 'none' });
    }
  },

  onResize() {
    this.updateNavHeight();
    this.updateLayout();
    setTimeout(() => this.measureFixedBar(), 50);
  },

  /** 自定义导航栏高度（状态栏 + 标题栏） */
  updateNavHeight() {
    try {
      const sys = wx.getSystemInfoSync();
      const menu = wx.getMenuButtonBoundingClientRect();
      const gap = menu.top - sys.statusBarHeight;
      const navHeight = sys.statusBarHeight + gap * 2 + menu.height;
      this.setData({ navHeight });
    } catch (e) {
      this.setData({ navHeight: 64 });
    }
  },

  measureFixedBar() {
    const query = wx.createSelectorQuery();
    query.select('.home__fixed').boundingClientRect();
    query.exec((res) => {
      const rect = res && res[0];
      if (!rect || !rect.height) return;
      // t-navbar 已在文档流中占位，这里只需给「吸顶搜索+分类」留高
      this.setData({
        fixedOffset: Math.ceil(rect.height) + 8,
      });
    });
  },

  refreshAdmin() {
    this.setData({ isAdmin: resolveIsAdmin() });
  },

  updateLayout() {
    const { windowWidth } = wx.getSystemInfoSync();
    let columnCount = 2;
    if (windowWidth >= 560) columnCount = 3;
    if (windowWidth >= 840) columnCount = 4;

    // 页边距与卡片间距同一数值，只扣一次，避免「页边 + 缝」看起来叠宽
    const gap = 6;
    const rowGap = 6;
    const cardWidth = Math.floor(
      (windowWidth - gap * 2 - gap * (columnCount - 1)) / columnCount,
    );

    const patch = { columnCount, cardWidth, listGap: gap, rowGap };
    if (this.data.list && this.data.list.length) {
      patch.columns = buildColumns(this.data.list, columnCount);
    }
    this.setData(patch);
  },

  filterCount(categoryId) {
    const id = categoryId || this.data.categoryId;
    const hit = (this.data.filters || []).find((f) => f.id === id);
    return hit ? Number(hit.count) || 0 : 0;
  },

  applyListState(payload) {
    const {
      list,
      page,
      hasMore,
      total,
      loading = false,
      loadingMore = false,
      enable = false,
    } = payload;
    this.setData({
      list,
      columns: buildColumns(list, this.data.columnCount),
      page,
      hasMore,
      listTotal: Math.max(0, Number(total) || 0),
      loading,
      loadingMore,
      enable,
    });
  },

  clearListCache() {
    this._listCache = Object.create(null);
  },

  async loadCategories() {
    try {
      const res = await callFunction('listCategories');
      const raw = (res.data && res.data.filters) || [
        { id: 'all', name: '全部', count: 0 },
      ];
      // 标签只保留名称；数量用 listTotal 单独展示
      const filters = raw
        .filter((f) => f.id === 'all' || (f.count || 0) > 0)
        .map((f) => ({
          id: f.id,
          name: f.name || f.label || '',
          count: f.count || 0,
        }));
      const next = filters.length ? filters : [{ id: 'all', name: '全部', count: 0 }];
      const patch = { filters: next };
      if (!next.some((f) => f.id === this.data.categoryId)) {
        patch.categoryId = 'all';
      }
      // 无搜索词时，用分类统计刷新「共 N 个」
      if (!String(this.data.keyword || '').trim()) {
        const id = patch.categoryId || this.data.categoryId;
        const hit = next.find((f) => f.id === id);
        if (hit) patch.listTotal = hit.count || 0;
      }
      this.setData(patch, () => {
        setTimeout(() => this.measureFixedBar(), 50);
      });
    } catch (e) {
      console.warn('[categories]', e.message || e);
    }
  },

  openSearch() {
    if (this.data.searchExpanded) return;
    this.setData({ searchExpanded: true });
    // 等宽度过渡后再聚焦，避免键盘把布局顶乱
    setTimeout(() => {
      this.setData({ searchFocus: true });
      this.measureFixedBar();
    }, 280);
  },

  closeSearch() {
    this.setData({ searchFocus: false, searchExpanded: false });
    setTimeout(() => this.measureFixedBar(), 280);
  },

  onSearchChange(e) {
    this.setData({ keyword: e.detail.value || '' });
  },

  onSearchSubmit(e) {
    const keyword = (e.detail && e.detail.value) || this.data.keyword || '';
    this.setData({ keyword: keyword.trim(), searchFocus: false });
    this.loadList(true);
  },

  onSearchClear() {
    this.setData({ keyword: '' });
    this.loadList(true);
  },

  onSearchBlur() {
    this.setData({ searchFocus: false });
  },

  onCategoryTap(e) {
    const id =
      (e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id) ||
      (e.target && e.target.dataset && e.target.dataset.id);
    if (id === undefined || id === null || id === '' || id === this.data.categoryId) {
      return;
    }
    const listTotal = this.filterCount(id);
    this.setData({ categoryId: id, listTotal }, () => {
      setTimeout(() => this.measureFixedBar(), 30);
    });
    this.loadList(true);
  },

  async resolveCoverRatios(list, seq) {
    const out = [];
    for (let i = 0; i < list.length; i += 1) {
      if (seq !== this._listSeq) return null;
      const item = list[i];
      const fromApi = Number(item.coverRatio) || 0;
      if (fromApi > 0.2 && fromApi < 4) {
        out.push({ ...item, coverRatio: fromApi });
        continue;
      }
      let cached = 0;
      try {
        cached = Number(wx.getStorageSync(`coverRatio_${item._id}`)) || 0;
      } catch (err) {
        cached = 0;
      }
      if (cached > 0.2 && cached < 4) {
        out.push({ ...item, coverRatio: cached });
        continue;
      }
      if (!item.coverUrl) {
        out.push({ ...item, coverRatio: 1 });
        continue;
      }
      // 缺比例时用默认值先展示，避免切换分类时排队 getImageInfo
      out.push({ ...item, coverRatio: 1 });
    }
    return out;
  },

  async loadList(reset = false, options = {}) {
    const force = !!(options && options.force);
    if (!this._listCache) this._listCache = Object.create(null);

    const categoryId = this.data.categoryId;
    const keyword = String(this.data.keyword || '').trim();
    const cacheKey = listCacheKey(categoryId, keyword);

    // 重置时用序号作废进行中的旧请求，避免快切分类写回错数据
    if (reset) {
      this._listSeq += 1;
    }
    const seq = this._listSeq;

    if (reset && !force) {
      const cached = this._listCache[cacheKey];
      if (cached && cached.list && cached.list.length) {
        this.applyListState({
          list: cached.list,
          page: cached.page,
          hasMore: cached.hasMore,
          total: cached.total,
        });
        // 缓存仍新鲜：不再打云函数
        if (Date.now() - cached.at < LIST_CACHE_TTL) {
          return;
        }
        // 过期：静默后台刷新，不闪整页 loading
      } else {
        this.applyListState({
          list: [],
          page: 1,
          hasMore: true,
          total: keyword ? 0 : this.filterCount(categoryId),
          loading: true,
        });
      }
    } else if (reset && force && !this.data.list.length) {
      this.setData({ loading: true, loadingMore: false, page: 1, hasMore: true });
    }

    if (!reset) {
      if (!this.data.hasMore) return;
      if (this.data.loadingMore) return;
      this.setData({ loadingMore: true });
    }

    const page = reset ? 1 : this.data.page;

    try {
      const res = await callFunction('listPacks', {
        page,
        pageSize: 10,
        keyword,
        categoryId,
      });
      if (seq !== this._listSeq) return;

      const {
        list = [],
        hasMore = false,
        total = 0,
      } = res.data || {};
      const withRatio = await this.resolveCoverRatios(list, seq);
      if (!withRatio || seq !== this._listSeq) return;

      const nextList = reset ? withRatio : this.data.list.concat(withRatio);
      const nextPage = page + 1;
      const nextTotal = Number(total) >= 0 ? Number(total) : nextList.length;

      this._listCache[cacheKey] = {
        at: Date.now(),
        list: nextList,
        page: nextPage,
        hasMore,
        total: nextTotal,
      };

      this.applyListState({
        list: nextList,
        page: nextPage,
        hasMore,
        total: nextTotal,
      });
    } catch (e) {
      if (seq !== this._listSeq) return;
      this.setData({ loading: false, loadingMore: false, enable: false });
      const msg = (e && (e.errMsg || e.message)) || '加载失败';
      if (!/INVALID_ENV|Environment not found|-501000/i.test(msg)) {
        wx.showToast({ title: msg.slice(0, 40), icon: 'none' });
      }
    }
  },

  onRefresh() {
    this.setData({ enable: true });
    this.updateLayout();
    this.clearListCache();
    this.loadCategories();
    this.loadList(true, { force: true });
  },

  onReachBottom() {
    this.loadList(false);
  },

  onEditPack(e) {
    const { packId } = e.detail || {};
    if (!packId) return;
    wx.navigateTo({ url: `/pages/admin/upload/index?id=${packId}` });
  },

  onDeletePack(e) {
    const { packId, title } = e.detail || {};
    if (!packId) return;
    this.setData({
      deleteDialogVisible: true,
      deletePackId: packId,
      deleteTitle: title || '该合集',
    });
  },

  onCancelDelete() {
    this.setData({
      deleteDialogVisible: false,
      deletePackId: '',
      deleteTitle: '',
    });
  },

  async onConfirmDelete() {
    const { deletePackId } = this.data;
    this.setData({ deleteDialogVisible: false });
    if (!deletePackId) return;

    wx.showLoading({ title: '删除中', mask: true });
    try {
      await callFunction('adminDeletePack', { packId: deletePackId });
      wx.hideLoading();
      wx.showToast({ title: '已删除', icon: 'success' });
      this.clearListCache();
      this.loadCategories();
      this.loadList(true, { force: true });
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: err.message || '删除失败', icon: 'none' });
    } finally {
      this.setData({ deletePackId: '', deleteTitle: '' });
    }
  },
});
