const ANIM_MS = 420;

function hexToRgba(hex, alpha) {
  const h = String(hex || '').replace('#', '');
  if (h.length !== 6) return `rgba(7, 193, 96, ${alpha})`;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function toYuan(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n;
}

function trimNum(s) {
  return String(s)
    .replace(/(\.\d*?[1-9])0+$/, '$1')
    .replace(/\.0+$/, '');
}

function formatYuan(n) {
  const v = Number(n) || 0;
  if (v >= 100 || Number.isInteger(v)) return `¥${v.toFixed(0)}`;
  return `¥${v.toFixed(2)}`;
}

function formatAxisYuan(n) {
  const v = Number(n) || 0;
  if (v <= 0) return '¥0';
  if (v >= 100000) {
    const wan = v / 10000;
    const s = wan >= 100 ? wan.toFixed(0) : wan.toFixed(1);
    return `¥${trimNum(s)}万`;
  }
  if (Math.abs(v - Math.round(v)) < 1e-6) return `¥${Math.round(v)}`;
  if (v >= 10) return `¥${trimNum(v.toFixed(1))}`;
  return `¥${trimNum(v.toFixed(2))}`;
}

function niceCeil(v) {
  if (!Number.isFinite(v) || v <= 0) return 0;
  const exp = 10 ** Math.floor(Math.log10(v));
  const n = v / exp;
  const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return nice * exp;
}

function buildYTicks(axisMax) {
  if (!axisMax) return ['¥0', '¥0', '¥0'];
  return [axisMax, axisMax / 2, 0].map(formatAxisYuan);
}

function yWidthRpx(ticks) {
  const longest = (ticks || []).reduce(
    (m, t) => Math.max(m, Array.from(String(t)).length),
    1,
  );
  return Math.max(36, longest * 14);
}

function pickLabels(series) {
  const n = series.length;
  if (!n) return [];
  if (n <= 8) return series.map((s) => s.label || '');
  const keep = new Set([0, n - 1]);
  for (let i = 1; i < 4; i += 1) {
    keep.add(Math.round((i * (n - 1)) / 4));
  }
  return series.map((s, i) => (keep.has(i) ? s.label || '' : ''));
}

function hintFor(item) {
  if (!item) return '';
  return `${item.label || ''}  ${formatYuan(item.yuan)}`;
}

function normalizeSeries(raw) {
  return (raw || [])
    .map((row) => ({
      key: row.key || row.label || '',
      label: row.label || '',
      yuan: toYuan(row.yuan),
    }))
    .filter((row) => row.key || row.label);
}

function sampleYuan(series, t) {
  if (!series || !series.length) return 0;
  if (series.length === 1) return series[0].yuan;
  const pos = Math.max(0, Math.min(1, t)) * (series.length - 1);
  const i = Math.min(series.length - 2, Math.floor(pos));
  const f = pos - i;
  return series[i].yuan + (series[i + 1].yuan - series[i].yuan) * f;
}

function lerpSeries(from, to, p) {
  const n = to.length;
  return to.map((row, i) => {
    const t = n <= 1 ? 0 : i / (n - 1);
    const fromY = sampleYuan(from, t);
    return { ...row, yuan: fromY + (row.yuan - fromY) * p };
  });
}

function easeOutCubic(t) {
  const x = Math.max(0, Math.min(1, t));
  return 1 - (1 - x) ** 3;
}

function seriesKey(series) {
  return (series || []).map((s) => `${s.key}:${s.yuan}`).join('|');
}

Component({
  options: {
    styleIsolation: 'apply-shared',
  },
  properties: {
    series: {
      type: Array,
      value: [],
    },
    color: {
      type: String,
      value: '#07c160',
    },
  },
  data: {
    labels: [],
    yTicks: ['¥0', '¥0', '¥0'],
    yWidthRpx: 36,
    hint: '',
  },
  observers: {
    series() {
      this._hintTouched = false;
      this._active = null;
      this.scheduleDraw({ animate: true });
    },
    color() {
      this.scheduleDraw({ animate: false });
    },
  },
  lifetimes: {
    ready() {
      this.scheduleDraw({ animate: false });
    },
    detached() {
      this._dead = true;
      this._animToken += 1;
    },
  },
  methods: {
    scheduleDraw(options = {}) {
      if (this._drawTimer) clearTimeout(this._drawTimer);
      this._drawTimer = setTimeout(() => {
        this._drawTimer = null;
        this.draw(options);
      }, 30);
    },

    onTouchStart(e) {
      const pts = this._pts || [];
      if (!pts.length) return;
      this._hintTouched = true;
      const touch = (e.touches && e.touches[0]) || {};
      const x = Number(touch.x);
      if (!Number.isFinite(x)) return;
      let best = 0;
      let dist = Infinity;
      pts.forEach((p, i) => {
        const d = Math.abs(p.x - x);
        if (d < dist) {
          dist = d;
          best = i;
        }
      });
      this._active = best;
      this.setData({ hint: hintFor(pts[best]) });
      this.draw({ animate: false });
    },

    draw(options = {}) {
      const series = normalizeSeries(this.properties.series);
      const labels = pickLabels(series);
      const rawMax = Math.max(0, ...series.map((s) => s.yuan));
      const axisMax = niceCeil(rawMax);
      const last = series[series.length - 1];
      const key = seriesKey(series);
      const shouldAnimate =
        options.animate && this._displaySeries && this._displaySeries.length && key !== this._seriesKey;
      this._seriesKey = key;
      this._targetSeries = series;
      this._axisMax = axisMax;
      const yTicks = buildYTicks(axisMax);
      const patch = {
        labels,
        yTicks,
        yWidthRpx: yWidthRpx(yTicks),
      };
      if (!this._hintTouched) patch.hint = hintFor(last);
      this.setData(patch, () => {
        if (this._dead) return;
        this.createSelectorQuery()
          .select('#funLine')
          .fields({ node: true, size: true })
          .exec((res) => {
            if (this._dead) return;
            const info = res && res[0];
            if (!info || !info.node || !info.width) return;
            this._canvas = info.node;
            this._cssW = info.width;
            this._cssH = info.height;
            if (shouldAnimate) this.animateTo(series, axisMax);
            else this.paintNow(series, axisMax);
          });
      });
    },

    animateTo(toSeries, toMax) {
      const fromSeries = this._displaySeries || [];
      const fromMax = this._displayMax || toMax;
      const token = (this._animToken || 0) + 1;
      this._animToken = token;
      const canvas = this._canvas;
      const started = Date.now();
      const tick = () => {
        if (this._dead || this._animToken !== token) return;
        const p = easeOutCubic((Date.now() - started) / ANIM_MS);
        const mid = lerpSeries(fromSeries, toSeries, p);
        const maxVal = fromMax + (toMax - fromMax) * p;
        this.paintFrame(mid, maxVal, p >= 1 ? toSeries : null);
        if (p < 1) {
          this.raf(canvas, tick);
        } else {
          this._displaySeries = toSeries;
          this._displayMax = toMax;
        }
      };
      this.raf(canvas, tick);
    },

    paintNow(series, axisMax) {
      this._animToken = (this._animToken || 0) + 1;
      this._displaySeries = series;
      this._displayMax = axisMax;
      this.paintFrame(series, axisMax, series);
    },

    raf(canvas, fn) {
      if (canvas && typeof canvas.requestAnimationFrame === 'function') {
        canvas.requestAnimationFrame(fn);
        return;
      }
      setTimeout(fn, 16);
    },

    ensureCtx(cssW, cssH) {
      const canvas = this._canvas;
      if (!canvas) return null;
      let dpr = 2;
      try {
        const win = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
        dpr = win.pixelRatio || 2;
      } catch (e) {
        dpr = 2;
      }
      if (
        this._ctx &&
        this._bufW === cssW &&
        this._bufH === cssH &&
        this._dpr === dpr
      ) {
        return this._ctx;
      }
      canvas.width = Math.max(1, Math.round(cssW * dpr));
      canvas.height = Math.max(1, Math.round(cssH * dpr));
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this._ctx = ctx;
      this._bufW = cssW;
      this._bufH = cssH;
      this._dpr = dpr;
      return ctx;
    },

    paintFrame(series, axisMax, settleSeries) {
      const cssW = this._cssW;
      const cssH = this._cssH;
      const ctx = this.ensureCtx(cssW, cssH);
      if (!ctx) return;
      ctx.clearRect(0, 0, cssW, cssH);

      const color = this.properties.color || '#07c160';
      /* 圆点最大半径 5 + 描边 2.5，贴边会被 canvas 裁掉 */
      const padL = 10;
      const padR = 10;
      const padT = 10;
      const padB = 10;
      const plotW = Math.max(1, cssW - padL - padR);
      const plotH = Math.max(1, cssH - padT - padB);
      const maxVal = axisMax || 1;
      const n = series.length;
      const src = settleSeries || series;
      const pts = series.map((s, i) => {
        const x = n <= 1 ? padL + plotW / 2 : padL + (i * plotW) / (n - 1);
        const y = padT + (1 - s.yuan / maxVal) * plotH;
        const meta = src[Math.min(i, src.length - 1)] || s;
        return { ...meta, yuan: s.yuan, x, y };
      });
      this._pts = pts;
      if (this._active == null || this._active >= pts.length) {
        this._active = pts.length ? pts.length - 1 : 0;
      }

      ctx.strokeStyle = hexToRgba(color, 0.16);
      ctx.lineWidth = 1;
      for (let i = 0; i < 3; i += 1) {
        const y = padT + (i * plotH) / 2;
        ctx.beginPath();
        ctx.moveTo(padL, y);
        ctx.lineTo(cssW - padR, y);
        ctx.stroke();
      }

      if (!pts.length) return;

      ctx.beginPath();
      ctx.moveTo(pts[0].x, padT + plotH);
      pts.forEach((p) => ctx.lineTo(p.x, p.y));
      ctx.lineTo(pts[pts.length - 1].x, padT + plotH);
      ctx.closePath();
      ctx.fillStyle = hexToRgba(color, 0.16);
      ctx.fill();

      ctx.beginPath();
      pts.forEach((p, i) => {
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.stroke();

      pts.forEach((p, i) => {
        const active = i === this._active;
        ctx.beginPath();
        ctx.arc(p.x, p.y, active ? 5 : 3, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = active ? 2.5 : 1.5;
        ctx.stroke();
      });
    },
  },
});
