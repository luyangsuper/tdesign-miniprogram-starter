import { callFunction } from '~/utils/cloud';
import { formatDate } from '~/utils/time';
import {
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

Page({
  data: {
    themeStyle: '',
    loading: true,
    joining: false,
    id: '',
    title: '',
    poolPoints: 0,
    winnerCount: 0,
    participantCount: 0,
    drawAt: 0,
    drawAtText: '',
    status: '',
    joined: false,
    won: false,
    prizePoints: 0,
    winners: [],
    countdown: '',
    canJoin: false,
    isDrawn: false,
    lotteryNotifyHint: buildLotteryNotifyHint(0, 0),
    inviteCredits: 0,
    winCredits: 0,
  },

  onLoad(query) {
    const id = (query && query.id) || '';
    this.setData({ themeStyle: getThemeStyle(), id });
    this._id = id;
  },

  onShow() {
    applyThemeToPage(this);
    this.loadDetail({ silent: !!this.data.title });
    this.refreshSubscribeHint();
  },

  onHide() {
    this._clearTimer();
    this._stopDrawPoll();
  },

  onUnload() {
    this._clearTimer();
    this._stopDrawPoll();
  },

  _clearTimer() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  },

  _stopDrawPoll() {
    this._drawPolling = false;
  },

  _tickCountdown(drawAt) {
    this._clearTimer();
    const tick = () => {
      const left = (drawAt || 0) - Date.now();
      this.setData({
        countdown: formatCountdown(left),
        canJoin: this.data.status === 'open' && !this.data.joined && left > 0,
      });
      if (left <= 0 && this.data.status === 'open') {
        this._clearTimer();
        this.setData({ countdown: '开奖中…' });
        this._pollUntilDrawn();
      }
    };
    tick();
    this._timer = setInterval(tick, 1000);
  },

  async _pollUntilDrawn() {
    if (this._drawPolling) return;
    this._drawPolling = true;
    try {
      for (let i = 0; i < 30 && this._drawPolling; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await this.loadDetail({ silent: true });
        if (this.data.status === 'drawn' || this.data.status === 'cancelled') break;
        // eslint-disable-next-line no-await-in-loop
        await sleep(800);
      }
    } finally {
      this._drawPolling = false;
    }
  },

  async loadDetail(opts = {}) {
    const silent = !!opts.silent;
    const id = this._id || this.data.id;
    if (!id) {
      this.setData({ loading: false });
      return;
    }
    if (this._loadingDetail) {
      this._loadDetailQueued = { silent };
      return;
    }
    this._loadingDetail = true;
    if (!silent) this.setData({ loading: true });
    try {
      const res = await callFunction('userLottery', {
        action: 'get',
        lotteryId: id,
      });
      const d = (res && res.data) || {};
      const isDrawn = d.status === 'drawn';

      if (Array.isArray(d.pendingLotteryResults) && d.pendingLotteryResults.length) {
        applyPendingLotteryResults(d.pendingLotteryResults);
      }

      this.setData({
        title: d.title || '',
        poolPoints: d.poolPoints || 0,
        winnerCount: d.winnerCount || 0,
        participantCount: d.participantCount || 0,
        drawAt: d.drawAt || 0,
        drawAtText: formatDate(d.drawAt, 'YYYY-MM-DD HH:mm'),
        status: d.status || '',
        joined: !!d.joined,
        won: !!d.won,
        prizePoints: d.prizePoints || 0,
        winners: Array.isArray(d.winners) ? d.winners : [],
        isDrawn,
        canJoin: d.status === 'open' && !d.joined && (d.drawAt || 0) > Date.now(),
        loading: false,
      });

      if (d.status === 'open') {
        const left = (d.drawAt || 0) - Date.now();
        if (left <= 0) {
          this.setData({ countdown: '开奖中…' });
          if (!this._drawPolling) this._pollUntilDrawn();
        } else {
          this._tickCountdown(d.drawAt);
        }
      } else if (d.status === 'drawing') {
        this._clearTimer();
        this.setData({ countdown: '开奖中…' });
        if (!this._drawPolling) this._pollUntilDrawn();
      } else {
        this._clearTimer();
        if (isDrawn) this.setData({ countdown: '' });
      }
    } catch (e) {
      if (!silent) {
        wx.showToast({ title: (e && e.message) || '加载失败', icon: 'none' });
      }
      this.setData({ loading: false });
    } finally {
      this._loadingDetail = false;
      const queued = this._loadDetailQueued;
      this._loadDetailQueued = null;
      if (queued) this.loadDetail(queued);
    }
  },

  async onJoin() {
    if (this.data.joining || !this.data.canJoin) return;
    this.setData({ joining: true });
    try {
      try {
        await requestLotterySubscribe();
      } catch (e) {
        /* ignore */
      }
      await callFunction('userLottery', {
        action: 'join',
        lotteryId: this._id || this.data.id,
      });
      wx.showToast({ title: '已参与', icon: 'success' });
      this.loadDetail({ silent: true });
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '参与失败', icon: 'none' });
    } finally {
      this.setData({ joining: false });
    }
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
});
