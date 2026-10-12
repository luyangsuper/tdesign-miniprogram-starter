import { callFunction } from '~/utils/cloud';
import {
  formatBatchResultTip,
  runBatchDownload,
} from '~/utils/batchDownload';
import { getOpenId, resolveIsAdmin } from '~/utils/auth';
import { CATEGORY_FILTER_ALL } from '~/utils/categories';
import {
  canAttemptDownload,
  estimateBatchAffordable,
  getCachedEntitlement,
  setCachedEntitlement,
} from '~/utils/entitlement';
import {
  applyPendingPointGifts,
  formatGiftAffordLine,
  markActivityGiftsAcked,
  summarizePendingPointGifts,
} from '~/utils/giftHint';
import {
  applyPendingLotteryInvites,
  applyPendingLotteryResults,
  markLotteryInvitesAcked,
  markLotteryResultsAcked,
} from '~/utils/lotteryHint';
import { downloadCost } from '~/utils/pricing';
import {
  requestNewPackSubscribe,
  shouldShowNewPackGuide,
} from '~/utils/subscribe';
import { applyThemeToPage, applyThemeToTabBar, getThemeStyle } from '~/utils/theme';

const CONFIRM_ICONS = {
  warn: '/static/emoji/warn.png',
  static: '/static/emoji/static.png',
  anim: '/static/emoji/anim.png',
};

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

/**
 * 只把新增项追加到现有列（不重排旧卡片），避免加载更多时组件重挂导致封面空白。
 */
function appendColumns(columns, newItems, columnCount) {
  const n = Math.max(1, Number(columnCount) || 2);
  const cols = Array.from({ length: n }, (_, i) =>
    ((columns && columns[i]) || []).slice(),
  );
  const heights = cols.map((col) =>
    col.reduce((sum, item) => {
      const ratio = Number(item.coverRatio) > 0 ? Number(item.coverRatio) : 1;
      return sum + ratio + 0.55;
    }, 0),
  );
  (newItems || []).forEach((item) => {
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
    /** 胶囊按钮几何，用于把「多选」贴在其左侧 */
    menuButton: {
      top: 48,
      height: 32,
      gap: 96,
    },
    /** 仅固定搜索栏高度；导航栏靠 t-navbar placeholder 占位，勿再叠加 */
    fixedOffset: 80,
    subscribeGuideVisible: false,
    themeStyle: '',
    selectMode: false,
    selectedMap: {},
    selectedCount: 0,
    approxCount: 0,
    approxCost: 0,
    batchVariant: 'static',
    batchSaving: false,
    confirmVisible: false,
    confirmTitle: '',
    confirmContent: '',
    confirmIcon: '',
    confirmOkText: '确认保存',
    giftVisible: false,
    giftPoints: 0,
    giftAffordLine: '',
    activityGiftVisible: false,
    activityGiftTitle: '',
    activityGiftPoints: 0,
    activityGiftAffordLine: '',
    activityGiftTip: '感谢参与趣集活动',
    lotteryInviteVisible: false,
    lotteryInvite: null,
    lotteryResultVisible: false,
    lotteryResult: null,
  },

  _listSeq: 0,
  _listCache: null,
  _confirmResolve: null,

  onShow() {
    applyThemeToPage(this);
    applyThemeToTabBar();
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      const bar = this.getTabBar();
      if (typeof bar.setSelected === 'function') bar.setSelected('home');
      else bar.setData({ value: 'home' });
      if (typeof bar.syncTheme === 'function') bar.syncTheme();
    }
    this.refreshAdmin();
    this.maybeShowWelcomeGift();
    this.maybeShowActivityGift();
    this.maybeShowLotteryResult();
    this.maybeShowLotteryInvite();
    this.pullPendingActivityGifts();
    this.startActivityGiftPoll();
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

  onHide() {
    this.stopActivityGiftPoll();
  },

  /** 拉取云端待弹活动积分（覆盖「正在用」的用户，不必冷启动） */
  async pullPendingActivityGifts() {
    if (this._pullingActivityGifts || this._closingActivityGift) return;
    this._pullingActivityGifts = true;
    try {
      const res = await callFunction('userEntitlement', { action: 'get' });
      if (res && res.entitlement) {
        setCachedEntitlement(res.entitlement);
      }
      applyPendingPointGifts(res && res.pendingPointGifts);
      applyPendingLotteryInvites(res && res.pendingLotteryInvites);
      applyPendingLotteryResults(res && res.pendingLotteryResults);
      // 有弹窗占用时只合并队列，不抢焦点
      if (!this.data.activityGiftVisible) this.maybeShowActivityGift();
      if (!this.anyBlockingPopup()) {
        this.maybeShowLotteryResult();
        this.maybeShowLotteryInvite();
      }
    } catch (e) {
      /* ignore */
    } finally {
      this._pullingActivityGifts = false;
    }
  },

  startActivityGiftPoll() {
    this.stopActivityGiftPoll();
    // 停留首页时轻量轮询，管理员刚发放也能很快看到
    this._activityGiftPollTimer = setInterval(() => {
      this.pullPendingActivityGifts();
    }, 15000);
  },

  stopActivityGiftPoll() {
    if (this._activityGiftPollTimer) {
      clearInterval(this._activityGiftPollTimer);
      this._activityGiftPollTimer = null;
    }
  },

  maybeShowWelcomeGift() {
    try {
      const app = getApp();
      const gift = app.globalData && app.globalData.pendingWelcomeGift;
      const points = gift && Number(gift.points);
      if (!points || points <= 0) return;
      if (this.data.giftVisible || this.data.subscribeGuideVisible) return;
      app.globalData.pendingWelcomeGift = null;
      this.setData({
        giftVisible: true,
        giftPoints: points,
        giftAffordLine: formatGiftAffordLine(points),
      });
    } catch (e) {
      /* ignore */
    }
  },

  closeWelcomeGift() {
    const openid = getOpenId();
    if (openid) {
      try {
        wx.setStorageSync(`welcome_gift_shown_${openid}`, 1);
      } catch (e) {
        /* ignore */
      }
    }
    this.setData({ giftVisible: false });
    this.maybeShowActivityGift();
    this.maybeShowLotteryResult();
    this.maybeShowLotteryInvite();
  },

  onGiftVisibleChange(e) {
    if (!(e.detail && e.detail.visible)) {
      this.closeWelcomeGift();
    }
  },

  goCheckinFromGift() {
    this.closeWelcomeGift();
    try {
      const app = getApp();
      if (app.globalData) app.globalData.openCheckinPopup = true;
    } catch (e) {
      /* ignore */
    }
    wx.switchTab({ url: '/pages/my/index' });
  },

  maybeShowActivityGift() {
    try {
      if (
        this.data.giftVisible ||
        this.data.activityGiftVisible ||
        this.data.lotteryInviteVisible ||
        this.data.lotteryResultVisible ||
        this.data.subscribeGuideVisible
      ) {
        return;
      }
      const app = getApp();
      const list = (app.globalData && app.globalData.pendingActivityGifts) || [];
      const summary = summarizePendingPointGifts(list);
      if (!summary.count || summary.total <= 0) {
        if (app.globalData) app.globalData.pendingActivityGifts = [];
        this._activityGiftAckIds = [];
        return;
      }
      // 多笔合并为一次弹窗；只确认本次展示的 id，轮询新发的留给下次
      this._activityGiftAckIds = summary.ids.slice();
      this.setData({
        activityGiftVisible: true,
        activityGiftTitle: summary.title,
        activityGiftPoints: summary.total,
        activityGiftAffordLine: summary.affordLine,
        activityGiftTip: summary.tip,
      });
    } catch (e) {
      /* ignore */
    }
  },

  async closeActivityGift() {
    if (this._closingActivityGift) return;
    this._closingActivityGift = true;
    const ackIds = Array.isArray(this._activityGiftAckIds)
      ? this._activityGiftAckIds.slice()
      : [];
    this._activityGiftAckIds = [];
    markActivityGiftsAcked(ackIds);
    this.setData({ activityGiftVisible: false });
    try {
      const app = getApp();
      if (app.globalData) {
        const left = (app.globalData.pendingActivityGifts || []).filter(
          (g) => g && g.id && !ackIds.includes(g.id),
        );
        app.globalData.pendingActivityGifts = left;
      }
    } catch (e) {
      /* ignore */
    }
    if (ackIds.length) {
      try {
        await callFunction('userEntitlement', {
          action: 'ackPointGifts',
          giftIds: ackIds,
        });
      } catch (e) {
        /* ignore */
      }
    }
    this._closingActivityGift = false;
    // 关闭后若队列里还有（弹窗期间新发的），再合并弹一次
    this.maybeShowActivityGift();
    this.maybeShowLotteryResult();
    this.maybeShowLotteryInvite();
  },

  onActivityGiftVisibleChange(e) {
    if (!(e.detail && e.detail.visible)) {
      this.closeActivityGift();
    }
  },

  anyBlockingPopup() {
    return (
      this.data.giftVisible ||
      this.data.activityGiftVisible ||
      this.data.lotteryInviteVisible ||
      this.data.lotteryResultVisible ||
      this.data.subscribeGuideVisible
    );
  },

  maybeShowLotteryResult() {
    try {
      if (this.anyBlockingPopup()) return;
      const app = getApp();
      const list = (app.globalData && app.globalData.pendingLotteryResults) || [];
      const item = list.find((g) => g && g.id && g.lotteryId);
      if (!item) return;
      this.setData({
        lotteryResultVisible: true,
        lotteryResult: item,
      });
    } catch (e) {
      /* ignore */
    }
  },

  maybeShowLotteryInvite() {
    try {
      if (this.anyBlockingPopup()) return;
      const app = getApp();
      const list = (app.globalData && app.globalData.pendingLotteryInvites) || [];
      const item = list.find((g) => g && g.id && g.lotteryId);
      if (!item) return;
      this.setData({
        lotteryInviteVisible: true,
        lotteryInvite: item,
      });
    } catch (e) {
      /* ignore */
    }
  },

  async closeLotteryInvite() {
    if (this._closingLotteryInvite) return;
    this._closingLotteryInvite = true;
    const invite = this.data.lotteryInvite;
    const inviteId = invite && invite.id;
    const lotteryId = invite && invite.lotteryId;
    if (inviteId) markLotteryInvitesAcked([inviteId]);
    this.setData({ lotteryInviteVisible: false, lotteryInvite: null });
    try {
      const app = getApp();
      if (app.globalData) {
        app.globalData.pendingLotteryInvites = (
          app.globalData.pendingLotteryInvites || []
        ).filter((g) => g && g.id !== inviteId);
      }
    } catch (e) {
      /* ignore */
    }
    try {
      await callFunction('userLottery', {
        action: 'ackInvite',
        inviteId,
        lotteryId,
      });
    } catch (e) {
      /* ignore */
    }
    this._closingLotteryInvite = false;
    this.maybeShowLotteryResult();
    this.maybeShowLotteryInvite();
  },

  onLotteryInviteVisibleChange(e) {
    if (!(e.detail && e.detail.visible)) {
      this.closeLotteryInvite();
    }
  },

  async onLotteryJoined(e) {
    const detail = (e && e.detail) || {};
    const inviteId = detail.inviteId || (this.data.lotteryInvite && this.data.lotteryInvite.id);
    if (inviteId) markLotteryInvitesAcked([inviteId]);
    try {
      const app = getApp();
      if (app.globalData) {
        app.globalData.pendingLotteryInvites = (
          app.globalData.pendingLotteryInvites || []
        ).filter((g) => g && g.id !== inviteId);
      }
    } catch (err) {
      /* ignore */
    }
    this.setData({ lotteryInviteVisible: false, lotteryInvite: null });
    this.maybeShowLotteryInvite();
  },

  async closeLotteryResult() {
    if (this._closingLotteryResult) return;
    this._closingLotteryResult = true;
    const result = this.data.lotteryResult;
    const resultId = result && result.id;
    const lotteryId = result && result.lotteryId;
    if (resultId) markLotteryResultsAcked([resultId]);
    this.setData({ lotteryResultVisible: false, lotteryResult: null });
    try {
      const app = getApp();
      if (app.globalData) {
        app.globalData.pendingLotteryResults = (
          app.globalData.pendingLotteryResults || []
        ).filter((g) => g && g.id !== resultId);
      }
    } catch (e) {
      /* ignore */
    }
    try {
      await callFunction('userLottery', {
        action: 'ackResult',
        resultId,
        lotteryId,
      });
    } catch (e) {
      /* ignore */
    }
    this._closingLotteryResult = false;
    this.maybeShowLotteryResult();
    this.maybeShowLotteryInvite();
  },

  onLotteryResultVisibleChange(e) {
    if (!(e.detail && e.detail.visible)) {
      this.closeLotteryResult();
    }
  },

  onLoad() {
    this._listCache = Object.create(null);
    this._listSeq = 0;
    this.setData({ themeStyle: getThemeStyle() });
    this._onThemeChange = () => applyThemeToPage(this);
    this._onWelcomeGift = () => this.maybeShowWelcomeGift();
    this._onActivityGift = () => this.maybeShowActivityGift();
    this._onLotteryInvite = () => this.maybeShowLotteryInvite();
    this._onLotteryResult = () => this.maybeShowLotteryResult();
    try {
      const app = getApp();
      if (app && app.eventBus) {
        app.eventBus.on('themeChange', this._onThemeChange);
        app.eventBus.on('welcomeGift', this._onWelcomeGift);
        app.eventBus.on('activityGift', this._onActivityGift);
        app.eventBus.on('lotteryInvite', this._onLotteryInvite);
        app.eventBus.on('lotteryResult', this._onLotteryResult);
      }
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
    this.stopActivityGiftPoll();
    try {
      const app = getApp();
      if (app && app.eventBus) {
        if (this._onThemeChange) app.eventBus.off('themeChange', this._onThemeChange);
        if (this._onWelcomeGift) app.eventBus.off('welcomeGift', this._onWelcomeGift);
        if (this._onActivityGift) app.eventBus.off('activityGift', this._onActivityGift);
        if (this._onLotteryInvite) app.eventBus.off('lotteryInvite', this._onLotteryInvite);
        if (this._onLotteryResult) app.eventBus.off('lotteryResult', this._onLotteryResult);
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
      if (
        this.data.subscribeGuideVisible ||
        this.data.giftVisible ||
        this.data.activityGiftVisible ||
        this.data.lotteryInviteVisible ||
        this.data.lotteryResultVisible
      ) {
        return;
      }
      setTimeout(() => {
        if (this._subscribeGuideDismissedSession || this.data.giftVisible) return;
        if (this.data.activityGiftVisible) return;
        if (this.data.lotteryInviteVisible || this.data.lotteryResultVisible) return;
        try {
          const app = getApp();
          if (app.globalData && app.globalData.pendingWelcomeGift) return;
          if (
            app.globalData &&
            Array.isArray(app.globalData.pendingActivityGifts) &&
            app.globalData.pendingActivityGifts.length
          ) {
            return;
          }
          if (
            (app.globalData.pendingLotteryInvites || []).length ||
            (app.globalData.pendingLotteryResults || []).length
          ) {
            return;
          }
        } catch (e) {
          /* ignore */
        }
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

  /** 自定义导航栏高度（状态栏 + 标题栏）+ 胶囊旁多选按钮位置 */
  updateNavHeight() {
    try {
      const sys = wx.getSystemInfoSync();
      const menu = wx.getMenuButtonBoundingClientRect();
      const gap = menu.top - sys.statusBarHeight;
      const navHeight = sys.statusBarHeight + gap * 2 + menu.height;
      const menuGap = Math.max(8, Math.round(sys.windowWidth - menu.left + 8));
      this.setData({
        navHeight,
        menuButton: {
          top: menu.top,
          height: menu.height,
          gap: menuGap,
        },
      });
    } catch (e) {
      this.setData({
        navHeight: 64,
        menuButton: { top: 48, height: 32, gap: 96 },
      });
    }
  },

  measureFixedBar() {
    const query = wx.createSelectorQuery();
    query.select('.home__fixed').boundingClientRect();
    query.exec((res) => {
      const rect = res && res[0];
      if (!rect || !rect.height) return;
      // t-navbar（fixed + placeholder）已占位，这里只需给「吸顶搜索+分类」留高
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
      appendItems,
    } = payload;
    const columns =
      appendItems && appendItems.length
        ? appendColumns(this.data.columns, appendItems, this.data.columnCount)
        : buildColumns(list, this.data.columnCount);
    this.setData({
      list,
      columns,
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
    this.clearPackSelection();
    this.loadList(true);
  },

  onSearchClear() {
    this.setData({ keyword: '' });
    this.clearPackSelection();
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
    this.clearPackSelection();
    this.setData({ categoryId: id, listTotal }, () => {
      setTimeout(() => this.measureFixedBar(), 30);
    });
    this.loadList(true);
  },

  clearPackSelection() {
    if (!this.data.selectedCount && !Object.keys(this.data.selectedMap || {}).length) {
      return;
    }
    this.setData({
      selectedMap: {},
      selectedCount: 0,
      approxCount: 0,
      approxCost: 0,
    });
  },

  computeBatchMeta(selectedMap, variant) {
    const map = selectedMap || {};
    const v = variant === 'anim' ? 'anim' : 'static';
    const cost = downloadCost(v);
    let selectedCount = 0;
    let approxCount = 0;
    (this.data.list || []).forEach((item) => {
      if (!item || !map[item._id]) return;
      selectedCount += 1;
      approxCount += Math.max(0, Number(item.emojiCount) || 0);
    });
    return {
      selectedCount,
      approxCount,
      approxCost: approxCount * cost,
    };
  },

  onToggleSelectMode() {
    if (this.data.batchSaving) return;
    if (this.data.selectMode) {
      this.setData({
        selectMode: false,
        selectedMap: {},
        selectedCount: 0,
        approxCount: 0,
        approxCost: 0,
      });
      return;
    }
    this.setData({ selectMode: true });
  },

  onTogglePack(e) {
    if (!this.data.selectMode || this.data.batchSaving) return;
    const packId = e.detail && e.detail.packId;
    if (!packId) return;
    const selectedMap = { ...(this.data.selectedMap || {}) };
    if (selectedMap[packId]) delete selectedMap[packId];
    else selectedMap[packId] = true;
    this.setData({
      selectedMap,
      ...this.computeBatchMeta(selectedMap, this.data.batchVariant),
    });
  },

  onBatchVariantTap(e) {
    const value =
      (e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.value) ||
      '';
    const batchVariant = value === 'anim' ? 'anim' : 'static';
    if (batchVariant === this.data.batchVariant) return;
    this.setData({
      batchVariant,
      ...this.computeBatchMeta(this.data.selectedMap, batchVariant),
    });
  },

  confirmAsync(content, options = {}) {
    const {
      title = '确认保存',
      icon = CONFIRM_ICONS.static,
      okText = '确认保存',
    } = options;
    return new Promise((resolve) => {
      if (this._confirmResolve) {
        this._confirmResolve(false);
        this._confirmResolve = null;
      }
      this._confirmResolve = resolve;
      this.setData({
        confirmVisible: true,
        confirmTitle: title,
        confirmContent: content,
        confirmIcon: icon,
        confirmOkText: okText,
      });
    });
  },

  settleConfirm(ok) {
    const resolve = this._confirmResolve;
    this._confirmResolve = null;
    this.setData({ confirmVisible: false });
    if (typeof resolve === 'function') resolve(!!ok);
  },

  onConfirmOk() {
    this.settleConfirm(true);
  },

  onConfirmCancel() {
    this.settleConfirm(false);
  },

  goRedeem() {
    wx.switchTab({ url: '/pages/my/index' });
  },

  async buildBatchJobs(packIds, variant) {
    const jobs = [];
    let skippedPacks = 0;
    for (let i = 0; i < packIds.length; i += 1) {
      const packId = packIds[i];
      // eslint-disable-next-line no-await-in-loop
      const res = await callFunction('getPackDetail', { packId });
      const data = (res && res.data) || {};
      const slots = Array.isArray(data.slots) ? data.slots : [];
      let indexes;
      if (variant === 'anim') {
        indexes = slots.filter((s) => s && s.hasAnim).map((s) => Number(s.index));
        if (!indexes.length) {
          skippedPacks += 1;
          continue;
        }
      } else {
        const count = Math.max(
          0,
          Number(data.emojiCount) || slots.length || 0,
        );
        indexes = slots.length
          ? slots.map((s) => Number(s.index))
          : Array.from({ length: count }, (_, idx) => idx);
      }
      indexes = indexes.filter((n) => !Number.isNaN(n) && n >= 0);
      if (!indexes.length) {
        skippedPacks += 1;
        continue;
      }
      jobs.push({ packId, indexes });
    }
    return { jobs, skippedPacks };
  },

  async onBatchDownload() {
    if (this.data.batchSaving) return;
    const selectedMap = this.data.selectedMap || {};
    const packIds = Object.keys(selectedMap).filter((id) => selectedMap[id]);
    if (!packIds.length) {
      wx.showToast({ title: '请先选择合集', icon: 'none' });
      return;
    }

    const variant = this.data.batchVariant === 'anim' ? 'anim' : 'static';
    if (!canAttemptDownload(getCachedEntitlement(), variant)) {
      wx.showToast({
        title: `积分不足（单张需 ${downloadCost(variant)} 积分）`,
        icon: 'none',
      });
      this.goRedeem();
      return;
    }

    this.setData({ batchSaving: true });
    wx.showLoading({ title: '准备中...', mask: true });

    let jobs = [];
    let skippedPacks = 0;
    try {
      const built = await this.buildBatchJobs(packIds, variant);
      jobs = built.jobs;
      skippedPacks = built.skippedPacks;
    } catch (err) {
      wx.hideLoading();
      this.setData({ batchSaving: false });
      wx.showToast({ title: (err && err.message) || '加载合集失败', icon: 'none' });
      return;
    }

    const totalCount = jobs.reduce((sum, j) => sum + (j.indexes || []).length, 0);
    wx.hideLoading();

    if (!totalCount) {
      this.setData({ batchSaving: false });
      wx.showToast({
        title: variant === 'anim' ? '所选合集暂无动态原图' : '所选合集没有可下载原图',
        icon: 'none',
      });
      return;
    }

    const estimate = estimateBatchAffordable(
      getCachedEntitlement(),
      variant,
      totalCount,
    );

    if (!estimate.canAny) {
      this.setData({ batchSaving: false });
      wx.showToast({
        title: `积分不足（单张需 ${estimate.cost} 积分）`,
        icon: 'none',
      });
      this.goRedeem();
      return;
    }

    if (!estimate.canAll) {
      await this.confirmAsync(
        `余额约 ${estimate.spendable} 积分，只够保存 ${estimate.maxCount} / ${totalCount} 张（每张 ${estimate.cost} 积分）。请取消部分合集后再下载。`,
        { title: '积分不太够哦', icon: CONFIRM_ICONS.warn, okText: '去重选' },
      );
      this.setData({ batchSaving: false });
      return;
    }

    const kindLabel = variant === 'anim' ? '动态 GIF' : '静态原图';
    const kindIcon = variant === 'anim' ? CONFIRM_ICONS.anim : CONFIRM_ICONS.static;
    let confirmText = `将保存 ${packIds.length} 个合集共 ${totalCount} 张「${kindLabel}」，预计消耗 ${estimate.totalCost} 积分（先扣本月额度，再扣积分）。确认后按张扣费并写入相册。`;
    if (skippedPacks) {
      confirmText += `（另有 ${skippedPacks} 个合集无可用原图将跳过）`;
    }
    const confirmed = await this.confirmAsync(confirmText, {
      title: `保存${kindLabel}`,
      icon: kindIcon,
      okText: '确认保存',
    });
    if (!confirmed) {
      this.setData({ batchSaving: false });
      return;
    }

    let result;
    try {
      result = await runBatchDownload({
        jobs,
        variant,
        onProgress: ({ current, total }) => {
          wx.showLoading({
            title: `保存中 ${current}/${total}`,
            mask: true,
          });
        },
      });
    } catch (err) {
      wx.hideLoading();
      this.setData({ batchSaving: false });
      wx.showToast({ title: (err && err.message) || '保存失败', icon: 'none' });
      return;
    }

    wx.hideLoading();
    result.skippedPacks = skippedPacks;

    wx.showToast({
      title: formatBatchResultTip(result),
      icon: result.okCount ? 'success' : 'none',
      duration: 2500,
    });

    if (result.okCount) {
      this.setData({
        selectMode: false,
        selectedMap: {},
        selectedCount: 0,
        approxCount: 0,
        approxCost: 0,
        batchSaving: false,
      });
    } else {
      this.setData({ batchSaving: false });
    }

    if (result.stoppedByBalance && !result.okCount) {
      this.goRedeem();
    }
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
        // 分页追加：不重排已有列，避免旧卡片重挂封面空白
        appendItems: reset ? null : withRatio,
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
    this.clearPackSelection();
    this.updateLayout();
    this.clearListCache();
    this.loadCategories();
    this.loadList(true, { force: true });
  },

  /** t-pull-down-refresh 内嵌 scroll-view，页级 onReachBottom 往往不触发 */
  onScrollToLower() {
    this.loadList(false);
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
