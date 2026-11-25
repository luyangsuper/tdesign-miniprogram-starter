import { callFunction } from '~/utils/cloud';
import {
  LIB_SOURCE_ANIMATEMOJIS,
  canSaveFormatToAlbum,
  defaultDownloadFormat,
  formatLabel,
  itemAvailableFormats,
  presentLibrarySource,
} from '~/utils/library';
import {
  downloadLibraryItem,
  libraryCostKey,
  libraryUnitCost,
} from '~/utils/libraryDownload';
import {
  canAttemptDownload,
  getCachedEntitlement,
  setCachedEntitlement,
} from '~/utils/entitlement';
import { getCustomNavMetrics } from '~/utils/systemInfo';
import { applyThemeToPage, getThemeStyle } from '~/utils/theme';

const PAGE_SIZE = 40;

Page({
  data: {
    themeStyle: '',
    navBarStyle: '',
    sourceId: LIB_SOURCE_ANIMATEMOJIS,
    sourceTitle: '动态表情',
    sourceCount: 0,
    allTagText: '全部',
    keyword: '',
    groupKey: '',
    groups: [],
    list: [],
    total: 0,
    page: 1,
    hasMore: true,
    loading: true,
    loadingMore: false,
    emptyTip: '暂无表情，请用电脑脚本导入后再看',
    previewVisible: false,
    activeItem: null,
    formatOptions: [],
    downloadFormat: 'gif',
    formatTip: '将保存到相册',
    saveBtnText: '保存到相册',
    unitCost: 1,
    saving: false,
  },

  _searchTimer: null,

  onLoad(query) {
    const nav = getCustomNavMetrics();
    const sourceId = String((query && query.sourceId) || LIB_SOURCE_ANIMATEMOJIS).trim();
    this.setData({
      sourceId,
      // 必须用 navBarStyle（含 padding-top + 栏高），勿把整段 navHeight 写进 --td-navbar-height
      navBarStyle: nav.navBarStyle || '',
      themeStyle: getThemeStyle(),
      unitCost: libraryUnitCost(),
    });
    applyThemeToPage(this);
    this.bootstrap();
  },

  onUnload() {
    if (this._searchTimer) clearTimeout(this._searchTimer);
  },

  async bootstrap() {
    await Promise.all([this.loadSourceMeta(), this.loadGroups()]);
    await this.reloadItems();
  },

  async loadSourceMeta() {
    try {
      const res = await callFunction('listLibrary', { action: 'sources' });
      const list = (res.data && res.data.list) || [];
      const hit = list.find((s) => s.id === this.data.sourceId);
      if (hit) {
        const presented = presentLibrarySource(hit);
        const sourceCount = Number(presented.itemCount) || 0;
        this.setData({
          sourceTitle: presented.title || '素材',
          sourceCount,
          allTagText: sourceCount > 0 ? `全部 ${sourceCount}` : '全部',
        });
      }
    } catch (e) {
      /* ignore */
    }
  },

  async loadGroups() {
    try {
      const res = await callFunction('listLibrary', {
        action: 'groups',
        sourceId: this.data.sourceId,
      });
      const groups = ((res.data && res.data.list) || []).map((g) => {
        const count = Number(g.itemCount) || 0;
        const emoji = g.emoji || '';
        const title = g.title || '';
        return {
          ...g,
          tagText: count > 0 ? `${emoji}${title} ${count}` : `${emoji}${title}`,
        };
      });
      this.setData({ groups });
    } catch (e) {
      console.warn('[library groups]', e);
      this.setData({ groups: [] });
    }
  },

  async reloadItems() {
    this.setData({ page: 1, hasMore: true, list: [], loading: true });
    await this.fetchItems(true);
  },

  async fetchItems(reset) {
    if (this.data.loadingMore) return;
    if (!reset && !this.data.hasMore) return;
    if (!reset) this.setData({ loadingMore: true });

    const page = reset ? 1 : this.data.page;
    try {
      const res = await callFunction('listLibrary', {
        action: 'items',
        sourceId: this.data.sourceId,
        groupKey: this.data.groupKey || '',
        keyword: this.data.keyword || '',
        page,
        pageSize: PAGE_SIZE,
      });
      const data = res.data || {};
      const chunk = data.list || [];
      const nextList = reset ? chunk : this.data.list.concat(chunk);
      this.setData({
        list: nextList,
        total: Number(data.total) || nextList.length,
        page: page + 1,
        hasMore: !!data.hasMore,
        loading: false,
        loadingMore: false,
        emptyTip: this.data.keyword
          ? '没有匹配的表情'
          : '暂无表情，请用电脑脚本导入后再看',
      });
    } catch (e) {
      console.warn('[library items]', e);
      this.setData({ loading: false, loadingMore: false });
      if (reset) {
        wx.showToast({ title: e.message || '加载失败', icon: 'none' });
      }
    }
  },

  onReachBottom() {
    this.fetchItems(false);
  },

  onSearchChange(e) {
    const keyword = (e.detail && (e.detail.value ?? e.detail)) || '';
    this.setData({ keyword: String(keyword) });
    if (this._searchTimer) clearTimeout(this._searchTimer);
    this._searchTimer = setTimeout(() => {
      this.reloadItems();
    }, 320);
  },

  onSearchSubmit() {
    if (this._searchTimer) clearTimeout(this._searchTimer);
    this.reloadItems();
  },

  onSearchClear() {
    this.setData({ keyword: '' });
    this.reloadItems();
  },

  onGroupTap(e) {
    // t-check-tag change 也会冒泡；以 data-key 为准做单选
    const key = e.currentTarget.dataset.key;
    const next = key == null ? '' : String(key);
    if (next === this.data.groupKey) {
      // 保持选中，避免点当前分类被组件取消
      this.setData({ groupKey: next });
      return;
    }
    this.setData({ groupKey: next });
    this.reloadItems();
  },

  onOpenItem(e) {
    const id = e.currentTarget.dataset.id;
    const item = (this.data.list || []).find((x) => x._id === id);
    if (!item) return;
    const formats = itemAvailableFormats(item);
    const opts = (formats.length ? formats : ['gif']).map((f) => ({
      value: f,
      label: formatLabel(f),
    }));
    const preferred = defaultDownloadFormat({
      formats,
      files: Object.fromEntries(opts.map((o) => [o.value, '1'])),
    });
    const fmt = opts.some((o) => o.value === preferred)
      ? preferred
      : opts[0].value;
    this.applyFormatUi(fmt);
    this.setData({
      previewVisible: true,
      activeItem: item,
      formatOptions: opts,
      downloadFormat: fmt,
      unitCost: libraryUnitCost(fmt),
    });
  },

  applyFormatUi(fmt) {
    const album = canSaveFormatToAlbum(fmt);
    const key = String(fmt || '').toLowerCase();
    let tip = album ? '将保存到系统相册' : '将复制下载链接（设计软件可用，不能直接存相册）';
    if (key === 'gif') tip = '动图，适合发聊天 / 存相册';
    else if (key === 'webp' || key === 'png' || key === 'jpg' || key === 'jpeg') {
      tip = '静图，画质更清晰，可存相册';
    } else if (key === 'lottie') {
      tip = '动画文件，复制链接后给设计工具用';
    }
    this.setData({
      unitCost: libraryUnitCost(fmt),
      formatTip: tip,
      saveBtnText: album ? '保存到相册' : '复制下载链接',
    });
  },

  onFormatTap(e) {
    const value = e.currentTarget.dataset.value;
    if (!value) return;
    this.setData({ downloadFormat: value });
    this.applyFormatUi(value);
  },

  onPreviewVisibleChange(e) {
    const visible = !!(e.detail && e.detail.visible);
    if (!visible) this.closePreview();
  },

  closePreview() {
    this.setData({
      previewVisible: false,
      activeItem: null,
      saving: false,
    });
  },

  async onSave() {
    const { activeItem, downloadFormat, saving } = this.data;
    if (!activeItem || saving) return;

    const costKey = libraryCostKey(downloadFormat);
    const entitlement = getCachedEntitlement();
    if (!canAttemptDownload(entitlement, costKey)) {
      wx.showToast({
        title: `积分不足（需 ${libraryUnitCost(downloadFormat)}）`,
        icon: 'none',
      });
      return;
    }

    this.setData({ saving: true });
    try {
      const result = await downloadLibraryItem({
        itemId: activeItem._id,
        format: downloadFormat,
        onEntitlement: (ent) => setCachedEntitlement(ent),
      });
      if (result.mode === 'link') {
        await new Promise((resolve, reject) => {
          wx.setClipboardData({
            data: result.url,
            success: resolve,
            fail: reject,
          });
        });
        wx.showToast({ title: '链接已复制', icon: 'success' });
      } else {
        wx.showToast({ title: '已保存到相册', icon: 'success' });
      }
      this.closePreview();
    } catch (e) {
      wx.showToast({ title: e.message || '保存失败', icon: 'none' });
      this.setData({ saving: false });
    }
  },

  onBack() {
    wx.navigateBack({
      fail: () =>
        wx.navigateTo({ url: '/pages/library/index' }),
    });
  },
});
