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
import { getPricingPlans } from '~/utils/pricing';
import { buyPlan } from '~/utils/virtualPay';
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

/**
 * 预览普通用户：只隐藏管理员身份，仍按真实权益显示 VIP / 积分
 * （方便管理员自充会员后测「有会员的普通用户」）
 */
function buildRoleLabel({ isAdmin, isVip, points, vipMonthQuota, previewAsUser }) {
  if (!previewAsUser && isAdmin) return '管理员';
  let base = '普通用户';
  if (isVip) base = '包月会员';
  else if ((points || 0) + (vipMonthQuota || 0) > 0) {
    base = `积分 ${(points || 0) + (vipMonthQuota || 0)}`;
  }
  return previewAsUser ? `预览·${base}` : base;
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
    feedbackVisible: false,
    feedbackContent: '',
    feedbackContact: '',
    feedbackSubmitting: false,
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
    }
    this.refreshIdentity();
    this.syncProfileFromCloud();
    this.syncEntitlement();
    this.refreshNotifyStatus();
    this.refreshFeedbackNotifyStatus();
    this.maybeOpenCheckinPopup();
  },

  onLoad() {
    this.syncThemeUi();
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
    this.setData({
      themeStyle: getThemeStyle(),
      themeBrand: getThemeBrand(),
      themeId,
      themeName: (hit && hit.name) || '微信绿',
      themePresets: presets,
    });
  },

  openPricing() {
    this.setData({ pricingVisible: true, pricing: getPricingPlans() });
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

  async onSubmitFeedback() {
    if (this.data.feedbackSubmitting) return;
    const content = String(this.data.feedbackContent || '').trim();
    if (content.length < 2) {
      wx.showToast({ title: '请多写一点建议', icon: 'none' });
      return;
    }
    this.setData({ feedbackSubmitting: true });
    try {
      await callFunction('submitFeedback', {
        content,
        contact: String(this.data.feedbackContact || '').trim(),
      });
      this.setData({
        feedbackVisible: false,
        feedbackContent: '',
        feedbackContact: '',
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
      applyPendingLotteryInvites(res && res.pendingLotteryInvites);
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
      applyPendingLotteryInvites(res.pendingLotteryInvites);
      applyPendingLotteryResults(res.pendingLotteryResults);
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
    wx.navigateTo({ url: '/pages/admin/upload/index' });
  },

  goCategories() {
    wx.navigateTo({ url: '/pages/admin/categories/index' });
  },

  goCodes() {
    wx.navigateTo({ url: '/pages/admin/codes/index' });
  },

  goUsers() {
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
    wx.navigateTo({ url: '/pages/admin/points/index' });
  },

  goAdminLottery() {
    wx.navigateTo({ url: '/pages/admin/lottery/index' });
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
    this.setData({ lookupVisible: true, lookupId: '' });
  },

  onLookupIdChange(e) {
    this.setData({ lookupId: (e.detail && e.detail.value) || '' });
  },

  onLookupCancel() {
    this.setData({ lookupVisible: false, lookupId: '' });
  },

  async onLookupConfirm() {
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
