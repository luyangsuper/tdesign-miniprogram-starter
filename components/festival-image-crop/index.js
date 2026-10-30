import { getWindowInfoSafe } from '../../utils/systemInfo';

function dist(a, b) {
  const dx = a.clientX - b.clientX;
  const dy = a.clientY - b.clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

Component({
  properties: {
    visible: { type: Boolean, value: false },
    src: { type: String, value: '' },
    /** 导出像素宽 */
    outWidth: { type: Number, value: 750 },
    /** 导出像素高 */
    outHeight: { type: Number, value: 200 },
    title: { type: String, value: '裁剪图片' },
    hint: { type: String, value: '单指拖动，双指缩放；框内区域将上传' },
  },

  data: {
    ready: false,
    exporting: false,
    statusBarPx: 20,
    stageH: 400,
    frameL: 0,
    frameT: 0,
    frameW: 300,
    frameH: 80,
    drawW: 0,
    drawH: 0,
    tx: 0,
    ty: 0,
  },

  observers: {
    'visible, src, outWidth, outHeight'(visible, src) {
      if (visible && src) {
        this.initLayout();
      } else if (!visible) {
        this.setData({ ready: false, exporting: false });
        this._gest = null;
      }
    },
  },

  methods: {
    noop() {},

    initLayout() {
      const src = this.properties.src;
      if (!src) return;
      const win = getWindowInfoSafe();
      const winW = win.windowWidth || 375;
      const winH = win.windowHeight || 667;
      const statusBarPx = Math.max(0, Number(win.statusBarHeight) || 20);
      const outW = Math.max(1, Number(this.properties.outWidth) || 750);
      const outH = Math.max(1, Number(this.properties.outHeight) || 200);
      const ratio = outW / outH;

      /* 头尾+状态栏约占位，中间给裁剪区 */
      const stageH = Math.max(240, Math.floor(winH - statusBarPx - 200));
      const frameW = Math.min(winW - 32, winW * 0.92);
      const frameH = frameW / ratio;
      const frameL = (winW - frameW) / 2;
      const frameT = Math.max(12, (stageH - frameH) / 2);

      wx.getImageInfo({
        src,
        success: (info) => {
          const natW = info.width || 1;
          const natH = info.height || 1;
          /* cover：至少铺满裁剪框 */
          const cover = Math.max(frameW / natW, frameH / natH);
          const drawW = natW * cover;
          const drawH = natH * cover;
          let tx = frameL + (frameW - drawW) / 2;
          let ty = frameT + (frameH - drawH) / 2;
          const clamped = this.clampPos(tx, ty, drawW, drawH, frameL, frameT, frameW, frameH);
          this._natW = natW;
          this._natH = natH;
          this._cover = cover;
          this.setData({
            ready: true,
            statusBarPx,
            stageH,
            frameL,
            frameT,
            frameW,
            frameH,
            drawW,
            drawH,
            tx: clamped.tx,
            ty: clamped.ty,
          });
        },
        fail: () => {
          wx.showToast({ title: '图片读取失败', icon: 'none' });
          this.triggerEvent('cancel');
        },
      });
    },

    clampPos(tx, ty, drawW, drawH, frameL, frameT, frameW, frameH) {
      let x = tx;
      let y = ty;
      /* 图片须盖住裁剪框 */
      const minX = frameL + frameW - drawW;
      const maxX = frameL;
      const minY = frameT + frameH - drawH;
      const maxY = frameT;
      if (drawW >= frameW) x = Math.min(maxX, Math.max(minX, x));
      else x = frameL + (frameW - drawW) / 2;
      if (drawH >= frameH) y = Math.min(maxY, Math.max(minY, y));
      else y = frameT + (frameH - drawH) / 2;
      return { tx: x, ty: y };
    },

    applyClamp(extra = {}) {
      const {
        tx,
        ty,
        drawW,
        drawH,
        frameL,
        frameT,
        frameW,
        frameH,
      } = { ...this.data, ...extra };
      const c = this.clampPos(tx, ty, drawW, drawH, frameL, frameT, frameW, frameH);
      this.setData({ ...extra, tx: c.tx, ty: c.ty });
    },

    onTouchStart(e) {
      if (!this.data.ready || this.data.exporting) return;
      const touches = e.touches || [];
      if (touches.length === 1) {
        this._gest = {
          mode: 'pan',
          x0: touches[0].clientX,
          y0: touches[0].clientY,
          tx0: this.data.tx,
          ty0: this.data.ty,
        };
      } else if (touches.length >= 2) {
        this._gest = {
          mode: 'pinch',
          d0: dist(touches[0], touches[1]),
          drawW0: this.data.drawW,
          drawH0: this.data.drawH,
          tx0: this.data.tx,
          ty0: this.data.ty,
          cx: (touches[0].clientX + touches[1].clientX) / 2,
          cy: (touches[0].clientY + touches[1].clientY) / 2,
        };
      }
    },

    onTouchMove(e) {
      const g = this._gest;
      if (!g || !this.data.ready) return;
      const touches = e.touches || [];
      if (g.mode === 'pan' && touches.length === 1) {
        const dx = touches[0].clientX - g.x0;
        const dy = touches[0].clientY - g.y0;
        this.applyClamp({ tx: g.tx0 + dx, ty: g.ty0 + dy });
        return;
      }
      if (g.mode === 'pinch' && touches.length >= 2 && g.d0 > 0) {
        const d1 = dist(touches[0], touches[1]);
        let k = d1 / g.d0;
        const minScale = Math.max(
          this.data.frameW / this._natW,
          this.data.frameH / this._natH,
        );
        const maxScale = minScale * 6;
        let nextCover = (g.drawW0 / this._natW) * k;
        nextCover = Math.min(maxScale, Math.max(minScale, nextCover));
        k = nextCover / (g.drawW0 / this._natW);
        const drawW = this._natW * nextCover;
        const drawH = this._natH * nextCover;
        /* 相对捏合中心缩放 */
        const tx = g.cx - (g.cx - g.tx0) * k;
        const ty = g.cy - (g.cy - g.ty0) * k;
        this.applyClamp({ drawW, drawH, tx, ty });
      }
    },

    onTouchEnd() {
      this._gest = null;
    },

    onCancel() {
      if (this.data.exporting) return;
      this.triggerEvent('cancel');
    },

    onConfirm() {
      if (!this.data.ready || this.data.exporting) return;
      this.setData({ exporting: true });
      this.exportCrop()
        .then((tempFilePath) => {
          this.triggerEvent('confirm', { tempFilePath });
        })
        .catch((err) => {
          wx.showToast({
            title: (err && err.message) || '裁剪失败',
            icon: 'none',
          });
        })
        .finally(() => {
          this.setData({ exporting: false });
        });
    },

    exportCrop() {
      const outW = Math.max(1, Number(this.properties.outWidth) || 750);
      const outH = Math.max(1, Number(this.properties.outHeight) || 200);
      const { tx, ty, drawW, drawH, frameL, frameT, frameW, frameH } = this.data;
      const scale = drawW / this._natW;
      const sx = (frameL - tx) / scale;
      const sy = (frameT - ty) / scale;
      const sw = frameW / scale;
      const sh = frameH / scale;

      return new Promise((resolve, reject) => {
        const q = this.createSelectorQuery();
        q.select('#ficropCanvas')
          .fields({ node: true, size: true })
          .exec((res) => {
            const canvas = res && res[0] && res[0].node;
            if (!canvas) {
              reject(new Error('画布不可用'));
              return;
            }
            const dpr = 1;
            canvas.width = outW * dpr;
            canvas.height = outH * dpr;
            const ctx = canvas.getContext('2d');
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, outW, outH);
            const img = canvas.createImage();
            img.onload = () => {
              try {
                ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);
              } catch (e) {
                reject(e);
                return;
              }
              wx.canvasToTempFilePath({
                canvas,
                x: 0,
                y: 0,
                width: outW,
                height: outH,
                destWidth: outW,
                destHeight: outH,
                fileType: 'png',
                quality: 1,
                success: (r) => resolve(r.tempFilePath),
                fail: (e) => reject(e || new Error('导出失败')),
              });
            };
            img.onerror = () => reject(new Error('图片加载失败'));
            img.src = this.properties.src;
          });
      });
    },
  },
});
