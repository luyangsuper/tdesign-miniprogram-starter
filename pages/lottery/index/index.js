import { callFunction } from '~/utils/cloud';
import { formatDate } from '~/utils/time';
import {
  applyPendingLotteryInvites,
  applyPendingLotteryResults,
  formatCountdown,
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

function mapList(raw) {
  return (raw || []).map((item) => ({
    ...item,
    drawAtText: formatDate(item.drawAt, 'YYYY-MM-DD HH:mm'),
    ...statusMeta(item),
  }));
}

Page({
  data: {
    themeStyle: '',
    loading: true,
    list: [],
    lotteryNotifyHint: buildLotteryNotifyHint(0, 0),
  },

  onLoad() {
    this.setData({ themeStyle: getThemeStyle() });
  },

  async onShow() {
    applyThemeToPage(this);
    this.refreshSubscribeHint();
    await this.refreshList({ showLoading: true });
    this.startWatchPoll();
  },

  onHide() {
    this.stopWatchPoll();
  },

  onUnload() {
    this.stopWatchPoll();
  },

  startWatchPoll() {
    this.stopWatchPoll();
    this._watchTimer = setInterval(() => {
      this.tickWatch();
    }, 3000);
  },

  stopWatchPoll() {
    if (this._watchTimer) {
      clearInterval(this._watchTimer);
      this._watchTimer = null;
    }
  },

  async tickWatch() {
    if (this._ticking) return;
    this._ticking = true;
    try {
      await this.refreshList({ showLoading: false });
    } catch (e) {
      /* ignore */
    } finally {
      this._ticking = false;
    }
  },

  async refreshList({ showLoading = false } = {}) {
    if (this._refreshing) return;
    this._refreshing = true;
    if (showLoading) this.setData({ loading: true });
    try {
      const res = await callFunction('userLottery', { action: 'list' });
      const data = (res && res.data) || {};
      const list = mapList(data.list || []);
      applyPendingLotteryInvites(data.pendingLotteryInvites, { replace: true });
      applyPendingLotteryResults(data.pendingLotteryResults, { replace: true });
      this.setData({ list, loading: false });
    } catch (e) {
      if (showLoading) {
        wx.showToast({ title: (e && e.message) || '加载失败', icon: 'none' });
      }
      this.setData({ loading: false });
    } finally {
      this._refreshing = false;
    }
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: `/pages/lottery/detail/index?id=${id}` });
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
