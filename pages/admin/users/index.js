import { callFunction } from '~/utils/cloud';
import { applyThemeToPage, getThemeStyle } from '~/utils/theme';

Page({
  data: {
    filter: 'all',
    keyword: '',
    list: [],
    listLoading: false,
    listHasMore: true,
    listPage: 1,
    total: 0,
    panelVisible: false,
    user: null,
    saving: false,
    vipDays: '30',
    pointsValue: '0',
    confirmVisible: false,
    confirmTitle: '',
    confirmAction: '',
    themeStyle: '',
  },

  onLoad(options) {
    const openid = options && options.openid ? decodeURIComponent(options.openid) : '';
    this._pendingOpenid = openid || '';
    this.setData({ themeStyle: getThemeStyle() });
  },

  onShow() {
    applyThemeToPage(this);
    this.loadList(true).then(() => {
      if (this._pendingOpenid) {
        const openid = this._pendingOpenid;
        this._pendingOpenid = '';
        this.openUserByOpenid(openid);
      }
    });
  },

  async openUserByOpenid(openid) {
    if (!openid) return;
    const hit = (this.data.list || []).find((u) => u.openid === openid);
    if (hit) {
      this.setData({
        user: hit,
        panelVisible: true,
        vipDays: '30',
        pointsValue: String((hit.entitlement && hit.entitlement.points) || 0),
      });
      return;
    }
    wx.showLoading({ title: '加载用户', mask: true });
    try {
      const res = await callFunction('adminManageUser', { action: 'get', openid });
      const user = res.data;
      if (!user) throw new Error('未找到用户');
      this.setData({
        user,
        panelVisible: true,
        vipDays: '30',
        pointsValue: String((user.entitlement && user.entitlement.points) || 0),
        keyword: openid,
      });
    } catch (e) {
      wx.showToast({ title: e.message || '打开失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  onFilterChange(e) {
    const filter = e.currentTarget.dataset.filter;
    if (!filter || filter === this.data.filter) return;
    this.setData({ filter });
    this.loadList(true);
  },

  onKeywordChange(e) {
    this.setData({ keyword: (e.detail && e.detail.value) || '' });
  },

  onSearchSubmit() {
    this.loadList(true);
  },

  onSearchClear() {
    this.setData({ keyword: '' });
    this.loadList(true);
  },

  async loadList(reset = false) {
    if (this.data.listLoading) return;
    if (!reset && !this.data.listHasMore) return;

    const page = reset ? 1 : this.data.listPage;
    this.setData({ listLoading: true });
    try {
      const res = await callFunction('adminManageUser', {
        action: 'list',
        page,
        pageSize: 20,
        filter: this.data.filter,
        keyword: this.data.keyword,
      });
      const data = res.data || {};
      const list = data.list || [];
      this.setData({
        list: reset ? list : this.data.list.concat(list),
        listPage: page + 1,
        listHasMore: !!data.hasMore,
        total: data.total || 0,
        listLoading: false,
      });
    } catch (e) {
      this.setData({ listLoading: false });
      if (reset) wx.showToast({ title: e.message || '加载失败', icon: 'none' });
    }
  },

  onReachBottom() {
    this.loadList(false);
  },

  onPullDownRefresh() {
    this.loadList(true).finally(() => wx.stopPullDownRefresh());
  },

  onSelectUser(e) {
    const { index } = e.currentTarget.dataset;
    const user = this.data.list[index];
    if (!user) return;
    this.setData({
      user,
      panelVisible: true,
      vipDays: '30',
      pointsValue: String((user.entitlement && user.entitlement.points) || 0),
    });
  },

  closePanel() {
    this.setData({ panelVisible: false });
  },

  onPopupChange(e) {
    const visible = !!(e.detail && e.detail.visible);
    this.setData({ panelVisible: visible });
  },

  onVipDaysChange(e) {
    this.setData({ vipDays: e.detail.value });
  },

  onPointsChange(e) {
    this.setData({ pointsValue: e.detail.value });
  },

  askCancelVip() {
    if (!this.data.user) return;
    this.setData({
      confirmVisible: true,
      confirmTitle: '确认取消该用户包月会员？',
      confirmAction: 'cancelVip',
    });
  },

  closeConfirm() {
    this.setData({ confirmVisible: false, confirmAction: '' });
  },

  async onConfirm() {
    const { confirmAction } = this.data;
    this.setData({ confirmVisible: false });
    if (confirmAction === 'cancelVip') {
      await this.runAction('cancelVip');
    }
  },

  patchListUser(next) {
    if (!next || !next.openid) return;
    const list = (this.data.list || []).map((u) => (u.openid === next.openid ? next : u));
    this.setData({
      list,
      user: next,
      pointsValue: String((next.entitlement && next.entitlement.points) || 0),
    });
  },

  async runAction(action, extra = {}) {
    const user = this.data.user;
    if (!user || this.data.saving) return;
    this.setData({ saving: true });
    wx.showLoading({ title: '处理中', mask: true });
    try {
      const res = await callFunction('adminManageUser', {
        action,
        openid: user.openid,
        ...extra,
      });
      const next = res.data || null;
      this.patchListUser(next);
      wx.showToast({ title: res.message || '已更新', icon: 'success' });
    } catch (e) {
      wx.showToast({ title: e.message || '操作失败', icon: 'none' });
    } finally {
      wx.hideLoading();
      this.setData({ saving: false });
    }
  },

  onSetVipDays() {
    const days = Number(this.data.vipDays);
    if (!days || days < 1) {
      wx.showToast({ title: '请填写有效天数', icon: 'none' });
      return;
    }
    this.runAction('setVipDays', { days });
  },

  onSetPoints() {
    const points = Number(this.data.pointsValue);
    if (Number.isNaN(points) || points < 0) {
      wx.showToast({ title: '请填写有效积分', icon: 'none' });
      return;
    }
    this.runAction('setPoints', { points });
  },

  onAdjustPoints(e) {
    const delta = Number(e.currentTarget.dataset.delta);
    if (!delta) return;
    this.runAction('adjustPoints', { delta });
  },

  onClearPoints() {
    this.runAction('setPoints', { points: 0 });
  },

  copyOpenid() {
    const openid = this.data.user && this.data.user.openid;
    if (!openid) return;
    wx.setClipboardData({
      data: openid,
      success: () => wx.showToast({ title: '已复制', icon: 'success' }),
    });
  },
});
