import { createShellMethods, SHELL_DATA } from '../shell';
import {
  pickCheckedImages,
  formatBytes,
  saveLocalImageToAlbum,
  resizeImage,
} from '../../utils/imageTool';
import { unlockImageExport } from '../imageGate';

const shell = createShellMethods();

Page({
  data: {
    ...SHELL_DATA,
    heroDesc: "按像素缩放，可锁定原图比例",
    srcPath: '',
    srcMeta: '',
    outPath: '',
    outMeta: '',
    checking: false,
    checkText: '安全检测中…',
    busy: false,
    gating: false,
    exportUnlocked: false,
    lockRatio: true,
    widthInput: '',
    heightInput: '',
    scalePct: 100,
    scalePresets: [{ v: 50, label: '50%' }, { v: 75, label: '75%' }, { v: 100, label: '100%' }, { v: 150, label: '150%' }],
    srcW: 0,
    srcH: 0,
  },

  onLoad() {
    this.initShell();
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
      this.setData({
        srcPath: f.path,
        srcMeta:
          (f.width && f.height ? f.width + '×' + f.height + ' · ' : '') +
          formatBytes(f.size),
        outPath: '',
        outMeta: '',
        exportUnlocked: false,
      });
      if (typeof this.afterPick === 'function') this.afterPick(f);
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

  async onProcess() {
    if (!this.data.srcPath || this.data.busy || this.data.checking) return;
    this.setData({ busy: true });
    wx.showLoading({ title: '处理中', mask: true });
    try {
      const res = await this.runProcess();
      this.setData({
        outPath: res.path,
        outMeta: res.meta || '',
        exportUnlocked: false,
      });
      wx.showToast({ title: '处理完成', icon: 'success' });
    } catch (e) {
      wx.showToast({
        title: String((e && e.message) || '处理失败').slice(0, 40),
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

  onLockChange(e) {
    this.setData({ lockRatio: !!(e.detail && e.detail.value), exportUnlocked: false, outPath: '', outMeta: '' });
  },
  onWidthChange(e) {
    const w = String((e.detail && e.detail.value) || '');
    const patch = { widthInput: w, scalePct: 0, exportUnlocked: false, outPath: '', outMeta: '' };
    if (this.data.lockRatio && this.data.srcW && this.data.srcH) {
      const nw = Math.max(1, Math.round(Number(w) || 0));
      if (nw) patch.heightInput = String(Math.max(1, Math.round((nw / this.data.srcW) * this.data.srcH)));
    }
    this.setData(patch);
  },
  onHeightChange(e) {
    const h = String((e.detail && e.detail.value) || '');
    const patch = { heightInput: h, scalePct: 0, exportUnlocked: false, outPath: '', outMeta: '' };
    if (this.data.lockRatio && this.data.srcW && this.data.srcH) {
      const nh = Math.max(1, Math.round(Number(h) || 0));
      if (nh) patch.widthInput = String(Math.max(1, Math.round((nh / this.data.srcH) * this.data.srcW)));
    }
    this.setData(patch);
  },
  onScalePreset(e) {
    const v = Number((e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.v) || 100);
    const w = Math.max(1, Math.round((this.data.srcW * v) / 100));
    const h = Math.max(1, Math.round((this.data.srcH * v) / 100));
    this.setData({
      scalePct: v,
      widthInput: String(w),
      heightInput: String(h),
      exportUnlocked: false,
      outPath: '',
      outMeta: '',
    });
  },
  afterPick(file) {
    this.setData({
      srcW: file.width || 0,
      srcH: file.height || 0,
      widthInput: String(file.width || ''),
      heightInput: String(file.height || ''),
      scalePct: 100,
    });
  },
  async runProcess() {
    const width = Math.max(1, Math.round(Number(this.data.widthInput) || this.data.srcW || 1));
    const height = Math.max(1, Math.round(Number(this.data.heightInput) || this.data.srcH || 1));
    const res = await resizeImage(this.data.srcPath, {
      width,
      height,
      lockRatio: false,
      fileType: 'png',
    });
    return { ...res, meta: res.width + '×' + res.height + ' · ' + formatBytes(res.size) };
  },
  ...shell,
});
