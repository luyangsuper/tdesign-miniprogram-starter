import { createShellMethods, SHELL_DATA } from '../shell';
import {
  pickCheckedImages,
  formatBytes,
  saveLocalImageToAlbum,
  compressToTargetSize,
} from '../../utils/imageTool';
import { unlockImageExport } from '../imageGate';

const shell = createShellMethods();

Page({
  data: {
    ...SHELL_DATA,
    heroDesc: "按目标体积自动调整画质与尺寸",
    srcPath: '',
    srcMeta: '',
    outPath: '',
    outMeta: '',
    checking: false,
    checkText: '安全检测中…',
    busy: false,
    gating: false,
    exportUnlocked: false,
    targetKb: 200,
    targetLabel: '200 KB',
    targetInput: '200',
    sizePresets: [
      { v: 100, label: '100KB' },
      { v: 200, label: '200KB' },
      { v: 500, label: '500KB' },
      { v: 1024, label: '1MB' },
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

  onTarget(e) {
    const v = Number((e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.v) || 200);
    this.setData({
      targetKb: v,
      targetLabel: v >= 1024 ? (v / 1024) + ' MB' : v + ' KB',
      targetInput: String(v),
      exportUnlocked: false,
      outPath: '',
      outMeta: '',
    });
  },
  onTargetInput(e) {
    const raw = String((e.detail && e.detail.value) || '');
    const v = Math.max(20, Math.round(Number(raw) || 0));
    this.setData({
      targetInput: raw,
      targetKb: v || this.data.targetKb,
      targetLabel: (v || this.data.targetKb) + ' KB',
      exportUnlocked: false,
      outPath: '',
      outMeta: '',
    });
  },
  async runProcess() {
    const kb = Math.max(20, Number(this.data.targetKb) || 200);
    const res = await compressToTargetSize(this.data.srcPath, {
      targetBytes: kb * 1024,
    });
    return {
      ...res,
      meta: res.width + '×' + res.height + ' · ' + formatBytes(res.size) + '（目标 ' + kb + ' KB）',
    };
  },
  ...shell,
});
