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
    unify: true,
    gap: 8,
    gapPresets: [0, 4, 8, 16, 24, 32],
    bgColor: '#ffffff',
    bgList: [
      { v: '#ffffff', label: '白色' },
      { v: '#000000', label: '黑色' },
      { v: '#f3f4f6', label: '浅灰' },
      { v: 'transparent', label: '透明' },
    ],
    fileType: 'png',
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

  onRemove(e) {
    const i = Number(e.currentTarget.dataset.i);
    if (!Number.isFinite(i)) return;
    const next = (this.data.srcList || []).filter((_, idx) => idx !== i);
    this.setData({ srcList: next, srcCount: next.length, ...this.clearResult() });
  },

  onMove(e) {
    const i = Number(e.currentTarget.dataset.i);
    const dir = Number(e.currentTarget.dataset.dir);
    const list = [...(this.data.srcList || [])];
    const j = i + dir;
    if (i < 0 || j < 0 || i >= list.length || j >= list.length) return;
    const tmp = list[i];
    list[i] = list[j];
    list[j] = tmp;
    this.setData({ srcList: list, ...this.clearResult() });
  },

  onDirection(e) {
    const v =
      (e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.v) ||
      'vertical';
    this.markParamsDirty({ direction: v });
  },

  onUnifyChange(e) {
    this.markParamsDirty({
      unify: !!(e.detail && e.detail.value),
    });
  },

  onGap(e) {
    const v = Math.round(Number((e.detail && e.detail.value) || 0));
    this.markParamsDirty({ gap: Math.max(0, Math.min(64, v)) });
  },

  onGapPreset(e) {
    const v = Math.round(Number(e.currentTarget.dataset.v) || 0);
    this.markParamsDirty({ gap: v });
  },

  onBg(e) {
    const v =
      (e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.v) ||
      '#ffffff';
    const patch = { bgColor: v };
    if (v === 'transparent') patch.fileType = 'png';
    this.markParamsDirty(patch);
  },

  onFileType(e) {
    const v =
      (e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.v) ||
      'png';
    if (v === 'jpg' && this.data.bgColor === 'transparent') {
      wx.showToast({ title: '透明背景请用 PNG', icon: 'none' });
      return;
    }
    this.markParamsDirty({ fileType: v });
  },

  async onProcess() {
    if (this.data.busy || this.data.checking) return;
    if ((this.data.srcList || []).length < 2) {
      wx.showToast({ title: '至少选 2 张图', icon: 'none' });
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
        unify: this.data.unify,
        fileType: this.data.fileType,
      });
      this.setData({
        outPath: res.path,
        outMeta: `${res.width}×${res.height} · ${formatBytes(res.size)}`,
        exportUnlocked: false,
        paramsDirty: false,
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
