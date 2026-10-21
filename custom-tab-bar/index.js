import { getThemeStyle } from '~/utils/theme';

function routeToValue(route) {
  if (!route) return '';
  if (route.indexOf('pages/home/') === 0) return 'home';
  if (route.indexOf('pages/my/') === 0) return 'my';
  return '';
}

Component({
  data: {
    value: '',
    themeStyle: '',
  },
  lifetimes: {
    attached() {
      const pages = getCurrentPages();
      const cur = pages[pages.length - 1];
      this.setData({
        value: routeToValue(cur && cur.route),
        themeStyle: getThemeStyle(),
      });
      this._onThemeChange = () => this.syncTheme();
      try {
        const app = getApp();
        if (app && app.eventBus) {
          app.eventBus.on('themeChange', this._onThemeChange);
        }
      } catch (e) {
        /* ignore */
      }
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
      if (this.data.themeStyle !== themeStyle) this.setData({ themeStyle });
    },
    /** 页面 onShow / 点击共用：相同值不刷新，避免闪一下 */
    setSelected(value) {
      if (!value || this.data.value === value) return;
      this.setData({ value });
    },
    onChange(e) {
      const value = e && e.detail && e.detail.value;
      if (!value || this.data.value === value) return;
      if (value === 'home') {
        this.setData({ value });
        wx.switchTab({ url: '/pages/home/index' });
        return;
      }
      if (value === 'my') {
        this.setData({ value });
        wx.switchTab({ url: '/pages/my/index' });
      }
    },
  },
});
