import { createShellMethods, SHELL_DATA } from '../shell';
import {
  pickCheckedImages,
  formatBytes,
  saveLocalImageToAlbum,
  watermarkImage,
  watermarkWithImage,
} from '../../utils/imageTool';
import { unlockImageExport } from '../imageGate';

const shell = createShellMethods();

Page({
  data: {
    ...SHELL_DATA,
    heroDesc: '文字或图片水印，支持九宫格与平铺',
    srcPath: '',
    srcMeta: '',
    outPath: '',
    outMeta: '',
    checking: false,
    checkText: '安全检测中…',
    busy: false,
    gating: false,
    exportUnlocked: false,
    wmType: 'text',
    wmText: '趣图铺子',
    wmPath: '',
    wmPos: 'br',
    wmColor: '#ffffff',
    posList: [
      { id: 'tl', label: '左上' }, { id: 'tc', label: '中上' }, { id: 'tr', label: '右上' },
      { id: 'ml', label: '左中' }, { id: 'mc', label: '居中' }, { id: 'mr', label: '右中' },
      { id: 'bl', label: '左下' }, { id: 'bc', label: '中下' }, { id: 'br', label: '右下' },
      { id: 'tile', label: '平铺' },
    ],
    colorList: [
      { v: '#ffffff', label: '白色' },
      { v: '#000000', label: '黑色' },
      { v: '#07c160', label: '绿色' },
      { v: '#ef4444', label: '红色' },
      { v: '#f59e0b', label: '橙色' },
      { v: '#3b82f6', label: '蓝色' },
    ],
    opacityPct: 45,
    opacityLabel: '45%',
    fontSize: 36,
    sizePct: 12,
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

  onWmType(e) {
    const v = (e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.v) || 'text';
    this.markParamsDirty({ wmType: v });
  },

  onWmText(e) {
    this.markParamsDirty({
      wmText: String((e.detail && e.detail.value) || ''),
    });
  },

  async onPickWm() {
    if (this.data.checking || this.data.busy) return;
    this.setData({ checking: true, checkText: '检测水印图…' });
    try {
      const files = await pickCheckedImages({
        count: 1,
        onProgress: (t) => this.setData({ checkText: t }),
      });
      this.markParamsDirty({
        wmPath: files[0].path,
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

  onWmPos(e) {
    const v = (e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.v) || 'br';
    this.markParamsDirty({ wmPos: v });
  },

  onWmColor(e) {
    const v = (e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.v) || '#ffffff';
    this.markParamsDirty({ wmColor: v });
  },

  onOpacity(e) {
    const v = Math.round(Number((e.detail && e.detail.value) || 45));
    this.markParamsDirty({
      opacityPct: v,
      opacityLabel: v + '%',
    });
  },

  onFontSize(e) {
    const v = Math.round(Number((e.detail && e.detail.value) || 36));
    this.markParamsDirty({ fontSize: v });
  },

  onSizePct(e) {
    const v = Math.round(Number((e.detail && e.detail.value) || 12));
    this.markParamsDirty({ sizePct: v });
  },
  async runProcess() {
    if (this.data.wmType === 'image') {
      if (!this.data.wmPath) throw new Error('请先选择水印图片');
      const res = await watermarkWithImage(this.data.srcPath, this.data.wmPath, {
        position: this.data.wmPos,
        tile: this.data.wmPos === 'tile',
        opacity: this.data.opacityPct / 100,
        sizePct: this.data.sizePct,
      });
      return { ...res, meta: res.width + '×' + res.height + ' · ' + formatBytes(res.size) };
    }
    const res = await watermarkImage(this.data.srcPath, {
      text: this.data.wmText,
      position: this.data.wmPos,
      tile: this.data.wmPos === 'tile',
      color: this.data.wmColor,
      opacity: this.data.opacityPct / 100,
      fontSize: this.data.fontSize,
    });
    return { ...res, meta: res.width + '×' + res.height + ' · ' + formatBytes(res.size) };
  },
  ...shell,
});
