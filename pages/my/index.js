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
  spendablePoints,
} from '~/utils/entitlement';
import {
  applyDownloadCostsFromSettings,
  downloadCost,
  getPricingPlans,
  loadPricingPlans,
  pricingFromLoginPayload,
} from '~/utils/pricing';
import { applyBeadCostsFromSettings } from '~/utils/beadCosts';
import { applyImageToolCostsFromSettings } from '~/utils/imageToolCosts';
import { buyPlan, buyAvatarFrame, recoverMyPendingOrders } from '~/utils/virtualPay';
import {
  createAndCopyCode,
  extractRedeemCode,
  readClipboardRedeemCode,
} from '~/utils/redeemCode';
import {
  hasCloudAvatar,
  isAvatarTempUrlFresh,
  resolveDisplayAvatarUrl,
  resolvePixabotParams,
} from '~/utils/avatar';
import {
  buildCategoryTabs,
  buildPartOptions,
  decodeId,
  encodeCombo,
  HUE_PRESETS,
  isValidId,
  loadLastPixabot,
  normalizePalette,
  parsePixabotIdFromFileID,
  randomCombo,
  randomPalette,
  saveLastPixabot,
} from '~/utils/pixabotParts';
import { renderPixabotGif, renderPixabotPng } from '~/utils/pixabotRender';
import {
  syncAchievements,
  listAchievements,
  equipAvatarFrame,
} from '~/utils/achievement';
import { applyPendingPointGifts } from '~/utils/giftHint';
import {
  applyPendingLotteryInvites,
  applyPendingLotteryResults,
} from '~/utils/lotteryHint';
import config from '~/config';
import {
  defaultAdRewardDailyMax,
  defaultAdRewardPoints,
  fetchAdRewardStatus,
  isAdRewardEnabled,
  watchAdAndClaimPoints,
} from '~/utils/adReward';
import {
  applyHomeFeedAdEveryFromSettings,
  applyLibraryGridAdEveryFromSettings,
  getNativeMyPageAdUnitId,
  shouldShowNativeAds,
} from '~/utils/nativeAd';
import { showPointsReward } from '~/utils/pointsReward';
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
  resolveCategorySwatch,
  setThemeId,
} from '~/utils/theme';
import {
  FESTIVAL_BANNER_SPEC,
  FESTIVAL_BANK_SPEC,
  buildFestivalSheetFlakes,
  clearFestivalBanner,
  clearFestivalBank,
  clearFestivalWindow,
  ensureFestivalModeForRole,
  getActiveFestival,
  getFestivalAssets,
  getFestivalBannerAdminItems,
  getFestivalBankAdminItems,
  getFestivalCropOutSize,
  canAccessFestival,
  getFestivalMode,
  getFestivalPreviewDemo,
  getFestivalPreviewOptions,
  getFestivalSolarTableAdminHint,
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
  notifyFestivalAccessChange,
  setFestivalMode,
  setFestivalUserOn,
} from '~/utils/festival';
import { getCustomNavMetrics, getWindowInfoSafe } from '~/utils/systemInfo';
import { shareAppMessage, shareTimeline } from '~/utils/share';
import {
  buildPreviewRowPreview,
  getDisplaySettingsNote,
  getPreviewRowCountOptions,
  getPreviewRowCountPref,
  setPreviewRowCountPref,
} from '~/utils/previewRowCount';
import {
  buildFontScaleStyle,
  getFontScaleId,
  getFontScaleOptions,
  setFontScaleId,
} from '~/utils/fontScale';
import {
  clearHomePref,
  getHomePref,
  getHomePrefBrief,
  getHomePrefNote,
  reorderFiltersByPref,
  setHomePref,
} from '~/utils/homePref';
import {
  CONTENT_TYPE_ALL,
  contentTypeChipStyle,
  contentTypeFilterLabel,
  contentTypeFilterOptions,
  contentTypeIconSrc,
  normalizeContentType,
} from '~/utils/contentType';
import { CATEGORY_FILTER_ALL } from '~/utils/categories';

/**
 * 预览普通用户：只隐藏管理员身份，仍按真实权益显示 VIP / 积分
 * （方便管理员自充会员后测「有会员的普通用户」）
 */
function buildRoleLabel({ isAdmin, isVip, points, vipMonthQuota, previewAsUser }) {
  // 对外不暴露「管理员」身份，按真实权益展示
  void isAdmin;
  void previewAsUser;
  if (isVip) return '包月会员';
  if ((points || 0) + (vipMonthQuota || 0) > 0) {
    return `积分 ${(points || 0) + (vipMonthQuota || 0)}`;
  }
  return '普通用户';
}

/** 节日氛围入口右侧文案：对用户不暴露后台；有生效节日时优先显示名称 */
function festivalMenuNote(fest) {
  if (!fest) return '敬请期待';
  if (!fest.userOn) return '已关闭';
  if (fest.activeName && fest.activeName !== '无') return fest.activeName;
  if (fest.note && /会员权益/.test(fest.note)) return '会员专属节日中';
  if (!fest.featureOn && fest.mode === 'auto') return '敬请期待';
  if (fest.mode === 'off') return '已关闭';
  return '已开启';
}

/** 头像角标：VIP 红色 user-vip；积分礼盒（不展示管理员角标） */
function buildAvatarBadge({ isAdmin, isVip, points, vipMonthQuota, previewAsUser }) {
  void isAdmin;
  void previewAsUser;
  if (isVip) {
    return { tone: 'vip', icon: 'user-vip', text: 'VIP' };
  }
  if ((points || 0) + (vipMonthQuota || 0) > 0) {
    return { tone: 'points', icon: 'gift', text: '' };
  }
  return null;
}

function buildRoleTagTheme({ isAdmin, isVip, points, vipMonthQuota, previewAsUser }) {
  void isAdmin;
  void previewAsUser;
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
    avatarFrameUrl: '',
    avatarFrameId: '',
    frameWardrobeVisible: false,
    frameWardrobeLoading: false,
    frameWardrobeTab: 'achievement',
    frameTabOptions: [
      { id: 'achievement', label: '成就' },
      { id: 'vip', label: '会员' },
      { id: 'shop', label: '选购' },
    ],
    frameAchievements: [],
    frameVipList: [],
    frameShopList: [],
    frameList: [],
    frameMetricsText: '',
    frameBuyingId: '',
    pixabotSheetVisible: false,
    pixabotPageStyle: '',
    pixabotId: '2156',
    pixabotCombo: { eyes: 2, heads: 1, body: 5, top: 6 },
    pixabotCategory: 'eyes',
    pixabotCategoryTabs: buildCategoryTabs(),
    pixabotPartOptions: buildPartOptions('eyes'),
    pixabotSelectedIndex: 2,
    pixabotPreviewUrl: '',
    pixabotCost: 2,
    pixabotFormat: 'png',
    pixabotFormatTabs: [
      { id: 'png', label: 'PNG' },
      { id: 'gif', label: 'GIF' },
      { id: 'json', label: 'JSON' },
    ],
    pixabotFormatHint: 'PNG：设为静态头像需积分',
    pixabotSetLabel: '设为静态头像 · 2 积分',
    pixabotSetting: false,
    pixabotPreviewLoading: false,
    pixabotCanAnimate: false,
    pixabotHue: 0,
    pixabotSaturate: 1,
    pixabotHuePresetId: '0',
    pixabotHuePresets: HUE_PRESETS,
    savingProfile: false,
    benefit: formatBenefitCard(),
    pricing: getPricingPlans(),
    pricingVisible: false,
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
    displaySettingsNote: getDisplaySettingsNote(),
    displayPrefDraft: 4,
    displayPrefHint: '默认密度',
    displayPreviewCells: [],
    displayPreviewColumnCount: 4,
    displayColumnOptions: getPreviewRowCountOptions(),
    fontScaleDraft: 'standard',
    fontScaleOptions: getFontScaleOptions(),
    fontPreviewStyle: buildFontScaleStyle('standard'),
    displayPopupVisible: false,
    homePrefNote: getHomePrefNote(),
    homePrefPopupVisible: false,
    homePrefContentTypeDraft: CONTENT_TYPE_ALL,
    homePrefCategoryIdsDraft: [],
    homePrefTypeOptions: contentTypeFilterOptions(),
    homePrefCategoryOptions: [],
    homePrefCatsLoading: false,
    homePrefPreviewTypeName: contentTypeFilterLabel(CONTENT_TYPE_ALL),
    homePrefPreviewTypeIcon: contentTypeIconSrc(CONTENT_TYPE_ALL),
    homePrefPreviewTypeStyle: contentTypeChipStyle(CONTENT_TYPE_ALL),
    homePrefPreviewCats: [{ id: 'all', name: '全部', tabStyle: '' }],
    homePrefPreviewHint: '未设置偏好时进入首页为全部合集',
    navHeight: 64,
    navBarStyle: '',
    festivalActive: true,
    festivalId: '',
    festivalClass: '',
    festivalStyle: '',
    festHeaderPx: 88,
    festivalMode: 'auto',
    festivalModeLabel: '跟随日期',
    festivalActiveName: '无',
    festivalMenuNote: '敬请期待',
    festivalFeatureOn: false,
    festivalUserOn: true,
    festivalFallFull: false,
    festivalPopupVisible: false,
    festivalModeOptions: [],
    festivalPreviewHint: '',
    festivalPreviewAccent: '#e34d59',
    festivalPreviewName: '春节',
    festivalPreviewFlakes: [],
    festivalBannerItems: [],
    festivalBankItems: [],
    festivalAssetEdit: null,
    festivalBannerSpecLabel: `${FESTIVAL_BANNER_SPEC.width}×${FESTIVAL_BANNER_SPEC.height}（${FESTIVAL_BANNER_SPEC.ratio}）`,
    festivalBankSpecLabel: `${FESTIVAL_BANK_SPEC.width}×${FESTIVAL_BANK_SPEC.height}（${FESTIVAL_BANK_SPEC.ratio}，仅图标区）`,
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
    /** 农历对照表临近/超过覆盖年份时给管理员的提示 */
    festivalSolarTableHint: '',
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
    checkinCheckedToday: false,
    checkinEntryText: '签到领积分',
    adRewardVisible: false,
    adRewardNote: '看完视频领积分',
    adRewardPoints: defaultAdRewardPoints(),
    adRewardLeftToday: defaultAdRewardDailyMax(),
    adRewardClaiming: false,
    nativeAdUnitId: getNativeMyPageAdUnitId(),
    showNativeAd: false,
    guideVisible: false,
    /** 保存到相册前的共用步骤 */
    guidePrepSteps: [
      {
        title: '在趣图铺子里选合集',
        desc: '打开首页，可按表情 / 壁纸 / 头像 / 视频筛选，点进喜欢的合集预览。批量保存时一次只能选同一类型。',
        icon: 'smile',
        iconColor: '#27AE60',
        iconBg: 'rgba(39, 174, 96, 0.14)',
      },
      {
        title: '获取下载权限',
        desc: `在「我的」购买或兑换包月（每月 ${config.monthlyQuota || 48} 积分，月底清零）与积分。保存单价：表情静态 ${downloadCost('static')} / 动态 ${downloadCost('anim')}，壁纸 ${downloadCost('wallpaper')}，头像 ${downloadCost('avatar')}，视频 ${downloadCost('video')}（以「我的」与管理端规则为准）。`,
        icon: 'ticket',
        iconColor: '#D97706',
        iconBg: 'rgba(245, 158, 11, 0.16)',
      },
      {
        title: '保存原文件到相册',
        desc: '表情合集可选「静态 / 动态」原图；壁纸、头像、视频直接保存原文件。授权相册后写入手机。壁纸 / 头像可直接设系统壁纸或头像；视频可在相册播放。',
        icon: 'download',
        iconColor: '#0052D9',
        iconBg: 'rgba(0, 82, 217, 0.12)',
      },
    ],
    /** 导入微信：两种独立方式，方式二含子步骤 */
    guideImportWays: [
      {
        label: '方式一',
        title: '聊天里添加为表情',
        hint: '最快，适合一张张加',
        icon: 'chat',
        iconColor: '#07C160',
        iconBg: 'rgba(7, 193, 96, 0.14)',
        desc: '打开任意聊天，从相册把刚保存的表情发到聊天里，发送后长按该图片，选择「添加为表情」。',
        steps: [],
      },
      {
        label: '方式二',
        title: '表情面板从相册导入',
        hint: '适合一次导入多张',
        icon: 'upload',
        iconColor: '#9B51E0',
        iconBg: 'rgba(187, 107, 217, 0.14)',
        desc: '',
        steps: [
          {
            title: '打开微信表情面板',
            desc: '进入任意聊天，点输入框旁的表情图标，打开表情面板。',
          },
          {
            title: '进入「添加的单个表情」',
            desc: '点面板右上角设置（齿轮），进入「我的表情」→「添加的单个表情」（有的版本在「我」→「表情」→ 右上角设置）。',
          },
          {
            title: '从相册选择导入',
            desc: '点「+」→「从相册选择」，选中刚保存的图片或 GIF，按提示裁剪后点「完成 / 使用」。',
          },
        ],
      },
    ],
  },

  onShow() {
    // 首帧：主题 / 节日 / 底栏；云同步延后，避免从二级页返回卡顿
    this.syncThemeUi();
    applyThemeToTabBar();
    this.refreshFestivalDecor();
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      const bar = this.getTabBar();
      if (typeof bar.setSelected === 'function') bar.setSelected('my');
      else bar.setData({ value: 'my' });
    }
    this.setTabBarHidden(!!this.data.festivalCropVisible);
    if (this._myShowDeferTimer) clearTimeout(this._myShowDeferTimer);
    this._myShowDeferTimer = setTimeout(() => {
      this._myShowDeferTimer = null;
      this.refreshIdentity();
      ensureFestivalModeForRole(!!resolveIsAdmin());
      const now = Date.now();
      const due = !this._myCloudAt || now - this._myCloudAt > 20 * 1000;
      if (due) {
        this._myCloudAt = now;
        this.syncProfileFromCloud();
        this.syncEntitlement();
        this.refreshAdRewardStatus();
        this.refreshNotifyStatus();
        this.refreshFeedbackNotifyStatus();
        this.refreshLotteryHint();
        this.refreshCheckinEntry();
        this.refreshAvatarFrame();
        loadFestivalConfig({ silent: true }).then(() => {
          ensureFestivalModeForRole(!!resolveIsAdmin());
          this.syncThemeUi();
          this.refreshFestivalDecor();
        });
      }
      this.maybeOpenCheckinPopup();
    }, 32);
  },

  onHide() {
    if (this._myShowDeferTimer) {
      clearTimeout(this._myShowDeferTimer);
      this._myShowDeferTimer = null;
    }
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
    this.updateNavHeight();
    this.syncThemeUi();
    this._onEntitlementChange = () => this.refreshIdentity();
    try {
      const app = getApp();
      this._onAdminViewChange = () => this.refreshIdentity();
      this._onFestivalChange = () => this.updateNavHeight();
      if (app && app.eventBus) {
        app.eventBus.on('entitlementChange', this._onEntitlementChange);
        app.eventBus.on('adminViewChange', this._onAdminViewChange);
        app.eventBus.on('festivalChange', this._onFestivalChange);
      }
    } catch (e) {
      /* ignore */
    }
  },

  onUnload() {
    this._pixabotPreviewToken = (this._pixabotPreviewToken || 0) + 1;
    try {
      const app = getApp();
      if (app && app.eventBus) {
        if (this._onEntitlementChange) app.eventBus.off('entitlementChange', this._onEntitlementChange);
        if (this._onAdminViewChange) app.eventBus.off('adminViewChange', this._onAdminViewChange);
        if (this._onFestivalChange) app.eventBus.off('festivalChange', this._onFestivalChange);
      }
    } catch (e) {
      /* ignore */
    }
  },

  updateNavHeight() {
    try {
      const m = getCustomNavMetrics();
      this.setData(
        {
          navHeight: m.navHeight,
          navBarStyle: m.navBarStyle,
        },
        () => this.refreshFestivalDecor(),
      );
    } catch (e) {
      this.setData(
        {
          navHeight: 64,
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
    const festivalId = fest ? fest.id : '';
    const festivalStyle = fest
      ? [
          `--fest-accent:${fest.accent || 'var(--td-brand-color)'}`,
          hasBanner ? `--fest-nav-color:${fest.navColor || '#ffffff'}` : '',
        ]
          .filter(Boolean)
          .join(';')
      : '';
    const festivalClass = fest
      ? [hasBanner ? 'my-page--fest' : '', `my-page--fest-${fest.id}`]
          .filter(Boolean)
          .join(' ')
      : '';
    if (
      this.data.festivalId === festivalId &&
      this.data.festivalClass === festivalClass &&
      this.data.festivalStyle === festivalStyle &&
      this.data.festHeaderPx === festHeaderPx
    ) {
      return;
    }
    this.setData({
      festivalId,
      festivalClass,
      festivalStyle,
      festHeaderPx,
    });
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
    const themeStyle = getThemeStyle();
    const themeBrand = getThemeBrand();
    const themeName = (hit && hit.name) || '微信绿';
    const displaySettingsNote = getDisplaySettingsNote();
    const homePrefNote = getHomePrefNote();
    const festivalMenu = festivalMenuNote(fest);
    const festivalFallFull = isFestivalFallFull();
    if (
      this.data.themeStyle === themeStyle &&
      this.data.themeBrand === themeBrand &&
      this.data.themeId === themeId &&
      this.data.festivalMode === fest.mode &&
      this.data.festivalFeatureOn === !!fest.featureOn &&
      this.data.festivalUserOn === !!fest.userOn &&
      this.data.festivalFallFull === festivalFallFull &&
      this.data.displaySettingsNote === displaySettingsNote &&
      this.data.homePrefNote === homePrefNote &&
      this.data.festivalMenuNote === festivalMenu
    ) {
      return;
    }
    this.setData({
      themeStyle,
      themeBrand,
      themeId,
      themeName,
      themePresets: presets,
      displaySettingsNote,
      homePrefNote,
      festivalMode: fest.mode,
      festivalModeLabel: fest.modeLabel,
      festivalActiveName: fest.activeName,
      festivalMenuNote: festivalMenu,
      festivalFeatureOn: !!fest.featureOn,
      festivalUserOn: !!fest.userOn,
      festivalFallFull,
      festivalModeOptions: getFestivalPreviewOptions(),
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
      this.refreshAdRewardStatus();
      try {
        const app = getApp();
        if (app && app.eventBus) app.eventBus.emit('entitlementChange');
      } catch (e) {
        /* ignore */
      }
      const fallbackTitle =
        kind === 'vip' ? '会员已开通 · 应用内免广告' : '购买成功';
      wx.showToast({
        title: (result && result.message) || fallbackTitle,
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

  _displayPrefHint(pref) {
    const hit = (this.data.displayColumnOptions || getPreviewRowCountOptions()).find(
      (o) => o.id === pref,
    );
    return (hit && hit.hint) || '';
  },

  _buildDisplayPreview(pref) {
    const preview = buildPreviewRowPreview(pref);
    return {
      displayPrefDraft: preview.count,
      displayPreviewCells: preview.cells,
      displayPreviewColumnCount: preview.count,
      displayPrefHint: this._displayPrefHint(preview.count) || preview.hint,
    };
  },

  openDisplaySettings() {
    const pref = getPreviewRowCountPref();
    const fontId = getFontScaleId();
    this.setData({
      displayPopupVisible: true,
      displayColumnOptions: getPreviewRowCountOptions(),
      fontScaleOptions: getFontScaleOptions(),
      fontScaleDraft: fontId,
      fontPreviewStyle: buildFontScaleStyle(fontId),
      ...this._buildDisplayPreview(pref),
    });
  },

  closeDisplaySettings() {
    if (!this.data.displayPopupVisible) return;
    this.setData({ displayPopupVisible: false });
  },

  onDisplayPopupChange(e) {
    const visible = !!(e.detail && e.detail.visible);
    this.setData({ displayPopupVisible: visible });
  },

  onPickDisplayPref(e) {
    const raw =
      (e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id) ||
      (e.target && e.target.dataset && e.target.dataset.id) ||
      '';
    const pref = Number(raw);
    if (pref !== 3 && pref !== 4 && pref !== 5 && pref !== 6) return;
    /* check-tag 点已选项会取消勾选：强制保持选中 */
    this.setData(this._buildDisplayPreview(pref));
  },

  onPickFontScale(e) {
    const raw =
      (e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id) ||
      (e.target && e.target.dataset && e.target.dataset.id) ||
      '';
    const id = String(raw || '');
    if (!getFontScaleOptions().some((o) => o.id === id)) return;
    this.setData({
      fontScaleDraft: id,
      fontPreviewStyle: buildFontScaleStyle(id),
    });
  },

  onConfirmDisplaySettings() {
    setPreviewRowCountPref(this.data.displayPrefDraft);
    setFontScaleId(this.data.fontScaleDraft);
    applyThemeToTabBar();
    this.setData({
      themeStyle: getThemeStyle(),
      displaySettingsNote: getDisplaySettingsNote(),
      displayPopupVisible: false,
    });
    wx.showToast({ title: '显示设置已更新', icon: 'success' });
  },

  /**
   * @param {Array} list
   * @param {string[]} selectedIds
   * @param {{ reorder?: boolean }} [opts] 仅打开/加载时重排；点选时保持当前位置，避免「点一次乱一次」
   */
  _decorateHomePrefCategories(list, selectedIds, opts = {}) {
    const selected = Array.isArray(selectedIds) ? selectedIds : [];
    const selectedSet = new Set(selected);
    const base = opts.reorder
      ? reorderFiltersByPref(list || [], selected)
      : Array.isArray(list)
        ? list.slice()
        : [];
    return base.map((f) => {
      const id = f.id || CATEGORY_FILTER_ALL;
      const name = f.name || '';
      const swatch = resolveCategorySwatch(id, name);
      const checked =
        id === CATEGORY_FILTER_ALL
          ? selected.length === 0
          : selectedSet.has(id);
      // 颜色走 CSS 变量，由 .is-on 切换底/边，便于过渡动画
      const chipStyle = `--cat-color:${swatch.color};--cat-bg:${swatch.bg};`;
      return {
        id,
        name,
        count: f.count || 0,
        checked,
        chipStyle,
        accentColor: swatch.color,
        tabStyle: `--home-cat-accent:${swatch.color}`,
      };
    });
  },

  _buildHomePrefPreview(contentType, categoryIds, categoryOptions) {
    const type =
      contentType === CONTENT_TYPE_ALL
        ? CONTENT_TYPE_ALL
        : normalizeContentType(contentType);
    const ids = Array.isArray(categoryIds) ? categoryIds : [];
    const options = Array.isArray(categoryOptions) ? categoryOptions : [];
    // 预览不重排列表，只按当前选项取展示
    const decorated = this._decorateHomePrefCategories(options, ids, {
      reorder: false,
    });
    const allTab = (() => {
      const hit = decorated.find((c) => c.id === CATEGORY_FILTER_ALL);
      if (hit) return hit;
      const swatch = resolveCategorySwatch('all', '全部');
      return {
        id: 'all',
        name: '全部',
        tabStyle: `--home-cat-accent:${swatch.color}`,
      };
    })();
    let previewCats = [];
    if (!ids.length) {
      // 未选角色 → 首页落在「全部」
      previewCats = [allTab];
    } else if (ids.length === 1) {
      // 单选 → 首页直接进该角色
      const hit = decorated.find((c) => c.id === ids[0]);
      previewCats = hit ? [hit] : [allTab];
    } else {
      // 多选 → 「全部」+ 置顶角色（预览里再跟 1 个其余角色示意仍可切换）
      const pinned = ids
        .map((id) => decorated.find((c) => c.id === id))
        .filter(Boolean)
        .slice(0, 3);
      const pinnedSet = new Set(pinned.map((c) => c.id));
      const rest = decorated.find(
        (c) => c.id !== CATEGORY_FILTER_ALL && !pinnedSet.has(c.id),
      );
      previewCats = [allTab].concat(pinned);
      if (rest) previewCats.push(rest);
    }
    const draftPref = {
      saved: true,
      contentType: type,
      categoryIds: ids,
      categoryNames: ids.map((id) => {
        const hit = decorated.find((c) => c.id === id);
        return (hit && hit.name) || '';
      }),
    };
    const typeOpts = contentTypeFilterOptions();
    const typeHit = typeOpts.find((o) => o.id === type);
    return {
      // 与下方选项文案一致（不限 / 表情…），避免预览写「类型」、选项写「不限」
      homePrefPreviewTypeName: (typeHit && typeHit.name) || contentTypeFilterLabel(type),
      homePrefPreviewTypeIcon: contentTypeIconSrc(type),
      homePrefPreviewTypeStyle: contentTypeChipStyle(type),
      homePrefPreviewCats: previewCats,
      homePrefPreviewHint: getHomePrefBrief(draftPref) || '进入首页将按此筛选',
    };
  },

  openHomePrefSettings() {
    const pref = getHomePref();
    const contentType =
      pref.contentType === CONTENT_TYPE_ALL
        ? CONTENT_TYPE_ALL
        : normalizeContentType(pref.contentType);
    const categoryIds = Array.isArray(pref.categoryIds) ? pref.categoryIds.slice() : [];
    this.setData({
      homePrefPopupVisible: true,
      homePrefContentTypeDraft: contentType,
      homePrefCategoryIdsDraft: categoryIds,
      homePrefTypeOptions: contentTypeFilterOptions(),
      homePrefCategoryOptions: [],
      ...this._buildHomePrefPreview(contentType, categoryIds, []),
    });
    this.loadHomePrefCategories(contentType, categoryIds);
  },

  closeHomePrefSettings() {
    if (!this.data.homePrefPopupVisible) return;
    this.setData({ homePrefPopupVisible: false });
  },

  onHomePrefPopupChange(e) {
    const visible = !!(e.detail && e.detail.visible);
    this.setData({ homePrefPopupVisible: visible });
  },

  async loadHomePrefCategories(contentType, keepCategoryIds) {
    const seq = (this._homePrefCatSeq = (this._homePrefCatSeq || 0) + 1);
    this.setData({ homePrefCatsLoading: true });
    try {
      const res = await callFunction('listCategories', { contentType });
      if (seq !== this._homePrefCatSeq) return;
      const raw = (res.data && res.data.filters) || [
        { id: 'all', name: '全部', count: 0 },
      ];
      const base = raw
        .filter((f) => f.id === 'all' || (f.count || 0) > 0)
        .map((f) => ({
          id: f.id,
          name: f.name || f.label || '',
          count: f.count || 0,
        }));
      const keep = Array.isArray(keepCategoryIds)
        ? keepCategoryIds
        : this.data.homePrefCategoryIdsDraft || [];
      const validKeep = keep.filter((id) =>
        base.some((f) => f.id === id && f.id !== CATEGORY_FILTER_ALL),
      );
      // 打开时按已保存偏好把角色顶到前面；之后点选不再重排
      const decorated = this._decorateHomePrefCategories(
        base.length ? base : [{ id: 'all', name: '全部', count: 0 }],
        validKeep,
        { reorder: true },
      );
      this.setData({
        homePrefCategoryOptions: decorated,
        homePrefCategoryIdsDraft: validKeep,
        homePrefCatsLoading: false,
        ...this._buildHomePrefPreview(
          contentType || this.data.homePrefContentTypeDraft,
          validKeep,
          decorated,
        ),
      });
    } catch (e) {
      if (seq !== this._homePrefCatSeq) return;
      const fallback = this._decorateHomePrefCategories(
        [{ id: 'all', name: '全部', count: 0 }],
        [],
        { reorder: false },
      );
      this.setData({
        homePrefCategoryOptions: fallback,
        homePrefCategoryIdsDraft: [],
        homePrefCatsLoading: false,
        ...this._buildHomePrefPreview(
          contentType || this.data.homePrefContentTypeDraft,
          [],
          fallback,
        ),
      });
    }
  },

  onPickHomePrefType(e) {
    const raw =
      (e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id) ||
      (e.target && e.target.dataset && e.target.dataset.id) ||
      '';
    const next =
      raw === CONTENT_TYPE_ALL ? CONTENT_TYPE_ALL : normalizeContentType(raw);
    if (next === this.data.homePrefContentTypeDraft) return;
    this.setData({
      homePrefContentTypeDraft: next,
      homePrefCategoryIdsDraft: [],
      homePrefCategoryOptions: [],
      ...this._buildHomePrefPreview(next, [], []),
    });
    this.loadHomePrefCategories(next, []);
  },

  onPickHomePrefCategory(e) {
    const raw =
      (e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id) ||
      (e.target && e.target.dataset && e.target.dataset.id) ||
      '';
    const id = String(raw || CATEGORY_FILTER_ALL);
    const options = this.data.homePrefCategoryOptions || [];
    if (!options.some((f) => f.id === id)) return;

    let nextIds = (this.data.homePrefCategoryIdsDraft || []).slice();
    if (id === CATEGORY_FILTER_ALL) {
      // 点「全部」= 不限定角色
      nextIds = [];
    } else {
      const idx = nextIds.indexOf(id);
      if (idx >= 0) nextIds.splice(idx, 1);
      else nextIds.push(id);
    }
    // 保持当前列表顺序，只切换勾选态
    const decorated = this._decorateHomePrefCategories(
      options.map((f) => ({ id: f.id, name: f.name, count: f.count })),
      nextIds,
      { reorder: false },
    );
    this.setData({
      homePrefCategoryIdsDraft: nextIds,
      homePrefCategoryOptions: decorated,
      ...this._buildHomePrefPreview(
        this.data.homePrefContentTypeDraft,
        nextIds,
        decorated,
      ),
    });
  },

  onConfirmHomePrefSettings() {
    const contentType = this.data.homePrefContentTypeDraft || CONTENT_TYPE_ALL;
    const categoryIds = (this.data.homePrefCategoryIdsDraft || []).slice();
    const options = this.data.homePrefCategoryOptions || [];
    const categoryNames = categoryIds.map((id) => {
      const hit = options.find((f) => f.id === id);
      return (hit && hit.name) || '';
    });
    const pref = setHomePref({
      saved: true,
      contentType,
      categoryIds,
      categoryNames,
    });
    this.setData({
      homePrefNote: getHomePrefNote(pref),
      homePrefPopupVisible: false,
    });
    wx.showToast({ title: '首页偏好已保存', icon: 'success' });
  },

  onClearHomePrefSettings() {
    clearHomePref();
    this.setData({
      homePrefNote: getHomePrefNote(),
      homePrefPopupVisible: false,
      homePrefContentTypeDraft: CONTENT_TYPE_ALL,
      homePrefCategoryIdsDraft: [],
    });
    wx.showToast({ title: '已恢复默认首页', icon: 'none' });
  },

  /** 偏好里缺角色 / 资源少 → 关掉偏好，打开意见反馈 */
  onHomePrefGoFeedback() {
    const patch = {
      homePrefPopupVisible: false,
      feedbackVisible: true,
    };
    // 输入框为空时带一句提示，方便直接写想要的角色
    if (!String(this.data.feedbackContent || '').trim()) {
      patch.feedbackContent = '希望增加角色：';
    }
    this.setData(patch);
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

  closeThemePicker() {
    if (!this.data.themePopupVisible) return;
    this.setData({ themePopupVisible: false });
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

  openPricingFromFestival() {
    this.setData({ festivalPopupVisible: false });
    this.openPricing();
  },

  /** 弹层内手机预览：跟开关 / 当前节日联动 */
  refreshFestivalSheetPreview() {
    const userOn = isFestivalUserOn();
    const fallFull = isFestivalFallFull();
    const demo = getFestivalPreviewDemo();
    const accent = (demo && demo.accent) || '#e34d59';
    const name = (demo && demo.name) || '春节';
    const demoId = (demo && demo.id) || 'cny';
    const active = getActiveFestival();
    const flakes = userOn
      ? buildFestivalSheetFlakes(demoId, fallFull ? 'full' : 'header')
      : [];
    let hint = '';
    if (!userOn) {
      hint = '打开「开启节日效果」后，顶栏与飘落会出现在预览中';
    } else if (!active) {
      hint = `当前无进行中节日，预览以「${name}」示意 · ${
        fallFull ? '全屏飘落' : '仅顶栏飘落'
      }`;
    } else {
      hint = `当前：${name} · ${fallFull ? '全屏飘落' : '仅顶栏飘落'}`;
    }
    this.setData({
      festivalUserOn: userOn,
      festivalFallFull: fallFull,
      festivalPreviewAccent: accent,
      festivalPreviewName: name,
      festivalPreviewHint: hint,
      festivalPreviewFlakes: flakes,
      festivalModeOptions: getFestivalPreviewOptions(),
    });
  },

  openFestivalPicker() {
    const festivalSolarTableHint = this.data.isAdmin
      ? getFestivalSolarTableAdminHint()
      : '';
    this.setData({
      festivalPopupVisible: true,
      festivalMode: getFestivalMode(),
      festivalModeOptions: getFestivalPreviewOptions(),
      festivalFeatureOn: isFestivalFeatureEnabled(),
      festivalUserOn: isFestivalUserOn(),
      festivalFallFull: isFestivalFallFull(),
      festivalSolarTableHint,
      benefit: formatBenefitCard(getCachedEntitlement()),
    });
    this.refreshFestivalSheetPreview();
    /* 先用本地缓存渲染预览图，避免连点两次换签导致图片闪两次 */
    if (this.data.isAdmin) this.refreshFestivalAssetItems();
    loadFestivalConfig({ silent: true }).then(() => {
      this.setData({
        festivalFeatureOn: isFestivalFeatureEnabled(),
        festivalUserOn: isFestivalUserOn(),
        festivalFallFull: isFestivalFallFull(),
        festivalSolarTableHint: this.data.isAdmin
          ? getFestivalSolarTableAdminHint()
          : '',
      });
      this.syncThemeUi();
      this.refreshFestivalSheetPreview();
      if (this.data.isAdmin) this.refreshFestivalAssetItems();
    });
  },

  onFestivalPopupChange(e) {
    const visible = !!(e.detail && e.detail.visible);
    this.setData({ festivalPopupVisible: visible });
    if (!visible) {
      /* 普通用户关掉弹层后恢复跟随日期，避免一直停在预览节日 */
      const mode = ensureFestivalModeForRole(resolveIsAdmin());
      if (mode !== this.data.festivalMode) {
        this.setData({ festivalMode: mode });
        this.syncThemeUi();
        this.syncTabBarFestival();
      }
    }
  },

  closeFestivalPicker() {
    if (!this.data.festivalPopupVisible) return;
    this.setData({ festivalPopupVisible: false });
    const mode = ensureFestivalModeForRole(resolveIsAdmin());
    if (mode !== this.data.festivalMode) {
      this.setData({ festivalMode: mode });
      this.syncThemeUi();
      this.syncTabBarFestival();
    }
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

  setTabBarHidden(hidden) {
    try {
      if (typeof this.getTabBar === 'function' && this.getTabBar()) {
        const bar = this.getTabBar();
        if (bar && typeof bar.setHidden === 'function') bar.setHidden(hidden);
        else if (bar && typeof bar.setData === 'function') {
          bar.setData({ hidden: !!hidden });
        }
      }
    } catch (e) {
      /* ignore */
    }
  },

  openFestivalCrop(kind, festivalId, localPath) {
    const isBank = kind === 'bank';
    /* 导出比例跟真机展示一致，避免上传后再被容器裁掉 */
    const out = getFestivalCropOutSize(isBank ? 'bank' : 'banner');
    this._festivalPopupBeforeCrop = !!this.data.festivalPopupVisible;
    /* cover-view 底栏会盖过裁剪层，打开前先藏 */
    this.setTabBarHidden(true);
    this.setData({
      festivalPopupVisible: false,
      festivalCropVisible: true,
      festivalCropSrc: localPath,
      festivalCropKind: kind,
      festivalCropFestivalId: festivalId,
      festivalCropOutW: out.width,
      festivalCropOutH: out.height,
      festivalCropTitle: isBank ? '裁剪底栏背景' : '裁剪导航顶栏',
      festivalCropHint: `单指拖动，双指缩放 · 导出 ${out.width}×${out.height}（与真机展示同比例）`,
    });
  },

  closeFestivalCrop({ reopenPopup } = {}) {
    const reopen =
      reopenPopup !== false && this._festivalPopupBeforeCrop;
    this._festivalPopupBeforeCrop = false;
    this.setTabBarHidden(false);
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
    const id =
      (e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id) ||
      (e.target && e.target.dataset && e.target.dataset.id) ||
      (e.mark && e.mark.id) ||
      '';
    if (!id) return;
    if (id === 'off' && !resolveIsAdmin()) {
      wx.showToast({ title: '请用上方开关关闭效果', icon: 'none' });
      return;
    }
    if (id !== 'auto' && id !== 'off' && !canAccessFestival(id)) {
      wx.showToast({ title: '该节日为包月会员权益', icon: 'none' });
      return;
    }
    /* check-tag 点已选项会取消勾选：强制保持选中 */
    if (id === this.data.festivalMode) {
      this.setData({ festivalMode: id });
      return;
    }
    setFestivalMode(id);
    this.syncThemeUi();
    this.updateNavHeight();
    this.syncTabBarFestival();
    /* 只用已解析好的预览列表切换，不再整表换签，避免顶栏/底栏图闪多次 */
    this.setData({
      festivalMode: id,
      festivalAssetEdit: this.data.isAdmin
        ? this.buildFestivalAssetEdit(
            this.data.festivalBannerItems,
            this.data.festivalBankItems,
          )
        : null,
    });
    this.refreshFestivalSheetPreview();
    let toast = '预览已切换';
    if (id === 'off') {
      toast = '已关闭节日装饰';
    } else if (!isFestivalUserOn()) {
      /* 用户开关是总闸：关着时预览也不显示 */
      toast = '「开启节日效果」已关闭，预览不显示';
    } else if (id === 'auto') {
      if (!isFestivalFeatureEnabled()) {
        toast = '跟随日期：本机可预览；用户需先开「全员可见」';
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
      festivalWindowPickerTitle: which === 'end' ? '结束时间' : '开始时间',
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
    let text = String(raw).trim();
    /* 兼容只回了日期：补默认时分 */
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
      text =
        this.data.festivalWindowPickerMode === 'end'
          ? `${text} 23:59`
          : `${text} 00:00`;
    }
    if (!/^\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{1,2}$/.test(text)) {
      this.setData({ festivalWindowPickerVisible: false });
      wx.showToast({ title: '时间无效', icon: 'none' });
      return;
    }
    const mode = this.data.festivalWindowPickerMode;
    let start = this.data.festivalWindowDraftStart || '';
    let end = this.data.festivalWindowDraftEnd || '';
    if (mode === 'end') end = text;
    else start = text;
    const id =
      (this.data.festivalAssetEdit && this.data.festivalAssetEdit.id) || '';
    this.setData({
      festivalWindowPickerVisible: false,
      festivalWindowDraftStart: start,
      festivalWindowDraftEnd: end,
    });
    if (!id || !start || !end) {
      const nextWhich = mode === 'start' ? 'end' : 'start';
      const edit = this.data.festivalAssetEdit;
      const win = (edit && edit.window) || {};
      this.setData({
        festivalWindowPickerMode: nextWhich,
        festivalWindowPickerTitle: nextWhich === 'end' ? '结束时间' : '开始时间',
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
      wx.showToast({ title: '时间已更新', icon: 'success' });
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
    if (!resolveIsAdmin() || this.data.festivalFeatureSaving) return;
    const on = !!(e.detail && e.detail.value);
    this.setData({ festivalFeatureSaving: true, festivalFeatureOn: on });
    try {
      await setFestivalFeatureEnabled(on);
      this.syncThemeUi();
      this.updateNavHeight();
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
    if (!isFestivalFeatureEnabled() && !resolveIsAdmin()) {
      this.setData({ festivalUserOn: isFestivalUserOn() });
      wx.showToast({ title: '近期暂无节日活动', icon: 'none' });
      return;
    }
    const on = !!(e.detail && e.detail.value);
    setFestivalUserOn(on);
    this.setData({ festivalUserOn: on });
    this.syncThemeUi();
    this.updateNavHeight();
    this.syncTabBarFestival();
    this.refreshFestivalSheetPreview();
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
    this.refreshFestivalDecor();
    this.refreshFestivalSheetPreview();
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
    this.refreshFestivalDecor();
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
    const unitId = getNativeMyPageAdUnitId();
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
      nativeAdUnitId: unitId,
      showNativeAd: !!unitId && shouldShowNativeAds(),
    };

    // 无可用头像链时用 Pixabot；有云文件则等 ensureCloudAvatarUrl 换链
    patch.avatarUrl = resolveDisplayAvatarUrl({
      avatarFileID: cached.avatarFileID || '',
      avatarUrl: cached.avatarUrl || '',
      avatarUrlAt: cached.avatarUrlAt || 0,
      openid,
    });
    if (cached.avatarFrameUrl) {
      patch.avatarFrameUrl = cached.avatarFrameUrl;
      patch.avatarFrameId = cached.avatarFrameId || '';
    }

    this.setData(patch);
  },

  mapFrameRow(a) {
    const frame = a.frame || null;
    const previewUrl = frame
      ? frame.url || frame.thumbUrl || ''
      : a.framePreviewUrl || '';
    return {
      ...a,
      framePreviewUrl: previewUrl,
      frameEquipped: !!(
        a.frameEquipped ||
        (frame && frame.equipped) ||
        (a.frameId && a.frameId === this.data.avatarFrameId)
      ),
      hasFrame: !!(frame && previewUrl) || !!previewUrl,
    };
  },

  frameListForTab(tab, data) {
    const id = tab || 'achievement';
    if (id === 'vip') return data.frameVipList || [];
    if (id === 'shop') return data.frameShopList || [];
    return data.frameAchievements || [];
  },

  async refreshAvatarFrame() {
    try {
      const data = await listAchievements();
      const equipped = data.equippedFrame || null;
      const url = (equipped && (equipped.url || equipped.thumbUrl)) || '';
      const id = (equipped && equipped.id) || data.equippedFrameId || '';
      const app = getApp();
      if (app.globalData.userInfo) {
        app.globalData.userInfo.avatarFrameUrl = url;
        app.globalData.userInfo.avatarFrameId = id;
      }
      const m = data.metrics || {};
      const metricsText = `连签 ${m.streak || 0} · 下载 ${m.downloads || 0} · 付费 ¥${(
        (m.paidFen || 0) / 100
      ).toFixed(0)}`;
      const achievements = (data.achievements || []).map((a) =>
        this.mapFrameRow(a),
      );
      const frameVipList = (data.vipFrames || []).map((a) => this.mapFrameRow(a));
      const frameShopList = (data.shopFrames || []).map((a) =>
        this.mapFrameRow(a),
      );
      const tab = this.data.frameWardrobeTab || 'achievement';
      const patch = {
        avatarFrameUrl: url,
        avatarFrameId: id,
        frameAchievements: achievements,
        frameVipList,
        frameShopList,
        frameMetricsText: metricsText,
      };
      patch.frameList = this.frameListForTab(tab, patch);
      this.setData(patch);
      if (Array.isArray(data.newly) && data.newly.length) {
        const titles = data.newly
          .map((n) => n.title)
          .filter(Boolean)
          .slice(0, 2);
        wx.showToast({
          title: titles.length
            ? `解锁：${titles.join('、')}`
            : `解锁 ${data.newly.length} 个头像框`,
          icon: 'none',
        });
      }
    } catch (e) {
      console.warn('[avatarFrame]', e && e.message);
    }
  },

  openFrameWardrobe() {
    this.setData({
      frameWardrobeVisible: true,
      frameWardrobeLoading: true,
      frameWardrobeTab: 'achievement',
    });
    this.refreshAvatarFrame()
      .catch(() => {})
      .finally(() => this.setData({ frameWardrobeLoading: false }));
  },

  onFrameWardrobeVisible(e) {
    const visible = !!(e && e.detail && e.detail.visible);
    this.setData({ frameWardrobeVisible: visible });
  },

  closeFrameWardrobe() {
    this.setData({ frameWardrobeVisible: false });
  },

  onFrameTabChange(e) {
    const id =
      (e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id) ||
      '';
    if (!id || id === this.data.frameWardrobeTab) return;
    this.setData({
      frameWardrobeTab: id,
      frameList: this.frameListForTab(id, this.data),
    });
  },

  async onEquipFrame(e) {
    const index = Number(e.currentTarget.dataset.index);
    const item = (this.data.frameList || [])[index];
    if (!item) return;
    const source = item.source || 'achievement';
    const frameId = String(item.frameId || '').trim();

    if (!item.unlocked) {
      if (source === 'vip') {
        this.closeFrameWardrobe();
        this.openPricing();
        return;
      }
      if (source === 'paid') {
        if (!frameId) return;
        await this.onBuyFrame(frameId);
        return;
      }
      wx.showToast({ title: '尚未达成该成就', icon: 'none' });
      return;
    }
    if (!frameId) {
      wx.showToast({ title: '暂无头像框', icon: 'none' });
      return;
    }
    const wearing = this.data.avatarFrameId === frameId;
    wx.showLoading({ title: wearing ? '取消佩戴' : '佩戴中', mask: true });
    try {
      const res = await equipAvatarFrame(wearing ? '' : frameId);
      if (res && res.ok === false) {
        throw new Error(res.message || '佩戴失败');
      }
      const frame = (res && res.frame) || null;
      const url = frame ? frame.url || frame.thumbUrl || '' : '';
      const id = wearing ? '' : frameId;
      const app = getApp();
      if (app.globalData.userInfo) {
        app.globalData.userInfo.avatarFrameUrl = url;
        app.globalData.userInfo.avatarFrameId = id;
      }
      const mark = (list) =>
        (list || []).map((a) => {
          const equipped = !!(a.frameId && a.frameId === id);
          return {
            ...a,
            frameEquipped: equipped,
            frame: a.frame ? { ...a.frame, equipped } : a.frame,
          };
        });
      const frameAchievements = mark(this.data.frameAchievements);
      const frameVipList = mark(this.data.frameVipList);
      const frameShopList = mark(this.data.frameShopList);
      this.setData({
        avatarFrameUrl: url,
        avatarFrameId: id,
        frameAchievements,
        frameVipList,
        frameShopList,
        frameList: this.frameListForTab(this.data.frameWardrobeTab, {
          frameAchievements,
          frameVipList,
          frameShopList,
        }),
      });
      wx.showToast({
        title: wearing ? '已取消佩戴' : '已佩戴',
        icon: 'success',
      });
    } catch (err) {
      wx.showToast({
        title: (err.message || '操作失败').slice(0, 40),
        icon: 'none',
      });
    } finally {
      wx.hideLoading();
    }
  },

  async onBuyFrame(frameId) {
    if (this.data.frameBuyingId) return;
    const id = String(frameId || '').trim();
    if (!id) return;
    this.setData({ frameBuyingId: id });
    wx.showLoading({ title: '拉起支付', mask: true });
    try {
      const res = await buyAvatarFrame(id);
      if (res && res.entitlement) {
        setCachedEntitlement(res.entitlement);
      }
      wx.showToast({ title: res.message || '购买成功', icon: 'success' });
      await this.refreshAvatarFrame();
    } catch (err) {
      if (err && err.code === 'CANCEL') {
        wx.showToast({ title: '已取消', icon: 'none' });
      } else {
        wx.showToast({
          title: (err.message || '购买失败').slice(0, 40),
          icon: 'none',
        });
      }
    } finally {
      this.setData({ frameBuyingId: '' });
      wx.hideLoading();
    }
  },

  onTogglePreviewAsUser() {
    const next = !this.data.previewAsUser;
    setPreviewAsUser(next);
    this.refreshIdentity();
    applyThemeToTabBar();
    wx.showToast({
      title: next ? '已切换为普通用户预览' : '已退出普通用户预览',
      icon: 'none',
    });
  },

  onNativeAdError() {
    this.setData({ showNativeAd: false });
  },

  async syncEntitlement() {
    try {
      const prevVip = !!getCachedEntitlement().isVip;
      const res = await callFunction('userEntitlement', { action: 'get' });
      if (res && res.homeFeedAdEvery != null) {
        applyHomeFeedAdEveryFromSettings(res);
      }
      if (res && res.libraryGridAdEvery != null) {
        applyLibraryGridAdEveryFromSettings(res);
      }
      applyDownloadCostsFromSettings(res || {});
      applyBeadCostsFromSettings(res || {});
      applyImageToolCostsFromSettings(res || {});
      if (res.entitlement) {
        setCachedEntitlement(res.entitlement);
        this.refreshIdentity();
        // 会员刚过期：拉衣橱 list，服务端会卸会员框并回写正确佩戴
        if (prevVip && !res.entitlement.isVip) {
          this.refreshAvatarFrame().catch(() => {});
        }
        notifyFestivalAccessChange();
        this.refreshFestivalDecor();
        this.syncThemeUi();
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

  canUseAnimatedAvatar() {
    const ent = getCachedEntitlement() || {};
    if (ent.isVip) return true;
    // 管理员（非「预览为用户」）也可设动态头像
    return !!resolveIsAdmin() && !this.data.previewAsUser;
  },

  pixabotPaletteOpts() {
    return normalizePalette({
      hue: this.data.pixabotHue,
      saturate: this.data.pixabotSaturate,
    });
  },

  matchHuePresetId(hue, saturate) {
    const p = normalizePalette({ hue, saturate });
    const hit = HUE_PRESETS.find(
      (item) =>
        item.hue === p.hue &&
        Math.abs(Number(item.saturate) - p.saturate) < 0.05,
    );
    return hit ? hit.id : '';
  },

  /**
   * @param {object} combo
   * @param {string} [category]
   * @param {{ hue?: number, saturate?: number }} [paletteOverride]
   *   色相变更必须传入；勿读尚未落地的 setData
   */
  async applyPixabotCombo(combo, category, paletteOverride) {
    const next = {
      eyes: Number(combo.eyes) || 0,
      heads: Number(combo.heads) || 0,
      body: Number(combo.body) || 0,
      top: Number(combo.top) || 0,
    };
    const id = encodeCombo(next);
    const cat = category || this.data.pixabotCategory || 'eyes';
    this._pixabotCombo = next;
    const token = (this._pixabotPreviewToken = (this._pixabotPreviewToken || 0) + 1);
    const palette = normalizePalette(
      paletteOverride != null ? paletteOverride : this.pixabotPaletteOpts(),
    );
    const wantGif = (this.data.pixabotFormat || 'png') === 'gif';

    await new Promise((resolve) => {
      this.setData(
        {
          pixabotCombo: next,
          pixabotId: id,
          pixabotPartOptions: buildPartOptions(cat),
          pixabotSelectedIndex: Number(next[cat]) || 0,
          pixabotHue: palette.hue,
          pixabotSaturate: palette.saturate,
          pixabotHuePresetId: this.matchHuePresetId(palette.hue, palette.saturate),
          pixabotPreviewLoading: true,
        },
        resolve,
      );
    });

    try {
      const pngPath = await renderPixabotPng(next, {
        size: 160,
        bg: '#f3f4f6',
        ...palette,
      });
      if (token !== this._pixabotPreviewToken) return;
      this.setData({
        pixabotPreviewUrl: pngPath,
        pixabotPreviewLoading: false,
      });
      if (!wantGif) return;
      renderPixabotGif(next, { size: 160, bg: '#f3f4f6', ...palette })
        .then((gifPath) => {
          if (token !== this._pixabotPreviewToken) return;
          if (!this.data.pixabotSheetVisible) return;
          this.setData({ pixabotPreviewUrl: gifPath });
        })
        .catch(() => {
          /* GIF 失败保留 PNG 预览 */
        });
    } catch (err) {
      if (token !== this._pixabotPreviewToken) return;
      this.setData({ pixabotPreviewLoading: false });
      wx.showToast({
        title: ((err && err.message) || '预览失败').slice(0, 40),
        icon: 'none',
      });
    }
  },

  pixabotFormatMeta(format, cost, canAnimate) {
    const c = Math.max(1, Number(cost) || Number(this.data.pixabotCost) || 2);
    const anim =
      typeof canAnimate === 'boolean' ? canAnimate : this.canUseAnimatedAvatar();
    const fmt = format === 'gif' || format === 'json' ? format : 'png';
    if (fmt === 'gif') {
      return {
        pixabotFormat: 'gif',
        pixabotCanAnimate: anim,
        pixabotFormatHint: anim
          ? `GIF：设为动态头像 · ${c} 积分`
          : 'GIF：动态头像仅会员可设',
        pixabotSetLabel: anim ? `设为动态头像 · ${c} 积分` : '开通会员后可设',
      };
    }
    if (fmt === 'json') {
      return {
        pixabotFormat: 'json',
        pixabotCanAnimate: anim,
        pixabotFormatHint: 'JSON：复制部件组合（免费）',
        pixabotSetLabel: '复制 JSON',
      };
    }
    return {
      pixabotFormat: 'png',
      pixabotCanAnimate: anim,
      pixabotFormatHint: `PNG：设为静态头像 · ${c} 积分`,
      pixabotSetLabel: `设为静态头像 · ${c} 积分`,
    };
  },

  refreshPixabotExportLabel() {
    const meta = this.pixabotFormatMeta(
      this.data.pixabotFormat,
      this.data.pixabotCost,
      this.data.pixabotCanAnimate,
    );
    this.setData({
      pixabotFormatHint: meta.pixabotFormatHint,
      pixabotSetLabel: meta.pixabotSetLabel,
      pixabotCanAnimate: meta.pixabotCanAnimate,
    });
  },

  async ensureAvatarPoints({ animated = false } = {}) {
    const cost = Math.max(1, Number(this.data.pixabotCost) || 2);
    const ent = getCachedEntitlement() || {};
    if (animated && !this.canUseAnimatedAvatar()) {
      const go = await new Promise((resolve) => {
        wx.showModal({
          title: '会员专属',
          content: '动态头像仅包月会员可用，要去看看会员吗？',
          confirmText: '去看看',
          cancelText: '取消',
          success: (r) => resolve(!!r.confirm),
          fail: () => resolve(false),
        });
      });
      if (go) {
        this.closePixabotSheet();
        this.openPricing();
      }
      return { ok: false };
    }
    const bal = spendablePoints(ent);
    if (bal < cost) {
      const go = await new Promise((resolve) => {
        wx.showModal({
          title: '积分不足',
          content: `设头像需 ${cost} 积分，当前可用 ${bal}。去开通或买积分？`,
          confirmText: '去看看',
          cancelText: '取消',
          success: (r) => resolve(!!r.confirm),
          fail: () => resolve(false),
        });
      });
      if (go) {
        this.closePixabotSheet();
        this.openPricing();
      }
      return { ok: false };
    }
    const spend = await callFunction('userEntitlement', {
      action: 'spendFeature',
      feature: 'avatarCreate',
      animated: !!animated,
    });
    if (spend && spend.ok === false) {
      if (spend.code === 'VIP_REQUIRED') {
        const go = await new Promise((resolve) => {
          wx.showModal({
            title: '会员专属',
            content: spend.message || '动态头像仅会员可用',
            confirmText: '去看看',
            cancelText: '取消',
            success: (r) => resolve(!!r.confirm),
            fail: () => resolve(false),
          });
        });
        if (go) {
          this.closePixabotSheet();
          this.openPricing();
        }
      } else {
        wx.showToast({
          title: (spend.message || '扣费失败').slice(0, 40),
          icon: 'none',
        });
      }
      return { ok: false, spend };
    }
    if (spend && spend.entitlement) {
      setCachedEntitlement(spend.entitlement);
      this.refreshIdentity();
    }
    return { ok: true, spend, cost };
  },

  setPixabotSheetUi(visible) {
    if (visible) {
      this.setData({
        pixabotSheetVisible: true,
        pixabotPageStyle: 'overflow: hidden;',
      });
    } else {
      this._pixabotPreviewToken = (this._pixabotPreviewToken || 0) + 1;
      this.setData({
        pixabotSheetVisible: false,
        pixabotPreviewLoading: false,
        pixabotPageStyle: '',
      });
    }
  },

  resolvePixabotOpenState() {
    const last = loadLastPixabot();
    if (last) {
      return {
        combo: last.combo,
        hue: last.hue,
        saturate: last.saturate,
        format: last.format || 'png',
      };
    }
    const cached = getUserProfile() || {};
    const fromFile = parsePixabotIdFromFileID(
      cached.avatarFileID || this.data.avatarFileID || '',
    );
    if (fromFile && isValidId(fromFile)) {
      return {
        combo: decodeId(fromFile),
        hue: 0,
        saturate: 1,
        format: 'png',
      };
    }
    const openid = getOpenId() || '';
    const seeded = resolvePixabotParams(openid);
    return {
      combo: decodeId(seeded.id),
      hue: Number(seeded.hue) || 0,
      saturate: 1.25,
      format: this.data.pixabotFormat || 'png',
    };
  },

  openPixabotSheet() {
    const boot = this.resolvePixabotOpenState();
    const combo = boot.combo;
    const hue = boot.hue;
    const saturate = boot.saturate;
    const ent = getCachedEntitlement() || {};
    const cost = Math.max(
      1,
      Number(ent.costAvatarCreate || this.data.pixabotCost || 2) || 2,
    );
    const canAnimate = this.canUseAnimatedAvatar();
    const formatMeta = this.pixabotFormatMeta(
      boot.format || this.data.pixabotFormat || 'png',
      cost,
      canAnimate,
    );
    this._pixabotOpening = true;
    this.setPixabotSheetUi(true);
    this.setData({
      pixabotCategory: 'eyes',
      pixabotCost: cost,
      pixabotCanAnimate: canAnimate,
      pixabotPartOptions: buildPartOptions('eyes'),
      pixabotHue: hue,
      pixabotSaturate: saturate,
      pixabotHuePresetId: this.matchHuePresetId(hue, saturate),
      pixabotHuePresets: HUE_PRESETS,
      pixabotPreviewUrl: '',
      ...formatMeta,
    });
    this.applyPixabotCombo(combo, 'eyes', { hue, saturate });
    setTimeout(() => {
      this._pixabotOpening = false;
    }, 0);
    callFunction('userEntitlement', { action: 'get' })
      .then((res) => {
        if (res && res.entitlement) setCachedEntitlement(res.entitlement);
        const nextEnt = (res && res.entitlement) || getCachedEntitlement() || {};
        const nextCost = Math.max(
          1,
          Number(
            (res && res.costAvatarCreate) != null
              ? res.costAvatarCreate
              : nextEnt.costAvatarCreate || this.data.pixabotCost || 2,
          ) || 2,
        );
        const nextAnim = this.canUseAnimatedAvatar();
        const meta = this.pixabotFormatMeta(this.data.pixabotFormat, nextCost, nextAnim);
        this.setData({
          pixabotCost: nextCost,
          pixabotCanAnimate: nextAnim,
          ...meta,
        });
      })
      .catch(() => {});
  },

  closePixabotSheet() {
    this.setPixabotSheetUi(false);
  },

  onPixabotSheetVisible(e) {
    const visible = !!(e && e.detail && e.detail.visible);
    if (!visible) {
      this.setPixabotSheetUi(false);
      return;
    }
    // 打开由 openPixabotSheet 负责，避免 visible-change 再跑一遍抢 token
    if (this._pixabotOpening) return;
    this.setPixabotSheetUi(true);
  },

  onPixabotFormatChange(e) {
    const format =
      (e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.format) ||
      (e.target && e.target.dataset && e.target.dataset.format) ||
      'png';
    const meta = this.pixabotFormatMeta(
      format,
      this.data.pixabotCost,
      this.canUseAnimatedAvatar(),
    );
    this.setData(meta, () => {
      if (meta.pixabotFormat === 'json') return;
      this.applyPixabotCombo(
        this._pixabotCombo || this.data.pixabotCombo,
        this.data.pixabotCategory || 'eyes',
        this.pixabotPaletteOpts(),
      );
    });
  },

  onPixabotCopyId() {
    const id = String(this.data.pixabotId || '').trim();
    if (!id) return;
    wx.setClipboardData({
      data: id,
      success: () => wx.showToast({ title: '已复制 ID', icon: 'success' }),
    });
  },

  onPixabotCategoryChange(e) {
    const id =
      (e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id) ||
      '';
    if (!id || id === this.data.pixabotCategory) return;
    const combo = this.data.pixabotCombo || {};
    this.setData({
      pixabotCategory: id,
      pixabotPartOptions: buildPartOptions(id),
      pixabotSelectedIndex: Number(combo[id]) || 0,
    });
  },

  onPixabotPartPick(e) {
    if (this.data.pixabotSetting) return;
    const index = Number(e.currentTarget.dataset.index);
    if (!Number.isFinite(index) || index < 0) return;
    const cat = this.data.pixabotCategory || 'eyes';
    const combo = { ...(this._pixabotCombo || this.data.pixabotCombo || {}) };
    if (Number(combo[cat]) === index) return;
    combo[cat] = index;
    this.applyPixabotCombo(combo);
  },

  onPixabotHuePick(e) {
    if (this.data.pixabotSetting) return;
    const id =
      (e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id) ||
      '';
    const preset = HUE_PRESETS.find((item) => item.id === id);
    if (!preset) return;
    if (
      preset.id === this.data.pixabotHuePresetId &&
      preset.hue === this.data.pixabotHue
    ) {
      return;
    }
    this.applyPixabotCombo(this._pixabotCombo || this.data.pixabotCombo, null, {
      hue: preset.hue,
      saturate: preset.saturate,
    });
  },

  onPixabotShuffle() {
    if (this.data.pixabotSetting) return;
    const palette = randomPalette();
    const combo = randomCombo();
    // 部件 + 色相一起随机，并立刻反映到选中态
    this.applyPixabotCombo(combo, this.data.pixabotCategory || 'eyes', palette);
  },

  copyPixabotJson() {
    const id = String(this.data.pixabotId || '').trim();
    const combo = this._pixabotCombo || this.data.pixabotCombo || {};
    const palette = this.pixabotPaletteOpts();
    const payload = JSON.stringify(
      {
        id,
        eyes: Number(combo.eyes) || 0,
        heads: Number(combo.heads) || 0,
        body: Number(combo.body) || 0,
        top: Number(combo.top) || 0,
        hue: palette.hue,
        saturate: palette.saturate,
      },
      null,
      2,
    );
    wx.setClipboardData({
      data: payload,
      success: () => wx.showToast({ title: '已复制 JSON', icon: 'success' }),
    });
  },

  /** 设为资料头像（扣积分） */
  async onPixabotSetAvatar() {
    if (this.data.pixabotSetting) return;
    const id = String(this.data.pixabotId || '').trim();
    if (!id) return;
    const format = this.data.pixabotFormat || 'png';
    if (format === 'json') {
      this.copyPixabotJson();
      return;
    }

    const animated = format === 'gif';
    if (animated && !this.canUseAnimatedAvatar()) {
      await this.ensureAvatarPoints({ animated: true });
      return;
    }

    const combo = this._pixabotCombo || this.data.pixabotCombo;
    const palette = this.pixabotPaletteOpts();
    this.setData({ pixabotSetting: true, pixabotPreviewLoading: true });
    wx.showLoading({ title: animated ? '设为动图头像' : '设为头像', mask: true });
    try {
      const paidKey = `set:${id}:${format}:${palette.hue}:${palette.saturate}`;
      if (this._pixabotPaidId !== paidKey) {
        const paid = await this.ensureAvatarPoints({ animated });
        if (!paid.ok) return;
        this._pixabotPaidId = paidKey;
      }

      const openid = getOpenId() || 'anon';
      const filePath = animated
        ? await renderPixabotGif(combo, { size: 256, bg: '#f3f4f6', ...palette })
        : await renderPixabotPng(combo, { size: 256, bg: '#f3f4f6', ...palette });
      const ext = animated ? 'gif' : 'png';
      const cloudPath = `avatars/${openid}_pixabot_${id}_${Date.now()}.${ext}`;
      const fileID = await uploadFile(cloudPath, filePath);
      await this.saveProfile({ avatarFileID: fileID });
      saveLastPixabot({
        id,
        hue: palette.hue,
        saturate: palette.saturate,
        format: animated ? 'gif' : 'png',
      });
      this._pixabotPaidId = '';
      this.closePixabotSheet();
    } catch (err) {
      wx.showToast({
        title: (err && err.message ? err.message : '设置失败').slice(0, 40),
        icon: 'none',
      });
    } finally {
      this.setData({ pixabotSetting: false, pixabotPreviewLoading: false });
      this.refreshPixabotExportLabel();
      wx.hideLoading();
    }
  },

  /** 微信头像：免费上传 */
  async onChooseAvatar(e) {
    const tempPath = e.detail && e.detail.avatarUrl;
    if (!tempPath || this.data.pixabotSetting) return;
    this.setPixabotSheetUi(false);
    this.setData({ avatarUrl: tempPath });
    wx.showLoading({ title: '上传头像', mask: true });
    try {
      const openid = getOpenId() || 'anon';
      const cloudPath = `avatars/${openid}_${Date.now()}.jpg`;
      const fileID = await uploadFile(cloudPath, tempPath);
      await this.saveProfile({ avatarFileID: fileID });
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '头像上传失败', icon: 'none' });
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
      this.refreshAdRewardStatus();
      const grant = res.grant || {};
      const becameVip =
        grant.grantType === 'vip_days' || !!(res.entitlement && res.entitlement.isVip);
      const pointsAdded = Math.max(0, Number(grant.add) || 0);
      if (becameVip) {
        notifyFestivalAccessChange();
        this.refreshFestivalDecor();
        this.syncThemeUi();
      }
      if (pointsAdded > 0) {
        showPointsReward({
          host: this,
          points: pointsAdded,
          title: '兑换成功',
          tip: res.message || '',
        });
      } else {
        wx.showToast({
          title:
            res.message ||
            (becameVip ? '兑换成功 · 应用内免广告' : '兑换成功'),
          icon: 'success',
        });
      }
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

  goDrafts() {
    if (!resolveIsAdmin()) return;
    wx.navigateTo({ url: '/pages/admin/drafts/index' });
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
    if (!visible) this.refreshCheckinEntry();
  },

  onCheckinClose() {
    this.setData({ checkinVisible: false });
    this.refreshCheckinEntry();
  },

  onCheckinSuccess() {
    this.setData({
      checkinCheckedToday: true,
      checkinEntryText: '已签到',
    });
    this.syncEntitlement();
    this.refreshIdentity();
    syncAchievements({ toast: true }).then(() => this.refreshAvatarFrame());
  },

  async refreshCheckinEntry() {
    try {
      const res = await callFunction('userCheckin', { action: 'status' });
      const data = (res && res.data) || {};
      const checkedToday = !!data.checkedToday;
      this.setData({
        checkinCheckedToday: checkedToday,
        checkinEntryText: checkedToday ? '已签到' : '签到领积分',
      });
    } catch (e) {
      /* 入口文案失败时保持默认，不打断页面 */
    }
  },

  formatAdRewardNote(status) {
    const points = Math.max(0, Number(status && status.points) || defaultAdRewardPoints());
    const left = Math.max(0, Number(status && status.leftToday) || 0);
    const dailyMax = Math.max(0, Number(status && status.dailyMax) || 0);
    if (!(status && status.enabled)) return '暂未开放';
    if (left <= 0) {
      if (resolveIsAdmin()) return `今日已达上限 · 点此可重置`;
      return `今日已达上限（${dailyMax} 次）`;
    }
    return `看完 +${points} 积分 · 今日还可 ${left} 次`;
  },

  applyAdRewardStatus(status) {
    const next = status || {
      enabled: isAdRewardEnabled(),
      points: defaultAdRewardPoints(),
      dailyMax: defaultAdRewardDailyMax(),
      leftToday: defaultAdRewardDailyMax(),
    };
    // VIP 免被动广告，但仍可主动「看广告领积分」
    this.setData({
      adRewardVisible: !!next.enabled,
      adRewardPoints: next.points,
      adRewardLeftToday: next.leftToday,
      adRewardNote: this.formatAdRewardNote(next),
    });
  },

  async refreshAdRewardStatus() {
    if (!isAdRewardEnabled()) {
      this.applyAdRewardStatus({
        enabled: false,
        points: defaultAdRewardPoints(),
        dailyMax: defaultAdRewardDailyMax(),
        leftToday: 0,
      });
      return;
    }
    const status = await fetchAdRewardStatus('reward');
    this.applyAdRewardStatus(status);
  },

  async onWatchAdReward() {
    if (this.data.adRewardClaiming) return;
    if (!this.data.adRewardVisible) {
      wx.showToast({ title: '暂未开放看广告领积分', icon: 'none' });
      return;
    }
    if (this.data.adRewardLeftToday <= 0) {
      if (resolveIsAdmin()) {
        this.confirmResetAdRewardDay();
        return;
      }
      wx.showToast({ title: '今日次数已用完，明天再来', icon: 'none' });
      return;
    }

    this.setData({ adRewardClaiming: true });
    try {
      const res = await watchAdAndClaimPoints({ page: this, slot: 'reward' });
      if (!res || !res.ok) {
        if (res && res.reason === 'SKIPPED') return;
        wx.showToast({
          title: (res && res.message) || '领取失败',
          icon: 'none',
        });
        if (res && res.data) this.applyAdRewardStatus(res.data);
        else this.refreshAdRewardStatus();
        return;
      }
      this.applyAdRewardStatus(res.data);
      this.refreshIdentity();
      await this.syncEntitlement();
      showPointsReward({
        host: this,
        points: res.points || this.data.adRewardPoints,
        title: '看广告领积分',
        tip: res.message || '',
      });
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '领取失败', icon: 'none' });
      this.refreshAdRewardStatus();
    } finally {
      this.setData({ adRewardClaiming: false });
    }
  },

  confirmResetAdRewardDay() {
    if (!resolveIsAdmin()) return;
    wx.showModal({
      title: '重置激励次数',
      content: '清空今日「看广告领积分 / 保存救急 / 签到再领」计数，方便自测。不影响已得积分。',
      confirmText: '重置',
      success: (res) => {
        if (res.confirm) this.resetAdRewardDay();
      },
    });
  },

  async resetAdRewardDay() {
    if (!resolveIsAdmin() || this.data.adRewardClaiming) return;
    this.setData({ adRewardClaiming: true });
    try {
      const res = await callFunction('userEntitlement', {
        action: 'resetAdRewardDay',
      });
      if (!res || !res.ok) {
        wx.showToast({
          title: (res && res.message) || '重置失败',
          icon: 'none',
        });
        return;
      }
      if (res.data && res.data.reward) {
        this.applyAdRewardStatus(res.data.reward);
      } else {
        await this.refreshAdRewardStatus();
      }
      wx.showToast({ title: res.message || '已重置', icon: 'success' });
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '重置失败', icon: 'none' });
    } finally {
      this.setData({ adRewardClaiming: false });
    }
  },

  goPointsSettings() {
    if (!resolveIsAdmin()) return;
    wx.navigateTo({ url: '/pages/admin/points/index' });
  },

  goPricingSettings() {
    if (!resolveIsAdmin()) return;
    wx.navigateTo({ url: '/pages/admin/pricing/index' });
  },

  /** 管理员 2 秒内连点顶栏「我的」3 次进入 AI 配置（菜单不展示入口） */
  onMyTitleTap() {
    if (!resolveIsAdmin()) return;
    const now = Date.now();
    const windowMs = 2000;
    if (!this._aiEntryTaps || now - this._aiEntryLastTap > windowMs) {
      this._aiEntryTaps = 0;
    }
    this._aiEntryLastTap = now;
    this._aiEntryTaps += 1;
    if (this._aiEntryTaps < 3) return;
    this._aiEntryTaps = 0;
    wx.navigateTo({ url: '/pages/admin/ai/index' });
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
