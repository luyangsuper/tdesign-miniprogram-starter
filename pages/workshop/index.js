import { callFunction } from '~/utils/cloud';
import { getCustomNavMetrics } from '~/utils/systemInfo';
import {
  applyThemeToPage,
  getThemeBrand,
  getThemeStyle,
  isDarkMode,
} from '~/utils/theme';
import {
  getActiveFestival,
  getFestivalAssets,
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

const BEAD_CELLS_DARK = [
  '#1f4a3a', '#245543', '#2a6150', '#326c59', '#3a7863', '#43846d',
  '#1a3f32', '#204a3b', '#275544', '#2e604d', '#366c56', '#3e7860',
  '#16362c', '#1c4035', '#234a3e', '#2a5547', '#326050', '#3a6c5a',
];

const PUZZLE_CELLS = [
  '#9bb6cc', '#8aa7c0', '#7a99b4',
  '#a8bfcf', '#97b0c3', '#879faf',
  '#b6c9d6', '#a5b8c8', 'rgba(148,163,184,0.22)',
];

const PUZZLE_CELLS_DARK = [
  '#3a5670', '#334e66', '#2d465c',
  '#425e76', '#3b5670', '#354e66',
  '#4a687e', '#435f74', 'rgba(148,163,184,0.18)',
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
    themeChevron: 'rgba(15,23,42,0.28)',
    nativeAdUnitId: '',
    showNativeAd: false,
  },

  refreshNativeAd() {
    const unitId = getNativeWorkshopAdUnitId();
    const showNativeAd = !!unitId && shouldShowNativeAds();
    if (
      this.data.nativeAdUnitId === unitId &&
      this.data.showNativeAd === showNativeAd
    ) {
      return;
    }
    this.setData({
      nativeAdUnitId: unitId,
      showNativeAd,
    });
  },

  onNativeAdError() {
    this.setData({ showNativeAd: false });
  },

  async refreshTools({ force } = {}) {
    const now = Date.now();
    if (
      !force &&
      this._toolsAt &&
      now - this._toolsAt < 5 * 60 * 1000 &&
      (this.data.tools || []).length
    ) {
      return;
    }
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
    this._toolsAt = now;
    this.setData({ tools });
  },

  onLoad() {
    this.updateNavHeight();
    this.syncThemeUi();
    this.refreshNativeAd();
    this.refreshTools();
    this._onFestivalChange = () => {
      this.updateNavHeight();
      this.refreshFestivalDecor();
    };
    this._onThemeChange = () => this.syncThemeUi();
    this._onEntitlementChange = () => this.refreshNativeAd();
    this.refreshFestivalDecor();
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
    this.refreshFestivalDecor();
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      const bar = this.getTabBar();
      if (typeof bar.setSelected === 'function') bar.setSelected('workshop');
      else bar.setData({ value: 'workshop' });
    }
    if (this._workshopShowDeferTimer) clearTimeout(this._workshopShowDeferTimer);
    this._workshopShowDeferTimer = setTimeout(() => {
      this._workshopShowDeferTimer = null;
      this.refreshNativeAd();
      // 切 Tab 不强制打云；缓存过期才刷新入口
      this.refreshTools();
    }, 32);
  },

  onHide() {
    if (this._workshopShowDeferTimer) {
      clearTimeout(this._workshopShowDeferTimer);
      this._workshopShowDeferTimer = null;
    }
  },

  syncThemeUi() {
    applyThemeToPage(this);
    const dark = isDarkMode();
    this.setData({
      themeStyle: getThemeStyle(),
      themeBrand: getThemeBrand(),
      themeChevron: dark ? 'rgba(255,255,255,0.36)' : 'rgba(15,23,42,0.28)',
      beadCells: dark ? BEAD_CELLS_DARK : BEAD_CELLS,
      puzzleCells: dark ? PUZZLE_CELLS_DARK : PUZZLE_CELLS,
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
    const festivalId = fest ? fest.id : '';
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
    if (
      this.data.festivalId === festivalId &&
      this.data.festivalClass === festivalClass &&
      this.data.festivalStyle === festivalStyle &&
      this.data.festHeaderPx === festHeaderPx
    ) {
      return;
    }
    this.setData({
      festivalId,
      festivalClass,
      festivalStyle,
      festHeaderPx,
    });
  },

  goTool(e) {
    const url =
      (e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.url) ||
      '';
    if (!url) return;
    wx.navigateTo({ url });
  },
});
