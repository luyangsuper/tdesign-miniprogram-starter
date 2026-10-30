import { callFunction } from '~/utils/cloud';
import {
  downloadOne as downloadOneShared,
  formatBatchResultTip,
  runBatchDownload,
} from '~/utils/batchDownload';
import {
  canAttemptDownload,
  estimateBatchAffordable,
  formatEntitlementHint,
  getCachedEntitlement,
  setCachedEntitlement,
} from '~/utils/entitlement';
import { downloadCost } from '~/utils/pricing';
import { resolveIsAdmin } from '~/utils/auth';
import { applyThemeToPage, getThemeBrand, getThemeStyle } from '~/utils/theme';
import { getFestivalConfettiColors } from '~/utils/festival';
import { getWindowInfoSafe } from '~/utils/systemInfo';
import { getFavoriteCached, queueFavorite, rememberFavorite } from '~/utils/favoriteQueue';
import { shareAppMessage, shareTimeline } from '~/utils/share';

function calcSwiperHeight() {
  try {
    const { windowWidth } = getWindowInfoSafe();
    return Math.max(240, Math.round(windowWidth));
  } catch (e) {
    return 375;
  }
}

function buildSaveLabel(slot, downloadReady, variant, hasAnimAny, canSaveStatic) {
  if (!canSaveStatic) return '去兑换';
  if (hasAnimAny && variant === 'anim' && !slot.hasAnim) return '无动态';
  if (!downloadReady) return '积分不足';
  const costTip = `${downloadCost(variant)}积分`;
  if (!hasAnimAny) return `保存 ·${costTip}`;
  if (variant === 'anim') return `动态 ·${costTip}`;
  return `静态 ·${costTip}`;
}

function isSlotSelectable(slot, downloadReady, variant) {
  if (!downloadReady) return false;
  if (variant === 'anim' && !slot.hasAnim) return false;
  return true;
}

/** 保存区展示：优先原图临时链，未就绪时用预览占位 */
function slotDisplayUrl(slot, variant) {
  if (!slot) return '';
  if (variant === 'anim') {
    return slot.animUrl || slot.previewUrl || '';
  }
  return slot.staticUrl || slot.previewUrl || '';
}

const SLOT_URL_BATCH = 20;

function decorateSlots(slots, downloadReady, variant, hasAnimAny, canSaveStatic) {
  return (slots || []).map((s) => {
    const selectable = isSlotSelectable(s, downloadReady, variant);
    const displayUrl = slotDisplayUrl(s, variant);
    const prevUrl = s.displayUrl || '';
    const imgReady = displayUrl && displayUrl === prevUrl ? !!s.imgReady : false;
    return {
      ...s,
      hasAnim: !!s.hasAnim,
      selectable,
      selected: selectable && !!s.selected,
      displayUrl,
      imgReady,
      saveLabel: buildSaveLabel(s, downloadReady, variant, hasAnimAny, canSaveStatic),
    };
  });
}

function summarizeSelection(slots, variant) {
  const list = slots || [];
  const selected = list.filter((s) => s.selected);
  const selectable = list.filter((s) => s.selectable);
  const cost = downloadCost(variant);
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
    confirmVisible: false,
    confirmTitle: '',
    confirmContent: '',
    confirmIcon: '',
    confirmOkText: '继续',
    themeStyle: '',
    themeBrand: '',
  },

  _confirmResolve: null,

  onLoad(options) {
    const packId = options.id || '';
    this.setData({
      packId,
      swiperHeight: calcSwiperHeight(),
      isAdmin: resolveIsAdmin(),
      themeStyle: getThemeStyle(),
      themeBrand: getThemeBrand(),
    });
    this.refreshEntitlementUi();
    this._onAdminViewChange = () => this.applyAdminView();
    this._onFavoriteChange = (payload) => this.applyFavoriteChange(payload);
    try {
      const app = getApp();
      if (app && app.eventBus) {
        app.eventBus.on('adminViewChange', this._onAdminViewChange);
        app.eventBus.on('favoriteChange', this._onFavoriteChange);
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
    const title = (pack && pack.title) || '趣集合集';
    return shareAppMessage({
      title,
      path: `/pages/pack/detail/index?id=${packId || ''}`,
      imageUrl: pack && pack.coverUrl,
    });
  },

  /** 分享到朋友圈 */
  onShareTimeline() {
    const { pack, packId } = this.data;
    const title = (pack && pack.title) || '趣集合集';
    return shareTimeline({
      title,
      query: `id=${packId || ''}`,
      imageUrl: pack && pack.coverUrl,
    });
  },

  applySlots(slots) {
    const { downloadVariant } = this.data;
    const summary = summarizeSelection(slots, downloadVariant);
    this.setData({
      emojiSlots: slots,
      selectedCount: summary.selectedCount,
      selectedCost: summary.selectedCost,
      allSelected: summary.allSelected,
    });
  },

  refreshEntitlementUi() {
    const entitlement = getCachedEntitlement();
    const { emojiSlots, downloadVariant, hasAnimAny } = this.data;
    const canSaveStatic = canAttemptDownload(entitlement, 'static');
    const downloadReady = canAttemptDownload(entitlement, downloadVariant);
    const isVip = !!entitlement.isVip;
    const nextSlots = decorateSlots(
      emojiSlots,
      downloadReady,
      downloadVariant,
      hasAnimAny,
      canSaveStatic,
    );
    const summary = summarizeSelection(nextSlots, downloadVariant);
    this.setData({
      downloadReady,
      canSaveStatic,
      isVip,
      costHint: '先扣本月额度，再扣积分',
      entitlementHint: formatEntitlementHint(entitlement),
      emojiSlots: nextSlots,
      selectedCount: summary.selectedCount,
      selectedCost: summary.selectedCost,
      allSelected: summary.allSelected,
    });
  },

  async syncEntitlement() {
    try {
      const res = await callFunction('userEntitlement', { action: 'get' });
      if (res.entitlement) {
        setCachedEntitlement(res.entitlement);
        this.refreshEntitlementUi();
      }
    } catch (e) {
      /* ignore */
    }
  },

  buildHeroSlides(pack) {
    const slides = [];
    const seen = {};
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
    return slides;
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
    this.setData({ loading: true, heroSlides: [], heroCurrent: 0, heroVideoPlaying: false });
    try {
      const res = await callFunction('getPackDetail', { packId });
      const pack = res.data;
      const hasAnimAny = !!pack.hasAnimAny;
      const downloadVariant = 'static';
      const entitlement = getCachedEntitlement();
      const canSaveStatic = canAttemptDownload(entitlement, 'static');
      const downloadReady = canAttemptDownload(entitlement, downloadVariant);
      const isVip = !!entitlement.isVip;
      const rawSlots =
        pack.slots && pack.slots.length
          ? pack.slots
          : Array.from({ length: pack.emojiCount || 0 }, (_, i) => ({
              index: i,
              label: `原图 ${i + 1}`,
              previewUrl: (pack.previewUrls || [])[i] || '',
              staticUrl: '',
              animUrl: '',
              pairKey: '',
              hasAnim: false,
            }));
      const emojiSlots = decorateSlots(
        rawSlots,
        downloadReady,
        downloadVariant,
        hasAnimAny,
        canSaveStatic,
      );
      const summary = summarizeSelection(emojiSlots, downloadVariant);
      const heroSlides = this.buildHeroSlides(pack);
      this.setData({
        pack,
        emojiSlots,
        heroSlides,
        heroCurrent: 0,
        hasAnimAny,
        downloadVariant,
        downloadReady,
        canSaveStatic,
        isVip,
        costHint: '先扣本月额度，再扣积分',
        entitlementHint: formatEntitlementHint(entitlement),
        selectedCount: summary.selectedCount,
        selectedCost: summary.selectedCost,
        allSelected: summary.allSelected,
        loading: false,
      });
      this.applyAdminView();
      wx.setNavigationBarTitle({ title: pack.title || '合集详情' });
      // 原图临时链按批后台补齐，首屏先用预览占位
      this.prefetchSlotUrls(packId, emojiSlots);
    } catch (e) {
      this.setData({ loading: false, heroSlides: [] });
      wx.showToast({ title: e.message || '加载失败', icon: 'none' });
    }
  },

  /**
   * 分批拉取静/动原图临时链；已就绪的槽位跳过
   */
  async prefetchSlotUrls(packId, slots) {
    const id = packId || this.data.packId;
    if (!id) return;
    const seq = (this._slotUrlSeq = (this._slotUrlSeq || 0) + 1);
    const pending = (slots || this.data.emojiSlots || [])
      .filter((s) => s && !s.urlsReady)
      .map((s) => s.index);
    for (let i = 0; i < pending.length; i += SLOT_URL_BATCH) {
      if (seq !== this._slotUrlSeq || this.data.packId !== id) return;
      const indexes = pending.slice(i, i + SLOT_URL_BATCH);
      try {
        // eslint-disable-next-line no-await-in-loop
        const res = await callFunction('getPackDetail', {
          action: 'resolveSlotUrls',
          packId: id,
          indexes,
        });
        if (seq !== this._slotUrlSeq || this.data.packId !== id) return;
        const patchMap = {};
        ((res.data && res.data.slots) || []).forEach((row) => {
          if (row && typeof row.index === 'number') patchMap[row.index] = row;
        });
        if (!Object.keys(patchMap).length) continue;
        const variant = this.data.downloadVariant;
        const downloadReady = this.data.downloadReady;
        const hasAnimAny = this.data.hasAnimAny;
        const canSaveStatic = this.data.canSaveStatic;
        const next = (this.data.emojiSlots || []).map((s) => {
          const row = patchMap[s.index];
          if (!row) return s;
          const merged = {
            ...s,
            staticUrl: row.staticUrl || s.staticUrl || '',
            animUrl: row.animUrl || s.animUrl || '',
            hasAnim: row.hasAnim != null ? !!row.hasAnim : s.hasAnim,
            urlsReady: true,
          };
          const displayUrl = slotDisplayUrl(merged, variant);
          return {
            ...merged,
            selectable: isSlotSelectable(merged, downloadReady, variant),
            displayUrl,
            imgReady: displayUrl && displayUrl === s.displayUrl ? !!s.imgReady : false,
            saveLabel: buildSaveLabel(
              merged,
              downloadReady,
              variant,
              hasAnimAny,
              canSaveStatic,
            ),
          };
        });
        const summary = summarizeSelection(next, variant);
        this.setData({
          emojiSlots: next,
          selectedCount: summary.selectedCount,
          selectedCost: summary.selectedCost,
          allSelected: summary.allSelected,
        });
      } catch (e) {
        console.warn('[slotUrls]', e.message || e);
      }
    }
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
    const cleared = (this.data.emojiSlots || []).map((s) => {
      const displayUrl = slotDisplayUrl(s, downloadVariant);
      return {
        ...s,
        selected: false,
        displayUrl,
        imgReady: displayUrl && displayUrl === s.displayUrl ? !!s.imgReady : false,
      };
    });
    this.setData({ downloadVariant, emojiSlots: cleared }, () =>
      this.refreshEntitlementUi(),
    );
  },

  onSlotImgLoad(e) {
    const index = Number(e.currentTarget.dataset.index);
    if (Number.isNaN(index)) return;
    const list = this.data.emojiSlots || [];
    const i = list.findIndex((s) => s.index === index);
    if (i < 0 || list[i].imgReady) return;
    this.setData({ [`emojiSlots[${i}].imgReady`]: true });
  },

  onToggleSelect(e) {
    if (this.data.saving) return;
    const index = Number(e.currentTarget.dataset.index);
    if (Number.isNaN(index)) return;
    const next = (this.data.emojiSlots || []).map((s) => {
      if (s.index !== index || !s.selectable) return s;
      return { ...s, selected: !s.selected };
    });
    this.applySlots(next);
  },

  /** 可下载时点封面勾选；静/动原图不允许看大图 */
  onCoverTap(e) {
    if (this.data.saving) return;
    const index = Number(e.currentTarget.dataset.index);
    if (Number.isNaN(index)) return;
    const slot = (this.data.emojiSlots || []).find((s) => s.index === index);
    if (this.data.downloadReady && slot && slot.selectable) {
      this.onToggleSelect(e);
    }
  },

  /** 仅管理员视图可长按看原图；预览普通用户与真实用户一致，不可看大图 */
  onBlockPreview(e) {
    if (!resolveIsAdmin()) return;
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

  /** IconPark 图文确认框（替代系统 Modal） */
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
      wx.showToast({ title: res.message || '兑换成功', icon: 'success' });
    } catch (e) {
      wx.showToast({ title: e.message || '兑换失败', icon: 'none' });
    } finally {
      wx.hideLoading();
      this.setData({ redeeming: false });
    }
  },

  onSaveOrRedeem(e) {
    if (!this.data.canSaveStatic) {
      this.goRedeem();
      return;
    }
    if (!this.data.downloadReady) {
      wx.showToast({ title: '积分不够保存动态，请切回静态', icon: 'none' });
      return;
    }
    const index = Number(e.currentTarget.dataset.index);
    const slot = (this.data.emojiSlots || []).find((s) => s.index === index);
    if (this.data.downloadVariant === 'anim' && slot && !slot.hasAnim) {
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
    const { packId, downloadVariant } = this.data;
    const variant = downloadVariant === 'anim' ? 'anim' : 'static';
    return downloadOneShared({
      packId,
      index,
      variant,
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
    const kind = this.data.hasAnimAny
      ? stat.variant === 'anim'
        ? '动态'
        : '静态'
      : '';
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
    const entitlement = getCachedEntitlement();
    if (!canAttemptDownload(entitlement, variant)) {
      this.goRedeem();
      return;
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
        this.goRedeem();
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
    if (!this.data.downloadReady) {
      this.goRedeem();
      return;
    }

    const variant =
      this.data.downloadVariant === 'anim' ? 'anim' : 'static';
    const summary = summarizeSelection(this.data.emojiSlots, variant);
    let indexes = summary.selectedIndexes;

    if (!indexes.length) {
      wx.showToast({ title: '请先选择要保存的原图', icon: 'none' });
      return;
    }

    let estimate = estimateBatchAffordable(
      getCachedEntitlement(),
      variant,
      indexes.length,
    );

    if (!estimate.canAny) {
      wx.showToast({
        title: `积分不足（单张需 ${estimate.cost} 积分）`,
        icon: 'none',
      });
      this.goRedeem();
      return;
    }

    if (!estimate.canAll) {
      await this.confirmAsync(
        `余额约 ${estimate.spendable} 积分，只够保存 ${estimate.maxCount} / ${indexes.length} 张（每张 ${estimate.cost} 积分）。请取消部分勾选后再保存。`,
        { title: '积分不太够哦', icon: CONFIRM_ICONS.warn, okText: '去重选' },
      );
      return;
    }

    const kindLabel = this.data.hasAnimAny
      ? variant === 'anim'
        ? '动态 GIF'
        : '静态原图'
      : '原图';
    const kindIcon =
      variant === 'anim' ? CONFIRM_ICONS.anim : CONFIRM_ICONS.static;
    const confirmed = await this.confirmAsync(
      `将保存 ${indexes.length} 张「${kindLabel}」，预计消耗 ${estimate.totalCost} 积分（先扣本月额度，再扣积分）。确认后按张扣费并写入相册。`,
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
        jobs: [{ packId: this.data.packId, indexes }],
        variant,
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
      title: formatBatchResultTip(result),
      icon: result.okCount ? 'success' : 'none',
      duration: 2500,
    });

    if (result.stoppedByBalance && !result.okCount) {
      this.goRedeem();
    }
  },
});
