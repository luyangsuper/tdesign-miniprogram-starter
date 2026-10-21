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
    joinLabel: '参与抽奖',
    isPaid: false,
    costPoints: 0,
    refunded: false,
  },

  observers: {
    'visible, mode, invite, result': function sync(visible, mode, invite, result) {
      if (!visible) return;
      this.setData({ themeStyle: getThemeStyle() });
      if (mode === 'result' && result) {
        const won = !!result.won;
        const refunded = !!result.refunded;
        this.setData({
          title: result.title || '开奖结果',
          won,
          refunded,
          prizePoints: Number(result.prizePoints) || 0,
          metaLine: refunded
            ? '人数不足，报名费已退回'
            : won
              ? `恭喜中奖 +${Number(result.prizePoints) || 0} 积分`
              : '很遗憾，这次未中奖',
          tip: refunded
            ? '积分已退回账户'
            : won
              ? '积分已发放到账户 · 可在抽奖页查看完整名单'
              : result.paid
                ? '报名费不退回'
                : '可在抽奖页查看完整名单',
          countdown: '',
        });
        return;
      }
      if (invite) {
        const drawAt = Number(invite.drawAt) || 0;
        const paid = invite.type === 'paid';
        const cost = Number(invite.costPoints) || 0;
        this.setData({
          title: invite.title || '抽奖邀请',
          isPaid: paid,
          costPoints: cost,
          joinLabel: paid ? `投入 ${cost} 分参与` : '参与抽奖',
          metaLine: paid
            ? `投入 ${cost} 分 · 奖池上限 ${invite.poolPoints || 0} · ${invite.winnerCount || 0} 人中奖`
            : `奖池 ${invite.poolPoints || 0} 积分 · ${invite.winnerCount || 0} 人中奖`,
          tip: `开奖时间 ${formatDate(drawAt, 'YYYY-MM-DD HH:mm') || '—'}`,
          countdown: formatCountdown(drawAt - Date.now()),
          won: false,
          refunded: false,
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
      // 只转发，不在这里自动 close（避免初始化时 visible=false 误关）
      this.triggerEvent('visible-change', { visible });
    },

    onClose() {
      this.triggerEvent('close');
    },

    async onJoin() {
      if (this.data.joining) return;
      const invite = this.data.invite || this.properties.invite;
      const lotteryId = invite && invite.lotteryId;
      if (!lotteryId) return;
      const paid = (invite && invite.type) === 'paid';
      const cost = Number((invite && invite.costPoints) || this.data.costPoints) || 0;
      if (paid) {
        const ok = await new Promise((resolve) => {
          wx.showModal({
            title: '投入积分参与',
            content: `将扣除 ${cost} 积分报名。未中奖不退回；仅少数人中奖。`,
            confirmText: '确认投入',
            success: (r) => resolve(!!r.confirm),
            fail: () => resolve(false),
          });
        });
        if (!ok) return;
      }
      this.setData({ joining: true });
      try {
        try {
          await requestLotterySubscribe();
        } catch (e) {
          /* ignore */
        }
        await callFunction('userLottery', { action: 'join', lotteryId });
        wx.showToast({ title: paid ? `已投入 ${cost} 分` : '已参与', icon: 'success' });
        this.triggerEvent('joined', { lotteryId, inviteId: invite.id });
      } catch (e) {
        const msg = (e && e.message) || '参与失败';
        if (paid && /积分不足/.test(msg)) {
          const go = await new Promise((resolve) => {
            wx.showModal({
              title: '积分不足',
              content: `${msg}。可到「我的」签到或购买积分。`,
              confirmText: '去我的',
              success: (r) => resolve(!!r.confirm),
              fail: () => resolve(false),
            });
          });
          if (go) {
            this.triggerEvent('close');
            wx.switchTab({ url: '/pages/my/index' });
          }
        } else {
          wx.showToast({ title: msg, icon: 'none' });
        }
      } finally {
        this.setData({ joining: false });
      }
    },

    onViewDetail() {
      const invite = this.data.invite || this.properties.invite;
      const result = this.data.result || this.properties.result;
      const lotteryId =
        (invite && invite.lotteryId) || (result && result.lotteryId) || '';
      this.triggerEvent('close');
      if (lotteryId) {
        wx.navigateTo({ url: `/pages/lottery/detail/index?id=${lotteryId}` });
      }
    },

    onConfirmResult() {
      this.triggerEvent('close');
    },
  },
});
