import { resolveIsAdmin } from '~/utils/auth';
import { getThemeBrand, getThemeStyle } from '~/utils/theme';

function routeToValue(route) {
  if (!route) return '';
  if (route.indexOf('pages/home/') === 0) return 'home';
  if (route.indexOf('pages/my/') === 0) return 'my';
  if (route.indexOf('pages/admin/upload/') === 0) return 'publish';
  return '';
}

Component({
  data: {
    value: '',
    /** 首帧关闭过渡，避免新 tab 页实例从空态「跳」到选中 */
    cold: true,
    themeStyle: '',
    brand: '#07C160',
    colorIdle: '#C8C3BD',
    myColorActive: '#FA9D3B',
    isAdmin: false,
    home: {
      icon: '/static/tab/home.png',
      iconActive: '/static/tab/home-active.png',
    },
    publish: {
      icon: '/static/tab/publish.png',
      iconActive: '/static/tab/publish-active.png',
    },
    my: {
      icon: '/static/tab/my.png',
      iconActive: '/static/tab/my-active.png',
    },
  },
  lifetimes: {
    attached() {
      const pages = getCurrentPages();
      const cur = pages[pages.length - 1];
      const value = routeToValue(cur && cur.route);
      const brand = getThemeBrand();
      const themeStyle = getThemeStyle();
      const isAdmin = resolveIsAdmin();
      this.setData({
        value,
        cold: true,
        brand,
        themeStyle,
        isAdmin,
      });
      this._onThemeChange = () => this.syncTheme();
      try {
        const app = getApp();
        if (app && app.eventBus) app.eventBus.on('themeChange', this._onThemeChange);
      } catch (e) {
        /* ignore */
      }
    },
    ready() {
      // 等首帧画完再开过渡
      setTimeout(() => {
        if (this.data.cold) this.setData({ cold: false });
      }, 60);
    },
    detached() {
      try {
        const app = getApp();
        if (app && app.eventBus && this._onThemeChange) {
          app.eventBus.off('themeChange', this._onThemeChange);
        }
      } catch (e) {
        /* ignore */
      }
    },
  },
  pageLifetimes: {
    show() {
      this.syncTheme();
      const pages = getCurrentPages();
      const cur = pages[pages.length - 1];
      this.setSelected(routeToValue(cur && cur.route));
    },
  },
  methods: {
    syncTheme() {
      const themeStyle = getThemeStyle();
      const brand = getThemeBrand();
      const isAdmin = resolveIsAdmin();
      const patch = {};
      if (this.data.themeStyle !== themeStyle) patch.themeStyle = themeStyle;
      if (this.data.brand !== brand) patch.brand = brand;
      if (this.data.isAdmin !== isAdmin) patch.isAdmin = isAdmin;
      if (Object.keys(patch).length) this.setData(patch);
    },
    /** 页面 onShow / 点击共用：相同值不刷新，避免闪一下 */
    setSelected(value) {
      if (!value || this.data.value === value) return;
      this.setData({ value });
    },
    onTapHome() {
      if (this.data.value === 'home') return;
      this.setData({ value: 'home' });
      wx.switchTab({ url: '/pages/home/index' });
    },
    onTapMy() {
      if (this.data.value === 'my') return;
      this.setData({ value: 'my' });
      wx.switchTab({ url: '/pages/my/index' });
    },
    onTapPublish() {
      if (!resolveIsAdmin()) return;
      this.setData({ value: 'publish' });
      wx.navigateTo({ url: '/pages/admin/upload/index' });
    },
  },
});
