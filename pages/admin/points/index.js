import { callFunction } from '~/utils/cloud';
import { guardAdminPage } from '~/utils/auth';
import { applyThemeToPage, getThemeStyle } from '~/utils/theme';
import {
  defaultAdRewardDailyMax,
  defaultAdRewardPoints,
  defaultCheckinPoints,
  defaultHomeFeedAdEvery,
  defaultOaBonusPoints,
  defaultSaveAdRewardDailyMax,
  defaultSaveAdRewardPoints,
  defaultWelcomeGiftPoints,
} from '~/utils/giftHint';
import { setHomeFeedAdEvery } from '~/utils/nativeAd';

Page({
  data: {
    themeStyle: '',
    loading: true,
    saving: false,
    granting: false,
    welcomeGiftPoints: String(defaultWelcomeGiftPoints()),
    checkinPoints: String(defaultCheckinPoints()),
    oaBonusPoints: String(defaultOaBonusPoints()),
    adRewardPoints: String(defaultAdRewardPoints()),
    adRewardDailyMax: String(defaultAdRewardDailyMax()),
    saveAdRewardPoints: String(defaultSaveAdRewardPoints()),
    saveAdRewardDailyMax: String(defaultSaveAdRewardDailyMax()),
    homeFeedAdEvery: String(defaultHomeFeedAdEvery()),
    userCount: 0,
    campaignTitle: '',
    campaignPoints: '10',
    campaigns: [],
  },

  onLoad() {
    this.setData({ themeStyle: getThemeStyle() });
  },

  onShow() {
    if (!guardAdminPage()) return;
    applyThemeToPage(this);
    this.loadSettings();
  },

  async loadSettings() {
    this.setData({ loading: true });
    try {
      const res = await callFunction('adminManagePoints', { action: 'get' });
      const data = (res && res.data) || {};
      this.setData({
        welcomeGiftPoints: String(
          data.welcomeGiftPoints != null
            ? data.welcomeGiftPoints
            : defaultWelcomeGiftPoints(),
        ),
        checkinPoints: String(
          data.checkinPoints != null ? data.checkinPoints : defaultCheckinPoints(),
        ),
        oaBonusPoints: String(
          data.oaBonusPoints != null ? data.oaBonusPoints : defaultOaBonusPoints(),
        ),
        adRewardPoints: String(
          data.adRewardPoints != null ? data.adRewardPoints : defaultAdRewardPoints(),
        ),
        adRewardDailyMax: String(
          data.adRewardDailyMax != null
            ? data.adRewardDailyMax
            : defaultAdRewardDailyMax(),
        ),
        saveAdRewardPoints: String(
          data.saveAdRewardPoints != null
            ? data.saveAdRewardPoints
            : defaultSaveAdRewardPoints(),
        ),
        saveAdRewardDailyMax: String(
          data.saveAdRewardDailyMax != null
            ? data.saveAdRewardDailyMax
            : defaultSaveAdRewardDailyMax(),
        ),
        homeFeedAdEvery: String(
          data.homeFeedAdEvery != null
            ? data.homeFeedAdEvery
            : defaultHomeFeedAdEvery(),
        ),
        userCount: Number(data.userCount) || 0,
        campaigns: Array.isArray(data.campaigns) ? data.campaigns : [],
      });
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  onWelcomeChange(e) {
    this.setData({ welcomeGiftPoints: (e.detail && e.detail.value) || '' });
  },

  onCheckinChange(e) {
    this.setData({ checkinPoints: (e.detail && e.detail.value) || '' });
  },

  onOaBonusChange(e) {
    this.setData({ oaBonusPoints: (e.detail && e.detail.value) || '' });
  },

  onAdRewardPointsChange(e) {
    this.setData({ adRewardPoints: (e.detail && e.detail.value) || '' });
  },

  onAdRewardDailyMaxChange(e) {
    this.setData({ adRewardDailyMax: (e.detail && e.detail.value) || '' });
  },

  onSaveAdRewardPointsChange(e) {
    this.setData({ saveAdRewardPoints: (e.detail && e.detail.value) || '' });
  },

  onSaveAdRewardDailyMaxChange(e) {
    this.setData({ saveAdRewardDailyMax: (e.detail && e.detail.value) || '' });
  },

  onHomeFeedAdEveryChange(e) {
    this.setData({ homeFeedAdEvery: (e.detail && e.detail.value) || '' });
  },

  onCampaignTitleChange(e) {
    this.setData({ campaignTitle: (e.detail && e.detail.value) || '' });
  },

  onCampaignPointsChange(e) {
    this.setData({ campaignPoints: (e.detail && e.detail.value) || '' });
  },

  async onSave() {
    if (this.data.saving || this.data.granting) return;
    const welcomeGiftPoints = Number(this.data.welcomeGiftPoints);
    const checkinPoints = Number(this.data.checkinPoints);
    const oaBonusPoints = Number(this.data.oaBonusPoints);
    const adRewardPoints = Number(this.data.adRewardPoints);
    const adRewardDailyMax = Number(this.data.adRewardDailyMax);
    const saveAdRewardPoints = Number(this.data.saveAdRewardPoints);
    const saveAdRewardDailyMax = Number(this.data.saveAdRewardDailyMax);
    const homeFeedAdEvery = Number(this.data.homeFeedAdEvery);
    if (
      Number.isNaN(welcomeGiftPoints) ||
      welcomeGiftPoints < 0 ||
      Number.isNaN(checkinPoints) ||
      checkinPoints < 0 ||
      Number.isNaN(oaBonusPoints) ||
      oaBonusPoints < 0 ||
      Number.isNaN(adRewardPoints) ||
      adRewardPoints < 0 ||
      Number.isNaN(adRewardDailyMax) ||
      adRewardDailyMax < 0 ||
      Number.isNaN(saveAdRewardPoints) ||
      saveAdRewardPoints < 0 ||
      Number.isNaN(saveAdRewardDailyMax) ||
      saveAdRewardDailyMax < 0 ||
      Number.isNaN(homeFeedAdEvery) ||
      homeFeedAdEvery < 0 ||
      homeFeedAdEvery > 20
    ) {
      wx.showToast({ title: '请填写有效非负整数（信息流间隔 0～20）', icon: 'none' });
      return;
    }
    this.setData({ saving: true });
    try {
      const res = await callFunction('adminManagePoints', {
        action: 'set',
        welcomeGiftPoints,
        checkinPoints,
        oaBonusPoints,
        adRewardPoints,
        adRewardDailyMax,
        saveAdRewardPoints,
        saveAdRewardDailyMax,
        homeFeedAdEvery,
      });
      const data = (res && res.data) || {};
      const nextEvery = data.homeFeedAdEvery ?? homeFeedAdEvery;
      setHomeFeedAdEvery(nextEvery);
      this.setData({
        welcomeGiftPoints: String(data.welcomeGiftPoints ?? welcomeGiftPoints),
        checkinPoints: String(data.checkinPoints ?? checkinPoints),
        oaBonusPoints: String(data.oaBonusPoints ?? oaBonusPoints),
        adRewardPoints: String(data.adRewardPoints ?? adRewardPoints),
        adRewardDailyMax: String(data.adRewardDailyMax ?? adRewardDailyMax),
        saveAdRewardPoints: String(
          data.saveAdRewardPoints ?? saveAdRewardPoints,
        ),
        saveAdRewardDailyMax: String(
          data.saveAdRewardDailyMax ?? saveAdRewardDailyMax,
        ),
        homeFeedAdEvery: String(nextEvery),
      });
      wx.showToast({ title: res.message || '已保存', icon: 'success' });
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '保存失败', icon: 'none' });
    } finally {
      this.setData({ saving: false });
    }
  },

  onGrant() {
    if (this.data.granting || this.data.saving) return;
    const title = String(this.data.campaignTitle || '').trim();
    const points = Number(this.data.campaignPoints);
    if (!title) {
      wx.showToast({ title: '请填写活动标题', icon: 'none' });
      return;
    }
    if (Number.isNaN(points) || points < 1) {
      wx.showToast({ title: '积分至少为 1', icon: 'none' });
      return;
    }
    const n = this.data.userCount || 0;
    wx.showModal({
      title: '确认发放',
      content: `将给当前已注册的 ${n} 名用户各发放 ${points} 积分（标题：${title}）。从未登录的用户不会收到。是否继续？`,
      confirmText: '确认发放',
      success: (r) => {
        if (r.confirm) this.doGrant(title, points);
      },
    });
  },

  async doGrant(title, points) {
    this.setData({ granting: true });
    wx.showLoading({ title: '发放中', mask: true });
    try {
      const res = await callFunction('adminManagePoints', {
        action: 'grantCampaign',
        title,
        points,
      });
      wx.hideLoading();
      wx.showModal({
        title: '发放完成',
        content: res.message || '已发放',
        showCancel: false,
      });
      this.setData({ campaignTitle: '', campaignPoints: '10' });
      this.loadSettings();
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: (e && e.message) || '发放失败', icon: 'none' });
    } finally {
      this.setData({ granting: false });
    }
  },
});
