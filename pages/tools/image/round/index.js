import { createShellMethods, SHELL_DATA } from '../shell';
import {
  pickCheckedImages,
  formatBytes,
  saveLocalImageToAlbum,
  roundCornerImage,
} from '../../utils/imageTool';
import { unlockImageExport } from '../imageGate';

const shell = createShellMethods();

Page({
  data: {
    ...SHELL_DATA,
    heroDesc: '给图片加圆角，导出透明底 PNG',
    srcPath: '',
    srcMeta: '',
    outPath: '',
    outMeta: '',
    checking: false,
    checkText: '安全检测中…',
    busy: false,
    gating: false,
    exportUnlocked: false,
    radius: 48,
    radiusPresets: [0, 16, 32, 48, 64, 96],
    srcMinEdge: 0,
  },

  onLoad() {
    this.initShell();
  },

  onUnload() {
    this.unbindShellEvents();
  },

  onShow() {
    this.refreshFestivalDecor();
    this.refreshNativeAd();
  },

  /** 换图 / 重选：清空结果 */
  clearResult() {
    return { exportUnlocked: false, outPath: '', outMeta: '', paramsDirty: false };
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
      const minEdge = Math.min(f.width || 0, f.height || 0);
      const maxR = Math.max(0, Math.floor(minEdge / 2));
      this.setData({
        srcPath: f.path,
        srcMeta:
          (f.width && f.height ? f.width + '×' + f.height + ' · ' : '') +
          formatBytes(f.size),
        srcMinEdge: minEdge,
        radius: Math.min(this.data.radius || 48, maxR || 48),
        ...this.clearResult(),
      });
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

  onRadius(e) {
    const maxR = Math.max(0, Math.floor((this.data.srcMinEdge || 0) / 2) || 512);
    const v = Math.max(0, Math.min(maxR, Math.round(Number((e.detail && e.detail.value) || 0))));
    this.markParamsDirty({ radius: v });
  },

  onRadiusPreset(e) {
    const maxR = Math.max(0, Math.floor((this.data.srcMinEdge || 0) / 2) || 512);
    const v = Math.max(0, Math.min(maxR, Math.round(Number(e.currentTarget.dataset.v) || 0)));
    this.markParamsDirty({ radius: v });
  },

  async onProcess() {
    if (!this.data.srcPath || this.data.busy || this.data.checking) return;
    this.setData({ busy: true });
    wx.showLoading({ title: '处理中', mask: true });
    try {
      const res = await roundCornerImage(this.data.srcPath, {
        radius: this.data.radius,
      });
      this.setData({
        outPath: res.path,
        outMeta: `${res.width}×${res.height} · 圆角 ${this.data.radius}px · ${formatBytes(res.size)}`,
        exportUnlocked: false,
        paramsDirty: false,
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
    if (!(await this.confirmSaveIfDirty())) return;
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
