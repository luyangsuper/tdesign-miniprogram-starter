/**
 * 图片工具页共用：主题 / 导航 / 节日装饰 / 返回 / 原生广告
 */
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

export function createShellMethods() {
  return {
    /**
     * 已有结果时改参数：保留上一版预览，标脏提示重新处理（对齐拼豆）
     * @param {object} [extra] 一并写入的字段（质量、尺寸等）
     */
    markParamsDirty(extra = {}) {
      const hasOut = !!(
        this.data.outPath ||
        (this.data.pieces && this.data.pieces.length)
      );
      const patch = { exportUnlocked: false, ...extra };
      if (hasOut) patch.paramsDirty = true;
      this.setData(patch);
    },

    clearParamsDirty() {
      if (!this.data.paramsDirty) return;
      this.setData({ paramsDirty: false });
    },

    /** 保存前：参数已改但未重跑时二次确认 */
    confirmSaveIfDirty() {
      if (!this.data.paramsDirty) return Promise.resolve(true);
      return new Promise((resolve) => {
        wx.showModal({
          title: '参数尚未重新处理',
          content: '参数已改，但还没重新处理。现在保存的仍是上一版结果。',
          confirmText: '仍要保存',
          cancelText: '先去处理',
          success: (res) => resolve(!!res.confirm),
        });
      });
    },

    onBack() {
      // t-navbar 触发 go-back 后还会自行 navigateBack(delta=1)。
      // 这里再退一层会连退两级（工具页 → 工具箱 → 工坊），故栈内有上一页时只交给 navbar。
      const pages = getCurrentPages();
      if (pages.length > 1) return;
      const route =
        (pages[0] && (pages[0].route || (pages[0].$page && pages[0].$page.fullPath))) ||
        '';
      const onToolPage =
        typeof route === 'string' &&
        route.indexOf('pages/tools/image/') === 0 &&
        route !== 'pages/tools/image/index';
      if (onToolPage) {
        wx.redirectTo({
          url: '/pages/tools/image/index',
          fail: () => wx.switchTab({ url: '/pages/workshop/index' }),
        });
        return;
      }
      wx.switchTab({ url: '/pages/workshop/index' });
    },

    syncThemeUi() {
      applyThemeToPage(this);
      this.setData({
        themeStyle: getThemeStyle(),
        themeBrand: getThemeBrand(),
        themeChevron: isDarkMode() ? 'rgba(255,255,255,0.36)' : 'rgba(15,23,42,0.28)',
      });
    },

    updateNavHeight() {
      try {
        const m = getCustomNavMetrics();
        this.setData(
          {
            navHeight: m.navHeight,
            navBarStyle: m.navBarStyle,
            statusBarHeight: m.statusBarHeight,
            navBarHeight: m.navBarHeight,
          },
          () => this.refreshFestivalDecor && this.refreshFestivalDecor(),
        );
      } catch (e) {
        this.setData(
          {
            navHeight: 64,
            navBarStyle: '--td-navbar-padding-top:20px;--td-navbar-height:44px',
            statusBarHeight: 20,
            navBarHeight: 44,
          },
          () => this.refreshFestivalDecor && this.refreshFestivalDecor(),
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
        ? [
            hasBanner ? 'imgtool-page--fest' : '',
            `imgtool-page--fest-${fest.id}`,
          ]
            .filter(Boolean)
            .join(' ')
        : '';
      this.setData({
        festivalActive: true,
        festivalId,
        festivalClass,
        festivalStyle,
        festHeaderPx,
      });
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

    bindShellEvents() {
      this._onFestivalChange = () => {
        this.updateNavHeight();
        this.refreshFestivalDecor();
      };
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

    unbindShellEvents() {
      try {
        const app = getApp();
        if (app && app.eventBus) {
          if (this._onFestivalChange) {
            app.eventBus.off('festivalChange', this._onFestivalChange);
          }
          if (this._onThemeChange) {
            app.eventBus.off('themeChange', this._onThemeChange);
          }
          if (this._onEntitlementChange) {
            app.eventBus.off('entitlementChange', this._onEntitlementChange);
          }
        }
      } catch (e) {
        /* ignore */
      }
    },

    initShell() {
      this.updateNavHeight();
      this.syncThemeUi();
      this.refreshFestivalDecor();
      this.refreshNativeAd();
      this.bindShellEvents();
    },
  };
}

export const SHELL_DATA = {
  themeStyle: '',
  themeBrand: '#07c160',
  themeChevron: 'rgba(15,23,42,0.28)',
  navHeight: 64,
  navBarStyle: '',
  statusBarHeight: 20,
  navBarHeight: 44,
  festivalActive: true,
  festivalId: '',
  festivalClass: '',
  festivalStyle: '',
  festHeaderPx: 88,
  nativeAdUnitId: '',
  showNativeAd: false,
  paramsDirty: false,
};
