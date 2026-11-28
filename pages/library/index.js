import { callFunction } from '~/utils/cloud';
import { resolveIsAdmin } from '~/utils/auth';
import { presentLibrarySource } from './utils/library';
import {
  getNativeLibraryAdUnitId,
  shouldShowNativeAds,
} from '~/utils/nativeAd';
import { getCustomNavMetrics } from '~/utils/systemInfo';
import { applyThemeToPage, getThemeStyle } from '~/utils/theme';

Page({
  data: {
    themeStyle: '',
    themeBrand: '#07c160',
    navHeight: 0,
    navBarStyle: '',
    loading: true,
    sources: [],
    emptyTip: '暂无素材源',
    nativeAdUnitId: '',
    showNativeAd: false,
  },

  _opening: false,

  refreshNativeAd() {
    const unitId = getNativeLibraryAdUnitId();
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

  onLoad() {
    try {
      const nav = getCustomNavMetrics();
      this.setData({
        navHeight: nav.navHeight,
        navBarStyle: nav.navBarStyle || '',
        themeStyle: getThemeStyle(),
      });
    } catch (e) {
      this.setData({
        navHeight: 64,
        navBarStyle: '',
        themeStyle: getThemeStyle(),
      });
    }
    applyThemeToPage(this);
    this.refreshNativeAd();
    this._onEntitlementChange = () => this.refreshNativeAd();
    try {
      const app = getApp();
      if (app && app.eventBus) {
        app.eventBus.on('entitlementChange', this._onEntitlementChange);
      }
    } catch (e) {
      /* ignore */
    }
    this.loadSources();
  },

  onUnload() {
    try {
      const app = getApp();
      if (app && app.eventBus && this._onEntitlementChange) {
        app.eventBus.off('entitlementChange', this._onEntitlementChange);
      }
    } catch (e) {
      /* ignore */
    }
  },

  onShow() {
    applyThemeToPage(this);
    this.refreshNativeAd();
    this._opening = false;
  },

  async loadSources() {
    this.setData({ loading: true });
    try {
      const res = await callFunction('listLibrary', { action: 'sources' });
      const list = ((res.data && res.data.list) || []).map((s) =>
        presentLibrarySource(s),
      );
      this.setData({
        sources: list,
        loading: false,
        emptyTip: resolveIsAdmin()
          ? '暂无合集，请用本机脚本导入后刷新'
          : '素材正在准备中，先去首页看看合集吧',
      });
    } catch (e) {
      console.warn('[library hub]', e);
      const msg = String((e && e.message) || '');
      const needTable = /lib_sources|collection not exist|502005/i.test(msg);
      const admin = resolveIsAdmin();
      this.setData({
        sources: [],
        loading: false,
        emptyTip: needTable
          ? admin
            ? '数据库表未创建：请重新部署 listLibrary'
            : '素材正在准备中，稍后再来看看'
          : admin
            ? '加载失败，请确认已部署 listLibrary'
            : '加载失败，请稍后再试',
      });
    }
  },

  onOpenSource(e) {
    const id = String(
      (e &&
        e.currentTarget &&
        e.currentTarget.dataset &&
        e.currentTarget.dataset.id) ||
        '',
    ).trim();
    if (!id) {
      wx.showToast({ title: '合集无效', icon: 'none' });
      return;
    }
    if (this._opening) return;
    this._opening = true;
    const url = `/pages/library/source/index?sourceId=${encodeURIComponent(id)}`;
    const unlock = () => {
      setTimeout(() => {
        this._opening = false;
      }, 450);
    };
    // 禁止用 redirectTo：会顶掉素材库列表页，返回就直接回首页
    const tryNavigate = () =>
      new Promise((resolve, reject) => {
        wx.navigateTo({ url, success: resolve, fail: reject });
      });
    const loadPkg = () =>
      new Promise((resolve) => {
        if (typeof wx.loadSubpackage !== 'function') {
          resolve();
          return;
        }
        try {
          const task = wx.loadSubpackage({
            name: 'library',
            success: () => resolve(),
            fail: () => resolve(),
          });
          if (task && typeof task.catch === 'function') {
            task.catch(() => resolve());
          }
        } catch (e) {
          resolve();
        }
      });
    (async () => {
      try {
        await tryNavigate();
        unlock();
      } catch (err) {
        console.warn('[open source]', err);
        await loadPkg();
        try {
          await tryNavigate();
          unlock();
        } catch (err2) {
          console.warn('[open source retry]', err2);
          this._opening = false;
          wx.showToast({ title: '打不开该合集', icon: 'none' });
        }
      }
    })();
  },

  onBack() {
    // t-navbar 会自行 navigateBack；再退一层会直接回更早页面
    const pages = getCurrentPages() || [];
    if (pages.length > 1) return;
    wx.switchTab({ url: '/pages/home/index' });
  },
});
