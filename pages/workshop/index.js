import { callFunction } from '~/utils/cloud';
import { getCustomNavMetrics } from '~/utils/systemInfo';
import {
  applyThemeToPage,
  getThemeBrand,
  getThemeStyle,
} from '~/utils/theme';
import {
  getActiveFestival,
  getFestivalAssets,
  loadFestivalConfig,
} from '~/utils/festival';
import {
  getNativeWorkshopAdUnitId,
  shouldShowNativeAds,
} from '~/utils/nativeAd';

const BASE_TOOLS = [
  {
    id: 'bead',
    title: '拼豆图纸',
    desc: '图片转色号图纸，照着拼',
    tag: '热门',
    tagTheme: 'success',
    icon: 'paintbrush',
    color: '#07c160',
    bg: 'rgba(7,193,96,0.12)',
    url: '/pages/tools/bead/index',
  },
  {
    id: 'puzzle',
    title: '趣味拼图',
    desc: '拼图闯关，好玩又能赚积分',
    tag: 'NEW',
    tagTheme: 'primary',
    icon: 'sparkles',
    color: '#3b6d9a',
    bg: 'rgba(59,109,154,0.12)',
    url: '/pages/puzzle/index/index',
  },
  {
    id: 'answerbook',
    title: '答案之书',
    desc: '默念问题，翻开书页看看',
    tag: '',
    tagTheme: 'success',
    icon: 'bookmark',
    color: '#8a7355',
    bg: 'rgba(138,115,85,0.12)',
    url: '/pages/tools/answerbook/index',
  },
];

/** 统一低饱和预览色，避免花哨 */
const BEAD_CELLS = [
  '#d7ebe0', '#c5dfd2', '#b7d6c8', '#a8cbbd', '#9bc0b2', '#8eb5a7',
  '#e4efe8', '#d0e4da', '#bdd8cb', '#abcbbd', '#9ac0b1', '#89b4a5',
  '#eff5f1', '#ddece4', '#cbe2d7', '#bad8cb', '#a9cdb0', '#98c2b4',
];

const PUZZLE_CELLS = [
  '#9bb6cc', '#8aa7c0', '#7a99b4',
  '#a8bfcf', '#97b0c3', '#879faf',
  '#b6c9d6', '#a5b8c8', 'rgba(148,163,184,0.22)',
];

Page({
  data: {
    themeStyle: '',
    themeBrand: '#07c160',
    navHeight: 64,
    navBarStyle: '',
    festivalActive: true,
    festivalId: '',
    festivalClass: '',
    festivalStyle: '',
    festHeaderPx: 88,
    tools: BASE_TOOLS,
    beadCells: BEAD_CELLS,
    puzzleCells: PUZZLE_CELLS,
    nativeAdUnitId: '',
    showNativeAd: false,
  },

  refreshNativeAd() {
    const unitId = getNativeWorkshopAdUnitId();
    this.setData({
      nativeAdUnitId: unitId,
      showNativeAd: !!unitId && shouldShowNativeAds(),
    });
  },

  onNativeAdError() {
    this.setData({ showNativeAd: false });
  },

  async refreshTools() {
    let puzzleOn = true;
    try {
      const puzzleRes = await callFunction('puzzleGame', { action: 'status' }).catch(
        () => null,
      );
      // 仅在云端明确关闭时隐藏；未部署/失败时仍展示入口
      puzzleOn =
        !(puzzleRes && puzzleRes.data) || puzzleRes.data.enabled !== false;
    } catch (e) {
      puzzleOn = true;
    }
    const tools = BASE_TOOLS.filter((item) => item.id !== 'puzzle' || puzzleOn);
    this.setData({ tools });
  },

  onLoad() {
    this.updateNavHeight();
    this.syncThemeUi();
    this.refreshNativeAd();
    this.refreshTools();
    this._onFestivalChange = () => this.updateNavHeight();
    this._onThemeChange = () => this.syncThemeUi();
    this._onEntitlementChange = () => this.refreshNativeAd();
    try {
      const app = getApp();
      if (app && app.eventBus) {
        app.eventBus.on('festivalChange', this._onFestivalChange);
        app.eventBus.on('themeChange', this._onThemeChange);
        app.eventBus.on('entitlementChange', this._onEntitlementChange);
      }
    } catch (e) {
      /* ignore */
    }
  },

  onUnload() {
    try {
      const app = getApp();
      if (app && app.eventBus) {
        if (this._onFestivalChange) app.eventBus.off('festivalChange', this._onFestivalChange);
        if (this._onThemeChange) app.eventBus.off('themeChange', this._onThemeChange);
        if (this._onEntitlementChange) {
          app.eventBus.off('entitlementChange', this._onEntitlementChange);
        }
      }
    } catch (e) {
      /* ignore */
    }
  },

  onShow() {
    this.refreshNativeAd();
    this.refreshTools();
    if (!this.data.festivalActive) {
      this.setData({ festivalActive: true });
    }
    this.refreshFestivalDecor();
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      const bar = this.getTabBar();
      if (typeof bar.setSelected === 'function') bar.setSelected('workshop');
      else bar.setData({ value: 'workshop' });
      if (typeof bar.syncFestival === 'function') bar.syncFestival();
    }
    loadFestivalConfig({ silent: true }).then(() => {
      this.refreshFestivalDecor();
      if (typeof this.getTabBar === 'function' && this.getTabBar()) {
        const bar = this.getTabBar();
        if (bar && typeof bar.syncFestival === 'function') bar.syncFestival();
      }
    });
  },

  onHide() {
    this.setData({ festivalActive: false });
  },

  syncThemeUi() {
    applyThemeToPage(this);
    this.setData({
      themeStyle: getThemeStyle(),
      themeBrand: getThemeBrand(),
    });
  },

  updateNavHeight() {
    try {
      const m = getCustomNavMetrics();
      this.setData(
        {
          navHeight: m.navHeight,
          navBarStyle: m.navBarStyle,
        },
        () => this.refreshFestivalDecor(),
      );
    } catch (e) {
      this.setData(
        {
          navHeight: 64,
          navBarStyle: '--td-navbar-padding-top:20px;--td-navbar-height:44px',
        },
        () => this.refreshFestivalDecor(),
      );
    }
  },

  refreshFestivalDecor() {
    const fest = getActiveFestival();
    const nav = Number(this.data.navHeight) || 64;
    const assets = fest ? getFestivalAssets(fest.id) : {};
    const hasBanner = !!(assets && assets.banner);
    const festHeaderPx = Math.max(48, Math.round(nav));
    const festivalStyle = fest
      ? [
          `--fest-accent:${fest.accent || 'var(--td-brand-color)'}`,
          hasBanner ? `--fest-nav-color:${fest.navColor || '#ffffff'}` : '',
        ]
          .filter(Boolean)
          .join(';')
      : '';
    const festivalClass = fest
      ? [hasBanner ? 'workshop-page--fest' : '', `workshop-page--fest-${fest.id}`]
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

  goTool(e) {
    const url =
      (e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.url) ||
      '';
    if (!url) return;
    wx.navigateTo({ url });
  },
});
