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
  lotterySubscribeToast,
  requestLotterySubscribe,
} from '~/utils/subscribe';
import { applyThemeToPage, getThemeStyle } from '~/utils/theme';
import { shareAppMessage, shareTimeline } from '~/utils/share';
import { destroyLotteryAudio } from '~/utils/lotteryAudio';

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
      sub: item.drawOutcome === 'refunded'
        ? item.joined
          ? '人数不足，投入已退回'
          : '人数不足已退费'
        : item.joined
          ? item.won
            ? `你中了 +${item.prizePoints || 0} 积分`
            : item.type === 'paid'
              ? '你未中奖，报名费不退回'
              : '你未中奖'
          : '未参与',
    };
  }
  if (status === 'cancelled') {
    return {
      statusLabel: '已取消',
      statusTheme: 'danger',
      sub: item.type === 'paid' && item.joined ? '报名费已退回' : '',
    };
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
    inviteCredits: 0,
    winCredits: 0,
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
    destroyLotteryAudio();
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
        inviteCredits: st.inviteCredits,
        winCredits: st.winCredits,
        lotteryNotifyHint: buildLotteryNotifyHint(st.inviteCredits, st.winCredits),
      });
    } catch (e) {
      /* ignore */
    }
  },

  async onSubscribe() {
    try {
      // 用已缓存额度，勿在 tap 里先 await 再订阅（会打断手势导致失败）
      const res = await requestLotterySubscribe({
        inviteCredits: this.data.inviteCredits,
        winCredits: this.data.winCredits,
      });
      await this.refreshSubscribeHint();
      const tip = lotterySubscribeToast(res, {
        inviteCredits: this.data.inviteCredits,
        winCredits: this.data.winCredits,
      });
      wx.showToast({ title: tip.title, icon: tip.icon, duration: 2800 });
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '订阅失败', icon: 'none' });
    }
  },

  onShareAppMessage() {
    return shareAppMessage({
      title: '趣集抽奖',
      path: '/pages/lottery/index/index',
    });
  },

  onShareTimeline() {
    return shareTimeline({ title: '趣集抽奖' });
  },
});
