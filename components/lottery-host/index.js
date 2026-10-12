import { callFunction } from '~/utils/cloud';
import { getCachedEntitlement, setCachedEntitlement } from '~/utils/entitlement';
import {
  applyPendingLotteryInvites,
  applyPendingLotteryResults,
  markLotteryInvitesAcked,
  markLotteryResultsAcked,
} from '~/utils/lotteryHint';

const POLL_MS = 4000;

Component({
  data: {
    resultVisible: false,
    result: null,
    inviteVisible: false,
    invite: null,
  },

  lifetimes: {
    attached() {
      this._pageActive = false;
      this._onLotteryInvite = () => {
        if (this._pageActive) this.maybeShow();
      };
      this._onLotteryResult = () => {
        if (this._pageActive) this.maybeShow();
      };
      try {
        const app = getApp();
        if (app && app.eventBus) {
          app.eventBus.on('lotteryInvite', this._onLotteryInvite);
          app.eventBus.on('lotteryResult', this._onLotteryResult);
        }
      } catch (e) {
        /* ignore */
      }
    },
    detached() {
      this.stopPoll();
      try {
        const app = getApp();
        if (app && app.eventBus) {
          if (this._onLotteryInvite) {
            app.eventBus.off('lotteryInvite', this._onLotteryInvite);
          }
          if (this._onLotteryResult) {
            app.eventBus.off('lotteryResult', this._onLotteryResult);
          }
        }
      } catch (e) {
        /* ignore */
      }
    },
  },

  pageLifetimes: {
    show() {
      this._pageActive = true;
      this.claimHost();
      this.pullPending();
      this.startPoll();
      this.maybeShow();
    },
    hide() {
      this._pageActive = false;
      this.releaseHost();
      this.stopPoll();
    },
  },

  methods: {
    claimHost() {
      try {
        const app = getApp();
        if (app && app.globalData) {
          app.globalData.lotteryHostToken = (app.globalData.lotteryHostToken || 0) + 1;
          this._hostToken = app.globalData.lotteryHostToken;
        }
      } catch (e) {
        this._hostToken = 1;
      }
    },

    releaseHost() {
      /* token 比较即可，无需清空 */
    },

    isTopHost() {
      try {
        const app = getApp();
        const token = app && app.globalData && app.globalData.lotteryHostToken;
        return !token || token === this._hostToken;
      } catch (e) {
        return true;
      }
    },

    startPoll() {
      this.stopPoll();
      this._pollTimer = setInterval(() => {
        if (!this._pageActive || !this.isTopHost()) return;
        if (this.data.resultVisible || this.data.inviteVisible) return;
        this.pullPending();
      }, POLL_MS);
    },

    stopPoll() {
      if (this._pollTimer) {
        clearInterval(this._pollTimer);
        this._pollTimer = null;
      }
    },

    async pullPending() {
      if (this._pulling) return;
      this._pulling = true;
      try {
        const res = await callFunction('userLottery', { action: 'pending' });
        const data = (res && res.data) || {};
        applyPendingLotteryInvites(data.pendingLotteryInvites, { replace: true });
        applyPendingLotteryResults(data.pendingLotteryResults, { replace: true });
        if (typeof data.points === 'number') {
          const cur = getCachedEntitlement();
          if (Number(cur.points) !== Number(data.points)) {
            setCachedEntitlement({ ...cur, points: data.points });
            try {
              const app = getApp();
              if (app && app.eventBus) app.eventBus.emit('entitlementChange');
            } catch (e) {
              /* ignore */
            }
          }
        }
        if (this._pageActive && this.isTopHost()) this.maybeShow();
      } catch (e) {
        /* ignore */
      } finally {
        this._pulling = false;
      }
    },

    _isResultAcked(lotteryId) {
      if (!lotteryId) return true;
      try {
        return !!wx.getStorageSync(`lottery_result_acked_${lotteryId}`);
      } catch (e) {
        return false;
      }
    },

    _markResultAcked(lotteryId) {
      if (!lotteryId) return;
      try {
        wx.setStorageSync(`lottery_result_acked_${lotteryId}`, 1);
      } catch (e) {
        /* ignore */
      }
    },

    maybeShow() {
      if (!this._pageActive || !this.isTopHost()) return;
      if (this._ignoreVisibleClose || this._closing) return;
      if (this.data.resultVisible || this.data.inviteVisible) return;
      try {
        const app = getApp();
        // 本地再挡一层过期邀请
        const rawInvites = (app.globalData && app.globalData.pendingLotteryInvites) || [];
        const freshInvites = rawInvites.filter((g) => {
          if (!g || !g.id || !g.lotteryId) return false;
          const drawAt = Number(g.drawAt) || 0;
          return !(drawAt > 0 && drawAt <= Date.now());
        });
        if (freshInvites.length !== rawInvites.length && app.globalData) {
          app.globalData.pendingLotteryInvites = freshInvites;
        }

        const results = (app.globalData && app.globalData.pendingLotteryResults) || [];
        const result = results.find(
          (g) => g && g.id && g.lotteryId && !this._isResultAcked(g.lotteryId),
        );
        if (result) {
          this._ignoreVisibleClose = true;
          this.setData({ resultVisible: true, result }, () => {
            setTimeout(() => {
              this._ignoreVisibleClose = false;
            }, 500);
          });
          return;
        }
        const invite = freshInvites.find((g) => g && g.id && g.lotteryId);
        if (invite) {
          this._ignoreVisibleClose = true;
          this.setData({ inviteVisible: true, invite }, () => {
            setTimeout(() => {
              this._ignoreVisibleClose = false;
            }, 500);
          });
        }
      } catch (e) {
        /* ignore */
      }
    },

    onResultVisibleChange(e) {
      if (this._ignoreVisibleClose) return;
      if (!(e.detail && e.detail.visible)) this.closeResult();
    },

    onInviteVisibleChange(e) {
      if (this._ignoreVisibleClose) return;
      if (!(e.detail && e.detail.visible)) this.closeInvite();
    },

    async closeResult() {
      if (this._closing || this._ignoreVisibleClose) return;
      this._closing = true;
      const result = this.data.result;
      const resultId = result && result.id;
      const lotteryId = result && result.lotteryId;
      if (lotteryId) this._markResultAcked(lotteryId);
      if (resultId) markLotteryResultsAcked([resultId]);
      this.setData({ resultVisible: false, result: null });
      try {
        const app = getApp();
        if (app.globalData) {
          app.globalData.pendingLotteryResults = (
            app.globalData.pendingLotteryResults || []
          ).filter((g) => g && g.id !== resultId && g.lotteryId !== lotteryId);
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
      // 中奖后强制刷一遍积分
      if (result && result.won) {
        try {
          const ent = await callFunction('userEntitlement', { action: 'get' });
          if (ent && ent.entitlement) {
            setCachedEntitlement(ent.entitlement);
            const app = getApp();
            if (app && app.eventBus) app.eventBus.emit('entitlementChange');
          }
        } catch (e) {
          /* ignore */
        }
      }
      this._closing = false;
      this.maybeShow();
    },

    async closeInvite() {
      if (this._closing || this._ignoreVisibleClose) return;
      this._closing = true;
      const invite = this.data.invite;
      const inviteId = invite && invite.id;
      const lotteryId = invite && invite.lotteryId;
      if (inviteId) markLotteryInvitesAcked([inviteId]);
      this.setData({ inviteVisible: false, invite: null });
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
      this._closing = false;
      this.maybeShow();
    },

    async onJoined(e) {
      const detail = (e && e.detail) || {};
      const inviteId =
        detail.inviteId || (this.data.invite && this.data.invite.id);
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
      this.setData({ inviteVisible: false, invite: null });
      this.maybeShow();
    },
  },
});
