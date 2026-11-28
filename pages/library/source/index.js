import { callFunction, getTempFileURLs } from '~/utils/cloud';
import {
  CONVERT_TO_GIF_COST,
  LIB_SOURCE_ANIMATEMOJIS,
  canSaveFormatToAlbum,
  defaultDownloadFormat,
  itemDownloadFormatOptions,
  presentLibrarySource,
  resolveLibraryBillFormat,
  resolveSourceLibraryUnitCost,
  shortLibraryGroupTitle,
  shouldConvertDownloadToGif,
} from '../utils/library';
import {
  downloadLibraryItem,
  libraryCostKeyForItem,
  libraryUnitCost,
  libraryUnitCostForItem,
  shareLibraryItemToFriend,
} from '../utils/libraryDownload';
import {
  canAttemptDownload,
  getCachedEntitlement,
  setCachedEntitlement,
  spendablePoints,
} from '~/utils/entitlement';
import { promptSaveAdForPoints } from '~/utils/adReward';
import {
  getLibraryGridAdEvery,
  getNativeLibraryGridAdUnitId,
  injectLibraryGridAds,
  shouldShowLibraryGridAds,
} from '~/utils/nativeAd';
import { getCustomNavMetrics } from '~/utils/systemInfo';
import { applyThemeToPage, getThemeStyle } from '~/utils/theme';
import { resolveIsAdmin } from '~/utils/auth';
import {
  PACK_MOODS,
  PACK_MOOD_FILE_IDS,
  ensurePackMoodOverlayUrls,
} from '~/utils/packMood';

const MOOD_ORDER = [
  'viral',
  'rising',
  'revived',
  'fresh',
  'popular',
  'sleeping',
  'cold',
];

const PAGE_SIZE = 40;
const SOURCE_TITLE_HINT = {
  animatemojis: '经典动态表情',
  'fluent-emoji': '立体动态表情',
  'animatemojis-community': '趣味反应表情',
  'meme-api': '萌芽表情包',
  'sticker-ext': '精选聊天表情',
  particlefx: '粒子特效素材',
};

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
  white: '白',
  black: '黑',
};

/** meta.variants 键大小写不敏感 */
function findVariant(variants, colorKey) {
  if (!variants || typeof variants !== 'object' || !colorKey) return null;
  if (variants[colorKey]) return variants[colorKey];
  const hit = Object.keys(variants).find(
    (k) => String(k).toLowerCase() === colorKey,
  );
  return hit ? variants[hit] : null;
}

function buildColorOptions(item) {
  const meta = (item && item.meta) || {};
  const colors = Array.isArray(meta.colors) ? meta.colors : [];
  const variants = meta.variants || {};
  const keys =
    colors.length > 0
      ? colors
      : Object.keys(variants).filter((k) => variants[k]);
  if (keys.length <= 1) return [];
  return keys.map((key) => {
    const k = String(key || '').toLowerCase();
    const v = findVariant(variants, k) || {};
    const label =
      COLOR_LABEL_ZH[k] ||
      String(v.label || k).replace(/^./, (c) => c.toUpperCase());
    return {
      value: k,
      label,
      hex: String(v.hex || '').trim(),
    };
  });
}

function resolveVariantFileId(item, color, format) {
  const key = String(color || '').trim().toLowerCase();
  const fmt = String(format || 'gif').toLowerCase();
  const meta = (item && item.meta) || {};
  const variants = meta.variants || {};
  if (key) {
    const v = findVariant(variants, key);
    const hit = (v && (v[fmt] || v.gif)) || '';
    if (hit) return String(hit).trim();
  }
  const files = (item && item.files) || {};
  return String(files[fmt] || files.gif || item.previewFileID || '').trim();
}

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
    colorOptions: [],
    selectedColor: '',
    previewDisplayUrl: '',
    previewFileID: '',
    previewPlaceholder: '',
    formatTip: '将保存到相册',
    saveBtnText: '保存到相册',
    canShareGif: false,
    unitCost: 1,
    unitCostText: '1 积分',
    saving: false,
    /** 原始素材列表（不含广告） */
    rawList: [],
    /** 混入两格宽广告后的展示列表 */
    displayList: [],
    nativeAdUnitId: '',
    showGridAds: false,
    gridAdEvery: 12,
    /** 管理员 + particlefx：氛围配置条 */
    showMoodAdmin: false,
    moodRows: [],
    moodOverlays: {},
    moodLoading: false,
    moodPickerVisible: false,
    moodSaving: false,
    moodAssignHint: '',
    moodViewVisible: false,
    moodView: null,
    /** 预览底：仅 particlefx（列表/氛围/弹层）；其他素材库不跟此联动 */
    previewBg: 'dark',
    previewBgOptions: [
      { id: 'light', label: '浅色' },
      { id: 'dark', label: '深色' },
      { id: 'checker', label: '灰白格' },
    ],
  },

  _searchTimer: null,
  _sourceCosts: null,
  _fetchToken: 0,

  refreshNativeAd() {
    const unitId = getNativeLibraryGridAdUnitId();
    const showGridAds = shouldShowLibraryGridAds();
    const gridAdEvery = getLibraryGridAdEvery();
    const same =
      this.data.nativeAdUnitId === unitId &&
      this.data.showGridAds === showGridAds &&
      this.data.gridAdEvery === gridAdEvery;
    if (same) return;
    const patch = {
      nativeAdUnitId: unitId,
      showGridAds,
      gridAdEvery,
    };
    if (this.data.rawList && this.data.rawList.length) {
      patch.displayList = injectLibraryGridAds(
        this.data.rawList,
        gridAdEvery,
        showGridAds,
      );
    }
    this.setData(patch);
  },

  applyList(rawList, extra = {}) {
    const showGridAds = shouldShowLibraryGridAds();
    const gridAdEvery = getLibraryGridAdEvery();
    const unitId = getNativeLibraryGridAdUnitId();
    this.setData({
      rawList,
      list: rawList,
      displayList: injectLibraryGridAds(rawList, gridAdEvery, showGridAds),
      nativeAdUnitId: unitId,
      showGridAds,
      gridAdEvery,
      ...extra,
    });
  },

  onGridAdError(e) {
    const key =
      (e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.key) ||
      '';
    if (!key) return;
    const displayList = (this.data.displayList || []).map((item) =>
      item && item.isAd && (item._id === key || item.key === key)
        ? { ...item, hidden: true }
        : item,
    );
    this.setData({ displayList });
  },

  onLoad(query) {
    const nav = getCustomNavMetrics();
    const sourceId = String((query && query.sourceId) || LIB_SOURCE_ANIMATEMOJIS).trim();
    this._pendingItemId = String((query && query.itemId) || '').trim();
    let previewBg = 'dark';
    try {
      const saved = wx.getStorageSync('library_preview_bg');
      if (saved === 'light' || saved === 'dark' || saved === 'checker') {
        previewBg = saved;
      }
    } catch (_) {
      /* ignore */
    }
    this.setData({
      sourceId,
      // 必须用 navBarStyle（含 padding-top + 栏高），勿把整段 navHeight 写进 --td-navbar-height
      navBarStyle: nav.navBarStyle || '',
      themeStyle: getThemeStyle(),
      unitCost: libraryUnitCost(),
      unitCostText: `${libraryUnitCost()} 积分`,
      previewBg,
    });
    applyThemeToPage(this);
    this.refreshNativeAd();
    this.refreshMoodAdmin();
    this._onEntitlementChange = () => this.refreshNativeAd();
    this._onAdminViewChange = () => {
      this.refreshNativeAd();
      this.refreshMoodAdmin();
    };
    this._onLibraryGridAdEveryChange = () => this.refreshNativeAd();
    try {
      const app = getApp();
      if (app && app.eventBus) {
        app.eventBus.on('entitlementChange', this._onEntitlementChange);
        app.eventBus.on('adminViewChange', this._onAdminViewChange);
        app.eventBus.on(
          'libraryGridAdEveryChange',
          this._onLibraryGridAdEveryChange,
        );
      }
    } catch (e) {
      /* ignore */
    }
    this.bootstrap();
  },

  onShow() {
    this.refreshNativeAd();
    this.refreshMoodAdmin();
  },

  onUnload() {
    if (this._searchTimer) clearTimeout(this._searchTimer);
    try {
      const app = getApp();
      if (app && app.eventBus) {
        if (this._onEntitlementChange) {
          app.eventBus.off('entitlementChange', this._onEntitlementChange);
        }
        if (this._onAdminViewChange) {
          app.eventBus.off('adminViewChange', this._onAdminViewChange);
        }
        if (this._onLibraryGridAdEveryChange) {
          app.eventBus.off(
            'libraryGridAdEveryChange',
            this._onLibraryGridAdEveryChange,
          );
        }
      }
    } catch (e) {
      /* ignore */
    }
  },

  async bootstrap() {
    const hint = SOURCE_TITLE_HINT[this.data.sourceId];
    if (hint && !this.data.sourceTitle) {
      this.setData({ sourceTitle: hint });
    } else if (hint) {
      this.setData({ sourceTitle: hint });
    }
    // 先拉源单价（免费源 costs=0），避免弹层误判成付费藏「发给好友」
    await this.loadSourceMeta();
    this.reloadItems();
    this.loadGroups();
    this.refreshMoodAdmin();
  },

  refreshMoodAdmin() {
    const show =
      this.data.sourceId === 'particlefx' && !!resolveIsAdmin();
    if (!show) {
      if (this.data.showMoodAdmin) {
        this.setData({
          showMoodAdmin: false,
          moodRows: [],
          moodPickerVisible: false,
        });
      }
      return;
    }
    this.setData({ showMoodAdmin: true });
    this.loadMoodRows();
  },

  async loadMoodRows() {
    if (this.data.sourceId !== 'particlefx' || !resolveIsAdmin()) return;
    this.setData({ moodLoading: true });
    try {
      const res = await callFunction('packMoodConfig', { action: 'get' });
      const overlays = (res.data && res.data.overlays) || {};
      await this.paintMoodRows(overlays);
    } catch (e) {
      await this.paintMoodRows({});
    } finally {
      this.setData({ moodLoading: false });
    }
  },

  async paintMoodRows(overlays) {
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
    const moodRows = MOOD_ORDER.map((id) => {
      const def = PACK_MOODS[id];
      const ov = overlays[id];
      const fileID = (ov && ov.fileID) || PACK_MOOD_FILE_IDS[id] || '';
      const custom = !!(ov && ov.fileID);
      let sub = '';
      if (custom) {
        const name = ov.name || ov.effectKey || '';
        const colorLabel =
          COLOR_LABEL_ZH[ov.color] || ov.color || '';
        if (name && colorLabel) sub = `${name}·${colorLabel}`;
        else if (name) sub = name;
        else if (colorLabel) sub = colorLabel;
        else sub = '已自定义';
      }
      return {
        id,
        label: def.label,
        sub,
        custom,
        previewUrl: urlByFile[fileID] || '',
      };
    });
    this.setData({ moodRows, moodOverlays: overlays });
  },

  onPreviewBgTap(e) {
    const id =
      (e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id) ||
      (e.detail && (e.detail.value || e.detail.name)) ||
      '';
    if (!id || id === this.data.previewBg) return;
    if (id !== 'light' && id !== 'dark' && id !== 'checker') return;
    this.setData({ previewBg: id });
    try {
      wx.setStorageSync('library_preview_bg', id);
    } catch (_) {
      /* ignore */
    }
  },

  onViewMood(e) {
    const id = e.currentTarget.dataset.id;
    const row = (this.data.moodRows || []).find((r) => r.id === id);
    if (!row) return;
    this.setData({ moodViewVisible: true, moodView: row });
  },

  onMoodViewVisibleChange(e) {
    const visible = !!(e.detail && e.detail.visible);
    if (!visible) this.setData({ moodViewVisible: false, moodView: null });
  },

  closeMoodView() {
    this.setData({ moodViewVisible: false, moodView: null });
  },

  onOpenMoodPicker() {
    if (!this.data.showMoodAdmin || !this.data.activeItem) return;
    const item = this.data.activeItem;
    const color = this.data.selectedColor || '';
    const colorLabel = COLOR_LABEL_ZH[color] || color;
    const name = (item && item.name) || '';
    const moodAssignHint = colorLabel ? `${name} · ${colorLabel}` : name;
    this.setData({ moodPickerVisible: true, moodAssignHint });
  },

  onMoodPickerVisibleChange(e) {
    const visible = !!(e.detail && e.detail.visible);
    if (!visible) this.setData({ moodPickerVisible: false });
  },

  closeMoodPicker() {
    this.setData({ moodPickerVisible: false });
  },

  async onAssignMood(e) {
    const moodId = e.currentTarget.dataset.id;
    const effect = this.data.activeItem;
    if (!moodId || !effect || !this.data.showMoodAdmin) return;
    const color = this.data.selectedColor || '';
    const fileID = String(
      resolveVariantFileId(effect, color, this.data.downloadFormat || 'gif') ||
        (effect.files && effect.files.gif) ||
        effect.previewFileID ||
        '',
    ).trim();
    if (!fileID) {
      wx.showToast({ title: '该效果无文件', icon: 'none' });
      return;
    }
    this.setData({ moodSaving: true });
    try {
      await callFunction('packMoodConfig', {
        action: 'setOverlay',
        moodId,
        overlay: {
          fileID,
          bg: 'dark',
          effectKey: effect.externalKey || '',
          color,
          name: effect.name || '',
        },
      });
      wx.showToast({ title: '已设为氛围', icon: 'success' });
      this.setData({ moodPickerVisible: false, moodSaving: false });
      await ensurePackMoodOverlayUrls({ force: true });
      await this.loadMoodRows();
    } catch (err) {
      this.setData({ moodSaving: false });
      wx.showToast({
        title: (err.message || '保存失败').slice(0, 40),
        icon: 'none',
      });
    }
  },

  onResetMood(e) {
    const id = e.currentTarget.dataset.id;
    if (!id || !this.data.showMoodAdmin) return;
    const row = (this.data.moodRows || []).find((r) => r.id === id);
    if (!row || !row.custom) {
      wx.showToast({ title: '已是内置', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '恢复默认',
      content: `将「${row.label}」改回内置粒子效果？`,
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await callFunction('packMoodConfig', {
            action: 'clearOverlay',
            moodId: id,
          });
          wx.showToast({ title: '已恢复默认', icon: 'success' });
          this.setData({ moodViewVisible: false, moodView: null });
          await ensurePackMoodOverlayUrls({ force: true });
          await this.loadMoodRows();
        } catch (err) {
          wx.showToast({
            title: (err.message || '失败').slice(0, 40),
            icon: 'none',
          });
        }
      },
    });
  },

  resolveUnitCost(format, item) {
    const active = item || this.data.activeItem;
    if (shouldConvertDownloadToGif(active, format)) {
      return CONVERT_TO_GIF_COST;
    }
    const bill = active
      ? resolveLibraryBillFormat(active, format)
      : format;
    return resolveSourceLibraryUnitCost(bill, this._sourceCosts, () =>
      active ? libraryUnitCostForItem(active, format) : libraryUnitCost(bill),
    );
  },

  unitCostLabel(cost) {
    const n = Math.max(0, Number(cost) || 0);
    if (n <= 0) return '免费';
    return `${n} 积分`;
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
        const fmt = this.data.downloadFormat || 'gif';
        const unitCost = this.resolveUnitCost(fmt);
        const patch = {
          sourceTitle:
            presented.title ||
            SOURCE_TITLE_HINT[this.data.sourceId] ||
            '素材',
          sourceCount,
          allTagText: sourceCount > 0 ? `全部 ${sourceCount}` : '全部',
          unitCost,
          unitCostText: this.unitCostLabel(unitCost),
          canShareGif: fmt === 'gif' && unitCost <= 0,
        };
        this.setData(patch);
        // 弹层已开时按新单价刷新按钮态
        if (this.data.previewVisible && this.data.activeItem) {
          this.applyFormatUi(
            this.data.downloadFormat,
            this.data.activeItem,
            this.data.selectedColor,
          );
        }
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
        // 🖼 等办公符号在微信字体常显示成方框，直接丢掉
        const rawEmoji = String(g.emoji || '').trim();
        const emoji =
          !rawEmoji || rawEmoji === '🖼' || rawEmoji === '🖼️' ? '' : rawEmoji;
        // 勿展示「用于…」长描述；优先短中文 / externalKey
        const title = shortLibraryGroupTitle(g);
        const label = emoji ? `${emoji} ${title}` : title;
        return {
          ...g,
          title,
          tagText: count > 0 ? `${label} ${count}` : label,
        };
      });
      this.setData({ groups });
    } catch (e) {
      console.warn('[library groups]', e);
      this.setData({ groups: [] });
    }
  },

  async reloadItems() {
    // 递增 token，作废进行中的翻页/搜索请求，避免旧结果盖住新列表
    this._fetchToken = (this._fetchToken || 0) + 1;
    this.setData({
      page: 1,
      hasMore: true,
      list: [],
      rawList: [],
      displayList: [],
      loading: true,
      loadingMore: false,
    });
    await this.fetchItems(true);
  },

  async fetchItems(reset) {
    if (!reset && this.data.loadingMore) return;
    if (!reset && !this.data.hasMore) return;
    if (!reset) this.setData({ loadingMore: true });

    const token = this._fetchToken;
    const page = reset ? 1 : this.data.page;
    const keyword = this.data.keyword || '';
    const groupKey = this.data.groupKey || '';
    const sourceId = this.data.sourceId;
    try {
      const res = await callFunction('listLibrary', {
        action: 'items',
        sourceId,
        groupKey,
        keyword,
        page,
        pageSize: PAGE_SIZE,
        // 翻页不算 count，减轻云库压力
        skipCount: !reset,
      });
      if (token !== this._fetchToken) return;
      const data = res.data || {};
      const chunk = data.list || [];
      const prevRaw = this.data.rawList || [];
      const nextRaw = reset ? chunk : prevRaw.concat(chunk);
      this.applyList(nextRaw, {
        total: reset
          ? Number(data.total) || nextRaw.length
          : this.data.total || nextRaw.length,
        page: page + 1,
        hasMore: !!data.hasMore,
        loading: false,
        loadingMore: false,
        emptyTip: keyword
          ? '没有找到相关表情，换个词试试'
          : '暂时还没有表情，过几天再来看看',
      });
      if (reset) {
        this.maybeOpenPendingItem(nextRaw);
      }
    } catch (e) {
      if (token !== this._fetchToken) return;
      console.warn('[library items]', e);
      this.setData({ loading: false, loadingMore: false });
      if (reset) {
        wx.showToast({ title: e.message || '加载失败', icon: 'none' });
      }
    }
  },

  async maybeOpenPendingItem(list) {
    const id = String(this._pendingItemId || '').trim();
    if (!id) return;
    this._pendingItemId = '';
    const hit = (list || []).find((x) => x && x._id === id && !x.isAd);
    if (hit) {
      this.openItemRecord(hit);
      return;
    }
    try {
      const res = await callFunction('listLibrary', {
        action: 'item',
        itemId: id,
      });
      const item = (res.data && res.data.item) || null;
      if (item) this.openItemRecord(item);
    } catch (e) {
      /* ignore */
    }
  },

  openItemRecord(item) {
    if (!item || !item._id) return;
    const opts = itemDownloadFormatOptions(item);
    const preferred = defaultDownloadFormat(item);
    const fmt = opts.some((o) => o.value === preferred)
      ? preferred
      : (opts[0] && opts[0].value) || 'gif';
    const colorOptions = buildColorOptions(item);
    const meta = item.meta || {};
    const originalHit = colorOptions.find((c) => c.value === 'original');
    const selectedColor =
      (colorOptions.length &&
        (meta.defaultColor ||
          (originalHit && originalHit.value) ||
          colorOptions[0].value)) ||
      '';
    // 先带上列表预览链，避免弹层首帧空白再等 applyFormatUi
    const bootUrl = String(item.previewUrl || '').trim();
    const bootFileId = String(item.previewFileID || '').trim();
    this.setData({
      previewVisible: true,
      activeItem: item,
      formatOptions: opts,
      downloadFormat: fmt,
      colorOptions,
      selectedColor,
      previewDisplayUrl: bootUrl,
      previewFileID: /^cloud:\/\//.test(bootFileId) ? bootFileId : '',
      previewPlaceholder: bootUrl ? '' : '加载预览中…',
    });
    this.applyFormatUi(fmt, item, selectedColor);
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
    if (!id || String(id).indexOf('lib-grid-ad-') === 0) return;
    const item = (this.data.rawList || this.data.list || []).find(
      (x) => x && x._id === id && !x.isAd,
    );
    if (!item) return;
    this.openItemRecord(item);
  },

  /** 按格式取预览地址；选「转 GIF」时用原静图预览；多色时优先所选颜色 */
  pickFormatPreview(item, fmt, color) {
    const key = String(fmt || '').toLowerCase();
    const colorKey = String(
      color != null ? color : this.data.selectedColor || '',
    )
      .trim()
      .toLowerCase();
    const urls = (item && item.fileUrls) || {};
    const listPreview = String((item && item.previewUrl) || '').trim();
    const variantUrlKey = colorKey ? `${key}__${colorKey}` : key;
    if (variantUrlKey && urls[variantUrlKey]) {
      return { url: urls[variantUrlKey], placeholder: '' };
    }
    if (key === 'gif' && shouldConvertDownloadToGif(item, key)) {
      return {
        url: urls.webp || urls.png || urls.jpg || listPreview || '',
        placeholder: '',
      };
    }
    if (!colorKey && urls[key]) return { url: urls[key], placeholder: '' };
    if (key === 'lottie' || key === 'svg') {
      return {
        url: urls.gif || urls.webp || listPreview || '',
        placeholder: urls.gif || urls.webp || listPreview
          ? ''
          : key === 'lottie'
            ? '动画文件无图预览，保存将复制链接'
            : '矢量图无图预览，保存将复制链接',
      };
    }
    if (colorKey) {
      const def = String(
        (item.meta && item.meta.defaultColor) || 'original',
      ).toLowerCase();
      // 仅默认色可复用列表预览；其它颜色必须换签，不能继续撑原色 https
      if (colorKey === def && listPreview) {
        return { url: listPreview, placeholder: '' };
      }
      return { url: '', placeholder: '加载预览中…' };
    }
    return {
      url: listPreview || urls.gif || urls.webp || urls.png || '',
      placeholder: '',
    };
  },

  applyFormatUi(fmt, item, color) {
    const active = item || this.data.activeItem;
    const key = String(fmt || '').toLowerCase();
    const colorKey = String(
      color != null ? color : this.data.selectedColor || '',
    )
      .trim()
      .toLowerCase();
    const convertGif = shouldConvertDownloadToGif(active, key);
    const album = canSaveFormatToAlbum(key) || convertGif;
    const preview = this.pickFormatPreview(active, key, colorKey);
    const unitCost = this.resolveUnitCost(fmt, active);
    let tip = album ? '将保存到系统相册' : '将复制下载链接（设计软件可用，不能直接存相册）';
    if (key === 'gif' && convertGif) {
      tip = '转为 GIF，导入微信更清晰';
    } else if (key === 'gif') {
      tip = 'GIF，适合发聊天 / 存相册';
    } else if (key === 'webp' || key === 'jpg' || key === 'jpeg') {
      tip =
        unitCost > 0
          ? '发微信可能被压缩'
          : '原格式免费，发微信可能被压缩';
    } else if (key === 'png') {
      tip =
        unitCost > 0
          ? 'PNG，发微信可能被压缩'
          : 'PNG 原格式免费，发微信可能被压缩';
    } else if (key === 'lottie') {
      tip = 'Lottie 文件，复制链接后给设计工具用';
    } else if (key === 'svg') {
      tip = 'SVG，复制链接后给设计工具用';
    }
    const previewFileID = String(
      resolveVariantFileId(active, colorKey, key) ||
        (active && active.previewFileID) ||
        '',
    ).trim();
    const cacheKey = colorKey ? `${key}__${colorKey}` : key;
    const hasCached = !!(active && active.fileUrls && active.fileUrls[cacheKey]);
    this.setData({
      downloadFormat: key,
      selectedColor: colorKey,
      unitCost,
      unitCostText: this.unitCostLabel(unitCost),
      formatTip: tip,
      saveBtnText: album ? '保存到相册' : '复制下载链接',
      // 仅免费 GIF 显示「发给好友」（收费走保存/看广告）
      canShareGif: key === 'gif' && unitCost <= 0,
      previewDisplayUrl: preview.url || '',
      previewFileID: /^cloud:\/\//.test(previewFileID) ? previewFileID : '',
      previewPlaceholder: preview.placeholder || '',
    });
    // 无可用预览链、或换了颜色尚无缓存时，按 fileID 换签（勿因 listPreview 是 https 而跳过）
    if (
      previewFileID &&
      /^cloud:\/\//.test(previewFileID) &&
      (!preview.url || (colorKey && !hasCached))
    ) {
      const def = String(
        (active && active.meta && active.meta.defaultColor) || 'original',
      ).toLowerCase();
      // 默认色已有列表 https 时不必再换签
      if (!(preview.url && colorKey && colorKey === def)) {
        this.ensureFormatPreviewUrl(active, key, colorKey);
      }
    }
  },

  /** 列表格裂图换签后写回，避免同屏其它格/再次进入仍用旧链 */
  onItemPreviewResign(e) {
    const id =
      (e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id) ||
      '';
    const next = String((e && e.detail && e.detail.src) || '').trim();
    if (!id || !next) return;
    const patch = (row) =>
      row && !row.isAd && row._id === id ? { ...row, previewUrl: next } : row;
    this.setData({
      rawList: (this.data.rawList || []).map(patch),
      list: (this.data.list || []).map(patch),
      displayList: (this.data.displayList || []).map(patch),
    });
  },

  async ensureFormatPreviewUrl(item, fmt, color) {
    const active = item || this.data.activeItem;
    if (!active) return;
    const key = String(fmt || '').toLowerCase();
    const colorKey = String(color || '').trim().toLowerCase();
    const fileID = resolveVariantFileId(active, colorKey, key);
    if (!fileID || /^https?:\/\//i.test(fileID)) {
      if (/^https?:\/\//i.test(fileID)) {
        this.setData({
          previewDisplayUrl: fileID,
          previewPlaceholder: '',
        });
      }
      return;
    }
    const cacheKey = colorKey ? `${key}__${colorKey}` : key;
    const token = `${active._id}:${cacheKey}`;
    this._previewResolveToken = token;
    try {
      const urls = await getTempFileURLs([fileID]);
      const url = (urls && urls[0]) || '';
      if (!url || this._previewResolveToken !== token) return;
      const nextUrls = { ...(active.fileUrls || {}), [cacheKey]: url };
      const nextItem = { ...active, fileUrls: nextUrls };
      const patchRow = (row) =>
        row && !row.isAd && row._id === active._id
          ? { ...row, fileUrls: nextUrls }
          : row;
      const rawList = (this.data.rawList || []).map(patchRow);
      const list = (this.data.list || []).map(patchRow);
      const displayList = (this.data.displayList || []).map(patchRow);
      this.setData({
        activeItem: nextItem,
        rawList,
        list,
        displayList,
        previewDisplayUrl: url,
        previewPlaceholder: '',
      });
    } catch (e) {
      if (this._previewResolveToken !== token) return;
      this.setData({
        previewPlaceholder: '预览加载失败，可直接保存',
      });
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

  onColorTap(e) {
    const value =
      (e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.value) ||
      '';
    if (!value || value === this.data.selectedColor) return;
    this.applyFormatUi(this.data.downloadFormat, this.data.activeItem, value);
  },

  onPreviewVisibleChange(e) {
    const visible = !!(e.detail && e.detail.visible);
    if (!visible) this.closePreview();
  },

  closePreview() {
    this.setData({
      previewVisible: false,
      activeItem: null,
      colorOptions: [],
      selectedColor: '',
      previewDisplayUrl: '',
      previewFileID: '',
      previewPlaceholder: '',
      saving: false,
    });
  },

  /** 保存 / 发送前统一：积分够不够，不够引导看广告 */
  async ensureLibraryPay(actionLabel) {
    const { activeItem, downloadFormat } = this.data;
    if (!activeItem) return false;
    const unitCost = this.resolveUnitCost(downloadFormat, activeItem);
    if (unitCost <= 0) return true;
    const convertGif = shouldConvertDownloadToGif(activeItem, downloadFormat);
    let entitlement = getCachedEntitlement();
    const enough = convertGif
      ? spendablePoints(entitlement) >= unitCost
      : canAttemptDownload(
          entitlement,
          libraryCostKeyForItem(activeItem, downloadFormat),
        );
    if (enough) return true;
    const ad = await promptSaveAdForPoints({
      need: unitCost,
      unitCost,
      count: 1,
      actionLabel: actionLabel || (convertGif ? '转 GIF' : '使用素材'),
      message: convertGif
        ? `转 GIF 需 ${unitCost} 积分`
        : `需 ${unitCost} 积分`,
    });
    if (ad && ad.action === 'go_my') {
      wx.switchTab({ url: '/pages/my/index' });
      return false;
    }
    if (!ad || !ad.ok) return false;
    entitlement = getCachedEntitlement();
    if (spendablePoints(entitlement) < unitCost) {
      wx.showToast({
        title: `积分不足（需 ${unitCost}）`,
        icon: 'none',
      });
      return false;
    }
    return true;
  },

  async onSave() {
    const { activeItem, downloadFormat, selectedColor, saving } = this.data;
    if (!activeItem || saving) return;
    const convertGif = shouldConvertDownloadToGif(activeItem, downloadFormat);
    if (!(await this.ensureLibraryPay(convertGif ? '转 GIF 保存' : '保存素材'))) {
      return;
    }

    this.setData({ saving: true });
    try {
      const result = await downloadLibraryItem({
        itemId: activeItem._id,
        format: downloadFormat,
        color: selectedColor || '',
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

  async onShareFriend() {
    const { activeItem, downloadFormat, selectedColor, saving, canShareGif } =
      this.data;
    if (!activeItem || saving) return;
    if (downloadFormat !== 'gif') return;
    // 仅免费：以实时单价为准（避免 canShareGif 异步未刷新）
    if (this.resolveUnitCost(downloadFormat, activeItem) > 0) {
      wx.showToast({ title: '付费素材请保存到相册', icon: 'none' });
      return;
    }
    if (
      typeof wx.showShareImageMenu !== 'function' &&
      typeof wx.shareFileMessage !== 'function'
    ) {
      wx.showToast({ title: '当前微信版本不支持', icon: 'none' });
      return;
    }
    const convertGif = shouldConvertDownloadToGif(activeItem, downloadFormat);
    if (
      !(await this.ensureLibraryPay(convertGif ? '转 GIF 发送' : '发送表情'))
    ) {
      return;
    }

    this.setData({ saving: true });
    try {
      await shareLibraryItemToFriend({
        itemId: activeItem._id,
        format: downloadFormat || 'gif',
        color: selectedColor || '',
        item: activeItem,
        onEntitlement: (ent) => setCachedEntitlement(ent),
      });
      this.closePreview();
    } catch (e) {
      const msg = (e && e.message) || '发送失败';
      // 用户取消选人：已扣费保留（文件已就绪），不弹失败
      if (/cancel|取消/i.test(msg)) {
        this.setData({ saving: false });
        return;
      }
      wx.showToast({ title: msg, icon: 'none' });
      this.setData({ saving: false });
    }
  },

  onBack() {
    // t-navbar 触发 go-back 后还会自行 navigateBack(delta=1)。
    // 这里再退会连退两级（源页 → 素材库 → 首页），栈内有上一页时只交给 navbar。
    const pages = getCurrentPages() || [];
    if (pages.length > 1) return;
    wx.redirectTo({
      url: '/pages/library/index',
      fail: () => wx.switchTab({ url: '/pages/home/index' }),
    });
  },
});
