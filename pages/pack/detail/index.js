import { callFunction } from '~/utils/cloud';
import { ensureAlbumAuth, saveRemoteImageToAlbum } from '~/utils/download';
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

function calcSwiperHeight() {
  try {
    const { windowWidth } = wx.getSystemInfoSync();
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

function decorateSlots(slots, downloadReady, variant, hasAnimAny, canSaveStatic) {
  return (slots || []).map((s) => {
    const selectable = isSlotSelectable(s, downloadReady, variant);
    return {
      ...s,
      hasAnim: !!s.hasAnim,
      selectable,
      selected: selectable && !!s.selected,
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
    heroList: [],
    heroCurrent: 0,
    swiperHeight: calcSwiperHeight(),
    swiperNav: {
      type: 'fraction',
      paginationPosition: 'bottom-right',
      minShowNum: 2,
      showControls: true,
    },
    viewerVisible: false,
    viewerImages: [],
    viewerIndex: 0,
    viewerImageProps: {
      mode: 'aspectFit',
      lazy: true,
    },
    swiperImageProps: {
      mode: 'aspectFit',
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
    if (packId) this.loadDetail(packId);
  },

  onShow() {
    applyThemeToPage(this);
    this.setData({ isAdmin: resolveIsAdmin() });
    this.refreshEntitlementUi();
    this.syncEntitlement();
  },

  /** 分享给好友 / 点「分享」按钮 */
  onShareAppMessage() {
    const { pack, packId } = this.data;
    const title = (pack && pack.title) || '趣集合集';
    const path = `/pages/pack/detail/index?id=${packId || ''}`;
    const cover = pack && pack.coverUrl;
    const payload = { title, path };
    if (cover && /^https?:\/\//i.test(cover)) {
      payload.imageUrl = cover;
    }
    return payload;
  },

  /** 分享到朋友圈 */
  onShareTimeline() {
    const { pack, packId } = this.data;
    const title = (pack && pack.title) || '趣集合集';
    const cover = pack && pack.coverUrl;
    const payload = {
      title,
      query: `id=${packId || ''}`,
    };
    if (cover && /^https?:\/\//i.test(cover)) {
      payload.imageUrl = cover;
    }
    return payload;
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

  buildHeroList(pack) {
    const list = [];
    const push = (url) => {
      if (url && list.indexOf(url) === -1) list.push(url);
    };
    push(pack.coverUrl);
    (pack.previewUrls || []).forEach(push);
    (pack.slots || []).forEach((s) => push(s && s.previewUrl));
    return list;
  },

  async loadDetail(packId) {
    this.setData({ loading: true, heroList: [], heroCurrent: 0 });
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
      const heroList = this.buildHeroList(pack);
      this.setData({
        pack,
        emojiSlots,
        heroList,
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
        staticDriveUrl: pack.staticDriveUrl || '',
        animDriveUrl: pack.animDriveUrl || '',
        isAdmin: resolveIsAdmin(),
        loading: false,
      });
      wx.setNavigationBarTitle({ title: pack.title || '合集详情' });
    } catch (e) {
      this.setData({ loading: false, heroList: [] });
      wx.showToast({ title: e.message || '加载失败', icon: 'none' });
    }
  },

  onCopyPackId() {
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
    // 切换静/动时清空多选，避免误扣
    const cleared = (this.data.emojiSlots || []).map((s) => ({
      ...s,
      selected: false,
    }));
    this.setData({ downloadVariant, emojiSlots: cleared }, () =>
      this.refreshEntitlementUi(),
    );
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

  /** 可下载时点封面勾选；否则打开预览。长按始终预览 */
  onCoverTap(e) {
    if (this.data.saving) return;
    const index = Number(e.currentTarget.dataset.index);
    if (Number.isNaN(index)) return;
    const slot = (this.data.emojiSlots || []).find((s) => s.index === index);
    if (this.data.downloadReady && slot && slot.selectable) {
      this.onToggleSelect(e);
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

  onHeroClick(e) {
    const { heroList, heroCurrent } = this.data;
    if (!heroList.length) return;
    const fromEvent =
      e && e.detail && typeof e.detail.index === 'number' ? e.detail.index : -1;
    const index = fromEvent >= 0 ? fromEvent : heroCurrent;
    this.openViewer(heroList, heroList[index] || heroList[0]);
  },

  onPreviewTap(e) {
    const { pack, emojiSlots } = this.data;
    const urls = (emojiSlots || [])
      .map((s) => s.previewUrl)
      .filter(Boolean)
      .concat((pack && pack.previewUrls) || []);
    const uniq = Array.from(new Set(urls.filter(Boolean)));
    if (!uniq.length) return;
    const index = Number(e.currentTarget.dataset.index) || 0;
    this.openViewer(uniq, uniq[index] || uniq[0]);
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

    if (!opts.skipAuth) {
      await ensureAlbumAuth();
    }

    const res = await callFunction('getEmojiDownload', {
      packId,
      index,
      variant,
    });

    const url = res.data && res.data.url;
    const fromVip = Number((res.data && res.data.fromVip) || 0);
    const fromPoints = Number((res.data && res.data.fromPoints) || 0);
    if (!url) throw new Error('未获取到下载链接');

    if (res.data.entitlement) {
      setCachedEntitlement(res.data.entitlement);
      this.refreshEntitlementUi();
    }

    try {
      await saveRemoteImageToAlbum(url);
    } catch (saveErr) {
      await this.refundDownloadCharge(fromVip, fromPoints);
      throw saveErr;
    }

    try {
      const report = await callFunction('reportDownload', {
        packId,
        index,
        grantType: (res.data && res.data.grantType) || '',
      });
      const next = report.data && report.data.downloadCount;
      if (typeof next === 'number' && this.data.pack) {
        this.setData({ 'pack.downloadCount': next });
      }
    } catch (reportErr) {
      console.warn('[reportDownload]', reportErr.message || reportErr);
    }

    return {
      cost: Number((res.data && res.data.cost) || 0),
      fromVip,
      fromPoints,
      grantType: (res.data && res.data.grantType) || '',
      variant,
    };
  },

  async refundDownloadCharge(fromVip, fromPoints) {
    if (!fromVip && !fromPoints) return;
    try {
      const refund = await callFunction('getEmojiDownload', {
        action: 'refund',
        fromVip,
        fromPoints,
      });
      if (refund.entitlement) {
        setCachedEntitlement(refund.entitlement);
        this.refreshEntitlementUi();
      }
    } catch (refundErr) {
      console.warn('[refundDownload]', refundErr.message || refundErr);
    }
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
    let okCount = 0;
    let failCount = 0;
    let vipSpent = 0;
    let pointsSpent = 0;
    let stoppedByBalance = false;

    try {
      await ensureAlbumAuth();

      for (let i = 0; i < indexes.length; i += 1) {
        const index = indexes[i];
        // 每张前再校验，避免上一张扣完后仍继续请求
        if (!canAttemptDownload(getCachedEntitlement(), variant)) {
          stoppedByBalance = true;
          break;
        }

        wx.showLoading({
          title: `保存中 ${i + 1}/${indexes.length}`,
          mask: true,
        });

        try {
          const stat = await this.downloadOne(index, { skipAuth: true });
          okCount += 1;
          vipSpent += stat.fromVip || 0;
          pointsSpent += stat.fromPoints || 0;
        } catch (err) {
          console.error('[batchSave]', index, err);
          failCount += 1;
          const msg = err.message || '';
          if (/不足|积分|额度|兑换|权益|NO_QUOTA|NO_POINTS/i.test(msg)) {
            stoppedByBalance = true;
            break;
          }
        }
      }
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

    const parts = [`成功 ${okCount} 张`];
    if (failCount) parts.push(`失败 ${failCount}`);
    if (stoppedByBalance && okCount < indexes.length) {
      parts.push('余额不足已停止');
    }
    if (vipSpent || pointsSpent) {
      const spend = [];
      if (vipSpent) spend.push(`额度 -${vipSpent} 积分`);
      if (pointsSpent) spend.push(`购买积分 -${pointsSpent}`);
      parts.push(spend.join(' · '));
    }

    wx.showToast({
      title: parts.join('，'),
      icon: okCount ? 'success' : 'none',
      duration: 2500,
    });

    if (stoppedByBalance && !okCount) {
      this.goRedeem();
    }
  },
});
