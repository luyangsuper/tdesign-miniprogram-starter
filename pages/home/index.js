import { callFunction } from '~/utils/cloud';
import {
  formatBatchResultTip,
  runBatchDownload,
} from '~/utils/batchDownload';
import { getOpenId, resolveIsAdmin } from '~/utils/auth';
import {
  CATEGORY_FILTER_ALL,
  categoryCheckTagStyle,
} from '~/utils/categories';
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
} from '~/utils/lotteryHint';
import { downloadCost } from '~/utils/pricing';
import { getWindowInfoSafe } from '~/utils/systemInfo';
import {
  requestNewPackSubscribe,
  shouldShowNewPackGuide,
} from '~/utils/subscribe';
import { applyThemeToPage, applyThemeToTabBar, getThemeStyle } from '~/utils/theme';
import {
  readHomeSnapshot,
  writeHomeSnapshot,
} from '~/utils/homeSnapshot';
import { shareAppMessage, shareTimeline } from '~/utils/share';

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
/** 瀑布流滚过该高度（px）后显示回到顶部 */
const BACK_TOP_VISIBLE = 400;
/** 节流同步 scrollTop 给 t-back-top，避免每帧 setData */
const BACK_TOP_SYNC_MS = 80;

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
    /** 导航行搜索几何；展开样式用 searchBoxStyle 拼接，避免 wxml 拼串 */
    navSearchLeft: 12,
    navSearchRight: 160,
    searchBarHeight: 32,
    searchTop: 48,
    searchIconSize: '32rpx',
    searchBoxStyle: '',
    /** 仅固定分类栏高度；导航栏靠 t-navbar placeholder 占位，勿再叠加 */
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
    /** 列表翻页动画：enter-left / enter-right / 空 */
    pageAnim: '',
    /** 跟手位移（px），横滑时内容跟着走 */
    swipeX: 0,
    /** 是否正在跟手拖拽（关 transition） */
    swipeDragging: false,
    /** 横滑时锁住瀑布流纵向滚动，避免双轴抢主线程卡顿 */
    swipeScrollLock: false,
    /** scroll-view 明确高度（px） */
    scrollerHeight: 500,
    /** 仅用于程序化滚回顶部（0 / 0.01 交替，勿跟手写回） */
    scrollerTop: 0,
    /** scroll-into-view 锚点 id，回到顶部兜底 */
    scrollerIntoView: '',
    /** 同步给 t-back-top 判断显隐 */
    listScrollTop: 0,
    backTopVisible: BACK_TOP_VISIBLE,
    /** 分类条横向滚动位置（手动算，留给左侧边距） */
    catScrollLeft: 0,
    /** 滑动露白提示 */
    swipeHintLeft: {
      show: false,
      opacity: 0,
      revealWidth: 0,
      icon: '/static/emoji/swipe-prev.png',
      title: '',
      name: '',
    },
    swipeHintRight: {
      show: false,
      opacity: 0,
      revealWidth: 0,
      icon: '/static/emoji/swipe-next.png',
      title: '',
      name: '',
    },
  },

  _listSeq: 0,
  _listCache: null,
  _confirmResolve: null,
  /** 列表区左右滑切分类 */
  _touchStartX: 0,
  _touchStartY: 0,
  _touchTracking: false,
  _touchLocked: '', // '' | 'h' | 'v' — 锁定手势轴，避免斜滑误切
  _swipeSwitching: false,
  _lastSwipeSetAt: 0,
  _listScrollTop: 0,
  _backTopSyncTimer: null,
  _intoViewClearTimer: null,
  _hintMeta: null,
  /** 下拉刷新进行中，防止 refresher-triggered 回写重复进 onRefresh */
  _freshing: false,

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

  onShareAppMessage() {
    return shareAppMessage();
  },

  onShareTimeline() {
    return shareTimeline();
  },

  /** 拉取云端待弹活动积分 / 抽奖（覆盖「正在用」的用户，不必冷启动） */
  async pullPendingActivityGifts() {
    if (this._pullingActivityGifts || this._closingActivityGift) return;
    this._pullingActivityGifts = true;
    try {
      const [res, lotteryPending] = await Promise.all([
        callFunction('userEntitlement', { action: 'get' }),
        // pending 内会懒开奖，再返回最新队列
        callFunction('userLottery', { action: 'pending' }).catch(() => null),
      ]);
      if (res && res.entitlement) {
        setCachedEntitlement(res.entitlement);
      }
      applyPendingPointGifts(res && res.pendingPointGifts);
      const lotData = (lotteryPending && lotteryPending.data) || {};
      applyPendingLotteryInvites(
        lotData.pendingLotteryInvites || (res && res.pendingLotteryInvites),
        { replace: true },
      );
      // 结果只信 userLottery.pending（已校验参与）；entitlement 不再带结果
      if (Array.isArray(lotData.pendingLotteryResults)) {
        applyPendingLotteryResults(lotData.pendingLotteryResults, {
          replace: true,
        });
      }
      // 有弹窗占用时只合并队列，不抢焦点；抽奖弹窗由 lottery-host 负责
      if (!this.data.activityGiftVisible) this.maybeShowActivityGift();
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
  },

  onActivityGiftVisibleChange(e) {
    if (!(e.detail && e.detail.visible)) {
      this.closeActivityGift();
    }
  },

  onLoad(options) {
    this._listCache = Object.create(null);
    this._listSeq = 0;
    this.setData({ themeStyle: getThemeStyle() });
    this._onThemeChange = () => {
      applyThemeToPage(this);
      this.refreshFilterStyles();
    };
    this._onWelcomeGift = () => this.maybeShowWelcomeGift();
    this._onActivityGift = () => this.maybeShowActivityGift();
    this._onAdminViewChange = () => this.refreshAdmin();
    try {
      const app = getApp();
      if (app && typeof app.captureOaEntry === 'function') {
        app.captureOaEntry(options || {});
        if (typeof app.claimPendingOaBonus === 'function') {
          app.claimPendingOaBonus();
        }
      }
      if (app && app.eventBus) {
        app.eventBus.on('themeChange', this._onThemeChange);
        app.eventBus.on('welcomeGift', this._onWelcomeGift);
        app.eventBus.on('activityGift', this._onActivityGift);
        app.eventBus.on('adminViewChange', this._onAdminViewChange);
      }
    } catch (e) {
      /* ignore */
    }
    this.updateNavHeight();
    this.updateLayout();
    this.updateScrollerHeight();
    this.refreshAdmin();
    // 本地快照先出壳，再拉分类 + 静默刷新列表
    this.hydrateFromSnapshot();
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
    if (this._backTopSyncTimer) {
      clearTimeout(this._backTopSyncTimer);
      this._backTopSyncTimer = null;
    }
    if (this._intoViewClearTimer) {
      clearTimeout(this._intoViewClearTimer);
      this._intoViewClearTimer = null;
    }
    try {
      const app = getApp();
      if (app && app.eventBus) {
        if (this._onThemeChange) app.eventBus.off('themeChange', this._onThemeChange);
        if (this._onWelcomeGift) app.eventBus.off('welcomeGift', this._onWelcomeGift);
        if (this._onActivityGift) app.eventBus.off('activityGift', this._onActivityGift);
        if (this._onAdminViewChange) app.eventBus.off('adminViewChange', this._onAdminViewChange);
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
        this.data.activityGiftVisible
      ) {
        return;
      }
      setTimeout(() => {
        if (this._subscribeGuideDismissedSession || this.data.giftVisible) return;
        if (this.data.activityGiftVisible) return;
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
      this.maybeShowActivityGift();
    }
  },

  onSubscribeGuideLater() {
    this._subscribeGuideDismissedSession = true;
    this.setData({ subscribeGuideVisible: false });
    this.maybeShowActivityGift();
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
      this.maybeShowActivityGift();
    } catch (e) {
      const msg = (e && (e.errMsg || e.message)) || '订阅失败';
      wx.showToast({ title: msg.slice(0, 40), icon: 'none' });
      this.maybeShowActivityGift();
    }
  },

  onResize() {
    this.updateNavHeight();
    this.updateLayout();
    setTimeout(() => this.measureFixedBar(), 50);
    this.updateScrollerHeight();
  },

  /** 自定义导航栏高度（状态栏 + 标题栏）+ 胶囊旁多选 / 左侧搜索几何 */
  updateNavHeight() {
    try {
      const win = getWindowInfoSafe();
      const menu = wx.getMenuButtonBoundingClientRect();
      const gap = menu.top - win.statusBarHeight;
      const navHeight = win.statusBarHeight + gap * 2 + menu.height;
      const menuGap = Math.max(8, Math.round(win.windowWidth - menu.left + 8));
      const rpx = (win.windowWidth || 375) / 750;
      const navSearchLeft = Math.round(24 * rpx);
      // 多选 right=menuGap；再为「多选/取消」文案 + 间距留空，展开用 right 限位更稳
      const selectBtnW = Math.round(88 * rpx);
      const searchSelectGap = Math.round(12 * rpx);
      const navSearchRight = menuGap + selectBtnW + searchSelectGap;
      // 搜索条用 64rpx 完整胶囊圆角；勿锁成胶囊高度，否则 overflow 会裁成扁椭圆
      const searchBarHeight = Math.max(menu.height, Math.round(64 * rpx));
      const searchTop = Math.round(menu.top + (menu.height - searchBarHeight) / 2);
      // 收起/展开共用图标尺寸
      const iconPx = Math.max(16, Math.round(searchBarHeight * 0.44));
      const searchIconSize = `${iconPx}px`;
      this.setData({
        navHeight,
        menuButton: {
          top: menu.top,
          height: menu.height,
          gap: menuGap,
        },
        navSearchLeft,
        navSearchRight,
        searchBarHeight,
        searchTop,
        searchIconSize,
        searchBoxStyle: this.buildSearchBoxStyle({
          searchExpanded: this.data.searchExpanded,
          searchTop,
          searchBarHeight,
          navSearchLeft,
          navSearchRight,
          searchIconSize,
        }),
      });
    } catch (e) {
      const fallback = {
        navHeight: 64,
        menuButton: { top: 48, height: 32, gap: 96 },
        navSearchLeft: 12,
        navSearchRight: 160,
        searchBarHeight: 32,
        searchTop: 48,
        searchIconSize: '16px',
      };
      this.setData({
        ...fallback,
        searchBoxStyle: this.buildSearchBoxStyle({
          searchExpanded: this.data.searchExpanded,
          ...fallback,
        }),
      });
    }
  },

  /** 展开：left+right 限位；收起：固定正方形宽 */
  buildSearchBoxStyle(opts = {}) {
    const searchExpanded =
      opts.searchExpanded != null ? opts.searchExpanded : this.data.searchExpanded;
    const searchTop = opts.searchTop != null ? opts.searchTop : this.data.searchTop;
    const searchBarHeight =
      opts.searchBarHeight != null ? opts.searchBarHeight : this.data.searchBarHeight;
    const navSearchLeft =
      opts.navSearchLeft != null ? opts.navSearchLeft : this.data.navSearchLeft;
    const navSearchRight =
      opts.navSearchRight != null ? opts.navSearchRight : this.data.navSearchRight;
    const searchIconSize = opts.searchIconSize || this.data.searchIconSize;
    const parts = [
      `top:${searchTop}px`,
      `height:${searchBarHeight}px`,
      `left:${navSearchLeft}px`,
      `--td-search-height:${searchBarHeight}px`,
      `--td-search-icon-size:${searchIconSize}`,
    ];
    if (searchExpanded) {
      parts.push(`right:${navSearchRight}px`);
      parts.push('width:auto');
    } else {
      parts.push(`width:${searchBarHeight}px`);
    }
    return parts.join(';');
  },

  /** 给筛选标签写入与卡片一致的分类色 token */
  decorateFilters(list) {
    return (list || []).map((f) => ({
      ...f,
      checkStyle: categoryCheckTagStyle(f.id, f.name),
    }));
  },

  refreshFilterStyles() {
    const filters = this.data.filters || [];
    if (!filters.length) return;
    this.setData({ filters: this.decorateFilters(filters) });
  },

  measureFixedBar() {
    const query = wx.createSelectorQuery();
    query.select('.home__fixed').boundingClientRect();
    query.exec((res) => {
      const rect = res && res[0];
      if (!rect || !rect.height) return;
      // t-navbar（fixed + placeholder）已占位，这里只需给「吸顶搜索+分类」留高
      const fixedOffset = Math.ceil(rect.height) + 8;
      this.setData({ fixedOffset }, () => this.updateScrollerHeight());
    });
  },

  /** 瀑布流 scroll-view 需要明确高度 */
  updateScrollerHeight() {
    try {
      const win = getWindowInfoSafe();
      const w = win.windowWidth || 375;
      const tabBarPx = Math.round((100 / 750) * w);
      const safeBottom =
        win.safeArea && win.screenHeight
          ? Math.max(0, win.screenHeight - win.safeArea.bottom)
          : 0;
      const nav = this.data.navHeight || 64;
      const fixed = this.data.fixedOffset || 80;
      const h =
        (win.windowHeight || 667) - nav - fixed - tabBarPx - safeBottom;
      const scrollerHeight = Math.max(240, Math.floor(h));
      if (scrollerHeight !== this.data.scrollerHeight) {
        this.setData({ scrollerHeight });
      }
    } catch (e) {
      /* ignore */
    }
  },

  refreshAdmin() {
    this.setData({ isAdmin: resolveIsAdmin() });
  },

  updateLayout() {
    const { windowWidth } = getWindowInfoSafe();
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
      appendItems,
    } = payload;
    const columns =
      appendItems && appendItems.length
        ? appendColumns(this.data.columns, appendItems, this.data.columnCount)
        : buildColumns(list, this.data.columnCount);
    // 不在每次列表更新里写 enable，避免误触 refresher-triggered 抖动
    const patch = {
      list,
      columns,
      page,
      hasMore,
      listTotal: Math.max(0, Number(total) || 0),
      loading,
      loadingMore,
    };
    if (Object.prototype.hasOwnProperty.call(payload, 'enable')) {
      patch.enable = payload.enable;
    }
    this.setData(patch);
  },

  clearListCache() {
    this._listCache = Object.create(null);
  },

  /** 二次打开：用本地快照先铺瀑布流，减少白屏 */
  hydrateFromSnapshot() {
    const snap = readHomeSnapshot();
    if (!snap) return;
    const categoryId = snap.categoryId || 'all';
    const keyword = String(snap.keyword || '').trim();
    if (keyword) return;
    const list = snap.list || [];
    if (!list.length) return;
    const cacheKey = listCacheKey(categoryId, keyword);
    this._listCache[cacheKey] = {
      at: snap.at || Date.now(),
      list,
      page: snap.page || 2,
      hasMore: !!snap.hasMore,
      total: snap.total || list.length,
    };
    const patch = {
      categoryId,
      keyword: '',
      listTotal: snap.total || list.length,
      loading: false,
    };
    if (Array.isArray(snap.filters) && snap.filters.length) {
      patch.filters = this.decorateFilters(snap.filters);
    }
    this.setData(patch);
    this.applyListState({
      list,
      page: snap.page || 2,
      hasMore: !!snap.hasMore,
      total: snap.total || list.length,
      loading: false,
    });
  },

  persistHomeSnapshot(listState = {}) {
    if (String(this.data.keyword || '').trim()) return;
    writeHomeSnapshot({
      categoryId: this.data.categoryId,
      keyword: '',
      list: listState.list || this.data.list || [],
      page: listState.page != null ? listState.page : this.data.page,
      hasMore:
        listState.hasMore != null ? listState.hasMore : this.data.hasMore,
      total: listState.total != null ? listState.total : this.data.listTotal,
      filters: (this.data.filters || []).map((f) => ({
        id: f.id,
        name: f.name,
        count: f.count || 0,
      })),
    });
  },

  async loadCategories() {
    try {
      const res = await callFunction('listCategories');
      const raw = (res.data && res.data.filters) || [
        { id: 'all', name: '全部', count: 0 },
      ];
      // 标签只保留名称；数量用 listTotal 单独展示；选中色跟卡片分类标签一致
      const filters = raw
        .filter((f) => f.id === 'all' || (f.count || 0) > 0)
        .map((f) => ({
          id: f.id,
          name: f.name || f.label || '',
          count: f.count || 0,
        }));
      const next = this.decorateFilters(
        filters.length ? filters : [{ id: 'all', name: '全部', count: 0 }],
      );
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
        this.refreshHintMeta();
        setTimeout(() => this.measureFixedBar(), 50);
        this.scrollCategoryIntoView(patch.categoryId || this.data.categoryId);
      });
    } catch (e) {
      console.warn('[categories]', e.message || e);
    }
  },

  openSearch() {
    if (this.data.searchExpanded) return;
    this.setData({
      searchExpanded: true,
      searchBoxStyle: this.buildSearchBoxStyle({ searchExpanded: true }),
    });
    // 等宽度过渡后再聚焦，避免键盘把布局顶乱
    setTimeout(() => {
      this.setData({ searchFocus: true });
    }, 280);
  },

  closeSearch() {
    this.setData({
      searchFocus: false,
      searchExpanded: false,
      searchBoxStyle: this.buildSearchBoxStyle({ searchExpanded: false }),
    });
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
    this.switchCategory(id);
  },

  /**
   * 切换分类。
   * dir: -1 左滑进下一项（内容从右入），1 右滑进上一项（内容从左入），0 无方向动画。
   * options.keepSwipe: 保留当前 swipeX（连续翻页用，避免中途归零跳变）。
   */
  switchCategory(id, dir = 0, options = {}) {
    if (id === undefined || id === null || id === '' || id === this.data.categoryId) {
      return false;
    }
    const filters = this.data.filters || [];
    if (!filters.some((f) => f.id === id)) return false;

    const keepSwipe = !!(options && options.keepSwipe);
    const listTotal = this.filterCount(id);
    const pageAnim = dir < 0 ? 'enter-right' : dir > 0 ? 'enter-left' : '';
    this.clearPackSelection();

    const apply = () => {
      const patch = {
        categoryId: id,
        listTotal,
        pageAnim,
      };
      if (!keepSwipe) {
        patch.swipeX = 0;
        patch.swipeDragging = false;
        Object.assign(patch, this.buildSwipeHintPatch(0));
      }
      this.setData(patch, () => {
        this.resetListScroll();
        this.scrollCategoryIntoView(id);
        setTimeout(() => this.measureFixedBar(), 30);
        if (pageAnim) {
          setTimeout(() => {
            if (this.data.pageAnim === pageAnim) {
              this.setData({ pageAnim: '' });
            }
          }, 360);
        }
      });
      this.loadList(true);
    };

    // 先清动画 class，再挂上，保证同方向连续滑也能重播
    if (pageAnim && this.data.pageAnim) {
      this.setData({ pageAnim: '' }, apply);
    } else {
      apply();
    }
    return true;
  },

  categoryIndex(id) {
    const filters = this.data.filters || [];
    return filters.findIndex((f) => f.id === (id || this.data.categoryId));
  },

  /**
   * 仅当分类被挡住时才滚；滚完后左右各留边距，避免选中项贴死左缘。
   */
  scrollCategoryIntoView(id) {
    const targetId = id || this.data.categoryId;
    if (!targetId) return;
    const { windowWidth } = getWindowInfoSafe();
    // 约 48rpx，比原先 24rpx 更松
    const marginPx = Math.max(16, Math.round(((windowWidth || 375) / 750) * 48));

    const run = () => {
      const q = wx.createSelectorQuery();
      q.select('.home__toolbar').boundingClientRect();
      q.select('.home__toolbar').scrollOffset();
      q.select(`#cat-${targetId}`).boundingClientRect();
      q.exec((res) => {
        const bar = res && res[0];
        const off = res && res[1];
        const cat = res && res[2];
        if (!bar || !off || !cat || !cat.width) return;
        const leftBound = bar.left + marginPx;
        const rightBound = bar.right - marginPx;
        let next = off.scrollLeft;
        if (cat.left < leftBound) {
          next = off.scrollLeft + (cat.left - leftBound);
        } else if (cat.right > rightBound) {
          next = off.scrollLeft + (cat.right - rightBound);
        } else {
          return;
        }
        next = Math.max(0, next);
        // 同值时微调，强制 scroll-view 响应
        if (Math.abs(next - (this.data.catScrollLeft || 0)) < 0.5) {
          next = next < 1 ? next + 0.5 : next - 0.5;
        }
        this.setData({ catScrollLeft: next });
      });
    };

    setTimeout(run, 40);
  },

  /** 缓存相邻分类文案，跟手时只改数字字段 */
  refreshHintMeta() {
    const filters = this.data.filters || [];
    const idx = this.categoryIndex();
    const prev = idx > 0 ? filters[idx - 1] : null;
    const next =
      idx >= 0 && idx < filters.length - 1 ? filters[idx + 1] : null;
    this._hintMeta = {
      prevIcon: prev
        ? '/static/emoji/swipe-prev.png'
        : '/static/emoji/swipe-end.png',
      prevTitle: prev ? '上一站' : '到头啦～',
      prevName: prev ? prev.name : '已经是第一个分类',
      nextIcon: next
        ? '/static/emoji/swipe-next.png'
        : '/static/emoji/swipe-end.png',
      nextTitle: next ? '下一站' : '到头啦～',
      nextName: next ? next.name : '滑回去看看别的吧',
    };
  },

  /** 根据 swipeX 生成露白区提示（上一站 / 下一站 / 到头） */
  buildSwipeHintPatch(swipeX) {
    if (!this._hintMeta) this.refreshHintMeta();
    const meta = this._hintMeta;
    const abs = Math.abs(swipeX || 0);
    const opacity = Math.min(1, abs / 56);
    const revealWidth = Math.round(abs);

    if (swipeX > 8) {
      return {
        swipeHintLeft: {
          show: true,
          opacity,
          revealWidth,
          icon: meta.prevIcon,
          title: meta.prevTitle,
          name: meta.prevName,
        },
        swipeHintRight: {
          show: false,
          opacity: 0,
          revealWidth: 0,
          icon: meta.nextIcon,
          title: '',
          name: '',
        },
      };
    }
    if (swipeX < -8) {
      return {
        swipeHintLeft: {
          show: false,
          opacity: 0,
          revealWidth: 0,
          icon: meta.prevIcon,
          title: '',
          name: '',
        },
        swipeHintRight: {
          show: true,
          opacity,
          revealWidth,
          icon: meta.nextIcon,
          title: meta.nextTitle,
          name: meta.nextName,
        },
      };
    }
    return {
      swipeHintLeft: {
        show: false,
        opacity: 0,
        revealWidth: 0,
        icon: meta.prevIcon,
        title: '',
        name: '',
      },
      swipeHintRight: {
        show: false,
        opacity: 0,
        revealWidth: 0,
        icon: meta.nextIcon,
        title: '',
        name: '',
      },
    };
  },

  /** 跟手帧：锁滚动 + 更新位移/提示 */
  buildSwipeMovePatch(swipeX) {
    return {
      swipeX,
      swipeDragging: true,
      swipeScrollLock: true,
      pageAnim: '',
      ...this.buildSwipeHintPatch(swipeX),
    };
  },

  setSwipeScrollLock(locked) {
    if (!!this.data.swipeScrollLock === !!locked) return;
    this.setData({ swipeScrollLock: !!locked });
  },

  resetSwipePane(animated) {
    const clearHints = this.buildSwipeHintPatch(0);
    if (!this.data.swipeX && !this.data.swipeDragging && !this.data.swipeScrollLock) {
      if (this.data.swipeHintLeft.show || this.data.swipeHintRight.show) {
        this.setData(clearHints);
      }
      return;
    }
    this.setData({
      swipeX: 0,
      swipeDragging: !animated,
      swipeScrollLock: false,
      ...clearHints,
    });
    if (animated) {
      setTimeout(() => {
        if (!this.data.swipeX) this.setData({ swipeDragging: false });
      }, 280);
    }
  },

  /** 跟手位移：边界带阻尼 */
  calcSwipeX(dx) {
    const { windowWidth } = getWindowInfoSafe();
    const w = windowWidth || 375;
    const filters = this.data.filters || [];
    const idx = this.categoryIndex();
    const atStart = idx <= 0;
    const atEnd = idx < 0 || idx >= filters.length - 1;
    if ((atStart && dx > 0) || (atEnd && dx < 0)) {
      return Math.round(dx * 0.22);
    }
    const max = w * 0.55;
    return Math.round(Math.max(-max, Math.min(max, dx)));
  },

  /** 按偏移切换相邻分类；dx<0 下一分类，dx>0 上一分类。连续甩出→对侧滑入，避免跳变 */
  switchCategoryBySwipe(dx) {
    if (this._swipeSwitching) return false;
    const filters = this.data.filters || [];
    if (filters.length < 2) return false;
    const idx = this.categoryIndex();
    if (idx < 0) return false;
    const nextIdx = dx < 0 ? idx + 1 : idx - 1;
    if (nextIdx < 0 || nextIdx >= filters.length) return false;

    const { windowWidth } = getWindowInfoSafe();
    const w = windowWidth || 375;
    const outX = dx < 0 ? -w : w;
    const inFrom = dx < 0 ? w : -w;
    const nextId = filters[nextIdx].id;

    this._swipeSwitching = true;
    // 1) 当前页继续滑出屏幕（期间保持锁滚动）
    this.setData({
      swipeX: outX,
      swipeDragging: false,
      swipeScrollLock: true,
      pageAnim: '',
      ...this.buildSwipeHintPatch(outX),
    });

    setTimeout(() => {
      // 2) 瞬移到对侧（无 transition），换分类数据
      this.setData(
        {
          swipeX: inFrom,
          swipeDragging: true,
          swipeScrollLock: true,
          pageAnim: '',
          ...this.buildSwipeHintPatch(0),
        },
        () => {
          this.switchCategory(nextId, 0, { keepSwipe: true });
          this.refreshHintMeta();
          // 3) 等无 transition 的帧落地后，再滑入（过短会吃掉位移）
          setTimeout(() => {
            this.setData({
              swipeX: 0,
              swipeDragging: false,
              swipeScrollLock: false,
            });
            setTimeout(() => {
              this._swipeSwitching = false;
            }, 360);
          }, 48);
        },
      );
    }, 260);
    return true;
  },

  onBodyTouchStart(e) {
    if (this._swipeSwitching) return;
    const t = e.changedTouches && e.changedTouches[0];
    if (!t) return;
    this._touchStartX = t.clientX;
    this._touchStartY = t.clientY;
    this._touchTracking = true;
    this._touchLocked = '';
    this._lastSwipeSetAt = 0;
    this.refreshHintMeta();
  },

  onBodyTouchMove(e) {
    if (!this._touchTracking || this._swipeSwitching) return;
    const t = e.touches && e.touches[0];
    if (!t) return;
    const dx = t.clientX - this._touchStartX;
    const dy = t.clientY - this._touchStartY;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);

    if (!this._touchLocked) {
      // 走出死区后再锁轴：横滑切分类，竖滑交给列表
      if (absX < 12 && absY < 12) return;
      const atTop = (this._listScrollTop || 0) <= 2;
      // 顶部下拉优先交给 refresher，避免斜滑误锁横轴关掉 refresher-enabled
      if (atTop && dy > 0 && absY >= absX * 0.85) {
        this._touchLocked = 'v';
        return;
      }
      this._touchLocked = absX > absY * 1.15 ? 'h' : 'v';
      if (this._touchLocked === 'h') {
        // 立刻关掉 scroll-y，避免横滑时瀑布流还在滚
        this.setSwipeScrollLock(true);
      }
      if (this._touchLocked === 'v') return;
    }

    if (this._touchLocked !== 'h') return;

    const swipeX = this.calcSwipeX(dx);
    const now = Date.now();
    // 约 30fps 节流：跟手够用，且少打 setData
    if (now - this._lastSwipeSetAt < 32 && Math.abs(swipeX - this.data.swipeX) < 4) {
      return;
    }
    this._lastSwipeSetAt = now;
    this.setData(this.buildSwipeMovePatch(swipeX));
  },

  onBodyTouchEnd(e) {
    if (!this._touchTracking) return;
    const locked = this._touchLocked;
    this._touchTracking = false;
    this._touchLocked = '';

    const t = e.changedTouches && e.changedTouches[0];
    if (!t) {
      this.resetSwipePane(true);
      return;
    }
    const dx = t.clientX - this._touchStartX;
    const dy = t.clientY - this._touchStartY;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);

    // 竖滑或未形成横滑：回弹（若有跟手位移）
    if (locked === 'v' || (locked !== 'h' && absX <= absY * 1.2)) {
      this.resetSwipePane(true);
      return;
    }

    const { windowWidth } = getWindowInfoSafe();
    const threshold = Math.max(56, Math.round((windowWidth || 375) * 0.18));
    if (absX < threshold || absX < absY * 1.2) {
      this.resetSwipePane(true);
      return;
    }

    if (!this.switchCategoryBySwipe(dx)) {
      this.resetSwipePane(true);
    }
  },

  onListScroll(e) {
    const top = e && e.detail && e.detail.scrollTop;
    if (typeof top !== 'number') return;
    this._listScrollTop = top;
    if (this._backTopSyncTimer) return;
    this._backTopSyncTimer = setTimeout(() => {
      this._backTopSyncTimer = null;
      const next = this._listScrollTop || 0;
      if (next === this.data.listScrollTop) return;
      this.setData({ listScrollTop: next });
    }, BACK_TOP_SYNC_MS);
  },

  onBackToTop() {
    this.scrollListToTop();
  },

  /** 列表滚回顶部；scroll-top 同值不生效，故 0/0.01 交替 + into-view 兜底 */
  scrollListToTop() {
    if (this._backTopSyncTimer) {
      clearTimeout(this._backTopSyncTimer);
      this._backTopSyncTimer = null;
    }
    if (this._intoViewClearTimer) {
      clearTimeout(this._intoViewClearTimer);
      this._intoViewClearTimer = null;
    }
    this._listScrollTop = 0;
    const scrollerTop = this.data.scrollerTop === 0 ? 0.01 : 0;
    this.setData({
      scrollerTop,
      listScrollTop: 0,
      scrollerIntoView: '',
    }, () => {
      this.setData({ scrollerIntoView: 'homeScrollerTop' });
      this._intoViewClearTimer = setTimeout(() => {
        this._intoViewClearTimer = null;
        if (this.data.scrollerIntoView === 'homeScrollerTop') {
          this.setData({ scrollerIntoView: '' });
        }
      }, 400);
    });
  },

  /** 列表重置时滚回顶部（分类切换等） */
  resetListScroll() {
    this.scrollListToTop();
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
      // 缺比例时用默认值先展示；封面 load 后由 pack-card 派发 ratiochange 纠正
      out.push({ ...item, coverRatio: 1 });
    }
    return out;
  },

  /**
   * 封面实测比例回写：只改对应项，不重排列，避免组件重挂导致封面空白。
   */
  onCoverRatioChange(e) {
    const detail = (e && e.detail) || {};
    const packId = detail.packId;
    const ratio = Number(detail.coverRatio) || 0;
    if (!packId || !(ratio > 0.2 && ratio < 4)) return;

    const patchItem = (item) =>
      item && item._id === packId ? { ...item, coverRatio: ratio } : item;

    const list = (this.data.list || []).map(patchItem);
    const columns = (this.data.columns || []).map((col) =>
      (col || []).map(patchItem),
    );
    this.setData({ list, columns });

    const cacheKey = listCacheKey(this.data.categoryId, this.data.keyword);
    if (this._listCache && this._listCache[cacheKey] && this._listCache[cacheKey].list) {
      this._listCache[cacheKey].list = this._listCache[cacheKey].list.map(patchItem);
    }
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
      if (reset && !keyword) {
        this.persistHomeSnapshot({
          list: nextList,
          page: nextPage,
          hasMore,
          total: nextTotal,
        });
      }
    } catch (e) {
      if (seq !== this._listSeq) return;
      this.setData({ loading: false, loadingMore: false, enable: false });
      const msg = (e && (e.errMsg || e.message)) || '加载失败';
      if (!/INVALID_ENV|Environment not found|-501000/i.test(msg)) {
        wx.showToast({ title: msg.slice(0, 40), icon: 'none' });
      }
    }
  },

  onRefresherRestore() {
    this._freshing = false;
  },

  onRefresherAbort() {
    this._freshing = false;
    if (this.data.enable) {
      this.setData({ enable: false });
    }
  },

  onRefresh() {
    if (this._freshing) return;
    if (this.data.swipeScrollLock) {
      this._freshing = false;
      if (this.data.enable) this.setData({ enable: false });
      return;
    }
    this._freshing = true;
    if (!this.data.enable) {
      this.setData({ enable: true });
    }
    this.clearPackSelection();
    this.clearListCache();
    this.loadCategories();
    Promise.resolve(this.loadList(true, { force: true })).finally(() => {
      this._freshing = false;
      this.setData({ enable: false });
    });
  },

  /** scroll-view 触底加载；页级 onReachBottom 在自定义滚动里往往不触发 */
  onScrollToLower() {
    if (this.data.swipeScrollLock) return;
    this.loadList(false);
  },

  onReachBottom() {
    this.loadList(false);
  },

  onEditPack(e) {
    if (!resolveIsAdmin()) return;
    const { packId } = e.detail || {};
    if (!packId) return;
    wx.navigateTo({ url: `/pages/admin/upload/index?id=${packId}` });
  },

  onDeletePack(e) {
    if (!resolveIsAdmin()) return;
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
    if (!resolveIsAdmin()) {
      this.setData({ deleteDialogVisible: false, deletePackId: '', deleteTitle: '' });
      return;
    }
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
