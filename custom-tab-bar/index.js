import { getThemeStyle } from '~/utils/theme';
import {
  getActiveFestival,
  getFestivalAssets,
  resolveFestivalSrc,
  FESTIVAL_BANK_SPEC,
} from '~/utils/festival';
import { getWindowInfoSafe } from '~/utils/systemInfo';

function routeToValue(route) {
  if (!route) return '';
  if (route.indexOf('pages/home/') === 0) return 'home';
  if (route.indexOf('pages/my/') === 0) return 'my';
  return '';
}

/** 底栏装饰图最大高度（px），按设计稿 750×160 等比，且不超过栏高的 1.35 倍 */
function bankMaxHeightPx() {
  try {
    const win = getWindowInfoSafe();
    const w = win.windowWidth || 375;
    const bySpec = Math.round((w * FESTIVAL_BANK_SPEC.height) / FESTIVAL_BANK_SPEC.width);
    const tabApprox = Math.round((96 / 750) * w) + 24;
    return Math.max(48, Math.min(bySpec, Math.round(tabApprox * 1.35)));
  } catch (e) {
    return 80;
  }
}

Component({
  data: {
    value: '',
    themeStyle: '',
    festivalId: '',
    bankSrc: '',
    bankMaxPx: 80,
  },
  lifetimes: {
    attached() {
      const pages = getCurrentPages();
      const cur = pages[pages.length - 1];
      this.setData({
        value: routeToValue(cur && cur.route),
        themeStyle: getThemeStyle(),
        bankMaxPx: bankMaxHeightPx(),
      });
      this.syncFestival();
      this._onThemeChange = () => this.syncTheme();
      this._onFestivalChange = () => {
        /* 不强制清空 raw，同 fileID 命中缓存则 bankSrc 不变、不重载图 */
        this.syncFestival();
      };
      try {
        const app = getApp();
        if (app && app.eventBus) {
          app.eventBus.on('themeChange', this._onThemeChange);
          app.eventBus.on('festivalChange', this._onFestivalChange);
        }
      } catch (e) {
        /* ignore */
      }
    },
    detached() {
      try {
        const app = getApp();
        if (app && app.eventBus) {
          if (this._onThemeChange) app.eventBus.off('themeChange', this._onThemeChange);
          if (this._onFestivalChange) app.eventBus.off('festivalChange', this._onFestivalChange);
        }
      } catch (e) {
        /* ignore */
      }
    },
  },
  pageLifetimes: {
    show() {
      this.syncTheme();
      this.syncFestival();
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
    /** 底栏背景跟节日走；临时链有缓存，同图不重载 */
    syncFestival(opts = {}) {
      const token = (this._festToken = (this._festToken || 0) + 1);
      const fest = getActiveFestival();
      const festivalId = fest ? fest.id : '';
      const assets = festivalId ? getFestivalAssets(festivalId) : {};
      const rawBank = (assets && assets.bank) || '';
      const bankMaxPx = bankMaxHeightPx();

      if (
        !opts.force &&
        this.data.festivalId === festivalId &&
        this._rawBankId === rawBank &&
        (rawBank ? !!this.data.bankSrc : !this.data.bankSrc)
      ) {
        if (this.data.bankMaxPx !== bankMaxPx) this.setData({ bankMaxPx });
        return;
      }

      const apply = (bankSrc) => {
        if (token !== this._festToken) return;
        this._rawBankId = rawBank;
        const patch = {};
        if (this.data.festivalId !== festivalId) patch.festivalId = festivalId;
        if (this.data.bankSrc !== bankSrc) patch.bankSrc = bankSrc;
        if (this.data.bankMaxPx !== bankMaxPx) patch.bankMaxPx = bankMaxPx;
        if (Object.keys(patch).length) this.setData(patch);
      };

      if (!rawBank) {
        apply('');
        return;
      }
      resolveFestivalSrc(rawBank)
        .then((url) => apply(url || ''))
        .catch(() => apply(''));
    },
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
