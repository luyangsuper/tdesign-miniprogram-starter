import { callFunction } from '~/utils/cloud';
import { applyThemeToPage, getThemeStyle } from '~/utils/theme';

Page({
  data: {
    loading: true,
    categories: [],
    newName: '',
    dialogVisible: false,
    dialogMode: 'add',
    editingId: '',
    editingName: '',
    deleteDialogVisible: false,
    deleteId: '',
    deleteName: '',
    themeStyle: '',
  },

  onLoad() {
    this.setData({ themeStyle: getThemeStyle() });
  },

  onShow() {
    applyThemeToPage(this);
    this.loadList();
  },

  async loadList() {
    this.setData({ loading: true });
    try {
      const res = await callFunction('adminManageCategory', { action: 'list' });
      this.setData({
        categories: (res.data && res.data.categories) || [],
        loading: false,
      });
    } catch (e) {
      this.setData({ loading: false });
      wx.showToast({ title: e.message || '加载失败', icon: 'none' });
    }
  },

  onNewNameChange(e) {
    this.setData({ newName: e.detail.value });
  },

  openAdd() {
    this.setData({
      dialogVisible: true,
      dialogMode: 'add',
      editingId: '',
      editingName: '',
      newName: '',
    });
  },

  openRename(e) {
    const { id, name } = e.currentTarget.dataset;
    this.setData({
      dialogVisible: true,
      dialogMode: 'rename',
      editingId: id,
      editingName: name,
      newName: name,
    });
  },

  closeDialog() {
    this.setData({ dialogVisible: false });
  },

  async confirmDialog() {
    const { dialogMode, newName, editingId } = this.data;
    const name = (newName || '').trim();
    if (!name) {
      wx.showToast({ title: '请输入名称', icon: 'none' });
      return;
    }

    wx.showLoading({ title: '保存中', mask: true });
    try {
      if (dialogMode === 'add') {
        await callFunction('adminManageCategory', { action: 'add', name });
      } else {
        await callFunction('adminManageCategory', {
          action: 'rename',
          id: editingId,
          name,
        });
      }
      wx.hideLoading();
      this.setData({ dialogVisible: false });
      this.loadList();
      wx.showToast({ title: '已保存', icon: 'success' });
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: e.message || '失败', icon: 'none' });
    }
  },

  onDelete(e) {
    const { id, name, builtin } = e.currentTarget.dataset;
    if (builtin) {
      wx.showToast({ title: '内置分类不可删除', icon: 'none' });
      return;
    }
    this.setData({
      deleteDialogVisible: true,
      deleteId: id,
      deleteName: name || '该分类',
    });
  },

  onCancelDelete() {
    this.setData({
      deleteDialogVisible: false,
      deleteId: '',
      deleteName: '',
    });
  },

  async onConfirmDelete() {
    const { deleteId } = this.data;
    this.setData({ deleteDialogVisible: false });
    if (!deleteId) return;

    wx.showLoading({ title: '删除中', mask: true });
    try {
      await callFunction('adminManageCategory', { action: 'remove', id: deleteId });
      wx.hideLoading();
      this.loadList();
      wx.showToast({ title: '已删除', icon: 'success' });
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: err.message || '删除失败', icon: 'none' });
    } finally {
      this.setData({ deleteId: '', deleteName: '' });
    }
  },
});
