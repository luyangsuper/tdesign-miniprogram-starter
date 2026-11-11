import {
  getActiveFestival,
  getFestivalAssets,
  festivalBankContentHeightPx,
  peekFestivalBankDisplay,
  rememberFestivalBankDisplay,
  resolveFestivalSrc,
} from '~/utils/festival';
import { getWindowInfoSafe } from '~/utils/systemInfo';

function routeToValue(route) {
  if (!route) return '';
  if (route.indexOf('pages/home/') === 0) return 'home';
  if (route.indexOf('pages/my/') === 0) return 'my';
  return '';
}

/** 底图高度只跟图标内容区走（90rpx，与 750:90 ≈ 8.318:1 对齐）；安全区由栏体实色填充 */
function bankMaxHeightPx() {
  try {
    const win = getWindowInfoSafe();
    return festivalBankContentHeightPx(win.windowWidth || 375);
  } catch (e) {
    return 48;
  }
}

Component({
  options: {
    styleIsolation: 'shared',
    virtualHost: true,
  },
  data: {
    value: '',
    festivalId: '',
    bankSrc: '',
    bankMaxPx: 80,
    /** 全屏遮罩（裁剪等）时隐藏 */
    hidden: false,
  },
  lifetimes: {
    attached() {
      const pages = getCurrentPages();
      const cur = pages[pages.length - 1];
      this.setData({
        value: routeToValue(cur && cur.route),
        bankMaxPx: bankMaxHeightPx(),
      });
      this.syncFestival();
      this._onFestivalChange = () => {
        this.syncFestival();
      };
      try {
        const app = getApp();
        if (app && app.eventBus) {
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
          if (this._onFestivalChange) app.eventBus.off('festivalChange', this._onFestivalChange);
        }
      } catch (e) {
        /* ignore */
      }
    },
  },
  pageLifetimes: {
    show() {
      this.syncFestival();
      const pages = getCurrentPages();
      const cur = pages[pages.length - 1];
      this.setSelected(routeToValue(cur && cur.route));
    },
  },
  methods: {
    /** 底栏背景跟节日走；栏体始终实心，底图只作装饰；文字色不跟主题 */
    syncFestival(opts = {}) {
      const token = (this._festToken || 0) + 1;
      this._festToken = token;
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
        if (bankSrc && rawBank) {
          rememberFestivalBankDisplay(festivalId, rawBank, bankSrc);
        }
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

      const peeked = peekFestivalBankDisplay(festivalId, rawBank);
      if (peeked) {
        apply(peeked);
        return;
      }

      const keep =
        this._rawBankId === rawBank && this.data.bankSrc ? this.data.bankSrc : '';
      if (keep) apply(keep);

      resolveFestivalSrc(rawBank)
        .then((url) => {
          const next = url || keep || '';
          if (next !== this.data.bankSrc || this._rawBankId !== rawBank) {
            apply(next);
          } else {
            this._rawBankId = rawBank;
            rememberFestivalBankDisplay(festivalId, rawBank, next);
          }
        })
        .catch(() => {
          if (!keep) apply('');
        });
    },
    setSelected(value) {
      if (!value || this.data.value === value) return;
      this.setData({ value });
    },
    setHidden(hidden) {
      const next = !!hidden;
      if (this.data.hidden === next) return;
      this.setData({ hidden: next });
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
