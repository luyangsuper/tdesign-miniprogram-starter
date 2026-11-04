/**
 * 积分到账庆祝浮层：大号 +N + 纸屑 + 短震
 * 纸屑复用 confetti-burst（参考 canvas-confetti / wx_confetti_effect）
 *
 * 用法：
 *   this.selectComponent('#pointsReward').show({ points: 2, title: '看广告领积分' })
 */
const DEFAULT_DURATION = 1500;
const OUT_MS = 220;

Component({
  data: {
    visible: false,
    closing: false,
    points: 0,
    title: '积分已到账',
    tip: '',
  },

  lifetimes: {
    detached() {
      this.clearTimers();
    },
  },

  methods: {
    noop() {},

    clearTimers() {
      if (this._hideTimer) {
        clearTimeout(this._hideTimer);
        this._hideTimer = null;
      }
      if (this._outTimer) {
        clearTimeout(this._outTimer);
        this._outTimer = null;
      }
    },

    /**
     * @param {{
     *   points?: number,
     *   title?: string,
     *   tip?: string,
     *   durationMs?: number,
     *   confetti?: boolean,
     *   vibrate?: boolean,
     * }} [opts]
     */
    show(opts = {}) {
      const points = Math.max(0, Math.floor(Number(opts.points) || 0));
      if (points <= 0) return;
      const title = String(opts.title || '积分已到账').trim() || '积分已到账';
      const tip = String(opts.tip || '').trim();
      const durationMs = Math.max(
        900,
        Math.min(2800, Number(opts.durationMs) || DEFAULT_DURATION),
      );
      const wantConfetti = opts.confetti !== false;
      const wantVibrate = opts.vibrate !== false;

      this.clearTimers();
      this.setData({
        visible: true,
        closing: false,
        points,
        title,
        tip,
      });

      if (wantVibrate) {
        try {
          wx.vibrateShort({ type: 'medium' });
        } catch (e) {
          try {
            wx.vibrateShort();
          } catch (e2) {
            /* ignore */
          }
        }
      }

      if (wantConfetti) {
        wx.nextTick(() => {
          const confetti = this.selectComponent('#prConfetti');
          if (confetti && typeof confetti.burst === 'function') {
            confetti.burst({
              count: Math.min(56, 28 + points * 4),
              durationMs: Math.min(1400, durationMs + 200),
              colors: ['#07c160', '#f59e0b', '#3b82f6', '#ec4899', '#fde68a', '#ffffff'],
            });
          }
        });
      }

      this._hideTimer = setTimeout(() => {
        this.hide();
      }, durationMs);
    },

    hide() {
      if (!this.data.visible || this.data.closing) return;
      this.clearTimers();
      this.setData({ closing: true });
      this._outTimer = setTimeout(() => {
        this.setData({ visible: false, closing: false, tip: '' });
        this._outTimer = null;
      }, OUT_MS);
    },
  },
});
