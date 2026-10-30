import { callFunction, getTempFileURLs, uploadFile } from '~/utils/cloud';
import {
  getOpenId,
  resolveIsAdmin,
  canBeAdmin,
  isPreviewAsUser,
  setPreviewAsUser,
  getUserProfile,
  applyLoginResult,
} from '~/utils/auth';
import {
  formatBenefitCard,
  getCachedEntitlement,
  setCachedEntitlement,
} from '~/utils/entitlement';
import {
  getPricingPlans,
  loadPricingPlans,
  pricingFromLoginPayload,
} from '~/utils/pricing';
import { buyPlan, recoverMyPendingOrders } from '~/utils/virtualPay';
import {
  createAndCopyCode,
  extractRedeemCode,
  readClipboardRedeemCode,
} from '~/utils/redeemCode';
import {
  hasCloudAvatar,
  isAvatarTempUrlFresh,
  resolveDisplayAvatarUrl,
} from '~/utils/avatar';
import { applyPendingPointGifts } from '~/utils/giftHint';
import {
  applyPendingLotteryInvites,
  applyPendingLotteryResults,
} from '~/utils/lotteryHint';
import config from '~/config';
import {
  fetchFeedbackNotifyStatus,
  fetchNewPackSubscribeStatus,
  requestFeedbackNotifySubscribe,
  requestNewPackSubscribe,
} from '~/utils/subscribe';
import {
  applyThemeToTabBar,
  getThemeBrand,
  getThemeId,
  getThemePresets,
  getThemeStyle,
  setThemeId,
} from '~/utils/theme';
import {
  FESTIVAL_BANNER_SPEC,
  FESTIVAL_BANK_SPEC,
  clearFestivalBanner,
  clearFestivalBank,
  clearFestivalWindow,
  ensureFestivalModeForRole,
  getFestivalBannerAdminItems,
  getFestivalBankAdminItems,
  getFestivalMode,
  getFestivalModeOptions,
  getFestivalStatus,
  getFestivalWindowInfo,
  isCloudFileId,
  isFestivalFallFull,
  isFestivalFeatureEnabled,
  isFestivalUserOn,
  loadFestivalConfig,
  resolveFestivalSrcs,
  saveFestivalBanner,
  saveFestivalBank,
  saveFestivalWindow,
  setFestivalFallFull,
  setFestivalFeatureEnabled,
  setFestivalMode,
  setFestivalUserOn,
} from '~/utils/festival';
import { shareAppMessage, shareTimeline } from '~/utils/share';

/**
 * 预览普通用户：只隐藏管理员身份，仍按真实权益显示 VIP / 积分
 * （方便管理员自充会员后测「有会员的普通用户」）
 */
function buildRoleLabel({ isAdmin, isVip, points, vipMonthQuota, previewAsUser }) {
  if (!previewAsUser && isAdmin) return '管理员';
  if (isVip) return '包月会员';
  if ((points || 0) + (vipMonthQuota || 0) > 0) {
    return `积分 ${(points || 0) + (vipMonthQuota || 0)}`;
  }
  return '普通用户';
}

/** 节日氛围入口右侧文案：对用户不暴露后台；有生效节日时优先显示名称 */
function festivalMenuNote(fest) {
  if (!fest) return '敬请期待';
  if (fest.activeName && fest.activeName !== '无') return fest.activeName;
  if (!fest.userOn && fest.mode === 'auto') return '已关闭';
  if (!fest.featureOn && fest.mode === 'auto') return '敬请期待';
  if (fest.mode === 'off') return '已关闭';
  return '已开启';
}

/** 头像角标：VIP 红色 user-vip；积分礼盒；管理员「管」（预览时不显示管） */
function buildAvatarBadge({ isAdmin, isVip, points, vipMonthQuota, previewAsUser }) {
  if (!previewAsUser && isAdmin) {
    return { tone: 'admin', icon: 'user-vip', text: '管' };
  }
  if (isVip) {
    return { tone: 'vip', icon: 'user-vip', text: 'VIP' };
  }
  if ((points || 0) + (vipMonthQuota || 0) > 0) {
    return { tone: 'points', icon: 'gift', text: '' };
  }
  return null;
}

function buildRoleTagTheme({ isAdmin, isVip, points, vipMonthQuota, previewAsUser }) {
  if (!previewAsUser && isAdmin) return 'danger';
  if (isVip) return 'danger';
  if ((points || 0) + (vipMonthQuota || 0) > 0) return 'success';
  return 'default';
}

Page({
  data: {
    openid: '',
    isAdmin: false,
    canBeAdmin: false,
    previewAsUser: false,
    isVip: false,
    shortId: '',
    roleLabel: '普通用户',
    roleTagTheme: 'default',
    avatarBadge: null,
    nickName: '',
    avatarUrl: '',
    savingProfile: false,
    benefit: formatBenefitCard(),
    pricing: getPricingPlans(),
    pricingVisible: false,
    serviceWechat: config.serviceWechat || 'Shine_Luyang',
    genCodeKey: '',
    buyingKey: '',
    redeemCode: '',
    redeeming: false,
    lookupVisible: false,
    lookupId: '',
    notifyHint: '有新合集时通过微信提醒你',
    feedbackNotifyHint: '有新反馈时微信提醒你',
    themeStyle: '',
    themeBrand: '#07c160',
    themeId: 'wechat',
    themeName: '微信绿',
    themePresets: [],
    themePopupVisible: false,
    festivalMode: 'auto',
    festivalModeLabel: '跟随日期',
    festivalActiveName: '无',
    festivalMenuNote: '敬请期待',
    festivalFeatureOn: false,
    festivalUserOn: true,
    festivalFallFull: false,
    festivalPopupVisible: false,
    festivalModeOptions: [],
    festivalBannerItems: [],
    festivalBankItems: [],
    festivalAssetEdit: null,
    festivalBannerSpecLabel: `${FESTIVAL_BANNER_SPEC.width}×${FESTIVAL_BANNER_SPEC.height}`,
    festivalBankSpecLabel: `${FESTIVAL_BANK_SPEC.width}×${FESTIVAL_BANK_SPEC.height}`,
    /** '' | banner-upload | banner-reset | bank-upload | bank-reset */
    festivalAssetBusy: '',
    festivalCropVisible: false,
    festivalCropSrc: '',
    festivalCropKind: 'banner',
    festivalCropFestivalId: '',
    festivalCropTitle: '',
    festivalCropHint: '',
    festivalCropOutW: FESTIVAL_BANNER_SPEC.width,
    festivalCropOutH: FESTIVAL_BANNER_SPEC.height,
    festivalFeatureSaving: false,
    festivalWindowPickerVisible: false,
    festivalWindowPickerTitle: '选择日期',
    festivalWindowPickerMode: 'start',
    festivalWindowPickerValue: '',
    festivalWindowDraftStart: '',
    festivalWindowDraftEnd: '',
    feedbackVisible: false,
    feedbackContent: '',
    feedbackContact: '',
    feedbackFiles: [],
    feedbackGridConfig: { column: 4, width: 160, height: 160 },
    feedbackPickConfig: { sizeType: ['original'], sourceType: ['album'] },
    feedbackSubmitting: false,
    lotteryOpenCount: 0,
    gridLotteryOn: false,
    checkinVisible: false,
    guideVisible: false,
    guideSteps: [
      {
        title: '在趣集里选合集',
        desc: '打开首页，点进喜欢的合集，先预览封面和预览图。',
      },
      {
        title: '获取下载权限',
        desc: '在「我的」购买或兑换包月（每月 36 积分，月底清零）与积分（静态 1 积分 / 动态 2 积分）。',
      },
      {
        title: '保存原图到相册',
        desc: '在合集详情里选「静态」或「动态」，点对应原图的保存，授权相册后图片会存进手机相册。',
      },
      {
        title: '打开微信表情面板',
        desc: '回到微信，进入任意聊天，点输入框旁的表情图标，打开表情面板。',
      },
      {
        title: '进入「添加的单个表情」',
        desc: '点面板右上角设置（齿轮），进入「我的表情」→「添加的单个表情」（有的版本在「我」→「表情」→ 右上角设置）。',
      },
      {
        title: '从相册导入',
        desc: '点「+」→「从相册选择」，选中刚保存的图片或 GIF，按提示裁剪后点「完成 / 使用」。之后就能在自定义表情里发送了。',
      },
    ],
  },

  onShow() {
    this.syncThemeUi();
    applyThemeToTabBar();
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      const bar = this.getTabBar();
      if (typeof bar.setSelected === 'function') bar.setSelected('my');
      else bar.setData({ value: 'my' });
      if (typeof bar.syncTheme === 'function') bar.syncTheme();
      if (typeof bar.syncFestival === 'function') bar.syncFestival();
    }
    this.refreshIdentity();
    ensureFestivalModeForRole(!!this.data.isAdmin);
    this.syncProfileFromCloud();
    this.syncEntitlement();
    this.refreshNotifyStatus();
    this.refreshFeedbackNotifyStatus();
    this.refreshLotteryHint();
    this.maybeOpenCheckinPopup();
    loadFestivalConfig({ silent: true }).then(() => {
      ensureFestivalModeForRole(!!this.data.isAdmin);
      this.syncThemeUi();
      this.syncTabBarFestival();
    });
  },

  onShareAppMessage() {
    return shareAppMessage();
  },

  onShareTimeline() {
    return shareTimeline();
  },

  /** 仅手动点「补发权益」时触发，进页不再自动扫单 */
  onRecoverOrders() {
    this.recoverPendingOrders();
  },

  async recoverPendingOrders() {
    if (this._recoveringOrders) return;
    this._recoveringOrders = true;
    wx.showLoading({ title: '补发中', mask: true });
    try {
      const res = await recoverMyPendingOrders();
      wx.hideLoading();
      if (res && res.delivered > 0) {
        if (res.entitlement) this.refreshIdentity();
        await this.syncEntitlement();
        wx.showToast({
          title: res.message || '权益已补发',
          icon: 'success',
        });
        return;
      }
      if (res && res.failed > 0) {
        wx.showModal({
          title: '补发未成功',
          content: res.errorMessage || res.message || '发货失败，请查看云函数日志',
          showCancel: false,
        });
        return;
      }
      wx.showToast({
        title:
          res && res.scanned
            ? `已检查 ${res.scanned} 笔，无需补发`
            : '当前没有待补发订单',
        icon: 'none',
        duration: 2500,
      });
    } catch (e) {
      wx.hideLoading();
      wx.showModal({
        title: '补发异常',
        content: (e && e.message) || '补发失败',
        showCancel: false,
      });
    } finally {
      this._recoveringOrders = false;
    }
  },

  onLoad() {
    this.syncThemeUi();
    this._onEntitlementChange = () => this.refreshIdentity();
    try {
      const app = getApp();
      this._onAdminViewChange = () => this.refreshIdentity();
      if (app && app.eventBus) {
        app.eventBus.on('entitlementChange', this._onEntitlementChange);
        app.eventBus.on('adminViewChange', this._onAdminViewChange);
      }
    } catch (e) {
      /* ignore */
    }
  },

  onUnload() {
    try {
      const app = getApp();
      if (app && app.eventBus) {
        if (this._onEntitlementChange) app.eventBus.off('entitlementChange', this._onEntitlementChange);
        if (this._onAdminViewChange) app.eventBus.off('adminViewChange', this._onAdminViewChange);
      }
    } catch (e) {
      /* ignore */
    }
  },

  maybeOpenCheckinPopup() {
    try {
      const app = getApp();
      if (app.globalData && app.globalData.openCheckinPopup) {
        app.globalData.openCheckinPopup = false;
        this.setData({ checkinVisible: true });
      }
    } catch (e) {
      /* ignore */
    }
  },

  syncThemeUi() {
    const presets = getThemePresets();
    const themeId = getThemeId();
    const hit = presets.find((p) => p.id === themeId);
    const fest = getFestivalStatus();
    this.setData({
      themeStyle: getThemeStyle(),
      themeBrand: getThemeBrand(),
      themeId,
      themeName: (hit && hit.name) || '微信绿',
      themePresets: presets,
      festivalMode: fest.mode,
      festivalModeLabel: fest.modeLabel,
      festivalActiveName: fest.activeName,
      festivalMenuNote: festivalMenuNote(fest),
      festivalFeatureOn: !!fest.featureOn,
      festivalUserOn: !!fest.userOn,
      festivalFallFull: isFestivalFallFull(),
      festivalModeOptions: getFestivalModeOptions(),
    });
  },

  async openPricing() {
    const cached = getPricingPlans();
    this.setData({ pricingVisible: true, pricing: cached });
    try {
      const pricing = await loadPricingPlans();
      if (this.data.pricingVisible && pricing) this.setData({ pricing });
    } catch (e) {
      /* keep cache / config */
    }
  },

  closePricing() {
    this.setData({ pricingVisible: false });
  },

  onPricingVisibleChange(e) {
    const visible = !!(e.detail && e.detail.visible);
    this.setData({ pricingVisible: visible });
  },

  copyServiceWechat() {
    const wxid = this.data.serviceWechat || (this.data.pricing && this.data.pricing.serviceWechat) || '';
    if (!wxid) {
      wx.showToast({ title: '暂无客服微信', icon: 'none' });
      return;
    }
    wx.setClipboardData({
      data: wxid,
      success: () => wx.showToast({ title: '微信号已复制', icon: 'success' }),
    });
  },

  async onBuyPlan(e) {
    if (this.data.buyingKey || this.data.genCodeKey) return;
    const key = e.currentTarget.dataset.key;
    const kind = e.currentTarget.dataset.kind;
    const pricing = this.data.pricing || getPricingPlans();
    if (!pricing.virtualPayEnabled) {
      wx.showToast({ title: '暂未开通在线购买', icon: 'none' });
      return;
    }
    const list = kind === 'points' ? pricing.pointPlans : pricing.vipPlans;
    const plan = (list || []).find((p) => p.key === key);
    if (!plan) return;

    this.setData({ buyingKey: key });
    wx.showLoading({ title: '下单中', mask: true });
    try {
      const result = await buyPlan(plan);
      wx.hideLoading();
      if (result && result.entitlement) {
        setCachedEntitlement(result.entitlement);
        this.refreshIdentity();
      }
      await this.syncEntitlement();
      wx.showToast({
        title: (result && result.message) || '购买成功',
        icon: 'success',
      });
    } catch (err) {
      wx.hideLoading();
      if (err && err.code === 'CANCEL') {
        wx.showToast({ title: '已取消支付', icon: 'none' });
      } else if (err && err.code === 'IOS_VERSION') {
        /* modal already shown */
      } else {
        wx.showToast({ title: (err && err.message) || '购买失败', icon: 'none' });
      }
    } finally {
      this.setData({ buyingKey: '' });
    }
  },

  async onAdminGenPlanCode(e) {
    if (!this.data.isAdmin && !resolveIsAdmin()) return;
    if (this.data.genCodeKey || this.data.buyingKey) return;
    const key = e.currentTarget.dataset.key;
    const kind = e.currentTarget.dataset.kind;
    const pricing = this.data.pricing || getPricingPlans();
    const list = kind === 'points' ? pricing.pointPlans : pricing.vipPlans;
    const plan = (list || []).find((p) => p.key === key);
    if (!plan) return;

    this.setData({ genCodeKey: key });
    wx.showLoading({ title: '生成中', mask: true });
    try {
      const result = await createAndCopyCode(plan, { count: 1 });
      wx.showToast({
        title: `${result.label || plan.title} 已复制`,
        icon: 'success',
      });
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '生成失败', icon: 'none' });
    } finally {
      wx.hideLoading();
      this.setData({ genCodeKey: '' });
    }
  },

  openThemePicker() {
    this.setData({
      themePopupVisible: true,
      themePresets: getThemePresets(),
      themeId: getThemeId(),
    });
  },

  openFeedback() {
    this.setData({ feedbackVisible: true });
  },

  closeFeedback() {
    this.setData({ feedbackVisible: false });
  },

  onFeedbackVisibleChange(e) {
    const visible = !!(e.detail && e.detail.visible);
    this.setData({ feedbackVisible: visible });
  },

  onFeedbackContentChange(e) {
    const v =
      (e.detail && (e.detail.value != null ? e.detail.value : e.detail)) || '';
    this.setData({ feedbackContent: String(v) });
  },

  onFeedbackContactChange(e) {
    const v =
      (e.detail && (e.detail.value != null ? e.detail.value : e.detail)) || '';
    this.setData({ feedbackContact: String(v) });
  },

  onFeedbackUploadSuccess(e) {
    const files = (e.detail && e.detail.files) || [];
    this.setData({ feedbackFiles: files.slice(0, 3) });
  },

  onFeedbackUploadRemove(e) {
    const index = e.detail && e.detail.index;
    const files = (this.data.feedbackFiles || []).slice();
    if (typeof index === 'number' && index >= 0 && index < files.length) {
      files.splice(index, 1);
      this.setData({ feedbackFiles: files });
    }
  },

  pickFeedbackLocalPath(file) {
    return (file && (file.url || file.path || file.tempFilePath)) || '';
  },

  async uploadFeedbackImages(files) {
    const list = (files || []).slice(0, 3);
    if (!list.length) return [];
    const openid = getOpenId() || 'anon';
    const stamp = Date.now();
    const ids = [];
    for (let i = 0; i < list.length; i += 1) {
      const file = list[i];
      if (file.fileID && String(file.fileID).startsWith('cloud://')) {
        ids.push(file.fileID);
        // eslint-disable-next-line no-continue
        continue;
      }
      const local = this.pickFeedbackLocalPath(file);
      if (!local) {
        // eslint-disable-next-line no-continue
        continue;
      }
      if (String(local).startsWith('cloud://')) {
        ids.push(local);
        // eslint-disable-next-line no-continue
        continue;
      }
      const name = String(file.name || local).split(/[/\\]/).pop() || `img_${i}.jpg`;
      const ext = (name.split('.').pop() || 'jpg').split('?')[0].toLowerCase() || 'jpg';
      const cloudPath = `feedback/${openid}/${stamp}_${i}.${ext}`;
      // eslint-disable-next-line no-await-in-loop
      const fileID = await uploadFile(cloudPath, local);
      ids.push(fileID);
    }
    return ids;
  },

  async onSubmitFeedback() {
    if (this.data.feedbackSubmitting) return;
    const content = String(this.data.feedbackContent || '').trim();
    if (content.length < 2) {
      wx.showToast({ title: '请多写一点建议', icon: 'none' });
      return;
    }
    this.setData({ feedbackSubmitting: true });
    try {
      const images = await this.uploadFeedbackImages(this.data.feedbackFiles);
      await callFunction('submitFeedback', {
        content,
        contact: String(this.data.feedbackContact || '').trim(),
        images,
      });
      this.setData({
        feedbackVisible: false,
        feedbackContent: '',
        feedbackContact: '',
        feedbackFiles: [],
        feedbackSubmitting: false,
      });
      wx.showToast({ title: '已收到，谢谢', icon: 'success' });
    } catch (e) {
      this.setData({ feedbackSubmitting: false });
      wx.showToast({ title: (e && e.message) || '提交失败', icon: 'none' });
    }
  },

  onThemePopupChange(e) {
    const visible = !!(e.detail && e.detail.visible);
    this.setData({ themePopupVisible: visible });
  },

  onPickTheme(e) {
    const id =
      (e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id) || '';
    if (!id) return;
    const theme = setThemeId(id);
    applyThemeToTabBar();
    this.setData({
      themeStyle: getThemeStyle(),
      themeBrand: theme.brand,
      themeId: theme.id,
      themeName: theme.name,
      themePresets: getThemePresets(),
      themePopupVisible: false,
    });
    wx.showToast({ title: '主题已更新', icon: 'success' });
  },

  openFestivalPicker() {
    this.setData({
      festivalPopupVisible: true,
      festivalMode: getFestivalMode(),
      festivalModeOptions: getFestivalModeOptions(),
      festivalFeatureOn: isFestivalFeatureEnabled(),
      festivalUserOn: isFestivalUserOn(),
      festivalFallFull: isFestivalFallFull(),
    });
    /* 先用本地缓存渲染预览图，避免连点两次换签导致图片闪两次 */
    if (this.data.isAdmin) this.refreshFestivalAssetItems();
    loadFestivalConfig({ silent: true }).then(() => {
      this.setData({
        festivalFeatureOn: isFestivalFeatureEnabled(),
        festivalUserOn: isFestivalUserOn(),
        festivalFallFull: isFestivalFallFull(),
      });
      this.syncThemeUi();
      if (this.data.isAdmin) this.refreshFestivalAssetItems();
    });
  },

  onFestivalPopupChange(e) {
    const visible = !!(e.detail && e.detail.visible);
    this.setData({ festivalPopupVisible: visible });
  },

  /** 走节日临时链缓存，同 fileID 复用同一 URL，避免预览图反复换签重载 */
  async _resolveCloudPreviewMap(ids) {
    const list = (ids || []).filter(Boolean);
    const urlMap = {};
    if (!list.length) return urlMap;
    try {
      const urls = await resolveFestivalSrcs(list);
      list.forEach((id, i) => {
        if (id) urlMap[id] = urls[i] || '';
      });
    } catch (e) {
      /* ignore */
    }
    return urlMap;
  },

  buildFestivalAssetEdit(banners, banks) {
    const id = String(this.data.festivalMode || '').trim();
    if (!id || id === 'auto' || id === 'off') return null;
    const banner = (banners || []).find((it) => it.id === id);
    const bank = (banks || []).find((it) => it.id === id);
    if (!banner && !bank) return null;
    const window = getFestivalWindowInfo(id);
    return {
      id,
      name: (banner && banner.name) || (bank && bank.name) || id,
      banner: banner || { hasCustom: false, previewUrl: '' },
      bank: bank || { hasCustom: false, fallback: false, previewUrl: '' },
      window,
    };
  },

  async refreshFestivalAssetItems() {
    const seq = (this._festAssetSeq = (this._festAssetSeq || 0) + 1);
    const bannersRaw = getFestivalBannerAdminItems();
    const banksRaw = getFestivalBankAdminItems();
    const urlMap = await this._resolveCloudPreviewMap([
      ...bannersRaw.map((it) => it.override),
      ...banksRaw.map((it) => it.override),
      ...banksRaw.map((it) => it.fallback),
    ]);
    if (seq !== this._festAssetSeq) return;
    const prevBanner = {};
    (this.data.festivalBannerItems || []).forEach((it) => {
      if (it && it.id && it.previewUrl) prevBanner[it.id] = it.previewUrl;
    });
    const prevBank = {};
    (this.data.festivalBankItems || []).forEach((it) => {
      if (it && it.id && it.previewUrl) prevBank[it.id] = it.previewUrl;
    });
    const festivalBannerItems = bannersRaw.map((it) => {
      let previewUrl = '';
      if (it.hasCustom) {
        previewUrl = isCloudFileId(it.override)
          ? urlMap[it.override] || prevBanner[it.id] || ''
          : it.override || '';
      }
      return {
        id: it.id,
        name: it.name,
        hasCustom: it.hasCustom,
        previewUrl,
      };
    });
    const festivalBankItems = banksRaw.map((it) => {
      let previewUrl = '';
      if (it.hasCustom) {
        previewUrl = isCloudFileId(it.override)
          ? urlMap[it.override] || prevBank[it.id] || ''
          : it.override || '';
      } else if (it.fallback) {
        previewUrl = isCloudFileId(it.fallback)
          ? urlMap[it.fallback] || prevBank[it.id] || ''
          : it.fallback;
      }
      return {
        id: it.id,
        name: it.name,
        hasCustom: it.hasCustom,
        fallback: !!it.fallback,
        previewUrl,
      };
    });
    this.setData({
      festivalBannerItems,
      festivalBankItems,
      festivalAssetEdit: this.buildFestivalAssetEdit(
        festivalBannerItems,
        festivalBankItems,
      ),
    });
  },

  openFestivalCrop(kind, festivalId, localPath) {
    const isBank = kind === 'bank';
    const spec = isBank ? FESTIVAL_BANK_SPEC : FESTIVAL_BANNER_SPEC;
    /* 先收起节日弹层，避免 t-popup 盖住裁剪全屏层 */
    this._festivalPopupBeforeCrop = !!this.data.festivalPopupVisible;
    this.setData({
      festivalPopupVisible: false,
      festivalCropVisible: true,
      festivalCropSrc: localPath,
      festivalCropKind: kind,
      festivalCropFestivalId: festivalId,
      festivalCropOutW: spec.width,
      festivalCropOutH: spec.height,
      festivalCropTitle: isBank ? '裁剪底栏背景' : '裁剪导航顶栏',
      festivalCropHint: `单指拖动，双指缩放 · 导出 ${spec.width}×${spec.height}`,
    });
  },

  closeFestivalCrop({ reopenPopup } = {}) {
    const reopen =
      reopenPopup !== false && this._festivalPopupBeforeCrop;
    this._festivalPopupBeforeCrop = false;
    this.setData({
      festivalCropVisible: false,
      festivalCropSrc: '',
      festivalCropFestivalId: '',
      festivalPopupVisible: reopen,
    });
    if (reopen && this.data.isAdmin) {
      this.refreshFestivalAssetItems();
    }
  },

  onFestivalCropCancel() {
    this.closeFestivalCrop({ reopenPopup: true });
  },

  async onFestivalCropConfirm(e) {
    const tempFilePath =
      (e && e.detail && e.detail.tempFilePath) || '';
    const id = this.data.festivalCropFestivalId;
    const kind = this.data.festivalCropKind;
    if (!tempFilePath || !id) {
      this.closeFestivalCrop({ reopenPopup: true });
      return;
    }
    const busyKey = kind === 'bank' ? 'bank-upload' : 'banner-upload';
    this.setData({ festivalAssetBusy: busyKey });
    this.closeFestivalCrop({ reopenPopup: true });
    try {
      const folder = kind === 'bank' ? 'banks' : 'banners';
      const cloudPath = `festival/${folder}/${id}_${Date.now()}.png`;
      const fileID = await uploadFile(cloudPath, tempFilePath);
      if (kind === 'bank') await saveFestivalBank(id, fileID);
      else await saveFestivalBanner(id, fileID);
      await this.refreshFestivalAssetItems();
      this.syncTabBarFestival();
      wx.showToast({
        title: kind === 'bank' ? '底栏图已更新' : '顶栏图已更新',
        icon: 'success',
      });
    } catch (err) {
      wx.showToast({
        title: (err && err.message) || '上传失败',
        icon: 'none',
      });
    } finally {
      this.setData({ festivalAssetBusy: '' });
    }
  },

  onUploadFestivalBanner(e) {
    if (!this.data.isAdmin || this.data.festivalAssetBusy) return;
    const id =
      (e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id) || '';
    if (!id) return;
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['original'],
      success: (res) => {
        const file = (res.tempFiles && res.tempFiles[0]) || {};
        const local = file.tempFilePath || '';
        if (!local) return;
        this.openFestivalCrop('banner', id, local);
      },
    });
  },

  async onResetFestivalBanner(e) {
    if (!this.data.isAdmin || this.data.festivalAssetBusy) return;
    const id =
      (e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id) || '';
    if (!id) return;
    this.setData({ festivalAssetBusy: 'banner-reset' });
    try {
      await clearFestivalBanner(id);
      await this.refreshFestivalAssetItems();
      this.syncTabBarFestival();
      wx.showToast({ title: '已清除', icon: 'none' });
    } catch (err) {
      wx.showToast({
        title: (err && err.message) || '清除失败',
        icon: 'none',
      });
    } finally {
      this.setData({ festivalAssetBusy: '' });
    }
  },

  onUploadFestivalBank(e) {
    if (!this.data.isAdmin || this.data.festivalAssetBusy) return;
    const id =
      (e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id) || '';
    if (!id) return;
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['original'],
      success: (res) => {
        const file = (res.tempFiles && res.tempFiles[0]) || {};
        const local = file.tempFilePath || '';
        if (!local) return;
        this.openFestivalCrop('bank', id, local);
      },
    });
  },

  async onResetFestivalBank(e) {
    if (!this.data.isAdmin || this.data.festivalAssetBusy) return;
    const id =
      (e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id) || '';
    if (!id) return;
    this.setData({ festivalAssetBusy: 'bank-reset' });
    try {
      await clearFestivalBank(id);
      await this.refreshFestivalAssetItems();
      this.syncTabBarFestival();
      wx.showToast({ title: '已清除', icon: 'none' });
    } catch (err) {
      wx.showToast({
        title: (err && err.message) || '清除失败',
        icon: 'none',
      });
    } finally {
      this.setData({ festivalAssetBusy: '' });
    }
  },

  onPickFestivalMode(e) {
    if (!this.data.isAdmin) return;
    const id =
      (e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id) ||
      (e.target && e.target.dataset && e.target.dataset.id) ||
      '';
    if (!id) return;
    /* check-tag 点已选项会取消勾选：强制保持选中 */
    if (id === this.data.festivalMode) {
      this.setData({ festivalMode: id });
      return;
    }
    setFestivalMode(id);
    this.syncThemeUi();
    this.syncTabBarFestival();
    /* 只用已解析好的预览列表切换，不再整表换签，避免顶栏/底栏图闪多次 */
    this.setData({
      festivalMode: id,
      festivalAssetEdit: this.buildFestivalAssetEdit(
        this.data.festivalBannerItems,
        this.data.festivalBankItems,
      ),
    });
    let toast = '预览已切换，回首页查看';
    if (id === 'off') toast = '已关闭节日装饰';
    else if (id === 'auto') {
      if (!isFestivalFeatureEnabled()) {
        toast = '跟随日期：本机可预览；用户需先开「全员可见」';
      } else if (!isFestivalUserOn()) {
        toast = '请先打开「开启节日效果」';
      } else {
        const active = getFestivalStatus().activeName;
        toast =
          active && active !== '无'
            ? `今日：${active}，回首页查看`
            : '今日不在节日窗口，回首页无装饰';
      }
    }
    wx.showToast({ title: toast, icon: 'none' });
  },

  openFestivalWindowPicker(e) {
    if (!this.data.isAdmin || this.data.festivalAssetBusy) return;
    const which =
      (e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.which) ||
      'start';
    const edit = this.data.festivalAssetEdit;
    if (!edit || !edit.window) return;
    const win = edit.window;
    const value =
      which === 'end' ? win.pickerEnd || win.pickerStart : win.pickerStart || win.pickerEnd;
    this.setData({
      festivalWindowPickerMode: which === 'end' ? 'end' : 'start',
      festivalWindowPickerTitle: which === 'end' ? '结束日期' : '开始日期',
      festivalWindowPickerValue: value,
      festivalWindowDraftStart: win.pickerStart || '',
      festivalWindowDraftEnd: win.pickerEnd || '',
      festivalWindowPickerVisible: true,
    });
  },

  onCloseFestivalWindowPicker() {
    this.setData({ festivalWindowPickerVisible: false });
  },

  async onFestivalWindowPickerConfirm(e) {
    const raw =
      (e && e.detail && (e.detail.value || e.detail)) ||
      this.data.festivalWindowPickerValue ||
      '';
    const ymd = String(raw).trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
      this.setData({ festivalWindowPickerVisible: false });
      wx.showToast({ title: '日期无效', icon: 'none' });
      return;
    }
    const mode = this.data.festivalWindowPickerMode;
    let start = this.data.festivalWindowDraftStart || '';
    let end = this.data.festivalWindowDraftEnd || '';
    if (mode === 'end') end = ymd;
    else start = ymd;
    const id =
      (this.data.festivalAssetEdit && this.data.festivalAssetEdit.id) || '';
    this.setData({
      festivalWindowPickerVisible: false,
      festivalWindowDraftStart: start,
      festivalWindowDraftEnd: end,
    });
    if (!id || !start || !end) {
      /* 只改了一端：打开另一端继续选 */
      const nextWhich = mode === 'start' ? 'end' : 'start';
      const edit = this.data.festivalAssetEdit;
      const win = (edit && edit.window) || {};
      this.setData({
        festivalWindowPickerMode: nextWhich,
        festivalWindowPickerTitle: nextWhich === 'end' ? '结束日期' : '开始日期',
        festivalWindowPickerValue:
          nextWhich === 'end'
            ? end || win.pickerEnd || start
            : start || win.pickerStart || end,
        festivalWindowPickerVisible: true,
      });
      return;
    }
    this.setData({ festivalAssetBusy: 'window-save' });
    try {
      await saveFestivalWindow(id, start, end);
      this.setData({
        festivalAssetEdit: this.buildFestivalAssetEdit(
          this.data.festivalBannerItems,
          this.data.festivalBankItems,
        ),
      });
      this.syncThemeUi();
      this.syncTabBarFestival();
      wx.showToast({ title: '日期已更新', icon: 'success' });
    } catch (err) {
      wx.showToast({
        title: (err && err.message) || '保存失败',
        icon: 'none',
      });
    } finally {
      this.setData({ festivalAssetBusy: '' });
    }
  },

  async onResetFestivalWindow() {
    if (!this.data.isAdmin || this.data.festivalAssetBusy) return;
    const id =
      (this.data.festivalAssetEdit && this.data.festivalAssetEdit.id) || '';
    if (!id) return;
    this.setData({ festivalAssetBusy: 'window-reset' });
    try {
      await clearFestivalWindow(id);
      this.setData({
        festivalAssetEdit: this.buildFestivalAssetEdit(
          this.data.festivalBannerItems,
          this.data.festivalBankItems,
        ),
      });
      this.syncThemeUi();
      this.syncTabBarFestival();
      wx.showToast({ title: '已恢复默认', icon: 'none' });
    } catch (err) {
      wx.showToast({
        title: (err && err.message) || '恢复失败',
        icon: 'none',
      });
    } finally {
      this.setData({ festivalAssetBusy: '' });
    }
  },

  async onFestivalFeatureChange(e) {
    if (!this.data.isAdmin || this.data.festivalFeatureSaving) return;
    const on = !!(e.detail && e.detail.value);
    this.setData({ festivalFeatureSaving: true, festivalFeatureOn: on });
    try {
      await setFestivalFeatureEnabled(on);
      this.syncThemeUi();
      this.syncTabBarFestival();
      wx.showToast({
        title: on ? '已开启全员可见' : '已改为仅本机预览',
        icon: 'none',
      });
    } catch (err) {
      this.setData({ festivalFeatureOn: isFestivalFeatureEnabled() });
      wx.showToast({
        title: (err && err.message) || '保存失败',
        icon: 'none',
      });
    } finally {
      this.setData({ festivalFeatureSaving: false });
    }
  },

  onFestivalUserChange(e) {
    if (!isFestivalFeatureEnabled() && !this.data.isAdmin) {
      this.setData({ festivalUserOn: isFestivalUserOn() });
      wx.showToast({ title: '近期暂无节日活动', icon: 'none' });
      return;
    }
    const on = !!(e.detail && e.detail.value);
    setFestivalUserOn(on);
    this.setData({ festivalUserOn: on });
    this.syncThemeUi();
    this.syncTabBarFestival();
    wx.showToast({
      title: on ? '已开启节日效果' : '已关闭节日效果',
      icon: 'none',
    });
  },

  onFestivalFallFullChange(e) {
    const on = !!(e.detail && e.detail.value);
    setFestivalFallFull(on);
    this.setData({ festivalFallFull: on });
    this.syncThemeUi();
    wx.showToast({
      title: on ? '已改为全屏飘落' : '已改为仅顶栏飘落',
      icon: 'none',
    });
  },

  syncTabBarFestival() {
    try {
      if (typeof this.getTabBar === 'function') {
        const bar = this.getTabBar();
        if (bar && typeof bar.syncFestival === 'function') bar.syncFestival();
      }
    } catch (err) {
      /* ignore */
    }
  },

  refreshIdentity() {
    const app = getApp();
    const openid = app.globalData.openid || getOpenId();
    const previewAsUser = isPreviewAsUser();
    const adminCapable = canBeAdmin();
    const isAdmin = resolveIsAdmin();
    const entitlement = getCachedEntitlement();
    const isVip = !!entitlement.isVip;
    const cached = app.globalData.userInfo || getUserProfile() || {};
    const pricing = getPricingPlans();

    const roleOpts = {
      isAdmin,
      isVip,
      points: entitlement.points,
      vipMonthQuota: entitlement.vipMonthQuota,
      previewAsUser,
    };
    const patch = {
      openid,
      isAdmin,
      canBeAdmin: adminCapable,
      previewAsUser,
      isVip,
      shortId: openid ? `${openid.slice(0, 6)}…${openid.slice(-4)}` : '未登录',
      nickName: cached.nickName || '',
      benefit: formatBenefitCard(entitlement),
      roleLabel: buildRoleLabel(roleOpts),
      roleTagTheme: buildRoleTagTheme(roleOpts),
      avatarBadge: buildAvatarBadge(roleOpts),
      pricing,
      serviceWechat: pricing.serviceWechat || config.serviceWechat || 'Shine_Luyang',
    };

    // 无可用头像链时用 Pixabot；有云文件则等 ensureCloudAvatarUrl 换链
    patch.avatarUrl = resolveDisplayAvatarUrl({
      avatarFileID: cached.avatarFileID || '',
      avatarUrl: cached.avatarUrl || '',
      avatarUrlAt: cached.avatarUrlAt || 0,
      openid,
    });

    this.setData(patch);
  },

  onTogglePreviewAsUser() {
    const next = !this.data.previewAsUser;
    setPreviewAsUser(next);
    this.refreshIdentity();
    applyThemeToTabBar();
    wx.showToast({
      title: next ? '已切换为普通用户预览' : '已恢复管理员视图',
      icon: 'none',
    });
  },

  async syncEntitlement() {
    try {
      const res = await callFunction('userEntitlement', { action: 'get' });
      if (res.entitlement) {
        setCachedEntitlement(res.entitlement);
        this.refreshIdentity();
      }
      applyPendingPointGifts(res && res.pendingPointGifts);
      applyPendingLotteryInvites(res && res.pendingLotteryInvites, {
        replace: true,
      });
      // entitlement 不再下发开奖结果，勿 replace 清空
      applyPendingLotteryResults(res && res.pendingLotteryResults);
    } catch (e) {
      /* ignore */
    }
  },

  async syncProfileFromCloud() {
    try {
      const res = await callFunction('login');
      if (!res.openid) return;
      applyLoginResult(res);
      applyPendingPointGifts(res.pendingPointGifts);
      applyPendingLotteryInvites(res.pendingLotteryInvites, { replace: true });
      applyPendingLotteryResults(res.pendingLotteryResults);
      const fromLogin = pricingFromLoginPayload(res);
      if (fromLogin) this.setData({ pricing: fromLogin });
      const profile = getUserProfile() || {};
      // 云函数已换链则直接用；否则 / 链不新鲜时客户端再换一次
      if (
        hasCloudAvatar(profile.avatarFileID) &&
        (!profile.avatarUrl || !isAvatarTempUrlFresh(profile.avatarUrlAt))
      ) {
        await this.ensureCloudAvatarUrl(true);
      }
      this.refreshIdentity();
    } catch (e) {
      /* ignore */
    }
  },

  /** 按 fileID 换临时 https，避免缓存过期链导致头像 X */
  async ensureCloudAvatarUrl() {
    const profile = getUserProfile() || {};
    const fileID = profile.avatarFileID || '';
    if (!hasCloudAvatar(fileID)) return;
    if (this._avatarRefreshing) return;
    this._avatarRefreshing = true;
    try {
      const urls = await getTempFileURLs([fileID]);
      const url = (urls && urls[0]) || '';
      if (!url) return;
      applyLoginResult({
        avatarFileID: fileID,
        avatarUrl: url,
        nickName: profile.nickName,
      });
    } catch (e) {
      /* ignore */
    } finally {
      this._avatarRefreshing = false;
    }
  },

  async onAvatarError() {
    if (this._avatarErrorHandled) return;
    this._avatarErrorHandled = true;
    const profile = getUserProfile() || {};
    if (!hasCloudAvatar(profile.avatarFileID)) return;
    applyLoginResult({
      avatarFileID: profile.avatarFileID,
      avatarUrl: '',
      nickName: profile.nickName,
    });
    await this.ensureCloudAvatarUrl();
    this.refreshIdentity();
    setTimeout(() => {
      this._avatarErrorHandled = false;
    }, 3000);
  },

  async saveProfile(patch) {
    if (this.data.savingProfile) return;
    this.setData({ savingProfile: true });
    try {
      const res = await callFunction('login', {
        action: 'updateProfile',
        ...patch,
      });
      applyLoginResult(res);
      this.refreshIdentity();
      wx.showToast({ title: '已更新', icon: 'success' });
    } catch (e) {
      wx.showToast({ title: e.message || '保存失败', icon: 'none' });
    } finally {
      this.setData({ savingProfile: false });
    }
  },

  async onChooseAvatar(e) {
    const tempPath = e.detail && e.detail.avatarUrl;
    if (!tempPath) return;
    this.setData({ avatarUrl: tempPath });
    wx.showLoading({ title: '上传头像', mask: true });
    try {
      const openid = getOpenId() || 'anon';
      const cloudPath = `avatars/${openid}_${Date.now()}.jpg`;
      const fileID = await uploadFile(cloudPath, tempPath);
      await this.saveProfile({ avatarFileID: fileID });
    } catch (err) {
      wx.showToast({ title: err.message || '头像上传失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  onNickChange(e) {
    this.setData({ nickName: (e.detail && e.detail.value) || '' });
  },

  onNickBlur(e) {
    const nickName = ((e.detail && e.detail.value) || this.data.nickName || '').trim();
    if (!nickName) return;
    const prev = (getUserProfile() || {}).nickName || '';
    if (nickName === prev) return;
    this.saveProfile({ nickName });
  },

  async refreshNotifyStatus() {
    try {
      const credits = await fetchNewPackSubscribeStatus();
      this.setData({
        notifyHint:
          credits > 0
            ? '已开启，点击可加强提醒'
            : '有新合集时通过微信提醒你',
      });
    } catch (e) {
      /* ignore */
    }
  },

  async onSubscribeNewPack() {
    try {
      const res = await requestNewPackSubscribe();
      if (res.accepted) {
        this.setData({ notifyHint: '已开启，点击可加强提醒' });
        wx.showToast({ title: '已开启提醒', icon: 'success' });
      } else {
        wx.showToast({ title: '未开启提醒', icon: 'none' });
      }
    } catch (e) {
      const msg = (e && (e.errMsg || e.message)) || '订阅失败';
      wx.showToast({ title: msg.slice(0, 40), icon: 'none' });
    }
  },

  async refreshFeedbackNotifyStatus() {
    if (!resolveIsAdmin()) {
      this.setData({ feedbackNotifyHint: '有新反馈时微信提醒你' });
      return;
    }
    try {
      const credits = await fetchFeedbackNotifyStatus();
      this.setData({
        feedbackNotifyHint:
          credits > 0
            ? `还可收 ${credits} 条，点击可加强`
            : '有新反馈时微信提醒你',
      });
    } catch (e) {
      /* ignore */
    }
  },

  async onSubscribeFeedbackNotify() {
    try {
      const res = await requestFeedbackNotifySubscribe();
      if (res.accepted) {
        const credits = res.credits || 0;
        this.setData({
          feedbackNotifyHint:
            credits > 0
              ? `还可收 ${credits} 条，点击可加强`
              : '已开启，点击可加强',
        });
        wx.showToast({ title: '已开启反馈通知', icon: 'success' });
      } else {
        wx.showToast({ title: '未开启通知', icon: 'none' });
      }
    } catch (e) {
      const msg = (e && (e.errMsg || e.message)) || '订阅失败';
      wx.showToast({ title: msg.slice(0, 40), icon: 'none' });
    }
  },

  onRedeemInput(e) {
    const raw = (e.detail && e.detail.value) || '';
    // 粘贴整段权益文案时自动提取码
    const extracted = extractRedeemCode(raw);
    this.setData({ redeemCode: extracted || raw });
  },

  /** 用户主动点「粘贴」才读剪贴板，避免每次进页被微信提示「读取了剪贴板」 */
  async onPasteRedeem() {
    if (this.data.redeeming) return;
    const code = await readClipboardRedeemCode();
    if (!code) {
      wx.showToast({ title: '剪贴板里没有兑换码', icon: 'none' });
      return;
    }
    this.setData({ redeemCode: code });
    wx.showModal({
      title: '识别到兑换码',
      content: `兑换码 ${code}，是否立即兑换？`,
      confirmText: '立即兑换',
      cancelText: '先填入',
      success: (r) => {
        if (r.confirm) this.onRedeem();
      },
    });
  },

  async onRedeem() {
    if (this.data.redeeming) return;
    const raw = (this.data.redeemCode || '').trim();
    const code = extractRedeemCode(raw) || raw;
    if (!code) {
      wx.showToast({ title: '请输入兑换码', icon: 'none' });
      return;
    }
    this.setData({ redeeming: true });
    wx.showLoading({ title: '兑换中', mask: true });
    try {
      const res = await callFunction('userEntitlement', { action: 'redeem', code });
      if (res.entitlement) setCachedEntitlement(res.entitlement);
      this.setData({ redeemCode: '' });
      this.refreshIdentity();
      wx.showToast({ title: res.message || '兑换成功', icon: 'success' });
    } catch (e) {
      wx.showToast({ title: e.message || '兑换失败', icon: 'none' });
    } finally {
      wx.hideLoading();
      this.setData({ redeeming: false });
    }
  },

  goUpload() {
    if (!resolveIsAdmin()) return;
    wx.navigateTo({ url: '/pages/admin/upload/index' });
  },

  goCategories() {
    if (!resolveIsAdmin()) return;
    wx.navigateTo({ url: '/pages/admin/categories/index' });
  },

  goCodes() {
    if (!resolveIsAdmin()) return;
    wx.navigateTo({ url: '/pages/admin/codes/index' });
  },

  goPointsLog() {
    wx.navigateTo({ url: '/pages/history/points-log/index' });
  },

  goFavorites() {
    wx.navigateTo({ url: '/pages/history/favorites/index' });
  },

  goAbout() {
    wx.navigateTo({ url: '/pages/about/index' });
  },

  goDashboard() {
    if (!resolveIsAdmin()) return;
    wx.navigateTo({ url: '/pages/admin/dashboard/index' });
  },

  goUsers() {
    if (!resolveIsAdmin()) return;
    wx.navigateTo({ url: '/pages/admin/users/index' });
  },

  goCheckin() {
    this.setData({ checkinVisible: true });
  },

  onCheckinVisibleChange(e) {
    const visible = !!(e.detail && e.detail.visible);
    this.setData({ checkinVisible: visible });
  },

  onCheckinClose() {
    this.setData({ checkinVisible: false });
  },

  onCheckinSuccess() {
    this.syncEntitlement();
    this.refreshIdentity();
  },

  goPointsSettings() {
    if (!resolveIsAdmin()) return;
    wx.navigateTo({ url: '/pages/admin/points/index' });
  },

  goPricingSettings() {
    if (!resolveIsAdmin()) return;
    wx.navigateTo({ url: '/pages/admin/pricing/index' });
  },

  goAdminLottery() {
    if (!resolveIsAdmin()) return;
    wx.navigateTo({ url: '/pages/admin/lottery/index' });
  },

  async refreshLotteryHint() {
    try {
      const [gridRes, listRes] = await Promise.all([
        callFunction('gridLottery', { action: 'get' }).catch(() => null),
        callFunction('userLottery', { action: 'list' }).catch(() => null),
      ]);
      const gridLotteryOn = !!(gridRes && gridRes.data && gridRes.data.enabled !== false);
      const list = (listRes && listRes.data && listRes.data.list) || [];
      const lotteryOpenCount = list.filter((item) => item && item.status === 'open').length;
      this.setData({ gridLotteryOn, lotteryOpenCount });
    } catch (e) {
      /* ignore */
    }
  },

  goLottery() {
    wx.navigateTo({ url: '/pages/lottery/index/index' });
  },

  openGuide() {
    this.setData({ guideVisible: true });
  },

  closeGuide() {
    this.setData({ guideVisible: false });
  },

  onGuideVisibleChange(e) {
    this.setData({
      guideVisible: !!(e.detail && e.detail.visible),
    });
  },

  openLookup() {
    if (!resolveIsAdmin()) return;
    this.setData({ lookupVisible: true, lookupId: '' });
  },

  onLookupIdChange(e) {
    this.setData({ lookupId: (e.detail && e.detail.value) || '' });
  },

  onLookupCancel() {
    this.setData({ lookupVisible: false, lookupId: '' });
  },

  async onLookupConfirm() {
    if (!resolveIsAdmin()) return;
    const packId = String(this.data.lookupId || '').trim();
    this.setData({ lookupVisible: false });
    if (!packId) {
      wx.showToast({ title: '请粘贴作品 ID', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '查询中', mask: true });
    try {
      const res = await callFunction('adminGetPack', { packId });
      wx.hideLoading();
      const pack = (res && res.data) || {};
      const lines = [
        pack.staticDriveUrl ? `静态：${pack.staticDriveUrl}` : '静态：未填',
        pack.animDriveUrl ? `动态：${pack.animDriveUrl}` : '动态：未填',
      ];
      wx.showModal({
        title: pack.title || '网盘链接',
        content: lines.join('\n'),
        confirmText: '去详情',
        cancelText: '关闭',
        success: (r) => {
          if (r.confirm) {
            wx.navigateTo({ url: `/pages/pack/detail/index?id=${packId}` });
          }
        },
      });
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: e.message || '未找到该作品', icon: 'none' });
    }
  },

  copyOpenId() {
    const { openid } = this.data;
    if (!openid) {
      wx.showToast({ title: '暂无 openid', icon: 'none' });
      return;
    }
    wx.setClipboardData({
      data: openid,
      success: () => wx.showToast({ title: '已复制 openid', icon: 'success' }),
    });
  },
});
