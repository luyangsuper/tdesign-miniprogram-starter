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
    rowsInput: '3',
    colsInput: '3',
    /** 结果网格用上次处理时的列数，避免改参后预览错位 */
    resultCols: 3,
    pieceCount: 9,
    rowPresets: [2, 3, 4, 5, 6],
    colPresets: [2, 3, 4, 5, 6],
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
        paramsDirty: false,
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

  clampGrid(n, fallback = 3) {
    const v = Math.round(Number(n));
    if (!Number.isFinite(v)) return fallback;
    return Math.max(1, Math.min(12, v));
  },

  applyRows(n) {
    const rows = this.clampGrid(n, this.data.rows || 3);
    if (rows === this.data.rows) {
      if (this.data.rowsInput !== String(rows)) {
        this.setData({ rowsInput: String(rows) });
      }
      return;
    }
    this.markParamsDirty({
      rows,
      rowsInput: String(rows),
      pieceCount: rows * this.data.cols,
    });
  },

  applyCols(n) {
    const cols = this.clampGrid(n, this.data.cols || 3);
    if (cols === this.data.cols) {
      if (this.data.colsInput !== String(cols)) {
        this.setData({ colsInput: String(cols) });
      }
      return;
    }
    this.markParamsDirty({
      cols,
      colsInput: String(cols),
      pieceCount: this.data.rows * cols,
    });
  },

  onRows(e) {
    const v = (e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.v) || 3;
    this.applyRows(v);
  },

  onCols(e) {
    const v = (e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.v) || 3;
    this.applyCols(v);
  },

  onRowsInput(e) {
    const raw = String((e.detail && (e.detail.value ?? e.detail)) || '');
    this.setData({ rowsInput: raw });
    const n = Math.round(Number(raw));
    if (Number.isFinite(n) && n >= 1) this.applyRows(n);
  },

  onColsInput(e) {
    const raw = String((e.detail && (e.detail.value ?? e.detail)) || '');
    this.setData({ colsInput: raw });
    const n = Math.round(Number(raw));
    if (Number.isFinite(n) && n >= 1) this.applyCols(n);
  },

  onRowsBlur() {
    this.applyRows(this.data.rowsInput || this.data.rows);
  },

  onColsBlur() {
    this.applyCols(this.data.colsInput || this.data.cols);
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
        resultCols: this.data.cols,
        outMeta: `${res.rows}×${res.cols} · 每格 ${res.cellW}×${res.cellH}`,
        exportUnlocked: false,
        paramsDirty: false,
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
    if (!(await this.confirmSaveIfDirty())) return;
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
