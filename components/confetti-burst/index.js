/**
 * 轻量「炸裂纸屑」特效（view 粒子，适配小程序）
 * 思路参考开源：
 * - canvas-confetti（浏览器）https://www.npmjs.com/package/canvas-confetti
 * - wx_confetti_effect（小程序纸片）https://github.com/ManiacMike/wx_confetti_effect
 *
 * 用法：this.selectComponent('#confetti').burst()
 */
const COLORS = ['#10b981', '#f59e0b', '#3b82f6', '#ec4899', '#a855f7', '#ef4444', '#06b6d4'];

Component({
  data: {
    active: false,
    pieces: [],
  },

  lifetimes: {
    detached() {
      this.clearTimer();
    },
  },

  methods: {
    noop() {},

    clearTimer() {
      if (this._timer) {
        clearTimeout(this._timer);
        this._timer = null;
      }
    },

    /**
     * @param {{ count?: number, durationMs?: number, colors?: string[] }} [opts]
     */
    burst(opts = {}) {
      const count = Math.max(16, Math.min(64, Number(opts.count) || 42));
      const durationMs = Math.max(600, Number(opts.durationMs) || 1100);
      const palette =
        Array.isArray(opts.colors) && opts.colors.length ? opts.colors : COLORS;
      const pieces = [];
      for (let i = 0; i < count; i += 1) {
        const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.55;
        const dist = 140 + Math.random() * 220;
        const dx = Math.cos(angle) * dist;
        const dy = Math.sin(angle) * dist - 30 - Math.random() * 80;
        const shape = i % 3 === 0 ? 'circle' : i % 3 === 1 ? 'rect' : 'strip';
        pieces.push({
          id: `${Date.now()}_${i}`,
          shape,
          style: [
            `--dx:${dx.toFixed(1)}rpx`,
            `--dy:${dy.toFixed(1)}rpx`,
            `--c:${palette[i % palette.length]}`,
            `--r:${Math.floor(Math.random() * 520)}deg`,
            `--d:${(Math.random() * 0.12).toFixed(2)}s`,
            `--s:${(0.75 + Math.random() * 0.7).toFixed(2)}`,
          ].join(';'),
        });
      }
      this.clearTimer();
      this.setData({ active: true, pieces });
      this._timer = setTimeout(() => {
        this.setData({ active: false, pieces: [] });
        this._timer = null;
      }, durationMs);
    },
  },
});
