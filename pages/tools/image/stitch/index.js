import { createShellMethods, SHELL_DATA } from '../shell';
import {
  pickCheckedImages,
  formatBytes,
  saveLocalImageToAlbum,
  stitchImages,
} from '../../utils/imageTool';
import { unlockImageExport } from '../imageGate';

const shell = createShellMethods();

Page({
  data: {
    ...SHELL_DATA,
    srcList: [],
    srcCount: 0,
    outPath: '',
    outMeta: '',
    checking: false,
    checkText: '安全检测中…',
    busy: false,
    gating: false,
    exportUnlocked: false,
    direction: 'vertical',
    gap: 8,
    bgColor: '#ffffff',
    bgList: [
      { v: '#ffffff', label: '白色' },
      { v: '#000000', label: '黑色' },
      { v: '#f3f4f6', label: '浅灰' },
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
    const remain = Math.max(1, 9 - (this.data.srcList || []).length);
    this.setData({ checking: true, checkText: '安全检测中…' });
    try {
      const files = await pickCheckedImages({
        count: remain,
        onProgress: (t) => this.setData({ checkText: t }),
      });
      const next = [...(this.data.srcList || []), ...files].slice(0, 9);
      this.setData({
        srcList: next,
        srcCount: next.length,
        outPath: '',
        outMeta: '',
        exportUnlocked: false,
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

  async onRepick() {
    if (this.data.checking || this.data.busy || this.data.gating) return;
    this.setData({ checking: true, checkText: '安全检测中…' });
    try {
      const files = await pickCheckedImages({
        count: 9,
        onProgress: (t) => this.setData({ checkText: t }),
      });
      this.setData({
        srcList: files.slice(0, 9),
        srcCount: Math.min(9, files.length),
        outPath: '',
        outMeta: '',
        exportUnlocked: false,
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

  onDirection(e) {
    const v =
      (e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.v) ||
      'vertical';
    this.setData({
      direction: v,
      exportUnlocked: false,
      outPath: '',
      outMeta: '',
    });
  },

  onGap(e) {
    const v = Math.round(Number((e.detail && e.detail.value) || 0));
    this.setData({
      gap: v,
      exportUnlocked: false,
      outPath: '',
      outMeta: '',
    });
  },

  onBg(e) {
    const v =
      (e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.v) ||
      '#ffffff';
    this.setData({
      bgColor: v,
      exportUnlocked: false,
      outPath: '',
      outMeta: '',
    });
  },

  async onProcess() {
    if ((this.data.srcList || []).length < 2 || this.data.busy || this.data.checking) {
      return;
    }
    this.setData({ busy: true });
    wx.showLoading({ title: '拼接中', mask: true });
    try {
      const paths = this.data.srcList.map((f) => f.path);
      const res = await stitchImages(paths, {
        direction: this.data.direction,
        gap: this.data.gap,
        bgColor: this.data.bgColor,
      });
      this.setData({
        outPath: res.path,
        outMeta: `${res.width}×${res.height} · ${formatBytes(res.size)}`,
        exportUnlocked: false,
      });
      wx.showToast({ title: '拼接完成', icon: 'success' });
    } catch (e) {
      wx.showToast({
        title: String((e && e.message) || '拼接失败').slice(0, 40),
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
