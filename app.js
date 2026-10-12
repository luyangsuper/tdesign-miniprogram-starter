import config from './config';
import createBus from './utils/eventBus';
import { callFunction } from './utils/cloud';
import { applyLoginResult } from './utils/auth';
import { applyPendingPointGifts } from './utils/giftHint';
import {
  applyPendingLotteryInvites,
  applyPendingLotteryResults,
} from './utils/lotteryHint';
import { initTheme } from './utils/theme';

App({
  onLaunch() {
    initTheme();
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上基础库以使用云能力');
    } else if (!config.cloudEnv) {
      console.error('[cloud] config.js 未填写 cloudEnv');
    } else {
      console.log('[cloud] init env =', config.cloudEnv);
      wx.cloud.init({
        env: config.cloudEnv,
        traceUser: true,
      });
      this.login();
    }

    const updateManager = wx.getUpdateManager();
    updateManager.onCheckForUpdate(() => {});
    updateManager.onUpdateReady(() => {
      wx.showModal({
        title: '更新提示',
        content: '新版本已经准备好，是否重启应用？',
        success(res) {
          if (res.confirm) updateManager.applyUpdate();
        },
      });
    });
  },

  async login() {
    try {
      let code = '';
      try {
        const loginRes = await new Promise((resolve, reject) => {
          wx.login({ success: resolve, fail: reject });
        });
        code = (loginRes && loginRes.code) || '';
      } catch (e) {
        /* 无 code 仍可静默拿 openid */
      }
      const res = await callFunction('login', code ? { code } : {});
      if (res.openid) {
        applyLoginResult(res);
        const gift = res.welcomeGift;
        if (gift && Number(gift.points) > 0) {
          const shownKey = `welcome_gift_shown_${res.openid}`;
          if (!wx.getStorageSync(shownKey)) {
            this.globalData.pendingWelcomeGift = {
              points: Math.max(0, Number(gift.points) || 0),
            };
            try {
              this.eventBus.emit('welcomeGift');
            } catch (e) {
              /* ignore */
            }
          }
        }
        applyPendingPointGifts(res.pendingPointGifts);
        applyPendingLotteryInvites(res.pendingLotteryInvites);
        applyPendingLotteryResults(res.pendingLotteryResults);
        console.log('[login] openid ok, isAdmin =', res.isAdmin, 'nick =', res.nickName || '');
      }
    } catch (e) {
      const msg = (e && (e.errMsg || e.message)) || String(e);
      console.warn('[login] fail', msg);
      // 环境 ID 不对时给出可读提示，避免只看到 openid 为空
      if (/INVALID_ENV|Environment not found|-501000/i.test(msg)) {
        wx.showModal({
          title: '云环境未就绪',
          content:
            'Environment not found：请到开发者工具顶部「云开发」确认环境 ID，复制「环境ID」（不是环境名称）到 config.js 的 cloudEnv，并确保 5 个云函数已上传到该环境。',
          showCancel: false,
        });
      }
    }
  },

  globalData: {
    openid: '',
    isAdmin: false,
    userInfo: null,
    entitlement: null,
    /** 发布/编辑合集后，首页 onShow 据此刷新列表 */
    homeNeedRefresh: false,
    themeId: 'wechat',
    themeStyle: '',
    themeBrand: '#07c160',
    /** 新用户见面礼，首页弹窗消费后清空 */
    pendingWelcomeGift: null,
    /** 切到「我的」后打开签到弹窗 */
    openCheckinPopup: false,
    /** 活动发积分待展示队列 */
    pendingActivityGifts: [],
    /** 本会话已确认的活动礼 id，防 ack 竞态重复弹窗 */
    ackedActivityGiftIds: [],
    pendingLotteryInvites: [],
    pendingLotteryResults: [],
    ackedLotteryInviteIds: [],
    ackedLotteryResultIds: [],
  },

  eventBus: createBus(),
});
