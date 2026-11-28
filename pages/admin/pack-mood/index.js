import { callFunction, getTempFileURLs } from '~/utils/cloud';
import { guardAdminPage } from '~/utils/auth';
import { applyThemeToPage, getThemeStyle } from '~/utils/theme';
import {
  PACK_MOODS,
  PACK_MOOD_FILE_IDS,
  ensurePackMoodOverlayUrls,
} from '~/utils/packMood';

const COLOR_LABEL_ZH = {
  original: '原色',
  teal: '青绿',
  violet: '紫',
  green: '绿',
  blue: '蓝',
  red: '红',
  orange: '橙',
  pink: '粉',
  gold: '金',
  cyan: '青',
  purple: '紫',
};

const MOOD_ORDER = [
  'viral',
  'rising',
  'revived',
  'fresh',
  'popular',
  'sleeping',
  'cold',
];

Page({
  data: {
    themeStyle: '',
    loading: true,
    rows: [],
    overlays: {},
    pickerVisible: false,
    pickingMoodId: '',
    pickingLabel: '',
    pickerStep: 'list',
    pickerKeyword: '',
    pickerList: [],
    pickerPage: 1,
    pickerHasMore: true,
    pickerLoading: false,
    pickerLoadingMore: false,
    activeEffect: null,
    colorOptions: [],
    selectedColor: '',
    colorPreviewUrl: '',
    saving: false,
  },

  _searchTimer: null,

  onLoad() {
    if (!guardAdminPage()) return;
    this.setData({ themeStyle: getThemeStyle() });
    applyThemeToPage(this);
    this.reload();
  },

  onShow() {
    applyThemeToPage(this);
  },

  async reload() {
    this.setData({ loading: true });
    try {
      const res = await callFunction('packMoodConfig', { action: 'get' });
      const overlays = (res.data && res.data.overlays) || {};
      await this.paintRows(overlays);
    } catch (e) {
      wx.showToast({ title: e.message || '加载失败', icon: 'none' });
      await this.paintRows({});
    } finally {
      this.setData({ loading: false });
    }
  },

  async paintRows(overlays) {
    const fileIds = MOOD_ORDER.map((id) => {
      const ov = overlays[id];
      return (ov && ov.fileID) || PACK_MOOD_FILE_IDS[id] || '';
    }).filter(Boolean);
    let urls = [];
    try {
      urls = await getTempFileURLs(fileIds);
    } catch (_) {
      urls = [];
    }
    const urlByFile = Object.create(null);
    fileIds.forEach((fid, i) => {
      urlByFile[fid] = (urls && urls[i]) || '';
    });

    const rows = MOOD_ORDER.map((id) => {
      const def = PACK_MOODS[id];
      const ov = overlays[id];
      const fileID = (ov && ov.fileID) || PACK_MOOD_FILE_IDS[id] || '';
      const custom = !!(ov && ov.fileID);
      let sub = '内置默认';
      if (custom) {
        const name = ov.name || ov.effectKey || '';
        const color = ov.color ? ` · ${ov.color}` : '';
        sub = name ? `${name}${color}` : `自定义${color}`;
      }
      return {
        id,
        label: def.label,
        sub,
        custom,
        previewUrl: urlByFile[fileID] || '',
      };
    });
    this.setData({ rows, overlays });
  },

  onPick(e) {
    const id = e.currentTarget.dataset.id;
    const def = PACK_MOODS[id];
    if (!def) return;
    this.setData({
      pickerVisible: true,
      pickingMoodId: id,
      pickingLabel: def.label,
      pickerStep: 'list',
      pickerKeyword: '',
      pickerList: [],
      pickerPage: 1,
      pickerHasMore: true,
      activeEffect: null,
      colorOptions: [],
      selectedColor: '',
      colorPreviewUrl: '',
    });
    this.fetchPicker(true);
  },

  onPickerVisibleChange(e) {
    const visible = !!(e.detail && e.detail.visible);
    if (!visible) {
      this.setData({
        pickerVisible: false,
        pickerStep: 'list',
        activeEffect: null,
      });
    }
  },

  onPickerSearch(e) {
    const keyword = (e.detail && (e.detail.value ?? e.detail)) || '';
    this.setData({ pickerKeyword: String(keyword) });
    if (this._searchTimer) clearTimeout(this._searchTimer);
    this._searchTimer = setTimeout(() => this.fetchPicker(true), 320);
  },

  onPickerSearchClear() {
    this.setData({ pickerKeyword: '' });
    this.fetchPicker(true);
  },

  onPickerMore() {
    this.fetchPicker(false);
  },

  async fetchPicker(reset) {
    if (this.data.pickerLoadingMore) return;
    if (!reset && !this.data.pickerHasMore) return;
    if (reset) this.setData({ pickerLoading: true, pickerPage: 1 });
    else this.setData({ pickerLoadingMore: true });

    const page = reset ? 1 : this.data.pickerPage;
    try {
      const res = await callFunction('listLibrary', {
        action: 'items',
        sourceId: 'particlefx',
        keyword: this.data.pickerKeyword || '',
        page,
        pageSize: 30,
      });
      const data = res.data || {};
      const chunk = data.list || [];
      this.setData({
        pickerList: reset ? chunk : this.data.pickerList.concat(chunk),
        pickerPage: page + 1,
        pickerHasMore: !!data.hasMore,
        pickerLoading: false,
        pickerLoadingMore: false,
      });
    } catch (e) {
      this.setData({ pickerLoading: false, pickerLoadingMore: false });
      wx.showToast({ title: e.message || '加载失败', icon: 'none' });
    }
  },

  async onPickEffect(e) {
    const id = e.currentTarget.dataset.id;
    const item = (this.data.pickerList || []).find((x) => x._id === id);
    if (!item) return;
    const meta = item.meta || {};
    const variants = meta.variants || {};
    const colors = Array.isArray(meta.colors)
      ? meta.colors
      : Object.keys(variants);
    const colorOptions = colors.map((key) => {
      const k = String(key || '').toLowerCase();
      const v = variants[k] || {};
      return {
        value: k,
        label: COLOR_LABEL_ZH[k] || v.label || k,
        fileID: String((v && (v.gif || v)) || '').trim(),
      };
    }).filter((c) => c.fileID);
    if (!colorOptions.length) {
      const fallback = String(
        (item.files && item.files.gif) || item.previewFileID || '',
      ).trim();
      if (!fallback) {
        wx.showToast({ title: '该效果无文件', icon: 'none' });
        return;
      }
      colorOptions.push({ value: 'original', label: '原色', fileID: fallback });
    }
    const selectedColor =
      meta.defaultColor ||
      (colorOptions.find((c) => c.value === 'original') || colorOptions[0])
        .value;
    this.setData({
      pickerStep: 'color',
      activeEffect: item,
      colorOptions,
      selectedColor,
      colorPreviewUrl: '',
    });
    await this.resolveColorPreview(selectedColor);
  },

  async resolveColorPreview(color) {
    const hit = (this.data.colorOptions || []).find((c) => c.value === color);
    if (!hit || !hit.fileID) {
      this.setData({ colorPreviewUrl: '' });
      return;
    }
    try {
      const urls = await getTempFileURLs([hit.fileID]);
      this.setData({ colorPreviewUrl: (urls && urls[0]) || '' });
    } catch (_) {
      this.setData({ colorPreviewUrl: '' });
    }
  },

  onPickColor(e) {
    const value =
      (e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.value) ||
      '';
    if (!value || value === this.data.selectedColor) return;
    this.setData({ selectedColor: value });
    this.resolveColorPreview(value);
  },

  onBackToEffects() {
    this.setData({
      pickerStep: 'list',
      activeEffect: null,
      colorOptions: [],
      selectedColor: '',
      colorPreviewUrl: '',
    });
  },

  async onConfirmColor() {
    const moodId = this.data.pickingMoodId;
    const effect = this.data.activeEffect;
    const color = this.data.selectedColor;
    const hit = (this.data.colorOptions || []).find((c) => c.value === color);
    if (!moodId || !effect || !hit || !hit.fileID) return;
    this.setData({ saving: true });
    try {
      await callFunction('packMoodConfig', {
        action: 'setOverlay',
        moodId,
        overlay: {
          fileID: hit.fileID,
          bg: 'dark',
          effectKey: effect.externalKey || '',
          color,
          name: effect.name || '',
        },
      });
      wx.showToast({ title: '已保存', icon: 'success' });
      this.setData({ pickerVisible: false, saving: false });
      await ensurePackMoodOverlayUrls({ force: true });
      await this.reload();
    } catch (e) {
      this.setData({ saving: false });
      wx.showToast({ title: e.message || '保存失败', icon: 'none' });
    }
  },

  async onResetOne(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    try {
      await callFunction('packMoodConfig', {
        action: 'clearOverlay',
        moodId: id,
      });
      wx.showToast({ title: '已恢复默认', icon: 'success' });
      await ensurePackMoodOverlayUrls({ force: true });
      await this.reload();
    } catch (err) {
      wx.showToast({ title: err.message || '失败', icon: 'none' });
    }
  },
});
