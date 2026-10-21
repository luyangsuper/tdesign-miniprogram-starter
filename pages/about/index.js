import config from '~/config';
import { PRIVACY_POLICY, USER_AGREEMENT } from './legal';
import { applyThemeToPage, getThemeStyle } from '~/utils/theme';
import { shareAppMessage, shareTimeline } from '~/utils/share';

Page({
  data: {
    themeStyle: '',
    appName: '趣集',
    appVersion: config.appVersion || '0.1.0',
    intro:
      '趣集用来发现和保存表情、壁纸等素材合集。首页看封面，详情看预览；用包月额度或积分把原图存进相册，也可以先收藏，改天再来。',
    tips: [
      '1. 首页浏览合集封面',
      '2. 进入详情查看预览图',
      '3. 兑换包月（每月 36 积分）或积分后保存原图（静态 1 积分 / 动态 2 积分）',
    ],
    serviceWechat: config.serviceWechat || 'Shine_Luyang',
    legalVisible: false,
    legalTitle: '',
    legalUpdated: '',
    legalSections: [],
  },

  onLoad() {
    this.setData({ themeStyle: getThemeStyle() });
  },

  onShow() {
    applyThemeToPage(this);
  },

  onShareAppMessage() {
    return shareAppMessage();
  },

  onShareTimeline() {
    return shareTimeline();
  },

  openAgreement() {
    this.setData({
      legalVisible: true,
      legalTitle: USER_AGREEMENT.title,
      legalUpdated: USER_AGREEMENT.updated,
      legalSections: USER_AGREEMENT.sections,
    });
  },

  openPrivacy() {
    this.setData({
      legalVisible: true,
      legalTitle: PRIVACY_POLICY.title,
      legalUpdated: PRIVACY_POLICY.updated,
      legalSections: PRIVACY_POLICY.sections,
    });
  },

  closeLegal() {
    this.setData({ legalVisible: false });
  },

  onLegalVisibleChange(e) {
    this.setData({
      legalVisible: !!(e.detail && e.detail.visible),
    });
  },

  copyServiceWechat() {
    const data = this.data.serviceWechat;
    if (!data) return;
    wx.setClipboardData({
      data,
      success: () => wx.showToast({ title: '已复制客服微信', icon: 'none' }),
    });
  },
});
