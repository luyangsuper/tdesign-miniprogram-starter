import { createShellMethods, SHELL_DATA } from '../shell';
import {
  pickCheckedImages,
  formatBytes,
  saveLocalImageToAlbum,
  compressImage,
} from '../../utils/imageTool';
import { unlockImageExport } from '../imageGate';

const shell = createShellMethods();

Page({
  data: {
    ...SHELL_DATA,
    heroDesc: "调节画质与最长边，缩小文件体积",
    srcPath: '',
    srcMeta: '',
    outPath: '',
    outMeta: '',
    checking: false,
    checkText: '安全检测中…',
    busy: false,
    gating: false,
    exportUnlocked: false,
    qualityPct: 80,
    qualityLabel: '80%',
    maxEdge: 1920,
    maxEdgeLabel: '1920 px',
    maxEdgeInput: '1920',
    edgePresets: [
      { v: 320, label: '320' },
      { v: 480, label: '480' },
      { v: 640, label: '640' },
      { v: 720, label: '720' },
      { v: 960, label: '960' },
      { v: 1080, label: '1080' },
      { v: 1280, label: '1280' },
      { v: 1440, label: '1440' },
      { v: 1600, label: '1600' },
      { v: 1920, label: '1920' },
      { v: 2048, label: '2048' },
      { v: 2560, label: '2560' },
      { v: 0, label: '原尺寸', wide: true },
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
        paramsDirty: false,
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

  onQualityChange(e) {
    const v = Math.round(Number((e.detail && e.detail.value) || 80));
    this.markParamsDirty({ qualityPct: v, qualityLabel: v + '%' });
  },

  applyMaxEdge(edge) {
    const n = Number.isFinite(edge) ? Math.max(0, Math.min(8192, Math.floor(edge))) : 0;
    this.markParamsDirty({
      maxEdge: n,
      maxEdgeLabel: n > 0 ? `${n} px` : '原尺寸',
      maxEdgeInput: n > 0 ? String(n) : '',
    });
  },

  onEdgePreset(e) {
    const raw = e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.v;
    const v = raw == null || raw === '' ? 1920 : Number(raw);
    this.applyMaxEdge(Number.isFinite(v) ? v : 1920);
  },

  onMaxEdgeInput(e) {
    const raw = String((e.detail && e.detail.value) || '').trim();
    this.setData({ maxEdgeInput: raw });
    if (!raw) {
      this.applyMaxEdge(0);
      return;
    }
    const v = Math.round(Number(raw));
    if (!Number.isFinite(v) || v < 0) return;
    this.applyMaxEdge(v);
  },
  async runProcess() {
    const res = await compressImage(this.data.srcPath, {
      quality: this.data.qualityPct / 100,
      maxEdge: this.data.maxEdge,
    });
    return { ...res, meta: res.width + '×' + res.height + ' · ' + formatBytes(res.size) };
  },
  ...shell,
});
