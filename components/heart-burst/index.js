/**
 * 收藏爱心特效（view 粒子，适配小程序）
 * 思路参考开源，不引入浏览器 / 安卓依赖：
 * - HotHeart 抖音双击出心 https://github.com/KevinYou128/HotHeart
 * - transitions.dev like-button 粒子喷溅 https://github.com/Jakubantalik/transitions.dev
 * 实现方式对齐本仓库 confetti-burst。
 *
 * 用法：this.selectComponent('#heartBurst').burstFromEvent(e, { mode: 'in' | 'out' })
 */
const LIKE_COLORS = ['#EB5757', '#FF4D6D', '#FF8FAB', '#FF6B6B', '#F94144'];
const UNLIKE_COLORS = ['#B0B0B0', '#C9C9C9', '#EB5757'];

function tapPoint(e) {
  if (!e) return null;
  const t =
    (e.touches && e.touches[0]) ||
    (e.changedTouches && e.changedTouches[0]);
  if (t && typeof t.clientX === 'number') {
    return { x: t.clientX, y: t.clientY };
  }
  const d = e.detail || {};
  if (typeof d.x === 'number' && typeof d.y === 'number' && (d.x || d.y)) {
    return { x: d.x, y: d.y };
  }
  return null;
}

Component({
  data: {
    active: false,
    origin: '',
    items: [],
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

    burstFromEvent(e, opts = {}) {
      const pt = tapPoint(e);
      this.burst(Object.assign({}, opts, pt || {}));
    },

    /** @param {{ x?: number, y?: number, mode?: 'in'|'out' }} [opts] */
    burst(opts = {}) {
      const mode = opts.mode === 'out' ? 'out' : 'in';
      const x = Number(opts.x);
      const y = Number(opts.y);
      const origin =
        Number.isFinite(x) && Number.isFinite(y)
          ? `--x:${x}px;--y:${y}px;`
          : '--x:50%;--y:38%;';

      const items = [];
      const now = Date.now();
      const rot = (Math.random() * 36 - 18).toFixed(1);
      items.push({
        id: `${now}_pop`,
        kind: 'pop',
        tone: mode,
        style: `--r:${rot}deg;--d:0s;`,
      });
      items.push({
        id: `${now}_ring`,
        kind: 'ring',
        tone: mode,
        style: `--d:0.02s;`,
      });

      const sparkCount = mode === 'in' ? 12 : 7;
      const colors = mode === 'in' ? LIKE_COLORS : UNLIKE_COLORS;
      for (let i = 0; i < sparkCount; i += 1) {
        const angle = (Math.PI * 2 * i) / sparkCount + (Math.random() - 0.5) * 0.4;
        const dist = mode === 'in' ? 72 + Math.random() * 90 : 40 + Math.random() * 56;
        let dx = Math.cos(angle) * dist;
        let dy = Math.sin(angle) * dist - (mode === 'in' ? 12 : -24);
        if (mode === 'out') dy = Math.abs(dy) + 18;
        const kind = i % 3 === 0 ? 'dot' : 'spark';
        items.push({
          id: `${now}_${i}`,
          kind,
          tone: mode,
          style: [
            `--dx:${dx.toFixed(1)}px`,
            `--dy:${dy.toFixed(1)}px`,
            `--c:${colors[i % colors.length]}`,
            `--r:${(Math.random() * 50 - 25).toFixed(1)}deg`,
            `--d:${(0.04 + Math.random() * 0.1).toFixed(2)}s`,
            `--s:${(0.55 + Math.random() * 0.7).toFixed(2)}`,
          ].join(';'),
        });
      }

      const durationMs = mode === 'in' ? 880 : 720;
      this.clearTimer();
      this.setData({ active: true, origin, items });
      try {
        wx.vibrateShort({ type: mode === 'in' ? 'medium' : 'light' });
      } catch (err) {
        /* ignore */
      }
      this._timer = setTimeout(() => {
        this.setData({ active: false, items: [] });
        this._timer = null;
      }, durationMs);
    },
  },
});
