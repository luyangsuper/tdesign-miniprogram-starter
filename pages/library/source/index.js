import { callFunction, getTempFileURLs } from '~/utils/cloud';
import {
  LIB_SOURCE_ANIMATEMOJIS,
  canSaveFormatToAlbum,
  defaultDownloadFormat,
  itemDownloadFormatOptions,
  presentLibrarySource,
  resolveLibraryBillFormat,
  resolveSourceLibraryUnitCost,
  shouldConvertDownloadToGif,
} from '~/utils/library';
import {
  downloadLibraryItem,
  libraryCostKeyForItem,
  libraryUnitCost,
  libraryUnitCostForItem,
} from '~/utils/libraryDownload';
import {
  canAttemptDownload,
  getCachedEntitlement,
  setCachedEntitlement,
} from '~/utils/entitlement';
import { getCustomNavMetrics } from '~/utils/systemInfo';
import { applyThemeToPage, getThemeStyle } from '~/utils/theme';

const PAGE_SIZE = 40;
const SOURCE_TITLE_HINT = {
  animatemojis: '经典动态表情',
  'fluent-emoji': '立体动态表情',
  'animatemojis-community': '趣味反应表情',
  'meme-api': '萌芽表情包',
};

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
    emptyTip: '暂时还没有表情，过几天再来看看',
    previewVisible: false,
    activeItem: null,
    formatOptions: [],
    downloadFormat: 'gif',
    previewDisplayUrl: '',
    previewPlaceholder: '',
    formatTip: '将保存到相册',
    saveBtnText: '保存到相册',
    unitCost: 1,
    unitCostText: '1 积分',
    sourceLicense: '',
    saving: false,
  },

  _searchTimer: null,
  _sourceCosts: null,

  onLoad(query) {
    const nav = getCustomNavMetrics();
    const sourceId = String((query && query.sourceId) || LIB_SOURCE_ANIMATEMOJIS).trim();
    this.setData({
      sourceId,
      // 必须用 navBarStyle（含 padding-top + 栏高），勿把整段 navHeight 写进 --td-navbar-height
      navBarStyle: nav.navBarStyle || '',
      themeStyle: getThemeStyle(),
      unitCost: libraryUnitCost(),
      unitCostText: `${libraryUnitCost()} 积分`,
    });
    applyThemeToPage(this);
    this.bootstrap();
  },

  onUnload() {
    if (this._searchTimer) clearTimeout(this._searchTimer);
  },

  async bootstrap() {
    const hint = SOURCE_TITLE_HINT[this.data.sourceId];
    if (hint && !this.data.sourceTitle) {
      this.setData({ sourceTitle: hint });
    } else if (hint) {
      this.setData({ sourceTitle: hint });
    }
    // 列表优先出；元信息/分组并行，不堵首屏
    this.reloadItems();
    this.loadSourceMeta();
    this.loadGroups();
  },

  resolveUnitCost(format, item) {
    const active = item || this.data.activeItem;
    const bill = active
      ? resolveLibraryBillFormat(active, format)
      : format;
    return resolveSourceLibraryUnitCost(bill, this._sourceCosts, () =>
      active ? libraryUnitCostForItem(active, format) : libraryUnitCost(bill),
    );
  },

  unitCostLabel(cost) {
    const n = Math.max(0, Number(cost) || 0);
    return n > 0 ? `${n} 积分` : '免费';
  },

  async loadSourceMeta() {
    try {
      const res = await callFunction('listLibrary', { action: 'sources' });
      const list = (res.data && res.data.list) || [];
      const hit = list.find((s) => s.id === this.data.sourceId);
      if (hit) {
        const presented = presentLibrarySource(hit);
        const sourceCount = Number(presented.itemCount) || 0;
        this._sourceCosts = presented.costs || hit.costs || null;
        const unitCost = this.resolveUnitCost(this.data.downloadFormat || 'gif');
        this.setData({
          sourceTitle:
            presented.title ||
            SOURCE_TITLE_HINT[this.data.sourceId] ||
            '素材',
          sourceCount,
          allTagText: sourceCount > 0 ? `全部 ${sourceCount}` : '全部',
          unitCost,
          unitCostText: this.unitCostLabel(unitCost),
          sourceLicense:
            this.data.sourceId === 'meme-api'
              ? '素材来自 meme-api · CC BY-NC-SA 4.0'
              : '',
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
          ? '没有找到相关表情，换个词试试'
          : '暂时还没有表情，过几天再来看看',
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
    const opts = itemDownloadFormatOptions(item);
    const preferred = defaultDownloadFormat(item);
    const fmt = opts.some((o) => o.value === preferred)
      ? preferred
      : (opts[0] && opts[0].value) || 'gif';
    this.setData({
      previewVisible: true,
      activeItem: item,
      formatOptions: opts,
      downloadFormat: fmt,
    });
    this.applyFormatUi(fmt, item);
  },

  /** 按格式取预览地址：动图→gif，静图→webp，3D→png；转 GIF 时用静图预览 */
  pickFormatPreview(item, fmt) {
    const key = String(fmt || '').toLowerCase();
    const urls = (item && item.fileUrls) || {};
    if (key === 'gif' && shouldConvertDownloadToGif(item, key)) {
      return {
        url: urls.webp || urls.png || urls.jpg || item.previewUrl || '',
        placeholder: '',
      };
    }
    if (urls[key]) return { url: urls[key], placeholder: '' };
    if (key === 'lottie' || key === 'svg') {
      return {
        url: urls.gif || urls.webp || item.previewUrl || '',
        placeholder: urls.gif || urls.webp || item.previewUrl
          ? ''
          : key === 'lottie'
            ? '动画文件无图预览，保存将复制链接'
            : '矢量图无图预览，保存将复制链接',
      };
    }
    return {
      url: item.previewUrl || urls.gif || urls.webp || urls.png || '',
      placeholder: '',
    };
  },

  applyFormatUi(fmt, item) {
    const active = item || this.data.activeItem;
    const key = String(fmt || '').toLowerCase();
    const convertGif = shouldConvertDownloadToGif(active, key);
    const album = canSaveFormatToAlbum(key) || convertGif;
    let tip = album ? '将保存到系统相册' : '将复制下载链接（设计软件可用，不能直接存相册）';
    if (key === 'gif' && convertGif) {
      tip = '将转为动图保存，导入微信更清晰';
    } else if (key === 'gif') {
      tip = '动图，适合发聊天 / 存相册';
    } else if (key === 'webp' || key === 'jpg' || key === 'jpeg') {
      tip = '原静图，发微信可能被压缩';
    } else if (key === 'png') {
      tip = '3D静态图原图，发微信可能被压缩';
    } else if (key === 'lottie') {
      tip = '动画文件，复制链接后给设计工具用';
    } else if (key === 'svg') {
      tip = '矢量图，复制链接后给设计工具用';
    }
    const preview = this.pickFormatPreview(active, key);
    const unitCost = this.resolveUnitCost(fmt, active);
    this.setData({
      downloadFormat: key,
      unitCost,
      unitCostText: this.unitCostLabel(unitCost),
      formatTip: tip,
      saveBtnText: album ? '保存到相册' : '复制下载链接',
      previewDisplayUrl: preview.url || '',
      previewPlaceholder: preview.placeholder || '',
    });
    // 列表只带了预览链；切格式时按需换临时链
    if (!preview.url) {
      this.ensureFormatPreviewUrl(active, key);
    }
  },

  async ensureFormatPreviewUrl(item, fmt) {
    const active = item || this.data.activeItem;
    if (!active) return;
    const key = String(fmt || '').toLowerCase();
    const files = active.files || {};
    const fileID = String(files[key] || '').trim();
    if (!fileID || /^https?:\/\//i.test(fileID)) return;
    const token = `${active._id}:${key}`;
    this._previewResolveToken = token;
    try {
      const urls = await getTempFileURLs([fileID]);
      const url = (urls && urls[0]) || '';
      if (!url || this._previewResolveToken !== token) return;
      const nextUrls = { ...(active.fileUrls || {}), [key]: url };
      const nextItem = { ...active, fileUrls: nextUrls };
      const list = (this.data.list || []).map((row) =>
        row._id === active._id ? { ...row, fileUrls: nextUrls } : row,
      );
      this.setData({
        activeItem: nextItem,
        list,
        previewDisplayUrl: url,
        previewPlaceholder: '',
      });
    } catch (e) {
      /* ignore */
    }
  },

  onFormatTap(e) {
    const value =
      (e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.value) ||
      (e.detail && (e.detail.value || e.detail.name)) ||
      '';
    if (!value) return;
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
      previewDisplayUrl: '',
      previewPlaceholder: '',
      saving: false,
    });
  },

  async onSave() {
    const { activeItem, downloadFormat, saving } = this.data;
    if (!activeItem || saving) return;

    const unitCost = this.resolveUnitCost(downloadFormat, activeItem);
    if (unitCost > 0) {
      const costKey = libraryCostKeyForItem(activeItem, downloadFormat);
      const entitlement = getCachedEntitlement();
      if (!canAttemptDownload(entitlement, costKey)) {
        wx.showToast({
          title: `积分不足（需 ${unitCost}）`,
          icon: 'none',
        });
        return;
      }
    }

    this.setData({ saving: true });
    try {
      const result = await downloadLibraryItem({
        itemId: activeItem._id,
        format: downloadFormat,
        item: activeItem,
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
        wx.redirectTo({ url: '/pages/library/index' }),
    });
  },
});
