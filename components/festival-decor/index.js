import {
  getFestivalConfig,
  getFestivalFallScope,
  getMotionIcons,
  getFestivalAssets,
  isCloudFileId,
  peekFestivalBannerDisplay,
  rememberFestivalBannerDisplay,
  resolveFestivalSrc,
} from '../../utils/festival';

/** 首页飘落数量：全屏更密；顶栏略少 */
const FLAKE_FULL_COUNT = 42;
const FLAKE_HEADER_COUNT = 20;

/** 稳定伪随机 0~1，避免每次 refresh 位置乱跳 */
function hash01(seed) {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function buildBulbs(festivalId) {
  if (festivalId === 'christmas') {
    const xs = [5.6, 14.7, 23.7, 32.8, 41.9, 50.9, 60, 69.1, 78.1, 87.2, 94.7];
    const colors = ['r', 'g', 'y', 'w', 'r', 'g', 'y', 'w', 'r', 'g', 'y'];
    return xs.map((left, i) => {
      const wireY = 24 + Math.sin(i * 0.95) * 18;
      const top = ((wireY + 20) / 80) * 100;
      return {
        id: `b${i}`,
        color: colors[i],
        group: i % 3,
        style: `left:${left}%;top:${top}%;`,
      };
    });
  }
  if (festivalId === 'cny' || festivalId === 'chuxi') {
    const xs = [10.7, 25.3, 40, 54.7, 69.3, 85.3];
    return xs.map((left, i) => {
      const wireY = 24 + Math.sin(i * 1.15) * 16;
      const top = ((wireY + 18) / 80) * 100;
      return {
        id: `b${i}`,
        color: i % 2 ? 'y' : 'r',
        group: i % 2,
        style: `left:${left}%;top:${top}%;`,
      };
    });
  }
  return [];
}

function buildSparkles() {
  const pts = [
    { left: 18, top: 28 },
    { left: 32, top: 18 },
    { left: 48, top: 34 },
    { left: 62, top: 16 },
    { left: 76, top: 30 },
    { left: 88, top: 22 },
  ];
  return pts.map((p, i) => ({
    id: `s${i}`,
    group: i % 3,
    style: `left:${p.left}%;top:${p.top}%;`,
  }));
}

/**
 * 散落飘落：快慢差大、左右漂移、相位错开，避免「一条条平行斜线」
 */
function buildFlakes(festivalId, fallScope) {
  const icons = getMotionIcons(festivalId);
  if (!icons.length) return [];
  const count = fallScope === 'full' ? FLAKE_FULL_COUNT : FLAKE_HEADER_COUNT;
  const fallMin = fallScope === 'full' ? 5.2 : 3.0;
  const fallMax = fallScope === 'full' ? 15.5 : 9.2;
  const sizeBase = fallScope === 'full' ? 14 : 12;
  const list = [];
  for (let i = 0; i < count; i += 1) {
    const a = hash01(i * 3 + 1);
    const b = hash01(i * 5 + 11);
    const c = hash01(i * 7 + 23);
    const d = hash01(i * 11 + 41);
    const e = hash01(i * 13 + 67);
    const left = 2 + a * 96;
    /* 快慢拉开：约 3x 速差 */
    const fall = fallMin + b * (fallMax - fallMin);
    /* 负 delay 错开起点，铺满周期 */
    const delay = -(c * fallMax * 1.15);
    const size = sizeBase + Math.round(d * 14);
    const spin = 3.2 + e * 5.5;
    const spinDir = hash01(i + 99) > 0.5 ? 1 : -1;
    /* 横向漂移（预计算多段，避免真机 calc(var * n) 失效） */
    const drift = Math.round((hash01(i + 131) - 0.5) * 72);
    const driftB = Math.round(drift * -0.7);
    const driftC = Math.round(drift * 0.45);
    const driftD = Math.round(drift * -0.15);
    list.push({
      id: `f${festivalId}-${fallScope}-${i}`,
      src: icons[i % icons.length],
      wrapStyle: [
        `left:${left.toFixed(2)}%`,
        `--fest-size:${size}px`,
        `--fest-fall:${fall.toFixed(2)}s`,
        `--fest-delay:${delay.toFixed(2)}s`,
        `--fest-spin:${spin.toFixed(2)}s`,
        `--fest-spin-dir:${spinDir}`,
        `--fest-drift:${drift}px`,
        `--fest-drift-b:${driftB}px`,
        `--fest-drift-c:${driftC}px`,
        `--fest-drift-d:${driftD}px`,
      ].join(';'),
    });
  }
  return list;
}

Component({
  properties: {
    mode: { type: String, value: 'home' },
    active: { type: Boolean, value: true },
    headerHeight: { type: Number, value: 200 },
    navHeight: { type: Number, value: 88 },
    headerTop: { type: Number, value: 0 },
  },

  data: {
    visible: false,
    paused: false,
    festivalId: '',
    assets: {},
    showSkin: true,
    showChrome: true,
    showAmbient: true,
    showMotion: true,
    showLights: true,
    fallScope: 'header',
    ambientStyle: '',
    flakes: [],
    bulbs: [],
    sparkles: [],
    chromeHeightPx: 88,
    skinHeightPx: 200,
  },

  observers: {
    'active, headerHeight, navHeight, headerTop, mode'() {
      this.refresh();
    },
  },

  lifetimes: {
    attached() {
      this._onFestivalChange = () => this.refresh();
      try {
        const app = getApp();
        if (app && app.eventBus) {
          app.eventBus.on('festivalChange', this._onFestivalChange);
        }
      } catch (e) {
        /* ignore */
      }
      this.refresh();
    },
    detached() {
      try {
        const app = getApp();
        if (app && app.eventBus && this._onFestivalChange) {
          app.eventBus.off('festivalChange', this._onFestivalChange);
        }
      } catch (e) {
        /* ignore */
      }
    },
  },

  pageLifetimes: {
    show() {
      this.refresh();
    },
  },

  methods: {
    /** token 保证只有最后一次 refresh 的结果落地；不再加「进行中」锁，否则换签未回来时关开关会被丢掉 */
    refresh() {
      const token = (this._festRefreshToken || 0) + 1;
      this._festRefreshToken = token;
      const cfg = getFestivalConfig();
      const mode = this.properties.mode || 'home';
      const festivalId = cfg.id || '';
      const rawAssets = getFestivalAssets(festivalId) || {};
      /* 首页 / 我的：顶栏皮肤、灯带、飘落一致 */
      const showDecor = mode === 'home' || mode === 'my';
      const navH = Number(this.properties.navHeight) || 88;
      /* headerHeight = 导航高；上传图 4:1，灯带贴导航底缘 */
      const headerH = Number(this.properties.headerHeight) || navH;
      const rawBanner = rawAssets.banner || '';

      const apply = (assets) => {
        if (token !== this._festRefreshToken) return;
        const fallScope = getFestivalFallScope();
        const pageActive = this.properties.active !== false;
        /* 切走 tab 只暂停动画，不卸顶栏图，避免切回闪白 */
        const paused = !pageActive;
        const showSkin = showDecor && !!festivalId && !!assets.banner;
        const showChrome = showDecor && !!festivalId && !!cfg.lights;
        const showMotion = showDecor && !!cfg.motion && !!festivalId;
        const showAmbient = showMotion;
        const showLights = !!cfg.lights && showDecor;
        const visible =
          !!festivalId && showDecor && (showSkin || showChrome || showAmbient);
        const chromeHeightPx = Math.max(48, navH);
        const skinHeightPx = Math.max(48, Math.round(headerH || navH));
        const ambientH = chromeHeightPx;
        const ambientStyle =
          fallScope === 'full'
            ? ''
            : `height:${ambientH}px;--fest-fall-dist:${ambientH + 24}px;`;

        const sameFest = this.data.festivalId === festivalId;
        const sameBanner =
          (this.data.assets && this.data.assets.banner) === (assets.banner || '');
        const sameFall = this.data.fallScope === fallScope;
        const keepFlakes =
          sameFest &&
          sameFall &&
          showMotion &&
          Array.isArray(this.data.flakes) &&
          this.data.flakes.length > 0;

        if (assets.banner && rawBanner) {
          rememberFestivalBannerDisplay(festivalId, rawBanner, assets.banner);
        }

        const patch = {
          visible,
          paused,
          festivalId,
          assets,
          showSkin,
          showChrome,
          showAmbient,
          showMotion,
          showLights,
          fallScope,
          ambientStyle,
          chromeHeightPx,
          skinHeightPx,
        };
        if (!keepFlakes) {
          patch.flakes = showMotion ? buildFlakes(festivalId, fallScope) : [];
        }
        if (!sameFest || !showLights) {
          patch.bulbs = showLights ? buildBulbs(festivalId) : [];
        }
        if (!sameFest || !showChrome) {
          patch.sparkles = showChrome ? buildSparkles() : [];
        }

        if (
          sameFest &&
          sameBanner &&
          sameFall &&
          keepFlakes &&
          this.data.visible === visible &&
          this.data.paused === paused
        ) {
          this.setData({
            chromeHeightPx,
            skinHeightPx,
            ambientStyle,
            fallScope,
            showSkin,
            showChrome,
            showAmbient,
            showMotion,
            showLights,
            visible,
            paused,
          });
        } else if (
          sameFest &&
          sameBanner &&
          sameFall &&
          keepFlakes &&
          this.data.visible === visible
        ) {
          /* 仅 paused 变化：不动图片 */
          this.setData({ paused });
        } else {
          this.setData(patch);
        }
        this._rawBannerId = rawBanner;
      };

      const peeked = peekFestivalBannerDisplay(festivalId, rawBanner);
      const keepBanner =
        this._rawBannerId === rawBanner &&
        this.data.assets &&
        this.data.assets.banner
          ? this.data.assets.banner
          : '';
      const syncBanner = peeked || (!isCloudFileId(rawBanner) ? rawBanner : keepBanner);
      const needFetch = isCloudFileId(rawBanner) && !peeked;

      apply({ ...rawAssets, banner: syncBanner || '' });

      if (needFetch) {
        resolveFestivalSrc(rawBanner)
          .then((banner) => {
            const next = banner || syncBanner || '';
            apply({ ...rawAssets, banner: next });
          })
          .catch(() => {
            apply({ ...rawAssets, banner: syncBanner || '' });
          });
      }
    },
  },
});
