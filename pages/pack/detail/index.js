import { callFunction } from '~/utils/cloud';
import {
  downloadOne as downloadOneShared,
  formatBatchResultTip,
  runBatchDownload,
} from '~/utils/batchDownload';
import {
  forgetTempUrl,
  packCoverCacheKey,
  packPreviewCacheKey,
  packSlotCacheKey,
  peekTempUrl,
  rememberTempUrl,
  reuseTempUrl,
} from '~/utils/tempUrlCache';
import {
  canAttemptDownload,
  estimateBatchAffordable,
  formatEntitlementHint,
  getCachedEntitlement,
  setCachedEntitlement,
  spendablePoints,
} from '~/utils/entitlement';
import {
  applyDownloadCostsFromSettings,
  downloadCost,
  resolveDownloadCostKey,
} from '~/utils/pricing';
import {
  formatItemCount,
  isEmojiType,
  normalizeContentType,
  contentTypeColorStyle,
  contentTypeIconSrc,
  contentTypeLabel,
} from '~/utils/contentType';
import { resolveIsAdmin } from '~/utils/auth';
import { applyThemeToPage, getThemeBrand, getThemeStyle } from '~/utils/theme';
import { getFestivalConfettiColors } from '~/utils/festival';
import { getWindowInfoSafe } from '~/utils/systemInfo';
import { resolveWaterfallColumns } from '~/utils/waterfallColumns';
import { getFavoriteCached, queueFavorite, rememberFavorite } from '~/utils/favoriteQueue';
import { shareAppMessage, shareTimeline } from '~/utils/share';
import {
  buildSaveAdPrompt,
  defaultSaveAdRewardPoints,
  fetchAdRewardStatus,
  formatAdClaimToast,
  isSaveAdRewardEnabled,
  watchAdAndClaimPoints,
} from '~/utils/adReward';
import {
  getNativePackDetailAdUnitId,
  getNativePackRecommendAdUnitId,
  shouldShowNativeAds,
} from '~/utils/nativeAd';
import { showPointsReward } from '~/utils/pointsReward';

function calcSwiperHeight() {
  try {
    const { windowWidth } = getWindowInfoSafe();
    return Math.max(240, Math.round(windowWidth));
  } catch (e) {
    return 375;
  }
}

/**
 * 推荐卡宽跟显示设置列数走；略收窄并露出下一张一截，暗示可横滑。
 * 高度不拉齐，交给各卡 coverRatio 自然撑开。
 * 横版广告单独给宽卡 + 16:9，避免塞进竖卡方框被压扁。
 */
function calcRecommendLayout() {
  try {
    const { windowWidth } = getWindowInfoSafe();
    const columnCount = Math.max(1, resolveWaterfallColumns(windowWidth) || 2);
    const gap = 6;
    // 与区块左内边距（32rpx）对齐
    const sidePad = Math.max(12, Math.round((32 / 750) * windowWidth));
    // 露出下一张约 1/5 卡宽，让用户知道还能滑
    const peek = Math.max(36, Math.round(windowWidth * 0.11));
    const cardWidth = Math.floor(
      (windowWidth - sidePad - peek - gap * (columnCount - 1)) / columnCount,
    );
    const recommendCardWidth = Math.max(96, cardWidth);
    // 横版广告约两卡宽，高度按 16:9（模板常见比）
    const recommendAdWidth = Math.min(
      windowWidth - sidePad - peek,
      recommendCardWidth * 2 + gap,
    );
    const recommendAdHeight = Math.max(
      72,
      Math.round((recommendAdWidth * 9) / 16),
    );
    return {
      recommendCardWidth,
      recommendAdWidth,
      recommendAdHeight,
      recommendGap: gap,
      recommendColumns: columnCount,
    };
  } catch (e) {
    return {
      recommendCardWidth: 148,
      recommendAdWidth: 302,
      recommendAdHeight: 170,
      recommendGap: 6,
      recommendColumns: 2,
    };
  }
}

/**
 * 合集卡片之间插入卡片广告：每 2 个合集后插 1 条，最多 2 条。
 * @param {Array} packs
 * @param {{ showAd?: boolean }} [opts]
 */
function buildRecommendItems(packs, opts = {}) {
  const list = Array.isArray(packs) ? packs : [];
  const items = [];
  let adCount = 0;
  const allowAd = !!opts.showAd;
  list.forEach((pack, i) => {
    if (!pack || !pack._id) return;
    items.push({
      type: 'pack',
      key: pack._id,
      pack,
    });
    // 每 2 个合集后插广告；不贴在最后一张后面
    if (
      allowAd &&
      (i + 1) % 2 === 0 &&
      i + 1 < list.length &&
      adCount < 2
    ) {
      items.push({
        type: 'ad',
        key: `rec-ad-${adCount}`,
        hidden: false,
      });
      adCount += 1;
    }
  });
  return items;
}

function buildSaveLabel(
  slot,
  downloadReady,
  variant,
  hasAnimAny,
  canSaveStatic,
  adRewardReady,
  contentType = 'emoji',
) {
  if (!canSaveStatic) return adRewardReady ? '看广告' : '去兑换';
  if (isEmojiType(contentType) && hasAnimAny && variant === 'anim' && !slot.hasAnim) {
    return '无动态';
  }
  if (!downloadReady) return '积分不足';
  const costTip = `${downloadCost(resolveDownloadCostKey(contentType, variant))}积分`;
  if (!isEmojiType(contentType) || !hasAnimAny) return `保存 ·${costTip}`;
  if (variant === 'anim') return `动态 ·${costTip}`;
  return `静态 ·${costTip}`;
}

function isSlotSelectable(slot, downloadReady, variant) {
  if (!downloadReady) return false;
  if (variant === 'anim' && !slot.hasAnim) return false;
  return true;
}

/** 保存区只展示当前变体原图；未就绪不回落 preview，避免双倍 CDN */
function slotDisplayUrl(slot, variant) {
  if (!slot) return '';
  if (variant === 'anim') return slot.animUrl || '';
  return slot.staticUrl || '';
}

/** 视频槽海报（封面/预览图）；切勿把 mp4 临时链接塞进 image */
function slotPosterUrl(slot) {
  if (!slot) return '';
  return slot.previewUrl || slot.thumbUrl || slot.posterUrl || '';
}

function slotUrlPending(slot, variant) {
  if (!slot) return false;
  if (variant === 'anim') {
    if (!slot.hasAnim) return false;
    return !slot.animReady;
  }
  return !slot.staticReady;
}

/** 首屏一批；滚动后再补 */
const SLOT_URL_FIRST = 16;
const SLOT_URL_BATCH = 16;

function decorateSlots(
  slots,
  downloadReady,
  variant,
  hasAnimAny,
  canSaveStatic,
  adRewardReady,
  contentType = 'emoji',
) {
  return (slots || []).map((s) => {
    const selectable = isSlotSelectable(s, downloadReady, variant);
    const mediaKind = s.mediaKind || (contentType === 'video' ? 'video' : 'image');
    const fileUrl = slotDisplayUrl(s, variant);
    // 图片：展示原图；视频：海报用预览/封面，播放走 videoUrl
    const displayUrl = mediaKind === 'video' ? slotPosterUrl(s) : fileUrl;
    const videoUrl = mediaKind === 'video' ? s.staticUrl || '' : '';
    const prevUrl = s.displayUrl || '';
    const imgReady = displayUrl && displayUrl === prevUrl ? !!s.imgReady : false;
    const urlPending = slotUrlPending(s, variant);
    return {
      ...s,
      hasAnim: !!s.hasAnim,
      mediaKind,
      staticReady: !!s.staticReady,
      animReady: !!s.animReady,
      selectable,
      selected: selectable && !!s.selected,
      displayUrl,
      videoUrl,
      urlPending,
      imgReady,
      saveLabel: buildSaveLabel(
        s,
        downloadReady,
        variant,
        hasAnimAny,
        canSaveStatic,
        adRewardReady,
        contentType,
      ),
    };
  });
}

function summarizeSelection(slots, variant, contentType = 'emoji') {
  const list = slots || [];
  const selected = list.filter((s) => s.selected);
  const selectable = list.filter((s) => s.selectable);
  const cost = downloadCost(resolveDownloadCostKey(contentType, variant));
  return {
    selectedCount: selected.length,
    selectedCost: selected.length * cost,
    allSelected: selectable.length > 0 && selected.length === selectable.length,
    selectedIndexes: selected.map((s) => s.index),
  };
}

const CONFIRM_ICONS = {
  save: '/static/emoji/save.png',
  warn: '/static/emoji/warn.png',
  ok: '/static/emoji/ok.png',
  static: '/static/emoji/static.png',
  anim: '/static/emoji/anim.png',
};
Page({
  data: {
    packId: '',
    loading: true,
    saving: false,
    pack: null,
    emojiSlots: [],
    heroSlides: [],
    heroCurrent: 0,
    heroVideoPlaying: false,
    swiperHeight: calcSwiperHeight(),
    viewerVisible: false,
    viewerImages: [],
    viewerIndex: 0,
    viewerImageProps: {
      mode: 'aspectFit',
      lazy: true,
    },
    downloadReady: false,
    canSaveStatic: false,
    isVip: false,
    costHint: '',
    entitlementHint: '',
    hasAnimAny: false,
    showVariantToggle: false,
    contentType: 'emoji',
    contentTypeName: '表情',
    contentTypeIconSrc: contentTypeIconSrc('emoji'),
    contentTypeColorStyle: contentTypeColorStyle('emoji'),
    itemCountText: '',
    saveSectionTitle: '保存原图',
    costStatic: downloadCost('static'),
    costAnim: downloadCost('anim'),
    downloadVariant: 'static',
    selectedCount: 0,
    selectedCost: 0,
    allSelected: false,
    isAdmin: false,
    staticDriveUrl: '',
    animDriveUrl: '',
    favorited: false,
    redeemVisible: false,
    redeemCode: '',
    redeeming: false,
    adRewardReady: false,
    adRewardPoints: defaultSaveAdRewardPoints(),
    adRewardLeftToday: 0,
    adRewardHint: '',
    nativeAdUnitId: getNativePackDetailAdUnitId(),
    showNativeAd: false,
    recommendAdUnitId: getNativePackRecommendAdUnitId(),
    showRecommendAd: false,
    confirmVisible: false,
    confirmTitle: '',
    confirmContent: '',
    confirmIcon: '',
    confirmOkText: '继续',
    themeStyle: '',
    themeBrand: '',
    recommendList: [],
    recommendItems: [],
    recommendLoading: false,
    recommendCardWidth: 148,
    recommendAdWidth: 302,
    recommendAdHeight: 170,
    recommendGap: 6,
    recommendColumns: 2,
  },

  _confirmResolve: null,

  onLoad(options) {
    const packId = options.id || '';
    const recommendLayout = calcRecommendLayout();
    this.setData({
      packId,
      swiperHeight: calcSwiperHeight(),
      isAdmin: resolveIsAdmin(),
      themeStyle: getThemeStyle(),
      themeBrand: getThemeBrand(),
      ...recommendLayout,
    });
    this.refreshEntitlementUi();
    this._onAdminViewChange = () => {
      this.applyAdminView();
      this.refreshEntitlementUi();
    };
    this._onFavoriteChange = (payload) => this.applyFavoriteChange(payload);
    this._onWaterfallColumnsChange = () => {
      this.setData(calcRecommendLayout());
    };
    try {
      const app = getApp();
      if (app && app.eventBus) {
        app.eventBus.on('adminViewChange', this._onAdminViewChange);
        app.eventBus.on('favoriteChange', this._onFavoriteChange);
        app.eventBus.on('waterfallColumnsChange', this._onWaterfallColumnsChange);
      }
    } catch (e) {
      /* ignore */
    }
    if (packId) this.loadDetail(packId);
  },

  onUnload() {
    this._slotUrlSeq = (this._slotUrlSeq || 0) + 1;
    try {
      const app = getApp();
      if (app && app.eventBus) {
        if (this._onAdminViewChange) app.eventBus.off('adminViewChange', this._onAdminViewChange);
        if (this._onFavoriteChange) app.eventBus.off('favoriteChange', this._onFavoriteChange);
        if (this._onWaterfallColumnsChange) {
          app.eventBus.off('waterfallColumnsChange', this._onWaterfallColumnsChange);
        }
      }
    } catch (e) {
      /* ignore */
    }
  },

  onShow() {
    applyThemeToPage(this);
    this.applyAdminView();
    this.refreshEntitlementUi();
    this.syncEntitlement();
    this.refreshFavorite();
    this.setData(calcRecommendLayout());
  },

  applyAdminView() {
    const admin = resolveIsAdmin();
    const pack = this.data.pack || {};
    this.setData({
      isAdmin: admin,
      staticDriveUrl: admin ? pack.staticDriveUrl || '' : '',
      animDriveUrl: admin ? pack.animDriveUrl || '' : '',
    });
  },

  async refreshFavorite() {
    const packId = this.data.packId;
    if (!packId) return;
    const cached = getFavoriteCached(packId);
    if (cached !== undefined) {
      if (this.data.favorited !== cached) this.setData({ favorited: cached });
      return;
    }
    try {
      const res = await callFunction('userFavorite', { action: 'status', packId });
      const favorited = !!(res.data && res.data.favorited);
      rememberFavorite(packId, favorited);
      if (this.data.favorited !== favorited) {
        this.setData({ favorited });
      }
    } catch (e) {
      /* 云函数未部署时不影响详情 */
    }
  },

  playHeartBurst(e, mode) {
    const burst = this.selectComponent('#heartBurst');
    if (!burst || typeof burst.burst !== 'function') return;
    if (typeof burst.burstFromEvent === 'function') {
      const t =
        (e && e.touches && e.touches[0]) ||
        (e && e.changedTouches && e.changedTouches[0]);
      const d = e && e.detail;
      if ((t && typeof t.clientX === 'number') || (d && typeof d.x === 'number' && (d.x || d.y))) {
        burst.burstFromEvent(e, { mode });
        return;
      }
    }
    this.createSelectorQuery()
      .select('.detail__fav-wrap')
      .boundingClientRect((rect) => {
        if (rect) {
          burst.burst({
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
            mode,
          });
          return;
        }
        burst.burst({ mode });
      })
      .exec();
  },

  applyFavoriteChange(payload) {
    const packId = payload && payload.packId;
    if (!packId || packId !== this.data.packId) return;
    if (typeof payload.favorited !== 'boolean') return;
    if (this.data.favorited === payload.favorited) return;
    this.setData({ favorited: payload.favorited });
  },

  onToggleFavorite(e) {
    const packId = this.data.packId;
    if (!packId) return;
    const favorited = !this.data.favorited;
    this.setData({ favorited });
    this.playHeartBurst(e, favorited ? 'in' : 'out');
    queueFavorite(packId, favorited);
  },

  /** 分享给好友 / 点「分享」按钮 */
  onShareAppMessage() {
    const { pack, packId } = this.data;
    const title = (pack && pack.title) || '趣图铺子合集';
    return shareAppMessage({
      title,
      path: `/pages/pack/detail/index?id=${packId || ''}`,
      imageUrl: pack && pack.coverUrl,
    });
  },

  /** 分享到朋友圈 */
  onShareTimeline() {
    const { pack, packId } = this.data;
    const title = (pack && pack.title) || '趣图铺子合集';
    return shareTimeline({
      title,
      query: `id=${packId || ''}`,
      imageUrl: pack && pack.coverUrl,
    });
  },

  applySlots(slots) {
    const { downloadVariant, contentType } = this.data;
    const summary = summarizeSelection(slots, downloadVariant, contentType);
    this.setData({
      emojiSlots: slots,
      selectedCount: summary.selectedCount,
      selectedCost: summary.selectedCost,
      allSelected: summary.allSelected,
    });
  },

  refreshEntitlementUi() {
    const entitlement = getCachedEntitlement();
    const { emojiSlots, downloadVariant, hasAnimAny, adRewardReady, contentType } =
      this.data;
    const baseKey = resolveDownloadCostKey(contentType, 'static');
    const costKey = resolveDownloadCostKey(contentType, downloadVariant);
    const canSaveStatic = canAttemptDownload(entitlement, baseKey);
    const downloadReady = canAttemptDownload(entitlement, costKey);
    const isVip = !!entitlement.isVip;
    const unitId = getNativePackDetailAdUnitId();
    const recommendAdUnitId = getNativePackRecommendAdUnitId();
    const showAds = shouldShowNativeAds();
    const showRecommendAd = !!recommendAdUnitId && showAds;
    const nextSlots = decorateSlots(
      emojiSlots,
      downloadReady,
      downloadVariant,
      hasAnimAny,
      canSaveStatic,
      adRewardReady,
      contentType,
    );
    const summary = summarizeSelection(nextSlots, downloadVariant, contentType);
    const patch = {
      downloadReady,
      canSaveStatic,
      isVip,
      costHint: '先扣本月额度，再扣积分',
      entitlementHint: formatEntitlementHint(entitlement),
      emojiSlots: nextSlots,
      selectedCount: summary.selectedCount,
      selectedCost: summary.selectedCost,
      allSelected: summary.allSelected,
      nativeAdUnitId: unitId,
      showNativeAd: !!unitId && showAds,
      recommendAdUnitId,
      showRecommendAd,
    };
    // VIP / 管理员状态变化时，重排推荐里的广告卡
    if (this.data.recommendList && this.data.recommendList.length) {
      patch.recommendItems = buildRecommendItems(this.data.recommendList, {
        showAd: showRecommendAd,
      });
    }
    this.setData(patch);
  },

  onNativeAdError() {
    this.setData({ showNativeAd: false });
  },

  onRecommendAdError(e) {
    const key =
      (e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.key) ||
      '';
    if (!key) return;
    const items = (this.data.recommendItems || []).map((it) =>
      it && it.key === key ? { ...it, hidden: true } : it,
    );
    this.setData({ recommendItems: items });
  },

  applyAdRewardStatus(status) {
    const enabled = !!(status && status.enabled);
    const leftToday = Math.max(0, Number(status && status.leftToday) || 0);
    const points = Math.max(
      0,
      Number(status && status.points) || defaultSaveAdRewardPoints(),
    );
    const adRewardReady =
      enabled && leftToday > 0 && isSaveAdRewardEnabled();
    const bal = spendablePoints();
    const unitCost = downloadCost(
      resolveDownloadCostKey(this.data.contentType || 'emoji', 'static'),
    );
    const shortfall = Math.max(0, unitCost - bal);
    const adRewardHint = !enabled || !isSaveAdRewardEnabled()
      ? ''
      : leftToday <= 0
        ? '今日看广告次数已用完'
        : shortfall > 0
          ? `当前 ${bal} 积分，还差 ${shortfall}；看广告每次 +${points}（今日还可 ${leftToday} 次）`
          : `看广告每次 +${points}（今日还可 ${leftToday} 次）`;
    this.setData({
      adRewardReady,
      adRewardPoints: points,
      adRewardLeftToday: leftToday,
      adRewardHint,
    });
    this.refreshEntitlementUi();
  },

  async refreshAdRewardStatus() {
    if (!isSaveAdRewardEnabled()) {
      this.applyAdRewardStatus({
        enabled: false,
        points: defaultSaveAdRewardPoints(),
        leftToday: 0,
      });
      return;
    }
    const status = await fetchAdRewardStatus('save');
    this.applyAdRewardStatus(status);
  },

  async syncEntitlement() {
    try {
      const res = await callFunction('userEntitlement', { action: 'get' });
      applyDownloadCostsFromSettings(res || {});
      if (res.entitlement) {
        setCachedEntitlement(res.entitlement);
      }
      if (res && res.saveAdReward) {
        this.applyAdRewardStatus(res.saveAdReward);
      } else {
        this.refreshEntitlementUi();
        this.refreshAdRewardStatus();
      }
    } catch (e) {
      /* ignore */
    }
  },

  buildHeroSlides(pack, slots = []) {
    const slides = [];
    const seen = {};
    const contentType = normalizeContentType(pack && pack.contentType);
    const pushImage = (url) => {
      if (!url || seen[url]) return;
      seen[url] = true;
      slides.push({ key: `img_${slides.length}`, type: 'image', url });
    };
    const pushVideo = (url) => {
      if (!url || seen[url]) return;
      seen[url] = true;
      slides.push({
        key: `video_${slides.length}`,
        type: 'video',
        url,
      });
    };
    pushImage(pack.coverUrl);
    pushVideo(pack.previewVideoUrl);
    (pack.previewUrls || []).forEach(pushImage);
    if (!pack.previewVideoUrl) {
      (pack.slots || []).forEach((s) => pushImage(s && s.previewUrl));
    }
    // 视频合集无独立预览视频时，用已换签的原视频作顶栏可播（与图片槽位展示原图一致）
    if (contentType === 'video' && !pack.previewVideoUrl) {
      (slots || []).forEach((s) => {
        if (s && s.staticUrl) pushVideo(s.staticUrl);
      });
    }
    return slides;
  },

  /** 视频槽位：系统预览播放（多段可左右滑） */
  previewSlotVideo(slot) {
    const currentUrl = (slot && (slot.videoUrl || slot.staticUrl)) || '';
    if (!currentUrl) {
      if (slot && !slot.staticReady) {
        wx.showToast({ title: '视频加载中', icon: 'none' });
        this.prefetchSlotUrls(this.data.packId, { limit: SLOT_URL_FIRST });
      } else {
        wx.showToast({ title: '暂无可播视频', icon: 'none' });
      }
      return;
    }
    const sources = (this.data.emojiSlots || [])
      .filter((s) => s && s.mediaKind === 'video' && (s.videoUrl || s.staticUrl))
      .map((s) => ({
        url: s.videoUrl || s.staticUrl,
        type: 'video',
        poster: slotPosterUrl(s) || '',
      }));
    if (!sources.length) return;
    const current = Math.max(
      0,
      sources.findIndex((s) => s.url === currentUrl),
    );
    // 关闭长按菜单 / 底栏下载，避免未扣积分就能保存原视频
    wx.previewMedia({
      sources,
      current,
      showmenu: false,
      showBottomActionBar: false,
      fail: () => {
        wx.showToast({ title: '无法播放该视频', icon: 'none' });
      },
    });
  },

  /** 拦截顶栏 video 长按系统菜单（保存/转发） */
  onHeroVideoLongPress() {
    /* no-op：catch 掉默认长按 */
  },

  pauseHeroVideoIfNeeded(current) {
    const slide = (this.data.heroSlides || [])[current];
    if (slide && slide.type === 'video') return;
    this.setData({ heroVideoPlaying: false });
    try {
      wx.createVideoContext('heroPreviewVideo', this).pause();
    } catch (e) {
      /* ignore */
    }
  },

  onHeroVideoPlay() {
    this.setData({ heroVideoPlaying: true });
  },

  onHeroVideoPause() {
    this.setData({ heroVideoPlaying: false });
  },

  onHeroVideoPlayTap() {
    try {
      wx.createVideoContext('heroPreviewVideo', this).play();
    } catch (e) {
      /* ignore */
    }
  },

  async loadDetail(packId) {
    this.setData({
      loading: true,
      heroSlides: [],
      heroCurrent: 0,
      heroVideoPlaying: false,
      recommendList: [],
      recommendItems: [],
    });
    try {
      const res = await callFunction('getPackDetail', { packId });
      const pack = res.data;
      if (pack && pack._id && pack.coverUrl) {
        pack.coverUrl = reuseTempUrl(packCoverCacheKey(pack._id), pack.coverUrl);
      }
      if (pack && pack._id && Array.isArray(pack.previewUrls)) {
        pack.previewUrls = pack.previewUrls.map((url, i) =>
          url ? reuseTempUrl(packPreviewCacheKey(pack._id, i), url) : '',
        );
      }
      const contentType = normalizeContentType(pack.contentType);
      const contentTypeName = pack.contentTypeName || contentTypeLabel(contentType);
      const hasAnimAny = isEmojiType(contentType) && !!pack.hasAnimAny;
      const showVariantToggle = hasAnimAny;
      const downloadVariant = 'static';
      const entitlement = getCachedEntitlement();
      const baseKey = resolveDownloadCostKey(contentType, 'static');
      const costKey = resolveDownloadCostKey(contentType, downloadVariant);
      const canSaveStatic = canAttemptDownload(entitlement, baseKey);
      const downloadReady = canAttemptDownload(entitlement, costKey);
      const isVip = !!entitlement.isVip;
      const defaultLabel =
        contentType === 'video' ? '视频' : contentType === 'avatar' ? '头像' : '原图';
      const rawSlots =
        pack.slots && pack.slots.length
          ? pack.slots
          : Array.from({ length: pack.emojiCount || 0 }, (_, i) => ({
              index: i,
              label: `${defaultLabel} ${i + 1}`,
              previewUrl: (pack.previewUrls || [])[i] || '',
              staticUrl: '',
              animUrl: '',
              pairKey: '',
              hasAnim: false,
              mediaKind: contentType === 'video' ? 'video' : 'image',
              staticReady: false,
              animReady: false,
            }));
      // 本地缓存仅作占位展示；不标记 Ready，仍走 prefetch 换新签，避免沿用失效链裂图
      const hydratedSlots = (rawSlots || []).map((s) => {
        const idx = s.index;
        const staticCached = peekTempUrl(packSlotCacheKey(packId, idx, 'static'));
        const animCached = peekTempUrl(packSlotCacheKey(packId, idx, 'anim'));
        return {
          ...s,
          mediaKind: s.mediaKind || (contentType === 'video' ? 'video' : 'image'),
          staticUrl: staticCached || s.staticUrl || '',
          animUrl: animCached || s.animUrl || '',
          staticReady: false,
          animReady: false,
        };
      });
      const emojiSlots = decorateSlots(
        hydratedSlots,
        downloadReady,
        downloadVariant,
        hasAnimAny,
        canSaveStatic,
        this.data.adRewardReady,
        contentType,
      );
      const summary = summarizeSelection(emojiSlots, downloadVariant, contentType);
      const heroSlides = this.buildHeroSlides(pack, emojiSlots);
      const itemCountText = formatItemCount(pack.emojiCount, contentType);
      const saveSectionTitle =
        contentType === 'video'
          ? '保存视频'
          : contentType === 'avatar'
            ? '保存头像'
            : contentType === 'wallpaper'
              ? '保存壁纸'
              : '保存原图';
      this._slotUrlPrefetching = false;
      this._lastPrefetchScroll = 0;
      this.setData({
        pack,
        emojiSlots,
        heroSlides,
        heroCurrent: 0,
        contentType,
        contentTypeName,
        contentTypeIconSrc: contentTypeIconSrc(contentType),
        contentTypeColorStyle: contentTypeColorStyle(contentType),
        itemCountText,
        saveSectionTitle,
        hasAnimAny,
        showVariantToggle,
        downloadVariant,
        downloadReady,
        canSaveStatic,
        isVip,
        costStatic: downloadCost(resolveDownloadCostKey(contentType, 'static')),
        costAnim: downloadCost('anim'),
        costHint: isEmojiType(contentType)
          ? '先扣本月额度，再扣积分'
          : `${contentTypeName} · ${downloadCost(resolveDownloadCostKey(contentType, 'static'))} 积分/项 · 先扣本月额度再扣积分`,
        entitlementHint: formatEntitlementHint(entitlement),
        selectedCount: summary.selectedCount,
        selectedCost: summary.selectedCost,
        allSelected: summary.allSelected,
        loading: false,
      });
      this.applyAdminView();
      wx.setNavigationBarTitle({ title: pack.title || '合集详情' });
      // 只拉当前变体原图；首屏一批，滚动再补（不用 preview 顶原图）
      this.prefetchSlotUrls(packId, { limit: SLOT_URL_FIRST });
      this.loadRecommend(pack);
    } catch (e) {
      this.setData({
        loading: false,
        heroSlides: [],
        recommendList: [],
        recommendItems: [],
      });
      wx.showToast({ title: e.message || '加载失败', icon: 'none' });
    }
  },

  /** 底部推荐：同角色优先，随机若干合集抬曝光；合集间插入卡片广告 */
  async loadRecommend(pack) {
    const packId = (pack && pack._id) || this.data.packId;
    if (!packId) return;
    const seq = (this._recommendSeq = (this._recommendSeq || 0) + 1);
    this.setData({ recommendLoading: true });
    try {
      const res = await callFunction('listPacks', {
        mode: 'recommend',
        excludePackId: packId,
        categoryId: (pack && pack.categoryId) || 'all',
        contentType: normalizeContentType((pack && pack.contentType) || this.data.contentType),
        limit: 6,
        pageSize: 6,
      });
      if (seq !== this._recommendSeq || this.data.packId !== packId) return;
      const list = ((res.data && res.data.list) || [])
        .filter((item) => item && item._id && item._id !== packId)
        .map((item) => ({
          ...item,
          coverUrl: item.coverUrl
            ? reuseTempUrl(packCoverCacheKey(item._id), item.coverUrl)
            : '',
        }));
      const recommendAdUnitId = getNativePackRecommendAdUnitId();
      const showRecommendAd =
        !!recommendAdUnitId && shouldShowNativeAds();
      this.setData({
        recommendList: list,
        recommendItems: buildRecommendItems(list, { showAd: showRecommendAd }),
        recommendAdUnitId,
        showRecommendAd,
        recommendLoading: false,
      });
    } catch (e) {
      if (seq !== this._recommendSeq) return;
      this.setData({
        recommendList: [],
        recommendItems: [],
        recommendLoading: false,
      });
    }
  },

  slotNeedsUrl(slot, variant) {
    if (!slot) return false;
    if (variant === 'anim') return !!slot.hasAnim && !slot.animReady;
    return !slot.staticReady;
  },

  /**
   * 按当前静/动变体分批换原图临时链
   * @param {string} packId
   * @param {{ limit?: number }} [opts]
   */
  async prefetchSlotUrls(packId, opts = {}) {
    const id = packId || this.data.packId;
    if (!id || this._slotUrlPrefetching) return;
    const variant = this.data.downloadVariant === 'anim' ? 'anim' : 'static';
    const limit = Math.max(1, Number(opts.limit) || SLOT_URL_BATCH);
    const pending = (this.data.emojiSlots || [])
      .filter((s) => this.slotNeedsUrl(s, variant))
      .map((s) => s.index)
      .slice(0, limit);
    if (!pending.length) return;

    const seq = (this._slotUrlSeq = (this._slotUrlSeq || 0) + 1);
    this._slotUrlPrefetching = true;
    try {
      const res = await callFunction('getPackDetail', {
        action: 'resolveSlotUrls',
        packId: id,
        indexes: pending,
        variant,
      });
      if (seq !== this._slotUrlSeq || this.data.packId !== id) return;
      if (this.data.downloadVariant !== variant) return;

      const patchMap = {};
      ((res.data && res.data.slots) || []).forEach((row) => {
        if (row && typeof row.index === 'number') patchMap[row.index] = row;
      });
      if (!Object.keys(patchMap).length) return;

      const downloadReady = this.data.downloadReady;
      const hasAnimAny = this.data.hasAnimAny;
      const canSaveStatic = this.data.canSaveStatic;
      const contentType = this.data.contentType || 'emoji';
      const mergedList = (this.data.emojiSlots || []).map((s) => {
        const row = patchMap[s.index];
        if (!row) return s;
        if (variant === 'anim') {
          const animUrl = row.animUrl || s.animUrl || '';
          if (animUrl) rememberTempUrl(packSlotCacheKey(id, s.index, 'anim'), animUrl);
          return {
            ...s,
            animUrl,
            hasAnim: row.hasAnim != null ? !!row.hasAnim : s.hasAnim,
            animReady: true,
          };
        }
        const staticUrl = row.staticUrl || s.staticUrl || '';
        if (staticUrl) {
          rememberTempUrl(packSlotCacheKey(id, s.index, 'static'), staticUrl);
        }
        return {
          ...s,
          staticUrl,
          hasAnim: row.hasAnim != null ? !!row.hasAnim : s.hasAnim,
          staticReady: true,
        };
      });
      // 必须走 decorateSlots：视频不能把 staticUrl(mp4) 写进 displayUrl，否则 t-image 裂图且无法播
      const next = decorateSlots(
        mergedList,
        downloadReady,
        variant,
        hasAnimAny,
        canSaveStatic,
        this.data.adRewardReady,
        contentType,
      );
      const summary = summarizeSelection(next, variant, contentType);
      const patch = {
        emojiSlots: next,
        selectedCount: summary.selectedCount,
        selectedCost: summary.selectedCost,
        allSelected: summary.allSelected,
      };
      if (contentType === 'video' && this.data.pack) {
        patch.heroSlides = this.buildHeroSlides(this.data.pack, next);
      }
      this.setData(patch);
    } catch (e) {
      console.warn('[slotUrls]', e.message || e);
    } finally {
      this._slotUrlPrefetching = false;
    }
  },

  prefetchMoreSlotUrls() {
    const variant = this.data.downloadVariant === 'anim' ? 'anim' : 'static';
    const hasPending = (this.data.emojiSlots || []).some((s) =>
      this.slotNeedsUrl(s, variant),
    );
    if (!hasPending) return;
    this.prefetchSlotUrls(this.data.packId, { limit: SLOT_URL_BATCH });
  },

  onPageScroll(e) {
    const top = (e && e.scrollTop) || 0;
    if (top < (this._lastPrefetchScroll || 0) + 240) return;
    this._lastPrefetchScroll = top;
    this.prefetchMoreSlotUrls();
  },

  onCopyPackId() {
    if (!resolveIsAdmin()) return;
    const { packId } = this.data;
    if (!packId) {
      wx.showToast({ title: '暂无作品 ID', icon: 'none' });
      return;
    }
    wx.setClipboardData({
      data: packId,
      success: () => wx.showToast({ title: '已复制作品 ID', icon: 'success' }),
    });
  },

  onCopyDrive(e) {
    if (!resolveIsAdmin()) return;
    const kind = e.currentTarget.dataset.kind;
    const url =
      kind === 'anim' ? this.data.animDriveUrl : this.data.staticDriveUrl;
    if (!url) {
      wx.showToast({ title: '暂无链接', icon: 'none' });
      return;
    }
    wx.setClipboardData({
      data: url,
      success: () => wx.showToast({ title: '已复制链接', icon: 'success' }),
    });
  },

  onVariantTap(e) {
    if (this.data.saving) return;
    const value = (e.currentTarget && e.currentTarget.dataset.value) || 'static';
    const downloadVariant = value === 'anim' ? 'anim' : 'static';
    if (downloadVariant === this.data.downloadVariant) return;
    const cleared = (this.data.emojiSlots || []).map((s) => ({
      ...s,
      selected: false,
      // 变体切换后由 decorateSlots / prefetch 重算展示字段
      staticReady: downloadVariant === 'static' ? !!s.staticReady : s.staticReady,
      animReady: downloadVariant === 'anim' ? !!s.animReady : s.animReady,
    }));
    this._lastPrefetchScroll = 0;
    this.setData({ downloadVariant, emojiSlots: cleared }, () => {
      this.refreshEntitlementUi();
      this.prefetchSlotUrls(this.data.packId, { limit: SLOT_URL_FIRST });
    });
  },

  onSlotImgLoad(e) {
    const index = Number(e.currentTarget.dataset.index);
    if (Number.isNaN(index)) return;
    const list = this.data.emojiSlots || [];
    const i = list.findIndex((s) => s.index === index);
    if (i < 0 || list[i].imgReady) return;
    this.setData({ [`emojiSlots[${i}].imgReady`]: true });
  },

  /** 槽位图临时链失效：丢缓存并重新换签（仅海报/静图；勿清视频 staticUrl） */
  onSlotImgError(e) {
    const index = Number(e.currentTarget.dataset.index);
    if (Number.isNaN(index)) return;
    const id = this.data.packId;
    const variant = this.data.downloadVariant === 'anim' ? 'anim' : 'static';
    const list = this.data.emojiSlots || [];
    const i = list.findIndex((s) => s.index === index);
    if (i < 0) return;
    const slot = list[i];
    // 视频槽位的 displayUrl 只是海报；裂图时清海报即可，保留可播的 videoUrl
    if (slot && slot.mediaKind === 'video') {
      this.setData({
        [`emojiSlots[${i}].previewUrl`]: '',
        [`emojiSlots[${i}].displayUrl`]: '',
        [`emojiSlots[${i}].imgReady`]: false,
      });
      return;
    }
    if (id) forgetTempUrl(packSlotCacheKey(id, index, variant));
    const patch =
      variant === 'anim'
        ? {
            [`emojiSlots[${i}].animUrl`]: '',
            [`emojiSlots[${i}].animReady`]: false,
            [`emojiSlots[${i}].imgReady`]: false,
            [`emojiSlots[${i}].displayUrl`]: '',
            [`emojiSlots[${i}].urlPending`]: true,
          }
        : {
            [`emojiSlots[${i}].staticUrl`]: '',
            [`emojiSlots[${i}].staticReady`]: false,
            [`emojiSlots[${i}].imgReady`]: false,
            [`emojiSlots[${i}].displayUrl`]: '',
            [`emojiSlots[${i}].urlPending`]: true,
          };
    this.setData(patch);
    this.prefetchSlotUrls(id, { limit: 1 });
  },

  onToggleSelect(e) {
    if (this.data.saving) return;
    const index = Number(e.currentTarget.dataset.index);
    if (Number.isNaN(index)) return;
    const hit = (this.data.emojiSlots || []).find(
      (s) => s.index === index && s.selectable,
    );
    if (!hit) return;
    const next = (this.data.emojiSlots || []).map((s) => {
      if (s.index !== index || !s.selectable) return s;
      return { ...s, selected: !s.selected };
    });
    this.applySlots(next);
  },

  /** 可下载时点封面勾选；视频未勾选态可点开播放；图片仍不开放大图 */
  onCoverTap(e) {
    if (this.data.saving) return;
    const index = Number(e.currentTarget.dataset.index);
    if (Number.isNaN(index)) return;
    const slot = (this.data.emojiSlots || []).find((s) => s.index === index);
    if (this.data.downloadReady && slot && slot.selectable) {
      this.onToggleSelect(e);
      return;
    }
    if (slot && slot.mediaKind === 'video') {
      this.previewSlotVideo(slot);
    }
  },

  /** 播放按钮：多选态下仍可单独播，不跟勾选抢手势 */
  onSlotVideoPlay(e) {
    if (this.data.saving) return;
    const index = Number(e.currentTarget.dataset.index);
    if (Number.isNaN(index)) return;
    const slot = (this.data.emojiSlots || []).find((s) => s.index === index);
    if (slot) this.previewSlotVideo(slot);
  },

  /** 仅管理员视图可长按看原图；视频长按同样走系统预览播放 */
  onBlockPreview(e) {
    if (!resolveIsAdmin()) return;
    const index = Number(e.currentTarget.dataset.index);
    if (Number.isNaN(index)) return;
    const slot = (this.data.emojiSlots || []).find((s) => s.index === index);
    if (slot && slot.mediaKind === 'video') {
      this.previewSlotVideo(slot);
      return;
    }
    this.onPreviewTap(e);
  },

  onToggleSelectAll() {
    if (this.data.saving) return;
    const checked = !this.data.allSelected;
    const next = (this.data.emojiSlots || []).map((s) => ({
      ...s,
      selected: checked && !!s.selectable,
    }));
    this.applySlots(next);
  },

  /** Kubai 图文确认框（替代系统 Modal） */
  confirmAsync(content, options = {}) {
    const {
      title = '确认保存',
      icon = CONFIRM_ICONS.save,
      okText = '继续',
    } = options;
    return new Promise((resolve) => {
      if (this._confirmResolve) {
        this._confirmResolve(false);
        this._confirmResolve = null;
      }
      this._confirmResolve = resolve;
      this.setData({
        confirmVisible: true,
        confirmTitle: title,
        confirmContent: content,
        confirmIcon: icon,
        confirmOkText: okText,
      });
    });
  },

  settleConfirm(ok) {
    const resolve = this._confirmResolve;
    this._confirmResolve = null;
    this.setData({ confirmVisible: false });
    if (typeof resolve === 'function') resolve(!!ok);
  },

  onConfirmOk() {
    this.settleConfirm(true);
  },

  onConfirmCancel() {
    this.settleConfirm(false);
  },

  onHeroChange(e) {
    const current =
      e.detail && typeof e.detail.current === 'number' ? e.detail.current : 0;
    this.setData({ heroCurrent: current });
    this.pauseHeroVideoIfNeeded(current);
  },

  onHeroNavBtn(e) {
    const dir = (e.detail && e.detail.dir) || '';
    const slides = this.data.heroSlides || [];
    const n = slides.length;
    if (n < 2) return;
    const cur = this.data.heroCurrent || 0;
    const next = dir === 'next' ? (cur + 1) % n : (cur - 1 + n) % n;
    this.setData({ heroCurrent: next });
    this.pauseHeroVideoIfNeeded(next);
  },

  openViewer(list, current) {
    const urls = [];
    (list || []).forEach((u) => {
      if (u && urls.indexOf(u) === -1) urls.push(u);
    });
    if (!urls.length) return;
    let index = urls.indexOf(current);
    if (index < 0) index = 0;
    this.setData({
      viewerVisible: true,
      viewerImages: urls,
      viewerIndex: index,
    });
  },

  onViewerClose() {
    this.setData({
      viewerVisible: false,
      viewerImages: [],
      viewerIndex: 0,
    });
  },

  onHeroImageTap(e) {
    const url = (e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.url) || '';
    const images = (this.data.heroSlides || [])
      .filter((s) => s && s.type === 'image' && s.url)
      .map((s) => s.url);
    if (!images.length) return;
    this.openViewer(images, url || images[0]);
  },

  onPreviewTap(e) {
    const { emojiSlots, downloadVariant } = this.data;
    const variant = downloadVariant === 'anim' ? 'anim' : 'static';
    const urls = (emojiSlots || [])
      .map((s) => slotDisplayUrl(s, variant))
      .filter(Boolean);
    const uniq = Array.from(new Set(urls));
    if (!uniq.length) return;
    const slotIndex = Number(e.currentTarget.dataset.index);
    const slot = (emojiSlots || []).find((s) => s.index === slotIndex);
    const current = slotDisplayUrl(slot, variant) || uniq[0];
    this.openViewer(uniq, current);
  },

  goRedeem() {
    this.setData({ redeemVisible: true, redeemCode: '' });
  },

  /**
   * 积分不足时：优先看广告领积分，也可去兑换。
   * 文案写清：余额 / 需要 / 还差 / 本次能领多少，避免以为一次能存完全部。
   * @param {'static'|'anim'} [variant]
   * @param {{ need?: number, count?: number, actionLabel?: string, maxRounds?: number }} [opts]
   * @returns {Promise<boolean>} 看完广告并到账后是否已够继续保存
   */
  packCostKey(variant = 'static') {
    return resolveDownloadCostKey(this.data.contentType || 'emoji', variant);
  },

  async offerAdOrRedeem(variant = 'static', opts = {}) {
    const unitCost = downloadCost(this.packCostKey(variant));
    const count = Math.max(1, Number(opts.count) || 1);
    const need = Math.max(
      0,
      Number(opts.need) || unitCost * count,
    );
    const actionLabel =
      String(opts.actionLabel || '').trim() ||
      (count > 1 ? `保存 ${count} 张` : '保存这张');
    const maxRounds = Math.max(1, Math.min(3, Number(opts.maxRounds) || 2));

    if (!isSaveAdRewardEnabled()) {
      this.goRedeem();
      return false;
    }

    for (let round = 0; round < maxRounds; round += 1) {
      const bal = spendablePoints();
      if (bal >= need) return true;

      let status = {
        enabled: this.data.adRewardReady,
        points: this.data.adRewardPoints || defaultSaveAdRewardPoints(),
        leftToday: this.data.adRewardLeftToday || 0,
      };
      try {
        status = await fetchAdRewardStatus('save');
        this.applyAdRewardStatus(status);
      } catch (e) {
        /* keep cached */
      }

      if (!status.enabled || status.leftToday <= 0) {
        const shortfall = Math.max(0, need - bal);
        await this.confirmAsync(
          `当前可用 ${bal} 积分，还差 ${shortfall}。今日看广告次数已用完，可使用兑换码或到「我的」领积分。`,
          {
            title: '积分不够啦',
            icon: CONFIRM_ICONS.warn,
            okText: '去兑换',
          },
        );
        this.goRedeem();
        return false;
      }

      const prompt = buildSaveAdPrompt({
        spendable: bal,
        need,
        rewardPoints: status.points,
        leftToday: status.leftToday,
        count,
        unitCost,
        actionLabel,
      });
      const confirmed = await this.confirmAsync(prompt.content, {
        title: prompt.title,
        icon: CONFIRM_ICONS.warn,
        okText: '看广告领积分',
      });
      if (!confirmed) {
        this.goRedeem();
        return false;
      }

      const claimed = await this.watchAdForPoints(need);
      if (!claimed) return false;
      if (spendablePoints() >= need) return true;
    }

    const bal = spendablePoints();
    const shortfall = Math.max(0, need - bal);
    wx.showToast({
      title: `还差 ${shortfall} 积分，可再看广告或去兑换`,
      icon: 'none',
      duration: 2500,
    });
    return false;
  },

  /**
   * @param {number} [need] 本次目标消耗，用于到账提示
   */
  async watchAdForPoints(need = 0) {
    if (this._adClaiming) return false;
    this._adClaiming = true;
    try {
      const res = await watchAdAndClaimPoints({ page: this, slot: 'save' });
      if (!res || !res.ok) {
        if (res && res.reason !== 'SKIPPED') {
          wx.showToast({
            title: (res && res.message) || '领取失败',
            icon: 'none',
          });
        }
        if (res && res.data) this.applyAdRewardStatus(res.data);
        else this.refreshAdRewardStatus();
        return false;
      }
      if (res.data) this.applyAdRewardStatus(res.data);
      else this.refreshEntitlementUi();
      const gained = Math.max(0, Number(res.points) || 0);
      showPointsReward({
        host: this,
        points: gained,
        title: '看广告领积分',
        tip: formatAdClaimToast({
          gained,
          spendable: spendablePoints(res.entitlement),
          need,
        }),
      });
      return true;
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '领取失败', icon: 'none' });
      this.refreshAdRewardStatus();
      return false;
    } finally {
      this._adClaiming = false;
    }
  },

  onRedeemInput(e) {
    const value =
      (e.detail && (e.detail.value !== undefined ? e.detail.value : e.detail)) ||
      '';
    this.setData({ redeemCode: String(value) });
  },

  closeRedeem() {
    if (this.data.redeeming) return;
    this.setData({ redeemVisible: false });
  },

  async confirmRedeem() {
    if (this.data.redeeming) return;
    const code = (this.data.redeemCode || '').trim();
    if (!code) {
      wx.showToast({ title: '请输入兑换码', icon: 'none' });
      return;
    }
    this.setData({ redeeming: true });
    wx.showLoading({ title: '兑换中', mask: true });
    try {
      const res = await callFunction('userEntitlement', {
        action: 'redeem',
        code,
      });
      if (res.entitlement) {
        setCachedEntitlement(res.entitlement);
        this.refreshEntitlementUi();
      }
      this.setData({ redeemVisible: false, redeemCode: '' });
      const grant = res.grant || {};
      const pointsAdded = Math.max(0, Number(grant.add) || 0);
      if (pointsAdded > 0) {
        showPointsReward({
          host: this,
          points: pointsAdded,
          title: '兑换成功',
          tip: res.message || '',
        });
      } else {
        wx.showToast({ title: res.message || '兑换成功', icon: 'success' });
      }
    } catch (e) {
      wx.showToast({ title: e.message || '兑换失败', icon: 'none' });
    } finally {
      wx.hideLoading();
      this.setData({ redeeming: false });
    }
  },

  async onSaveOrRedeem(e) {
    const variant = this.data.downloadVariant === 'anim' ? 'anim' : 'static';
    if (!this.data.canSaveStatic) {
      const ready = await this.offerAdOrRedeem('static', {
        need: downloadCost(this.packCostKey('static')),
        count: 1,
        actionLabel: '保存这张',
      });
      if (ready) this.onDownloadEmoji(e);
      return;
    }
    if (!this.data.downloadReady) {
      wx.showToast({
        title: this.data.showVariantToggle
          ? '积分不够保存动态，请切回静态'
          : '积分不足',
        icon: 'none',
      });
      return;
    }
    const index = Number(e.currentTarget.dataset.index);
    const slot = (this.data.emojiSlots || []).find((s) => s.index === index);
    if (variant === 'anim' && slot && !slot.hasAnim) {
      wx.showToast({ title: '该张无动态原图', icon: 'none' });
      return;
    }
    this.onDownloadEmoji(e);
  },

  /**
   * 下载并保存一张；成功返回扣费信息，失败抛错。
   * @param {number} index
   * @param {{ skipAuth?: boolean }} [opts]
   */
  async downloadOne(index, opts = {}) {
    const { packId, downloadVariant, contentType } = this.data;
    const variant = downloadVariant === 'anim' ? 'anim' : 'static';
    return downloadOneShared({
      packId,
      index,
      variant,
      contentType,
      skipAuth: !!opts.skipAuth,
      onEntitlement: () => this.refreshEntitlementUi(),
      onDownloadCount: (next) => {
        if (typeof next === 'number' && this.data.pack) {
          this.setData({ 'pack.downloadCount': next });
        }
      },
    });
  },

  formatSaveTip(stat) {
    const kind = this.data.showVariantToggle
      ? stat.variant === 'anim'
        ? '动态'
        : '静态'
      : this.data.contentTypeName || '';
    const { grantType, fromVip, fromPoints, cost } = stat;
    let tip = `已保存${kind}到相册`;
    if (grantType === 'vip' || fromVip) {
      tip = `已保存${kind}（本月额度 -${fromVip || cost} 积分）`;
    }
    if (grantType === 'points' || (fromPoints && !fromVip)) {
      tip = `已保存${kind}（-${fromPoints || cost} 积分）`;
    }
    if (grantType === 'mixed' || (fromVip && fromPoints)) {
      tip = `已保存${kind}（额度 -${fromVip} 积分 · 购买积分 -${fromPoints}）`;
    }
    return tip;
  },

  async onDownloadEmoji(e) {
    const index = Number(e.currentTarget.dataset.index);
    const { saving, downloadVariant } = this.data;
    if (saving || Number.isNaN(index)) return;

    const variant = downloadVariant === 'anim' ? 'anim' : 'static';
    const costKey = this.packCostKey(variant);
    let entitlement = getCachedEntitlement();
    if (!canAttemptDownload(entitlement, costKey)) {
      const ready = await this.offerAdOrRedeem(variant, {
        need: downloadCost(costKey),
        count: 1,
        actionLabel: '保存这张',
      });
      if (!ready) return;
      entitlement = getCachedEntitlement();
      if (!canAttemptDownload(entitlement, costKey)) {
        const shortfall = Math.max(
          0,
          downloadCost(costKey) - spendablePoints(entitlement),
        );
        wx.showToast({
          title: `还差 ${shortfall} 积分，可再看广告或去兑换`,
          icon: 'none',
        });
        return;
      }
    }

    this.setData({ saving: true });
    wx.showLoading({ title: '准备中...', mask: true });

    try {
      wx.showLoading({ title: '获取原图...', mask: true });
      const stat = await this.downloadOne(index);
      wx.showToast({ title: this.formatSaveTip(stat), icon: 'success' });
      this.burstFestivalConfetti();
    } catch (err) {
      console.error(err);
      const msg = err.message || '保存失败';
      if (/不足|积分|额度|兑换|权益/i.test(msg)) {
        wx.showToast({ title: msg, icon: 'none' });
        this.offerAdOrRedeem(variant, {
          need: downloadCost(this.packCostKey(variant)),
          count: 1,
          actionLabel: '保存这张',
        });
      } else {
        wx.showToast({ title: msg, icon: 'none' });
      }
    } finally {
      wx.hideLoading();
      this.setData({ saving: false });
    }
  },

  burstFestivalConfetti() {
    const colors = getFestivalConfettiColors();
    if (!colors) return;
    const burst = this.selectComponent('#festivalConfetti');
    if (burst && typeof burst.burst === 'function') {
      burst.burst({ count: 36, durationMs: 1000, colors });
    }
  },

  async onBatchSave() {
    if (this.data.saving) return;
    const variant =
      this.data.downloadVariant === 'anim' ? 'anim' : 'static';
    const contentType = this.data.contentType || 'emoji';
    const costKey = this.packCostKey(variant);
    const unit = contentType === 'video' ? '个' : '张';

    const summary = summarizeSelection(this.data.emojiSlots, variant, contentType);
    let indexes = summary.selectedIndexes;

    if (!indexes.length) {
      wx.showToast({ title: '请先选择要保存的原文件', icon: 'none' });
      return;
    }

    let estimate = estimateBatchAffordable(
      getCachedEntitlement(),
      costKey,
      indexes.length,
    );

    if (!estimate.canAll) {
      const ready = await this.offerAdOrRedeem(variant, {
        need: estimate.totalCost,
        count: indexes.length,
        actionLabel: `保存 ${indexes.length} ${unit}`,
        maxRounds: 2,
      });
      if (!ready) return;
      estimate = estimateBatchAffordable(
        getCachedEntitlement(),
        costKey,
        indexes.length,
      );
      if (!estimate.canAll) {
        await this.confirmAsync(
          `当前 ${estimate.spendable} 积分，只够保存 ${estimate.maxCount} / ${indexes.length} ${unit}（每${unit} ${estimate.cost} 积分）。请减少勾选后再保存，或继续看广告补积分。`,
          { title: '积分不太够哦', icon: CONFIRM_ICONS.warn, okText: '去重选' },
        );
        return;
      }
    }

    const kindLabel = this.data.showVariantToggle
      ? variant === 'anim'
        ? '动态 GIF'
        : '静态原图'
      : this.data.contentTypeName
        ? `${this.data.contentTypeName}原文件`
        : '原图';
    const kindIcon =
      variant === 'anim' ? CONFIRM_ICONS.anim : CONFIRM_ICONS.static;
    const confirmed = await this.confirmAsync(
      `将保存 ${indexes.length} ${unit}「${kindLabel}」，预计消耗 ${estimate.totalCost} 积分（先扣本月额度，再扣积分）。确认后按条扣费并写入相册。`,
      {
        title: `保存${kindLabel}`,
        icon: kindIcon,
        okText: '确认保存',
      },
    );
    if (!confirmed) return;

    this.setData({ saving: true });
    let result;
    try {
      result = await runBatchDownload({
        jobs: [{ packId: this.data.packId, indexes, contentType }],
        variant,
        contentType,
        onEntitlement: () => this.refreshEntitlementUi(),
        onDownloadCount: (next) => {
          if (typeof next === 'number' && this.data.pack) {
            this.setData({ 'pack.downloadCount': next });
          }
        },
        onProgress: ({ current, total }) => {
          wx.showLoading({
            title: `保存中 ${current}/${total}`,
            mask: true,
          });
        },
      });
    } catch (err) {
      wx.showToast({ title: err.message || '保存失败', icon: 'none' });
      this.setData({ saving: false });
      wx.hideLoading();
      return;
    }

    // 批量结束后清空多选
    const cleared = (this.data.emojiSlots || []).map((s) => ({
      ...s,
      selected: false,
    }));
    this.applySlots(cleared);
    this.refreshEntitlementUi();

    wx.hideLoading();
    this.setData({ saving: false });

    wx.showToast({
      title: formatBatchResultTip({ ...result, unit }),
      icon: result.okCount ? 'success' : 'none',
      duration: 2500,
    });

    if (result.stoppedByBalance && !result.okCount) {
      this.offerAdOrRedeem(variant, {
        need: downloadCost(costKey),
        count: 1,
        actionLabel: '继续保存',
      });
    }
  },
});
