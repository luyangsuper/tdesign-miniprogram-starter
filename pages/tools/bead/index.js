import { getCustomNavMetrics } from '~/utils/systemInfo';
import {
  applyThemeToPage,
  getThemeBrand,
  getThemeStyle,
} from '~/utils/theme';
import {
  getActiveFestival,
  getFestivalAssets,
  loadFestivalConfig,
} from '~/utils/festival';
import {
  buildGrid,
  paintPattern,
  paintPixelMap,
  buildSvg,
  listColors,
  mergeSimilarity,
  mergeKmeans,
  removeStray,
  exportCellSize,
  pixelScale,
  paintColorList,
  measureColorList,
  paintLiveViewport,
  buildLiveColorCanvas,
} from './engine';
import {
  unlockBeadAccess,
  BEAD_EXPORT_AD_COUNT,
} from './beadGate';
import {
  BEAD_EXPORT_COST,
  BEAD_ADVANCED_COST,
  getBeadExportCost,
  getBeadAdvancedCost,
} from '~/utils/beadCosts';
import { getCachedEntitlement } from '~/utils/entitlement';
import { resolveIsAdmin } from '~/utils/auth';
import {
  getNativeWorkshopAdUnitId,
  shouldShowNativeAds,
} from '~/utils/nativeAd';

const LIVE_BASE_CELL = 36;
const LIVE_ZOOM_MAX = 5;
const ZOOM_SLIDER_MIN = 100;
const ZOOM_SLIDER_MAX = 500;

const MODES = [
  { id: 'structural', name: '智能' },
  { id: 'average', name: '均值' },
  { id: 'dominant', name: '主色' },
  { id: 'nearest', name: '像素' },
];

const ALGOS = [
  { id: 'ciede', name: 'CIEDE' },
  { id: 'lab', name: 'Lab' },
  { id: 'rgb', name: 'RGB' },
];

const MERGE_MODES = [
  { id: 'similarity', name: '相似度' },
  { id: 'kmeans', name: 'K-Means' },
];

const GRID_PRESETS = [
  { value: 24, hint: '大颗粒', dens: 3, tone: 'amber' },
  { value: 32, hint: '常用', dens: 4, tone: 'sky' },
  { value: 48, hint: '细腻', dens: 5, tone: 'mint' },
  { value: 64, hint: '更细', dens: 6, tone: 'violet' },
  { value: 80, hint: '超细', dens: 7, tone: 'rose' },
].map((p) => ({
  ...p,
  densStyle: `grid-template-columns:repeat(${p.dens},1fr);grid-template-rows:repeat(${p.dens},1fr);`,
  cells: Array.from({ length: p.dens * p.dens }, (_, i) => {
    const x = i % p.dens;
    const y = Math.floor(i / p.dens);
    return { id: i, alt: (x + y) % 2 === 1 };
  }),
}));

const SCALE_OPTIONS = [
  { id: 1, name: '标准', desc: '体积小' },
  { id: 2, name: '高清', desc: '推荐' },
  { id: 4, name: '超清', desc: '会员专属', vipOnly: true },
];

function queryNode(page, id) {
  return new Promise((resolve, reject) => {
    const q = page.createSelectorQuery();
    q.select(id)
      .fields({ node: true, size: true })
      .exec((res) => {
        const node = res && res[0] && res[0].node;
        if (!node) reject(new Error('画布不可用'));
        else resolve({ canvas: node, width: res[0].width, height: res[0].height });
      });
  });
}

function loadImage(canvas, src) {
  return new Promise((resolve, reject) => {
    const img = canvas.createImage();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = src;
  });
}

function canvasToPng(canvas, width, height) {
  return new Promise((resolve, reject) => {
    wx.canvasToTempFilePath({
      canvas,
      x: 0,
      y: 0,
      width,
      height,
      destWidth: width,
      destHeight: height,
      fileType: 'png',
      quality: 1,
      success: (r) => resolve(r.tempFilePath),
      fail: (e) => reject(e || new Error('导出失败')),
    });
  });
}

function ensureAlbumAuth() {
  return new Promise((resolve, reject) => {
    wx.getSetting({
      success: (s) => {
        if (s.authSetting['scope.writePhotosAlbum'] === false) {
          wx.showModal({
            title: '需要相册权限',
            content: '保存图纸需要写入相册权限',
            confirmText: '去设置',
            success: (r) => {
              if (r.confirm) wx.openSetting({});
              reject(new Error('无相册权限'));
            },
            fail: () => reject(new Error('无相册权限')),
          });
          return;
        }
        if (!s.authSetting['scope.writePhotosAlbum']) {
          wx.authorize({
            scope: 'scope.writePhotosAlbum',
            success: () => resolve(),
            fail: () => {
              wx.showModal({
                title: '需要相册权限',
                content: '请允许保存到相册后再试',
                confirmText: '去设置',
                success: (r) => {
                  if (r.confirm) wx.openSetting({});
                },
              });
              reject(new Error('无相册权限'));
            },
          });
          return;
        }
        resolve();
      },
      fail: () => resolve(),
    });
  });
}

function saveAlbum(path) {
  return ensureAlbumAuth().then(
    () =>
      new Promise((resolve, reject) => {
        wx.saveImageToPhotosAlbum({
          filePath: path,
          success: () => resolve(),
          fail: (e) => reject(e || new Error('保存失败')),
        });
      }),
  );
}

Page({
  data: {
    themeStyle: '',
    themeBrand: '#07c160',
    navHeight: 64,
    statusBarHeight: 20,
    navBarHeight: 44,
    navBarStyle: '',
    festivalActive: true,
    festivalId: '',
    festivalClass: '',
    festivalStyle: '',
    festHeaderPx: 88,
    imagePath: '',
    busy: false,
    exporting: '',
    gridSize: 48,
    gridPresets: GRID_PRESETS,
    modes: MODES,
    mode: 'structural',
    algos: ALGOS,
    algo: 'ciede',
    mergeModes: MERGE_MODES,
    mergeMode: 'similarity',
    mergeMinCount: 4,
    mergeK: 24,
    removeBg: true,
    hasGrid: false,
    liveCanvasStyle: '',
    previewKind: 'chart',
    zoomSlider: ZOOM_SLIDER_MIN,
    zoomSliderMin: ZOOM_SLIDER_MIN,
    zoomSliderMax: ZOOM_SLIDER_MAX,
    zoomLabel: '100%',
    /** 放大后可平移时才 catch 触摸，否则放行页面滚动 */
    liveCanPan: false,
    exportScale: 2,
    scaleOptions: SCALE_OPTIONS,
    statsText: '',
    colorRows: [],
    beadTotal: 0,
    colorListVisible: false,
    mergeVisible: false,
    paramsDirty: false,
    exportUnlocked: false,
    advancedUnlocked: false,
    advancedApplied: false,
    gating: false,
    beadExportCost: BEAD_EXPORT_COST,
    beadAdvancedCost: BEAD_ADVANCED_COST,
    beadExportAdCount: BEAD_EXPORT_AD_COUNT,
    isVip: false,
    nativeAdUnitId: '',
    showNativeAd: false,
  },

  _grid: null,
  _W: 0,
  _H: 0,
  _natW: 0,
  _natH: 0,
  _live: {
    tx: 0,
    ty: 0,
    zoom: 1,
    fitZoom: 1,
    cssW: 0,
    cssH: 0,
    dpr: 2,
  },
  _gest: null,
  _liveCanvas: null,
  _liveCtx: null,
  _liveColorCanvas: null,
  _zoomInteracting: false,
  _zoomDragging: false,
  _pendingDraft: false,
  _redrawRaf: null,
  _hqTimer: null,
  _labelTimer: null,
  _exportUnlockPromise: null,
  _advancedUnlockPromise: null,

  syncVipUi() {
    const ent = getCachedEntitlement();
    const isVip = !!(ent && ent.isVip) || resolveIsAdmin();
    const patch = {
      isVip,
      beadExportCost: getBeadExportCost(),
      beadAdvancedCost: getBeadAdvancedCost(),
    };
    // 非会员若停在超清，自动退回高清
    if (!isVip && this.data.exportScale === 4) {
      patch.exportScale = 2;
    }
    this.setData(patch);
    this.refreshNativeAd();
  },

  refreshNativeAd() {
    const unitId = getNativeWorkshopAdUnitId();
    this.setData({
      nativeAdUnitId: unitId,
      showNativeAd: !!unitId && shouldShowNativeAds(),
    });
  },

  onNativeAdError() {
    this.setData({ showNativeAd: false });
  },

  onLoad() {
    this.updateNavHeight();
    this.syncThemeUi();
    this.syncVipUi();
    this._onFestivalChange = () => this.updateNavHeight();
    this._onThemeChange = () => this.syncThemeUi();
    this._onEntitlementChange = () => this.syncVipUi();
    try {
      const app = getApp();
      if (app && app.eventBus) {
        app.eventBus.on('festivalChange', this._onFestivalChange);
        app.eventBus.on('themeChange', this._onThemeChange);
        app.eventBus.on('entitlementChange', this._onEntitlementChange);
      }
    } catch (e) {
      /* ignore */
    }
  },

  onUnload() {
    try {
      const app = getApp();
      if (app && app.eventBus) {
        if (this._onFestivalChange) app.eventBus.off('festivalChange', this._onFestivalChange);
        if (this._onThemeChange) app.eventBus.off('themeChange', this._onThemeChange);
        if (this._onEntitlementChange) {
          app.eventBus.off('entitlementChange', this._onEntitlementChange);
        }
      }
    } catch (e) {
      /* ignore */
    }
  },

  onShow() {
    this.syncVipUi();
    if (!this.data.festivalActive) this.setData({ festivalActive: true });
    this.refreshFestivalDecor();
    loadFestivalConfig({ silent: true }).then(() => this.refreshFestivalDecor());
  },

  onHide() {
    this.setData({ festivalActive: false });
  },

  onBack() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/workshop/index' }) });
  },

  syncThemeUi() {
    applyThemeToPage(this);
    this.setData({
      themeStyle: getThemeStyle(),
      themeBrand: getThemeBrand(),
    });
  },

  updateNavHeight() {
    try {
      const m = getCustomNavMetrics();
      this.setData(
        {
          navHeight: m.navHeight,
          statusBarHeight: m.statusBarHeight,
          navBarHeight: m.navBarHeight,
          navBarStyle: m.navBarStyle,
        },
        () => this.refreshFestivalDecor(),
      );
    } catch (e) {
      this.setData(
        {
          navHeight: 64,
          statusBarHeight: 20,
          navBarHeight: 44,
          navBarStyle: '--td-navbar-padding-top:20px;--td-navbar-height:44px',
        },
        () => this.refreshFestivalDecor(),
      );
    }
  },

  refreshFestivalDecor() {
    const fest = getActiveFestival();
    const nav = Number(this.data.navHeight) || 64;
    const assets = fest ? getFestivalAssets(fest.id) : {};
    const hasBanner = !!(assets && assets.banner);
    const festHeaderPx = Math.max(48, Math.round(nav));
    const festivalStyle = fest
      ? [
          `--fest-accent:${fest.accent || 'var(--td-brand-color)'}`,
          hasBanner ? `--fest-nav-color:${fest.navColor || '#ffffff'}` : '',
        ]
          .filter(Boolean)
          .join(';')
      : '';
    const festivalClass = fest
      ? [hasBanner ? 'bead-page--fest' : '', `bead-page--fest-${fest.id}`]
          .filter(Boolean)
          .join(' ')
      : '';
    this.setData({
      festivalId: fest ? fest.id : '',
      festivalClass,
      festivalStyle,
      festHeaderPx,
    });
    const decor = this.selectComponent('#festivalDecor');
    if (decor && typeof decor.refresh === 'function') decor.refresh();
  },

  pickImage() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const f = res.tempFiles && res.tempFiles[0];
        const path = f && f.tempFilePath;
        if (!path) return;
        wx.getImageInfo({
          src: path,
          success: (info) => {
            this._natW = info.width;
            this._natH = info.height;
            this._grid = null;
            this.setData({
              imagePath: path,
              hasGrid: false,
              liveCanPan: false,
              paramsDirty: false,
              exportUnlocked: false,
              advancedUnlocked: false,
              advancedApplied: false,
              mergeVisible: false,
              colorListVisible: false,
              liveCanvasStyle: '',
              zoomSlider: ZOOM_SLIDER_MIN,
              zoomLabel: '100%',
              statsText: '',
              colorRows: [],
              beadTotal: 0,
              previewKind: 'chart',
            });
          },
          fail: () => {
            this._natW = 0;
            this._natH = 0;
            this._grid = null;
            this.setData({
              imagePath: path,
              hasGrid: false,
              liveCanPan: false,
              paramsDirty: false,
              exportUnlocked: false,
              advancedUnlocked: false,
              advancedApplied: false,
              mergeVisible: false,
              colorListVisible: false,
              liveCanvasStyle: '',
              zoomSlider: ZOOM_SLIDER_MIN,
              zoomLabel: '100%',
              statsText: '',
              colorRows: [],
              beadTotal: 0,
            });
          },
        });
      },
    });
  },

  markParamsDirty() {
    if (!this.data.hasGrid || this.data.paramsDirty) return;
    this.setData({ paramsDirty: true });
  },

  onGridPreset(e) {
    const v = Number((e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.v) || 0);
    if (!v) return;
    this.setData({ gridSize: v });
    this.markParamsDirty();
  },

  onGridSlider(e) {
    const v = Number(
      (e.detail && (e.detail.value != null ? e.detail.value : e.detail)) || this.data.gridSize,
    );
    this.setData({ gridSize: v });
    this.markParamsDirty();
  },

  onMode(e) {
    const id = e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id;
    if (!id || id === this.data.mode) return;
    this.setData({ mode: id });
    this.markParamsDirty();
  },

  onAlgo(e) {
    const id = e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id;
    if (!id || id === this.data.algo) return;
    this.setData({ algo: id });
    this.markParamsDirty();
  },

  onMergeMode(e) {
    const id = e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id;
    if (!id) return;
    this.setData({ mergeMode: id }, () => {
      setTimeout(() => {
        try {
          const sel = id === 'kmeans' ? '#mergeKSlider' : '#mergeMinSlider';
          const s = this.selectComponent(sel);
          if (s && typeof s.init === 'function') s.init();
        } catch (err) {
          /* ignore */
        }
      }, 80);
    });
  },

  onMergeMinCount(e) {
    const v = Number(
      (e.detail && (e.detail.value != null ? e.detail.value : e.detail)) || this.data.mergeMinCount,
    );
    this.setData({ mergeMinCount: Math.max(1, Math.min(32, v)) });
  },

  onMergeK(e) {
    const v = Number(
      (e.detail && (e.detail.value != null ? e.detail.value : e.detail)) || this.data.mergeK,
    );
    this.setData({ mergeK: Math.max(2, Math.min(80, v)) });
  },

  onRemoveBg(e) {
    const next = !!(e && e.detail && e.detail.value);
    this.setData({ removeBg: next });
    this.markParamsDirty();
  },

  onPreviewKind(e) {
    const kind = e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.kind;
    if (!kind || !this.data.hasGrid || kind === this.data.previewKind) return;
    this.setData({ previewKind: kind }, () => this.drawLive(false));
  },

  ensureLiveCanvas() {
    return new Promise((resolve, reject) => {
      if (this._liveCanvas && this._liveCtx) {
        resolve({ canvas: this._liveCanvas, ctx: this._liveCtx });
        return;
      }
      const q = this.createSelectorQuery();
      q.select('#beadLive')
        .fields({ node: true, size: true })
        .exec((res) => {
          const canvas = res && res[0] && res[0].node;
          if (!canvas) {
            reject(new Error('预览画布不可用'));
            return;
          }
          const ctx = canvas.getContext('2d');
          this._liveCanvas = canvas;
          this._liveCtx = ctx;
          resolve({ canvas, ctx, width: res[0].width, height: res[0].height });
        });
    });
  },

  minLiveZoom() {
    const live = this._live;
    return Math.max(0.08, live.fitZoom || 0.08);
  },

  clampLiveZoom(zoom) {
    const zMin = this.minLiveZoom();
    return Math.max(zMin, Math.min(LIVE_ZOOM_MAX, zoom));
  },

  syncZoomSliderUi(zoom) {
    const fit = this.minLiveZoom();
    const pct = Math.round((zoom / fit) * 100);
    this.setData({
      zoomSlider: Math.max(ZOOM_SLIDER_MIN, Math.min(ZOOM_SLIDER_MAX, pct)),
      zoomLabel: `${pct}%`,
    });
  },

  syncLiveCanPan() {
    const live = this._live;
    let canPan = false;
    if (live && this.data.hasGrid && this._W && this._H && live.cssW && live.cssH) {
      const cell = LIVE_BASE_CELL * live.zoom;
      canPan =
        this._W * cell > live.cssW + 1.5 || this._H * cell > live.cssH + 1.5;
    }
    if (canPan !== this.data.liveCanPan) {
      this.setData({ liveCanPan: canPan });
    }
  },

  setLiveZoom(nextZoom, anchorX, anchorY) {
    const live = this._live;
    if (!live || !live.cssW) return;
    const z0 = live.zoom || this.minLiveZoom();
    const z1 = this.clampLiveZoom(nextZoom);
    if (!(z0 > 0)) return;
    const cx = anchorX != null ? anchorX : live.cssW / 2;
    const cy = anchorY != null ? anchorY : live.cssH / 2;
    const k = z1 / z0;
    live.zoom = z1;
    live.tx = cx - (cx - live.tx) * k;
    live.ty = cy - (cy - live.ty) * k;
    this.clampLive();
    this.syncLiveCanPan();
  },

  clampLive() {
    const live = this._live;
    const W = this._W;
    const H = this._H;
    if (!W || !H || !live.cssW || !live.cssH) return;
    live.zoom = this.clampLiveZoom(live.zoom);
    const cell = LIVE_BASE_CELL * live.zoom;
    const contentW = W * cell;
    const contentH = H * cell;
    // 1.5px 容差：100% 比例对齐时锁死居中，避免浮点误差还能上下拖
    const eps = 1.5;
    if (contentW <= live.cssW + eps) {
      live.tx = (live.cssW - contentW) / 2;
    } else {
      live.tx = Math.min(0, Math.max(live.cssW - contentW, live.tx));
    }
    if (contentH <= live.cssH + eps) {
      live.ty = (live.cssH - contentH) / 2;
    } else {
      live.ty = Math.min(0, Math.max(live.cssH - contentH, live.ty));
    }
  },

  queryLiveRect() {
    return new Promise((resolve) => {
      this.createSelectorQuery()
        .select('#beadLiveWrap')
        .boundingClientRect()
        .exec((res) => resolve((res && res[0]) || null));
    });
  },

  async ensureLiveColorCache() {
    if (this._liveColorCanvas || !this._grid || !this._W || !this._H) return;
    try {
      const canvas = await new Promise((resolve, reject) => {
        this.createSelectorQuery()
          .select('#beadLiveCache')
          .fields({ node: true, size: true })
          .exec((res) => {
            const node = res && res[0] && res[0].node;
            if (!node) reject(new Error('cache'));
            else resolve(node);
          });
      });
      this._liveColorCanvas = buildLiveColorCanvas(canvas, this._grid, this._W, this._H);
    } catch (e) {
      this._liveColorCanvas = null;
    }
  },

  async resetLiveView() {
    if (!this.data.hasGrid || !this._grid || !this._W || !this._H) return;
    this._zoomInteracting = false;
    await new Promise((r) => setTimeout(r, 32));
    try {
      let rect = await this.queryLiveRect();
      if (!rect || !rect.width) return;

      // 高度严格跟格网比例，不封顶裁切，100% 时刚好铺满、不能拖
      let cssW = rect.width;
      let cssH = Math.max(120, Math.round((cssW * this._H) / this._W));

      await new Promise((resolve) => {
        this.setData({ liveCanvasStyle: `height:${cssH}px;` }, resolve);
      });
      await new Promise((r) => setTimeout(r, 32));

      this._liveCanvas = null;
      this._liveCtx = null;
      this._liveColorCanvas = null;
      const { canvas, ctx } = await this.ensureLiveCanvas();
      await this.ensureLiveColorCache();
      rect = await this.queryLiveRect();
      if (!rect || !rect.width || !rect.height) return;
      this._liveRect = rect;

      let dpr = 2;
      try {
        dpr = (wx.getWindowInfo && wx.getWindowInfo().pixelRatio) || wx.getSystemInfoSync().pixelRatio || 2;
      } catch (e) {
        dpr = 2;
      }
      dpr = Math.min(3, Math.max(2, dpr));
      cssW = rect.width;
      cssH = rect.height;
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (typeof ctx.imageSmoothingEnabled === 'boolean') ctx.imageSmoothingEnabled = false;

      // contain：宽高已按比例，fitW≈fitH，100% 内容与画布一致
      const fitZoom = Math.min(
        LIVE_ZOOM_MAX,
        cssW / (this._W * LIVE_BASE_CELL),
      );
      this._live = {
        tx: 0,
        ty: 0,
        zoom: fitZoom,
        fitZoom,
        cssW,
        cssH,
        dpr,
      };
      this.clampLive();
      this.syncZoomSliderUi(fitZoom);
      this.syncLiveCanPan();
      this.drawLive(false);
    } catch (e) {
      /* ignore */
    }
  },

  scheduleLiveRedraw(draft) {
    this._pendingDraft = draft === true;
    if (this._redrawRaf) return;
    const raf = typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : (fn) => setTimeout(fn, 16);
    this._redrawRaf = raf(() => {
      this._redrawRaf = null;
      const useDraft = this._pendingDraft;
      this.drawLive(useDraft);
      // 交互结束后补一帧带色号的高清，避免草稿态卡住
      if (useDraft) {
        if (this._hqTimer) clearTimeout(this._hqTimer);
        this._hqTimer = setTimeout(() => {
          this._hqTimer = null;
          if (this._zoomInteracting || this._gest) return;
          this._pendingDraft = false;
          this.drawLive(false);
        }, 120);
      }
    });
  },

  drawLive(draft) {
    if (!this._grid || !this._liveCtx || !this.data.hasGrid) return;
    const live = this._live;
    if (!live.cssW || !live.cssH) return;
    this.clampLive();
    // 只认显式 draft，避免 _zoomInteracting 卡死导致色号一直不画
    const useDraft = draft === true && !!this._liveColorCanvas;
    paintLiveViewport(this._liveCtx, this._grid, this._W, this._H, {
      cssW: live.cssW,
      cssH: live.cssH,
      tx: live.tx,
      ty: live.ty,
      zoom: live.zoom,
      baseCell: LIVE_BASE_CELL,
      mode: this.data.previewKind === 'pixel' ? 'pixel' : 'chart',
      draft: useDraft,
      colorCanvas: this._liveColorCanvas,
    });
  },

  finishLiveInteraction() {
    this._zoomInteracting = false;
    this._zoomDragging = false;
    this._gest = null;
    this._pendingDraft = false;
    if (this._hqTimer) {
      clearTimeout(this._hqTimer);
      this._hqTimer = null;
    }
    this.clampLive();
    this.drawLive(false);
  },

  onLiveTouchStart(e) {
    if (!this.data.hasGrid || this.data.busy || !this._live) return;
    const touches = e.touches || [];
    this.queryLiveRect().then((rect) => {
      if (rect) this._liveRect = rect;
    });
    if (touches.length >= 1) {
      this._gest = {
        mode: 'pan',
        x0: touches[0].clientX,
        y0: touches[0].clientY,
        tx0: this._live.tx,
        ty0: this._live.ty,
      };
    }
  },

  onLiveTouchMove(e) {
    const g = this._gest;
    if (!g || !this.data.hasGrid || g.mode !== 'pan') return;
    const touches = e.touches || [];
    if (!touches.length) return;
    const live = this._live;
    const cell = LIVE_BASE_CELL * live.zoom;
    const canPanX = this._W * cell > live.cssW + 1.5;
    const canPanY = this._H * cell > live.cssH + 1.5;
    if (!canPanX && !canPanY) return;
    if (canPanX) live.tx = g.tx0 + (touches[0].clientX - g.x0);
    if (canPanY) live.ty = g.ty0 + (touches[0].clientY - g.y0);
    this.scheduleLiveRedraw(true);
  },

  onLiveTouchEnd() {
    this.finishLiveInteraction();
  },

  parseSliderValue(e, fallback) {
    const raw = e && e.detail;
    if (raw == null) return Number(fallback) || 0;
    // change: detail 常为 { value }；dragend: 可能是 { value } 或直接数字
    if (typeof raw === 'number') return raw;
    if (raw.value != null) return Number(raw.value);
    return Number(fallback) || 0;
  },

  onZoomSliderStart() {
    // 仅拖动手柄会触发；点按轨道只有 change，没有 dragstart/dragend
    this._zoomDragging = true;
    this._zoomInteracting = true;
  },

  onZoomSliderDrag(e) {
    if (!this.data.hasGrid || !this._live) return;
    const pct = Math.max(
      ZOOM_SLIDER_MIN,
      Math.min(ZOOM_SLIDER_MAX, this.parseSliderValue(e, this.data.zoomSlider)),
    );
    this.setLiveZoom(this.minLiveZoom() * (pct / 100));
    // 受控滑条必须同步 value，否则会弹回 100%
    this.setData({
      zoomSlider: pct,
      zoomLabel: `${Math.round(pct)}%`,
    });
    if (this._zoomDragging) {
      // 拖动中：草稿预览（无色号），松手再画高清
      this._zoomInteracting = true;
      this.scheduleLiveRedraw(true);
      return;
    }
    // 点按轨道：只有 change，直接高清重绘，避免一直停在草稿态看不到色号
    this.finishLiveInteraction();
  },

  onZoomSlider(e) {
    if (!this.data.hasGrid || !this._live) return;
    const pct = Math.max(
      ZOOM_SLIDER_MIN,
      Math.min(ZOOM_SLIDER_MAX, this.parseSliderValue(e, this.data.zoomSlider)),
    );
    this._zoomDragging = false;
    this.setLiveZoom(this.minLiveZoom() * (pct / 100));
    this.syncZoomSliderUi(this._live.zoom);
    this.finishLiveInteraction();
  },

  /** 画布左缘护栏：仅吞画布区域侧滑，不挡缩放按钮 */
  onEdgeGuardTouch() {},

  onZoomStep(e) {
    if (!this.data.hasGrid || this.data.busy || !this._live) return;
    const delta = Number(
      (e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.delta) || 0,
    );
    if (!delta) return;
    const pct = Math.max(
      ZOOM_SLIDER_MIN,
      Math.min(ZOOM_SLIDER_MAX, (Number(this.data.zoomSlider) || ZOOM_SLIDER_MIN) + delta),
    );
    this.setLiveZoom(this.minLiveZoom() * (pct / 100));
    this.syncZoomSliderUi(this._live.zoom);
    this.finishLiveInteraction();
  },

  resetPreviewZoom() {
    this.resetLiveView();
  },

  openMergePanel() {
    if (!this.data.hasGrid) return;
    this.setData({ mergeVisible: true }, () => {
      // popup 内滑条需重新 init，否则可能量不到宽度
      setTimeout(() => {
        try {
          const a = this.selectComponent('#mergeMinSlider');
          const b = this.selectComponent('#mergeKSlider');
          if (a && typeof a.init === 'function') a.init();
          if (b && typeof b.init === 'function') b.init();
        } catch (err) {
          /* ignore */
        }
      }, 80);
    });
  },

  closeMergePanel() {
    this.setData({ mergeVisible: false });
  },

  onMergeVisibleChange(e) {
    const visible = !!(e && e.detail && e.detail.visible);
    this.setData({ mergeVisible: visible });
  },

  onExportScale(e) {
    const id = Number(e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id);
    if (!id) return;
    const opt = (this.data.scaleOptions || []).find((x) => x.id === id);
    if (opt && opt.vipOnly && !this.data.isVip) {
      wx.showModal({
        title: '超清仅会员可用',
        content: '开通包月会员后可导出超清 PNG。也可先用高清导出。',
        confirmText: '去我的',
        cancelText: '知道了',
        success: (res) => {
          if (res.confirm) this.goMyForPoints();
        },
      });
      return;
    }
    this.setData({ exportScale: id });
  },

  openColorList() {
    if (!this.data.hasGrid) return;
    this.setData({ colorListVisible: true });
  },

  onColorListVisibleChange(e) {
    const visible = !!(e && e.detail && e.detail.visible);
    this.setData({ colorListVisible: visible });
  },

  async onGenerate() {
    if (!this.data.imagePath || this.data.busy || this.data.gating) return;
    this.setData({ busy: true });
    try {
      await this.runGenerate();
    } catch (err) {
      const msg = (err && (err.message || err.errMsg)) || '生成失败';
      wx.showToast({ title: String(msg).slice(0, 20), icon: 'none' });
    } finally {
      this.setData({ busy: false });
    }
  },

  confirmModal({ title, content, confirmText, cancelText }) {
    return new Promise((resolve) => {
      wx.showModal({
        title: title || '提示',
        content: content || '',
        confirmText: confirmText || '确定',
        cancelText: cancelText || '取消',
        success: (r) => resolve(!!r.confirm),
        fail: () => resolve(false),
      });
    });
  },

  /** 参数已改时导出仍是当前预览图，先确认避免误会 */
  async confirmExportIfDirty() {
    if (!this.data.paramsDirty) return true;
    return this.confirmModal({
      title: '参数尚未重新生成',
      content: '格数 / 取色等已改，但还没重新生成。现在导出的仍是当前预览这版图纸。',
      confirmText: '仍要导出',
      cancelText: '先去生成',
    });
  },

  syncColorStats() {
    const rows = listColors(this._grid);
    let beadTotal = 0;
    rows.forEach((r) => {
      beadTotal += r.count;
    });
    const bgTip = this._removed ? ` · 已去背景` : '';
    return {
      colorRows: rows,
      beadTotal,
      statsText: `${this._W}×${this._H} 格 · ${rows.length} 色 · ${beadTotal} 颗豆${bgTip}`,
    };
  },

  async runGenerate() {
    const { canvas: off } = await queryNode(this, '#beadOff');
    const img = await loadImage(off, this.data.imagePath);
    const natW = img.width || this._natW;
    const natH = img.height || this._natH;
    if (!natW || !natH) throw new Error('无法读取图片尺寸');

    const gw = this.data.gridSize;
    const gh = Math.max(1, Math.round((gw * natH) / natW));
    const OFF_MAX = 4e6;
    let S = Math.max(2, Math.min(8, Math.round(natW / gw)));
    while (S > 2 && gw * S * gh * S > OFF_MAX) S -= 1;
    const ow = gw * S;
    const oh = gh * S;

    off.width = ow;
    off.height = oh;
    const octx = off.getContext('2d');
    octx.imageSmoothingEnabled = this.data.mode !== 'nearest';
    octx.clearRect(0, 0, ow, oh);
    octx.drawImage(img, 0, 0, ow, oh);
    const imageData = octx.getImageData(0, 0, ow, oh);

    const result = buildGrid(imageData.data, ow, oh, {
      gw,
      mode: this.data.mode,
      algo: this.data.algo,
      removeBg: this.data.removeBg,
      tol: 28,
    });

    this._grid = result.grid;
    this._W = result.W;
    this._H = result.H;
    this._removed = result.removed || 0;
    this._liveCanvas = null;
    this._liveCtx = null;
    this._liveColorCanvas = null;

    const hadExportUnlock = !!this.data.exportUnlocked;
    const hadAdvancedUnlock = !!this.data.advancedUnlocked;
    const hadAdvancedApplied = !!this.data.advancedApplied;
    const stats = this.syncColorStats();
    this.setData(
      {
        hasGrid: true,
        paramsDirty: false,
        exportUnlocked: false,
        advancedUnlocked: false,
        advancedApplied: false,
        previewKind: 'chart',
        ...stats,
      },
      () => {
        this.resetLiveView();
        if (hadExportUnlock || hadAdvancedUnlock || hadAdvancedApplied) {
          setTimeout(() => {
            const bits = [];
            if (hadExportUnlock) bits.push('导出解锁');
            if (hadAdvancedApplied) bits.push('合并 / 去杂色效果');
            else if (hadAdvancedUnlock) bits.push('高级功能解锁');
            wx.showModal({
              title: '本版解锁已重置',
              content:
                `重新生成后，${bits.join('、')}已失效。` +
                (hadAdvancedApplied
                  ? '若还要精简色号，请重新打开「高级 · 色号合并」并再次解锁。'
                  : '需要导出或高级功能时请再解锁一次。'),
              showCancel: false,
              confirmText: '知道了',
            });
          }, 400);
        }
      },
    );
  },

  goMyForPoints() {
    wx.switchTab({ url: '/pages/my/index' });
  },

  async ensureExportUnlocked() {
    if (this.data.exportUnlocked) return true;
    if (this._exportUnlockPromise) return this._exportUnlockPromise;
    if (this._advancedUnlockPromise || this.data.gating) {
      wx.showToast({ title: '请稍候', icon: 'none' });
      return false;
    }
    this._exportUnlockPromise = (async () => {
      this.setData({ gating: true });
      try {
        // 解锁过程中若已重新生成，丢弃本次结果
        const genToken = this._grid;
        const res = await unlockBeadAccess('export', { page: this });
        if (res && res.message === 'go_my') this.goMyForPoints();
        if (!res || !res.ok) return false;
        if (this._grid !== genToken || !this.data.hasGrid) {
          wx.showToast({ title: '图纸已更新，请重新解锁', icon: 'none' });
          return false;
        }
        this.setData({ exportUnlocked: true });
        return true;
      } finally {
        this.setData({ gating: false });
        this._exportUnlockPromise = null;
      }
    })();
    return this._exportUnlockPromise;
  },

  async ensureAdvancedUnlocked() {
    if (this.data.advancedUnlocked) return true;
    if (this._advancedUnlockPromise) return this._advancedUnlockPromise;
    if (this._exportUnlockPromise || this.data.gating) {
      wx.showToast({ title: '请稍候', icon: 'none' });
      return false;
    }
    this._advancedUnlockPromise = (async () => {
      this.setData({ gating: true });
      try {
        const genToken = this._grid;
        const res = await unlockBeadAccess('advanced', { page: this });
        if (res && res.message === 'go_my') this.goMyForPoints();
        if (!res || !res.ok) return false;
        if (this._grid !== genToken || !this.data.hasGrid) {
          wx.showToast({ title: '图纸已更新，请重新解锁', icon: 'none' });
          return false;
        }
        this.setData({ advancedUnlocked: true });
        return true;
      } finally {
        this.setData({ gating: false });
        this._advancedUnlockPromise = null;
      }
    })();
    return this._advancedUnlockPromise;
  },

  async refreshAfterGridEdit() {
    this._liveColorCanvas = null;
    await this.ensureLiveColorCache();
    const stats = this.syncColorStats();
    this.setData({ ...stats, advancedApplied: true }, () => this.drawLive(false));
  },

  async onMerge() {
    if (!this._grid || this.data.busy || this.data.gating) return;
    const unlocked = await this.ensureAdvancedUnlocked();
    if (!unlocked) return;
    if (this.data.paramsDirty) {
      const go = await this.confirmModal({
        title: '参数尚未重新生成',
        content: '合并会作用在当前预览图纸上（不是改完参数后的新图）。',
        confirmText: '继续合并',
        cancelText: '取消',
      });
      if (!go) return;
    }
    this.setData({ busy: true, exporting: 'merge' });
    try {
      let changed = 0;
      if (this.data.mergeMode === 'kmeans') {
        changed = mergeKmeans(this._grid, this.data.mergeK, this.data.algo);
      } else {
        changed = mergeSimilarity(this._grid, this.data.mergeMinCount, this.data.algo);
      }
      await this.refreshAfterGridEdit();
      wx.showToast({
        title: changed ? `合并 ${changed} 格` : '无需合并',
        icon: 'none',
      });
    } catch (err) {
      wx.showToast({ title: '合并失败', icon: 'none' });
    } finally {
      this.setData({ busy: false, exporting: '' });
    }
  },

  async onRemoveStray() {
    if (!this._grid || this.data.busy || this.data.gating) return;
    const unlocked = await this.ensureAdvancedUnlocked();
    if (!unlocked) return;
    if (this.data.paramsDirty) {
      const go = await this.confirmModal({
        title: '参数尚未重新生成',
        content: '去杂色会作用在当前预览图纸上（不是改完参数后的新图）。',
        confirmText: '继续清理',
        cancelText: '取消',
      });
      if (!go) return;
    }
    this.setData({ busy: true, exporting: 'stray' });
    try {
      const changed = removeStray(this._grid, this._W, this._H, this.data.algo);
      await this.refreshAfterGridEdit();
      wx.showToast({
        title: changed ? `清理 ${changed} 个杂点` : '没有杂点',
        icon: 'none',
      });
    } catch (err) {
      wx.showToast({ title: '清理失败', icon: 'none' });
    } finally {
      this.setData({ busy: false, exporting: '' });
    }
  },

  async exportChartPng(scale) {
    const W = this._W;
    const H = this._H;
    const exportScale = scale != null ? scale : this.resolveExportScale();
    const cell = exportCellSize(W, H, exportScale);
    const pad = Math.max(24, Math.round(cell * 0.6));
    const showLabel = cell >= 10;
    const title = `拼豆图纸 ${W}×${H} 共 ${W * H} 颗${showLabel ? '' : ' （格过小，色号见清单）'}`;
    const titleBand = Math.max(28, Math.round(cell * 0.7));
    const cw = W * cell + pad * 2;
    const ch = H * cell + pad * 2 + titleBand;
    const { canvas } = await queryNode(this, '#beadOut');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d');
    if (typeof ctx.imageSmoothingEnabled === 'boolean') ctx.imageSmoothingEnabled = false;
    const painted = paintPattern(ctx, this._grid, W, H, cell, {
      showCode: true,
      showGrid: true,
      pad,
      title,
    });
    return canvasToPng(canvas, painted.width || cw, painted.height || ch);
  },

  async exportPixelPng(scale) {
    const W = this._W;
    const H = this._H;
    const { canvas: pix } = await queryNode(this, '#beadPixel');
    pix.width = W;
    pix.height = H;
    const pctx = pix.getContext('2d');
    paintPixelMap(pctx, this._grid, W, H);

    const exportScale = scale != null ? scale : this.resolveExportScale();
    const px = pixelScale(W, H, exportScale);
    const pw = W * px;
    const ph = H * px;
    const { canvas: out } = await queryNode(this, '#beadOut');
    out.width = pw;
    out.height = ph;
    const octx = out.getContext('2d');
    octx.imageSmoothingEnabled = false;
    octx.clearRect(0, 0, pw, ph);
    octx.drawImage(pix, 0, 0, pw, ph);
    return canvasToPng(out, pw, ph);
  },

  async exportColorListPng(scale) {
    const rows =
      this.data.colorRows && this.data.colorRows.length
        ? this.data.colorRows
        : listColors(this._grid);
    if (!rows.length) throw new Error('暂无色号');
    const exportScale = scale != null ? scale : this.resolveExportScale();
    const layout = measureColorList(rows, exportScale);
    const { canvas } = await queryNode(this, '#beadOut');
    canvas.width = layout.width;
    canvas.height = layout.height;
    const ctx = canvas.getContext('2d');
    paintColorList(ctx, rows, {
      scale: exportScale,
      title: `色号清单 ${this._W}×${this._H}`,
      subtitle: `共 ${rows.length} 色 · ${this.data.beadTotal || 0} 颗豆`,
    });
    return canvasToPng(canvas, layout.width, layout.height);
  },

  /** 同步解析可用清晰度，避免 setData 未落地时仍按超清导出 */
  resolveExportScale() {
    let scale = Number(this.data.exportScale) || 2;
    if (scale === 4 && !this.data.isVip) {
      scale = 2;
      if (this.data.exportScale !== 2) {
        this.setData({ exportScale: 2 });
        wx.showToast({ title: '超清仅会员可用，已改为高清', icon: 'none' });
      }
    }
    return scale;
  },

  async onSaveChart() {
    if (!this._grid || this.data.busy || this.data.gating) return;
    const unlocked = await this.ensureExportUnlocked();
    if (!unlocked) return;
    if (!(await this.confirmExportIfDirty())) return;
    const scale = this.resolveExportScale();
    this.setData({ busy: true, exporting: 'chart' });
    try {
      const path = await this.exportChartPng(scale);
      await saveAlbum(path);
      wx.showToast({ title: '色号图已保存', icon: 'success' });
    } catch (err) {
      const msg = (err && (err.message || err.errMsg)) || '';
      if (!/相册权限/.test(msg)) wx.showToast({ title: '保存失败', icon: 'none' });
    } finally {
      this.setData({ busy: false, exporting: '' });
    }
  },

  async onSaveColorList() {
    if (!this._grid || this.data.busy || this.data.gating) return;
    const unlocked = await this.ensureExportUnlocked();
    if (!unlocked) return;
    if (!(await this.confirmExportIfDirty())) return;
    const scale = this.resolveExportScale();
    this.setData({ busy: true, exporting: 'list' });
    try {
      const path = await this.exportColorListPng(scale);
      await saveAlbum(path);
      wx.showToast({ title: '清单已保存', icon: 'success' });
    } catch (err) {
      const msg = (err && (err.message || err.errMsg)) || '';
      if (!/相册权限/.test(msg)) wx.showToast({ title: '保存失败', icon: 'none' });
    } finally {
      this.setData({ busy: false, exporting: '' });
    }
  },

  async onSavePixel() {
    if (!this._grid || this.data.busy || this.data.gating) return;
    const unlocked = await this.ensureExportUnlocked();
    if (!unlocked) return;
    if (!(await this.confirmExportIfDirty())) return;
    const scale = this.resolveExportScale();
    this.setData({ busy: true, exporting: 'pixel' });
    try {
      const path = await this.exportPixelPng(scale);
      await saveAlbum(path);
      wx.showToast({ title: '像素图已保存', icon: 'success' });
    } catch (err) {
      const msg = (err && (err.message || err.errMsg)) || '';
      if (!/相册权限/.test(msg)) wx.showToast({ title: '保存失败', icon: 'none' });
    } finally {
      this.setData({ busy: false, exporting: '' });
    }
  },

  async onSaveSvg() {
    if (!this._grid || this.data.busy || this.data.gating) return;
    const unlocked = await this.ensureExportUnlocked();
    if (!unlocked) return;
    if (!(await this.confirmExportIfDirty())) return;
    this.setData({ busy: true, exporting: 'svg' });
    try {
      const { svg, withCodes } = buildSvg(this._grid, this._W, this._H);
      const name = `拼豆图纸_${this._W}x${this._H}.svg`;
      const filePath = `${wx.env.USER_DATA_PATH}/${name}`;
      const fs = wx.getFileSystemManager();
      await new Promise((resolve, reject) => {
        fs.writeFile({
          filePath,
          data: svg,
          encoding: 'utf8',
          success: resolve,
          fail: reject,
        });
      });

      const tip = withCodes ? '含色号' : '格多已省略色号';
      const shareSvg = () => {
        if (typeof wx.shareFileMessage === 'function') {
          wx.shareFileMessage({
            filePath,
            fileName: name,
            fail: () => wx.showToast({ title: '分享失败，可复制路径', icon: 'none' }),
          });
          return;
        }
        wx.showToast({ title: '当前版本不支持分享文件', icon: 'none' });
      };
      const copyPath = () => {
        wx.setClipboardData({
          data: filePath,
          success: () => wx.showToast({ title: `路径已复制（${tip}）`, icon: 'none' }),
        });
      };
      if (typeof wx.showActionSheet !== 'function') {
        shareSvg();
        return;
      }
      wx.showActionSheet({
        itemList: ['发给微信好友', '复制文件路径'],
        success: (res) => {
          if (res.tapIndex === 0) shareSvg();
          else if (res.tapIndex === 1) copyPath();
        },
        fail: () => shareSvg(),
      });
    } catch (err) {
      wx.showToast({ title: 'SVG 导出失败', icon: 'none' });
    } finally {
      this.setData({ busy: false, exporting: '' });
    }
  },
});
