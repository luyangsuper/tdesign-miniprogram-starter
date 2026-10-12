import { callFunction } from '~/utils/cloud';
import { formatDate } from '~/utils/time';
import { formatCountdown } from '~/utils/lotteryHint';
import { requestLotterySubscribe } from '~/utils/subscribe';
import { getThemeStyle } from '~/utils/theme';

Component({
  properties: {
    visible: { type: Boolean, value: false },
    mode: { type: String, value: 'invite' }, // invite | result
    invite: { type: Object, value: null },
    result: { type: Object, value: null },
    /** 结果态是否显示「查看名单」（详情页本身可关） */
    showDetailLink: { type: Boolean, value: true },
  },

  data: {
    themeStyle: '',
    title: '',
    metaLine: '',
    tip: '',
    countdown: '',
    won: false,
    prizePoints: 0,
    joining: false,
  },

  observers: {
    'visible, mode, invite, result': function sync(visible, mode, invite, result) {
      if (!visible) return;
      this.setData({ themeStyle: getThemeStyle() });
      if (mode === 'result' && result) {
        const won = !!result.won;
        this.setData({
          title: result.title || '开奖结果',
          won,
          prizePoints: Number(result.prizePoints) || 0,
          metaLine: won
            ? `恭喜中奖 +${Number(result.prizePoints) || 0} 积分`
            : '很遗憾，这次未中奖',
          tip: '积分已发放到账户 · 可在抽奖页查看完整名单',
          countdown: '',
        });
        return;
      }
      if (invite) {
        const drawAt = Number(invite.drawAt) || 0;
        this.setData({
          title: invite.title || '抽奖邀请',
          metaLine: `奖池 ${invite.poolPoints || 0} 积分 · ${invite.winnerCount || 0} 人中奖`,
          tip: `开奖时间 ${formatDate(drawAt, 'YYYY-MM-DD HH:mm') || '—'}`,
          countdown: formatCountdown(drawAt - Date.now()),
          won: false,
          prizePoints: 0,
        });
        this._startCountdown(drawAt);
      }
    },
  },

  lifetimes: {
    detached() {
      this._clearCountdown();
    },
  },

  methods: {
    _clearCountdown() {
      if (this._timer) {
        clearInterval(this._timer);
        this._timer = null;
      }
    },

    _startCountdown(drawAt) {
      this._clearCountdown();
      if (!drawAt) return;
      this._timer = setInterval(() => {
        this.setData({ countdown: formatCountdown(drawAt - Date.now()) });
      }, 1000);
    },

    onVisibleChange(e) {
      const visible = !!(e.detail && e.detail.visible);
      this.triggerEvent('visible-change', { visible });
      if (!visible) this.triggerEvent('close');
    },

    onClose() {
      this.triggerEvent('close');
    },

    async onJoin() {
      if (this.data.joining) return;
      const invite = this.data.invite || this.properties.invite;
      const lotteryId = invite && invite.lotteryId;
      if (!lotteryId) return;
      this.setData({ joining: true });
      try {
        // 参与前拉起订阅（中奖 / 下次抽奖机会）；拒绝不影响参与
        try {
          await requestLotterySubscribe();
        } catch (e) {
          /* ignore */
        }
        await callFunction('userLottery', { action: 'join', lotteryId });
        wx.showToast({ title: '已参与', icon: 'success' });
        this.triggerEvent('joined', { lotteryId, inviteId: invite.id });
      } catch (e) {
        wx.showToast({ title: (e && e.message) || '参与失败', icon: 'none' });
      } finally {
        this.setData({ joining: false });
      }
    },

    onViewDetail() {
      const invite = this.data.invite || this.properties.invite;
      const result = this.data.result || this.properties.result;
      const lotteryId =
        (invite && invite.lotteryId) || (result && result.lotteryId) || '';
      if (lotteryId) {
        wx.navigateTo({ url: `/pages/lottery/detail/index?id=${lotteryId}` });
      }
      this.triggerEvent('close');
    },

    onConfirmResult() {
      this.triggerEvent('close');
    },
  },
});
