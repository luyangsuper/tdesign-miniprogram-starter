import { createShellMethods, SHELL_DATA } from '../shell';
import {
  pickCheckedImages,
  formatBytes,
  saveLocalImageToAlbum,
  rotateImage,
} from '../../utils/imageTool';
import { unlockImageExport } from '../imageGate';

const shell = createShellMethods();

Page({
  data: {
    ...SHELL_DATA,
    heroDesc: '旋转 90° / 180° / 270°，或水平 / 垂直翻转',
    srcPath: '',
    srcMeta: '',
    outPath: '',
    outMeta: '',
    checking: false,
    checkText: '安全检测中…',
    busy: false,
    gating: false,
    exportUnlocked: false,
    rotate: 0,
    flipH: false,
    flipV: false,
    rotatePresets: [
      { v: 0, label: '0°' },
      { v: 90, label: '90°' },
      { v: 180, label: '180°' },
      { v: 270, label: '270°' },
    ],
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
      this.setData({
        srcPath: f.path,
        srcMeta:
          (f.width && f.height ? f.width + '×' + f.height + ' · ' : '') +
          formatBytes(f.size),
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

  onRotate(e) {
    const v = Number(e.currentTarget.dataset.v) || 0;
    if (v === this.data.rotate) return;
    this.markParamsDirty({ rotate: v });
  },

  onFlipH() {
    this.markParamsDirty({ flipH: !this.data.flipH });
  },

  onFlipV() {
    this.markParamsDirty({ flipV: !this.data.flipV });
  },

  async onProcess() {
    if (!this.data.srcPath || this.data.busy || this.data.checking) return;
    this.setData({ busy: true });
    wx.showLoading({ title: '处理中', mask: true });
    try {
      const res = await rotateImage(this.data.srcPath, {
        rotate: this.data.rotate,
        flipH: this.data.flipH,
        flipV: this.data.flipV,
      });
      this.setData({
        outPath: res.path,
        outMeta: `${res.width}×${res.height} · ${formatBytes(res.size)}`,
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
