import { callFunction } from '~/utils/cloud';
import { formatDate } from '~/utils/time';
import {
  applyPendingLotteryInvites,
  applyPendingLotteryResults,
  formatCountdown,
  markLotteryResultsAcked,
} from '~/utils/lotteryHint';
import {
  buildLotteryNotifyHint,
  fetchLotterySubscribeStatus,
  requestLotterySubscribe,
} from '~/utils/subscribe';
import { applyThemeToPage, getThemeStyle } from '~/utils/theme';

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
    lotteryResultVisible: false,
    lotteryResult: null,
  },

  onLoad(query) {
    const id = (query && query.id) || '';
    this.setData({ themeStyle: getThemeStyle(), id });
    this._id = id;
  },

  onShow() {
    applyThemeToPage(this);
    this.loadDetail();
    this.refreshSubscribeHint();
  },

  onHide() {
    this._clearTimer();
  },

  onUnload() {
    this._clearTimer();
  },

  _clearTimer() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
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
        this.loadDetail();
      }
    };
    tick();
    this._timer = setInterval(tick, 1000);
  },

  async pullLotteryPending() {
    try {
      const res = await callFunction('userLottery', { action: 'pending' });
      const data = (res && res.data) || {};
      applyPendingLotteryInvites(data.pendingLotteryInvites);
      applyPendingLotteryResults(data.pendingLotteryResults);
    } catch (e) {
      /* ignore */
    }
  },

  maybeShowResultPopup(d) {
    if (this.data.lotteryResultVisible) return;
    if (!d || d.status !== 'drawn' || !d.joined) return;
    const lotteryId = this._id || this.data.id;
    if (!lotteryId) return;

    let result = null;
    try {
      const app = getApp();
      const list = (app.globalData && app.globalData.pendingLotteryResults) || [];
      result = list.find((g) => g && g.lotteryId === lotteryId) || null;
    } catch (e) {
      result = null;
    }

    // 队列没有时（偶发写失败），参与者仍弹一次，避免蹲详情页无反馈
    if (!result) {
      if (this._localResultShown === lotteryId) return;
      this._localResultShown = lotteryId;
      result = {
        id: `result_${lotteryId}_local`,
        lotteryId,
        title: d.title || this.data.title || '开奖结果',
        won: !!d.won,
        prizePoints: Number(d.prizePoints) || 0,
      };
    }

    this.setData({
      lotteryResultVisible: true,
      lotteryResult: result,
    });
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
    if (resultId && !String(resultId).endsWith('_local')) {
      try {
        await callFunction('userLottery', {
          action: 'ackResult',
          resultId,
          lotteryId,
        });
      } catch (e) {
        /* ignore */
      }
    }
    this._closingLotteryResult = false;
  },

  onLotteryResultVisibleChange(e) {
    if (!(e.detail && e.detail.visible)) {
      this.closeLotteryResult();
    }
  },

  async loadDetail() {
    const id = this._id || this.data.id;
    if (!id) {
      this.setData({ loading: false });
      return;
    }
    this.setData({ loading: true });
    try {
      const res = await callFunction('userLottery', { action: 'get', lotteryId: id });
      const d = (res && res.data) || {};
      const isDrawn = d.status === 'drawn';
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
      });
      if (d.status === 'open') {
        this._tickCountdown(d.drawAt);
      } else {
        this._clearTimer();
        this.setData({ countdown: '' });
      }
      // 开奖后立刻拉队列并弹结果（含倒计时归零触发的懒开奖）
      if (isDrawn && d.joined) {
        await this.pullLotteryPending();
        this.maybeShowResultPopup(d);
      }
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
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
      this.loadDetail();
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
