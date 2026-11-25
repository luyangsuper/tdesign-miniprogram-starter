import { callFunction } from '~/utils/cloud';
import { guardAdminPage } from '~/utils/auth';
import { applyThemeToPage, getThemeStyle } from '~/utils/theme';
import {
  contentTypeChipStyle,
  contentTypeIconSrc,
  contentTypeLabel,
  formatItemCount,
  normalizeContentType,
} from '~/utils/contentType';
import { categoryTagStyle } from '~/utils/categories';

function pad2(n) {
  return String(n).padStart(2, '0');
}

/** 客户端按本地时区展示，避免云函数 UTC 串污染 */
function formatLocalMs(ms) {
  const t = Number(ms) || 0;
  if (!t) return '';
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function decorateDraftItem(item) {
  const raw = item || {};
  const type = normalizeContentType(raw.contentType);
  const count = Number(raw.emojiCount) || 0;
  const publishAt = Number(raw.publishAt) || 0;
  const hasSchedule = raw.status !== 'published' && publishAt > 0;
  return {
    ...raw,
    contentType: type,
    contentTypeName: contentTypeLabel(type),
    typeIconSrc: contentTypeIconSrc(type),
    typeStyle: contentTypeChipStyle(type),
    categoryStyle: categoryTagStyle(raw.categoryId, raw.categoryName),
    countText: count ? formatItemCount(count, type).replace(/\s/g, '') : '',
    hasSchedule,
    publishAt,
    publishAtText: hasSchedule ? formatLocalMs(publishAt) : '',
    updatedText: formatLocalMs(raw.updatedAt) || raw.updatedText || '',
  };
}

Page({
  data: {
    themeStyle: '',
    list: [],
    total: 0,
    loading: true,
    refreshing: false,
    deletingId: '',
  },

  onLoad() {
    this.setData({ themeStyle: getThemeStyle() });
  },

  onShow() {
    if (!guardAdminPage()) return;
    applyThemeToPage(this);
    this.loadList();
  },

  onPullDownRefresh() {
    this.loadList(true).finally(() => {
      wx.stopPullDownRefresh();
    });
  },

  /** 打开草稿箱时冲刷到期定时（不单靠云定时器） */
  async flushDuePacks() {
    try {
      const res = await callFunction('adminPublishDuePacks', { action: 'flush' });
      const published = Number(res && res.data && res.data.published) || 0;
      return published;
    } catch (e) {
      console.warn('[drafts] flushDuePacks', e.message || e);
      return 0;
    }
  },

  async loadList(fromPull) {
    if (fromPull) {
      this.setData({ refreshing: true });
    } else if (!(this.data.list || []).length) {
      this.setData({ loading: true });
    }
    try {
      const published = await this.flushDuePacks();
      const res = await callFunction('adminListPacks', {
        status: 'draft',
        page: 1,
        pageSize: 50,
      });
      const data = (res && res.data) || {};
      const list = (data.list || []).map(decorateDraftItem);
      this.setData({
        list,
        total: Number(data.total) || 0,
        loading: false,
        refreshing: false,
      });
      if (published > 0) {
        try {
          getApp().globalData.homeNeedRefresh = true;
        } catch (e) {
          /* ignore */
        }
        wx.showToast({
          title: `已自动上架 ${published} 个合集`,
          icon: 'success',
        });
      }
    } catch (e) {
      this.setData({ loading: false, refreshing: false });
      wx.showToast({ title: e.message || '加载失败', icon: 'none' });
    }
  },

  onCreate() {
    wx.navigateTo({ url: '/pages/admin/upload/index' });
  },

  noop() {},

  onOpen(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: `/pages/admin/upload/index?id=${id}` });
  },

  onDelete(e) {
    const id = e.currentTarget.dataset.id;
    const title = e.currentTarget.dataset.title || '该草稿';
    if (!id || this.data.deletingId) return;
    wx.showModal({
      title: '删除草稿',
      content: `确定删除「${title}」？封面和原图会一并删掉，不可恢复。`,
      confirmText: '删除',
      confirmColor: '#e34d59',
      success: (r) => {
        if (r.confirm) this.doDelete(id);
      },
    });
  },

  async doDelete(packId) {
    this.setData({ deletingId: packId });
    wx.showLoading({ title: '删除中', mask: true });
    try {
      await callFunction('adminDeletePack', { packId });
      wx.hideLoading();
      wx.showToast({ title: '已删除', icon: 'success' });
      this.setData({
        list: (this.data.list || []).filter((item) => item._id !== packId),
        total: Math.max(0, (this.data.total || 1) - 1),
        deletingId: '',
      });
    } catch (e) {
      wx.hideLoading();
      this.setData({ deletingId: '' });
      wx.showToast({ title: e.message || '删除失败', icon: 'none' });
    }
  },
});
