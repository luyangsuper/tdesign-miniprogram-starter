import { callFunction } from '~/utils/cloud';
import { applyThemeToPage, getThemeStyle } from '~/utils/theme';
import { defaultCheckinPoints, defaultWelcomeGiftPoints } from '~/utils/giftHint';

Page({
  data: {
    themeStyle: '',
    loading: true,
    saving: false,
    granting: false,
    welcomeGiftPoints: String(defaultWelcomeGiftPoints()),
    checkinPoints: String(defaultCheckinPoints()),
    userCount: 0,
    campaignTitle: '',
    campaignPoints: '10',
    campaigns: [],
  },

  onLoad() {
    this.setData({ themeStyle: getThemeStyle() });
  },

  onShow() {
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
    if (
      Number.isNaN(welcomeGiftPoints) ||
      welcomeGiftPoints < 0 ||
      Number.isNaN(checkinPoints) ||
      checkinPoints < 0
    ) {
      wx.showToast({ title: '请填写有效非负整数', icon: 'none' });
      return;
    }
    this.setData({ saving: true });
    try {
      const res = await callFunction('adminManagePoints', {
        action: 'set',
        welcomeGiftPoints,
        checkinPoints,
      });
      const data = (res && res.data) || {};
      this.setData({
        welcomeGiftPoints: String(data.welcomeGiftPoints ?? welcomeGiftPoints),
        checkinPoints: String(data.checkinPoints ?? checkinPoints),
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
