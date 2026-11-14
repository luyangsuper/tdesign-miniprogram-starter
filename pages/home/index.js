import { callFunction, getTempFileURLs } from '~/utils/cloud';
import {
  forgetTempUrl,
  packCoverCacheKey,
  peekTempUrl,
  rememberTempUrl,
  reuseTempUrl,
} from '~/utils/tempUrlCache';
import {
  formatBatchResultTip,
  runBatchDownload,
} from '~/utils/batchDownload';
import { getOpenId, resolveIsAdmin } from '~/utils/auth';
import {
  CATEGORY_FILTER_ALL,
} from '~/utils/categories';
import {
  CONTENT_TYPE_ALL,
  contentTypeChipStyle,
  contentTypeColorStyle,
  contentTypeFilterLabel,
  contentTypeFilterOptions,
  contentTypeIconSrc,
  contentTypeLabel,
  formatItemCount,
  isEmojiType,
  normalizeContentType,
} from '~/utils/contentType';
import {
  getCachedEntitlement,
  setCachedEntitlement,
  spendablePoints,
} from '~/utils/entitlement';
import { promptSaveAdForPoints } from '~/utils/adReward';
import {
  applyHomeFeedAdEveryFromSettings,
  getNativeHomeFeedAdUnitId,
  resolveHomeFeedAdEvery,
  shouldShowHomeFeedAds,
} from '~/utils/nativeAd';
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
import {
  applyDownloadCostsFromSettings,
  downloadCost,
  downloadCostForPack,
} from '~/utils/pricing';
import { getCustomNavMetrics, getWindowInfoSafe } from '~/utils/systemInfo';
import {
  requestNewPackSubscribe,
  shouldShowNewPackGuide,
} from '~/utils/subscribe';
import {
  applyThemeToPage,
  applyThemeToTabBar,
  getThemeBrand,
  getThemeStyle,
  resolveCategorySwatch,
} from '~/utils/theme';
import {
  clearHomeSnapshot,
  readHomeSnapshot,
  writeHomeSnapshot,
} from '~/utils/homeSnapshot';
import {
  getHomePref,
  reorderFiltersByPref,
  resolveHomePrefCategoryId,
} from '~/utils/homePref';
import { shareAppMessage, shareTimeline } from '~/utils/share';
import {
  getActiveFestival,
  getFestivalAssets,
  loadFestivalConfig,
  notifyFestivalAccessChange,
} from '~/utils/festival';
import { resolveWaterfallColumns } from '~/utils/waterfallColumns';

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

/**
 * 瀑布流：竖版广告卡插入列内（与合集卡同宽），不再通栏切开。
 * every 由 resolveHomeFeedAdEvery(列数) 换算；不插广告时整表一块 grid。
 * 最后不足一组不插，避免总贴在「没有更多了」上面。
 */
function buildFeedBlocks(list, columnCount, every, showAds) {
  const items = list || [];
  const insertAds = !!showAds && Number(every) > 0;
  if (!insertAds) {
    return [
      {
        key: 'g-all',
        type: 'grid',
        columns: buildColumns(items, columnCount),
      },
    ];
  }
  const n = Math.max(1, Number(every) || 6);
  const mixed = [];
  let adSeq = 0;
  for (let i = 0; i < items.length; i += 1) {
    mixed.push(items[i]);
    // 每满 every 条插一张；不贴在列表末尾，避免紧挨「没有更多了」
    if ((i + 1) % n === 0 && i + 1 < items.length) {
      mixed.push({
        _id: `feed-ad-${adSeq}`,
        key: `ad-${adSeq}`,
        isAd: true,
        hidden: false,
        // 竖版卡占位，接近合集封面比例，避免列高估算偏差过大
        coverRatio: 1.2,
      });
      adSeq += 1;
    }
  }
  return [
    {
      key: 'g-all',
      type: 'grid',
      columns: buildColumns(mixed, columnCount),
    },
  ];
}

/** 列表元数据内存缓存；封面链另用 tempUrlCache，过期则静默换签 */
const LIST_CACHE_TTL = 10 * 60 * 1000;
/** 瀑布流滚过该高度（px）后显示回到顶部 */
const BACK_TOP_VISIBLE = 400;
/** 节流同步 scrollTop 给 t-back-top，避免每帧 setData */
const BACK_TOP_SYNC_MS = 80;

function listCacheKey(categoryId, keyword, contentType) {
  return `${categoryId || 'all'}::${contentType || 'all'}::${String(keyword || '').trim()}`;
}
Page({
  data: {
    enable: false,
    loading: true,
    list: [],
    columns: [[], []],
    /** 瀑布流分段：grid 合集块 + ad 通栏广告 */
    feedBlocks: [],
    nativeAdUnitId: getNativeHomeFeedAdUnitId(),
    showFeedAds: shouldShowHomeFeedAds(),
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
    contentType: CONTENT_TYPE_ALL,
    contentTypeName: contentTypeFilterLabel(CONTENT_TYPE_ALL),
    contentTypeIconSrc: contentTypeIconSrc(CONTENT_TYPE_ALL),
    contentTypeChipStyle: contentTypeChipStyle(CONTENT_TYPE_ALL),
    contentTypeFilters: contentTypeFilterOptions(),
    contentTypeSheetVisible: false,
    filters: [{ id: 'all', name: '全部', count: 0 }],
    /** filters 对应的 contentType；与当前类型不一致时角标不信 count，避免闪旧数字 */
    filtersContentType: CONTENT_TYPE_ALL,
    /** 当前筛选下的合集数，展示在分类下方，不写进标签 */
    listTotal: 0,
    isAdmin: false,
    deleteDialogVisible: false,
    deletePackId: '',
    deleteTitle: '',
    navHeight: 64,
    navBarStyle: '',
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
    searchIconSize: '40rpx',
    searchBoxStyle: '',
    /** 仅固定分类栏高度；导航栏靠 t-navbar placeholder 占位，勿再叠加 */
    fixedOffset: 48,
    subscribeGuideVisible: false,
    themeStyle: '',
    themeBrand: '',
    festivalActive: true,
    festivalId: '',
    festivalClass: '',
    festivalStyle: '',
    festHeaderPx: 88,
    selectMode: false,
    selectedMap: {},
    selectedCount: 0,
    approxCount: 0,
    approxCost: 0,
    batchVariant: 'static',
    /** 批量已锁定的合集类型；空表示尚未选中 */
    batchContentType: '',
    batchTypeName: '',
    batchContentTypeIconSrc: contentTypeIconSrc(CONTENT_TYPE_ALL),
    batchContentTypeColorStyle: contentTypeColorStyle(CONTENT_TYPE_ALL),
    batchShowVariant: true,
    batchUnitLabel: '张',
    batchMetaText: '已选 0 个合集',
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
    activityGiftTip: '感谢参与趣图铺子活动',
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
  _catSeq: 0,
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
    this.updateLayout();
    /* 先恢复 active（仅解暂停），避免先卸图再加载造成闪烁 */
    if (!this.data.festivalActive) {
      this.setData({ festivalActive: true });
    }
    this.refreshFestivalDecor();
    this.refreshFeedAdGate();
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      const bar = this.getTabBar();
      if (typeof bar.setSelected === 'function') bar.setSelected('home');
      else bar.setData({ value: 'home' });
      if (typeof bar.syncTheme === 'function') bar.syncTheme();
      /* 各 tab 页自带一份 custom-tab-bar，必须在首页也 sync */
      if (typeof bar.syncFestival === 'function') bar.syncFestival();
    }
    /* 配置未变时 loadFestivalConfig 不广播；变了才再刷 */
    loadFestivalConfig({ silent: true }).then(() => {
      this.refreshFestivalDecor();
      if (typeof this.getTabBar === 'function' && this.getTabBar()) {
        const bar = this.getTabBar();
        if (bar && typeof bar.syncFestival === 'function') bar.syncFestival();
      }
    });
    this.refreshAdmin();
    this.maybeShowWelcomeGift();
    this.maybeShowActivityGift();
    this.pullPendingActivityGifts();
    this.startActivityGiftPoll();
    this.maybeShowSubscribeGuide();
    try {
      const app = getApp();
      if (this._pendingHomePrefApply) {
        this._pendingHomePrefApply = false;
        if (app.globalData) app.globalData.homeNeedRefresh = false;
        this.applyHomePrefOnBoot({ forceReload: true });
        return;
      }
      if (app.globalData && app.globalData.homeNeedRefresh) {
        app.globalData.homeNeedRefresh = false;
        this.clearListCache();
        clearHomeSnapshot();
        this.loadCategories();
        this.loadList(true, { force: true, forceRefresh: true });
      }
    } catch (e) {
      /* ignore */
    }
  },

  onHide() {
    this.setData({ festivalActive: false });
    this.stopActivityGiftPoll();
  },

  refreshFestivalDecor() {
    const fest = getActiveFestival();
    const nav = Number(this.data.navHeight) || 64;
    /* 顶栏图盖满导航（含状态栏）；上传 4:1，展示跟导航同高 */
    const festHeaderPx = Math.max(48, Math.round(nav));
    const assets = fest ? getFestivalAssets(fest.id) : {};
    /* 无顶栏图时不要透明导航+白字，否则浅底上看不清 */
    const hasBanner = !!(assets && assets.banner);
    const festivalStyle = fest
      ? [
          `--fest-accent:${fest.accent || 'var(--td-brand-color)'}`,
          hasBanner
            ? `--fest-nav-color:${fest.navColor || '#ffffff'}`
            : '',
        ]
          .filter(Boolean)
          .join(';')
      : '';
    const festivalClass = fest
      ? [hasBanner ? 'home--fest' : '', `home--fest-${fest.id}`]
          .filter(Boolean)
          .join(' ')
      : '';
    this.setData({
      festivalId: fest ? fest.id : '',
      festivalClass,
      festivalStyle,
      festHeaderPx,
    });
    const decor = this.selectComponent('#festivalDecor');
    if (decor && typeof decor.refresh === 'function') decor.refresh();
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
        notifyFestivalAccessChange();
        this.refreshFestivalDecor();
      }
      if (res && res.homeFeedAdEvery != null) {
        applyHomeFeedAdEveryFromSettings(res);
      }
      applyDownloadCostsFromSettings(res || {});
      // 权益（VIP）或间隔变化后重建分段，避免留下空广告位/段界空白
      this.refreshFeedAdGate();
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
    this._catSeq = 0;
    this.setData({ themeStyle: getThemeStyle(), themeBrand: getThemeBrand() });
    this._onThemeChange = () => {
      applyThemeToPage(this);
      this.refreshFilterStyles();
    };
    this._onWelcomeGift = () => this.maybeShowWelcomeGift();
    this._onActivityGift = () => this.maybeShowActivityGift();
    this._onAdminViewChange = () => this.refreshAdmin();
    this._onFestivalChange = () => {
      this.refreshFestivalDecor();
      if (typeof this.getTabBar === 'function' && this.getTabBar()) {
        const bar = this.getTabBar();
        if (bar && typeof bar.syncFestival === 'function') bar.syncFestival();
      }
    };
    this._onWaterfallColumnsChange = () => this.updateLayout();
    this._onHomePrefChange = () => {
      this._pendingHomePrefApply = true;
    };
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
        app.eventBus.on('festivalChange', this._onFestivalChange);
        app.eventBus.on('waterfallColumnsChange', this._onWaterfallColumnsChange);
        app.eventBus.on('homePrefChange', this._onHomePrefChange);
      }
    } catch (e) {
      /* ignore */
    }
    this.updateNavHeight();
    this.updateLayout();
    this.updateScrollerHeight();
    this.refreshAdmin();
    // 有保存偏好则先套默认筛选，再出快照壳 / 拉列表
    this.applyHomePrefOnBoot();
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
        if (this._onFestivalChange) app.eventBus.off('festivalChange', this._onFestivalChange);
        if (this._onWaterfallColumnsChange) {
          app.eventBus.off('waterfallColumnsChange', this._onWaterfallColumnsChange);
        }
        if (this._onHomePrefChange) {
          app.eventBus.off('homePrefChange', this._onHomePrefChange);
        }
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

  /** 自定义导航栏高度（状态栏 + 标题栏）+ 左侧搜索几何 */
  updateNavHeight() {
    try {
      const win = getWindowInfoSafe();
      const menu = wx.getMenuButtonBoundingClientRect();
      const nav = getCustomNavMetrics();
      const navHeight = nav.navHeight;
      const menuGap = Math.max(8, Math.round(win.windowWidth - menu.left + 8));
      const rpx = (win.windowWidth || 375) / 750;
      const navSearchLeft = Math.round(24 * rpx);
      // 多选已挪到分类栏；展开搜索只需避开微信胶囊
      const searchCapsuleGap = Math.round(12 * rpx);
      const navSearchRight = menuGap + searchCapsuleGap;
      // 搜索条用 64rpx 完整胶囊圆角；勿锁成胶囊高度，否则 overflow 会裁成扁椭圆
      const searchBarHeight = Math.max(menu.height, Math.round(64 * rpx));
      const searchTop = Math.round(menu.top + (menu.height - searchBarHeight) / 2);
      // 收起/展开共用图标尺寸：贴近胶囊高度，避免发虚也别留太多内边距
      const iconPx = Math.max(24, Math.round(searchBarHeight * 0.72));
      const searchIconSize = `${iconPx}px`;
      this.setData(
        {
          navHeight,
          navBarStyle: nav.navBarStyle,
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
        },
        () => this.refreshFestivalDecor(),
      );
    } catch (e) {
      const fallback = {
        navHeight: 64,
        navBarStyle: '--td-navbar-padding-top:20px;--td-navbar-height:44px',
        menuButton: { top: 48, height: 32, gap: 96 },
        navSearchLeft: 12,
        navSearchRight: 100,
        searchBarHeight: 32,
        searchTop: 48,
        searchIconSize: '24px',
      };
      this.setData(
        {
          ...fallback,
          searchBoxStyle: this.buildSearchBoxStyle({
            searchExpanded: this.data.searchExpanded,
            ...fallback,
          }),
        },
        () => this.refreshFestivalDecor(),
      );
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

  /** 主题 Tab：写入 accent，供文字色 / 底横条使用 */
  decorateFilters(list) {
    return (list || []).map((f) => {
      const swatch = resolveCategorySwatch(f.id, f.name);
      return {
        ...f,
        accentColor: swatch.color,
        tabStyle: `--home-cat-accent:${swatch.color}`,
      };
    });
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
      this.setData({ fixedOffset }, () => {
        this.updateScrollerHeight();
        this.refreshFestivalDecor();
      });
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
    // 管理员视图 / 预览普通用户切换时同步信息流广告
    this.refreshFeedAdGate();
  },

  updateLayout() {
    const { windowWidth } = getWindowInfoSafe();
    const columnCount = resolveWaterfallColumns(windowWidth);

    // 页边距与卡片间距同一数值，只扣一次，避免「页边 + 缝」看起来叠宽
    const gap = 6;
    const rowGap = 6;
    const cardWidth = Math.floor(
      (windowWidth - gap * 2 - gap * (columnCount - 1)) / columnCount,
    );

    const patch = {
      columnCount,
      cardWidth,
      listGap: gap,
      rowGap,
      nativeAdUnitId: getNativeHomeFeedAdUnitId(),
      showFeedAds: shouldShowHomeFeedAds(),
    };
    if (this.data.list && this.data.list.length) {
      patch.columns = buildColumns(this.data.list, columnCount);
      patch.feedBlocks = buildFeedBlocks(
        this.data.list,
        columnCount,
        resolveHomeFeedAdEvery(columnCount),
        patch.showFeedAds && !this.data.selectMode,
      );
    }
    this.setData(patch);
  },

  refreshFeedAdGate() {
    const show = shouldShowHomeFeedAds();
    const unitId = getNativeHomeFeedAdUnitId();
    const patch = {
      showFeedAds: show,
      nativeAdUnitId: unitId,
    };
    if (this.data.list && this.data.list.length) {
      patch.feedBlocks = buildFeedBlocks(
        this.data.list,
        this.data.columnCount,
        resolveHomeFeedAdEvery(this.data.columnCount),
        show && !this.data.selectMode,
      );
    }
    this.setData(patch);
  },

  onFeedAdError(e) {
    const key = e && e.currentTarget && e.currentTarget.dataset
      ? e.currentTarget.dataset.key
      : '';
    if (!key) return;
    const feedBlocks = (this.data.feedBlocks || []).map((b) => {
      if (!b || b.type !== 'grid') {
        return b && b.key === key ? { ...b, hidden: true } : b;
      }
      return {
        ...b,
        columns: (b.columns || []).map((col) =>
          (col || []).map((item) =>
            item && (item.key === key || item._id === key)
              ? { ...item, hidden: true }
              : item,
          ),
        ),
      };
    });
    this.setData({ feedBlocks });
  },

  filterCount(categoryId) {
    const id = categoryId || this.data.categoryId;
    const ct = this.data.contentType || CONTENT_TYPE_ALL;
    const ft = this.data.filtersContentType;
    // 分类统计尚未对齐当前类型时，不要用旧 count 当角标
    if (ft != null && ft !== ct) return 0;
    const hit = (this.data.filters || []).find((f) => f.id === id);
    return hit ? Number(hit.count) || 0 : 0;
  },

  /** 列表 total 校准分类角标；当前分类为 0 时仍保留选中项，其它 0 分类去掉 */
  syncFilterCount(categoryId, total) {
    const id = categoryId || this.data.categoryId || 'all';
    const n = Math.max(0, Number(total) || 0);
    const filters = this.data.filters || [];
    if (!filters.length) return;
    let changed = false;
    const next = filters
      .map((f) => {
        if (f.id !== id) return f;
        if ((Number(f.count) || 0) === n) return f;
        changed = true;
        return { ...f, count: n };
      })
      .filter(
        (f) => f.id === 'all' || f.id === id || (Number(f.count) || 0) > 0,
      );
    if (next.length !== filters.length) changed = true;
    if (!changed) return;
    this.setData({ filters: this.decorateFilters(next) });
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
    // 避免 coverFileID / coverUrl 为 null 触发组件属性类型警告
    const normalizePack = (item) => {
      if (!item || typeof item !== 'object') return item;
      return {
        ...item,
        coverFileID: item.coverFileID || '',
        coverUrl: item.coverUrl || '',
      };
    };
    const safeList = (list || []).map(normalizePack);
    const safeAppend = (appendItems || []).map(normalizePack);
    const columns =
      safeAppend.length
        ? appendColumns(this.data.columns, safeAppend, this.data.columnCount)
        : buildColumns(safeList, this.data.columnCount);
    const showAds = shouldShowHomeFeedAds() && !this.data.selectMode;
    const feedBlocks = buildFeedBlocks(
      safeList,
      this.data.columnCount,
      resolveHomeFeedAdEvery(this.data.columnCount),
      showAds,
    );
    // 不在每次列表更新里写 enable，避免误触 refresher-triggered 抖动
    const patch = {
      list: safeList,
      columns,
      feedBlocks,
      showFeedAds: shouldShowHomeFeedAds(),
      nativeAdUnitId: getNativeHomeFeedAdUnitId(),
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
    clearHomeSnapshot();
  },

  /**
   * 冷启动 / 偏好变更：套用已保存的默认筛选。
   * 同步写入 this.data，保证紧随其后的 hydrate / loadList 读到新筛选。
   * @param {{ forceReload?: boolean }} [options]
   */
  applyHomePrefOnBoot(options = {}) {
    const pref = getHomePref();
    // 无偏好：冷启动保持默认；清除偏好后 forceReload 时复位到全部
    if (!pref.saved) {
      this._preferredCategoryIds = [];
      if (!options.forceReload) return;
      const contentType = CONTENT_TYPE_ALL;
      const categoryId = CATEGORY_FILTER_ALL;
      this._catSeq = (this._catSeq || 0) + 1;
      const patch = {
        contentType,
        contentTypeName: contentTypeFilterLabel(contentType),
        contentTypeIconSrc: contentTypeIconSrc(contentType),
        contentTypeChipStyle: contentTypeChipStyle(contentType),
        categoryId,
        listTotal: 0,
        filtersContentType: contentType,
        filters: this.decorateFilters([{ id: 'all', name: '全部', count: 0 }]),
      };
      Object.assign(this.data, patch);
      this.setData(patch, () => {
        this.clearListCache();
        clearHomeSnapshot();
        this.resetListScroll();
        this.loadCategories();
        this.loadList(true, { force: true, forceRefresh: true });
        setTimeout(() => this.measureFixedBar(), 30);
      });
      return;
    }
    const contentType =
      pref.contentType === CONTENT_TYPE_ALL
        ? CONTENT_TYPE_ALL
        : normalizeContentType(pref.contentType);
    const categoryId = resolveHomePrefCategoryId(pref);
    this._preferredCategoryIds = Array.isArray(pref.categoryIds)
      ? pref.categoryIds.slice()
      : [];
    this._catSeq = (this._catSeq || 0) + 1;
    const patch = {
      contentType,
      contentTypeName: contentTypeFilterLabel(contentType),
      contentTypeIconSrc: contentTypeIconSrc(contentType),
      contentTypeChipStyle: contentTypeChipStyle(contentType),
      categoryId,
      listTotal: 0,
      filtersContentType: contentType,
      filters: this.decorateFilters([{ id: 'all', name: '全部', count: 0 }]),
    };
    // 同步写入，保证紧随其后的 hydrate / loadList 读到新筛选
    Object.assign(this.data, patch);
    this.setData(patch, () => {
      if (options.forceReload) {
        this.clearListCache();
        clearHomeSnapshot();
        this.resetListScroll();
        this.loadCategories();
        this.loadList(true, { force: true, forceRefresh: true });
        setTimeout(() => this.measureFixedBar(), 30);
      }
    });
  },

  /** 二次打开：用本地快照先铺瀑布流，减少白屏 */
  hydrateFromSnapshot() {
    const snap = readHomeSnapshot();
    if (!snap) return;
    const keyword = String(snap.keyword || '').trim();
    if (keyword) return;
    const list = snap.list || [];
    if (!list.length) return;

    const pref = getHomePref();
    let categoryId = snap.categoryId || 'all';
    let contentType = snap.contentType || CONTENT_TYPE_ALL;

    if (pref.saved) {
      // 有偏好时只接受与偏好一致的壳，避免闪出未偏好筛选
      categoryId = this.data.categoryId || categoryId;
      contentType = this.data.contentType || contentType;
      if (
        (snap.categoryId || 'all') !== categoryId ||
        (snap.contentType || CONTENT_TYPE_ALL) !== contentType
      ) {
        return;
      }
    }

    const cacheKey = listCacheKey(categoryId, keyword, contentType);
    // at=0：快照只铺壳，随后 loadList 必走静默刷新换新签，避免过期封面裂图
    this._listCache[cacheKey] = {
      at: 0,
      list,
      page: snap.page || 2,
      hasMore: !!snap.hasMore,
      total: snap.total || list.length,
    };
    const patch = {
      categoryId,
      contentType,
      contentTypeName: contentTypeFilterLabel(contentType),
      contentTypeIconSrc: contentTypeIconSrc(contentType),
      contentTypeChipStyle: contentTypeChipStyle(contentType),
      keyword: '',
      listTotal: snap.total || list.length,
      loading: false,
    };
    if (Array.isArray(snap.filters) && snap.filters.length) {
      const prefIds =
        this._preferredCategoryIds ||
        (pref.saved && pref.categoryIds) ||
        [];
      patch.filters = this.decorateFilters(
        reorderFiltersByPref(snap.filters, prefIds),
      );
      patch.filtersContentType = contentType;
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
      contentType: this.data.contentType || CONTENT_TYPE_ALL,
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
    const contentType = this.data.contentType || CONTENT_TYPE_ALL;
    const seq = (this._catSeq = (this._catSeq || 0) + 1);
    try {
      const res = await callFunction('listCategories', { contentType });
      if (seq !== this._catSeq) return;
      if ((this.data.contentType || CONTENT_TYPE_ALL) !== contentType) return;
      const resType = res.data && res.data.contentType;
      // 新云函数会回传 contentType；对不上说明串了类型，丢弃
      if (resType != null && resType !== contentType) return;

      const raw = (res.data && res.data.filters) || [
        { id: 'all', name: '全部', count: 0 },
      ];
      // 标签只保留名称；选中角标用 listTotal（与当前类型一致的统计）
      const filters = raw
        .filter((f) => f.id === 'all' || (f.count || 0) > 0)
        .map((f) => ({
          id: f.id,
          name: f.name || f.label || '',
          count: f.count || 0,
        }));
      const pref = getHomePref();
      const prefIds =
        this._preferredCategoryIds ||
        (pref.saved && Array.isArray(pref.categoryIds) ? pref.categoryIds : []) ||
        [];
      const ordered = reorderFiltersByPref(
        filters.length ? filters : [{ id: 'all', name: '全部', count: 0 }],
        prefIds,
      );
      const next = this.decorateFilters(ordered);
      const patch = { filters: next, filtersContentType: contentType };
      if (!next.some((f) => f.id === this.data.categoryId)) {
        patch.categoryId = 'all';
      }
      // 无搜索词时，用「当前类型」下的分类统计刷新角标，避免闪旧数字
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
      if (seq !== this._catSeq) return;
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

  openContentTypeSheet() {
    this.setData({ contentTypeSheetVisible: true });
  },

  closeContentTypeSheet() {
    if (!this.data.contentTypeSheetVisible) return;
    this.setData({ contentTypeSheetVisible: false });
  },

  onContentTypeSheetVisibleChange(e) {
    const visible = !!(e.detail && e.detail.visible);
    if (!visible && this.data.contentTypeSheetVisible) {
      this.setData({ contentTypeSheetVisible: false });
    }
  },

  onContentTypeSheetPick(e) {
    const id =
      (e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id) ||
      '';
    this.setData({ contentTypeSheetVisible: false });
    this.applyContentType(id);
  },

  applyContentType(id) {
    if (id === undefined || id === null || id === '') return;
    const next =
      id === CONTENT_TYPE_ALL ? CONTENT_TYPE_ALL : normalizeContentType(id);
    if (next === this.data.contentType) return;
    this.clearPackSelection();
    // 作废进行中的旧分类请求，避免切类型后旧 filters/count 写回
    this._catSeq = (this._catSeq || 0) + 1;
    this.setData(
      {
        contentType: next,
        contentTypeName: contentTypeFilterLabel(next),
        contentTypeIconSrc: contentTypeIconSrc(next),
        contentTypeChipStyle: contentTypeChipStyle(next),
        // 立刻丢掉上一类型的分类条，避免还能点到「表情里的蜡笔小新」并闪出旧数字
        categoryId: 'all',
        listTotal: 0,
        filtersContentType: next,
        filters: this.decorateFilters([{ id: 'all', name: '全部', count: 0 }]),
      },
      () => {
        this.resetListScroll();
        this.loadCategories();
        this.loadList(true);
        setTimeout(() => this.measureFixedBar(), 30);
      },
    );
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
    // 角标用当前类型下的分类统计；列表返回后再用 total 校准
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
      q.select('#homeToolbar').boundingClientRect();
      q.select('#homeToolbar').scrollOffset();
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
    const hasSelected =
      this.data.selectedCount || Object.keys(this.data.selectedMap || {}).length;
    if (!hasSelected && !this.data.batchContentType) return;
    this.setData({
      selectedMap: {},
      selectedCount: 0,
      approxCount: 0,
      approxCost: 0,
      batchContentType: '',
      batchTypeName: '',
      batchShowVariant: this.data.selectMode ? false : this.data.batchShowVariant,
      batchUnitLabel: '张',
      batchMetaText: this.data.selectMode
        ? '请选择同一类型的合集'
        : '已选 0 个合集',
      batchVariant: 'static',
    });
  },

  resolveSelectedContentType(selectedMap) {
    const map = selectedMap || {};
    let locked = '';
    (this.data.list || []).some((item) => {
      if (!item || !map[item._id]) return false;
      locked = normalizeContentType(item.contentType);
      return true;
    });
    return locked;
  },

  computeBatchMeta(selectedMap, variant, lockedType) {
    const map = selectedMap || {};
    const type = lockedType || this.resolveSelectedContentType(map);
    const emojiOnly = !type || isEmojiType(type);
    const v = emojiOnly && variant === 'anim' ? 'anim' : 'static';
    let selectedCount = 0;
    let approxCount = 0;
    let approxCost = 0;
    (this.data.list || []).forEach((item) => {
      if (!item || !map[item._id]) return;
      selectedCount += 1;
      const itemType = normalizeContentType(item.contentType);
      if (type && itemType !== type) return;
      const n = Math.max(0, Number(item.emojiCount) || 0);
      approxCount += n;
      approxCost += n * downloadCostForPack(itemType, v);
    });
    const typeName = type ? contentTypeLabel(type) : '';
    const unitLabel =
      type === 'video' || type === 'avatar' ? '个' : '张';
    const countText = type
      ? formatItemCount(approxCount, type)
      : `约 ${approxCount} 张`;
    const metaParts = [`已选 ${selectedCount} 个合集`];
    if (typeName) metaParts.push(typeName);
    if (approxCount) metaParts.push(countText);
    if (approxCost) metaParts.push(`${approxCost} 积分`);
    return {
      selectedCount,
      approxCount,
      approxCost,
      batchContentType: type || '',
      batchTypeName: typeName,
      batchContentTypeIconSrc: type
        ? contentTypeIconSrc(type)
        : contentTypeIconSrc(CONTENT_TYPE_ALL),
      batchContentTypeColorStyle: type
        ? contentTypeColorStyle(type)
        : contentTypeColorStyle(CONTENT_TYPE_ALL),
      batchShowVariant: emojiOnly && !!type,
      batchUnitLabel: unitLabel,
      batchVariant: v,
      batchMetaText: metaParts.join(' · '),
    };
  },

  onToggleSelectMode() {
    if (this.data.batchSaving) return;
    if (this.data.selectMode) {
      const showAds = shouldShowHomeFeedAds();
      this.setData({
        selectMode: false,
        selectedMap: {},
        selectedCount: 0,
        approxCount: 0,
        approxCost: 0,
        batchContentType: '',
        batchTypeName: '',
        batchShowVariant: true,
        batchUnitLabel: '张',
        batchMetaText: '已选 0 个合集',
        batchVariant: 'static',
        showFeedAds: showAds,
        feedBlocks: buildFeedBlocks(
          this.data.list,
          this.data.columnCount,
          resolveHomeFeedAdEvery(this.data.columnCount),
          showAds,
        ),
      });
      return;
    }
    // 多选时先藏广告，避免误触、也少占勾选空间
    this.setData({
      selectMode: true,
      selectedMap: {},
      selectedCount: 0,
      approxCount: 0,
      approxCost: 0,
      batchContentType: '',
      batchTypeName: '',
      batchShowVariant: false,
      batchMetaText: '请选择同一类型的合集',
      batchVariant: 'static',
      feedBlocks: buildFeedBlocks(
        this.data.list,
        this.data.columnCount,
        resolveHomeFeedAdEvery(this.data.columnCount),
        false,
      ),
    });
  },

  onTogglePack(e) {
    if (!this.data.selectMode || this.data.batchSaving) return;
    const packId = e.detail && e.detail.packId;
    if (!packId) return;
    const pack = (this.data.list || []).find((p) => p && p._id === packId);
    if (!pack) return;
    const packType = normalizeContentType(pack.contentType);
    const selectedMap = { ...(this.data.selectedMap || {}) };
    if (selectedMap[packId]) {
      delete selectedMap[packId];
    } else {
      const locked = this.data.batchContentType;
      if (locked && locked !== packType) {
        wx.showToast({
          title: `只能选同类型：已选「${contentTypeLabel(locked)}」`,
          icon: 'none',
        });
        return;
      }
      selectedMap[packId] = true;
    }
    const meta = this.computeBatchMeta(selectedMap, this.data.batchVariant);
    this.setData({
      selectedMap,
      ...meta,
    });
  },

  onBatchVariantTap(e) {
    if (!this.data.batchShowVariant) return;
    const value =
      (e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.value) ||
      '';
    const batchVariant = value === 'anim' ? 'anim' : 'static';
    if (batchVariant === this.data.batchVariant) return;
    this.setData({
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

  /** 积分不足：优先救急广告，否则去「我的」 */
  async offerAdOrRedeem(opts = {}) {
    const res = await promptSaveAdForPoints({
      page: this,
      maxRounds: 2,
      ...opts,
    });
    if (res.action === 'go_my') this.goRedeem();
    return !!res.ok;
  },

  async buildBatchJobs(packIds, variant, lockedType) {
    const jobs = [];
    let skippedPacks = 0;
    let mixedType = false;
    const expected = lockedType ? normalizeContentType(lockedType) : '';
    for (let i = 0; i < packIds.length; i += 1) {
      const packId = packIds[i];
      // eslint-disable-next-line no-await-in-loop
      const res = await callFunction('getPackDetail', { packId });
      const data = (res && res.data) || {};
      const contentType = normalizeContentType(data.contentType);
      if (expected && contentType !== expected) {
        mixedType = true;
        skippedPacks += 1;
        continue;
      }
      const slots = Array.isArray(data.slots) ? data.slots : [];
      let indexes;
      if (variant === 'anim' && contentType === 'emoji') {
        indexes = slots.filter((s) => s && s.hasAnim).map((s) => Number(s.index));
        if (!indexes.length) {
          skippedPacks += 1;
          continue;
        }
      } else if (variant === 'anim' && contentType !== 'emoji') {
        // 非表情合集无动态；批量选「动态」时跳过
        skippedPacks += 1;
        continue;
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
      jobs.push({ packId, indexes, contentType });
    }
    return { jobs, skippedPacks, mixedType };
  },

  async onBatchDownload() {
    if (this.data.batchSaving) return;
    const selectedMap = this.data.selectedMap || {};
    const packIds = Object.keys(selectedMap).filter((id) => selectedMap[id]);
    if (!packIds.length) {
      wx.showToast({ title: '请先选择合集', icon: 'none' });
      return;
    }

    const lockedType =
      this.data.batchContentType || this.resolveSelectedContentType(selectedMap);
    // 列表侧再校一遍：禁止不同类型混下
    const mixedInList = (this.data.list || []).some((item) => {
      if (!item || !selectedMap[item._id]) return false;
      return normalizeContentType(item.contentType) !== normalizeContentType(lockedType);
    });
    if (!lockedType || mixedInList) {
      wx.showToast({ title: '请只选择同一类型的合集', icon: 'none' });
      return;
    }

    const variant =
      isEmojiType(lockedType) && this.data.batchVariant === 'anim'
        ? 'anim'
        : 'static';
    // 预检：用勾选合集均价估一把，避免明显不够还进流程
    const preMeta = this.computeBatchMeta(selectedMap, variant, lockedType);
    const minUnit =
      preMeta.approxCount > 0
        ? Math.max(1, Math.floor(preMeta.approxCost / preMeta.approxCount))
        : downloadCostForPack(lockedType, variant);
    if (spendablePoints(getCachedEntitlement()) < minUnit) {
      const ready = await this.offerAdOrRedeem({
        need: minUnit,
        count: 1,
        unitCost: minUnit,
        actionLabel: '保存原文件',
      });
      if (!ready || spendablePoints(getCachedEntitlement()) < minUnit) return;
    }

    this.setData({ batchSaving: true });
    wx.showLoading({ title: '准备中...', mask: true });

    let jobs = [];
    let skippedPacks = 0;
    try {
      const built = await this.buildBatchJobs(packIds, variant, lockedType);
      jobs = built.jobs;
      skippedPacks = built.skippedPacks;
      if (built.mixedType) {
        wx.hideLoading();
        this.setData({ batchSaving: false });
        wx.showToast({ title: '请只选择同一类型的合集', icon: 'none' });
        return;
      }
    } catch (err) {
      wx.hideLoading();
      this.setData({ batchSaving: false });
      wx.showToast({ title: (err && err.message) || '加载合集失败', icon: 'none' });
      return;
    }

    const totalCount = jobs.reduce((sum, j) => sum + (j.indexes || []).length, 0);
    const totalCost = jobs.reduce((sum, j) => {
      const n = (j.indexes || []).length;
      return sum + n * downloadCostForPack(j.contentType, variant);
    }, 0);
    const avgUnit =
      totalCount > 0 ? Math.max(1, Math.round(totalCost / totalCount)) : downloadCost(variant);
    wx.hideLoading();

    if (!totalCount) {
      this.setData({ batchSaving: false });
      wx.showToast({
        title: variant === 'anim' ? '所选合集暂无动态原图' : '所选合集没有可下载原图',
        icon: 'none',
      });
      return;
    }

    let spendable = spendablePoints(getCachedEntitlement());
    let canAll = spendable >= totalCost;
    let maxCount = avgUnit > 0 ? Math.floor(spendable / avgUnit) : 0;

    if (!canAll) {
      this.setData({ batchSaving: false });
      const ready = await this.offerAdOrRedeem({
        need: totalCost,
        count: totalCount,
        unitCost: avgUnit,
        actionLabel: `保存 ${totalCount} 项`,
      });
      if (!ready) return;
      spendable = spendablePoints(getCachedEntitlement());
      canAll = spendable >= totalCost;
      maxCount = avgUnit > 0 ? Math.floor(spendable / avgUnit) : 0;
      if (!canAll) {
        await this.confirmAsync(
          `当前 ${spendable} 积分，约够保存 ${maxCount} / ${totalCount} 项（预计共 ${totalCost} 积分）。请减少合集后再下载，或继续看广告补积分。`,
          { title: '积分不太够哦', icon: CONFIRM_ICONS.warn, okText: '去重选' },
        );
        return;
      }
      this.setData({ batchSaving: true });
    }

    const typeName = contentTypeLabel(lockedType);
    const kindLabel =
      variant === 'anim'
        ? '动态 GIF'
        : lockedType === 'video'
          ? '原视频'
          : lockedType === 'avatar'
            ? '头像原图'
            : lockedType === 'wallpaper'
              ? '壁纸原图'
              : '静态原图';
    const kindIcon = variant === 'anim' ? CONFIRM_ICONS.anim : CONFIRM_ICONS.static;
    let confirmText = `将保存 ${jobs.length} 个「${typeName}」合集共 ${totalCount} 项「${kindLabel}」，预计消耗 ${totalCost} 积分（先扣本月额度，再扣积分）。确认后按条扣费并写入相册。`;
    if (skippedPacks) {
      confirmText += `（另有 ${skippedPacks} 个合集无可用原文件将跳过）`;
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
      await this.offerAdOrRedeem({
        need: downloadCost(variant),
        count: 1,
        unitCost: downloadCost(variant),
        actionLabel: '继续保存',
      });
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
    const showAds = shouldShowHomeFeedAds() && !this.data.selectMode;
    const feedBlocks = buildFeedBlocks(
      list,
      this.data.columnCount,
      resolveHomeFeedAdEvery(this.data.columnCount),
      showAds,
    );
    this.setData({ list, columns, feedBlocks });

    const cacheKey = listCacheKey(
      this.data.categoryId,
      this.data.keyword,
      this.data.contentType,
    );
    if (this._listCache && this._listCache[cacheKey] && this._listCache[cacheKey].list) {
      this._listCache[cacheKey].list = this._listCache[cacheKey].list.map(patchItem);
    }
  },

  /** 单条封面换成新签并刷新瀑布流对应项 */
  patchPackCover(packId, coverUrl, coverFileID) {
    const id = String(packId || '').trim();
    const url = String(coverUrl || '').trim();
    if (!id || !url) return;
    const patchItem = (item) => {
      if (!item || item._id !== id) return item;
      return {
        ...item,
        coverUrl: url,
        coverFileID: coverFileID || item.coverFileID || '',
        slides: [url],
      };
    };
    const list = (this.data.list || []).map(patchItem);
    const columns = (this.data.columns || []).map((col) =>
      (col || []).map(patchItem),
    );
    const showAds = shouldShowHomeFeedAds() && !this.data.selectMode;
    const feedBlocks = buildFeedBlocks(
      list,
      this.data.columnCount,
      resolveHomeFeedAdEvery(this.data.columnCount),
      showAds,
    );
    this.setData({ list, columns, feedBlocks });
    const cacheKey = listCacheKey(
      this.data.categoryId,
      this.data.keyword,
      this.data.contentType,
    );
    if (this._listCache && this._listCache[cacheKey] && this._listCache[cacheKey].list) {
      this._listCache[cacheKey].list = this._listCache[cacheKey].list.map(patchItem);
    }
  },

  /**
   * 封面临时链失效：按 coverFileID 换新签即可。
   * 切勿整表 loadList(true)：翻页后瀑布流连环 cover error 会把列表打回第一页。
   */
  async onCoverError(e) {
    const detail = (e && e.detail) || {};
    const packId = String(detail.packId || '').trim();
    if (!packId) return;
    const item =
      (this.data.list || []).find((row) => row && row._id === packId) || null;
    const coverFileID = String(
      (item && item.coverFileID) || detail.coverFileID || '',
    ).trim();

    if (packId) forgetTempUrl(packCoverCacheKey(packId));
    if (coverFileID) forgetTempUrl(coverFileID);
    if (!coverFileID) return;

    if (!this._coverResignIds) this._coverResignIds = new Set();
    if (this._coverResignIds.has(packId)) return;
    this._coverResignIds.add(packId);
    try {
      const urls = await getTempFileURLs([coverFileID]);
      const next = String((urls && urls[0]) || '').trim();
      if (next && next !== (item && item.coverUrl)) {
        rememberTempUrl(packCoverCacheKey(packId), next);
        this.patchPackCover(packId, next, coverFileID);
      }
    } catch (err) {
      /* 单张失败保留占位，等用户下拉刷新再整表换签 */
    } finally {
      this._coverResignIds.delete(packId);
    }
  },

  async loadList(reset = false, options = {}) {
    const force = !!(options && options.force);
    let forceRefresh = !!(options && options.forceRefresh);
    if (!this._listCache) this._listCache = Object.create(null);

    const categoryId = this.data.categoryId;
    const contentType = this.data.contentType || CONTENT_TYPE_ALL;
    const keyword = String(this.data.keyword || '').trim();
    const cacheKey = listCacheKey(categoryId, keyword, contentType);

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
        const cacheFresh = cached.at > 0 && Date.now() - cached.at < LIST_CACHE_TTL;
        const coversOk =
          cacheFresh &&
          (cached.list || []).every((item) => {
            if (!item || !item._id || !item.coverUrl) return true;
            return !!peekTempUrl(packCoverCacheKey(item._id));
          });
        // 列表与封面链都仍有效才跳过请求；否则静默换签
        if (coversOk) {
          return;
        }
        // 本地链不可用：必须让服务端跳过旧签缓存
        forceRefresh = true;
        // 过期 / 封面链失效：静默后台刷新，不闪整页 loading
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

    if (force) forceRefresh = true;

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
        contentType,
        // 无搜索：最新为主并插花热门/旧合集；有搜索：纯最新
        mode: keyword ? 'newest' : 'mixed',
        forceRefresh,
      });
      if (seq !== this._listSeq) return;

      const {
        list = [],
        hasMore = false,
        total = 0,
      } = res.data || {};
      const withStableCover = (list || []).map((item) => {
        if (!item || !item._id) return item;
        if (!item.coverUrl) {
          return { ...item, coverFileID: item.coverFileID || '', coverUrl: '' };
        }
        // 强制换签时不要复用客户端旧链（可能 CDN 已拒但 TTL 未到）
        const coverUrl = forceRefresh
          ? rememberTempUrl(packCoverCacheKey(item._id), item.coverUrl)
          : reuseTempUrl(packCoverCacheKey(item._id), item.coverUrl);
        return {
          ...item,
          coverFileID: item.coverFileID || '',
          coverUrl,
        };
      });
      const withRatio = await this.resolveCoverRatios(withStableCover, seq);
      if (!withRatio || seq !== this._listSeq) return;

      // 混排翻页可能把上一页热门又插进来：追加时按 _id 去重
      let incoming = withRatio;
      if (!reset) {
        const seen = new Set(
          (this.data.list || []).map((row) => row && row._id).filter(Boolean),
        );
        incoming = (withRatio || []).filter(
          (row) => row && row._id && !seen.has(row._id),
        );
      }
      const nextList = reset ? withRatio : this.data.list.concat(incoming);
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
        appendItems: reset ? null : incoming,
      });
      // 用列表真实 total 校准分类 count，避免角标残留其它类型的数字
      if (reset && !keyword) {
        this.syncFilterCount(categoryId, nextTotal);
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
    Promise.resolve(this.loadList(true, { force: true, forceRefresh: true })).finally(() => {
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
      this.loadList(true, { force: true, forceRefresh: true });
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: err.message || '删除失败', icon: 'none' });
    } finally {
      this.setData({ deletePackId: '', deleteTitle: '' });
    }
  },
});
