/**
 * 图片工具页共用：主题 / 导航 / 节日装饰 / 返回
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

export function createShellMethods() {
  return {
    onBack() {
      wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/workshop/index' }) });
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

    bindShellEvents() {
      this._onFestivalChange = () => {
        this.updateNavHeight();
        this.refreshFestivalDecor();
      };
      this._onThemeChange = () => this.syncThemeUi();
      try {
        const app = getApp();
        if (app && app.eventBus) {
          app.eventBus.on('festivalChange', this._onFestivalChange);
          app.eventBus.on('themeChange', this._onThemeChange);
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
        }
      } catch (e) {
        /* ignore */
      }
    },

    initShell() {
      this.updateNavHeight();
      this.syncThemeUi();
      this.refreshFestivalDecor();
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
};
