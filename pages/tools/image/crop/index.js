import { createShellMethods, SHELL_DATA } from '../shell';
import { getWindowInfoSafe } from '~/utils/systemInfo';
import {
  pickCheckedImages,
  formatBytes,
  saveLocalImageToAlbum,
  cropImage,
} from '../../utils/imageTool';
import { unlockImageExport } from '../imageGate';

const shell = createShellMethods();

const RATIO_LIST = [
  { id: 'free', label: '自由', ratio: 0 },
  { id: '1:1', label: '1:1', ratio: 1 },
  { id: '4:3', label: '4:3', ratio: 4 / 3 },
  { id: '3:4', label: '3:4', ratio: 3 / 4 },
  { id: '16:9', label: '16:9', ratio: 16 / 9 },
  { id: '9:16', label: '9:16', ratio: 9 / 16 },
];

function dist(a, b) {
  const dx = a.clientX - b.clientX;
  const dy = a.clientY - b.clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

Page({
  data: {
    ...SHELL_DATA,
    srcPath: '',
    srcMeta: '',
    outPath: '',
    outMeta: '',
    checking: false,
    checkText: '安全检测中…',
    busy: false,
    gating: false,
    exportUnlocked: false,
    ready: false,
    ratioId: '1:1',
    ratioLabel: '1:1',
    ratioList: RATIO_LIST,
    stageH: 280,
    frameL: 0,
    frameT: 0,
    frameW: 200,
    frameH: 200,
    drawW: 0,
    drawH: 0,
    tx: 0,
    ty: 0,
  },

  onLoad() {
    this.initShell();
    this._natW = 0;
    this._natH = 0;
    this._gest = null;
  },

  onUnload() {
    this.unbindShellEvents();
  },

  onShow() {
    this.refreshFestivalDecor();
  },

  async onPick() {
    if (this.data.checking || this.data.busy || this.data.gating) return;
    this.setData({ checking: true, checkText: '安全检测中…' });
    try {
      const files = await pickCheckedImages({
        count: 1,
        onProgress: (t) => this.setData({ checkText: t }),
      });
      const f = files[0];
      this._natW = Math.max(1, f.width || 1);
      this._natH = Math.max(1, f.height || 1);
      this.setData({
        srcPath: f.path,
        srcMeta:
          (f.width && f.height ? `${f.width}×${f.height} · ` : '') +
          formatBytes(f.size),
        outPath: '',
        outMeta: '',
        exportUnlocked: false,
        ready: false,
      });
      this.initCropLayout();
    } catch (e) {
      if (e && e.code === 'CANCEL') return;
      wx.showToast({
        title: String((e && e.message) || '选图失败').slice(0, 40),
        icon: 'none',
      });
    } finally {
      this.setData({ checking: false, checkText: '安全检测中…' });
    }
  },

  onRatio(e) {
    const id =
      (e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.v) ||
      '1:1';
    const hit = RATIO_LIST.find((r) => r.id === id);
    this.setData({
      ratioId: id,
      ratioLabel: (hit && hit.label) || id,
      exportUnlocked: false,
      outPath: '',
      outMeta: '',
    });
    if (this.data.srcPath) this.initCropLayout();
  },

  initCropLayout() {
    if (!this.data.srcPath || !this._natW || !this._natH) return;
    const win = getWindowInfoSafe();
    // 左右各约 20rpx 页边距 + 卡片内边距，按 750 设计稿换算
    const pagePad = ((Number(win.windowWidth) || 375) / 750) * 84;
    const stageW = Math.max(260, (Number(win.windowWidth) || 375) - pagePad);
    const stageH = Math.round(Math.min(360, stageW * 0.78));
    const item = RATIO_LIST.find((r) => r.id === this.data.ratioId) || RATIO_LIST[1];
    let ratio = item.ratio;
    if (!ratio) ratio = this._natW / this._natH;

    let frameW = stageW * 0.86;
    let frameH = frameW / ratio;
    if (frameH > stageH * 0.86) {
      frameH = stageH * 0.86;
      frameW = frameH * ratio;
    }
    const frameL = (stageW - frameW) / 2;
    const frameT = (stageH - frameH) / 2;
    const cover = Math.max(frameW / this._natW, frameH / this._natH);
    const drawW = this._natW * cover;
    const drawH = this._natH * cover;
    let tx = frameL + (frameW - drawW) / 2;
    let ty = frameT + (frameH - drawH) / 2;
    const clamped = this.clampPos(tx, ty, drawW, drawH, frameL, frameT, frameW, frameH);
    this.setData({
      ready: true,
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

  clampPos(tx, ty, drawW, drawH, frameL, frameT, frameW, frameH) {
    let x = tx;
    let y = ty;
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
    const cur = { ...this.data, ...extra };
    const c = this.clampPos(
      cur.tx,
      cur.ty,
      cur.drawW,
      cur.drawH,
      cur.frameL,
      cur.frameT,
      cur.frameW,
      cur.frameH,
    );
    this.setData({ ...extra, tx: c.tx, ty: c.ty });
  },

  onTouchStart(e) {
    if (!this.data.ready || this.data.busy) return;
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
      this.applyClamp({
        tx: g.tx0 + (touches[0].clientX - g.x0),
        ty: g.ty0 + (touches[0].clientY - g.y0),
      });
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
      const tx = g.cx - (g.cx - g.tx0) * k;
      const ty = g.cy - (g.cy - g.ty0) * k;
      this.applyClamp({ drawW, drawH, tx, ty });
    }
  },

  onTouchEnd() {
    this._gest = null;
  },

  calcCropRect() {
    const { frameL, frameT, frameW, frameH, tx, ty, drawW, drawH } = this.data;
    const scaleX = this._natW / drawW;
    const scaleY = this._natH / drawH;
    const x = (frameL - tx) * scaleX;
    const y = (frameT - ty) * scaleY;
    const w = frameW * scaleX;
    const h = frameH * scaleY;
    return {
      x: Math.max(0, Math.round(x)),
      y: Math.max(0, Math.round(y)),
      w: Math.max(1, Math.round(w)),
      h: Math.max(1, Math.round(h)),
    };
  },

  async onProcess() {
    if (!this.data.srcPath || !this.data.ready || this.data.busy) return;
    this.setData({ busy: true });
    wx.showLoading({ title: '裁剪中', mask: true });
    try {
      const rect = this.calcCropRect();
      const res = await cropImage(this.data.srcPath, rect, { fileType: 'png' });
      this.setData({
        outPath: res.path,
        outMeta: `${res.width}×${res.height} · ${formatBytes(res.size)}`,
        exportUnlocked: false,
      });
      wx.showToast({ title: '裁剪完成', icon: 'success' });
    } catch (e) {
      wx.showToast({
        title: String((e && e.message) || '裁剪失败').slice(0, 40),
        icon: 'none',
      });
    } finally {
      wx.hideLoading();
      this.setData({ busy: false });
    }
  },

  async onSave() {
    if (!this.data.outPath || this.data.busy || this.data.gating) return;
    this.setData({ gating: true });
    try {
      if (!this.data.exportUnlocked) {
        const gate = await unlockImageExport({ page: this });
        if (!gate || !gate.ok) return;
        this.setData({ exportUnlocked: true });
      }
      wx.showLoading({ title: '保存中', mask: true });
      await saveLocalImageToAlbum(this.data.outPath);
      wx.showToast({ title: '已保存到相册', icon: 'success' });
    } catch (e) {
      wx.showToast({
        title: String((e && e.message) || '保存失败').slice(0, 40),
        icon: 'none',
      });
    } finally {
      wx.hideLoading();
      this.setData({ gating: false });
    }
  },

  ...shell,
});
