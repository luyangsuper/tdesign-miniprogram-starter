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

const TOOLS = [
  {
    id: 'bead',
    title: '拼豆图纸',
    desc: '图片转色号图纸与像素图，MARD 221 色，支持高清导出',
    tag: 'NEW',
    icon: 'paintbrush',
    color: '#07c160',
    bg: 'rgba(7,193,96,0.12)',
    url: '/pages/tools/bead/index',
  },
];

const FEATURES = [
  {
    title: '智能取色',
    desc: '按感知色差匹配拼豆色号，可去背景、合并杂色',
    icon: 'palette',
    color: '#059669',
    bg: 'rgba(16,185,129,0.14)',
  },
  {
    title: '色号 + 像素双图',
    desc: '色号图方便对照拼豆，像素图用来预览成品效果',
    icon: 'image',
    color: '#2563EB',
    bg: 'rgba(59,130,246,0.14)',
  },
  {
    title: '高清多格式导出',
    desc: '支持 2 倍 / 4 倍清晰度，PNG 进相册，也可导出 SVG',
    icon: 'download',
    color: '#D97706',
    bg: 'rgba(245,158,11,0.14)',
  },
];

const STEPS = [
  { n: '1', title: '选一张图' },
  { n: '2', title: '调格数生成' },
  { n: '3', title: '导出图纸' },
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
    tools: TOOLS,
    features: FEATURES,
    steps: STEPS,
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

  onLoad() {
    this.updateNavHeight();
    this.syncThemeUi();
    this.refreshNativeAd();
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
      '/pages/tools/bead/index';
    wx.navigateTo({ url });
  },

  goBead() {
    wx.navigateTo({ url: '/pages/tools/bead/index' });
  },
});
