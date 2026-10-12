import { callFunction } from '~/utils/cloud';
import { formatDate } from '~/utils/time';
import {
  applyPendingLotteryInvites,
  applyPendingLotteryResults,
  formatCountdown,
  markLotteryInvitesAcked,
  markLotteryResultsAcked,
} from '~/utils/lotteryHint';
import {
  buildLotteryNotifyHint,
  fetchLotterySubscribeStatus,
  requestLotterySubscribe,
} from '~/utils/subscribe';
import { applyThemeToPage, getThemeStyle } from '~/utils/theme';

function statusMeta(item) {
  const status = item.status || 'open';
  if (status === 'open') {
    return {
      statusLabel: '报名中',
      statusTheme: 'primary',
      sub: `距开奖 ${formatCountdown((item.drawAt || 0) - Date.now())}`,
    };
  }
  if (status === 'drawn') {
    return {
      statusLabel: '已开奖',
      statusTheme: 'success',
      sub: item.joined
        ? item.won
          ? `你中了 +${item.prizePoints || 0} 积分`
          : '你未中奖'
        : '未参与',
    };
  }
  if (status === 'cancelled') {
    return { statusLabel: '已取消', statusTheme: 'danger', sub: '' };
  }
  return { statusLabel: status, statusTheme: 'default', sub: '' };
}

Page({
  data: {
    themeStyle: '',
    loading: true,
    list: [],
    lotteryNotifyHint: buildLotteryNotifyHint(0, 0),
    lotteryResultVisible: false,
    lotteryResult: null,
    lotteryInviteVisible: false,
    lotteryInvite: null,
  },

  onLoad() {
    this.setData({ themeStyle: getThemeStyle() });
  },

  onShow() {
    applyThemeToPage(this);
    this.loadList();
    this.refreshSubscribeHint();
    this.pullAndShowPending();
  },

  async loadList() {
    this.setData({ loading: true });
    try {
      const res = await callFunction('userLottery', { action: 'list' });
      const raw = (res && res.data && res.data.list) || [];
      const list = raw.map((item) => {
        const meta = statusMeta(item);
        return {
          ...item,
          drawAtText: formatDate(item.drawAt, 'YYYY-MM-DD HH:mm'),
          ...meta,
        };
      });
      this.setData({ list });
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: `/pages/lottery/detail/index?id=${id}` });
  },

  async pullAndShowPending() {
    try {
      const res = await callFunction('userLottery', { action: 'pending' });
      const data = (res && res.data) || {};
      applyPendingLotteryInvites(data.pendingLotteryInvites);
      applyPendingLotteryResults(data.pendingLotteryResults);
    } catch (e) {
      /* ignore */
    }
    this.maybeShowLotteryResult();
    this.maybeShowLotteryInvite();
  },

  maybeShowLotteryResult() {
    if (
      this.data.lotteryResultVisible ||
      this.data.lotteryInviteVisible
    ) {
      return;
    }
    try {
      const app = getApp();
      const list = (app.globalData && app.globalData.pendingLotteryResults) || [];
      const item = list.find((g) => g && g.id && g.lotteryId);
      if (!item) return;
      this.setData({
        lotteryResultVisible: true,
        lotteryResult: item,
      });
    } catch (e) {
      /* ignore */
    }
  },

  maybeShowLotteryInvite() {
    if (
      this.data.lotteryResultVisible ||
      this.data.lotteryInviteVisible
    ) {
      return;
    }
    try {
      const app = getApp();
      const list = (app.globalData && app.globalData.pendingLotteryInvites) || [];
      const item = list.find((g) => g && g.id && g.lotteryId);
      if (!item) return;
      this.setData({
        lotteryInviteVisible: true,
        lotteryInvite: item,
      });
    } catch (e) {
      /* ignore */
    }
  },

  async closeLotteryResult() {
    if (this._closingLotteryResult) return;
    this._closingLotteryResult = true;
    const result = this.data.lotteryResult;
    const resultId = result && result.id;
    const lotteryId = result && result.lotteryId;
    if (resultId) markLotteryResultsAcked([resultId]);
    this.setData({ lotteryResultVisible: false, lotteryResult: null });
    try {
      const app = getApp();
      if (app.globalData) {
        app.globalData.pendingLotteryResults = (
          app.globalData.pendingLotteryResults || []
        ).filter((g) => g && g.id !== resultId);
      }
    } catch (e) {
      /* ignore */
    }
    try {
      await callFunction('userLottery', {
        action: 'ackResult',
        resultId,
        lotteryId,
      });
    } catch (e) {
      /* ignore */
    }
    this._closingLotteryResult = false;
    this.maybeShowLotteryResult();
    this.maybeShowLotteryInvite();
  },

  onLotteryResultVisibleChange(e) {
    if (!(e.detail && e.detail.visible)) {
      this.closeLotteryResult();
    }
  },

  async closeLotteryInvite() {
    if (this._closingLotteryInvite) return;
    this._closingLotteryInvite = true;
    const invite = this.data.lotteryInvite;
    const inviteId = invite && invite.id;
    const lotteryId = invite && invite.lotteryId;
    if (inviteId) markLotteryInvitesAcked([inviteId]);
    this.setData({ lotteryInviteVisible: false, lotteryInvite: null });
    try {
      const app = getApp();
      if (app.globalData) {
        app.globalData.pendingLotteryInvites = (
          app.globalData.pendingLotteryInvites || []
        ).filter((g) => g && g.id !== inviteId);
      }
    } catch (e) {
      /* ignore */
    }
    try {
      await callFunction('userLottery', {
        action: 'ackInvite',
        inviteId,
        lotteryId,
      });
    } catch (e) {
      /* ignore */
    }
    this._closingLotteryInvite = false;
    this.maybeShowLotteryResult();
    this.maybeShowLotteryInvite();
  },

  onLotteryInviteVisibleChange(e) {
    if (!(e.detail && e.detail.visible)) {
      this.closeLotteryInvite();
    }
  },

  async onLotteryJoined(e) {
    const detail = (e && e.detail) || {};
    const inviteId =
      detail.inviteId || (this.data.lotteryInvite && this.data.lotteryInvite.id);
    if (inviteId) markLotteryInvitesAcked([inviteId]);
    try {
      const app = getApp();
      if (app.globalData) {
        app.globalData.pendingLotteryInvites = (
          app.globalData.pendingLotteryInvites || []
        ).filter((g) => g && g.id !== inviteId);
      }
    } catch (err) {
      /* ignore */
    }
    this.setData({ lotteryInviteVisible: false, lotteryInvite: null });
    this.loadList();
    this.maybeShowLotteryInvite();
  },

  async refreshSubscribeHint() {
    try {
      const st = await fetchLotterySubscribeStatus();
      this.setData({
        lotteryNotifyHint: buildLotteryNotifyHint(st.inviteCredits, st.winCredits),
      });
    } catch (e) {
      /* ignore */
    }
  },

  async onSubscribe() {
    try {
      const res = await requestLotterySubscribe();
      const ok =
        (res.invite && res.invite.accepted) || (res.win && res.win.accepted);
      wx.showToast({
        title: ok ? '已开启抽奖提醒' : '未授权提醒',
        icon: ok ? 'success' : 'none',
      });
      this.refreshSubscribeHint();
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '订阅失败', icon: 'none' });
    }
  },
});
