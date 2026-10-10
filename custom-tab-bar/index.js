import { resolveIsAdmin } from '~/utils/auth';
import { getThemeBrand, getThemeStyle } from '~/utils/theme';

Component({
  data: {
    value: '',
    themeStyle: '',
    brand: '#07C160',
    colorIdle: '#C8C3BD',
    myColorActive: '#FA9D3B',
    isAdmin: false,
    home: {
      icon: '/static/tab/home.png',
      iconActive: '/static/tab/home-active.png',
    },
    my: {
      icon: '/static/tab/my.png',
      iconActive: '/static/tab/my-active.png',
    },
  },
  lifetimes: {
    attached() {
      this.syncTheme();
      this._onThemeChange = () => this.syncTheme();
      try {
        const app = getApp();
        if (app && app.eventBus) app.eventBus.on('themeChange', this._onThemeChange);
      } catch (e) {
        /* ignore */
      }
    },
    ready() {
      this.syncTheme();
      const pages = getCurrentPages();
      const curPage = pages[pages.length - 1];
      if (!curPage || !curPage.route) return;
      if (curPage.route.indexOf('pages/home/') === 0) this.setData({ value: 'home' });
      else if (curPage.route.indexOf('pages/my/') === 0) this.setData({ value: 'my' });
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
    },
  },
  methods: {
    syncTheme() {
      this.setData({
        themeStyle: getThemeStyle(),
        brand: getThemeBrand(),
        isAdmin: resolveIsAdmin(),
      });
    },
    /** 先 setData 让指示条/缩放开启动画，再 switchTab（否则原生切页常把过渡掐掉） */
    switchTabWithAnim(value, url) {
      if (this.data.value === value) return;
      this.setData({ value });
      const go = () => wx.switchTab({ url });
      if (typeof wx.nextTick === 'function') {
        wx.nextTick(() => setTimeout(go, 40));
      } else {
        setTimeout(go, 50);
      }
    },
    onTapHome() {
      this.switchTabWithAnim('home', '/pages/home/index');
    },
    onTapMy() {
      this.switchTabWithAnim('my', '/pages/my/index');
    },
    onTapUpload() {
      if (!resolveIsAdmin()) return;
      wx.navigateTo({ url: '/pages/admin/upload/index' });
    },
  },
});
