import {
  getFestivalConfig,
  getFestivalFallScope,
  getMotionIcons,
  getFestivalAssets,
  isCloudFileId,
  resolveFestivalSrc,
} from '../../utils/festival';

/** 首页飘落：全屏更密；顶栏模式列行少一些 */
const FLAKE_FULL = { cols: 9, rows: 5 };
const FLAKE_HEADER = { cols: 7, rows: 3 };

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

/** 行列网格 + 隔行错位，相位铺满整段下落 */
function buildFlakes(festivalId, fallScope) {
  const icons = getMotionIcons(festivalId);
  if (!icons.length) return [];
  const grid = fallScope === 'full' ? FLAKE_FULL : FLAKE_HEADER;
  const cols = grid.cols;
  const rows = grid.rows;
  const list = [];
  const period = fallScope === 'full' ? 9.5 : 5.5;
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const i = r * cols + c;
      const colShift = r % 2 ? 0.5 / cols : 0;
      const left = Math.max(
        1.5,
        Math.min(96.5, ((c + 0.5) / cols + colShift) * 97),
      );
      const size = (fallScope === 'full' ? 16 : 14) + ((c + r) % 4) * 2;
      const fall = period + (i % 5) * 0.28;
      const delay = -((r + c / cols) / rows) * period;
      const spin = 4.5 + (i % 4) * 0.8;
      const spinDir = i % 2 === 0 ? 1 : -1;
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
        ].join(';'),
      });
    }
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
    refresh() {
      if (this._festRefreshing) return;
      this._festRefreshing = true;
      const token = (this._festRefreshToken = (this._festRefreshToken || 0) + 1);
      const cfg = getFestivalConfig();
      const mode = this.properties.mode || 'home';
      const festivalId = cfg.id || '';
      const rawAssets = getFestivalAssets(festivalId) || {};
      const isHome = mode === 'home';
      const navH = Number(this.properties.navHeight) || 88;
      /* 优先用页面传入的导航高度；顶栏图不得盖住分类条 */
      const headerH = Number(this.properties.headerHeight) || navH;
      const rawBanner = rawAssets.banner || '';

      const apply = (assets) => {
        if (token !== this._festRefreshToken) return;
        const fallScope = getFestivalFallScope();
        const showSkin = isHome && !!festivalId && !!assets.banner;
        const showChrome = isHome && !!festivalId && !!cfg.lights;
        const showMotion = isHome && !!cfg.motion && !!festivalId;
        const showAmbient = showMotion;
        const showLights = !!cfg.lights && isHome;
        const visible =
          !!festivalId &&
          this.properties.active !== false &&
          (showSkin || showChrome || showAmbient);
        const chromeHeightPx = Math.max(48, navH);
        const skinHeightPx = Math.max(48, Math.round(headerH || navH));
        /* 顶栏飘落高度跟导航一致，不盖分类条 */
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

        const patch = {
          visible,
          paused: false,
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

        /* 同节日同图时只更新尺寸等轻量字段，避免 image 重载 */
        if (
          sameFest &&
          sameBanner &&
          sameFall &&
          keepFlakes &&
          this.data.visible === visible
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
          });
        } else {
          this.setData(patch);
        }
        this._rawBannerId = rawBanner;
        this._festRefreshing = false;
      };

      resolveFestivalSrc(rawBanner)
        .then((banner) => {
          apply({ ...rawAssets, banner });
        })
        .catch(() => {
          apply({ ...rawAssets, banner: isCloudFileId(rawBanner) ? '' : rawBanner });
        });
    },
  },
});
