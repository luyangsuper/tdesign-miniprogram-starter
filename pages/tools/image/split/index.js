import { createShellMethods, SHELL_DATA } from '../shell';
import {
  pickCheckedImages,
  formatBytes,
  saveLocalImageToAlbum,
  splitImage,
} from '../../utils/imageTool';
import { unlockImageExport } from '../imageGate';

const shell = createShellMethods();

Page({
  data: {
    ...SHELL_DATA,
    srcPath: '',
    srcMeta: '',
    pieces: [],
    outMeta: '',
    checking: false,
    checkText: '安全检测中…',
    busy: false,
    gating: false,
    exportUnlocked: false,
    rows: 3,
    cols: 3,
    pieceCount: 9,
    rowPresets: [2, 3, 4],
    colPresets: [2, 3, 4],
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
          (f.width && f.height ? `${f.width}×${f.height} · ` : '') +
          formatBytes(f.size),
        pieces: [],
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

  onRows(e) {
    const v = Number(
      (e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.v) ||
        3,
    );
    this.setData({
      rows: v,
      pieceCount: v * this.data.cols,
      pieces: [],
      outMeta: '',
      exportUnlocked: false,
    });
  },

  onCols(e) {
    const v = Number(
      (e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.v) ||
        3,
    );
    this.setData({
      cols: v,
      pieceCount: this.data.rows * v,
      pieces: [],
      outMeta: '',
      exportUnlocked: false,
    });
  },

  async onProcess() {
    if (!this.data.srcPath || this.data.busy || this.data.checking) return;
    this.setData({ busy: true });
    wx.showLoading({ title: '分割中', mask: true });
    try {
      const res = await splitImage(this.data.srcPath, {
        rows: this.data.rows,
        cols: this.data.cols,
      });
      this.setData({
        pieces: res.pieces || [],
        outMeta: `${res.rows}×${res.cols} · 每格 ${res.cellW}×${res.cellH}`,
        exportUnlocked: false,
      });
      wx.showToast({ title: '分割完成', icon: 'success' });
    } catch (e) {
      wx.showToast({
        title: String((e && e.message) || '分割失败').slice(0, 40),
        icon: 'none',
      });
    } finally {
      wx.hideLoading();
      this.setData({ busy: false });
    }
  },

  async onSave() {
    const pieces = this.data.pieces || [];
    if (!pieces.length || this.data.busy || this.data.gating) return;
    this.setData({ gating: true });
    try {
      if (!this.data.exportUnlocked) {
        const gate = await unlockImageExport({ page: this });
        if (!gate || !gate.ok) return;
        this.setData({ exportUnlocked: true });
      }
      wx.showLoading({ title: '保存中', mask: true });
      for (let i = 0; i < pieces.length; i++) {
        await saveLocalImageToAlbum(pieces[i].path);
      }
      wx.showToast({ title: `已保存 ${pieces.length} 张`, icon: 'success' });
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
