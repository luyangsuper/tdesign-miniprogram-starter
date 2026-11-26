import { callFunction } from '~/utils/cloud';
import { resolveIsAdmin } from '~/utils/auth';
import { presentLibrarySource } from '~/utils/library';
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
  },

  _opening: false,

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
    this.loadSources();
  },

  onShow() {
    applyThemeToPage(this);
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
    wx.navigateTo({
      url,
      success: unlock,
      fail: (err) => {
        console.warn('[open source]', err);
        wx.redirectTo({
          url,
          complete: unlock,
          fail: () => {
            this._opening = false;
            wx.showToast({ title: '打不开该合集', icon: 'none' });
          },
        });
      },
    });
  },

  onBack() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/home/index' }) });
  },
});
