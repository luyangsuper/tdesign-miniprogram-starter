import config from './config';
import createBus from './utils/eventBus';
import { callFunction } from './utils/cloud';
import { applyLoginResult, getOpenId } from './utils/auth';
import { applyPendingPointGifts } from './utils/giftHint';
import {
  applyPendingLotteryInvites,
  applyPendingLotteryResults,
} from './utils/lotteryHint';
import { setCachedEntitlement } from './utils/entitlement';
import { initTheme } from './utils/theme';
import {
  ensureFestivalModeForRole,
  loadFestivalConfig,
} from './utils/festival';
import * as favoriteQueue from './utils/favoriteQueue';
import { showShareMenu } from './utils/share';

/** 公众号动态入口 oaId：字母数字 _ -，1～64 */
function normalizeOaId(raw) {
  const id = String(raw || '').trim();
  if (!id || id.length > 64) return '';
  if (!/^[A-Za-z0-9_-]+$/.test(id)) return '';
  return id;
}

function pickOaIdFromOptions(opts) {
  if (!opts) return '';
  // 页面 onLoad 可能直接是 { oaId }；App 生命周期多为 { query: { oaId } }
  const q =
    opts.query && typeof opts.query === 'object' ? opts.query : opts;
  const fromQuery = normalizeOaId(q && q.oaId);
  if (fromQuery) return fromQuery;
  // 部分入口把参数写在 path 上
  const path = String(opts.path || opts.pathname || '');
  const m = path.match(/[?&]oaId=([^&#]+)/i);
  if (m) {
    try {
      return normalizeOaId(decodeURIComponent(m[1]));
    } catch (e) {
      return normalizeOaId(m[1]);
    }
  }
  return '';
}

App({
  onLaunch(options) {
    initTheme();
    this.captureOaEntry(options);
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
      loadFestivalConfig({ silent: true }).catch(() => {});
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

  /** 从启动/切前台参数里抓取公众号动态 oaId */
  captureOaEntry(extraOptions) {
    try {
      let oaId = '';
      if (extraOptions) {
        oaId = pickOaIdFromOptions(extraOptions);
      }
      if (!oaId && typeof wx.getEnterOptionsSync === 'function') {
        oaId = pickOaIdFromOptions(wx.getEnterOptionsSync());
      }
      if (!oaId && typeof wx.getLaunchOptionsSync === 'function') {
        oaId = pickOaIdFromOptions(wx.getLaunchOptionsSync());
      }
      if (oaId) {
        this.globalData.pendingOaId = oaId;
      }
    } catch (e) {
      /* ignore */
    }
  },

  async claimPendingOaBonus() {
    const oaId = normalizeOaId(this.globalData.pendingOaId);
    if (!oaId || this._claimingOaBonus || !wx.cloud) return;
    // 本地可能已有上次登录的 openid；云调用本身用上下文 OPENID
    const openid = this.globalData.openid || getOpenId();
    if (!openid) return;
    if (!this.globalData.openid) this.globalData.openid = openid;
    this._claimingOaBonus = true;
    try {
      const res = await callFunction('userEntitlement', {
        action: 'claimOaBonus',
        oaId,
      });
      // 已领过 / 关闭 / 成功领取后都清掉 pending，避免反复打
      if (res && (res.claimed || res.skipped)) {
        this.globalData.pendingOaId = '';
      }
      if (res && res.entitlement) {
        setCachedEntitlement(res.entitlement);
      }
      if (res && res.claimed) {
        applyPendingPointGifts(res.pendingPointGifts);
        const n = Number(res.points) || 0;
        if (n > 0) {
          wx.showToast({ title: `公众号礼 +${n} 积分`, icon: 'none' });
        }
      } else if (
        res &&
        res.skipped &&
        Array.isArray(res.pendingPointGifts) &&
        res.pendingPointGifts.length
      ) {
        // 以前领过但弹窗可能错过：仍把待弹队列灌进首页
        applyPendingPointGifts(res.pendingPointGifts);
      }
    } catch (e) {
      // 失败保留 pendingOaId，下次 onShow 重试
    } finally {
      this._claimingOaBonus = false;
    }
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
        applyPendingLotteryInvites(res.pendingLotteryInvites, { replace: true });
        // login 不下发开奖结果，避免 replace 清空
        applyPendingLotteryResults(res.pendingLotteryResults);
        console.log('[login] openid ok, isAdmin =', res.isAdmin, 'nick =', res.nickName || '');
        ensureFestivalModeForRole(!!res.isAdmin);
        await loadFestivalConfig({ silent: true }).catch(() => {});
        await this.claimPendingOaBonus();
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

  onShow(options) {
    showShareMenu();
    this.captureOaEntry(options);
    this.claimPendingOaBonus();
    this.startLotteryPoll();
    this.pullLotteryPending();
  },

  onHide() {
    this.stopLotteryPoll();
  },

  startLotteryPoll() {
    this.stopLotteryPoll();
    this._lotteryPollTimer = setInterval(() => {
      this.pullLotteryPending();
    }, 5000);
  },

  stopLotteryPoll() {
    if (this._lotteryPollTimer) {
      clearInterval(this._lotteryPollTimer);
      this._lotteryPollTimer = null;
    }
  },

  async pullLotteryPending() {
    if (this._pullingLottery || !this.globalData.openid) return;
    this._pullingLottery = true;
    try {
      const res = await callFunction('userLottery', { action: 'pending' });
      const data = (res && res.data) || {};
      applyPendingLotteryInvites(data.pendingLotteryInvites, { replace: true });
      applyPendingLotteryResults(data.pendingLotteryResults, { replace: true });
    } catch (e) {
      /* ignore */
    } finally {
      this._pullingLottery = false;
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
    /** 公众号动态入口待领取 oaId */
    pendingOaId: '',
    pendingLotteryInvites: [],
    pendingLotteryResults: [],
    ackedLotteryInviteIds: [],
    ackedLotteryResultIds: [],
    /** 当前前台页 lottery-host 令牌，避免栈内多实例叠弹 */
    lotteryHostToken: 0,
  },

  eventBus: createBus(),
  favoriteQueue,
});
