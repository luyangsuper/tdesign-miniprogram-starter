import { createShellMethods, SHELL_DATA } from '../shell';
import {
  pickCheckedImages,
  formatBytes,
  saveLocalImageToAlbum,
  watermarkImage,
} from '../../utils/imageTool';
import { unlockImageExport } from '../imageGate';

const shell = createShellMethods();

Page({
  data: {
    ...SHELL_DATA,
    heroDesc: "添加文字水印，调整位置与透明度",
    srcPath: '',
    srcMeta: '',
    outPath: '',
    outMeta: '',
    checking: false,
    checkText: '安全检测中…',
    busy: false,
    gating: false,
    exportUnlocked: false,
    wmText: '趣图铺子',
    wmPos: 'br',
    posList: [
      { id: 'tl', label: '左上' }, { id: 'tc', label: '中上' }, { id: 'tr', label: '右上' },
      { id: 'ml', label: '左中' }, { id: 'mc', label: '居中' }, { id: 'mr', label: '右中' },
      { id: 'bl', label: '左下' }, { id: 'bc', label: '中下' }, { id: 'br', label: '右下' },
    ],
    opacityPct: 45,
    opacityLabel: '45%',
    fontSize: 36,
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

  onWmText(e) {
    this.setData({ wmText: String((e.detail && e.detail.value) || ''), exportUnlocked: false, outPath: '', outMeta: '' });
  },
  onWmPos(e) {
    const v = (e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.v) || 'br';
    this.setData({ wmPos: v, exportUnlocked: false, outPath: '', outMeta: '' });
  },
  onOpacity(e) {
    const v = Math.round(Number((e.detail && e.detail.value) || 45));
    this.setData({ opacityPct: v, opacityLabel: v + '%', exportUnlocked: false, outPath: '', outMeta: '' });
  },
  onFontSize(e) {
    const v = Math.round(Number((e.detail && e.detail.value) || 36));
    this.setData({ fontSize: v, exportUnlocked: false, outPath: '', outMeta: '' });
  },
  async runProcess() {
    const res = await watermarkImage(this.data.srcPath, {
      text: this.data.wmText,
      position: this.data.wmPos,
      opacity: this.data.opacityPct / 100,
      fontSize: this.data.fontSize,
    });
    return { ...res, meta: res.width + '×' + res.height + ' · ' + formatBytes(res.size) };
  },
  ...shell,
});
