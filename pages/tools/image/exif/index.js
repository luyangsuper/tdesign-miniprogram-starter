import { createShellMethods, SHELL_DATA } from '../shell';
import { pickCheckedImages, formatBytes } from '../../utils/imageTool';
import { parseJpegExif } from '../../utils/jpegExif';

const shell = createShellMethods();

Page({
  data: {
    ...SHELL_DATA,
    heroDesc: '查看拍摄参数、相机信息与 GPS',
    srcPath: '',
    srcMeta: '',
    checking: false,
    checkText: '安全检测中…',
    busy: false,
    entries: [],
    emptyTip: '',
    gpsText: '',
    gpsLat: 0,
    gpsLng: 0,
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
    if (this.data.checking || this.data.busy) return;
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
        entries: [],
        emptyTip: '',
        gpsText: '',
      });
      await this.parseExif(f.path);
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

  async parseExif(path) {
    this.setData({ busy: true });
    try {
      const res = await parseJpegExif(path);
      if (!res.ok) {
        this.setData({
          entries: [],
          emptyTip: res.message || '解析失败',
          gpsText: '',
        });
        return;
      }
      const gpsText = res.gps
        ? `GPS：${res.gps.lat.toFixed(6)}, ${res.gps.lng.toFixed(6)}`
        : '';
      this.setData({
        entries: res.entries || [],
        emptyTip: res.empty ? res.message || '没有 EXIF' : '',
        gpsText,
        gpsLat: (res.gps && res.gps.lat) || 0,
        gpsLng: (res.gps && res.gps.lng) || 0,
      });
    } catch (e) {
      this.setData({
        entries: [],
        emptyTip: String((e && e.message) || '解析失败'),
        gpsText: '',
      });
    } finally {
      this.setData({ busy: false });
    }
  },

  onOpenMap() {
    if (!this.data.gpsText) return;
    wx.openLocation({
      latitude: this.data.gpsLat,
      longitude: this.data.gpsLng,
      scale: 16,
      name: '拍摄位置',
      fail: () => wx.showToast({ title: '无法打开地图', icon: 'none' }),
    });
  },

  ...shell,
});
